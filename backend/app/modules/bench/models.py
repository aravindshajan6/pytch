import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, uuid_pk


class BenchStatus(Base):
    __tablename__ = "bench_statuses"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    radius_km: Mapped[float] = mapped_column(Float, default=5.0, server_default="5")
    sports: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list, server_default=text("'{}'"))
    active_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user = relationship("User", lazy="joined")


class SOSRequest(CreatedAtMixin, Base):
    __tablename__ = "sos_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    lobby_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(8))  # dropout | manual
    spots_needed: Mapped[int] = mapped_column(Integer)
    spots_filled: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    discount_pct: Mapped[int] = mapped_column(Integer)
    original_share_paise: Mapped[int] = mapped_column(Integer)
    discounted_share_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open|filled|expired|cancelled
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    lobby = relationship("Lobby", lazy="joined")


class SOSDispatch(Base):
    __tablename__ = "sos_dispatches"
    __table_args__ = (UniqueConstraint("sos_id", "user_id", name="uq_sos_dispatches_sos_user"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    sos_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sos_requests.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    distance_km: Mapped[float | None] = mapped_column(Float)
    notified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    response: Mapped[str | None] = mapped_column(String(10))  # accepted | declined
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
