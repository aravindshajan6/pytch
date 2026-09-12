"""Partner-portal shapes (mirror `frontend/src/types/partner.ts`). Provider/membership shapes live in
`providers.schemas`, block/channel shapes in `channels.schemas`."""

import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.core.pagination import Page
from app.core.schemas import InputSchema, Schema
from app.modules.channels.schemas import BlockKind, OfflinePaymentMode
from app.modules.providers.schemas import BlockSource, PartnerMembership, PartnerUserOut, Sport
from app.modules.turfs.schemas import PitchOut, TurfDetail

SourceOrPytch = Literal[
    "walk_in", "phone", "playo", "hudle", "khelomore", "other_app", "ical", "api", "maintenance", "pytch"
]
SettlementStatus = Literal["draft", "approved", "paid", "failed"]
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class OkResponse(Schema):
    ok: bool = True


# ───────────── Auth ─────────────


class PartnerAuth(Schema):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: PartnerUserOut
    memberships: list[PartnerMembership]


class PartnerMe(Schema):
    user: PartnerUserOut
    memberships: list[PartnerMembership]


# ───────────── Dashboard ─────────────


class PeriodStats(Schema):
    bookings: int
    pytch_bookings: int
    offline_bookings: int
    revenue_paise: int
    occupancy_pct: float


class CalendarEventBrief(Schema):
    pitch_name: str
    turf_name: str
    start_at: datetime
    end_at: datetime
    kind: Literal["pytch", "block"]
    title: str
    source: SourceOrPytch


class DashboardAlerts(Schema):
    open_conflicts: int
    failing_feeds: int
    pending_payout_paise: int
    pending_application: bool  # this provider has another change waiting for Pytch approval
    pending_bank_change: bool  # a payout-account change is waiting for Pytch finance
    payouts_on_hold: bool


class RevenuePoint(Schema):
    date: date
    pytch_paise: int
    offline_paise: int


class HeatCell(Schema):
    weekday: int
    hour: int
    pct: float


class ChannelMix(Schema):
    source: SourceOrPytch
    count: int


class PartnerDashboard(Schema):
    today: PeriodStats
    week: PeriodStats
    month: PeriodStats
    upcoming: list[CalendarEventBrief]
    alerts: DashboardAlerts
    revenue_series: list[RevenuePoint]
    occupancy_heatmap: list[HeatCell]
    channel_mix: list[ChannelMix]


# ───────────── Calendar ─────────────


class PytchOccupancy(Schema):
    kind: Literal["pytch"] = "pytch"
    lobby_id: uuid.UUID
    booking_code: str
    lobby_title: str
    lobby_status: Literal["forming", "confirmed", "completed", "expired", "cancelled"]
    host_name: str
    paid_spots: int
    total_spots: int
    amount_paise: int


class BlockOccupancy(Schema):
    kind: Literal["block"] = "block"
    block_id: uuid.UUID
    block_kind: BlockKind
    source: BlockSource
    customer_name: str | None
    customer_phone: str | None
    amount_paise: int
    payment_mode: OfflinePaymentMode | None
    notes: str | None
    external_ref: str | None
    starts_before: bool
    ends_after: bool


class CalendarCell(Schema):
    slot_id: uuid.UUID
    pitch_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    price_paise: int
    is_peak: bool
    status: Literal["available", "held", "booked", "blocked"]
    held_until: datetime | None
    occupancy: PytchOccupancy | BlockOccupancy | None
    has_conflict: bool


class PartnerPitchOut(PitchOut):
    is_active: bool
    upcoming_bookings: int = 0  # Pytch games + offline bookings still to play (venue list only)


class CalendarTurf(Schema):
    id: uuid.UUID
    name: str
    open_time: str
    close_time: str


class CalendarView(Schema):
    turf: CalendarTurf
    # active pitches + switched-off ones that still have bookings in range (is_active=false → "not bookable")
    pitches: list[PartnerPitchOut]
    from_: date = Field(alias="from", serialization_alias="from")
    days: int
    cells: list[CalendarCell]


# ───────────── Bookings ─────────────


