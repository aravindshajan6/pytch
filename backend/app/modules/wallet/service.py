"""Pytch Credits ledger. All balance mutations go through `credit` / `debit` (row-locked)."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.timeutils import utcnow
from app.modules.users.models import User
from app.modules.wallet.models import WalletTransaction
from app.realtime.publisher import publish_on_commit, user_channel


class InsufficientCredits(AppError):
    code, status_code, message = "INSUFFICIENT_CREDITS", 409, "Not enough Pytch Credits"


async def _locked_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    # flush: pending balance changes must reach the DB before the row is re-read;
    # of=User: `stats` is joined-eager (outer join) and can't be locked;
    # populate_existing: the identity-mapped user may hold a stale balance.
    await db.flush()
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update(of=User)
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise AppError("Wallet owner not found", code="NOT_FOUND", status_code=404)
    return user


async def _apply(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount_paise: int,
    kind: str,
    note: str,
    ref_type: str | None,
    ref_id: uuid.UUID | None,
) -> WalletTransaction:
    user = await _locked_user(db, user_id)
    new_balance = user.wallet_balance_paise + amount_paise
    if new_balance < 0:
        raise InsufficientCredits()
    user.wallet_balance_paise = new_balance
    txn = WalletTransaction(
        id=uuid.uuid4(),
        user_id=user_id,
        amount_paise=amount_paise,
        kind=kind,
        note=note[:200],
        balance_after_paise=new_balance,
        ref_type=ref_type,
        ref_id=ref_id,
        created_at=utcnow(),
    )
    db.add(txn)
    publish_on_commit(db, user_channel(user_id), "wallet.updated", {"balance_paise": new_balance})
    return txn


async def credit(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount_paise: int,
    kind: str,
    note: str,
    *,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
) -> WalletTransaction:
    """Add credits (refund, rain_check, reimbursement, dropout_credit, bonus). Caller commits."""
    if amount_paise <= 0:
        raise ValueError("credit amount must be positive")
    return await _apply(db, user_id, amount_paise, kind, note, ref_type, ref_id)


async def debit(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount_paise: int,
    note: str,
    *,
    kind: str = "spend",
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
) -> WalletTransaction:
    """Spend credits. Raises InsufficientCredits. Caller commits."""
    if amount_paise <= 0:
        raise ValueError("debit amount must be positive")
    return await _apply(db, user_id, -amount_paise, kind, note, ref_type, ref_id)


async def get_balance(db: AsyncSession, user_id: uuid.UUID) -> int:
    return int(await db.scalar(select(User.wallet_balance_paise).where(User.id == user_id)) or 0)


async def recent_transactions(db: AsyncSession, user_id: uuid.UUID, limit: int = 50) -> list[WalletTransaction]:
    """Newest-first ledger entries (GET /wallet)."""
    rows = await db.scalars(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user_id)
        .order_by(WalletTransaction.created_at.desc(), WalletTransaction.id)
        .limit(limit)
    )
    return list(rows.all())
