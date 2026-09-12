"""Settlements and coupons."""

import uuid
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.core.deps import DB
from app.core.errors import Forbidden
from app.modules.admin.deps import AdminContext, ensure_step_up
from app.modules.admin.routers.common import Perm
from app.modules.admin.services.common import mask_phone
from app.modules.coupons import service as coupons
from app.modules.coupons.schemas import CouponInput, CouponOut, CouponPatch, CouponRedemptionOut
from app.modules.settlements import service as settlements
from app.modules.settlements.schemas import (
    AdminSettlementDetail,
    AdminSettlementRow,
    FailSettlement,
    GenerateSettlements,
    PaySettlement,
)

router = APIRouter(tags=["admin · settlements & coupons"])

# ───────────── settlements ─────────────


@router.get("/settlements", response_model=list[AdminSettlementRow])
async def list_settlements(_: Perm("payouts.view"), db: DB,
                           status: Literal["draft", "approved", "paid", "failed"] | None = None,
                           provider_id: uuid.UUID | None = None) -> list[AdminSettlementRow]:
    return await settlements.list_settlements(db, status=status, provider_id=provider_id)


@router.post("/settlements/generate", response_model=list[AdminSettlementRow])
async def generate(body: GenerateSettlements, ctx: Perm("payouts.manage"), db: DB) -> list[AdminSettlementRow]:
    """🛡 Drafts for bookings whose slot ended more than SETTLEMENT_HOLD_HOURS ago (each booking settles once)."""
    created = await settlements.generate(db, ctx, period_start=body.period_start, period_end=body.period_end,
                                         provider_id=body.provider_id)
    ids = {s.id for s in created}
    return [row for row in await settlements.list_settlements(db) if row.id in ids]


@router.get("/settlements/{settlement_id}", response_model=AdminSettlementDetail)
async def get_settlement(settlement_id: uuid.UUID, _: Perm("payouts.view"), db: DB) -> AdminSettlementDetail:
    return await settlements.admin_detail(db, settlement_id)


@router.post("/settlements/{settlement_id}/approve", response_model=AdminSettlementDetail)
async def approve(settlement_id: uuid.UUID, ctx: Perm("payouts.manage"), db: DB) -> AdminSettlementDetail:
    """🛡 approver ≠ generator (403 SELF_APPROVAL)."""
    return await settlements.approve(db, ctx, settlement_id)


@router.post("/settlements/{settlement_id}/pay", response_model=AdminSettlementDetail)
async def pay(settlement_id: uuid.UUID, body: PaySettlement, ctx: Perm("payouts.manage"),
              db: DB) -> AdminSettlementDetail:
    return await settlements.pay(db, ctx, settlement_id, body)


@router.post("/settlements/{settlement_id}/fail", response_model=AdminSettlementDetail)
async def fail(settlement_id: uuid.UUID, ctx: Perm("payouts.manage"), db: DB,
               body: FailSettlement | None = None) -> AdminSettlementDetail:
    return await settlements.fail(db, ctx, settlement_id, body.reason if body else "Payout failed")


@router.get("/settlements/{settlement_id}/export.csv")
async def export_settlement(settlement_id: uuid.UUID, ctx: Perm("payouts.view", "data.export"), db: DB) -> Response:
    filename, body = await settlements.export_csv(db, ctx, settlement_id)
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ───────────── coupons ─────────────

HIGH_BUDGET_PAISE = 25_000_00  # ₹25,000 — coupons with a bigger (or unbounded) budget need a fresh step-up
_BUDGET_FIELDS = {"discount_type", "percent_off", "amount_off_paise", "max_discount_paise", "usage_limit_total",
                  "is_active"}


_PROVIDER_FUNDED = ("provider", "shared")
_HARMLESS_FIELDS = {"description"}  # edits a coupon admin may make to a provider-funded coupon


def _budget_guard(ctx: AdminContext, data: dict) -> None:
    budget = coupons.potential_budget_paise(data)
    if data.get("is_active", True) and (budget is None or budget > HIGH_BUDGET_PAISE):
        ensure_step_up(ctx)


def _provider_funding_guard(ctx: AdminContext, *states: dict) -> None:
    """Coupons paid for (fully or partly) by a provider's settlement: only roles that manage providers
    (`providers.manage` — not marketing), always with a fresh step-up. The provider owner is notified."""
    if any(st.get("funded_by") in _PROVIDER_FUNDED for st in states):
        if not ctx.can("providers.manage"):
            raise Forbidden("Only admins who manage providers can set up provider-funded coupons")
        ensure_step_up(ctx)


@router.get("/coupons", response_model=list[CouponOut])
async def list_coupons(_: Perm("coupons.view"), db: DB, q: str | None = Query(None, max_length=40),
                       active: bool | None = None) -> list[CouponOut]:
    return await coupons.list_coupons(db, q=q, active=active)


@router.post("/coupons", response_model=CouponOut, status_code=201)
async def create_coupon(body: CouponInput, ctx: Perm("coupons.manage"), db: DB) -> CouponOut:
    """🛡 provider/shared funding → `providers.manage` + step-up (403 otherwise)."""
    data = body.model_dump()
    _provider_funding_guard(ctx, data)
    _budget_guard(ctx, data)
    return await coupons.create_coupon(db, ctx, body)


@router.patch("/coupons/{coupon_id}", response_model=CouponOut)
async def update_coupon(coupon_id: uuid.UUID, body: CouponPatch, ctx: Perm("coupons.manage"), db: DB) -> CouponOut:
    patch = body.model_dump(exclude_unset=True)
    current = coupons.coupon_out(await coupons.get_coupon(db, coupon_id)).model_dump()
    merged = {**current, **patch}
    if patch.keys() - _HARMLESS_FIELDS:
        _provider_funding_guard(ctx, current, merged)
    if patch.keys() & _BUDGET_FIELDS:
        _budget_guard(ctx, merged)
    return await coupons.update_coupon(db, ctx, coupon_id, body)


@router.post("/coupons/{coupon_id}/disable", response_model=CouponOut)
async def disable_coupon(coupon_id: uuid.UUID, ctx: Perm("coupons.manage"), db: DB) -> CouponOut:
    return await coupons.disable_coupon(db, ctx, coupon_id)


@router.get("/coupons/{coupon_id}/redemptions", response_model=list[CouponRedemptionOut])
async def redemptions(coupon_id: uuid.UUID, ctx: Perm("coupons.view"), db: DB) -> list[CouponRedemptionOut]:
    rows = await coupons.list_redemptions(db, coupon_id)
    if not ctx.sees_pii:  # marketing / support / read-only see masked phone numbers
        rows = [r.model_copy(update={"user_phone": mask_phone(r.user_phone)}) for r in rows]
    return rows
