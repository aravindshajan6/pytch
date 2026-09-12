"""Bookings: reserve a slot (row-locked) and open its match room in one transaction."""

import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.codes import booking_code, short_code
from app.core.config import settings
from app.core.constants import SPORTS
from app.core.errors import AppError, NotFound
from app.core.ratelimit import enforce
from app.core.timeutils import utcnow
from app.modules.bookings.models import Booking
from app.modules.bookings.schemas import BookingOut, CreateBookingRequest
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.detail_schemas import CreateBookingResponse, LobbyDetail
from app.modules.lobbies.errors import LobbyClosed, NotHost, TooLate
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.platform import service as platform
from app.modules.slots import service as slots
from app.modules.slots.models import Slot
from app.modules.turfs.availability import pitch_bookable
from app.modules.users.models import User

_SPORT_LABEL = {s["key"]: s["label"] for s in SPORTS}
MAX_FORMING = {"split": 2, "full": 1}  # concurrent unpaid (forming) lobbies a host may hold, by mode
BOOKING_RATE = (10, 600)  # bookings per user per 10 min


class InvalidBooking(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "Invalid booking request"


class BookingsPaused(AppError):
    code, status_code, message = "BOOKINGS_PAUSED", 503, "New bookings are paused right now — please try again soon"


class HoldLimitReached(AppError):
    code, status_code, message = "LIMIT_REACHED", 409, "You have too many unpaid bookings open"


async def _check_open_holds(db: AsyncSession, user: User, mode: str) -> None:
    """Each forming lobby holds a slot until it's paid or expires; a player may only hold a few at once
    (MAX_FORMING[mode]) so nobody can block a venue's calendar without paying. Takes a per-host
    transaction-level advisory lock first so parallel requests can't both pass the count."""
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"booking-host:{user.id}"))))
    open_now = int(await db.scalar(
        select(func.count()).select_from(Lobby).where(
            Lobby.host_id == user.id, Lobby.status == "forming", Lobby.mode == mode)
    ) or 0)
    cap = MAX_FORMING[mode]
    if open_now >= cap:
        kind = "split" if mode == "split" else "full-payment"
        raise HoldLimitReached(
            f"You already have {open_now} unpaid {kind} booking{'s' if open_now != 1 else ''} open — pay for or "
            f"cancel {'one' if open_now == 1 else 'them'} before booking another slot",
            details={"mode": mode, "open": open_now, "limit": cap})


def _default_title(slot: Slot) -> str:
    pitch = slot.pitch
    return f"{pitch.format} {_SPORT_LABEL.get(pitch.sport, pitch.sport.title())} · {pitch.turf.name}"[:80]


async def _validate(db: AsyncSession, slot: Slot, req: CreateBookingRequest) -> None:
    pitch = slot.pitch
    if not await pitch_bookable(db, pitch):  # inactive venue, suspended partner or disabled sport
        raise slots.SlotUnavailable()
    max_spots = pitch.capacity + 4
    if not 2 <= req.total_spots <= max_spots:
        raise InvalidBooking(f"Players must be between 2 and {max_spots} for this pitch",
                             details=[{"loc": ["body", "total_spots"], "msg": f"must be 2..{max_spots}"}])
    if req.recorded and not pitch.has_camera:
        raise InvalidBooking("This pitch has no camera — recording isn't available",
                             details=[{"loc": ["body", "recorded"], "msg": "pitch has no camera"}])


