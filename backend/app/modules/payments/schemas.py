"""Payment models. Layer 1."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import InputSchema, Schema

PaymentStatus = Literal["created", "paid", "failed", "refunded", "cancelled"]
PaymentPurpose = Literal["share", "full", "sub_share", "cover_remaining"]
PaymentProvider = Literal["mock", "razorpay", "wallet"]


class PayRequest(InputSchema):
    use_credits: bool = True
    coupon_code: str | None = Field(None, max_length=40)


class RazorpayPrefill(Schema):
    name: str
    contact: str


class RazorpayCheckoutOptions(Schema):
    key_id: str
    order_id: str
    amount: int
    currency: Literal["INR"] = "INR"
    name: str
    description: str
    prefill: RazorpayPrefill


class PaymentIntent(Schema):
    payment_id: uuid.UUID
    status: PaymentStatus
    provider: PaymentProvider
    purpose: PaymentPurpose
    amount_paise: int
    credits_applied_paise: int
    discount_paise: int = 0  # coupon discount
    coupon_code: str | None = None
    payable_paise: int
    lobby_id: uuid.UUID | None
    razorpay: RazorpayCheckoutOptions | None = None


class PaymentOut(Schema):
    id: uuid.UUID
    lobby_id: uuid.UUID | None
    purpose: PaymentPurpose
    provider: PaymentProvider
    amount_paise: int
    credits_applied_paise: int
    payable_paise: int
    status: PaymentStatus
    created_at: datetime
    paid_at: datetime | None


class MockCompleteRequest(InputSchema):
    outcome: Literal["success", "failure"]


class RazorpayVerifyRequest(InputSchema):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
