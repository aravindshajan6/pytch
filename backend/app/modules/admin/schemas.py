"""Admin console schemas — mirror `frontend/src/types/admin.ts` field-for-field.

Coupon, settlement and platform (settings / catalog / broadcast) shapes live in their own modules
(`coupons.schemas`, `settlements.schemas`, `platform.schemas`) and are re-used here.
"""

import re
import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import Field, field_validator

from app.core.schemas import InputSchema, Schema
from app.modules.settlements.schemas import SettlementOut
from app.modules.users.schemas import UserPublic

AdminRole = Literal["super_admin", "ops", "finance", "support", "marketing", "read_only"]
ProviderStatus = Literal["pending", "approved", "rejected", "suspended"]
UserStatus = Literal["active", "suspended", "banned"]
EMAIL_PATTERN = r"^[^@\s]{1,64}@[^@\s]{1,120}\.[A-Za-z]{2,24}$"

# ───────────── Auth ─────────────


class AdminLoginRequest(InputSchema):
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=1, max_length=256)


class AdminLoginResponse(Schema):
    mfa_token: str
    mfa_enrolled: bool
    must_change_password: bool


class MfaTokenRequest(InputSchema):
    mfa_token: str = Field(min_length=10, max_length=2000)


class MfaConfirmRequest(MfaTokenRequest):
    code: str = Field(min_length=6, max_length=10)


class MfaVerifyRequest(MfaTokenRequest):
    code: str | None = Field(None, min_length=6, max_length=10)
    recovery_code: str | None = Field(None, min_length=8, max_length=20)


class MfaEnrollStart(Schema):
    secret: str
    otpauth_uri: str


class AdminMe(Schema):
    id: uuid.UUID
    email: str
    name: str
    role: AdminRole
    permissions: list[str]
    mfa_enrolled: bool
    must_change_password: bool
    last_login_at: datetime | None  # this (the most recent) sign-in
    last_login_ip: str | None
    previous_login_at: datetime | None  # the sign-in before it ("Previous sign-in")
    previous_login_ip: str | None


class AdminAuth(Schema):
    access_token: str
    expires_in: int
    admin: AdminMe


class AdminAuthWithRecovery(AdminAuth):
    recovery_codes: list[str]


class StepUpRequest(InputSchema):
    code: str = Field(min_length=6, max_length=10)


class StepUpResponse(Schema):
    ok: Literal[True] = True
    valid_until: datetime


class ChangePasswordRequest(InputSchema):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class OkResponse(Schema):
    ok: bool = True


class AdminSessionOut(Schema):
    id: uuid.UUID
    ip: str | None
    user_agent: str | None
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool


# ───────────── Analytics ─────────────

AnalyticsRange = Literal["7d", "30d", "90d"]


class Kpi(Schema):
    key: str
    label: str
    value: float
    previous: float
    unit: Literal["paise", "count", "pct", "ratio"]
    hint: str


class AnalyticsOverview(Schema):
    range: AnalyticsRange
    kpis: list[Kpi]


class SeriesPoint(Schema):
    date: date
    value: float


class TimeSeries(Schema):
    metric: str
    granularity: Literal["day", "week"]
    points: list[SeriesPoint]
    previous: list[SeriesPoint]


class Cohort(Schema):
    week: date
    size: int
    retention: list[float | None]


class CohortTable(Schema):
    cohorts: list[Cohort]


class VenueAnalyticsRow(Schema):
    turf_id: uuid.UUID
    turf_name: str
    provider_name: str | None
    bookings: int
    gmv_paise: int
    occupancy_pct: float
    cancellation_pct: float
    conflicts: int


class HeatmapCell(Schema):
    weekday: int
    hour: int
    bookings: int


class Heatmap(Schema):
    cells: list[HeatmapCell]


class SportMixRow(Schema):
    sport: str
    bookings: int
    gmv_paise: int


class SportMix(Schema):
    rows: list[SportMixRow]


# ───────────── Bookings & payments rows (used by user detail) ─────────────


class AdminBookingRow(Schema):
    id: uuid.UUID
    code: str
    lobby_id: uuid.UUID
    lobby_title: str
    turf_name: str
    pitch_name: str
    host_name: str
    host_phone: str
    mode: Literal["split", "full"]
    status: str
    start_at: datetime
    total_paise: int
    paid_paise: int
    created_at: datetime


class AdminPaymentRow(Schema):
    id: uuid.UUID
    user_name: str
    user_phone: str
    lobby_title: str | None
    booking_code: str | None
    purpose: str
    provider: Literal["mock", "razorpay", "wallet"]
    amount_paise: int
    discount_paise: int
    credits_applied_paise: int
    payable_paise: int
    status: str
    coupon_code: str | None
    provider_payment_id: str | None
    created_at: datetime
    paid_at: datetime | None


