"""Partner earnings (estimated with the settlement formula) and settlement statements (read-only)."""

import uuid
from datetime import date, timedelta

from sqlalchemy import Float, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, Forbidden, NotFound
from app.core.timeutils import ist_day_bounds, ist_today, utcnow
from app.modules.bookings.models import Booking
from app.modules.channels.models import SlotBlock
from app.modules.coupons.models import Coupon
from app.modules.lobbies.models import Lobby
from app.modules.partner.deps import PartnerContext
from app.modules.partner.operations import PYTCH_COUNTED, revenue_series
from app.modules.partner.schemas import (
    EarningsByTurf,
    PartnerEarnings,
    SettlementDetail,
    SettlementLineOut,
    SettlementOut,
)
from app.modules.partner.scope import scoped_turfs
from app.modules.payments.models import Payment
from app.modules.providers.models import Provider
from app.modules.settlements.models import Settlement, SettlementLine
from app.modules.turfs.models import Pitch, Turf

MAX_RANGE_DAYS = 366


def estimate_net(provider: Provider, gross: int, provider_discounts: int = 0, refunds: int = 0) -> tuple[int, int]:
    """(commission, net) with the contract settlement formula (see docs/PORTALS_CONTRACT.md)."""
    commission = round(gross * provider.commission_bps / 10000)
    gst = round(commission * settings.gst_on_commission_bps / 10000)
    base = gross - refunds
    tcs = round(base * settings.tcs_bps / 10000)
    tds_bps = settings.tds_194o_bps if provider.pan_last4 else settings.tds_194o_no_pan_bps
    tds = round(base * tds_bps / 10000)
    return commission, gross - refunds - provider_discounts - commission - gst - tcs - tds


async def _provider_discounts(db: AsyncSession, lobby_filter: list) -> int:  # noqa: ANN001
    """Provider-funded share of coupon discounts on paid payments of the selected lobbies."""
    share = case(
        (Coupon.funded_by == "provider", 1.0),
        (Coupon.funded_by == "shared", cast(Coupon.provider_share_pct, Float) / 100.0),
        else_=0.0,
    )
    value = await db.scalar(
        select(func.coalesce(func.sum(Payment.discount_paise * share), 0))
        .select_from(Payment)
        .join(Coupon, Coupon.id == Payment.coupon_id)
        .join(Lobby, Lobby.id == Payment.lobby_id)
        .join(Booking, Booking.id == Lobby.booking_id)
        .where(Payment.status == "paid", *lobby_filter)
    )
    return int(round(float(value or 0)))


