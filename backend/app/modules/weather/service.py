"""Weather-smart rescheduling (FEATURE_ANALYSIS §6).

* Forecast: Open-Meteo hourly (UTC) per venue coordinate, cached in Redis by coordinates rounded to
  2 dp for `weather_cache_seconds`. Network/parse failures degrade to "no data" (never raise).
* Risk: precipitation probability ≥ 60 % or ≥ 2 mm/h anywhere in the slot window → alert;
  ≥ 80 % or ≥ 5 mm/h → `warning`, else `watch`.
* Host options: transfer to an indoor pitch (same sport, ≤ 10 km, kickoff ±1 h, price delta ≤ ₹200 which
  Pytch covers), rain-check (100 % credits + ₹25 bonus each) or dismiss.
"""

import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import orjson
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, Conflict, Forbidden, NotFound
from app.core.geo import haversine_sql
from app.core.logging import logger
from app.core.redis import get_redis
from app.core.timeutils import ist_day_bounds, to_ist, utcnow
from app.modules.gamification.catalog import XP
from app.modules.gamification.models import XpEvent
from app.modules.gamification.service import award_xp
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify
from app.modules.platform import service as platform
from app.modules.slots.models import Slot
from app.modules.turfs.availability import venue_open_clause
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User
from app.modules.weather.models import WeatherAlert
from app.modules.weather.schemas import HourWeather, TransferAlternative, WeatherAlertOut
from app.realtime.publisher import lobby_channel, publish_on_commit

CACHE_PREFIX = "pytch:weather:v1:"
FAILURE_CACHE_SECONDS = 120
WARNING_PROB = 80
WARNING_MM = 5.0
TRANSFER_WINDOW = timedelta(hours=1)
MAX_ALTERNATIVES = 10
ACTIVE = ("joined", "paid")
SCANNABLE_STATUSES = ("forming", "confirmed")


class SlotUnavailable(AppError):
    code, status_code, message = "SLOT_UNAVAILABLE", 409, "That slot was just taken — pick another one"


class LobbyClosed(AppError):
    code, status_code, message = "LOBBY_CLOSED", 409, "This match can no longer be changed"


class NotMember(AppError):
    code, status_code, message = "NOT_MEMBER", 403, "You're not in this match"


class InvalidAlternative(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "That slot isn't a valid indoor alternative"


# ───────────────────────────── risk rules ─────────────────────────────
def is_risky(probability: float, mm: float) -> bool:
    return probability >= settings.weather_prob_threshold or mm >= settings.weather_mm_threshold


def severity_for(probability: float, mm: float) -> str:
    return "warning" if probability >= WARNING_PROB or mm >= WARNING_MM else "watch"


def make_hour(time: datetime, temperature_c: float, probability: float, mm: float, code: int) -> HourWeather:
    probability = int(round(probability))
    mm = round(float(mm), 1)
    return HourWeather(
        time=time,
        temperature_c=round(float(temperature_c), 1),
        precipitation_probability=probability,
        precipitation_mm=mm,
        weather_code=int(code),
        is_risky=is_risky(probability, mm),
    )


# ───────────────────────────── Open-Meteo client ─────────────────────────────
async def _request_forecast(lat: float, lng: float) -> dict[str, Any]:
    """Raw Open-Meteo call (monkeypatched in tests)."""
    params = {
        "latitude": f"{lat:.2f}",
        "longitude": f"{lng:.2f}",
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
        "timezone": "UTC",
        "forecast_days": 7,
        "past_days": 1,  # UTC data starts at 00:00Z; IST days begin at 18:30Z the day before
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0)) as client:
        response = await client.get(settings.weather_api_url, params=params)
        response.raise_for_status()
        return response.json()


