"""Provider / membership shapes (mirror `frontend/src/types/partner.ts`). Shared by partner & admin."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.core.schemas import InputSchema, Schema
from app.modules.auth.schemas import PHONE_PATTERN

ProviderStatus = Literal["pending", "approved", "rejected", "suspended"]
PartnerRole = Literal["owner", "manager", "staff"]
MemberStatus = Literal["invited", "active", "removed"]
SettlementCycle = Literal["weekly", "biweekly", "monthly"]
BlockSource = Literal["walk_in", "phone", "playo", "hudle", "khelomore", "other_app", "ical", "api", "maintenance"]
Sport = Literal["football", "cricket", "badminton", "pickleball", "basketball"]

GSTIN_PATTERN = r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"
IFSC_PATTERN = r"^[A-Z]{4}0[A-Z0-9]{6}$"
LAST4_PATTERN = r"^\d{4}$"


class PartnerMembership(Schema):
    provider_id: uuid.UUID
    provider_name: str
    provider_status: ProviderStatus
    role: PartnerRole
    turf_ids: list[uuid.UUID] | None


class PartnerUserOut(Schema):
    id: uuid.UUID
    name: str
    phone: str
    avatar_url: str | None
    name_is_default: bool = False  # still the auto-generated "Player 1234" → the portal asks for a real name


class UpdatePartnerSelf(InputSchema):
    """PATCH /partner/me — the login's own display name (same `users` row as the player app)."""

    name: str = Field(min_length=2, max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        return " ".join(v.split()) if isinstance(v, str) else v


class PendingBankChange(Schema):
    """A payout-account change waiting for Pytch finance (four-eyes). Never the full account number."""

    account_name: str | None
    ifsc: str | None
    last4: str | None
    requested_at: datetime


class ProviderOut(Schema):
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
    settlement_cycle: SettlementCycle
    bank_account_name: str | None
    bank_account_last4: str | None
    bank_ifsc: str | None
    kyc_verified: bool
    payouts_on_hold: bool
    pending_bank_change: PendingBankChange | None
    venue_count: int
    created_at: datetime


class ApplicationVenue(InputSchema):
    name: str = Field(min_length=2, max_length=120)
    area: str = Field(min_length=2, max_length=80)
    address: str = Field(min_length=5, max_length=255)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    sports: list[Sport] = Field(min_length=1, max_length=5)
    pitch_count: int = Field(ge=1, le=30)
    has_indoor: bool = False
    notes: str | None = Field(default=None, max_length=500)


class ProviderApplication(InputSchema):
    business_name: str = Field(min_length=2, max_length=120)
    legal_name: str | None = Field(default=None, max_length=160)
    gstin: str | None = Field(default=None, pattern=GSTIN_PATTERN)
    entity_type: Literal["individual", "proprietorship", "partnership", "llp", "company"] | None = None
    contact_name: str = Field(min_length=2, max_length=80)
    contact_email: str | None = Field(default=None, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    city: str = Field(min_length=2, max_length=60)
    address: str = Field(min_length=5, max_length=255)
    venues: list[ApplicationVenue] = Field(min_length=1, max_length=10)
    bank_account_name: str | None = Field(default=None, max_length=120)
    bank_ifsc: str | None = Field(default=None, pattern=IFSC_PATTERN)
    bank_account_last4: str | None = Field(default=None, pattern=LAST4_PATTERN)
    listed_on: list[BlockSource] = Field(default_factory=list, max_length=9)

    @field_validator("gstin", "bank_ifsc", mode="before")
    @classmethod
    def _upper(cls, v: object) -> object:
        return v.strip().upper() or None if isinstance(v, str) else v


class ProviderUpdate(InputSchema):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    contact_name: str | None = Field(default=None, min_length=2, max_length=80)
    contact_email: str | None = Field(default=None, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    address: str | None = Field(default=None, max_length=255)
    bank_account_name: str | None = Field(default=None, max_length=120)
    bank_ifsc: str | None = Field(default=None, pattern=IFSC_PATTERN)
    bank_account_last4: str | None = Field(default=None, pattern=LAST4_PATTERN)

    @field_validator("bank_ifsc", mode="before")
    @classmethod
    def _upper(cls, v: object) -> object:
        return v.strip().upper() or None if isinstance(v, str) else v


class MemberUserRef(Schema):
    id: uuid.UUID
    name: str
    avatar_url: str | None


class PartnerMemberOut(Schema):
    id: uuid.UUID
    user: MemberUserRef | None
    phone: str
    role: PartnerRole
    status: MemberStatus
    turf_ids: list[uuid.UUID] | None
    created_at: datetime


# venue scope: null = all venues (incl. future ones); otherwise at least one venue — an empty scope is refused
# rather than silently meaning "nothing" (or, worse, "everything")
class InviteMemberRequest(InputSchema):
    phone: str = Field(pattern=PHONE_PATTERN)
    role: Literal["manager", "staff"]
    turf_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=50)


class UpdateMemberRequest(InputSchema):
    role: Literal["manager", "staff"] | None = None
    turf_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=50)
    status: Literal["active", "removed"] | None = None