# ───────────── Users (players) ─────────────


class AdminUserRow(Schema):
    id: uuid.UUID
    name: str
    phone: str
    status: UserStatus
    home_area: str | None
    level: int
    true_skill: float | None
    matches_played: int
    wallet_balance_paise: int
    is_provider_member: bool
    created_at: datetime
    last_seen_at: datetime | None


class AdminUserStats(Schema):
    hosted: int
    subs: int
    dropouts: int
    no_shows: int
    ratings_received: int


class AdminWalletLine(Schema):
    kind: str
    amount_paise: int
    note: str
    created_at: datetime


class AdminUserDetail(AdminUserRow):
    public: UserPublic
    status_reason: str | None
    suspended_until: datetime | None
    stats: AdminUserStats
    recent_bookings: list[AdminBookingRow]
    recent_payments: list[AdminPaymentRow]
    wallet: list[AdminWalletLine]
    active_sessions: int


class SetUserStatus(InputSchema):
    status: UserStatus
    reason: str = Field(min_length=3, max_length=300)
    until: datetime | None = None


class WalletAdjust(InputSchema):
    amount_paise: int = Field(ge=-10_000_000, le=10_000_000)
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("amount_paise")
    @classmethod
    def _non_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("amount must not be zero")
        return v


class LogoutAllResponse(Schema):
    ok: bool = True
    revoked: int


# ───────────── Providers & venues ─────────────


class AdminVenueRow(Schema):
    id: uuid.UUID
    slug: str
    name: str
    area: str
    provider_id: uuid.UUID | None
    provider_name: str | None
    pitch_count: int
    sports: list[str]
    is_active: bool
    is_featured: bool
    rating_avg: float
    bookings_30d: int
    upcoming_bookings: int  # Pytch games (forming/confirmed) that haven't ended yet


class AdminProviderRow(Schema):
    id: uuid.UUID
    name: str
    city: str
    status: ProviderStatus
    contact_name: str
    contact_phone: str
    venue_count: int
    commission_bps: int
    gmv_30d_paise: int
    open_conflicts: int
    payouts_on_hold: bool
    created_at: datetime


class ProviderMemberBrief(Schema):
    name: str | None
    phone: str
    role: str
    status: str


class AdminApplicationVenue(Schema):
    """One venue of the partner's application (`provider.application["venues"][index]`) + what was onboarded."""

    index: int
    name: str
    area: str
    address: str
    lat: float | None
    lng: float | None
    sports: list[str]
    pitch_count: int
    has_indoor: bool
    notes: str | None
    turf_id: uuid.UUID | None  # set once an admin created the venue from this entry
    turf_name: str | None


class AdminProviderDetail(Schema):
    # ProviderOut
    id: uuid.UUID
    name: str
    slug: str
    legal_name: str | None
    gstin: str | None
    contact_name: str
    contact_phone: str
    contact_email: str | None
    city: str
    address: str | None
    status: ProviderStatus
    status_reason: str | None
    commission_bps: int
    settlement_cycle: Literal["weekly", "biweekly", "monthly"]
    bank_account_name: str | None
    bank_account_last4: str | None
    bank_ifsc: str | None
    kyc_verified: bool
    venue_count: int
    created_at: datetime
    # admin extras
    entity_type: str | None
    pan_last4: str | None
    razorpay_account_id: str | None
    payouts_on_hold: bool
    notes: str | None
    application: dict[str, Any]
    application_venues: list[AdminApplicationVenue]
    members: list[ProviderMemberBrief]
    venues: list[AdminVenueRow]
    settlements: list[SettlementOut]
    reviewed_by: str | None
    reviewed_at: datetime | None


class ProviderReview(InputSchema):
    decision: Literal["approve", "reject"]
    reason: str | None = Field(None, max_length=300)
    commission_bps: int | None = Field(None, ge=0, le=5000)


class ProviderStatusChange(InputSchema):
    status: Literal["approved", "suspended"]
    reason: str = Field(min_length=3, max_length=300)