def _parse_hourly(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    temps = hourly.get("temperature_2m") or []
    probs = hourly.get("precipitation_probability") or []
    mms = hourly.get("precipitation") or []
    codes = hourly.get("weather_code") or []

    def at(seq: list, i: int, default: float = 0.0) -> float:
        value = seq[i] if i < len(seq) else None
        return default if value is None else value

    out = []
    for i, raw in enumerate(times):
        ts = datetime.fromisoformat(raw)
        ts = ts.replace(tzinfo=UTC) if ts.tzinfo is None else ts.astimezone(UTC)
        out.append(
            {
                "t": ts.isoformat(),
                "temp": at(temps, i, 27.0),
                "p": at(probs, i),
                "mm": at(mms, i),
                "code": int(at(codes, i)),
            }
        )
    return out


async def hourly_forecast(lat: float, lng: float) -> list[dict[str, Any]]:
    """Hourly UTC buckets `{t, temp, p, mm, code}`; [] when unavailable."""
    key = f"{CACHE_PREFIX}{lat:.2f}:{lng:.2f}"
    redis = get_redis()
    try:
        cached = await redis.get(key)
        if cached is not None:
            return orjson.loads(cached)
    except Exception:
        logger.warning("weather: redis cache read failed", exc_info=True)
    ttl = settings.weather_cache_seconds
    try:
        hours = _parse_hourly(await _request_forecast(lat, lng))
    except Exception as exc:
        logger.warning("weather: forecast fetch failed for %.2f,%.2f: %s", lat, lng, exc)
        hours, ttl = [], FAILURE_CACHE_SECONDS
    try:
        await redis.set(key, orjson.dumps(hours), ex=ttl)
    except Exception:
        logger.warning("weather: redis cache write failed", exc_info=True)
    return hours


def window_weather(hours: Sequence[dict[str, Any]], start: datetime, end: datetime) -> HourWeather | None:
    """Aggregate the hourly buckets overlapping [start, end): worst-case rain, mean temperature."""
    picked = []
    for h in hours:
        t = datetime.fromisoformat(h["t"])
        if t < end and t + timedelta(hours=1) > start:
            picked.append(h)
    if not picked:
        return None
    return make_hour(
        start,
        sum(h["temp"] for h in picked) / len(picked),
        max(h["p"] for h in picked),
        max(h["mm"] for h in picked),
        max(h["code"] for h in picked),
    )


async def forecast_day(lat: float, lng: float, day: date) -> list[HourWeather]:
    """24 IST-hour entries for `day` (fewer / none outside the forecast horizon)."""
    hours = await hourly_forecast(lat, lng)
    if not hours:
        return []
    day_start, _ = ist_day_bounds(day)
    out = []
    for i in range(24):
        start = day_start + timedelta(hours=i)
        hw = window_weather(hours, start, start + timedelta(hours=1))
        if hw is not None:
            out.append(hw)
    return out


async def forecast_for_slots(pitch: Pitch, slots: Iterable[Slot]) -> dict[uuid.UUID, HourWeather]:
    """Weather per slot for outdoor pitches (used by GET /pitches/{id}/slots)."""
    slots = list(slots)
    if pitch.is_indoor or not slots:
        return {}
    turf = pitch.__dict__.get("turf")  # never trigger an implicit (sync) lazy load in async code
    if turf is None:
        return {}
    hours = await hourly_forecast(turf.lat, turf.lng)
    if not hours:
        return {}
    out: dict[uuid.UUID, HourWeather] = {}
    for slot in slots:
        hw = window_weather(hours, slot.start_at, slot.end_at)
        if hw is not None:
            out[slot.id] = hw
    return out


# ───────────────────────────── alerts ─────────────────────────────
def _time_label(dt: datetime) -> str:
    local = to_ist(dt)
    return local.strftime("%-I %p") if local.minute == 0 else local.strftime("%-I:%M %p")


def alert_summary(probability: int, mm: float, start_at: datetime) -> str:
    when = _time_label(start_at)
    if severity_for(probability, mm) == "warning":
        text = f"Heavy rain likely ({probability}%) during your {when} game"
    else:
        text = f"Rain possible ({probability}%) during your {when} game"
    if mm >= settings.weather_mm_threshold:
        text += f" · {mm:.1f} mm/h"
    return text


def alert_out(alert: WeatherAlert, viewer_id: uuid.UUID | None) -> WeatherAlertOut:
    lobby = alert.lobby
    return WeatherAlertOut(
        id=alert.id,
        lobby_id=alert.lobby_id,
        booking_id=alert.booking_id,
        lobby_title=lobby.title,
        turf_name=lobby.turf.name,
        pitch_name=lobby.pitch.name,
        start_at=lobby.start_at,
        precipitation_probability=alert.precipitation_probability,
        precipitation_mm=round(alert.precipitation_mm, 1),
        summary=alert.summary,
        severity=alert.severity,  # type: ignore[arg-type]
        status=alert.status,  # type: ignore[arg-type]
        is_host=viewer_id is not None and lobby.host_id == viewer_id,
        created_at=alert.created_at,
    )


def _active_user_ids(lobby: Lobby) -> list[uuid.UUID]:
    return [m.user_id for m in lobby.members if m.status in ACTIVE]


def _publish_weather(db: AsyncSession, lobby_id: uuid.UUID) -> None:
    payload = {"lobby_id": str(lobby_id), "reason": "weather", "actor": None}
    publish_on_commit(db, lobby_channel(lobby_id), "lobby.updated", payload)


async def create_alert(
    db: AsyncSession, lobby: Lobby, *, probability: int, mm: float, forecast_for: datetime | None = None
) -> WeatherAlert:
    """Persist an open alert, notify every member and invalidate the lobby. Caller commits."""
    now = utcnow()
    alert = WeatherAlert(
        id=uuid.uuid4(),
        lobby_id=lobby.id,
        booking_id=lobby.booking_id,
        forecast_for=forecast_for or lobby.start_at,
        precipitation_probability=int(probability),
        precipitation_mm=round(float(mm), 1),
        summary=alert_summary(int(probability), float(mm), lobby.start_at),
        severity=severity_for(probability, mm),
        status="open",
        created_at=now,
    )
    alert.lobby = lobby
    db.add(alert)
    data = {"alert_id": alert.id, "lobby_id": lobby.id, "url": f"/app/weather/{alert.id}"}
    icon = "⛈️" if alert.severity == "warning" else "🌧️"
    for uid in set(_active_user_ids(lobby)) | {lobby.host_id}:
        if uid == lobby.host_id:
            body = f"{alert.summary}. Move indoors or rain-check in one tap."
        else:
            body = f"{alert.summary}. Your host can move the game indoors or rain-check it."
        await notify(db, uid, "weather_alert", f"{icon} Rain alert · {lobby.title}", body, data)
    _publish_weather(db, lobby.id)
    return alert


async def open_alert_for_lobby(db: AsyncSession, lobby: Lobby, viewer: User | None) -> WeatherAlertOut | None:
    alert = await db.scalar(
        select(WeatherAlert)
        .where(WeatherAlert.lobby_id == lobby.id, WeatherAlert.status == "open")
        .order_by(WeatherAlert.created_at.desc())
        .limit(1)
    )
    return alert_out(alert, viewer.id if viewer else None) if alert else None


async def my_open_alerts(db: AsyncSession, user: User) -> list[WeatherAlertOut]:
    alerts = (
        await db.scalars(
            select(WeatherAlert)
            .join(LobbyMember, LobbyMember.lobby_id == WeatherAlert.lobby_id)
            .where(
                WeatherAlert.status == "open",
                LobbyMember.user_id == user.id,
                LobbyMember.status.in_(ACTIVE),
            )
            .order_by(WeatherAlert.created_at.desc())
        )
    ).unique().all()
    return [alert_out(a, user.id) for a in alerts]


async def _get_alert(db: AsyncSession, alert_id: uuid.UUID, *, for_update: bool = False) -> WeatherAlert:
    query = select(WeatherAlert).where(WeatherAlert.id == alert_id)
    if for_update:
        query = query.with_for_update(of=WeatherAlert)
    alert = await db.scalar(query)
    if alert is None:
        raise NotFound("Weather alert not found")
    return alert


def _is_participant(lobby: Lobby, user_id: uuid.UUID) -> bool:
    return lobby.host_id == user_id or user_id in _active_user_ids(lobby)


async def get_alert(db: AsyncSession, alert_id: uuid.UUID, user: User) -> WeatherAlertOut:
    alert = await _get_alert(db, alert_id)
    if not _is_participant(alert.lobby, user.id):
        raise NotMember()
    return alert_out(alert, user.id)


def _require_host_open(alert: WeatherAlert, user: User) -> Lobby:
    lobby = alert.lobby
    if lobby.host_id != user.id:
        raise Forbidden("Only the host can decide what happens with the rain")
    if alert.status != "open":
        raise Conflict("This alert has already been resolved")
    if lobby.status not in SCANNABLE_STATUSES or lobby.start_at <= utcnow():
        raise LobbyClosed()
    return lobby


# ───────────────────────────── transfer alternatives ─────────────────────────────
async def _alternative_rows(db: AsyncSession, lobby: Lobby, old_price: int, *, slot_id: uuid.UUID | None = None):
    origin = lobby.turf
    distance = haversine_sql(Turf.lat, Turf.lng, origin.lat, origin.lng)
    duration = lobby.end_at - lobby.start_at
    cover = await platform.get_setting("rain_transfer_cover_paise", db)
    query = (
        select(Slot, Pitch, Turf, distance.label("distance_km"))
        .join(Pitch, Slot.pitch_id == Pitch.id)
        .join(Turf, Pitch.turf_id == Turf.id)
        .where(
            Pitch.is_indoor.is_(True),
            Pitch.is_active.is_(True),
            venue_open_clause(),
            Pitch.sport == lobby.sport,
            Pitch.id != lobby.pitch_id,
            Pitch.capacity + 4 >= lobby.total_spots,
            Slot.start_at >= lobby.start_at - TRANSFER_WINDOW,
            Slot.start_at <= lobby.start_at + TRANSFER_WINDOW,
            Slot.start_at > utcnow(),
            Slot.end_at - Slot.start_at == duration,
            Slot.price_paise - old_price <= cover,
            distance <= settings.rain_transfer_radius_km,
        )
    )
    if lobby.recorded:  # the group paid for a highlight reel — only move it somewhere with a camera
        query = query.where(Pitch.has_camera.is_(True))
    if slot_id is not None:
        query = query.where(Slot.id == slot_id)
    else:
        query = query.where(Slot.status == "available")
    query = query.order_by(
        distance,
        func.abs(func.extract("epoch", Slot.start_at) - lobby.start_at.timestamp()),
        Slot.price_paise,
    ).limit(MAX_ALTERNATIVES * 4)
    rows = (await db.execute(query)).unique().all()
    # One option per pitch — the closest kickoff to the original — so venues don't repeat.
    best: dict[uuid.UUID, Any] = {}
    for row in rows:
        best.setdefault(row[1].id, row)
    return list(best.values())[:MAX_ALTERNATIVES]


async def _old_price(db: AsyncSession, lobby: Lobby) -> int:
    price = await db.scalar(select(Slot.price_paise).where(Slot.id == lobby.slot_id))
    return int(price if price is not None else lobby.booking.pitch_fee_paise)


async def alternatives(db: AsyncSession, alert_id: uuid.UUID, user: User) -> list[TransferAlternative]:
    from app.modules.slots.service import slot_out
    from app.modules.turfs.service import pitch_out, turf_summary

    alert = await _get_alert(db, alert_id)
    lobby = _require_host_open(alert, user)
    old_price = await _old_price(db, lobby)
    rows = await _alternative_rows(db, lobby, old_price)
    summaries: dict[uuid.UUID, Any] = {}
    out: list[TransferAlternative] = []
    for slot, pitch, turf, distance_km in rows:
        if turf.id not in summaries:
            summaries[turf.id] = await turf_summary(db, turf, lat=lobby.turf.lat, lng=lobby.turf.lng)
        diff = slot.price_paise - old_price
        out.append(
            TransferAlternative(
                slot=slot_out(slot),
                pitch=pitch_out(pitch),
                turf=summaries[turf.id],
                distance_km=round(float(distance_km), 2),
                price_diff_paise=diff,
                covered_by_pytch=diff > 0,
            )
        )
    return out


async def transfer(db: AsyncSession, alert_id: uuid.UUID, user: User, slot_id: uuid.UUID):
    from app.modules.lobbies import service as lobbies
    from app.modules.slots.service import lock_slot

    alert = await _get_alert(db, alert_id, for_update=True)
    lobby = _require_host_open(alert, user)
    old_price = await _old_price(db, lobby)
    new_slot = await lock_slot(db, slot_id)  # FOR UPDATE NOWAIT → SLOT_LOCKED / NOT_FOUND
    if new_slot.status != "available":
        raise SlotUnavailable()
    if not await _alternative_rows(db, lobby, old_price, slot_id=new_slot.id):
        raise InvalidAlternative()

    await lobbies.transfer_to_slot(db, lobby, new_slot)
    alert.status = "transferred"
    alert.resolved_at = utcnow()

    new_pitch = await db.get(Pitch, new_slot.pitch_id)
    venue = f"{new_pitch.turf.name} · {new_pitch.name}" if new_pitch else "an indoor pitch"
    members = lobbies.active_members(lobby)
    member_ids = {m.user_id for m in members} | {lobby.host_id}
    data = {"lobby_id": lobby.id, "url": f"/app/lobby/{lobby.id}"}
    for uid in member_ids:
        await notify(
            db, uid, "match_transferred", f"☔ Moved indoors · {lobby.title}",
            f"Rain dodged! Same kick-off, new venue: {venue}. No extra cost for you.", data,
        )
    await award_xp(db, lobby.host_id, XP.WEATHER_SAVE, f"Saved {lobby.title} from the rain", lobby.id)
    _publish_weather(db, lobby.id)
    await db.commit()
    await db.refresh(lobby)
    return await lobbies.lobby_detail(db, lobby, user)


RAIN_CHECK_XP_PREFIX = "Rain-checked"
WEATHER_XP_PREFIXES = (RAIN_CHECK_XP_PREFIX, "Saved ")  # rain-check / transfer
RAIN_CHECK_XP_DAILY_CAP = 2


async def _weather_xp_given(db: AsyncSession, lobby: Lobby) -> bool:
    """Host already got weather-save XP for this lobby, or hit today's rain-check XP cap."""
    await db.flush()
    is_weather = or_(*(XpEvent.reason.startswith(p) for p in WEATHER_XP_PREFIXES))
    if await db.scalar(select(exists().where(XpEvent.user_id == lobby.host_id, XpEvent.ref_id == lobby.id,
                                             is_weather))):
        return True
    day_start, _ = ist_day_bounds(to_ist(utcnow()).date())
    today = await db.scalar(select(func.count()).select_from(XpEvent).where(
        XpEvent.user_id == lobby.host_id, XpEvent.reason.startswith(RAIN_CHECK_XP_PREFIX),
        XpEvent.created_at >= day_start))
    return int(today or 0) >= RAIN_CHECK_XP_DAILY_CAP


async def rain_check(db: AsyncSession, alert_id: uuid.UUID, user: User):
    from app.modules.lobbies import service as lobbies
    from app.modules.lobbies.detail_schemas import RainCheckResponse

    alert = await _get_alert(db, alert_id, for_update=True)
    lobby = _require_host_open(alert, user)
    # resolve first so our own `lobby.cancelled` handler doesn't expire it
    alert.status = "rain_checked"
    alert.resolved_at = utcnow()
    # rain bonus: only paid non-host players, only if ≥ 2 distinct players paid, daily-capped (lobbies)
    total = await lobbies.cancel_lobby(
        db,
        lobby,
        refund_kind="rain_check",
        bonus_paise=await platform.get_setting("rain_bonus_paise", db),
        note=f"Rain-check · {lobby.title}",
    )
    payers = {m.user_id for m in lobbies.active_members(lobby) if m.status == "paid"}
    if len(payers - {lobby.host_id}) >= 1 and not await _weather_xp_given(db, lobby):
        # host XP: once per lobby, and never for a match only the host paid for (solo farming)
        await award_xp(db, lobby.host_id, XP.WEATHER_SAVE, f"{RAIN_CHECK_XP_PREFIX} {lobby.title}"[:80], lobby.id)
    _publish_weather(db, lobby.id)
    await db.commit()
    await db.refresh(lobby)
    return RainCheckResponse(refunded_paise_total=total, lobby=await lobbies.lobby_detail(db, lobby, user))


async def dismiss(db: AsyncSession, alert_id: uuid.UUID, user: User) -> WeatherAlertOut:
    from app.modules.lobbies import service as lobbies

    alert = await _get_alert(db, alert_id, for_update=True)
    lobby = _require_host_open(alert, user)
    alert.status = "dismissed"
    alert.resolved_at = utcnow()
    await lobbies.post_system_message(db, lobby.id, "🌧️ Host says: we play on, rain or shine. Bring a towel!")
    _publish_weather(db, lobby.id)
    await db.commit()
    return alert_out(alert, user.id)


# ───────────────────────────── lifecycle ─────────────────────────────
async def close_open_alerts(db: AsyncSession, lobby_id: uuid.UUID, status: str = "expired") -> int:
    alerts = (
        await db.scalars(
            select(WeatherAlert).where(WeatherAlert.lobby_id == lobby_id, WeatherAlert.status == "open")
        )
    ).all()
    now = utcnow()
    for alert in alerts:
        alert.status = status
        alert.resolved_at = now
    return len(alerts)


async def expire_past_alerts(db: AsyncSession) -> int:
    now = utcnow()
    alerts = (
        await db.scalars(
            select(WeatherAlert)
            .join(Lobby, Lobby.id == WeatherAlert.lobby_id)
            .where(WeatherAlert.status == "open", Lobby.start_at <= now)
        )
    ).unique().all()
    for alert in alerts:
        alert.status = "expired"
        alert.resolved_at = now
    return len(alerts)


async def scan_lobbies(db: AsyncSession) -> int:
    """Create alerts for risky outdoor games in the scan horizon. Caller commits."""
    now = utcnow()
    horizon = now + timedelta(hours=settings.weather_scan_horizon_hours)
    already = exists().where(
        and_(
            WeatherAlert.lobby_id == Lobby.id,
            (WeatherAlert.status == "open") | (WeatherAlert.forecast_for == Lobby.start_at),
        )
    )
    lobbies = (
        await db.scalars(
            select(Lobby)
            .join(Pitch, Pitch.id == Lobby.pitch_id)
            .where(
                Lobby.status.in_(SCANNABLE_STATUSES),
                Lobby.start_at > now,
                Lobby.start_at <= horizon,
                Pitch.is_indoor.is_(False),
                ~already,
            )
            .order_by(Lobby.start_at)
        )
    ).unique().all()
    created = 0
    by_coords: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for lobby in lobbies:
        coords = (round(lobby.turf.lat, 2), round(lobby.turf.lng, 2))
        if coords not in by_coords:
            by_coords[coords] = await hourly_forecast(lobby.turf.lat, lobby.turf.lng)
        hw = window_weather(by_coords[coords], lobby.start_at, lobby.end_at)
        if hw is None or not hw.is_risky:
            continue
        await create_alert(db, lobby, probability=hw.precipitation_probability, mm=hw.precipitation_mm)
        created += 1
    return created
