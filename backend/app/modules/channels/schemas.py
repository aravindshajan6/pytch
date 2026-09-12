"""Channel / block shapes (mirror `frontend/src/types/partner.ts` §Calendar & blocks, §Channels) + Channel API."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.core.schemas import InputSchema, Schema
from app.modules.providers.schemas import BlockSource

BlockKind = Literal["booking", "block"]
OfflinePaymentMode = Literal["cash", "upi", "card", "online_other", "unpaid"]
ApiScope = Literal["availability:read", "blocks:write"]
WebhookEventName = Literal["slot.booked", "slot.released", "slot.blocked", "block.cancelled"]
ConflictResolution = Literal["kept_pytch", "moved_external", "ignored"]
# active = holds its slots · conflicted = an imported/pushed booking that could not claim any slot (it overlaps
# inventory sold elsewhere first — see its SyncConflict); never counted as a booking · cancelled
BlockStatus = Literal["active", "conflicted", "cancelled"]
ConflictStatus = Literal["open", "resolved", "ignored", "obsolete"]
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class SlotBlockOut(Schema):
    id: uuid.UUID
    pitch_id: uuid.UUID
    pitch_name: str
    turf_name: str
    start_at: datetime
    end_at: datetime
    kind: BlockKind
    source: BlockSource
    status: BlockStatus
    customer_name: str | None
    customer_phone: str | None
    amount_paise: int
    payment_mode: OfflinePaymentMode | None
    notes: str | None
    external_ref: str | None
    created_by_name: str | None
    created_at: datetime


def _aware(v: datetime) -> datetime:
    if v.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    return v


class CreateBlockRequest(InputSchema):
    pitch_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    kind: BlockKind
    source: BlockSource
    customer_name: str | None = Field(default=None, max_length=80)
    customer_phone: str | None = Field(default=None, pattern=r"^\+?[0-9 ]{6,20}$")
    amount_paise: int = Field(default=0, ge=0, le=10_000_000)
    payment_mode: OfflinePaymentMode | None = None
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("start_at", "end_at")
    @classmethod
    def _tz(cls, v: datetime) -> datetime:
        return _aware(v)

    @model_validator(mode="after")
    def _order(self) -> "CreateBlockRequest":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.source in ("ical", "api"):
            raise ValueError("ical/api blocks are created by the sync, not by hand")
        return self


class UpdateBlockRequest(InputSchema):
    customer_name: str | None = Field(default=None, max_length=80)
    customer_phone: str | None = Field(default=None, pattern=r"^\+?[0-9 ]{6,20}$")
    amount_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    payment_mode: OfflinePaymentMode | None = None
    notes: str | None = Field(default=None, max_length=500)


class BulkBlockRequest(InputSchema):
    pitch_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    date_from: date
    date_to: date
    time_from: str = Field(pattern=HHMM)
    time_to: str = Field(pattern=r"^(([01]\d|2[0-3]):[0-5]\d|24:00)$")
    weekdays: list[int] = Field(min_length=1, max_length=7)
    kind: BlockKind
    source: BlockSource
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check(self) -> "BulkBlockRequest":
        if self.date_to < self.date_from:
            raise ValueError("date_to must be on or after date_from")
        if (self.date_to - self.date_from).days > 61:
            raise ValueError("at most 62 days at once")
        if not all(0 <= d <= 6 for d in self.weekdays):
            raise ValueError("weekdays are 0 (Mon) … 6 (Sun)")
        if self.time_to != "24:00" and self.time_to <= self.time_from:
            raise ValueError("time_to must be after time_from")
        if self.source in ("ical", "api"):
            raise ValueError("ical/api blocks are created by the sync, not by hand")
        return self


class BulkSkipped(Schema):
    slot_id: uuid.UUID
    start_at: datetime
    reason: str  # past | locked | held | booked | blocked
    label: str  # human reason, e.g. "Pytch booking", "Walk-in booking", "Maintenance"


class BulkBlockResult(Schema):
    created: int  # blocks created (one per contiguous run of free hours)
    slots: int  # hours those blocks cover
    skipped: list[BulkSkipped]


# ───────────── channels management ─────────────


class FeedOut(Schema):
    id: uuid.UUID
    pitch_id: uuid.UUID
    pitch_name: str
    turf_name: str
    name: str
    source: BlockSource
    url_hint: str
    is_active: bool
    last_synced_at: datetime | None
    last_status: Literal["ok", "error"] | None
    last_error: str | None
    last_event_count: int


class CreateFeedRequest(InputSchema):
    pitch_id: uuid.UUID
    name: str = Field(min_length=1, max_length=80)
    source: BlockSource
    url: str = Field(min_length=10, max_length=2000)


class UpdateFeedRequest(InputSchema):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None


class ExportOut(Schema):
    pitch_id: uuid.UUID
    pitch_name: str
    turf_name: str
    ical_url: str | None


class ApiKeyOut(Schema):
    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[ApiScope]
    last_used_at: datetime | None
    created_at: datetime
    revoked_at: datetime | None


class CreateApiKeyRequest(InputSchema):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[ApiScope] = Field(min_length=1, max_length=2)


class CreatedApiKey(Schema):
    key: str
    api_key: ApiKeyOut


class WebhookOut(Schema):
    id: uuid.UUID
    url: str
    events: list[WebhookEventName]
    is_active: bool
    last_delivery_at: datetime | None
    last_status_code: int | None
    consecutive_failures: int


class CreateWebhookRequest(InputSchema):
    url: str = Field(min_length=10, max_length=500)
    events: list[WebhookEventName] = Field(min_length=1, max_length=4)


class CreatedWebhook(Schema):
    secret: str
    webhook: WebhookOut


class WebhookTestResult(Schema):
    status_code: int | None
    ok: bool


class SyncConflictOut(Schema):
    id: uuid.UUID
    pitch_name: str
    turf_name: str
    source: BlockSource
    external_ref: str | None
    external_start_at: datetime
    external_end_at: datetime
    summary: str
    lobby_id: uuid.UUID | None
    lobby_title: str | None
    # what currently holds the slot (the booking that was there first): a Pytch game (+ its status) or a block
    holder_kind: Literal["pytch", "block"] | None
    lobby_status: Literal["forming", "confirmed", "completed", "expired", "cancelled"] | None
    holder_source: BlockSource | None
    holder_label: str | None
    status: ConflictStatus
    resolution: ConflictResolution | None
    resolution_note: str | None
    created_at: datetime


class ResolveConflictRequest(InputSchema):
    resolution: ConflictResolution
    note: str | None = Field(default=None, max_length=500)


class ChannelsOverview(Schema):
    feeds: list[FeedOut]
    exports: list[ExportOut]
    api_keys: list[ApiKeyOut]
    webhooks: list[WebhookOut]
    open_conflicts: int
    api_base_url: str
    sync_enabled: bool = False  # automatic sync switched on by Pytch (else: manual logging only)


# ───────────── Channel API (integrators) ─────────────


class ChannelPitchOut(Schema):
    id: uuid.UUID
    turf_id: uuid.UUID
    turf_name: str
    name: str
    sport: str
    format: str
    capacity: int
    is_indoor: bool


class AvailabilityOut(Schema):
    start_at: datetime
    end_at: datetime
    available: bool


class ChannelBlockRequest(InputSchema):
    pitch_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    external_ref: str = Field(min_length=1, max_length=150, pattern=r"^[A-Za-z0-9_.:@\-]+$")
    source: BlockSource | None = None
    customer_name: str | None = Field(default=None, max_length=80)

    @field_validator("start_at", "end_at")
    @classmethod
    def _tz(cls, v: datetime) -> datetime:
        return _aware(v)

    @model_validator(mode="after")
    def _order(self) -> "ChannelBlockRequest":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.source in ("ical", "maintenance"):
            raise ValueError("source not allowed through the API")
        return self


class ChannelBlockOut(Schema):
    id: uuid.UUID
    pitch_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    source: BlockSource
    external_ref: str | None
    status: BlockStatus



# ───────────── manual mirroring (front-desk to-do) ─────────────

MirrorAction = Literal["block", "unblock"]
MirrorStatus = Literal["open", "done", "obsolete"]


class MirrorTaskOut(Schema):
    id: uuid.UUID
    action: MirrorAction  # block = "block it on your other apps"; unblock = "free it on your other apps"
    status: MirrorStatus
    booking_code: str
    pitch_id: uuid.UUID
    pitch_name: str
    turf_id: uuid.UUID
    turf_name: str
    start_at: datetime
    end_at: datetime
    created_at: datetime
    resolved_at: datetime | None
    resolved_by_name: str | None


class MirrorTaskUpdate(InputSchema):
    done: bool
