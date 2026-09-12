"""Low-level payment bookkeeping shared by lobbies (refunds on leave/expiry/cancel) and payments.

Imports only models + wallet so both `lobbies.service` and `payments.service` can use it.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import utcnow
from app.modules.payments.models import Payment
from app.modules.wallet import service as wallet

CREDITS_RETURNED = "credits_returned"


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
        await return_applied_credits(db, payment, "Credits returned — payment not completed")
    return len(payments)


async def mark_lobby_payments_refunded(
    db: AsyncSession, lobby_id: uuid.UUID, *, member_ids: Sequence[uuid.UUID] | None = None
) -> None:
    """History only: captured payments whose money went back to the payer as credits."""
    stmt = update(Payment).where(Payment.lobby_id == lobby_id, Payment.status == "paid")
    if member_ids is not None:
        if not member_ids:
            return
        stmt = stmt.where(Payment.member_id.in_(member_ids))
    await db.execute(stmt.values(status="refunded", refunded_at=utcnow()))