class ProviderAdminUpdate(InputSchema):
    commission_bps: int | None = Field(None, ge=0, le=5000)
    settlement_cycle: Literal["weekly", "biweekly", "monthly"] | None = None
    notes: str | None = Field(None, max_length=5000)
    razorpay_account_id: str | None = Field(None, max_length=40, pattern=r"^acc_[A-Za-z0-9]{6,36}$")

    @field_validator("razorpay_account_id", mode="before")
    @classmethod
    def _blank(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v


class AssignTurfs(InputSchema):
    """The provider's complete venue list: listed venues are assigned (moved from another provider if needed),
    the provider's venues missing from it are unassigned (`provider_id = NULL`)."""

    turf_ids: list[uuid.UUID] = Field(max_length=200)


HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
PitchSport = Literal["football", "cricket", "badminton", "pickleball", "basketball"]


class AdminPitchInput(InputSchema):
    name: str = Field(min_length=1, max_length=80)
    sport: PitchSport
    format: str = Field(min_length=1, max_length=16)
    capacity: int = Field(ge=2, le=40)
    is_indoor: bool = False
    has_camera: bool = False
    camera_price_paise: int = Field(default=0, ge=0, le=1_000_000)
    price_per_hour_paise: int = Field(ge=100, le=10_000_000)
    peak_price_per_hour_paise: int = Field(ge=100, le=10_000_000)


class AdminCreateVenue(InputSchema):
    """POST /admin/providers/{id}/venues — onboard one venue (usually an entry of the partner's application).
    Coordinates must be confirmed by the admin (no geocoding) and fall inside the service area."""

    application_index: int | None = Field(default=None, ge=0, le=50)
    name: str = Field(min_length=2, max_length=120)
    area: str = Field(min_length=2, max_length=80)
    address: str = Field(min_length=5, max_length=255)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    description: str = Field(default="", max_length=2000)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{6,15}$")
    amenities: list[str] = Field(default_factory=list, max_length=20)
    open_time: str = Field(default="06:00", pattern=HHMM)
    close_time: str = Field(default="23:00", pattern=HHMM)
    pitches: list[AdminPitchInput] = Field(min_length=1, max_length=30)

    @field_validator("name", "area", "address", mode="before")
    @classmethod
    def _squash(cls, v: object) -> object:
        return " ".join(v.split()) if isinstance(v, str) else v

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: object) -> object:
        if isinstance(v, str):
            v = re.sub(r"[\s\-().]", "", v)
            return v or None
        return v

    @field_validator("amenities")
    @classmethod
    def _amenities(cls, v: list[str]) -> list[str]:
        out = [a.strip() for a in v if a.strip()]
        if any(len(a) > 40 for a in out):
            raise ValueError("amenities must be at most 40 characters")
        return out


class AdminVenueUpdate(InputSchema):
    # Re-homing a venue to another provider changes who gets paid and who sees its bookings — that only
    # happens via POST /admin/providers/{id}/turfs (providers.manage + step-up), never through this PATCH.
    is_active: bool | None = None
    is_featured: bool | None = None
    name: str | None = Field(None, min_length=2, max_length=120)


class PitchActiveUpdate(InputSchema):
    is_active: bool


class AdminPitchOut(Schema):
    id: uuid.UUID
    turf_id: uuid.UUID
    name: str
    sport: str
    format: str
    capacity: int
    is_indoor: bool
    has_camera: bool
    camera_price_paise: int
    price_per_hour_paise: int
    peak_price_per_hour_paise: int
    is_active: bool


# ───────────── Bookings ─────────────


class AdminCancelBooking(InputSchema):
    reason: str = Field(min_length=3, max_length=300)
    refund_destination: Literal["credits", "source"] = "credits"


class AdminLobbyInfo(Schema):
    id: uuid.UUID
    code: str
    title: str
    sport: str
    format: str
    mode: str
    visibility: str
    status: str
    total_spots: int
    share_paise: int
    start_at: datetime
    end_at: datetime
    pay_deadline: datetime | None
    turf_id: uuid.UUID
    turf_name: str
    pitch_id: uuid.UUID
    pitch_name: str
    notes: str | None
    created_at: datetime
    confirmed_at: datetime | None
    completed_at: datetime | None


class AdminLobbyMemberRow(Schema):
    user_id: uuid.UUID
    name: str
    phone: str
    role: str
    status: str
    share_paise: int
    paid_paise: int
    discount_paise: int
    compensated_paise: int
    joined_at: datetime
    paid_at: datetime | None
    left_at: datetime | None


class AdminConflictRow(Schema):
    id: uuid.UUID
    source: str
    external_ref: str | None
    external_start_at: datetime
    external_end_at: datetime
    summary: str
    status: str
    resolution: str | None
    created_at: datetime


class AdminBlockRow(Schema):
    id: uuid.UUID
    kind: str
    source: str
    status: str
    start_at: datetime
    end_at: datetime
    customer_name: str | None


class AdminBookingDetail(Schema):
    booking: AdminBookingRow
    lobby: AdminLobbyInfo
    members: list[AdminLobbyMemberRow]
    payments: list[AdminPaymentRow]
    conflicts: list[AdminConflictRow]
    blocks: list[AdminBlockRow]
    transferred_from_id: uuid.UUID | None


