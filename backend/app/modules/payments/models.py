import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    lobby_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="SET NULL"), index=True
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="SET NULL")
    )
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobby_members.id", ondelete="SET NULL")
    )
    purpose: Mapped[str] = mapped_column(String(20))  # share | full | sub_share | cover_remaining
    provider: Mapped[str] = mapped_column(String(12))  # mock | razorpay | wallet
    amount_paise: Mapped[int] = mapped_column(Integer)
    credits_applied_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    payable_paise: Mapped[int] = mapped_column(Integer)
    # created | paid | failed | refunded | cancelled
    status: Mapped[str] = mapped_column(String(12), default="created", index=True)
    provider_order_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookEvent(CreatedAtMixin, Base):
    """Idempotency log for provider webhooks."""

    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # provider event id
    provider: Mapped[str] = mapped_column(String(12))
    event: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB)