class PartnerBookingRow(Schema):
    id: uuid.UUID
    kind: Literal["pytch", "offline"]
    ref: str
    turf_name: str
    pitch_name: str
    start_at: datetime
    end_at: datetime
    customer_name: str
    customer_phone: str | None
    players: int | None
    source: SourceOrPytch
    amount_paise: int
    payment_status: Literal["paid", "partially_paid", "pending", "unpaid", "refunded"]
    status: str
    lobby_id: uuid.UUID | None
    block_kind: BlockKind | None  # offline rows: booking | block (closure, only with include_closures)


class PartnerBookingsPage(Page[PartnerBookingRow]):
    pass


# ───────────── Venues ─────────────


class PartnerVenue(TurfDetail):
    is_active: bool
    pitch_count_active: int
    pitches: list[PartnerPitchOut]  # type: ignore[assignment]


class VenueUpdate(InputSchema):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    address: str | None = Field(default=None, min_length=5, max_length=255)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{6,15}$")
    amenities: list[str] | None = Field(default=None, max_length=20)
    photos: list[str] | None = Field(default=None, max_length=12)
    cover_url: str | None = Field(default=None, max_length=500)
    open_time: str | None = Field(default=None, pattern=HHMM)
    close_time: str | None = Field(default=None, pattern=HHMM)

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: object) -> object:
        # front desks type "+91-98765-43210", "(0484) 2345678" …: keep the digits (and a leading +)
        if isinstance(v, str):
            v = re.sub(r"[\s\-().]", "", v)
            return v or None
        return v

    @model_validator(mode="after")
    def _check(self) -> "VenueUpdate":
        for url in [*(self.photos or []), *([self.cover_url] if self.cover_url else [])]:
            if len(url) > 500 or not url.startswith(("https://", "/media/")):
                raise ValueError("photos must be https:// URLs (or uploaded /media/ paths)")
        for a in self.amenities or []:
            if not 1 <= len(a) <= 40:
                raise ValueError("amenities must be 1–40 characters")
        return self


class PitchInput(InputSchema):
    name: str = Field(min_length=1, max_length=80)
    sport: Sport
    format: str = Field(min_length=1, max_length=16)
    capacity: int = Field(ge=2, le=40)
    is_indoor: bool = False
    has_camera: bool = False
    camera_price_paise: int = Field(default=0, ge=0, le=1_000_000)
    price_per_hour_paise: int = Field(ge=0, le=10_000_000)
    peak_price_per_hour_paise: int = Field(ge=0, le=10_000_000)
    is_active: bool = True
    apply_to_future_slots: bool = False


class PitchUpdate(InputSchema):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sport: Sport | None = None
    format: str | None = Field(default=None, min_length=1, max_length=16)
    capacity: int | None = Field(default=None, ge=2, le=40)
    is_indoor: bool | None = None
    has_camera: bool | None = None
    camera_price_paise: int | None = Field(default=None, ge=0, le=1_000_000)
    price_per_hour_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    peak_price_per_hour_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    is_active: bool | None = None
    apply_to_future_slots: bool = False


# ───────────── Earnings & settlements ─────────────


class SettlementOut(Schema):
    id: uuid.UUID
    period_start: date
    period_end: date
    booking_count: int
    gross_paise: int
    refunds_paise: int
    provider_discounts_paise: int
    commission_bps: int
    commission_paise: int
    gst_on_commission_paise: int
    tcs_paise: int
    tds_paise: int
    net_payable_paise: int
    status: SettlementStatus
    paid_at: datetime | None
    payout_ref: str | None


class SettlementLineOut(Schema):
    booking_id: uuid.UUID
    booking_code: str
    turf_name: str
    played_at: datetime
    gross_paise: int
    refunds_paise: int
    provider_discounts_paise: int
    commission_paise: int


class SettlementDetail(SettlementOut):
    lines: list[SettlementLineOut]


class EarningsByTurf(Schema):
    turf_id: uuid.UUID
    turf_name: str
    pytch_gross_paise: int
    offline_paise: int
    bookings: int


class PartnerEarnings(Schema):
    from_: date = Field(alias="from", serialization_alias="from")
    to: date
    pytch_gross_paise: int
    commission_paise: int
    pytch_net_paise: int
    offline_revenue_paise: int
    unsettled_paise: int  # net of games already played (past the settlement hold) not yet in a statement
    upcoming_paise: int  # net of confirmed games still to be played / inside the hold (not payable yet)
    by_turf: list[EarningsByTurf]
    series: list[RevenuePoint]
