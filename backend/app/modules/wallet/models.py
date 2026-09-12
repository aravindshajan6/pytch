import uuid

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, uuid_pk


class WalletTransaction(CreatedAtMixin, Base):
    """Append-only credits ledger. `users.wallet_balance_paise` is the cached running balance."""

    __tablename__ = "wallet_transactions"
    __table_args__ = (Index("ix_wallet_txn_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    amount_paise: Mapped[int] = mapped_column(Integer)  # + credit / − debit
    # refund | rain_check | reimbursement | dropout_credit | spend | bonus
    kind: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(String(200))
    balance_after_paise: Mapped[int] = mapped_column(Integer)
    ref_type: Mapped[str | None] = mapped_column(String(20))
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
