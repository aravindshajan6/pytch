"""Demo controls for the community features (mounted under /dev with the demo-mode guard).

    POST /dev/lobbies/{id}/storm   → open "warning" weather alert for the lobby (even on indoor pitches)
    POST /dev/sos-near-me          → bot-hosted confirmed match near me, one seat short, with an open SOS
"""

import math
import random
import uuid
from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.codes import booking_code, short_code
from app.core.config import settings
from app.core.deps import DB, CurrentUser
from app.core.errors import AppError, Conflict, NotFound
from app.core.geo import haversine_sql
from app.core.timeutils import IST, to_ist, utcnow
from app.modules.bench import service as bench
from app.modules.bench.models import BenchStatus
from app.modules.bench.schemas import SOSRequestOut
from app.modules.bookings.models import Booking
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import PlayerStats, User
from app.modules.weather import service as weather
from app.modules.weather.models import WeatherAlert
from app.modules.weather.schemas import WeatherAlertOut

router = APIRouter()

BOT_PHONE_PREFIX = "+91888000"
BOT_NAMES = [
    "Anand Pillai", "Sreejith Nair", "Vishnu Das", "Midhun Raj", "Akhil Varghese", "Jithin Thomas",
    "Nikhil Menon", "Rahul Krishnan", "Aswin Kumar", "Faisal Rahman", "Sanju Joseph", "Arun Mohan",
    "Deepak Varma", "Harikrishnan S", "Jomon Kurian", "Basil Paul",
]
SOS_TITLES = ["Sunset 5s — one short!", "After-work kickabout", "Floodlit fives", "Evening 7s, need a sub"]
POSITIONS = ["Forward", "Midfielder", "Defender", "Goalkeeper", "Winger"]


class NotMember(AppError):
    code, status_code, message = "NOT_MEMBER", 403, "You're not in this match"


# ───────────────────────────── storm ─────────────────────────────
async def create_storm(db: AsyncSession, lobby_id: uuid.UUID, user: User) -> WeatherAlertOut:
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None:
        raise NotFound("Match not found")
    active = {m.user_id for m in lobby.members if m.status in ("joined", "paid")} | {lobby.host_id}
    if user.id not in active:
        raise NotMember()
    if lobby.status not in ("forming", "confirmed") or lobby.start_at <= utcnow():
        raise Conflict("Storms can only hit upcoming matches", code="LOBBY_CLOSED")
    existing = await db.scalar(
        select(WeatherAlert).where(WeatherAlert.lobby_id == lobby.id, WeatherAlert.status == "open").limit(1)
    )
    if existing is not None:
        return weather.alert_out(existing, user.id)
    rng = random.Random()
    alert = await weather.create_alert(
        db, lobby, probability=rng.randint(84, 94), mm=round(rng.uniform(5.5, 9.5), 1), forecast_for=lobby.start_at
    )
    await db.commit()
    return weather.alert_out(alert, user.id)


@router.post("/lobbies/{lobby_id}/storm", response_model=WeatherAlertOut)
async def storm(lobby_id: uuid.UUID, db: DB, user: CurrentUser) -> WeatherAlertOut:
    return await create_storm(db, lobby_id, user)


# ───────────────────────────── sos near me ─────────────────────────────
async def bot_pool(db: AsyncSession, count: int, *, exclude: set[uuid.UUID] | None = None) -> list[User]:
    """Reuse existing bot accounts, creating fictional ones as needed. Caller commits."""
    exclude = exclude or set()
    bots = [
        b
        for b in (await db.scalars(select(User).where(User.is_bot.is_(True)).order_by(User.created_at))).unique().all()
        if b.id not in exclude
    ]
    rng = random.Random()
    next_idx = int(
        await db.scalar(select(func.count()).select_from(User).where(User.phone.startswith(BOT_PHONE_PREFIX))) or 0
    )
    while len(bots) < count:
        next_idx += 1
        name = BOT_NAMES[next_idx % len(BOT_NAMES)]
        phone = f"{BOT_PHONE_PREFIX}{next_idx:04d}"
        if await db.scalar(select(User.id).where(User.phone == phone)):
            continue
        user = User(
            id=uuid.uuid4(), phone=phone, name=name, is_bot=True, onboarded=True,
            preferred_sports=["football"], position=rng.choice(POSITIONS), home_area="Kochi",
        )
        user.stats = PlayerStats(user_id=user.id)
        db.add(user)
        bots.append(user)
    await db.flush()
    rng.shuffle(bots)
    return bots[:count]


async def _unique_lobby_code(db: AsyncSession) -> str:
    while True:
        code = short_code(6)
        if not await db.scalar(select(Lobby.id).where(Lobby.code == code)):
            return code


async def _unique_booking_code(db: AsyncSession) -> str:
    while True:
        code = booking_code()
        if not await db.scalar(select(Booking.id).where(Booking.code == code)):
            return code


def _next_hour(dt: datetime) -> datetime:
    local = to_ist(dt)
    base = datetime.combine(local.date(), time(local.hour), tzinfo=IST)
    if base < local:
        base += timedelta(hours=1)
    return base.astimezone(UTC)


