import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class Slot(TimestampMixin, Base):
    """One bookable hour on a pitch. The unit of pessimistic locking (FOR UPDATE NOWAIT)."""

    __tablename__ = "slots"
    __table_args__ = (
        UniqueConstraint("pitch_id", "start_at", name="uq_slots_pitch_start"),
        Index("ix_slots_status_start", "status", "start_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    pitch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pitches.id", ondelete="CASCADE"), index=True
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    price_paise: Mapped[int] = mapped_column(Integer)
    is_peak: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # available | held | booked | blocked
    status: Mapped[str] = mapped_column(String(16), default="available", server_default="available")
    held_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    held_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="SET NULL", use_alter=True)
    )

    pitch = relationship("Pitch", lazy="joined")
