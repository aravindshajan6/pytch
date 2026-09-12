"""Low-level payment bookkeeping shared by lobbies (refunds on leave/expiry/cancel) and payments.

Imports only models + wallet so both `lobbies.service` and `payments.service` can use it.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import utcnow
from app.modules.coupons import service as coupons
from app.modules.payments.models import Payment
from app.modules.wallet import service as wallet

CREDITS_RETURNED = "credits_returned"


async def paid_discounts(
    db: AsyncSession, lobby_id: uuid.UUID, *, member_ids: Sequence[uuid.UUID] | None = None
) -> dict[uuid.UUID, int]:
    """Coupon discounts on captured payments, per member. Seats are credited the gross share, so
    refunds must subtract what the payer never actually paid."""
    stmt = (
        select(Payment.member_id, func.coalesce(func.sum(Payment.discount_paise), 0))
        .where(Payment.lobby_id == lobby_id, Payment.status == "paid", Payment.discount_paise > 0,
               Payment.member_id.is_not(None))
        .group_by(Payment.member_id)
    )
    if member_ids is not None:
        if not member_ids:
            return {}
        stmt = stmt.where(Payment.member_id.in_(member_ids))
    await db.flush()
    return {mid: int(total) for mid, total in (await db.execute(stmt)).all()}


async def release_coupons(
    db: AsyncSession, lobby_id: uuid.UUID, *, member_ids: Sequence[uuid.UUID] | None = None
) -> None:
    """Give back the coupon uses of a lobby's live payments *before* any wallet movement, so the lock
    order stays coupon → wallet user everywhere (same as redemption). Idempotent."""
    stmt = select(Payment.id).where(Payment.lobby_id == lobby_id, Payment.status.in_(("paid", "created")),
                                    Payment.coupon_id.is_not(None))
    if member_ids is not None:
        if not member_ids:
            return
        stmt = stmt.where(Payment.member_id.in_(member_ids))
    await db.flush()
    for payment_id in (await db.scalars(stmt.order_by(Payment.id))).all():
        await coupons.reverse_for_payment(db, payment_id)


async def return_applied_credits(db: AsyncSession, payment: Payment, note: str) -> int:
    """Give back credits debited when the intent was created (once). Returns amount credited."""
    meta = dict(payment.meta or {})
    amount = payment.credits_applied_paise
    if amount <= 0 or meta.get(CREDITS_RETURNED):
        return 0
    await wallet.credit(db, payment.user_id, amount, "refund", note, ref_type="payment", ref_id=payment.id)
    meta[CREDITS_RETURNED] = True
    payment.meta = meta
    return amount


async def cancel_pending_payments(
    db: AsyncSession,
    *,
    lobby_id: uuid.UUID | None = None,
    member_ids: Sequence[uuid.UUID] | None = None,
    reason: str = "cancelled",
) -> int:
    """Cancel `created` intents (by lobby and/or members), returning any credits applied to them."""
    stmt = select(Payment).where(Payment.status == "created")
    if lobby_id is not None:
        stmt = stmt.where(Payment.lobby_id == lobby_id)
    if member_ids is not None:
        if not member_ids:
            return 0
        stmt = stmt.where(Payment.member_id.in_(member_ids))
    payments = (await db.execute(stmt.with_for_update())).scalars().all()
    for payment in payments:
        payment.status = "cancelled"
        payment.failure_reason = reason[:255]
        if payment.coupon_id is not None:
            await coupons.reverse_for_payment(db, payment.id)
        await return_applied_credits(db, payment, "Credits returned — payment not completed")
    return len(payments)


async def mark_lobby_payments_refunded(
    db: AsyncSession, lobby_id: uuid.UUID, *, member_ids: Sequence[uuid.UUID] | None = None
) -> None:
    """History only: captured payments whose money went back to the payer as credits
    (their coupon redemptions are reversed — a cancellation before play restores the use)."""
    stmt = update(Payment).where(Payment.lobby_id == lobby_id, Payment.status == "paid")
    with_coupon = select(Payment.id).where(Payment.lobby_id == lobby_id, Payment.status == "paid",
                                           Payment.coupon_id.is_not(None))
    if member_ids is not None:
        if not member_ids:
            return
        stmt = stmt.where(Payment.member_id.in_(member_ids))
        with_coupon = with_coupon.where(Payment.member_id.in_(member_ids))
    await db.flush()
    for payment_id in (await db.scalars(with_coupon)).all():
        await coupons.reverse_for_payment(db, payment_id)
    await db.execute(stmt.values(status="refunded", refunded_at=utcnow()))