async def _find_or_make_slot(db: AsyncSession, lat: float, lng: float) -> Slot:
    now = utcnow()
    target = now + timedelta(minutes=90)
    distance = haversine_sql(Turf.lat, Turf.lng, lat, lng)
    slot = (
        await db.execute(
            select(Slot)
            .join(Pitch, Pitch.id == Slot.pitch_id)
            .join(Turf, Turf.id == Pitch.turf_id)
            .where(
                Pitch.sport == "football",
                Pitch.is_active.is_(True),
                Turf.is_active.is_(True),
                Slot.status == "available",
                Slot.start_at >= now + timedelta(minutes=60),
                Slot.start_at <= now + timedelta(minutes=150),
            )
            .order_by(distance, func.abs(func.extract("epoch", Slot.start_at) - target.timestamp()))
            .limit(1)
            .with_for_update(of=Slot, skip_locked=True)
        )
    ).unique().scalar_one_or_none()
    if slot is not None:
        return slot
    # Late at night (or no generated slots): conjure a one-off slot on the nearest football pitch.
    pitch = (
        await db.execute(
            select(Pitch)
            .join(Turf, Turf.id == Pitch.turf_id)
            .where(Pitch.sport == "football", Pitch.is_active.is_(True), Turf.is_active.is_(True))
            .order_by(distance)
            .limit(1)
        )
    ).unique().scalar_one_or_none()
    if pitch is None:
        raise NotFound("No football pitches exist yet — run the seed first")
    start = _next_hour(now + timedelta(minutes=75))
    for _ in range(6):
        taken = await db.scalar(select(Slot).where(Slot.pitch_id == pitch.id, Slot.start_at == start))
        if taken is None:
            peak = to_ist(start).weekday() >= 5 or 17 <= to_ist(start).hour < 22
            slot = Slot(
                id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
                price_paise=pitch.peak_price_per_hour_paise if peak else pitch.price_per_hour_paise,
                is_peak=peak, status="available",
            )
            slot.pitch = pitch
            db.add(slot)
            await db.flush([slot])
            return slot
        if taken.status == "available":
            return taken
        start += timedelta(hours=1)
    raise Conflict("Couldn't find a free slot nearby for the demo")


async def spawn_sos_near(db: AsyncSession, user: User) -> SOSRequestOut:
    bench_row = await db.scalar(select(BenchStatus).where(BenchStatus.user_id == user.id))
    origin = bench._origin_for(user, bench_row) or (settings.city_center_lat, settings.city_center_lng)
    sports = sorted(set(bench_row.sports if bench_row and bench_row.sports else []) | {"football"})
    await bench.activate_bench(db, user, lat=origin[0], lng=origin[1], sports=sports)

    slot = await _find_or_make_slot(db, *origin)
    pitch = await db.get(Pitch, slot.pitch_id)
    assert pitch is not None
    turf = pitch.turf
    total_spots = max(4, min(pitch.capacity, 14))
    bots = await bot_pool(db, total_spots, exclude={user.id})  # host + (total-2) players + 1 dropout
    host, players, dropout = bots[0], bots[1 : total_spots - 1], bots[total_spots - 1]
    now = utcnow()
    total = slot.price_paise
    share = math.ceil(total / total_spots / 100) * 100

    booking = Booking(
        id=uuid.uuid4(), code=await _unique_booking_code(db), slot_id=slot.id, host_id=host.id, mode="split",
        status="confirmed", pitch_fee_paise=total, recording_fee_paise=0, total_paise=total, recorded=False,
        confirmed_at=now - timedelta(minutes=40),
    )
    lobby = Lobby(
        id=uuid.uuid4(), code=await _unique_lobby_code(db), booking_id=booking.id, slot_id=slot.id,
        pitch_id=pitch.id, turf_id=turf.id, host_id=host.id, title=random.choice(SOS_TITLES), sport="football",
        format=pitch.format, mode="split", visibility="public", status="confirmed", total_spots=total_spots,
        share_paise=share, pay_deadline=None, start_at=slot.start_at, end_at=slot.end_at,
        verified_only=False, recorded=False, confirmed_at=now - timedelta(minutes=40),
        notes="Bibs provided. Friendly game, all levels welcome.",
    )
    db.add(booking)
    await db.flush([booking])
    db.add(lobby)
    await db.flush([lobby])
    slot.status, slot.booking_id, slot.held_until, slot.held_by_id = "booked", booking.id, None, None

    def member(u: User, role: str, minutes_ago: int, status: str = "paid") -> LobbyMember:
        joined = now - timedelta(minutes=minutes_ago)
        return LobbyMember(
            id=uuid.uuid4(), lobby_id=lobby.id, user_id=u.id, role=role, status=status,
            share_paise=share, paid_paise=share, joined_at=joined, paid_at=joined + timedelta(minutes=2),
            left_at=now - timedelta(minutes=3) if status == "left" else None,
        )

    rows = [member(host, "host", 70)]
    rows += [member(p, "player", 65 - i * 3) for i, p in enumerate(players)]
    rows.append(member(dropout, "player", 50, status="left"))
    db.add_all(rows)
    await db.flush()
    await db.refresh(lobby, attribute_names=["members"])

    sos, _ = await bench.create_or_merge_sos(
        db, lobby, reason="dropout", spots=1, created_by_id=None, force_user_ids=[user.id]
    )
    await bench._post(
        db, lobby.id, f"🚨 {dropout.name.split()[0]} dropped out. SOS sent to the bench ({sos.discount_pct}% off)."
    )
    await db.commit()
    return await bench.sos_out(db, sos, origin=origin)


@router.post("/sos-near-me", response_model=SOSRequestOut)
async def sos_near_me(db: DB, user: CurrentUser) -> SOSRequestOut:
    return await spawn_sos_near(db, user)
