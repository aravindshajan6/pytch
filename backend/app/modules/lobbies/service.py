"""Lobbies — the match room: membership, payment progress, confirmation, dropouts, chat.

Conventions
- Use-case functions called by routers (`join_lobby`, `leave_lobby`, …) commit.
- Building blocks used by other modules (`add_sub_member`, `cancel_lobby`, `complete_match`,
  `transfer_to_slot`, `post_system_message`, `apply_captured_payment`) never commit — the caller does.
- Membership/payment state is only mutated while holding the lobby row lock (`get_lobby(for_update=True)`).
- The session has autoflush disabled: we flush explicitly before re-reading or emitting domain events.

Money flows (all refunds are Pytch Credits):
- forming + member leaves/expires/cancelled → paid amount back to the payer (`refund`).
- confirmed full mode (or split after "cover remaining"): each seat payment reimburses the host
  (`reimbursement`), capped at what the host fronted.
- confirmed + a paid member drops out → no refund; whoever later pays for a seat credits the earliest
  uncompensated dropout exactly what they paid (`dropout_credit`, the 20 % sub discount is the penalty).
"""

import importlib
import math
import uuid
from collections.abc import Callable, Sequence
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import ColumnElement, and_, exists, func, or_, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.core.codes import booking_code
from app.core.config import settings
from app.core.constants import ACTIVE_MEMBER_STATUSES
from app.core.errors import Conflict, NotFound
from app.core.events import emit
from app.core.geo import haversine_km, haversine_sql
from app.core.logging import logger
from app.core.pagination import Page
from app.core.timeutils import ist_day_bounds, to_ist, utcnow
from app.modules.bench.models import SOSDispatch, SOSRequest
from app.modules.bookings.models import Booking
from app.modules.bookings.schemas import BookingOut
from app.modules.lobbies.detail_schemas import LobbyDetail
from app.modules.lobbies.errors import (
    AlreadyMember,
    LobbyClosed,
    LobbyFull,
    NotEligible,
    NotHost,
    NotMember,
)
from app.modules.lobbies.models import Lobby, LobbyMember, LobbyMessage
from app.modules.lobbies.queries import OPEN_LOBBY_STATUSES, joinable_filters
from app.modules.lobbies.schemas import (
    Eligibility,
    LobbyMemberOut,
    LobbyMessageOut,
    LobbyPitchRef,
    LobbySummary,
    LobbyTurfRef,
    QuickMatchResponse,
)
from app.modules.notifications.service import notify, notify_many
from app.modules.payments import ledger
from app.modules.payments.models import Payment
from app.modules.slots import service as slots_service
from app.modules.slots.models import Slot
from app.modules.turfs.models import Turf
from app.modules.users.models import User
from app.modules.users.schemas import UserPublic
from app.modules.wallet import service as wallet
from app.modules.wallet.models import WalletTransaction
from app.realtime.publisher import lobby_channel, publish_on_commit

ACTIVE = ACTIVE_MEMBER_STATUSES
DEFAULT_SKILL = 50.0
QUICK_MATCH_HORIZON = timedelta(days=7)

__all__ = [
    "active_members",
    "add_sub_member",
    "apply_captured_payment",
    "cancel_lobby",
    "complete_match",
    "eligibility",
    "get_lobby",
    "lobby_detail",
    "lobby_summaries",
    "lobby_summary",
    "post_system_message",
    "transfer_to_slot",
]


# ═══════════════════════════ small helpers ═══════════════════════════


def rupees(paise: int) -> str:
    return f"₹{paise // 100:,}" if paise % 100 == 0 else f"₹{paise / 100:,.2f}"


def kickoff_label(dt: datetime) -> str:
    """e.g. "Sat 12 Sep, 7:00 PM" (IST)."""
    local = to_ist(dt)
    hour = local.hour % 12 or 12
    return f"{local:%a %d %b}, {hour}:{local:%M} {'AM' if local.hour < 12 else 'PM'}"