# ───────────── Payments ─────────────


class RefundRequest(InputSchema):
    amount_paise: int = Field(ge=100, le=100_000_000)
    destination: Literal["credits", "source"]
    reason: str = Field(min_length=3, max_length=300)


class ApprovalPending(Schema):
    approval_id: uuid.UUID
    status: Literal["pending"] = "pending"
    message: str


class AdminPaymentRefundOut(Schema):
    ref: str
    amount_paise: int
    destination: Literal["credits", "source"]
    reason: str | None
    by: str | None
    at: datetime | None
    approval_id: str | None
    kind: Literal["admin_refund", "cancellation"]  # a cancellation's credits are recorded for history


class AdminPaymentDetail(AdminPaymentRow):
    """GET /admin/payments/{id}: the row + refund history and what an admin may still refund (server-side cap)."""

    user_id: uuid.UUID
    lobby_id: uuid.UUID | None
    member_id: uuid.UUID | None
    provider_order_id: str | None
    failure_reason: str | None
    refunded_paise: int  # refunded from this payment (admin refunds + a cancellation's credits)
    refunded_source_paise: int
    refundable_paise: int  # what POST …/refund accepts now (capped by what the seat still holds)
    refundable_to_source_paise: int
    seat_refunded_paise: int  # admin refunds already issued on this seat — the dual-approval threshold is cumulative
    refunds: list[AdminPaymentRefundOut]


class RefundResult(Schema):
    payment: AdminPaymentRow
    refund_id: str
    amount_paise: int
    destination: Literal["credits", "source"]


class WebhookEventOut(Schema):
    id: str
    provider: str
    event: str
    created_at: datetime
    payload: dict[str, Any]


class ReconciliationMismatch(Schema):
    payment_id: uuid.UUID
    issue: str


class ReconciliationDay(Schema):
    date: date
    captured_paise: int
    captured_count: int
    refunded_paise: int
    credits_issued_paise: int
    credits_spent_paise: int
    mismatches: list[ReconciliationMismatch]


class AdminWalletTxnOut(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    user_phone: str
    amount_paise: int
    kind: str
    note: str
    balance_after_paise: int
    ref_type: str | None
    ref_id: uuid.UUID | None
    created_at: datetime


# ───────────── Approvals ─────────────


class ApprovalOut(Schema):
    id: uuid.UUID
    action: str
    target_type: str
    target_id: str
    summary: str
    payload: dict[str, Any]
    status: Literal["pending", "approved", "rejected", "failed"]
    requested_by: str
    decided_by: str | None
    decided_at: datetime | None
    decision_note: str | None
    result: dict[str, Any] | None  # what the executor did (or {error, code} when it failed)
    created_at: datetime


class ApprovalDecision(InputSchema):
    note: str | None = Field(None, max_length=300)


# ───────────── Audit, team, system ─────────────


class AuditEntry(Schema):
    id: int
    occurred_at: datetime
    actor_type: Literal["admin", "provider", "system", "user", "api_key"]
    actor_label: str
    action: str
    target_type: str | None
    target_id: str | None
    summary: str
    changes: dict[str, Any]
    ip: str | None
    hash: str


class AuditPage(Schema):
    items: list[AuditEntry]
    total: int
    limit: int
    offset: int


class ChainVerification(Schema):
    ok: bool
    checked: int
    broken_at: int | None


class AdminAccountOut(Schema):
    id: uuid.UUID
    email: str
    name: str
    role: AdminRole
    is_active: bool
    mfa_enrolled: bool
    last_login_at: datetime | None
    locked: bool
    created_at: datetime


class CreateAdminRequest(InputSchema):
    email: str = Field(pattern=EMAIL_PATTERN, max_length=160)
    name: str = Field(min_length=2, max_length=80)
    role: AdminRole


class CreatedAdmin(Schema):
    admin: AdminAccountOut
    temporary_password: str


class ResetPasswordResult(Schema):
    """POST /admin/team/{id}/reset-password — the temporary password is shown once."""

    admin: AdminAccountOut
    temporary_password: str
    sessions_revoked: int


class UpdateAdminRequest(InputSchema):
    role: AdminRole | None = None
    is_active: bool | None = None


class JobStatus(Schema):
    name: str
    last_run_at: datetime | None


class SystemHealth(Schema):
    db: bool
    redis: bool
    worker_heartbeat_at: datetime | None
    jobs: list[JobStatus]
    websocket_connections: int
    pending_webhooks: int
    failing_feeds: int
    open_conflicts: int
    pending_approvals: int
    audit_chain_ok: bool | None
