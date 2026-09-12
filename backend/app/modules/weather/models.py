import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, uuid_pk


class WeatherAlert(CreatedAtMixin, Base):
    __tablename__ = "weather_alerts"

    id: Mapped[uuid.UUID] = uuid_pk()
    lobby_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="CASCADE"), index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE")
    )
    forecast_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    precipitation_probability: Mapped[int] = mapped_column(Integer)
    precipitation_mm: Mapped[float] = mapped_column(Float)
    summary: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(8))  # watch | warning
    # open | transferred | rain_checked | dismissed | expired
    status: Mapped[str] = mapped_column(String(14), default="open", index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lobby = relationship("Lobby", lazy="joined")
