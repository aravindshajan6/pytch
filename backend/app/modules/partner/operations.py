"""Partner operations: calendar grid, dashboard, bookings list (+CSV). Every query is scoped to the acting
provider's venues (and the member's venue scope); Pytch player phones are masked."""

import csv
import io
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import Integer, String, and_, cast, func, literal_column, null, or_, select, true, union_all
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, noload

from app.core.config import settings
from app.core.timeutils import ist_day_bounds, ist_today, to_ist, utcnow
from app.modules.admin.models import ApprovalRequest
from app.modules.bookings.models import Booking
from app.modules.channels.models import ChannelFeed, SlotBlock, SyncConflict
from app.modules.channels.service import SOURCE_LABELS
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.partner.deps import PartnerContext
from app.modules.partner.schemas import (
    BlockOccupancy,
    CalendarCell,
    CalendarEventBrief,
    CalendarTurf,
    CalendarView,
    ChannelMix,
    DashboardAlerts,
    HeatCell,
    PartnerBookingRow,
    PartnerBookingsPage,
    PartnerDashboard,
    PartnerPitchOut,
    PeriodStats,
    PytchOccupancy,
    RevenuePoint,
)
from app.modules.partner.scope import get_turf, scoped_turf_ids
from app.modules.providers.service import mask_phone
from app.modules.settlements.models import Settlement
from app.modules.slots.models import Slot
from app.modules.slots.service import _opening_hours
from app.modules.turfs.models import Pitch, Turf
from app.modules.turfs.service import pitch_out
from app.modules.users.models import User

PYTCH_COUNTED = ("confirmed", "completed")
PAID_MODES = ("cash", "upi", "card", "online_other")
TZ = settings.timezone


def _ist(col):  # noqa: ANN001, ANN202 - SQL expression helper
    return func.timezone(TZ, col)


async def _turf_filter(db: AsyncSession, ctx: PartnerContext, turf_id: uuid.UUID | None) -> list[uuid.UUID]:
    if turf_id is not None:
        return [(await get_turf(db, ctx, turf_id)).id]
    return await scoped_turf_ids(db, ctx)


# ─────────────────────────── calendar ───────────────────────────


