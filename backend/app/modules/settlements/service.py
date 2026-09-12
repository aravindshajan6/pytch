"""Provider settlements (payout statements) — contract §Settlement maths.

A Pytch booking at a provider's venue becomes payable once `slot.end_at + SETTLEMENT_HOLD_HOURS`
has passed. Each booking is settled at most once (`settlement_lines.booking_id` is unique).

    gross          = Σ pitch fee of confirmed/completed Pytch bookings
    refunds        = Σ admin refunds on those bookings (venue-borne; rain-checks cancel the booking → 0)
    provider_disc  = Σ provider-funded share of coupon discounts on those bookings
    commission     = round(gross × commission_bps / 10000)
    gst_on_comm    = round(commission × 18 %)
    tcs            = round((gross − refunds) × 0.5 %)          GST s.52
    tds            = round((gross − refunds) × 0.1 %)          s.194-O (5 % without PAN)
    net_payable    = gross − refunds − provider_disc + adjustments − commission − gst − tcs − tds

draft → approved (a different admin than the generator) → paid (Razorpay Route / manual NEFT) | failed.
Payouts are blocked while `provider.payouts_on_hold` (e.g. a bank-detail change awaits approval).
"""

import csv
import io
import re
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.core.errors import AppError, BadRequest, Conflict, NotFound
from app.core.logging import logger
from app.core.timeutils import ist_day_bounds, ist_today, utcnow
from app.modules.admin.auditing import Actor, audit
from app.modules.admin.errors import SelfApproval
from app.modules.admin.models import AdminUser
from app.modules.bookings.models import Booking
from app.modules.coupons.models import Coupon, CouponRedemption
from app.modules.lobbies.models import Lobby
from app.modules.payments.models import Payment
from app.modules.payments.providers import ProviderError, create_transfer
from app.modules.providers.models import Provider
from app.modules.settlements.models import Settlement, SettlementLine
from app.modules.settlements.schemas import (
    AdminSettlementDetail,
    AdminSettlementRow,
    PaySettlement,
    SettlementDetail,
    SettlementLineOut,
    SettlementOut,
)
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf

PAYABLE_BOOKING_STATUSES = ("confirmed", "completed")
# NEFT UTRs are 16 characters, RTGS 22, IMPS references (RRN) 12 digits → 12–22 letters/digits.
# Mirrored by UTR_RE in frontend/src/admin/pages/settlements/SettlementDetail.tsx.
_UTR = re.compile(r"^[A-Za-z0-9]{12,22}$")


class PayoutFailed(AppError):
    code, status_code, message = "PAYMENT_FAILED", 502, "The payout could not be sent"


def bps_of(amount: int, bps: int) -> int:
    """round(amount × bps / 10000), half-up, integer paise."""
    if amount < 0:
        return -bps_of(-amount, bps)
    return (amount * bps + 5000) // 10000


def has_pan(provider: Provider) -> bool:
    return bool(provider.pan_last4 or provider.pan_enc)


def recompute(settlement: Settlement, provider: Provider) -> None:
    """Totals from the lines (idempotent)."""
    lines = list(settlement.lines)
    gross = sum(line.gross_paise for line in lines)
    refunds = sum(line.refunds_paise for line in lines)
    provider_disc = sum(line.provider_discounts_paise for line in lines)
    commission = bps_of(gross, settlement.commission_bps)
    gst = bps_of(commission, settings.gst_on_commission_bps)
    taxable = max(gross - refunds, 0)
    tcs = bps_of(taxable, settings.tcs_bps)
    tds = bps_of(taxable, settings.tds_194o_bps if has_pan(provider) else settings.tds_194o_no_pan_bps)
    settlement.booking_count = len(lines)
    settlement.gross_paise = gross
    settlement.refunds_paise = refunds
    settlement.provider_discounts_paise = provider_disc
    settlement.commission_paise = commission
    settlement.gst_on_commission_paise = gst
    settlement.tcs_paise = tcs
    settlement.tds_paise = tds
    settlement.net_payable_paise = (gross - refunds - provider_disc + (settlement.adjustments_paise or 0)
                                    - commission - gst - tcs - tds)


