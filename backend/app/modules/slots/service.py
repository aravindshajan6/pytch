"""Slots: the unit of pessimistic locking.

State machine (every transition publishes `slot.updated` on `pitch:<pitch_id>` after commit):
    available ──hold──▶ held ──book──▶ booked
    held / booked ──release──▶ available
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFound
from app.core.logging import logger
from app.core.timeutils import IST, ist_day_bounds, ist_today, utcnow
from app.modules.lobbies.models import Lobby
from app.modules.lobbies.queries import joinable_filters
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.turfs.schemas import HourWeather, SlotDetail, SlotOut
from app.modules.turfs.service import pitch_out, turf_summary
from app.realtime.publisher import pitch_channel, publish_on_commit

PEAK_START_HOUR = 17  # 17:00 – 22:00 IST kick-offs are peak
PEAK_END_HOUR = 22
_LOCK_NOT_AVAILABLE = "55P03"


class SlotLocked(AppError):
    code, status_code = "SLOT_LOCKED", 409
    message = "Someone is checking out this slot right now — try again in a moment"


class SlotUnavailable(AppError):
    code, status_code, message = "SLOT_UNAVAILABLE", 409, "This slot is no longer available"


# ─────────────────────────── serialisation ───────────────────────────


def slot_out(
    slot: Slot, *, weather: HourWeather | dict | None = None, open_lobby_id: uuid.UUID | None = None
) -> SlotOut:
    return SlotOut(
        id=slot.id,
        pitch_id=slot.pitch_id,
        start_at=slot.start_at,
        end_at=slot.end_at,
        price_paise=slot.price_paise,
        is_peak=slot.is_peak,
        status=slot.status,  # type: ignore[arg-type]
        held_until=slot.held_until if slot.status == "held" else None,
        open_lobby_id=open_lobby_id,
        weather=HourWeather.model_validate(weather) if weather is not None else None,
    )


# ─────────────────────────── locking & transitions ───────────────────────────


def _is_lock_not_available(exc: DBAPIError) -> bool:
    orig = getattr(exc, "orig", None)
    candidates = (orig, getattr(orig, "__cause__", None))
    return any(
        getattr(c, "pgcode", None) == _LOCK_NOT_AVAILABLE
        or getattr(c, "sqlstate", None) == _LOCK_NOT_AVAILABLE
        or type(c).__name__ == "LockNotAvailableError"
        for c in candidates
        if c is not None
    )


async def lock_slot(db: AsyncSession, slot_id: uuid.UUID) -> Slot:
    """`SELECT … FOR UPDATE NOWAIT` on the slot row.

    Runs inside a SAVEPOINT so a lock failure doesn't poison the caller's transaction.
    Raises `SlotLocked` (409) when another transaction holds the row, `NotFound` if missing.
    """
    await db.flush()
    stmt = (
        select(Slot)
        .where(Slot.id == slot_id)
        .with_for_update(nowait=True, of=Slot)
        .execution_options(populate_existing=True)
    )
    try:
        async with db.begin_nested():
            slot = (await db.execute(stmt)).unique().scalar_one_or_none()
    except DBAPIError as exc:
        if _is_lock_not_available(exc):
            raise SlotLocked() from exc
        raise
    if slot is None:
        raise NotFound("Slot not found")
    return slot


async def lock_slot_wait(db: AsyncSession, slot_id: uuid.UUID) -> Slot:
    """Blocking row lock — for internal transitions (confirm/expire) that must not fail fast."""
    await db.flush()
    stmt = (
        select(Slot)
        .where(Slot.id == slot_id)
        .with_for_update(of=Slot)
        .execution_options(populate_existing=True)
    )
    slot = (await db.execute(stmt)).unique().scalar_one_or_none()
    if slot is None:
        raise NotFound("Slot not found")
    return slot


def _publish(db: AsyncSession, slot: Slot) -> None:
    publish_on_commit(
        db,
        pitch_channel(slot.pitch_id),
        "slot.updated",
        {
            "slot_id": str(slot.id),
            "pitch_id": str(slot.pitch_id),
            "status": slot.status,
            "held_until": slot.held_until.isoformat() if slot.held_until and slot.status == "held" else None,
        },
    )


async def hold_slot(
    db: AsyncSession, slot: Slot, *, user_id: uuid.UUID, until: datetime, booking_id: uuid.UUID
) -> None:
    """available → held. Caller must hold the row lock (see `lock_slot`). Caller commits."""
    if slot.status != "available":
        raise SlotUnavailable()
    if slot.start_at <= utcnow():
        raise SlotUnavailable("This slot has already started")
    slot.status = "held"
    slot.held_until = until
    slot.held_by_id = user_id
    slot.booking_id = booking_id
    _publish(db, slot)


async def book_slot(db: AsyncSession, slot: Slot) -> None:
    """held → booked (idempotent). Caller commits."""
    if slot.status == "booked":
        return
    if slot.status not in ("held", "available"):
        raise SlotUnavailable()
    slot.status = "booked"
    slot.held_until = None
    _publish(db, slot)


async def release_slot(db: AsyncSession, slot: Slot) -> None:
    """→ available, clearing hold/booking fields. Caller commits."""
    if slot.status == "available" and slot.booking_id is None:
        return
    slot.status = "available"
    slot.held_until = None
    slot.held_by_id = None
    slot.booking_id = None
    _publish(db, slot)


# ─────────────────────────── generation ───────────────────────────


def _is_peak(start_ist: datetime) -> bool:
    return start_ist.weekday() >= 5 or PEAK_START_HOUR <= start_ist.hour < PEAK_END_HOUR


def _opening_hours(turf: Turf) -> tuple[int, int]:
    """[first kick-off hour, closing hour) in IST. A close time of 00:00 means midnight."""
    open_t: time = turf.open_time or time(6, 0)
    close_t: time = turf.close_time or time(23, 0)
    first = open_t.hour + (1 if open_t.minute else 0)
    last = 24 if (close_t.hour == 0 and close_t.minute == 0) else close_t.hour
    return first, last


async def _turf_of(db: AsyncSession, pitch: Pitch) -> Turf | None:
    turf = pitch.__dict__.get("turf")  # avoid an implicit lazy load in async context
    if turf is None:
        await db.flush()
        turf = await db.get(Turf, pitch.turf_id)
    return turf


async def generate_slots_for_pitch(db: AsyncSession, pitch: Pitch, *, days: int = 14) -> int:
    """Idempotently create hourly slots for the next `days` IST days. Returns rows inserted.

    Hours follow the turf's opening times; kick-offs 17:00–22:00 IST or on weekends use the
    peak price. Existing `(pitch_id, start_at)` rows are left untouched. Caller commits.
    """
    turf = await _turf_of(db, pitch)
    if turf is None:
        return 0
    first_hour, close_hour = _opening_hours(turf)
    now = utcnow()
    today = ist_today()
    rows: list[dict[str, Any]] = []
    for offset in range(days):
        day: date = today + timedelta(days=offset)
        for hour in range(first_hour, close_hour):
            start_ist = datetime.combine(day, time(hour), tzinfo=IST)
            start = start_ist.astimezone(UTC)
            if start <= now:
                continue
            peak = _is_peak(start_ist)
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "pitch_id": pitch.id,
                    "start_at": start,
                    "end_at": start + timedelta(hours=1),
                    "price_paise": pitch.peak_price_per_hour_paise if peak else pitch.price_per_hour_paise,
                    "is_peak": peak,
                    "status": "available",
                    "created_at": now,
                    "updated_at": now,
                }
            )
    if not rows:
        return 0
    result = await db.execute(
        insert(Slot).values(rows).on_conflict_do_nothing(index_elements=["pitch_id", "start_at"])
    )
    return max(result.rowcount or 0, 0)


# ─────────────────────────── queries ───────────────────────────


async def _open_lobbies_by_slot(db: AsyncSession, slot_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    if not slot_ids:
        return {}
    rows = await db.execute(
        select(Lobby.slot_id, Lobby.id).where(Lobby.slot_id.in_(slot_ids), *joinable_filters(utcnow()))
    )
    return {slot_id: lobby_id for slot_id, lobby_id in rows.all()}


async def _weather_for(pitch: Pitch, slots: Sequence[Slot]) -> dict[Any, Any]:
    """Hourly forecast per slot for outdoor pitches (weather module is optional)."""
    if pitch.is_indoor or not slots:
        return {}
    try:
        from app.modules.weather.service import forecast_for_slots
    except (ImportError, AttributeError):
        return {}
    try:
        return dict(await forecast_for_slots(pitch, list(slots)) or {})
    except Exception:
        logger.warning("weather: forecast_for_slots failed for pitch %s", pitch.id, exc_info=True)
        return {}


async def get_pitch(db: AsyncSession, pitch_id: uuid.UUID) -> Pitch:
    pitch = await db.get(Pitch, pitch_id)
    if pitch is None or not pitch.is_active:
        raise NotFound("Pitch not found")
    return pitch


async def list_pitch_slots(db: AsyncSession, pitch_id: uuid.UUID, day: date | None = None) -> list[SlotOut]:
    pitch = await get_pitch(db, pitch_id)
    start, end = ist_day_bounds(day or ist_today())
    slots = (
        (
            await db.execute(
                select(Slot)
                .where(Slot.pitch_id == pitch.id, Slot.start_at >= start, Slot.start_at < end)
                .order_by(Slot.start_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    open_lobbies = await _open_lobbies_by_slot(db, [s.id for s in slots])
    weather = await _weather_for(pitch, slots)
    return [
        slot_out(s, weather=weather.get(s.id) or weather.get(str(s.id)), open_lobby_id=open_lobbies.get(s.id))
        for s in slots
    ]


async def get_slot(db: AsyncSession, slot_id: uuid.UUID) -> Slot:
    slot = await db.get(Slot, slot_id)
    if slot is None:
        raise NotFound("Slot not found")
    return slot


async def slot_detail(db: AsyncSession, slot_id: uuid.UUID) -> SlotDetail:
    slot = await get_slot(db, slot_id)
    pitch: Pitch = slot.pitch
    open_lobbies = await _open_lobbies_by_slot(db, [slot.id])
    weather = await _weather_for(pitch, [slot])
    return SlotDetail(
        slot=slot_out(slot, weather=weather.get(slot.id) or weather.get(str(slot.id)),
                      open_lobby_id=open_lobbies.get(slot.id)),
        pitch=pitch_out(pitch),
        turf=await turf_summary(db, pitch.turf),
    )
