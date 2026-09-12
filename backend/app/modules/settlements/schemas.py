"""Settlement schemas — `SettlementOut` / `SettlementDetail` (partner.ts) and admin rows (admin.ts)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from app.core.schemas import InputSchema, Schema

SettlementStatus = Literal["draft", "approved", "paid", "failed"]
PayoutMethod = Literal["razorpay_route", "manual_neft"]


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


class AdminSettlementRow(SettlementOut):
    provider_id: uuid.UUID
    provider_name: str
    adjustments_paise: int
    generated_by: str | None
    approved_by: str | None
    payout_method: PayoutMethod | None


class AdminSettlementDetail(AdminSettlementRow):
    lines: list[SettlementLineOut]


class GenerateSettlements(InputSchema):
    period_start: date
    period_end: date
    provider_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check(self) -> "GenerateSettlements":
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start")
        if (self.period_end - self.period_start).days > 92:
            raise ValueError("a settlement period can span at most 93 days")
        return self


class PaySettlement(InputSchema):
    method: PayoutMethod
    reference: str | None = Field(None, max_length=40)  # UTR for manual NEFT


class FailSettlement(InputSchema):
    reason: str = Field("Payout failed", min_length=2, max_length=300)