# ═══════════════════════════ generation ═══════════════════════════


async def _eligible_bookings(db: AsyncSession, provider_id: uuid.UUID, start_utc: datetime, end_utc: datetime):
    cutoff = utcnow() - timedelta(hours=settings.settlement_hold_hours)
    stmt = (
        select(Booking.id, Booking.pitch_fee_paise, Slot.start_at, Turf.id.label("turf_id"), Lobby.id.label("lobby_id"))
        .join(Slot, Slot.id == Booking.slot_id)
        .join(Pitch, Pitch.id == Slot.pitch_id)
        .join(Turf, Turf.id == Pitch.turf_id)
        .join(Lobby, Lobby.booking_id == Booking.id)
        .where(
            Turf.provider_id == provider_id,
            Booking.status.in_(PAYABLE_BOOKING_STATUSES),
            Slot.end_at < cutoff,
            Slot.start_at >= start_utc,
            Slot.start_at < end_utc,
            ~exists(select(SettlementLine.id).where(SettlementLine.booking_id == Booking.id)),
        )
        .order_by(Slot.start_at)
    )
    return (await db.execute(stmt)).all()


async def _refunds_by_lobby(db: AsyncSession, lobby_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not lobby_ids:
        return {}
    refunded = func.coalesce(Payment.meta["refunded_paise"].as_integer(), 0)
    rows = await db.execute(
        select(Payment.lobby_id, func.coalesce(func.sum(refunded), 0))
        .where(Payment.lobby_id.in_(lobby_ids))
        .group_by(Payment.lobby_id)
    )
    return {lid: int(v) for lid, v in rows.all()}


async def _provider_discounts_by_lobby(db: AsyncSession, lobby_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not lobby_ids:
        return {}
    rows = await db.execute(
        select(CouponRedemption.lobby_id, Coupon.funded_by, Coupon.provider_share_pct,
               func.sum(CouponRedemption.discount_paise))
        .join(Coupon, Coupon.id == CouponRedemption.coupon_id)
        .where(CouponRedemption.lobby_id.in_(lobby_ids), CouponRedemption.status == "applied",
               Coupon.funded_by != "platform")
        .group_by(CouponRedemption.lobby_id, Coupon.funded_by, Coupon.provider_share_pct)
    )
    out: dict[uuid.UUID, int] = {}
    for lobby_id, funded_by, pct, total in rows.all():
        share = int(total) if funded_by == "provider" else int(total) * int(pct or 0) // 100
        out[lobby_id] = out.get(lobby_id, 0) + share
    return out


async def generate_for_provider(
    db: AsyncSession, provider_id: uuid.UUID, period_start: date, period_end: date, *,
    generated_by: uuid.UUID | None,
) -> tuple[Settlement | None, int]:
    """Create (or extend a draft) settlement for one provider/period. Returns (settlement, lines added).
    The provider row is locked so concurrent generations serialise. Caller commits."""
    provider = await db.scalar(select(Provider).where(Provider.id == provider_id).with_for_update())
    if provider is None:
        raise NotFound("Provider not found")
    start_utc, _ = ist_day_bounds(period_start)
    _, end_utc = ist_day_bounds(period_end)
    rows = await _eligible_bookings(db, provider.id, start_utc, end_utc)
    if not rows:
        return None, 0
    settlement = await db.scalar(
        select(Settlement)
        .where(Settlement.provider_id == provider.id, Settlement.period_start == period_start,
               Settlement.period_end == period_end)
        .with_for_update()
    )
    if settlement is not None and settlement.status != "draft":
        logger.info("settlement %s is %s — %d eligible bookings wait for another period", settlement.id,
                    settlement.status, len(rows))
        return None, 0
    now = utcnow()
    if settlement is None:
        settlement = Settlement(
            id=uuid.uuid4(), provider_id=provider.id, period_start=period_start, period_end=period_end,
            commission_bps=provider.commission_bps, adjustments_paise=0, status="draft",
            generated_by_admin_id=generated_by, created_at=now, updated_at=now,
        )
        settlement.lines = []
        db.add(settlement)
    lobby_ids = [r.lobby_id for r in rows]
    refunds = await _refunds_by_lobby(db, lobby_ids)
    discounts = await _provider_discounts_by_lobby(db, lobby_ids)
    for r in rows:
        gross = int(r.pitch_fee_paise)
        settlement.lines.append(SettlementLine(
            id=uuid.uuid4(), booking_id=r.id, turf_id=r.turf_id, played_at=r.start_at, gross_paise=gross,
            refunds_paise=min(refunds.get(r.lobby_id, 0), gross),
            provider_discounts_paise=min(discounts.get(r.lobby_id, 0), gross),
            commission_paise=bps_of(gross, settlement.commission_bps), created_at=now,
        ))
    recompute(settlement, provider)
    await db.flush()
    return settlement, len(rows)


async def generate(
    db: AsyncSession, ctx: Actor | None, *, period_start: date, period_end: date,
    provider_id: uuid.UUID | None = None,
) -> list[Settlement]:
    if period_end >= ist_today():
        raise BadRequest("The period must have ended (period_end before today)")
    if provider_id is not None:
        provider = await db.get(Provider, provider_id)
        if provider is None:
            raise NotFound("Provider not found")
        if provider.status not in ("approved", "suspended"):
            raise Conflict("Only approved (or suspended) providers are settled")
        providers = [provider]
    else:
        providers = list((await db.scalars(
            select(Provider).where(Provider.status.in_(("approved", "suspended"))).order_by(Provider.name))).all())
    out: list[Settlement] = []
    for provider in providers:
        settlement, added = await generate_for_provider(
            db, provider.id, period_start, period_end, generated_by=ctx.admin.id if ctx else None)
        if settlement is None:
            continue
        out.append(settlement)
        await audit(db, ctx, "settlement.generate",
                    f"Settlement {period_start}–{period_end} for {provider.name}: +{added} bookings",
                    target_type="settlement", target_id=settlement.id,
                    changes={"provider_id": str(provider.id), "lines_added": added,
                             "net_payable_paise": settlement.net_payable_paise})
    await db.commit()
    return out


# ═══════════════════════════ read models ═══════════════════════════


def settlement_out(s: Settlement) -> SettlementOut:
    return SettlementOut.model_validate(s, from_attributes=True)


async def _lines_out(db: AsyncSession, settlement_id: uuid.UUID) -> list[SettlementLineOut]:
    rows = (
        await db.execute(
            select(SettlementLine, Booking.code, Turf.name)
            .join(Booking, Booking.id == SettlementLine.booking_id)
            .join(Turf, Turf.id == SettlementLine.turf_id)
            .where(SettlementLine.settlement_id == settlement_id)
            .order_by(SettlementLine.played_at)
        )
    ).all()
    return [
        SettlementLineOut(booking_id=line.booking_id, booking_code=code, turf_name=turf, played_at=line.played_at,
                          gross_paise=line.gross_paise, refunds_paise=line.refunds_paise,
                          provider_discounts_paise=line.provider_discounts_paise,
                          commission_paise=line.commission_paise)
        for line, code, turf in rows
    ]


async def settlement_detail(db: AsyncSession, s: Settlement) -> SettlementDetail:
    """Provider-facing statement with its lines (usable by the partner portal)."""
    return SettlementDetail(**settlement_out(s).model_dump(), lines=await _lines_out(db, s.id))


def _admin_row_query():
    gen, appr = aliased(AdminUser), aliased(AdminUser)
    return (
        select(Settlement, Provider.name, gen.email, appr.email)
        .join(Provider, Provider.id == Settlement.provider_id)
        .outerjoin(gen, gen.id == Settlement.generated_by_admin_id)
        .outerjoin(appr, appr.id == Settlement.approved_by_admin_id)
    )


def _admin_row(s: Settlement, provider_name: str, gen_email: str | None, appr_email: str | None) -> AdminSettlementRow:
    return AdminSettlementRow(
        **settlement_out(s).model_dump(), provider_id=s.provider_id, provider_name=provider_name,
        adjustments_paise=s.adjustments_paise or 0,
        generated_by=gen_email or ("system" if s.generated_by_admin_id is None else None),
        approved_by=appr_email, payout_method=s.payout_method,  # type: ignore[arg-type]
    )


async def list_settlements(
    db: AsyncSession, *, status: str | None = None, provider_id: uuid.UUID | None = None, limit: int = 500
) -> list[AdminSettlementRow]:
    stmt = _admin_row_query().order_by(Settlement.period_end.desc(), Provider.name)
    if status:
        stmt = stmt.where(Settlement.status == status)
    if provider_id:
        stmt = stmt.where(Settlement.provider_id == provider_id)
    return [_admin_row(*row) for row in (await db.execute(stmt.limit(limit))).all()]


async def admin_detail(db: AsyncSession, settlement_id: uuid.UUID) -> AdminSettlementDetail:
    row = (await db.execute(_admin_row_query().where(Settlement.id == settlement_id))).first()
    if row is None:
        raise NotFound("Settlement not found")
    base = _admin_row(*row)
    return AdminSettlementDetail(**base.model_dump(), lines=await _lines_out(db, settlement_id))


# ═══════════════════════════ workflow ═══════════════════════════


async def _lock(db: AsyncSession, settlement_id: uuid.UUID) -> Settlement:
    s = await db.scalar(select(Settlement).where(Settlement.id == settlement_id).with_for_update())
    if s is None:
        raise NotFound("Settlement not found")
    return s


async def approve(db: AsyncSession, ctx: Actor, settlement_id: uuid.UUID) -> AdminSettlementDetail:
    s = await _lock(db, settlement_id)
    # draft → approved, or failed → approved (a failed payout must be re-approved before any retry)
    if s.status not in ("draft", "failed"):
        raise Conflict(f"Only draft or failed settlements can be approved (this one is {s.status})")
    if s.generated_by_admin_id is not None and s.generated_by_admin_id == ctx.admin.id:
        raise SelfApproval("The admin who generated a settlement can't approve it")
    before = s.status
    s.status = "approved"
    s.approved_by_admin_id = ctx.admin.id
    s.approved_at = utcnow()
    await audit(db, ctx, "settlement.approve", f"Approved settlement ₹{s.net_payable_paise / 100:,.2f}",
                target_type="settlement", target_id=s.id, changes={"status": [before, "approved"]})
    await db.commit()
    return await admin_detail(db, s.id)


async def pay(db: AsyncSession, ctx: Actor, settlement_id: uuid.UUID, body: PaySettlement) -> AdminSettlementDetail:
    s = await _lock(db, settlement_id)
    if s.status != "approved" or s.approved_by_admin_id is None:
        raise Conflict(f"Only approved settlements can be paid (this one is {s.status})")
    if s.payout_ref:
        # never initiate a second transfer for the same statement
        raise Conflict("A payout was already recorded for this settlement", details={"payout_ref": s.payout_ref})
    if s.approved_by_admin_id == ctx.admin.id:
        # maker–checker between approval and payout (also covers system-generated drafts)
        raise SelfApproval("The admin who approved a settlement can't also pay it")
    provider = await db.scalar(select(Provider).where(Provider.id == s.provider_id).with_for_update())
    assert provider is not None
    if provider.payouts_on_hold:
        raise Conflict("Payouts to this provider are on hold (pending bank-detail approval)",
                       details={"reason": "payouts_on_hold"})
    if s.net_payable_paise <= 0:
        raise Conflict("Nothing to pay — net payable is zero or negative")
    if body.method == "manual_neft":
        reference = (body.reference or "").strip()
        if not _UTR.match(reference):
            raise BadRequest("Enter the bank's UTR / reference number (12–22 letters or digits)",
                             details={"fields": {"reference": "12–22 letters or digits"}})
    else:
        if not provider.razorpay_account_id:
            raise Conflict("This provider has no Razorpay Route linked account")
        try:
            reference = await create_transfer(
                account_id=provider.razorpay_account_id, amount_paise=s.net_payable_paise,
                notes={"settlement_id": str(s.id), "period": f"{s.period_start}..{s.period_end}"})
        except ProviderError as exc:
            raise PayoutFailed(str(exc)) from exc
    before = s.status
    s.status = "paid"
    s.payout_method = body.method
    s.payout_ref = reference[:80]
    s.paid_at = utcnow()
    s.failure_reason = None
    await audit(db, ctx, "settlement.pay",
                f"Paid ₹{s.net_payable_paise / 100:,.2f} to {provider.name} via {body.method}",
                target_type="settlement", target_id=s.id,
                changes={"status": [before, "paid"], "payout_method": [None, body.method],
                         "payout_ref": [None, reference]})
    await db.commit()
    return await admin_detail(db, s.id)


async def fail(db: AsyncSession, ctx: Actor, settlement_id: uuid.UUID, reason: str) -> AdminSettlementDetail:
    s = await _lock(db, settlement_id)
    if s.status == "paid" and s.payout_method != "manual_neft":
        # a Razorpay Route transfer can't be "un-paid" here — reverse it with Razorpay first
        raise Conflict("Route transfers can't be marked failed after payment — reverse the transfer in Razorpay")
    if s.status not in ("approved", "paid"):
        raise Conflict(f"Only approved or paid settlements can be marked failed (this one is {s.status})")
    before, old_ref = s.status, s.payout_ref
    s.status = "failed"
    s.failure_reason = reason[:300]
    # a bounced manual transfer is retried only after a fresh approval by a different admin
    s.approved_by_admin_id = None
    s.approved_at = None
    s.payout_ref = None
    s.paid_at = None
    await audit(db, ctx, "settlement.fail", f"Marked settlement failed: {reason}", target_type="settlement",
                target_id=s.id, changes={"status": [before, "failed"], "failure_reason": [None, reason],
                                         "payout_ref": [old_ref, None]})
    await db.commit()
    return await admin_detail(db, s.id)


async def export_csv(db: AsyncSession, ctx: Actor, settlement_id: uuid.UUID) -> tuple[str, str]:
    detail = await admin_detail(db, settlement_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    from app.modules.admin.services.common import csv_cell

    w.writerow(["provider", csv_cell(detail.provider_name), "period", f"{detail.period_start}..{detail.period_end}",
                "status", detail.status])
    w.writerow(["booking_code", "turf", "played_at", "gross_paise", "refunds_paise", "provider_discounts_paise",
                "commission_paise"])
    for line in detail.lines:
        w.writerow([line.booking_code, csv_cell(line.turf_name), line.played_at.isoformat(), line.gross_paise,
                    line.refunds_paise, line.provider_discounts_paise, line.commission_paise])
    w.writerow([])
    for label, value in (("gross_paise", detail.gross_paise), ("refunds_paise", detail.refunds_paise),
                         ("provider_discounts_paise", detail.provider_discounts_paise),
                         ("adjustments_paise", detail.adjustments_paise),
                         ("commission_bps", detail.commission_bps), ("commission_paise", detail.commission_paise),
                         ("gst_on_commission_paise", detail.gst_on_commission_paise),
                         ("tcs_paise", detail.tcs_paise), ("tds_paise", detail.tds_paise),
                         ("net_payable_paise", detail.net_payable_paise)):
        w.writerow([label, value])
    await audit(db, ctx, "settlement.export", f"Exported settlement CSV ({detail.provider_name})",
                target_type="settlement", target_id=settlement_id)
    await db.commit()
    return f"settlement-{detail.period_start}-{detail.period_end}.csv", buf.getvalue()