def share_for(total_paise: int, spots: int) -> int:
    """Per-seat share rounded *up* to the whole rupee: ceil(total / spots / 100) * 100."""
    return -(-total_paise // (spots * 100)) * 100


def _lobby_data(lobby: Lobby) -> dict[str, Any]:
    return {"lobby_id": str(lobby.id), "url": f"/app/lobby/{lobby.id}"}


def _true_skill(user: User | None) -> float | None:
    stats = user.stats if user is not None else None
    return stats.true_skill if stats is not None else None


def _user_public(user: User) -> UserPublic:
    return UserPublic.from_user(user)


async def unique_code(db: AsyncSession, column: Any, generate: Callable[[], str]) -> str:
    """Random short code not yet used in `column` (collisions are astronomically rare)."""
    for _ in range(10):
        code = generate()
        if not await db.scalar(select(exists().where(column == code))):
            return code
    raise Conflict("Could not allocate a unique code — try again")


async def _emit(db: AsyncSession, event: str, **payload: Any) -> None:
    """Flush first so handlers querying the DB see this transaction's pending changes."""
    await db.flush()
    await emit(db, event, **payload)


def _publish_update(db: AsyncSession, lobby_id: uuid.UUID, reason: str, actor: User | None = None) -> None:
    publish_on_commit(
        db,
        lobby_channel(lobby_id),
        "lobby.updated",
        {"lobby_id": str(lobby_id), "reason": reason, "actor": _user_public(actor) if actor else None},
    )


# ═══════════════════════════ loading ═══════════════════════════


async def get_lobby(
    db: AsyncSession, lobby_id: uuid.UUID, *, for_update: bool = False, refresh: bool = False
) -> Lobby:
    """Load a lobby with host/turf/pitch/booking/members. `for_update` row-locks it (and reloads).

    Raises NotFound. Reloading flushes first so pending changes are never discarded.
    """
    stmt = select(Lobby).where(Lobby.id == lobby_id)
    if for_update or refresh:
        await db.flush()
        stmt = stmt.execution_options(populate_existing=True)
    if for_update:
        stmt = stmt.with_for_update(of=Lobby)
    lobby = (await db.execute(stmt)).unique().scalar_one_or_none()
    if lobby is None:
        raise NotFound("Match not found")
    return lobby


async def get_lobby_by_code(db: AsyncSession, code: str) -> Lobby:
    lobby = (await db.execute(select(Lobby).where(Lobby.code == code.strip().upper()))).unique().scalar()
    if lobby is None:
        raise NotFound("No match with that code")
    return lobby


async def _ensure_loaded(db: AsyncSession, lobbies: Sequence[Lobby]) -> None:
    """Guarantee relationships used by the serialisers are loaded (batch for members)."""
    missing_members = [lb for lb in lobbies if "members" in sa_inspect(lb).unloaded]
    if missing_members:
        rows = (
            (
                await db.execute(
                    select(LobbyMember)
                    .where(LobbyMember.lobby_id.in_([lb.id for lb in missing_members]))
                    .order_by(LobbyMember.joined_at)
                )
            )
            .unique()
            .scalars()
            .all()
        )
        by_lobby: dict[uuid.UUID, list[LobbyMember]] = {}
        for m in rows:
            by_lobby.setdefault(m.lobby_id, []).append(m)
        for lb in missing_members:
            set_committed_value(lb, "members", by_lobby.get(lb.id, []))
    rest = [lb for lb in lobbies if {"host", "turf", "pitch", "booking"} & sa_inspect(lb).unloaded]
    if rest:  # rare fallback (e.g. expired instances); plain lazy loads in a sync context
        await db.run_sync(lambda _: [(lb.host, lb.turf, lb.pitch, lb.booking) for lb in rest])


# ═══════════════════════════ membership views ═══════════════════════════


def active_members(lobby: Lobby) -> list[LobbyMember]:
    """Joined + paid members, host first then by join time."""
    members = [m for m in lobby.members if m.status in ACTIVE]
    return sorted(members, key=lambda m: (m.role != "host", m.joined_at))


def find_member(lobby: Lobby, user_id: uuid.UUID) -> LobbyMember | None:
    return next((m for m in lobby.members if m.user_id == user_id), None)


def find_active_member(lobby: Lobby, user_id: uuid.UUID) -> LobbyMember | None:
    member = find_member(lobby, user_id)
    return member if member is not None and member.status in ACTIVE else None


def host_member(lobby: Lobby) -> LobbyMember | None:
    return find_member(lobby, lobby.host_id)


def paid_count(lobby: Lobby) -> int:
    return sum(1 for m in lobby.members if m.status == "paid")


def spots_left(lobby: Lobby) -> int:
    return max(lobby.total_spots - len(active_members(lobby)), 0)


def _require_host(lobby: Lobby, user: User) -> None:
    if lobby.host_id != user.id:
        raise NotHost()


def ensure_open_for_seats(lobby: Lobby, now: datetime) -> None:
    if lobby.status not in OPEN_LOBBY_STATUSES or lobby.start_at <= now:
        raise LobbyClosed()
    if lobby.status == "forming" and lobby.pay_deadline is not None and lobby.pay_deadline <= now:
        raise LobbyClosed("The payment window for this match has closed")


# ═══════════════════════════ serialisation ═══════════════════════════


def booking_out(booking: Booking, lobby: Lobby) -> BookingOut:
    return BookingOut(
        id=booking.id,
        code=booking.code,
        slot_id=booking.slot_id,
        lobby_id=lobby.id,
        host_id=booking.host_id,
        mode=booking.mode,  # type: ignore[arg-type]
        status=booking.status,  # type: ignore[arg-type]
        pitch_fee_paise=booking.pitch_fee_paise,
        recording_fee_paise=booking.recording_fee_paise,
        total_paise=booking.total_paise,
        recorded=booking.recorded,
        start_at=lobby.start_at,
        end_at=lobby.end_at,
        expires_at=booking.expires_at if booking.status == "pending_payment" else None,
        confirmed_at=booking.confirmed_at,
        created_at=booking.created_at,
        transferred_from_id=booking.transferred_from_id,
    )


def member_out(member: LobbyMember) -> LobbyMemberOut:
    return LobbyMemberOut(
        user=_user_public(member.user),
        role=member.role,  # type: ignore[arg-type]
        status=member.status,  # type: ignore[arg-type]
        team=member.team,  # type: ignore[arg-type]
        share_paise=member.share_paise,
        paid_paise=member.paid_paise,
        discount_paise=member.discount_paise,
        joined_at=member.joined_at,
        paid_at=member.paid_at,
        reserved_until=member.reserved_until if member.status == "joined" else None,
    )


def _summary_fields(lobby: Lobby, lat: float | None, lng: float | None) -> dict[str, Any]:
    members = active_members(lobby)
    skills = [ts for m in members if (ts := _true_skill(m.user)) is not None]
    turf, pitch = lobby.turf, lobby.pitch
    distance = (
        round(haversine_km(lat, lng, turf.lat, turf.lng), 2) if lat is not None and lng is not None else None
    )
    return {
        "id": lobby.id,
        "code": lobby.code,
        "title": lobby.title,
        "sport": lobby.sport,
        "format": lobby.format,
        "mode": lobby.mode,
        "visibility": lobby.visibility,
        "status": lobby.status,
        "host": _user_public(lobby.host),
        "start_at": lobby.start_at,
        "end_at": lobby.end_at,
        "turf": LobbyTurfRef(
            id=turf.id, slug=turf.slug, name=turf.name, area=turf.area, lat=turf.lat, lng=turf.lng,
            cover_url=turf.cover_url,
        ),
        "pitch": LobbyPitchRef(id=pitch.id, name=pitch.name, is_indoor=pitch.is_indoor, has_camera=pitch.has_camera),
        "total_spots": lobby.total_spots,
        "filled_spots": len(members),
        "paid_spots": sum(1 for m in members if m.status == "paid"),
        "spots_left": max(lobby.total_spots - len(members), 0),
        "share_paise": lobby.share_paise,
        "pay_deadline": lobby.pay_deadline if lobby.status == "forming" else None,
        "min_true_skill": lobby.min_true_skill,
        "verified_only": lobby.verified_only,
        "recorded": lobby.recorded,
        "distance_km": distance,
        "avg_true_skill": round(sum(skills) / len(skills), 1) if skills else None,
        "member_avatars": [_user_public(m.user) for m in members[:6]],
    }


async def lobby_summaries(
    db: AsyncSession, lobbies: Sequence[Lobby], *, lat: float | None = None, lng: float | None = None
) -> list[LobbySummary]:
    """Batch serialiser — relationships come from eager loads, so no per-lobby queries."""
    await _ensure_loaded(db, lobbies)
    return [LobbySummary(**_summary_fields(lb, lat, lng)) for lb in lobbies]


async def lobby_summary(
    db: AsyncSession, lobby: Lobby, *, lat: float | None = None, lng: float | None = None
) -> LobbySummary:
    return (await lobby_summaries(db, [lobby], lat=lat, lng=lng))[0]


async def _optional_extra(module: str, attr: str, *args: Any) -> Any:
    """Call a function from a module that may not exist yet (written by another team)."""
    try:
        fn = getattr(importlib.import_module(module), attr)
    except (ImportError, AttributeError):
        return None
    try:
        return await fn(*args)
    except Exception:
        logger.exception("lobby_detail: %s.%s failed", module, attr)
        return None


async def lobby_detail(db: AsyncSession, lobby: Lobby, viewer: User) -> LobbyDetail:
    await _ensure_loaded(db, [lobby])
    fields = _summary_fields(lobby, None, None)
    members = active_members(lobby)
    mine = next((m for m in members if m.user_id == viewer.id), None)
    open_sos = await _optional_extra("app.modules.bench.service", "open_sos_for_lobby", db, lobby.id, viewer)
    weather_alert = await _optional_extra("app.modules.weather.service", "open_alert_for_lobby", db, lobby, viewer)
    recording = await _optional_extra("app.modules.highlights.service", "recording_summary_for_lobby", db, lobby.id)
    return LobbyDetail(
        **fields,
        booking=booking_out(lobby.booking, lobby),
        notes=lobby.notes,
        members=[member_out(m) for m in members],
        my_membership=member_out(mine) if mine else None,
        eligibility=eligibility(viewer, lobby),
        open_sos=open_sos,
        weather_alert=weather_alert,
        recording=recording,
        invite_url=f"{settings.public_web_url}/app/join/{lobby.code}",
        created_at=lobby.created_at,
    )


def eligibility(user: User, lobby: Lobby) -> Eligibility:
    """Skill/verification gates only (fullness and membership are separate concerns)."""
    if user.id == lobby.host_id:
        return Eligibility(can_join=True, reasons=[])
    reasons: list[str] = []
    stats = user.stats
    if lobby.verified_only and not (stats is not None and stats.is_verified_playmaker):
        reasons.append("Verified Playmakers only — get peer-verified to join")
    if lobby.min_true_skill is not None:
        need = math.ceil(lobby.min_true_skill)
        mine = _true_skill(user)
        if mine is None:
            reasons.append(f"Needs True Skill {need} — you're not rated yet")
        elif mine < lobby.min_true_skill:
            reasons.append(f"Needs True Skill {need} — you're {math.floor(mine)}")
    return Eligibility(can_join=not reasons, reasons=reasons)


def _eligibility_filters(user: User) -> list[ColumnElement[bool]]:
    """SQL mirror of `eligibility` for feeds."""
    stats = user.stats
    filters: list[ColumnElement[bool]] = []
    if not (stats is not None and stats.is_verified_playmaker):
        filters.append(Lobby.verified_only.is_(False))
    mine = _true_skill(user)
    if mine is None:
        filters.append(Lobby.min_true_skill.is_(None))
    else:
        filters.append(or_(Lobby.min_true_skill.is_(None), Lobby.min_true_skill <= mine))
    return filters


def _is_active_member_clause(user_id: uuid.UUID) -> ColumnElement[bool]:
    return exists(
        select(LobbyMember.id).where(
            LobbyMember.lobby_id == Lobby.id, LobbyMember.user_id == user_id, LobbyMember.status.in_(ACTIVE)
        )
    )


async def _has_open_sos_dispatch(db: AsyncSession, lobby_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(
                    SOSDispatch.sos_id == SOSRequest.id,
                    SOSRequest.lobby_id == lobby_id,
                    SOSRequest.status == "open",
                    SOSDispatch.user_id == user_id,
                )
            )
        )
    )