async def calendar(db: AsyncSession, ctx: PartnerContext, turf_id: uuid.UUID, start_day: date | None,
                   days: int) -> CalendarView:
    """Cells for every slot of the venue's active pitches over 1–7 IST days (≈6 queries regardless of size).
    A switched-off pitch still shows up while it has bookings in range (occupied cells only — it isn't bookable),
    so deactivating a pitch never hides games that are still going to happen."""
    turf = await get_turf(db, ctx, turf_id)
    start_day = start_day or ist_today()
    start, _ = ist_day_bounds(start_day)
    _, end = ist_day_bounds(start_day + timedelta(days=days - 1))
    inactive = [p.id for p in turf.pitches if not p.is_active]
    busy_inactive = set((await db.scalars(
        select(Slot.pitch_id).distinct().where(Slot.pitch_id.in_(inactive), Slot.start_at >= start,
                                               Slot.start_at < end, Slot.status != "available")
    )).all()) if inactive else set()
    pitches = sorted((p for p in turf.pitches if p.is_active or p.id in busy_inactive), key=lambda p: p.name)
    occupied_only = [Slot.pitch_id.not_in(busy_inactive), Slot.status != "available"]
    slots = (
        (
            await db.execute(
                select(Slot)
                .options(noload(Slot.pitch))
                .where(Slot.pitch_id.in_([p.id for p in pitches] or [uuid.uuid4()]), Slot.start_at >= start,
                       Slot.start_at < end, or_(*occupied_only) if busy_inactive else true())
                .order_by(Slot.start_at, Slot.pitch_id)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    booking_ids = {s.booking_id for s in slots if s.booking_id and s.status in ("held", "booked")}
    block_ids = {s.block_id for s in slots if s.block_id and s.status == "blocked"}
    lobbies: dict[uuid.UUID, Lobby] = {}
    paid: dict[uuid.UUID, int] = {}
    if booking_ids:
        rows = (
            await db.execute(
                select(Lobby)
                .options(noload(Lobby.members), noload(Lobby.pitch), noload(Lobby.turf))
                .where(Lobby.booking_id.in_(booking_ids))
            )
        ).unique().scalars().all()
        lobbies = {lobby.booking_id: lobby for lobby in rows}
        paid = dict(
            (
                await db.execute(
                    select(LobbyMember.lobby_id, func.count(LobbyMember.id))
                    .where(LobbyMember.lobby_id.in_([lb.id for lb in rows]), LobbyMember.status == "paid")
                    .group_by(LobbyMember.lobby_id)
                )
            ).all()
        ) if rows else {}
    blocks: dict[uuid.UUID, SlotBlock] = {}
    if block_ids:
        blocks = {b.id: b for b in (await db.scalars(select(SlotBlock).where(SlotBlock.id.in_(block_ids)))).all()}
    conflicted: set[uuid.UUID] = set()
    if slots:
        conflicted = set(
            (
                await db.scalars(
                    select(SyncConflict.slot_id).where(
                        SyncConflict.slot_id.in_([s.id for s in slots]), SyncConflict.status == "open"
                    )
                )
            ).all()
        )

    cells: list[CalendarCell] = []
    for s in slots:
        occupancy: PytchOccupancy | BlockOccupancy | None = None
        if s.status in ("held", "booked") and s.booking_id in lobbies:
            lobby = lobbies[s.booking_id]  # type: ignore[index]
            occupancy = PytchOccupancy(
                lobby_id=lobby.id, booking_code=lobby.booking.code, lobby_title=lobby.title,
                lobby_status=lobby.status, host_name=lobby.host.name,  # type: ignore[arg-type]
                paid_spots=paid.get(lobby.id, 0), total_spots=lobby.total_spots,
                amount_paise=lobby.booking.pitch_fee_paise,
            )
        elif s.status == "blocked" and s.block_id in blocks:
            b = blocks[s.block_id]  # type: ignore[index]
            occupancy = BlockOccupancy(
                block_id=b.id, block_kind=b.kind, source=b.source, customer_name=b.customer_name,  # type: ignore[arg-type]
                customer_phone=b.customer_phone, amount_paise=b.amount_paise,
                payment_mode=b.payment_mode, notes=b.notes, external_ref=b.external_ref,  # type: ignore[arg-type]
                starts_before=b.start_at < s.start_at, ends_after=b.end_at > s.end_at,
            )
        cells.append(CalendarCell(
            slot_id=s.id, pitch_id=s.pitch_id, start_at=s.start_at, end_at=s.end_at, price_paise=s.price_paise,
            is_peak=s.is_peak, status=s.status,  # type: ignore[arg-type]
            held_until=s.held_until if s.status == "held" else None, occupancy=occupancy,
            has_conflict=s.id in conflicted,
        ))
    return CalendarView(
        turf=CalendarTurf(id=turf.id, name=turf.name, open_time=turf.open_time.strftime("%H:%M"),
                          close_time=turf.close_time.strftime("%H:%M")),
        pitches=[PartnerPitchOut(**pitch_out(p).model_dump(), is_active=p.is_active) for p in pitches],
        from_=start_day,
        days=days,
        cells=cells,
    )


# ─────────────────────────── dashboard ───────────────────────────


def _period_bounds() -> dict[str, tuple[datetime, datetime]]:
    today = ist_today()
    monday = today - timedelta(days=today.weekday())
    first = today.replace(day=1)
    next_month = (first + timedelta(days=32)).replace(day=1)
    return {
        "today": (ist_day_bounds(today)[0], ist_day_bounds(today)[1]),
        "week": (ist_day_bounds(monday)[0], ist_day_bounds(monday + timedelta(days=6))[1]),
        "month": (ist_day_bounds(first)[0], ist_day_bounds(next_month - timedelta(days=1))[1]),
    }


async def _period_stats(db: AsyncSession, turf_ids: list[uuid.UUID]) -> dict[str, PeriodStats]:
    periods = _period_bounds()
    lo = min(a for a, _ in periods.values())
    hi = max(b for _, b in periods.values())

    def within(col, key: str):  # noqa: ANN001, ANN202
        a, b = periods[key]
        return and_(col >= a, col < b)

    pytch_cols = []
    for key in periods:
        pytch_cols += [func.count(Booking.id).filter(within(Lobby.start_at, key)),
                       func.coalesce(func.sum(Booking.pitch_fee_paise).filter(within(Lobby.start_at, key)), 0)]
    pytch = (await db.execute(
        select(*pytch_cols).select_from(Lobby).join(Booking, Booking.id == Lobby.booking_id)
        .where(Lobby.turf_id.in_(turf_ids), Booking.status.in_(PYTCH_COUNTED), Lobby.start_at >= lo,
               Lobby.start_at < hi)
    )).one()

    offline_cols = []
    for key in periods:
        offline_cols += [func.count(SlotBlock.id).filter(within(SlotBlock.start_at, key)),
                         func.coalesce(func.sum(SlotBlock.amount_paise).filter(within(SlotBlock.start_at, key)), 0)]
    offline = (await db.execute(
        select(*offline_cols).select_from(SlotBlock).join(Pitch, Pitch.id == SlotBlock.pitch_id)
        .where(Pitch.turf_id.in_(turf_ids), SlotBlock.kind == "booking", SlotBlock.status == "active",
               SlotBlock.start_at >= lo, SlotBlock.start_at < hi)
    )).one()

    maintenance = and_(Slot.status == "blocked", SlotBlock.kind == "block")
    occupied = or_(Slot.status.in_(("held", "booked")), and_(Slot.status == "blocked", SlotBlock.kind == "booking"))
    occ_cols = []
    for key in periods:
        occ_cols += [func.count(Slot.id).filter(within(Slot.start_at, key), ~maintenance),
                     func.count(Slot.id).filter(within(Slot.start_at, key), occupied)]
    occ = (await db.execute(
        select(*occ_cols).select_from(Slot).join(Pitch, Pitch.id == Slot.pitch_id)
        .outerjoin(SlotBlock, SlotBlock.id == Slot.block_id)
        .where(Pitch.turf_id.in_(turf_ids), Pitch.is_active.is_(True), Slot.start_at >= lo, Slot.start_at < hi)
    )).one()

    out = {}
    for i, key in enumerate(periods):
        p_count, p_rev = int(pytch[2 * i]), int(pytch[2 * i + 1])
        o_count, o_rev = int(offline[2 * i]), int(offline[2 * i + 1])
        open_slots, occupied_slots = int(occ[2 * i]), int(occ[2 * i + 1])
        out[key] = PeriodStats(
            bookings=p_count + o_count, pytch_bookings=p_count, offline_bookings=o_count,
            revenue_paise=p_rev + o_rev,
            occupancy_pct=round(100 * occupied_slots / open_slots, 1) if open_slots else 0.0,
        )
    return out


async def revenue_series(db: AsyncSession, turf_ids: list[uuid.UUID], first: date, last: date) -> list[RevenuePoint]:
    lo, _ = ist_day_bounds(first)
    _, hi = ist_day_bounds(last)
    pytch_day = func.date(_ist(Lobby.start_at))
    pytch = dict((await db.execute(
        select(pytch_day, func.sum(Booking.pitch_fee_paise)).select_from(Lobby)
        .join(Booking, Booking.id == Lobby.booking_id)
        .where(Lobby.turf_id.in_(turf_ids), Booking.status.in_(PYTCH_COUNTED), Lobby.start_at >= lo,
               Lobby.start_at < hi)
        .group_by(pytch_day)
    )).all())
    block_day = func.date(_ist(SlotBlock.start_at))
    offline = dict((await db.execute(
        select(block_day, func.sum(SlotBlock.amount_paise)).select_from(SlotBlock)
        .join(Pitch, Pitch.id == SlotBlock.pitch_id)
        .where(Pitch.turf_id.in_(turf_ids), SlotBlock.kind == "booking", SlotBlock.status == "active",
               SlotBlock.start_at >= lo, SlotBlock.start_at < hi)
        .group_by(block_day)
    )).all())
    series = []
    day = first
    while day <= last:
        series.append(RevenuePoint(date=day, pytch_paise=int(pytch.get(day) or 0),
                                   offline_paise=int(offline.get(day) or 0)))
        day += timedelta(days=1)
    return series


async def _heatmap(db: AsyncSession, turf_ids: list[uuid.UUID]) -> list[HeatCell]:
    """Occupied share per (weekday, hour) over the last 8 weeks. Denominator = active pitches × 8 for every
    opening hour (robust even where past slots were never materialised)."""
    now = utcnow()
    lo = now - timedelta(weeks=8)
    dow = func.extract("isodow", _ist(Slot.start_at))
    hour = func.extract("hour", _ist(Slot.start_at))
    occupied = or_(Slot.status.in_(("held", "booked")), and_(Slot.status == "blocked", SlotBlock.kind == "booking"))
    rows = (await db.execute(
        select(dow, hour, func.count(Slot.id)).select_from(Slot).join(Pitch, Pitch.id == Slot.pitch_id)
        .outerjoin(SlotBlock, SlotBlock.id == Slot.block_id)
        .where(Pitch.turf_id.in_(turf_ids), Slot.start_at >= lo, Slot.start_at < now, occupied)
        .group_by(dow, hour)
    )).all()
    counts = {(int(d) - 1, int(h)): int(n) for d, h, n in rows}
    turfs = (await db.execute(select(Turf).where(Turf.id.in_(turf_ids)))).unique().scalars().all()
    capacity: dict[int, int] = defaultdict(int)  # hour → active pitches open at that hour
    for t in turfs:
        first, last = _opening_hours(t)
        n = sum(1 for p in t.pitches if p.is_active)
        for h in range(first, last):
            capacity[h] += n
    cells = []
    for wd in range(7):
        for h in sorted(capacity):
            denom = capacity[h] * 8
            if denom:
                pct = round(min(100.0, 100 * counts.get((wd, h), 0) / denom), 1)
                cells.append(HeatCell(weekday=wd, hour=h, pct=pct))
    return cells


async def _channel_mix(db: AsyncSession, turf_ids: list[uuid.UUID]) -> list[ChannelMix]:
    """Bookings by channel whose game started in the last 30 days (never future bookings)."""
    now = utcnow()
    lo = now - timedelta(days=30)
    pytch = await db.scalar(
        select(func.count(Lobby.id)).join(Booking, Booking.id == Lobby.booking_id)
        .where(Lobby.turf_id.in_(turf_ids), Booking.status.in_(PYTCH_COUNTED), Lobby.start_at >= lo,
               Lobby.start_at < now)
    ) or 0
    rows = (await db.execute(
        select(SlotBlock.source, func.count(SlotBlock.id)).join(Pitch, Pitch.id == SlotBlock.pitch_id)
        .where(Pitch.turf_id.in_(turf_ids), SlotBlock.kind == "booking", SlotBlock.status == "active",
               SlotBlock.start_at >= lo, SlotBlock.start_at < now)
        .group_by(SlotBlock.source)
    )).all()
    mix = [ChannelMix(source="pytch", count=int(pytch))] + [
        ChannelMix(source=src, count=int(n)) for src, n in rows  # type: ignore[arg-type]
    ]
    return sorted(mix, key=lambda m: -m.count)


async def _upcoming(db: AsyncSession, turf_ids: list[uuid.UUID], limit: int = 8) -> list[CalendarEventBrief]:
    now = utcnow()
    lobbies = (await db.execute(
        select(Lobby).options(noload(Lobby.members), noload(Lobby.host), noload(Lobby.booking))
        .where(Lobby.turf_id.in_(turf_ids), Lobby.status.in_(("forming", "confirmed")), Lobby.end_at > now)
        .order_by(Lobby.start_at).limit(limit)
    )).unique().scalars().all()
    blocks = (await db.execute(
        select(SlotBlock, Pitch).join(Pitch, Pitch.id == SlotBlock.pitch_id)
        .where(Pitch.turf_id.in_(turf_ids), SlotBlock.status == "active", SlotBlock.end_at > now)
        .order_by(SlotBlock.start_at).limit(limit)
    )).unique().all()
    events = [CalendarEventBrief(pitch_name=lb.pitch.name, turf_name=lb.turf.name, start_at=lb.start_at,
                                 end_at=lb.end_at, kind="pytch", title=lb.title, source="pytch") for lb in lobbies]
    for b, p in blocks:
        events.append(CalendarEventBrief(
            pitch_name=p.name, turf_name=p.turf.name, start_at=b.start_at, end_at=b.end_at, kind="block",
            title=b.customer_name or SOURCE_LABELS.get(b.source, b.source), source=b.source,
        ))
    return sorted(events, key=lambda e: e.start_at)[:limit]


async def dashboard(db: AsyncSession, ctx: PartnerContext, turf_id: uuid.UUID | None) -> PartnerDashboard:
    turf_ids = await _turf_filter(db, ctx, turf_id) or [uuid.uuid4()]
    stats = await _period_stats(db, turf_ids)
    today = ist_today()
    pitch_ids = select(Pitch.id).where(Pitch.turf_id.in_(turf_ids))
    open_conflicts = await db.scalar(select(func.count(SyncConflict.id)).where(
        SyncConflict.provider_id == ctx.provider.id, SyncConflict.status == "open",
        SyncConflict.pitch_id.in_(pitch_ids))) or 0
    failing_feeds = await db.scalar(select(func.count(ChannelFeed.id)).where(
        ChannelFeed.provider_id == ctx.provider.id, ChannelFeed.last_status == "error",
        ChannelFeed.is_active.is_(True), ChannelFeed.pitch_id.in_(pitch_ids))) or 0
    pending_payout = await db.scalar(select(func.coalesce(func.sum(Settlement.net_payable_paise), 0)).where(
        Settlement.provider_id == ctx.provider.id, Settlement.status.in_(("draft", "approved")))) or 0
    # approvals requested by THIS provider (not by other businesses the user belongs to)
    is_bank = ApprovalRequest.action == "provider.bank_change"
    bank_changes, other_changes = (await db.execute(
        select(func.count(ApprovalRequest.id).filter(is_bank), func.count(ApprovalRequest.id).filter(~is_bank))
        .where(ApprovalRequest.requested_by_provider_id == ctx.provider.id, ApprovalRequest.status == "pending")
    )).one()
    return PartnerDashboard(
        today=stats["today"], week=stats["week"], month=stats["month"],
        upcoming=await _upcoming(db, turf_ids),
        alerts=DashboardAlerts(open_conflicts=int(open_conflicts), failing_feeds=int(failing_feeds),
                               pending_payout_paise=int(pending_payout),
                               pending_application=bool(other_changes),
                               pending_bank_change=bool(bank_changes),
                               payouts_on_hold=bool(ctx.provider.payouts_on_hold)),
        revenue_series=await revenue_series(db, turf_ids, today - timedelta(days=13), today),
        occupancy_heatmap=await _heatmap(db, turf_ids),
        channel_mix=await _channel_mix(db, turf_ids),
    )


# ─────────────────────────── bookings list ───────────────────────────


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


_PHONEISH = re.compile(r"^[\d\s+\-().]+$")


def _digits(col):  # noqa: ANN001, ANN202 - SQL expression helper: a phone column reduced to its digits
    return func.regexp_replace(func.coalesce(col, ""), r"\D", "", "g")


def _bookings_union(turf_ids: list[uuid.UUID], *, status: str | None, source: str | None, date_from: date | None,
                    date_to: date | None, q: str | None, include_closures: bool = False):  # noqa: ANN202
    host = aliased(User)
    players = (select(func.count(LobbyMember.id))
               .where(LobbyMember.lobby_id == Lobby.id, LobbyMember.status.in_(("joined", "paid")))
               .correlate(Lobby).scalar_subquery())
    paid = (select(func.count(LobbyMember.id)).where(LobbyMember.lobby_id == Lobby.id, LobbyMember.status == "paid")
            .correlate(Lobby).scalar_subquery())
    pytch = (
        select(
            Booking.id.label("id"), literal_column("'pytch'").label("kind"), Booking.code.label("ref"),
            Turf.name.label("turf_name"), Pitch.name.label("pitch_name"), Lobby.start_at.label("start_at"),
            Lobby.end_at.label("end_at"), host.name.label("customer_name"), host.phone.label("customer_phone"),
            players.label("players"), cast(literal_column("'pytch'"), String).label("source"),
            Booking.pitch_fee_paise.label("amount_paise"), cast(Booking.status, String).label("status"),
            Lobby.id.label("lobby_id"), cast(Lobby.status, String).label("lobby_status"), paid.label("paid_count"),
            cast(null(), String).label("payment_mode"), cast(null(), String).label("block_kind"),
        )
        .select_from(Lobby)
        .join(Booking, Booking.id == Lobby.booking_id)
        .join(Turf, Turf.id == Lobby.turf_id)
        .join(Pitch, Pitch.id == Lobby.pitch_id)
        .join(host, host.id == Lobby.host_id)
        .where(Lobby.turf_id.in_(turf_ids))
    )
    offline = (
        select(
            SlotBlock.id.label("id"), literal_column("'offline'").label("kind"),
            func.upper(func.substr(cast(SlotBlock.id, String), 1, 8)).label("ref"), Turf.name.label("turf_name"),
            Pitch.name.label("pitch_name"), SlotBlock.start_at.label("start_at"), SlotBlock.end_at.label("end_at"),
            func.coalesce(SlotBlock.customer_name, "").label("customer_name"),
            cast(SlotBlock.customer_phone, String).label("customer_phone"), cast(null(), Integer).label("players"),
            cast(SlotBlock.source, String).label("source"), SlotBlock.amount_paise.label("amount_paise"),
            cast(SlotBlock.status, String).label("status"), cast(null(), PG_UUID(as_uuid=True)).label("lobby_id"),
            cast(null(), String).label("lobby_status"), cast(null(), Integer).label("paid_count"),
            cast(SlotBlock.payment_mode, String).label("payment_mode"),
            cast(SlotBlock.kind, String).label("block_kind"),
        )
        .select_from(SlotBlock)
        .join(Pitch, Pitch.id == SlotBlock.pitch_id)
        .join(Turf, Turf.id == Pitch.turf_id)
        .where(Pitch.turf_id.in_(turf_ids))
    )
    # closures (maintenance / plain blocks) aren't bookings: only on request (or when filtering for maintenance)
    if not include_closures and source != "maintenance":
        offline = offline.where(SlotBlock.kind == "booking")
    # an imported booking that couldn't claim a slot (it lost a clash) is not a booking either — see Channels
    if status != "conflicted":
        offline = offline.where(SlotBlock.status != "conflicted")
    if status:
        pytch = pytch.where(Booking.status == status)
        offline = offline.where(SlotBlock.status == status)
    if date_from:
        pytch = pytch.where(Lobby.start_at >= ist_day_bounds(date_from)[0])
        offline = offline.where(SlotBlock.start_at >= ist_day_bounds(date_from)[0])
    if date_to:
        pytch = pytch.where(Lobby.start_at < ist_day_bounds(date_to)[1])
        offline = offline.where(SlotBlock.start_at < ist_day_bounds(date_to)[1])
    if q and q.strip():
        term = q.strip()
        like = f"%{_escape_like(term)}%"
        pytch_match = [host.name.ilike(like, escape="\\"), Booking.code.ilike(like, escape="\\"),
                       Lobby.title.ilike(like, escape="\\")]
        offline_match = [SlotBlock.customer_name.ilike(like, escape="\\"),
                         SlotBlock.customer_phone.ilike(like, escape="\\"),
                         SlotBlock.notes.ilike(like, escape="\\"), SlotBlock.external_ref.ilike(like, escape="\\")]
        digits = re.sub(r"\D", "", term)
        if _PHONEISH.match(term) and len(digits) >= 3:  # "+91 98470 12345", "98470-12345", "12345" …
            tail = digits[-10:]
            offline_match.append(_digits(SlotBlock.customer_phone).like(f"%{tail}%"))
            # Pytch players' numbers are masked in the list: only a full number finds them (no digit-by-digit
            # probing of the hidden part), and the row still shows the masked number
            if len(digits) >= 10:
                pytch_match.append(func.right(_digits(host.phone), 10) == tail)
        pytch = pytch.where(or_(*pytch_match))
        offline = offline.where(or_(*offline_match))
    if source == "pytch":
        parts = [pytch]
    elif source:
        parts = [offline.where(SlotBlock.source == source)]
    else:
        parts = [pytch, offline]
    return union_all(*parts).subquery() if len(parts) > 1 else parts[0].subquery()


def _payment_status(row) -> str:  # noqa: ANN001
    if row.kind == "pytch":
        if row.lobby_status in ("cancelled", "expired"):
            return "refunded" if (row.paid_count or 0) > 0 else "unpaid"
        if row.lobby_status in ("confirmed", "completed"):
            return "paid"
        return "partially_paid" if (row.paid_count or 0) > 0 else "pending"
    return "paid" if row.payment_mode in PAID_MODES else "unpaid"


def _row_out(row) -> PartnerBookingRow:  # noqa: ANN001
    is_pytch = row.kind == "pytch"
    return PartnerBookingRow(
        id=row.id, kind=row.kind, ref=row.ref, turf_name=row.turf_name, pitch_name=row.pitch_name,
        start_at=row.start_at, end_at=row.end_at,
        customer_name=row.customer_name or SOURCE_LABELS.get(row.source, row.source),
        customer_phone=mask_phone(row.customer_phone) if is_pytch else row.customer_phone,
        players=row.players, source=row.source, amount_paise=row.amount_paise,
        payment_status=_payment_status(row),  # type: ignore[arg-type]
        status=row.status, lobby_id=row.lobby_id, block_kind=row.block_kind,
    )


async def list_bookings(db: AsyncSession, ctx: PartnerContext, *, turf_id: uuid.UUID | None, status: str | None,
                        source: str | None, date_from: date | None, date_to: date | None, q: str | None,
                        limit: int, offset: int, include_closures: bool = False) -> PartnerBookingsPage:
    turf_ids = await _turf_filter(db, ctx, turf_id) or [uuid.uuid4()]
    sub = _bookings_union(turf_ids, status=status, source=source, date_from=date_from, date_to=date_to, q=q,
                          include_closures=include_closures)
    total = int(await db.scalar(select(func.count()).select_from(sub)) or 0)
    rows = (await db.execute(
        select(sub).order_by(sub.c.start_at.desc(), sub.c.id).limit(limit).offset(offset)
    )).all()
    return PartnerBookingsPage(items=[_row_out(r) for r in rows], total=total, limit=limit, offset=offset)


def _csv_safe(value: object) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text  # CSV/formula injection


def _csv_phone(phone: str | None) -> str:
    """Indian numbers in national format ("98470 12345", masked "98••• ••210") — no leading "+" for a spreadsheet
    to read as a formula, and no "'" guard cluttering every row. Anything else goes through `_csv_safe`."""
    if not phone:
        return ""
    if phone.startswith("+91"):
        rest = phone[3:].strip()
        if re.fullmatch(r"\d{10}", rest):
            return f"{rest[:5]} {rest[5:]}"
        if rest[:1].isdigit():
            return rest
    return _csv_safe(phone)


async def export_bookings_csv(db: AsyncSession, ctx: PartnerContext, **filters: object) -> str:
    page = await list_bookings(db, ctx, limit=5000, offset=0, **filters)  # type: ignore[arg-type]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Ref", "Kind", "Source", "Venue", "Pitch", "Date", "Start", "End", "Customer", "Phone",
                     "Players", "Amount (INR)", "Payment", "Status"])
    for r in page.items:
        s, e = to_ist(r.start_at), to_ist(r.end_at)
        writer.writerow([
            *(_csv_safe(v) for v in (r.ref, r.kind, SOURCE_LABELS.get(r.source, r.source), r.turf_name, r.pitch_name,
                                     s.strftime("%Y-%m-%d"), s.strftime("%H:%M"), e.strftime("%H:%M"),
                                     r.customer_name)),
            _csv_phone(r.customer_phone),
            *(_csv_safe(v) for v in (r.players if r.players is not None else "", f"{r.amount_paise / 100:.2f}",
                                     r.payment_status, r.status)),
        ])
    return buf.getvalue()
