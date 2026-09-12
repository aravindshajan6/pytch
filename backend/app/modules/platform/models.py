import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk


class AppSetting(Base):
    """Runtime-tunable business rules / kill switches (admin → Settings). Read through
    `app.modules.platform.service.get_setting()` (Redis-cached)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)  # {"v": <value>}
    updated_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SportCatalog(TimestampMixin, Base):
    """Sports/services offered on the platform (admin-managed; replaces the static constant)."""

    __tablename__ = "sports_catalog"

    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    label: Mapped[str] = mapped_column(String(40))
    emoji: Mapped[str] = mapped_column(String(8))
    formats: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list, server_default=text("'{}'"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Broadcast(CreatedAtMixin, Base):
    """Admin announcement pushed as notifications to a player segment."""

    __tablename__ = "broadcasts"

    id: Mapped[uuid.UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(300))
    url: Mapped[str | None] = mapped_column(String(200))
    segment: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"areas": [...], "sports": [...], "active_days": 30}
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="sent", server_default="sent")
    created_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="SET NULL")
    )
