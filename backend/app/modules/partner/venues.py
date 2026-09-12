"""Partner venue & pitch management (manager+). Re-pricing only ever touches future *available* slots."""

import uuid
from collections import defaultdict
from datetime import UTC, datetime, time

from sqlalchemy import case, delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import SPORTS
from app.core.errors import AppError
from app.core.timeutils import IST, utcnow
from app.modules.audit import service as audit
from app.modules.bookings.models import Booking
from app.modules.channels.models import SlotBlock
from app.modules.lobbies.models import Lobby
from app.modules.partner.deps import PartnerContext
from app.modules.partner.schemas import PartnerPitchOut, PartnerVenue, PitchInput, PitchUpdate, VenueUpdate
from app.modules.partner.scope import get_pitch, get_turf, partner_actor, scoped_turfs
from app.modules.slots.models import Slot
from app.modules.slots.service import _opening_hours, generate_slots_for_pitch
from app.modules.turfs.models import Pitch, Turf
from app.modules.turfs.schemas import PitchOut
from app.modules.turfs.service import pitch_out, turf_summaries

_FORMATS = {s["key"]: set(s["formats"]) for s in SPORTS}
MAX_PITCHES_PER_VENUE = 30


class InvalidVenue(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "Invalid venue settings"


async def _audit(db: AsyncSession, ctx: PartnerContext, action: str, summary: str, *, target_type: str,
                 target_id: object, changes: dict | None = None) -> None:
    actor = partner_actor(ctx)
    await audit.record(db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label, action=action,
                       summary=summary, target_type=target_type, target_id=target_id, changes=changes)


def partner_pitch_out(p: Pitch, upcoming: int = 0) -> PartnerPitchOut:
    return PartnerPitchOut(**pitch_out(p).model_dump(), is_active=p.is_active, upcoming_bookings=upcoming)


async def upcoming_bookings(db: AsyncSession, pitch_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Per pitch: Pytch games (forming/confirmed) + offline bookings that haven't ended yet — what a manager must
    know about before switching a pitch off."""
    if not pitch_ids:
        return {}
    now = utcnow()
    counts: dict[uuid.UUID, int] = defaultdict(int)
    for pid, n in (await db.execute(
        select(Lobby.pitch_id, func.count(Lobby.id))
        .where(Lobby.pitch_id.in_(pitch_ids), Lobby.status.in_(("forming", "confirmed")), Lobby.end_at > now)
        .group_by(Lobby.pitch_id)
    )).all():
        counts[pid] += int(n)
    for pid, n in (await db.execute(
        select(SlotBlock.pitch_id, func.count(SlotBlock.id))
        .where(SlotBlock.pitch_id.in_(pitch_ids), SlotBlock.kind == "booking", SlotBlock.status == "active",
               SlotBlock.end_at > now)
        .group_by(SlotBlock.pitch_id)
    )).all():
        counts[pid] += int(n)
    return counts


async def venue_outs(db: AsyncSession, turfs: list[Turf]) -> list[PartnerVenue]:
    summaries = await turf_summaries(db, turfs, public=False)
    upcoming = await upcoming_bookings(db, [p.id for t in turfs for p in t.pitches])
    out = []
    for turf, summary in zip(turfs, summaries, strict=True):
        pitches = sorted(turf.pitches, key=lambda p: p.name)
        out.append(PartnerVenue(
            **summary.model_dump(),
            description=turf.description or "",
            photos=list(turf.photos or []),
            phone=turf.phone,
            open_time=turf.open_time.strftime("%H:%M"),
            close_time=turf.close_time.strftime("%H:%M"),
            pitches=[partner_pitch_out(p, upcoming.get(p.id, 0)) for p in pitches],
            is_active=turf.is_active,
            pitch_count_active=sum(1 for p in pitches if p.is_active),
        ))
    return out


async def list_venues(db: AsyncSession, ctx: PartnerContext) -> list[PartnerVenue]:
    return await venue_outs(db, await scoped_turfs(db, ctx))


def _hhmm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


async def _resync_hours(db: AsyncSession, turf: Turf) -> int:
    """After opening hours change: create missing slots and drop future *free* slots outside the new hours
    (never touching held/booked/blocked slots or anything a booking ever referenced)."""
    for p in turf.pitches:
        if p.is_active:
            await generate_slots_for_pitch(db, p)
    first, last = _opening_hours(turf)
    now = utcnow()
    candidates = (await db.execute(
        select(Slot.id, Slot.start_at).where(
            Slot.pitch_id.in_([p.id for p in turf.pitches] or [uuid.uuid4()]), Slot.start_at > now,
            Slot.status == "available", Slot.block_id.is_(None), Slot.booking_id.is_(None),
        )
    )).all()
    outside = [sid for sid, start in candidates if not first <= start.astimezone(IST).hour < last]
    if not outside:
        return 0
    result = await db.execute(
        delete(Slot).where(
            Slot.id.in_(outside),
            ~exists(select(Booking.id).where(Booking.slot_id == Slot.id)),
            ~exists(select(Lobby.id).where(Lobby.slot_id == Slot.id)),
        )
    )
    return max(result.rowcount or 0, 0)


async def update_venue(db: AsyncSession, ctx: PartnerContext, turf_id: uuid.UUID, req: VenueUpdate) -> PartnerVenue:
    turf = await get_turf(db, ctx, turf_id)
    fields = req.model_dump(exclude_unset=True)
    for key in ("name", "address", "description", "amenities", "photos", "open_time", "close_time"):
        if key in fields and fields[key] is None:
            fields.pop(key)
    if "open_time" in fields:
        fields["open_time"] = _hhmm(fields["open_time"])
    if "close_time" in fields:
        fields["close_time"] = _hhmm(fields["close_time"])
    open_t = fields.get("open_time", turf.open_time)
    close_t = fields.get("close_time", turf.close_time)
    if close_t != time(0, 0) and close_t <= open_t:
        raise InvalidVenue("Closing time must be after opening time (use 00:00 for midnight)")
    before = {k: getattr(turf, k) for k in fields}
    for k, v in fields.items():
        setattr(turf, k, v)
    changes = audit.diff(before, fields)
    pruned = 0
    if "open_time" in changes or "close_time" in changes:
        await db.flush()
        pruned = await _resync_hours(db, turf)
    if changes:
        await _audit(db, ctx, "venue.update", f"Updated venue {turf.name} ({', '.join(changes)})",
                     target_type="turf", target_id=turf.id,
                     changes={**{k: [str(a), str(b)] for k, (a, b) in changes.items()}, "pruned_slots": pruned})
    await db.commit()
    await db.refresh(turf)
    return (await venue_outs(db, [turf]))[0]


def _check_pitch(sport: str, fmt: str, has_camera: bool, camera_price: int) -> None:
    if fmt not in _FORMATS.get(sport, set()):
        raise InvalidVenue(f"Format must be one of {sorted(_FORMATS.get(sport, set()))} for {sport}")
    if camera_price and not has_camera:
        raise InvalidVenue("Set has_camera to charge for recordings")


async def create_pitch(db: AsyncSession, ctx: PartnerContext, turf_id: uuid.UUID, req: PitchInput) -> PitchOut:
    turf = await get_turf(db, ctx, turf_id)
    if len(turf.pitches) >= MAX_PITCHES_PER_VENUE:
        raise InvalidVenue(f"A venue can have at most {MAX_PITCHES_PER_VENUE} pitches")
    _check_pitch(req.sport, req.format, req.has_camera, req.camera_price_paise)
    pitch = Pitch(
        id=uuid.uuid4(), turf_id=turf.id, name=req.name, sport=req.sport, format=req.format, capacity=req.capacity,
        is_indoor=req.is_indoor, has_camera=req.has_camera,
        camera_price_paise=req.camera_price_paise if req.has_camera else 0,
        price_per_hour_paise=req.price_per_hour_paise, peak_price_per_hour_paise=req.peak_price_per_hour_paise,
        is_active=req.is_active,
    )
    pitch.turf = turf
    db.add(pitch)
    await db.flush([pitch])
    created = await generate_slots_for_pitch(db, pitch, days=14) if pitch.is_active else 0
    await _audit(db, ctx, "pitch.create", f"Added pitch {pitch.name} at {turf.name}", target_type="pitch",
                 target_id=pitch.id, changes={"sport": req.sport, "format": req.format, "slots": created,
                                              "price": req.price_per_hour_paise, "peak": req.peak_price_per_hour_paise})
    await db.commit()
    return pitch_out(pitch)


async def update_pitch(db: AsyncSession, ctx: PartnerContext, pitch_id: uuid.UUID, req: PitchUpdate) -> PitchOut:
    pitch = await get_pitch(db, ctx, pitch_id)
    fields = req.model_dump(exclude_unset=True, exclude={"apply_to_future_slots"})
    fields = {k: v for k, v in fields.items() if v is not None}
    _check_pitch(fields.get("sport", pitch.sport), fields.get("format", pitch.format),
                 fields.get("has_camera", pitch.has_camera), fields.get("camera_price_paise", pitch.camera_price_paise))
    before = {k: getattr(pitch, k) for k in fields}
    for k, v in fields.items():
        setattr(pitch, k, v)
    if not pitch.has_camera:
        pitch.camera_price_paise = 0
    changes = audit.diff(before, fields)
    repriced = 0
    if req.apply_to_future_slots:
        result = await db.execute(
            update(Slot)
            .where(Slot.pitch_id == pitch.id, Slot.status == "available", Slot.start_at > utcnow())
            .values(price_paise=case((Slot.is_peak.is_(True), pitch.peak_price_per_hour_paise),
                                     else_=pitch.price_per_hour_paise),
                    updated_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        )
        repriced = max(result.rowcount or 0, 0)
    if "is_active" in changes and pitch.is_active:
        await db.flush()
        await generate_slots_for_pitch(db, pitch)
    if changes or repriced:
        await _audit(db, ctx, "pitch.update", f"Updated pitch {pitch.name} ({', '.join(changes) or 'prices'})",
                     target_type="pitch", target_id=pitch.id, changes={**changes, "repriced_slots": repriced})
    await db.commit()
    return pitch_out(pitch)