async def get_visible_lobby(db: AsyncSession, lobby_id: uuid.UUID, viewer: User) -> Lobby:
    """Private lobbies are visible to (former) members, SOS recipients, or via the invite code."""
    lobby = await get_lobby(db, lobby_id)
    if lobby.visibility == "public" or lobby.host_id == viewer.id or find_member(lobby, viewer.id):
        return lobby
    if await _has_open_sos_dispatch(db, lobby.id, viewer.id):
        return lobby
    raise NotFound("Match not found")


# ═══════════════════════════ realtime chat ═══════════════════════════


async def post_system_message(db: AsyncSession, lobby_id: uuid.UUID, body: str) -> None:
    """Add a system chat line and broadcast it after commit. Caller commits."""
    msg = LobbyMessage(
        id=uuid.uuid4(), lobby_id=lobby_id, user_id=None, kind="system", body=body[:500], created_at=utcnow()
    )
    db.add(msg)
    publish_on_commit(
        db,
        lobby_channel(lobby_id),
        "lobby.message",
        LobbyMessageOut(id=msg.id, lobby_id=lobby_id, user=None, kind="system", body=msg.body,
                        created_at=msg.created_at),
    )


def _message_out(msg: LobbyMessage) -> LobbyMessageOut:
    return LobbyMessageOut(
        id=msg.id,
        lobby_id=msg.lobby_id,
        user=_user_public(msg.user) if msg.user is not None else None,
        kind=msg.kind,  # type: ignore[arg-type]
        body=msg.body,
        created_at=msg.created_at,
    )


async def list_messages(
    db: AsyncSession, lobby_id: uuid.UUID, viewer: User, *, before: datetime | None, limit: int
) -> list[LobbyMessageOut]:
    await get_visible_lobby(db, lobby_id, viewer)
    stmt = select(LobbyMessage).where(LobbyMessage.lobby_id == lobby_id)
    if before is not None:
        stmt = stmt.where(LobbyMessage.created_at < before)
    rows = (
        (await db.execute(stmt.order_by(LobbyMessage.created_at.desc(), LobbyMessage.id.desc()).limit(limit)))
        .unique()
        .scalars()
        .all()
    )
    return [_message_out(m) for m in reversed(rows)]


async def send_message(db: AsyncSession, lobby_id: uuid.UUID, user: User, body: str) -> LobbyMessageOut:
    lobby = await get_lobby(db, lobby_id)
    if find_active_member(lobby, user.id) is None:
        raise NotMember()
    msg = LobbyMessage(
        id=uuid.uuid4(), lobby_id=lobby.id, user_id=user.id, kind="chat", body=body.strip()[:500], created_at=utcnow()
    )
    msg.user = user
    db.add(msg)
    out = _message_out(msg)
    publish_on_commit(db, lobby_channel(lobby.id), "lobby.message", out)
    await db.commit()
    return out


# ═══════════════════════════ discovery ═══════════════════════════


