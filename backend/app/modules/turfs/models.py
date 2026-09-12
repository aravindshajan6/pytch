import uuid
from datetime import time

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, Time, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class Turf(TimestampMixin, Base):
    """A venue. Holds one or more pitches."""

    __tablename__ = "turfs"

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    area: Mapped[str] = mapped_column(String(80), index=True)
    address: Mapped[str] = mapped_column(String(255))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    phone: Mapped[str | None] = mapped_column(String(20))
    cover_url: Mapped[str | None] = mapped_column(String(500))
    photos: Mapped[list[str]] = mapped_column(ARRAY(String(500)), default=list, server_default=text("'{}'"))
    amenities: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list, server_default=text("'{}'"))
    open_time: Mapped[time] = mapped_column(Time, default=time(6, 0))
    close_time: Mapped[time] = mapped_column(Time, default=time(23, 0))
    rating_avg: Mapped[float] = mapped_column(Float, default=4.5, server_default="4.5")
    rating_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    pitches: Mapped[list["Pitch"]] = relationship(
        back_populates="turf", order_by="Pitch.name", lazy="selectin", cascade="all, delete-orphan"
    )


class Pitch(TimestampMixin, Base):
    """A bookable court/pitch within a turf."""

    __tablename__ = "pitches"

    id: Mapped[uuid.UUID] = uuid_pk()
    turf_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("turfs.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    sport: Mapped[str] = mapped_column(String(16), index=True)
    format: Mapped[str] = mapped_column(String(16))
    capacity: Mapped[int] = mapped_column(Integer)
    is_indoor: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    has_camera: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    camera_price_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    price_per_hour_paise: Mapped[int] = mapped_column(Integer)
    peak_price_per_hour_paise: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    turf: Mapped[Turf] = relationship(back_populates="pitches", lazy="joined")
