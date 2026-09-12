"""Coupon schemas — player `CouponValidation` (api.ts) and admin `CouponOut` / `CouponInput` (admin.ts)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.core.schemas import InputSchema, Schema

DiscountType = Literal["percent", "flat"]
FundedBy = Literal["platform", "provider", "shared"]
CODE_PATTERN = r"^[A-Za-z0-9_-]{3,24}$"


class ValidateCouponRequest(InputSchema):
    code: str = Field(min_length=1, max_length=40)
    lobby_id: uuid.UUID


class CouponValidation(Schema):
    valid: bool
    code: str
    discount_paise: int
    final_paise: int
    message: str


class CouponOut(Schema):
    id: uuid.UUID
    code: str
    description: str
    discount_type: DiscountType
    percent_off: int | None
    amount_off_paise: int | None
    max_discount_paise: int | None
    min_amount_paise: int
    starts_at: datetime | None
    ends_at: datetime | None
    usage_limit_total: int | None
    usage_limit_per_user: int
    used_count: int
    first_booking_only: bool
    sports: list[str]
    turf_ids: list[uuid.UUID]
    provider_id: uuid.UUID | None
    funded_by: FundedBy
    provider_share_pct: int
    is_active: bool
    total_discount_paise: int
    created_at: datetime


class _CouponFields(InputSchema):
    description: str = Field("", max_length=200)
    discount_type: DiscountType = "percent"
    percent_off: int | None = Field(None, ge=0, le=100)  # 0 / null for flat coupons
    amount_off_paise: int | None = Field(None, ge=0, le=10_000_000)  # 0 / null for percent coupons
    max_discount_paise: int | None = Field(None, ge=0, le=10_000_000)  # 0 / null = no cap
    min_amount_paise: int = Field(0, ge=0, le=100_000_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit_total: int | None = Field(None, ge=1, le=10_000_000)
    usage_limit_per_user: int = Field(1, ge=1, le=1000)
    first_booking_only: bool = False
    sports: list[str] = Field(default_factory=list, max_length=20)
    turf_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    provider_id: uuid.UUID | None = None
    funded_by: FundedBy = "platform"
    provider_share_pct: int = Field(0, ge=0, le=100)
    is_active: bool = True


class CouponInput(_CouponFields):
    """POST /admin/coupons (`CouponInput` = CouponOut minus id/used_count/total_discount_paise/created_at)."""

    code: str = Field(pattern=CODE_PATTERN)

    @model_validator(mode="after")
    def _check(self) -> "CouponInput":
        validate_coupon_shape(self.model_dump())
        return self


class CouponPatch(InputSchema):
    """PATCH /admin/coupons/{id} — any subset of CouponInput (code is immutable once used)."""

    code: str | None = Field(None, pattern=CODE_PATTERN)
    description: str | None = Field(None, max_length=200)
    discount_type: DiscountType | None = None
    percent_off: int | None = Field(None, ge=0, le=100)
    amount_off_paise: int | None = Field(None, ge=0, le=10_000_000)
    max_discount_paise: int | None = Field(None, ge=0, le=10_000_000)
    min_amount_paise: int | None = Field(None, ge=0, le=100_000_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit_total: int | None = Field(None, ge=1, le=10_000_000)
    usage_limit_per_user: int | None = Field(None, ge=1, le=1000)
    first_booking_only: bool | None = None
    sports: list[str] | None = Field(None, max_length=20)
    turf_ids: list[uuid.UUID] | None = Field(None, max_length=500)
    provider_id: uuid.UUID | None = None
    funded_by: FundedBy | None = None
    provider_share_pct: int | None = Field(None, ge=0, le=100)
    is_active: bool | None = None
    # read-only fields a client may echo back from CouponOut — ignored
    id: uuid.UUID | None = Field(None, exclude=True)
    used_count: int | None = Field(None, exclude=True)
    total_discount_paise: int | None = Field(None, exclude=True)
    created_at: datetime | None = Field(None, exclude=True)


def validate_coupon_shape(data: dict) -> None:
    """Cross-field rules shared by create and patch (raises ValueError → 422 / BadRequest)."""
    if data.get("discount_type") == "percent" and not data.get("percent_off"):
        raise ValueError("percent coupons need percent_off")
    if data.get("discount_type") == "flat" and (data.get("amount_off_paise") or 0) < 100:
        raise ValueError("flat coupons need amount_off_paise (at least ₹1)")
    starts, ends = data.get("starts_at"), data.get("ends_at")
    if starts and ends and ends <= starts:
        raise ValueError("ends_at must be after starts_at")
    if data.get("funded_by") in ("provider", "shared") and not data.get("provider_id"):
        raise ValueError("provider-funded coupons must target a provider")
    if data.get("funded_by") == "shared" and not (0 < (data.get("provider_share_pct") or 0) < 100):
        raise ValueError("shared coupons need provider_share_pct between 1 and 99")


class CouponRedemptionOut(Schema):
    id: uuid.UUID
    user_name: str
    user_phone: str
    payment_id: uuid.UUID
    lobby_title: str | None
    discount_paise: int
    status: Literal["applied", "reversed"]
    created_at: datetime