async def feed(
    db: AsyncSession,
    viewer: User,
    *,
    sport: str | None,
    lat: float | None,
    lng: float | None,
    radius_km: float,
    day: date | None,
    include_ineligible: bool,
    limit: int,
    offset: int,
) -> Page[LobbySummary]:
    """Public lobbies a viewer could join now (excluding ones they're already in), soonest first."""
    now = utcnow()
    stmt = select(Lobby).where(*joinable_filters(now), ~_is_active_member_clause(viewer.id))
    if sport:
        stmt = stmt.where(Lobby.sport == sport)
    if day is not None:
        start, end = ist_day_bounds(day)
        stmt = stmt.where(Lobby.start_at >= start, Lobby.start_at < end)
    if lat is not None and lng is not None:
        stmt = stmt.join(Turf, Turf.id == Lobby.turf_id).where(
            haversine_sql(Turf.lat, Turf.lng, lat, lng) <= radius_km
        )
    if not include_ineligible:
        stmt = stmt.where(*_eligibility_filters(viewer))

    total = int(await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    lobbies = (
        (await db.execute(stmt.order_by(Lobby.start_at, Lobby.id).limit(limit).offset(offset)))
        .unique()
        .scalars()
        .all()
    )
    return Page(items=await lobby_summaries(db, lobbies, lat=lat, lng=lng), total=total, limit=limit, offset=offset)


def _kickoff_reason(start_at: datetime, now: datetime) -> str:
    minutes = int((start_at - now).total_seconds() // 60)
    if minutes < 60:
        return f"Kicks off in {max(minutes, 1)} min"
    if minutes < 24 * 60:
        return f"Kicks off in {minutes // 60}h"
    return f"Kicks off {kickoff_label(start_at)}"


def _score_lobby(
    lobby: Lobby, *, now: datetime, lat: float, lng: float, my_skill: float
) -> tuple[float, list[str]]:
    """Quick-match score in 0..100 with human-readable reasons.

    Weights: soonest kick-off 30 %, distance 30 %, skill proximity 25 %, fill ratio 15 %
    (nearly-full games rank higher because joining them is what triggers confirmation).
    """
    members = active_members(lobby)
    hours = max((lobby.start_at - now).total_seconds() / 3600, 0)
    distance = haversine_km(lat, lng, lobby.turf.lat, lobby.turf.lng)
    skills = [ts for m in members if (ts := _true_skill(m.user)) is not None]
    lobby_skill = sum(skills) / len(skills) if skills else DEFAULT_SKILL
    time_score = 1 / (1 + hours / 6)
    distance_score = 1 / (1 + distance / 3)
    skill_score = max(0.0, 1 - abs(my_skill - lobby_skill) / 50)
    fill_ratio = len(members) / lobby.total_spots if lobby.total_spots else 0
    score = 100 * (0.30 * time_score + 0.30 * distance_score + 0.25 * skill_score + 0.15 * fill_ratio)

    left = lobby.total_spots - len(members)
    reasons = [
        _kickoff_reason(lobby.start_at, now),
        f"{distance:.1f} km away",
        f"Skill match {round(skill_score * 100)}%",
        "Last spot — you'd complete the squad"
        if left == 1
        else f"{len(members)}/{lobby.total_spots} in · {left} spots left",
    ]
    return round(score, 1), reasons


async def quick_match(
    db: AsyncSession, viewer: User, *, sport: str | None, lat: float | None, lng: float | None
) -> QuickMatchResponse:
    now = utcnow()
    if lat is None or lng is None:
        lat = viewer.home_lat if viewer.home_lat is not None else settings.city_center_lat
        lng = viewer.home_lng if viewer.home_lng is not None else settings.city_center_lng
    stmt = select(Lobby).where(
        *joinable_filters(now),
        Lobby.start_at <= now + QUICK_MATCH_HORIZON,
        ~_is_active_member_clause(viewer.id),
        *_eligibility_filters(viewer),
    )
    if sport:
        stmt = stmt.where(Lobby.sport == sport)
    candidates = (await db.execute(stmt.order_by(Lobby.start_at).limit(100))).unique().scalars().all()
    if not candidates:
        return QuickMatchResponse(lobby=None, score=0, reasons=["No open games right now — host one and we'll fill it"])
    await _ensure_loaded(db, candidates)
    my_skill = _true_skill(viewer)
    my_skill = DEFAULT_SKILL if my_skill is None else my_skill
    scored = [(_score_lobby(lb, now=now, lat=lat, lng=lng, my_skill=my_skill), lb) for lb in candidates]
    (score, reasons), best = max(scored, key=lambda item: (item[0][0], -item[1].start_at.timestamp()))
    return QuickMatchResponse(lobby=await lobby_summary(db, best, lat=lat, lng=lng), score=score, reasons=reasons)


async def my_lobbies(db: AsyncSession, user: User, scope: Literal["upcoming", "past"]) -> list[LobbySummary]:
    now = utcnow()
    stmt = select(Lobby).where(_is_active_member_clause(user.id))
    if scope == "upcoming":
        stmt = stmt.where(Lobby.status.in_(OPEN_LOBBY_STATUSES), Lobby.end_at > now).order_by(Lobby.start_at)
    else:
        stmt = stmt.where(
            or_(Lobby.status.in_(("completed", "expired", "cancelled")), Lobby.end_at <= now)
        ).order_by(Lobby.start_at.desc())
    lobbies = (await db.execute(stmt.limit(50))).unique().scalars().all()
    return await lobby_summaries(db, lobbies)


# ═══════════════════════════ membership mutations ═══════════════════════════


def _reservation_until(lobby: Lobby, now: datetime, minutes: int) -> datetime:
    until = now + timedelta(minutes=minutes)
    if lobby.status == "forming" and lobby.pay_deadline is not None:
        until = min(until, lobby.pay_deadline)
    return min(until, lobby.start_at)


def _seat(
    lobby: Lobby,
    user: User,
    *,
    role: str,
    share_paise: int,
    discount_paise: int,
    reserve_minutes: int,
    sos_id: uuid.UUID | None = None,
) -> LobbyMember:
    """Reserve an unpaid seat, reusing the user's previous (left/removed) row if any."""
    now = utcnow()
    member = find_member(lobby, user.id)
    if member is None:
        member = LobbyMember(id=uuid.uuid4(), lobby_id=lobby.id, user_id=user.id, joined_at=now)
        member.user = user
        lobby.members.append(member)
    member.role = role
    member.status = "joined"
    member.team = None
    member.share_paise = share_paise
    member.paid_paise = 0
    member.discount_paise = discount_paise
    member.compensated_paise = 0
    member.reserved_until = _reservation_until(lobby, now, reserve_minutes)
    member.sos_id = sos_id
    member.joined_at = now
    member.paid_at = None
    member.left_at = None
    member.attended = None
    return member


def _restore_dropout(lobby: Lobby, member: LobbyMember) -> bool:
    """A paid dropout who comes back before anyone replaced them simply gets their paid seat back."""
    uncompensated = member.paid_paise > 0 and member.compensated_paise == 0
    if lobby.status == "confirmed" and member.status == "left" and uncompensated:
        member.status = "paid"
        member.left_at = None
        member.reserved_until = None
        return True
    return False


async def join_lobby(db: AsyncSession, lobby_id: uuid.UUID, user: User) -> Lobby:
    lobby = await get_lobby(db, lobby_id, for_update=True)
    now = utcnow()
    ensure_open_for_seats(lobby, now)
    existing = find_member(lobby, user.id)
    if existing is not None and existing.status in ACTIVE:
        raise AlreadyMember()
    gate = eligibility(user, lobby)
    if not gate.can_join:
        raise NotEligible(details={"reasons": gate.reasons})
    if spots_left(lobby) <= 0:
        raise LobbyFull()

    if existing is not None and _restore_dropout(lobby, existing):
        await post_system_message(db, lobby.id, f"{user.name} is back in 🙌")
    else:
        _seat(lobby, user, role="player", share_paise=lobby.share_paise, discount_paise=0,
              reserve_minutes=settings.seat_reservation_minutes)
        await post_system_message(db, lobby.id, f"{user.name} joined — {rupees(lobby.share_paise)} to lock the seat")
    filled = len(active_members(lobby))
    await notify(
        db, lobby.host_id, "member_joined", f"{user.name} joined your match",
        f"{lobby.title} · {filled}/{lobby.total_spots} spots filled", _lobby_data(lobby),
    )
    _publish_update(db, lobby.id, "member_joined", user)
    await db.commit()
    return await get_lobby(db, lobby.id, refresh=True)


async def leave_lobby(
    db: AsyncSession, lobby_id: uuid.UUID, user: User, *, hours_to_kickoff: float | None = None
) -> Lobby:
    """Leave a match. Forming: any payment is refunded as credits. Confirmed: dropout rule applies
    (no refund; `member.dropped` lets the bench raise an SOS). `hours_to_kickoff` overrides the
    computed value (demo tooling only)."""
    lobby = await get_lobby(db, lobby_id, for_update=True)
    now = utcnow()
    member = find_active_member(lobby, user.id)
    if member is None:
        raise NotMember()
    if member.role == "host":
        raise Conflict("Hosts can't leave — cancel the match instead")
    if lobby.status not in OPEN_LOBBY_STATUSES or lobby.start_at <= now:
        raise LobbyClosed()

    was_paid = member.status == "paid"
    member.status = "left"
    member.left_at = now
    member.reserved_until = None
    member.team = None
    await ledger.cancel_pending_payments(db, member_ids=[member.id], reason="member left")

    if lobby.status == "forming":
        refund = member.paid_paise - member.compensated_paise
        if refund > 0:
            await wallet.credit(db, user.id, refund, "refund", f"Refund — you left {lobby.title}",
                                ref_type="lobby", ref_id=lobby.id)
            member.compensated_paise = member.paid_paise
            await ledger.mark_lobby_payments_refunded(db, lobby.id, member_ids=[member.id])
            await post_system_message(db, lobby.id, f"{user.name} left — {rupees(refund)} refunded as credits")
        else:
            await post_system_message(db, lobby.id, f"{user.name} left the match")
    else:
        await post_system_message(db, lobby.id, f"{user.name} dropped out — a seat just opened")

    await notify(db, lobby.host_id, "member_left", f"{user.name} left your match",
                 f"{lobby.title} · {kickoff_label(lobby.start_at)}", _lobby_data(lobby))
    _publish_update(db, lobby.id, "member_left", user)
    if lobby.status == "confirmed":
        hours = hours_to_kickoff if hours_to_kickoff is not None else (lobby.start_at - now).total_seconds() / 3600
        await _emit(db, "member.dropped", lobby_id=lobby.id, user_id=user.id, member_id=member.id,
                    hours_to_kickoff=round(hours, 2), was_paid=was_paid)
    await db.commit()
    return await get_lobby(db, lobby.id, refresh=True)


async def remove_unpaid_member(db: AsyncSession, lobby_id: uuid.UUID, host: User, target_user_id: uuid.UUID) -> Lobby:
    lobby = await get_lobby(db, lobby_id, for_update=True)
    _require_host(lobby, host)
    member = find_active_member(lobby, target_user_id)
    if member is None:
        raise NotMember("That player isn't in this match")
    if member.role == "host":
        raise Conflict("You can't remove yourself — cancel the match instead")
    if member.status == "paid":
        raise Conflict("Only unpaid players can be removed")
    await _release_seat(db, lobby, member, reason="removed by the host")
    await db.commit()
    return await get_lobby(db, lobby.id, refresh=True)


async def _release_seat(db: AsyncSession, lobby: Lobby, member: LobbyMember, *, reason: str) -> None:
    """joined (unpaid) → removed. Caller holds the lobby lock and commits."""
    member.status = "removed"
    member.left_at = utcnow()
    member.reserved_until = None
    member.team = None
    await ledger.cancel_pending_payments(db, member_ids=[member.id], reason=reason)
    name = member.user.name
    await post_system_message(db, lobby.id, f"{name}'s seat was released ({reason})")
    await notify(db, member.user_id, "member_left", "Your seat was released",
                 f"{lobby.title} — {reason}. You can rejoin if spots are left.", _lobby_data(lobby))
    _publish_update(db, lobby.id, "member_removed", None)


async def balance_teams(db: AsyncSession, lobby_id: uuid.UUID, host: User) -> Lobby:
    """Snake draft on True Skill (unrated → 50): A B B A A B B A … → minimal skill delta."""
    lobby = await get_lobby(db, lobby_id, for_update=True)
    _require_host(lobby, host)
    if lobby.status not in OPEN_LOBBY_STATUSES:
        raise LobbyClosed()
    members = active_members(lobby)
    if len(members) < 2:
        raise Conflict("Need at least 2 players to balance teams")

    def skill(m: LobbyMember) -> float:
        ts = _true_skill(m.user)
        return DEFAULT_SKILL if ts is None else ts

    ranked = sorted(members, key=lambda m: (-skill(m), m.joined_at))
    totals = {"A": [], "B": []}  # type: dict[str, list[float]]
    for i, m in enumerate(ranked):
        team = "A" if (i % 2 == 0) != ((i // 2) % 2 == 1) else "B"
        m.team = team
        totals[team].append(skill(m))
    avg = {t: round(sum(v) / len(v)) if v else 0 for t, v in totals.items()}
    await post_system_message(db, lobby.id, f"⚖️ Teams balanced — Team A avg {avg['A']} · Team B avg {avg['B']}")
    _publish_update(db, lobby.id, "teams_balanced", host)
    await db.commit()
    return await get_lobby(db, lobby.id, refresh=True)


async def add_sub_member(
    db: AsyncSession, lobby: Lobby, user: User, *, sos_id: uuid.UUID | None, discount_paise: int
) -> LobbyMember:
    """Reserve a discounted `sub` seat for 5 minutes (SOS accept). Caller commits.

    Raises LOBBY_CLOSED / ALREADY_MEMBER / NOT_ELIGIBLE / LOBBY_FULL. The sub then pays via
    `POST /lobbies/{id}/pay` (purpose `sub_share`).
    """
    lobby = await get_lobby(db, lobby.id, for_update=True)
    ensure_open_for_seats(lobby, utcnow())
    existing = find_member(lobby, user.id)
    if existing is not None and existing.status in ACTIVE:
        raise AlreadyMember()
    gate = eligibility(user, lobby)
    if not gate.can_join:
        raise NotEligible(details={"reasons": gate.reasons})
    if spots_left(lobby) <= 0:
        raise LobbyFull()
    discount = max(0, min(discount_paise, lobby.share_paise))
    member = _seat(lobby, user, role="sub", share_paise=lobby.share_paise - discount, discount_paise=discount,
                   reserve_minutes=settings.sub_seat_reservation_minutes, sos_id=sos_id)
    await post_system_message(db, lobby.id, f"🦸 {user.name} answered the SOS — seat reserved for 5 min")
    # `sub_found` is sent by the bench module once the sub has actually paid.
    await notify(db, lobby.host_id, "member_joined", f"{user.name} answered your SOS",
                 f"{lobby.title} · seat reserved while they pay", _lobby_data(lobby))
    _publish_update(db, lobby.id, "member_joined", user)
    await db.flush()
    return member


# ═══════════════════════════ payments → lobby state ═══════════════════════════


def payment_block_reason(
    lobby: Lobby, member: LobbyMember | None, purpose: str, amount_paise: int, now: datetime
) -> str | None:
    """Why a (captured or about-to-be-created) payment can't be applied to the lobby, else None."""
    if lobby.status not in OPEN_LOBBY_STATUSES:
        return f"This match is {lobby.status}"
    if lobby.start_at <= now:
        return "The match has already kicked off"
    if lobby.status == "forming" and lobby.pay_deadline is not None and now > lobby.pay_deadline:
        return "The payment window closed before the payment completed"
    if member is None:
        return "This seat no longer exists"
    if purpose == "cover_remaining":
        if member.role != "host" or lobby.mode != "split" or lobby.status != "forming":
            return "There is nothing left to cover"
        if amount_paise < cover_amount(lobby):
            return "More seats opened since — cover the remaining seats again"
        return None
    if member.status in ("left", "removed"):
        return "This seat is no longer reserved for you"
    if member.status == "paid":
        return "This seat is already paid for"
    if purpose == "full" and lobby.status != "forming":
        return "This match is already confirmed"
    return None


def cover_amount(lobby: Lobby) -> int:
    """What the host pays to cover every seat not yet paid (their own included)."""
    return max(lobby.total_spots - paid_count(lobby), 0) * lobby.share_paise


async def _host_reimbursed(db: AsyncSession, lobby: Lobby) -> int:
    await db.flush()
    total = await db.scalar(
        select(func.coalesce(func.sum(WalletTransaction.amount_paise), 0)).where(
            WalletTransaction.user_id == lobby.host_id,
            WalletTransaction.kind == "reimbursement",
            WalletTransaction.ref_type == "lobby",
            WalletTransaction.ref_id == lobby.id,
        )
    )
    return int(total or 0)


async def _route_seat_money(db: AsyncSession, lobby: Lobby, payer: LobbyMember, amount: int) -> None:
    """Send a seat payment made in a *confirmed* lobby to whoever is owed it.

    1. Dropout rule: the earliest uncompensated paid dropout is credited exactly what was paid
       (capped at what they had paid).
    2. Otherwise the host is reimbursed, up to what they fronted beyond their own seat
       (full mode, or split after "cover remaining"). Any remainder is rounding surplus (venue).
    """
    dropouts = sorted(
        (m for m in lobby.members
         if m.status == "left" and m.paid_paise > 0 and m.compensated_paise == 0 and m.id != payer.id),
        key=lambda m: m.left_at or m.joined_at,
    )
    payer_name = payer.user.name
    if dropouts:
        dropout = dropouts[0]
        credit = min(amount, dropout.paid_paise)
        dropout.compensated_paise = credit
        await wallet.credit(db, dropout.user_id, credit, "dropout_credit",
                            f"{payer_name} took your spot in {lobby.title}", ref_type="lobby", ref_id=lobby.id)
        await notify(db, dropout.user_id, "wallet_credit", f"{rupees(credit)} credited to your wallet",
                     f"{payer_name} took your spot in {lobby.title} — you get back exactly what they paid.",
                     {**_lobby_data(lobby), "url": "/app/wallet"})
        return

    host = host_member(lobby)
    if host is None or host.id == payer.id:
        return
    fronted = host.paid_paise - host.compensated_paise - lobby.share_paise
    outstanding = fronted - await _host_reimbursed(db, lobby)
    credit = min(amount, outstanding)
    if credit > 0:
        await wallet.credit(db, lobby.host_id, credit, "reimbursement",
                            f"{payer_name} paid their share of {lobby.title}", ref_type="lobby", ref_id=lobby.id)


async def apply_captured_payment(db: AsyncSession, lobby: Lobby, member: LobbyMember, payment: Payment) -> None:
    """Lobby-side effects of a captured payment. Caller holds the lobby lock and commits."""
    if payment.purpose == "cover_remaining":
        await _apply_cover(db, lobby, member, payment)
        return
    now = utcnow()
    payer = member.user
    member.status = "paid"
    member.paid_paise += payment.amount_paise
    member.paid_at = now
    member.reserved_until = None
    if lobby.status == "confirmed" and member.role != "host":
        await _route_seat_money(db, lobby, member, payment.amount_paise)

    amount = rupees(payment.amount_paise)
    line = {
        "full": f"💸 {payer.name} paid the full {amount}",
        "sub_share": f"🦸 {payer.name} paid {amount} and is in as a sub",
    }.get(payment.purpose, f"✅ {payer.name} paid their share ({amount})")
    await post_system_message(db, lobby.id, line)
    if member.user_id != lobby.host_id:
        body = f"{lobby.title} · {paid_count(lobby)}/{lobby.total_spots} paid"
        if lobby.mode == "full":
            body += " · reimbursed to your Pytch Credits"
        await notify(db, lobby.host_id, "payment_received", f"{payer.name} paid {amount}", body, _lobby_data(lobby))
    _publish_update(db, lobby.id, "member_paid", payer)
    if member.role == "sub":
        await _emit(db, "sub.paid", lobby_id=lobby.id, user_id=member.user_id, member_id=member.id,
                    sos_id=member.sos_id)
    if lobby.status == "forming" and _confirmation_met(lobby):
        await _confirm(db, lobby)


async def _apply_cover(db: AsyncSession, lobby: Lobby, host: LobbyMember, payment: Payment) -> None:
    """Host covered every unpaid seat: unpaid members become paid (by the host) and the game locks."""
    now = utcnow()
    needed = cover_amount(lobby)
    excess = payment.amount_paise - needed
    if excess > 0:  # someone paid their own share while the host was covering
        await wallet.credit(db, lobby.host_id, excess, "refund", f"Cover overpayment returned — {lobby.title}",
                            ref_type="payment", ref_id=payment.id)
    covered_members = [m for m in active_members(lobby) if m.status == "joined" and m.id != host.id]
    host.paid_paise += needed
    host.status = "paid"
    host.paid_at = host.paid_at or now
    host.reserved_until = None
    for m in covered_members:
        m.status = "paid"
        m.paid_at = now
        m.reserved_until = None
    seats = needed // lobby.share_paise if lobby.share_paise else 0
    await post_system_message(
        db, lobby.id, f"🔒 {host.user.name} covered the remaining {seats} seat(s) ({rupees(needed)}) — game locked"
    )
    _publish_update(db, lobby.id, "member_paid", host.user)
    await _confirm(db, lobby)


def _confirmation_met(lobby: Lobby) -> bool:
    if lobby.mode == "full":
        host = host_member(lobby)
        return host is not None and host.status == "paid"
    return paid_count(lobby) >= lobby.total_spots


async def _confirm(db: AsyncSession, lobby: Lobby) -> None:
    """forming → confirmed: book the slot, confirm the booking, tell everyone, emit lobby.confirmed."""
    now = utcnow()
    lobby.status = "confirmed"
    lobby.confirmed_at = now
    lobby.pay_deadline = None
    booking = lobby.booking
    booking.status = "confirmed"
    booking.confirmed_at = now
    slot = await slots_service.lock_slot_wait(db, lobby.slot_id)
    await slots_service.book_slot(db, slot)
    if lobby.mode == "full":  # shares paid while the host's payment was pending → reimburse now
        for m in active_members(lobby):
            if m.role != "host" and m.status == "paid" and m.paid_paise > 0:
                await _route_seat_money(db, lobby, m, m.paid_paise)

    members = active_members(lobby)
    await notify_many(db, [m.user_id for m in members], "lobby_confirmed", "Match confirmed 🎉",
                      f"{lobby.title} · {kickoff_label(lobby.start_at)} at {lobby.turf.name}", _lobby_data(lobby))
    await post_system_message(db, lobby.id, "🎉 Match confirmed — slot booked. See you on the pitch!")
    _publish_update(db, lobby.id, "confirmed", None)
    await _emit(db, "lobby.confirmed", lobby_id=lobby.id)


# ═══════════════════════════ lifecycle: expire / cancel / complete / transfer ═══════════════════════════


async def _refund_everyone(
    db: AsyncSession, lobby: Lobby, *, kind: str, note: str, bonus_paise: int = 0
) -> dict[uuid.UUID, int]:
    """Return all money still held for this lobby to whoever paid it (as credits).

    Owed per member = paid − already compensated (− reimbursements already received, for the host).
    Idempotent: `compensated_paise` is advanced by whatever is refunded. Returns refunds per user.
    """
    host_reimbursed = await _host_reimbursed(db, lobby)
    refunds: dict[uuid.UUID, int] = {}
    for m in lobby.members:
        owed = m.paid_paise - m.compensated_paise - (host_reimbursed if m.user_id == lobby.host_id else 0)
        if owed <= 0:
            continue
        await wallet.credit(db, m.user_id, owed, kind, note, ref_type="lobby", ref_id=lobby.id)
        m.compensated_paise += owed
        refunds[m.user_id] = owed
    if bonus_paise > 0:
        for m in active_members(lobby):
            if m.status == "paid":
                await wallet.credit(db, m.user_id, bonus_paise, "bonus", f"Rain bonus — {lobby.title}",
                                    ref_type="lobby", ref_id=lobby.id)
    await ledger.cancel_pending_payments(db, lobby_id=lobby.id, reason=f"match {lobby.status}")
    await ledger.mark_lobby_payments_refunded(db, lobby.id)
    return refunds


async def _release_lobby_slot(db: AsyncSession, lobby: Lobby) -> None:
    slot = await slots_service.lock_slot_wait(db, lobby.slot_id)
    if slot.booking_id in (None, lobby.booking_id):
        await slots_service.release_slot(db, slot)


async def expire_lobby(db: AsyncSession, lobby: Lobby) -> None:
    """forming → expired (deadline passed): release the slot, refund every payment. Caller commits."""
    lobby.status = "expired"
    lobby.booking.status = "expired"
    refunds = await _refund_everyone(db, lobby, kind="refund", note=f"Refund — {lobby.title} didn't fill in time")
    await _release_lobby_slot(db, lobby)
    for m in active_members(lobby):
        refunded = refunds.get(m.user_id, 0)
        body = (f"Not every seat was paid in time. {rupees(refunded)} is back in your Pytch Credits."
                if refunded else "Not every seat was paid in time, so the slot was released.")
        await notify(db, m.user_id, "lobby_expired", f"{lobby.title} expired", body, _lobby_data(lobby))
    await post_system_message(
        db, lobby.id, "⏱ Payment window closed — match expired. All payments were refunded as credits."
    )
    _publish_update(db, lobby.id, "expired", None)
    await _emit(db, "lobby.expired", lobby_id=lobby.id)


async def cancel_lobby(
    db: AsyncSession, lobby: Lobby, *, refund_kind: str = "refund", bonus_paise: int = 0, note: str = ""
) -> int:
    """Cancel a forming/confirmed match: every payer gets their money back as credits (+ optional
    bonus per paid member), the slot is released. Returns total refunded (bonuses excluded).
    Caller commits."""
    lobby = await get_lobby(db, lobby.id, for_update=True)
    if lobby.status not in OPEN_LOBBY_STATUSES:
        raise LobbyClosed()
    now = utcnow()
    lobby.status = "cancelled"
    lobby.booking.status = "cancelled"
    lobby.booking.cancelled_at = now
    reason = note or "The match was cancelled"
    refunds = await _refund_everyone(db, lobby, kind=refund_kind, note=f"Refund — {lobby.title} cancelled",
                                     bonus_paise=bonus_paise)
    await _release_lobby_slot(db, lobby)
    for m in active_members(lobby):
        refunded = refunds.get(m.user_id, 0) + (bonus_paise if m.status == "paid" else 0)
        body = f"{reason}. {rupees(refunded)} is back in your Pytch Credits." if refunded else f"{reason}."
        await notify(db, m.user_id, "lobby_cancelled", f"{lobby.title} cancelled", body, _lobby_data(lobby))
    await post_system_message(db, lobby.id, f"❌ {reason}. Payments were refunded as credits.")
    _publish_update(db, lobby.id, "cancelled", None)
    await _emit(db, "lobby.cancelled", lobby_id=lobby.id)
    return sum(refunds.values())


async def complete_match(db: AsyncSession, lobby: Lobby) -> None:
    """confirmed → completed (idempotent); emits `match.completed`. Caller commits."""
    lobby = await get_lobby(db, lobby.id, for_update=True)
    if lobby.status == "completed":
        return
    if lobby.status != "confirmed":
        raise LobbyClosed("Only confirmed matches can be completed")
    lobby.status = "completed"
    lobby.completed_at = utcnow()
    lobby.booking.status = "completed"
    await post_system_message(db, lobby.id, "🏁 Full time! Rate your squad within 48 h to build True Skill.")
    _publish_update(db, lobby.id, "completed", None)
    await _emit(db, "match.completed", lobby_id=lobby.id)


async def transfer_to_slot(db: AsyncSession, lobby: Lobby, new_slot: Slot) -> Slot:
    """Move a lobby to `new_slot` (already locked + available by the caller). Returns the released
    old slot. A new booking row (transferred_from_id → old) takes over; members and money stay.
    The group keeps paying the original total — any price difference is Pytch's. Caller commits."""
    lobby = await get_lobby(db, lobby.id, for_update=True)
    if lobby.status not in OPEN_LOBBY_STATUSES:
        raise LobbyClosed()
    if new_slot.status != "available":
        raise slots_service.SlotUnavailable()
    now = utcnow()
    old_booking = lobby.booking
    old_slot = await slots_service.lock_slot_wait(db, lobby.slot_id)
    new_pitch = new_slot.pitch
    recorded = lobby.recorded and new_pitch.has_camera

    new_booking = Booking(
        id=uuid.uuid4(),
        code=await unique_code(db, Booking.code, booking_code),
        slot_id=new_slot.id,
        host_id=lobby.host_id,
        mode=lobby.mode,
        status=old_booking.status,
        pitch_fee_paise=new_slot.price_paise,
        recording_fee_paise=old_booking.recording_fee_paise if recorded else 0,
        total_paise=old_booking.total_paise,
        recorded=recorded,
        expires_at=old_booking.expires_at,
        confirmed_at=old_booking.confirmed_at,
        transferred_from_id=old_booking.id,
        created_at=now,
        updated_at=now,
    )
    db.add(new_booking)
    await db.flush()
    old_booking.status = "cancelled"
    old_booking.cancelled_at = now

    hold_until = lobby.pay_deadline or new_slot.start_at
    await slots_service.hold_slot(db, new_slot, user_id=lobby.host_id, until=hold_until, booking_id=new_booking.id)
    if lobby.status == "confirmed":
        await slots_service.book_slot(db, new_slot)
    await slots_service.release_slot(db, old_slot)

    lobby.booking_id = new_booking.id
    lobby.slot_id = new_slot.id
    lobby.pitch_id = new_pitch.id
    lobby.turf_id = new_pitch.turf_id
    lobby.start_at = new_slot.start_at
    lobby.end_at = new_slot.end_at
    lobby.recorded = recorded
    lobby = await get_lobby(db, lobby.id, refresh=True)
    await post_system_message(
        db, lobby.id,
        f"🔀 Match moved to {lobby.turf.name} · {lobby.pitch.name}, {kickoff_label(lobby.start_at)}",
    )
    _publish_update(db, lobby.id, "transferred", None)
    await _emit(db, "lobby.transferred", lobby_id=lobby.id, old_slot_id=old_slot.id, new_slot_id=new_slot.id)
    return old_slot


# ═══════════════════════════ worker helpers ═══════════════════════════


async def expire_due_lobbies(db: AsyncSession, *, batch: int = 100) -> int:
    """Expire forming lobbies whose payment window has passed (one transaction per lobby)."""
    now = utcnow()
    ids = (
        await db.scalars(
            select(Lobby.id)
            .where(Lobby.status == "forming", Lobby.pay_deadline.is_not(None), Lobby.pay_deadline < now)
            .order_by(Lobby.pay_deadline)
            .limit(batch)
        )
    ).all()
    done = 0
    for lobby_id in ids:
        try:
            lobby = await get_lobby(db, lobby_id, for_update=True)
            if lobby.status == "forming" and lobby.pay_deadline is not None and lobby.pay_deadline < utcnow():
                await expire_lobby(db, lobby)
                done += 1
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("expire: lobby %s failed", lobby_id)
    return done


async def release_expired_seats(db: AsyncSession) -> int:
    """Unpaid (joined) non-host seats past `reserved_until` → removed."""
    now = utcnow()
    lobby_ids = (
        await db.scalars(
            select(LobbyMember.lobby_id)
            .join(Lobby, Lobby.id == LobbyMember.lobby_id)
            .where(
                LobbyMember.status == "joined",
                LobbyMember.role != "host",
                LobbyMember.reserved_until.is_not(None),
                LobbyMember.reserved_until < now,
                Lobby.status.in_(OPEN_LOBBY_STATUSES),
            )
            .distinct()
        )
    ).all()
    released = 0
    for lobby_id in lobby_ids:
        try:
            lobby = await get_lobby(db, lobby_id, for_update=True)
            if lobby.status in OPEN_LOBBY_STATUSES:
                for m in list(active_members(lobby)):
                    if (m.status == "joined" and m.role != "host" and m.reserved_until is not None
                            and m.reserved_until < utcnow()):
                        await _release_seat(db, lobby, m, reason="payment not completed in time")
                        released += 1
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("seat release: lobby %s failed", lobby_id)
    return released


async def release_orphan_holds(db: AsyncSession, *, grace: timedelta = timedelta(minutes=2)) -> int:
    """Safety net: held slots whose hold lapsed and that no forming lobby owns → available."""
    cutoff = utcnow() - grace
    owned = exists().where(and_(Lobby.slot_id == Slot.id, Lobby.status == "forming"))
    slots = (
        (
            await db.execute(
                select(Slot)
                .where(Slot.status == "held", Slot.held_until.is_not(None), Slot.held_until < cutoff, ~owned)
                .with_for_update(skip_locked=True, of=Slot)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    for slot in slots:
        await slots_service.release_slot(db, slot)
    await db.commit()
    return len(slots)


async def complete_due_matches(db: AsyncSession, *, batch: int = 100) -> int:
    now = utcnow()
    ids = (
        await db.scalars(
            select(Lobby.id).where(Lobby.status == "confirmed", Lobby.end_at <= now).order_by(Lobby.end_at).limit(batch)
        )
    ).all()
    done = 0
    for lobby_id in ids:
        try:
            lobby = await get_lobby(db, lobby_id)
            await complete_match(db, lobby)
            await db.commit()
            done += 1
        except Exception:
            await db.rollback()
            logger.exception("complete: lobby %s failed", lobby_id)
    return done
