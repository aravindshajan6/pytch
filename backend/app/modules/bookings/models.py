import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class Booking(TimestampMixin, Base):
    """The financial reservation of a slot. Exactly one lobby per booking."""

    __tablename__ = "bookings"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    slot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("slots.id"), index=True)
    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    mode: Mapped[str] = mapped_column(String(8))  # split | full
    # pending_payment | confirmed | completed | cancelled | expired
    status: Mapped[str] = mapped_column(String(20), default="pending_payment", index=True)
    pitch_fee_paise: Mapped[int] = mapped_column(Integer)
    recording_fee_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_paise: Mapped[int] = mapped_column(Integer)
    recorded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transferred_from_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="SET NULL")
    )
