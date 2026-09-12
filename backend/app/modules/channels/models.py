"""Multi-channel inventory: the `slots` table is the single source of truth for every channel.

* SlotBlock      — a non-Pytch occupation of one or more slots on a pitch: walk-in / phone /
                   other-app booking (Playo, Hudle, …), maintenance, or an event imported from an
                   external calendar or pushed through the Channel API. Blocked slots have
                   status="blocked" and `slots.block_id` pointing here (same row lock as bookings).
* ChannelFeed    — an external iCal feed polled into SlotBlocks (import).
* ProviderApiKey — credentials for integrators calling the Channel API.
* ProviderWebhook / WebhookDelivery — signed outbound notifications of availability changes.
* SyncConflict   — an external booking that overlapped Pytch inventory and needs a human decision.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, TimestampMixin, uuid_pk

# source channel of a block (UI colour-codes by this)
BLOCK_SOURCES = ("walk_in", "phone", "playo", "hudle", "khelomore", "other_app", "ical", "api", "maintenance")


class SlotBlock(TimestampMixin, Base):
    __tablename__ = "slot_blocks"
    __table_args__ = (
        UniqueConstraint("provider_id", "source", "external_ref", name="uq_slot_blocks_external_ref"),
        Index("ix_slot_blocks_pitch_start", "pitch_id", "start_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    pitch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pitches.id", ondelete="CASCADE"))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(10))  # booking | block (maintenance / hold)
    source: Mapped[str] = mapped_column(String(12))  # see BLOCK_SOURCES
    status: Mapped[str] = mapped_column(String(10), default="active", server_default="active")  # active|cancelled
    customer_name: Mapped[str | None] = mapped_column(String(80))
    customer_phone: Mapped[str | None] = mapped_column(String(20))
    amount_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # offline revenue (reporting)
    payment_mode: Mapped[str | None] = mapped_column(String(12))  # cash | upi | card | online_other | unpaid
    notes: Mapped[str | None] = mapped_column(String(500))
    external_ref: Mapped[str | None] = mapped_column(String(200))  # iCal UID / integrator id (idempotency)
    feed_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channel_feeds.id", ondelete="SET NULL")
    )
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("provider_api_keys.id", ondelete="SET NULL")
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChannelFeed(TimestampMixin, Base):
    __tablename__ = "channel_feeds"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    pitch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pitches.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(12))  # playo | hudle | khelomore | google | other_app
    url_enc: Mapped[str] = mapped_column(String(2048))  # Fernet-encrypted (URLs embed secret tokens)
    url_hint: Mapped[str] = mapped_column(String(80))  # e.g. "calendar.google.com/…/basic.ics"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(10))  # ok | error
    last_error: Mapped[str | None] = mapped_column(String(300))
    last_event_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    etag: Mapped[str | None] = mapped_column(String(200))
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ProviderApiKey(CreatedAtMixin, Base):
    __tablename__ = "provider_api_keys"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16), index=True)  # shown in UI: "pk_live_ab12cd34"
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)  # keyed HMAC of the full key
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(30)), default=list, server_default=text("'{}'"))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProviderWebhook(TimestampMixin, Base):
    __tablename__ = "provider_webhooks"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(500))
    secret_enc: Mapped[str] = mapped_column(String(512))
    events: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list, server_default=text("'{}'"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status_code: Mapped[int | None] = mapped_column(Integer)


class WebhookDelivery(CreatedAtMixin, Base):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (Index("ix_webhook_deliveries_due", "status", "next_attempt_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    webhook_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("provider_webhooks.id", ondelete="CASCADE"), index=True
    )
    event: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(10), default="pending", server_default="pending")  # pending|ok|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    response_code: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(String(300))


class SyncConflict(CreatedAtMixin, Base):
    __tablename__ = "sync_conflicts"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    pitch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pitches.id", ondelete="CASCADE"))
    slot_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("slots.id", ondelete="SET NULL"))
    lobby_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lobbies.id", ondelete="SET NULL")
    )
    source: Mapped[str] = mapped_column(String(12))
    feed_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channel_feeds.id", ondelete="SET NULL")
    )
    external_ref: Mapped[str | None] = mapped_column(String(200))
    external_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    external_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    summary: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open", index=True)
    resolution: Mapped[str | None] = mapped_column(String(20))  # kept_pytch | moved_external | ignored
    resolution_note: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