async def earnings(
    db: AsyncSession, ctx: PartnerContext, date_from: date | None, date_to: date | None
) -> PartnerEarnings:
    date_to = date_to or ist_today()
    date_from = date_from or date_to - timedelta(days=29)
    if date_from > date_to or (date_to - date_from).days > MAX_RANGE_DAYS:
        raise AppError("Choose a range of at most one year", code="VALIDATION_ERROR", status_code=422)
    turfs = await scoped_turfs(db, ctx)
    turf_ids = [t.id for t in turfs] or [uuid.uuid4()]
    lo, _ = ist_day_bounds(date_from)
    _, hi = ist_day_bounds(date_to)
    in_range = [Lobby.turf_id.in_(turf_ids), Booking.status.in_(PYTCH_COUNTED), Lobby.start_at >= lo,
                Lobby.start_at < hi]
    pytch = {tid: (int(n), int(g or 0)) for tid, n, g in (await db.execute(
        select(Lobby.turf_id, func.count(Booking.id), func.sum(Booking.pitch_fee_paise)).select_from(Lobby)
        .join(Booking, Booking.id == Lobby.booking_id).where(*in_range).group_by(Lobby.turf_id)
    )).all()}
    offline = {tid: (int(n), int(a or 0)) for tid, n, a in (await db.execute(
        select(Pitch.turf_id, func.count(SlotBlock.id), func.sum(SlotBlock.amount_paise)).select_from(SlotBlock)
        .join(Pitch, Pitch.id == SlotBlock.pitch_id)
        .where(Pitch.turf_id.in_(turf_ids), SlotBlock.kind == "booking", SlotBlock.status == "active",
               SlotBlock.start_at >= lo, SlotBlock.start_at < hi)
        .group_by(Pitch.turf_id)
    )).all()}
    gross = sum(g for _, g in pytch.values())
    disc = await _provider_discounts(db, in_range)
    commission, net = estimate_net(ctx.provider, gross, disc)

    # not yet in a statement: "unsettled" = played and past the settlement hold (goes into the next statement);
    # "upcoming" = confirmed games still to be played or inside the hold (not payable yet)
    settled = select(SettlementLine.booking_id)
    payable_from = utcnow() - timedelta(hours=settings.settlement_hold_hours)
    not_settled = [Lobby.turf_id.in_(turf_ids), Booking.status.in_(PYTCH_COUNTED), Booking.id.not_in(settled)]

    async def net_of(*extra: object) -> int:
        where = [*not_settled, *extra]
        gross_ = int(await db.scalar(
            select(func.coalesce(func.sum(Booking.pitch_fee_paise), 0)).select_from(Lobby)
            .join(Booking, Booking.id == Lobby.booking_id).where(*where)
        ) or 0)
        return max(estimate_net(ctx.provider, gross_, await _provider_discounts(db, where))[1], 0) if gross_ else 0

    unsettled_net = await net_of(Lobby.end_at <= payable_from)
    upcoming_net = await net_of(Lobby.end_at > payable_from)

    by_turf = [
        EarningsByTurf(turf_id=t.id, turf_name=t.name, pytch_gross_paise=pytch.get(t.id, (0, 0))[1],
                       offline_paise=offline.get(t.id, (0, 0))[1],
                       bookings=pytch.get(t.id, (0, 0))[0] + offline.get(t.id, (0, 0))[0])
        for t in turfs
    ]
    return PartnerEarnings(
        from_=date_from, to=date_to, pytch_gross_paise=gross, commission_paise=commission, pytch_net_paise=net,
        offline_revenue_paise=sum(a for _, a in offline.values()), unsettled_paise=unsettled_net,
        upcoming_paise=upcoming_net,
        by_turf=by_turf, series=await revenue_series(db, turf_ids, date_from, date_to),
    )


def _require_all_venues(ctx: PartnerContext) -> None:
    # statements cover every venue of the provider — not for venue-scoped staff
    if ctx.member.turf_ids is not None and ctx.role != "owner":
        raise Forbidden("Settlements cover all venues — ask the owner for access")


def settlement_out(s: Settlement) -> SettlementOut:
    return SettlementOut(
        id=s.id, period_start=s.period_start, period_end=s.period_end, booking_count=s.booking_count,
        gross_paise=s.gross_paise, refunds_paise=s.refunds_paise, provider_discounts_paise=s.provider_discounts_paise,
        commission_bps=s.commission_bps, commission_paise=s.commission_paise,
        gst_on_commission_paise=s.gst_on_commission_paise, tcs_paise=s.tcs_paise, tds_paise=s.tds_paise,
        net_payable_paise=s.net_payable_paise, status=s.status, paid_at=s.paid_at,  # type: ignore[arg-type]
        payout_ref=s.payout_ref,
    )


async def list_settlements(db: AsyncSession, ctx: PartnerContext) -> list[SettlementOut]:
    _require_all_venues(ctx)
    rows = (await db.scalars(
        select(Settlement).where(Settlement.provider_id == ctx.provider.id).order_by(Settlement.period_end.desc())
        .limit(200)
    )).unique().all()
    return [settlement_out(s) for s in rows]


async def settlement_detail(db: AsyncSession, ctx: PartnerContext, settlement_id: uuid.UUID) -> SettlementDetail:
    _require_all_venues(ctx)
    s = await db.get(Settlement, settlement_id)
    if s is None or s.provider_id != ctx.provider.id:
        raise NotFound("Settlement not found")
    rows = (await db.execute(
        select(SettlementLine, Booking.code, Turf.name)
        .join(Booking, Booking.id == SettlementLine.booking_id)
        .join(Turf, Turf.id == SettlementLine.turf_id)
        .where(SettlementLine.settlement_id == s.id)
        .order_by(SettlementLine.played_at)
    )).all()
    lines = [SettlementLineOut(booking_id=line.booking_id, booking_code=code, turf_name=turf_name,
                               played_at=line.played_at, gross_paise=line.gross_paise,
                               refunds_paise=line.refunds_paise,
                               provider_discounts_paise=line.provider_discounts_paise,
                               commission_paise=line.commission_paise) for line, code, turf_name in rows]
    return SettlementDetail(**settlement_out(s).model_dump(), lines=lines)