async def create_booking(db: AsyncSession, user: User, req: CreateBookingRequest) -> CreateBookingResponse:
    """Lock the slot (NOWAIT), create booking + lobby + host seat, hold the slot, commit.

    Split: slot held `split_window_minutes` for everyone to pay their share.
    Full : slot held `full_hold_minutes` for the host to pay the total.
    Kill switch: runtime setting `bookings_enabled=false` → 503 BOOKINGS_PAUSED.
    Abuse limits: ≤ MAX_FORMING open unpaid lobbies per host and mode → 409 LIMIT_REACHED;
    BOOKING_RATE per user → 429 RATE_LIMITED.
    """
    if not await platform.get_setting("bookings_enabled", db):
        raise BookingsPaused()
    await enforce(f"booking-create:{user.id}", *BOOKING_RATE, "Too many bookings in a short time — try again soon")
    await _check_open_holds(db, user, req.mode)
    slot = await slots.lock_slot(db, req.slot_id)
    if slot.status != "available":
        raise slots.SlotUnavailable()
    now = utcnow()
    if slot.start_at <= now:
        raise slots.SlotUnavailable("This slot has already started")
    await _validate(db, slot, req)
    pitch = slot.pitch

    pitch_fee = slot.price_paise
    recording_fee = pitch.camera_price_paise if req.recorded else 0
    total = pitch_fee + recording_fee
    share = lobbies.share_for(total, req.total_spots)
    window = (await platform.get_setting("split_window_minutes", db) if req.mode == "split"
              else settings.full_hold_minutes)
    deadline = min(now + timedelta(minutes=window), slot.start_at)

    booking = Booking(
        id=uuid.uuid4(),
        code=await lobbies.unique_code(db, Booking.code, booking_code),
        slot_id=slot.id,
        host_id=user.id,
        mode=req.mode,
        status="pending_payment",
        pitch_fee_paise=pitch_fee,
        recording_fee_paise=recording_fee,
        total_paise=total,
        recorded=req.recorded,
        expires_at=deadline,
        created_at=now,
        updated_at=now,
    )
    db.add(booking)
    await db.flush()

    lobby = Lobby(
        id=uuid.uuid4(),
        code=await lobbies.unique_code(db, Lobby.code, short_code),
        booking_id=booking.id,
        slot_id=slot.id,
        pitch_id=pitch.id,
        turf_id=pitch.turf_id,
        host_id=user.id,
        title=(req.title or "").strip() or _default_title(slot),
        sport=pitch.sport,
        format=pitch.format,
        mode=req.mode,
        visibility=req.visibility,
        status="forming",
        total_spots=req.total_spots,
        share_paise=share,
        pay_deadline=deadline,
        start_at=slot.start_at,
        end_at=slot.end_at,
        min_true_skill=req.min_true_skill,
        verified_only=req.verified_only,
        recorded=req.recorded,
        notes=req.notes,
        created_at=now,
        updated_at=now,
    )
    db.add(lobby)
    db.add(
        LobbyMember(
            id=uuid.uuid4(),
            lobby_id=lobby.id,
            user_id=user.id,
            role="host",
            status="joined",
            share_paise=total if req.mode == "full" else share,
            paid_paise=0,
            discount_paise=0,
            compensated_paise=0,
            joined_at=now,
        )
    )
    await db.flush()
    await slots.hold_slot(db, slot, user_id=user.id, until=deadline, booking_id=booking.id)
    await lobbies.post_system_message(
        db, lobby.id,
        f"🏟️ {user.name} booked {lobbies.kickoff_label(slot.start_at)} — "
        + (f"everyone pays their share within {window} min." if req.mode == "split"
           else "host is paying the full amount."),
    )
    await db.commit()

    lobby = await lobbies.get_lobby(db, lobby.id, refresh=True)
    detail = await lobbies.lobby_detail(db, lobby, user)
    return CreateBookingResponse(booking=detail.booking, lobby=detail)


async def _lobby_for_booking(db: AsyncSession, booking: Booking) -> Lobby | None:
    """The lobby that owns this booking — following transfers forward for superseded bookings."""
    current_id = booking.id
    for _ in range(10):
        lobby = (await db.execute(select(Lobby).where(Lobby.booking_id == current_id))).unique().scalar()
        if lobby is not None:
            return lobby
        current_id = await db.scalar(select(Booking.id).where(Booking.transferred_from_id == current_id))
        if current_id is None:
            return None
    return None


async def _booking_and_lobby(db: AsyncSession, user: User, booking_id: uuid.UUID) -> tuple[Booking, Lobby]:
    booking = await db.get(Booking, booking_id)
    lobby = await _lobby_for_booking(db, booking) if booking else None
    if booking is None or lobby is None:
        raise NotFound("Booking not found")
    if booking.host_id != user.id and lobbies.find_member(lobby, user.id) is None:
        raise NotFound("Booking not found")
    return booking, lobby


async def get_booking(db: AsyncSession, user: User, booking_id: uuid.UUID) -> BookingOut:
    booking, lobby = await _booking_and_lobby(db, user, booking_id)
    return lobbies.booking_out(booking, lobby)


async def cancel_booking(db: AsyncSession, user: User, booking_id: uuid.UUID) -> LobbyDetail:
    """Host cancels: everyone refunded as credits. Confirmed matches can't be cancelled < 6 h out."""
    booking, lobby = await _booking_and_lobby(db, user, booking_id)
    if booking.host_id != user.id:
        raise NotHost()
    lobby = await lobbies.get_lobby(db, lobby.id, for_update=True)
    if lobby.booking_id != booking.id or lobby.status not in ("forming", "confirmed"):
        raise LobbyClosed()
    cutoff = timedelta(hours=settings.cancel_cutoff_hours)
    if lobby.status == "confirmed" and lobby.start_at - utcnow() < cutoff:
        raise TooLate(f"Confirmed matches can't be cancelled within {settings.cancel_cutoff_hours} h of kick-off")
    await lobbies.cancel_lobby(db, lobby, note=f"{user.name} (host) cancelled the match")
    await db.commit()
    lobby = await lobbies.get_lobby(db, lobby.id, refresh=True)
    return await lobbies.lobby_detail(db, lobby, user)
