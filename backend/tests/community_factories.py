"""ORM factories for the community-module tests (turfs, slots, lobbies built directly)."""

import math
import uuid
from datetime import datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.codes import booking_code, short_code
from app.core.timeutils import utcnow
from app.modules.bookings.models import Booking
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User

KOCHI = (9.9672, 76.3205)


def hour_from_now(hours: float) -> datetime:
    now = utcnow().replace(minute=0, second=0, microsecond=0)
    return now + timedelta(hours=hours)


async def make_pitch(
    db: AsyncSession,
    *,
    name: str = "Test Arena",
    lat: float = KOCHI[0],
    lng: float = KOCHI[1],
    sport: str = "football",
    fmt: str = "5v5",
    capacity: int = 10,
    indoor: bool = False,
    camera_fee: int = 0,
    price: int = 150000,
    peak: int | None = None,
) -> Pitch:
    turf = Turf(
        id=uuid.uuid4(), slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}", name=name, area="Vyttila",
        address="Somewhere in Kochi", lat=lat, lng=lng, open_time=time(6), close_time=time(23),
    )
    pitch = Pitch(
        id=uuid.uuid4(), name=f"{name} pitch", sport=sport, format=fmt, capacity=capacity, is_indoor=indoor,
        has_camera=camera_fee > 0, camera_price_paise=camera_fee, price_per_hour_paise=price,
        peak_price_per_hour_paise=peak or price,
    )
    pitch.turf = turf
    db.add_all([turf, pitch])
    await db.commit()
    return pitch


async def make_slot(
    db: AsyncSession, pitch: Pitch, start: datetime, *, status: str = "available", price: int | None = None
) -> Slot:
    slot = Slot(
        id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
        price_paise=price if price is not None else pitch.price_per_hour_paise, status=status,
    )
    db.add(slot)
    await db.commit()
    return slot


async def make_lobby(
    db: AsyncSession,
    pitch: Pitch,
    host: User,
    players: list[User],
    *,
    start: datetime,
    status: str = "confirmed",
    mode: str = "split",
    total_spots: int = 10,
    recorded: bool = False,
    completed_at: datetime | None = None,
    min_true_skill: float | None = None,
    verified_only: bool = False,
    member_status: str = "paid",
    title: str = "Test Fives",
) -> Lobby:
    slot = Slot(
        id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
        price_paise=pitch.price_per_hour_paise, status="held" if status == "forming" else "booked",
    )
    db.add(slot)
    await db.flush()
    total = slot.price_paise + (pitch.camera_price_paise if recorded else 0)
    share = math.ceil(total / total_spots / 100) * 100
    now = utcnow()
    booking = Booking(
        id=uuid.uuid4(), code=booking_code(), slot_id=slot.id, host_id=host.id, mode=mode,
        status={"forming": "pending_payment", "confirmed": "confirmed", "completed": "completed"}.get(status, status),
        pitch_fee_paise=slot.price_paise, recording_fee_paise=total - slot.price_paise, total_paise=total,
        recorded=recorded, confirmed_at=None if status == "forming" else now,
    )
    db.add(booking)
    await db.flush()
    slot.booking_id = booking.id
    lobby = Lobby(
        id=uuid.uuid4(), code=short_code(6), booking_id=booking.id, slot_id=slot.id, pitch_id=pitch.id,
        turf_id=pitch.turf_id, host_id=host.id, title=title, sport=pitch.sport, format=pitch.format, mode=mode,
        visibility="public", status=status, total_spots=total_spots, share_paise=share,
        pay_deadline=now + timedelta(minutes=30) if status == "forming" else None, start_at=slot.start_at,
        end_at=slot.end_at, min_true_skill=min_true_skill, verified_only=verified_only, recorded=recorded,
        confirmed_at=None if status == "forming" else now,
        completed_at=completed_at if status == "completed" else None,
    )
    db.add(lobby)
    await db.flush()
    for i, user in enumerate([host, *players]):
        db.add(LobbyMember(
            id=uuid.uuid4(), lobby_id=lobby.id, user_id=user.id, role="host" if i == 0 else "player",
            status=member_status if i else "paid", share_paise=share,
            paid_paise=share if (member_status == "paid" or i == 0) else 0,
            joined_at=now - timedelta(minutes=30 - i), paid_at=now - timedelta(minutes=29 - i),
        ))
    await db.commit()
    return await reload_lobby(db, lobby.id)


async def reload_lobby(db: AsyncSession, lobby_id: uuid.UUID) -> Lobby:
    return (
        await db.execute(select(Lobby).where(Lobby.id == lobby_id).execution_options(populate_existing=True))
    ).unique().scalar_one()


async def make_users(make_user, n: int, prefix: str = "Player", **fields) -> list[User]:
    return [await make_user(f"{prefix} {i}", **fields) for i in range(n)]
