import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, uuid_pk


class Recording(CreatedAtMixin, Base):
    __tablename__ = "recordings"

    id: Mapped[uuid.UUID] = uuid_pk()
    lobby_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="CASCADE"), unique=True
    )
    pitch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pitches.id"))
    status: Mapped[str] = mapped_column(String(12), default="scheduled", index=True)
    video_url: Mapped[str | None] = mapped_column(String(500))
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))
    duration_s: Mapped[float | None] = mapped_column(Float)
    process_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lobby = relationship("Lobby", lazy="joined")


class Clip(CreatedAtMixin, Base):
    """A non-destructive [start_s, end_s] window over a recording."""

    __tablename__ = "clips"

    id: Mapped[uuid.UUID] = uuid_pk()
    recording_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recordings.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(30)), default=list, server_default=text("'{}'"))
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    likes_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    views: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    recording: Mapped[Recording] = relationship(lazy="joined")
    user = relationship("User", lazy="joined")


class ClipLike(CreatedAtMixin, Base):
    __tablename__ = "clip_likes"

    clip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clips.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
