import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from app.core.deps import DB
from app.core.pagination import Page
from app.core.responses import ORJSONResponse
from app.core.timeutils import ist_today
from app.modules.admin.routers.common import Perm
from app.modules.admin.schemas import (
    AdminBookingDetail,
    AdminBookingRow,
    AdminCancelBooking,
    AdminPaymentDetail,
    AdminPaymentRow,
    AdminWalletTxnOut,
    ApprovalDecision,
    ApprovalOut,
    ApprovalPending,
    ReconciliationDay,
    RefundRequest,
    RefundResult,
    WebhookEventOut,
)
from app.modules.admin.services import approvals as approvals_service
from app.modules.admin.services import bookings as bookings_service
from app.modules.admin.services import payments as payments_service

router = APIRouter(tags=["admin · bookings, payments & approvals"])

# ───────────── bookings ─────────────


@router.get("/bookings", response_model=Page[AdminBookingRow])
async def list_bookings(
    ctx: Perm("bookings.view"), db: DB, q: str | None = Query(None, max_length=80),
    status: Literal["pending_payment", "confirmed", "completed", "cancelled", "expired"] | None = None,
    from_: date | None = Query(None, alias="from"), to: date | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
) -> Page[AdminBookingRow]:
    return await bookings_service.list_bookings(db, ctx, q=q, status=status, date_from=from_, date_to=to,
                                                limit=limit, offset=offset)


@router.get("/bookings/{booking_id}", response_model=AdminBookingDetail)
async def get_booking(booking_id: uuid.UUID, ctx: Perm("bookings.view"), db: DB) -> AdminBookingDetail:
    return await bookings_service.booking_detail(db, ctx, booking_id)


@router.post("/bookings/{booking_id}/cancel", response_model=AdminBookingDetail,
             responses={202: {"model": ApprovalPending,
                              "description": "Source refund above the threshold — queued for a second admin"}})
async def cancel_booking(booking_id: uuid.UUID, body: AdminCancelBooking, ctx: Perm("bookings.manage"), db: DB):
    """🛡 200 → cancelled. Source refunds above REFUND_DUAL_APPROVAL_PAISE → 202 `{approval_id}`."""
    result = await bookings_service.cancel_booking(db, ctx, booking_id, body)
    if isinstance(result, ApprovalPending):
        body_202 = result.model_dump(mode="json")
        body_202["error"] = {"code": "APPROVAL_REQUIRED", "message": result.message,
                             "details": {"approval_id": str(result.approval_id)}}
        return ORJSONResponse(body_202, status_code=202)
    return result


# ───────────── payments ─────────────


@router.get("/payments", response_model=Page[AdminPaymentRow])
async def list_payments(
    ctx: Perm("payments.view"), db: DB,
    status: Literal["created", "paid", "partially_refunded", "failed", "refunded", "cancelled"] | None = None,
    provider: Literal["mock", "razorpay", "wallet"] | None = None, q: str | None = Query(None, max_length=80),
    from_: date | None = Query(None, alias="from"), to: date | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
) -> Page[AdminPaymentRow]:
    return await payments_service.list_payments(db, ctx, status=status, provider=provider, q=q, date_from=from_,
                                                date_to=to, limit=limit, offset=offset)


@router.get("/payments/webhook-events", response_model=list[WebhookEventOut])
async def webhook_events(ctx: Perm("payments.view"), db: DB,
                         limit: int = Query(100, ge=1, le=500)) -> list[WebhookEventOut]:
    return await payments_service.webhook_events(db, limit=limit, pii=ctx.sees_pii)


@router.get("/payments/reconciliation", response_model=ReconciliationDay)
async def reconciliation(_: Perm("payments.view"), db: DB, date: date | None = None) -> ReconciliationDay:
    return await payments_service.reconciliation(db, date or ist_today())


@router.get("/payments/{payment_id}", response_model=AdminPaymentDetail)
async def get_payment(payment_id: uuid.UUID, ctx: Perm("payments.view"), db: DB) -> AdminPaymentDetail:
    """Row + refund history + `refundable_paise` (the server-side refund cap for this payment's seat)."""
    return await payments_service.payment_detail(db, ctx, payment_id)


@router.post("/payments/{payment_id}/refund", response_model=RefundResult,
             responses={202: {"model": ApprovalPending,
                              "description": "Queued for a second admin (APPROVAL_REQUIRED)"}})
async def refund(payment_id: uuid.UUID, body: RefundRequest, ctx: Perm("payments.refund"), db: DB):
    """🛡 200 → refunded. Above REFUND_DUAL_APPROVAL_PAISE → 202 `{approval_id}` (code APPROVAL_REQUIRED)."""
    result = await payments_service.refund(db, ctx, payment_id, body)
    if isinstance(result, ApprovalPending):
        body_202 = result.model_dump(mode="json")
        body_202["error"] = {"code": "APPROVAL_REQUIRED", "message": result.message,
                             "details": {"approval_id": str(result.approval_id)}}
        return ORJSONResponse(body_202, status_code=202)
    return result


@router.get("/wallet/transactions", response_model=Page[AdminWalletTxnOut])
async def wallet_transactions(
    ctx: Perm("payments.view"), db: DB, user_id: uuid.UUID | None = None,
    kind: Literal["refund", "rain_check", "reimbursement", "dropout_credit", "spend", "bonus", "adjustment"]
    | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
) -> Page[AdminWalletTxnOut]:
    return await payments_service.wallet_transactions(db, ctx, user_id=user_id, kind=kind, limit=limit,
                                                      offset=offset)


# ───────────── approvals (maker–checker) ─────────────


@router.get("/approvals", response_model=list[ApprovalOut])
async def list_approvals(
    _: Perm("approvals.decide", step_up=False), db: DB,
    status: Literal["pending", "approved", "rejected", "failed"] | None = None,
) -> list[ApprovalOut]:
    return await approvals_service.list_approvals(db, status=status)


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalOut)
async def approve(approval_id: uuid.UUID, ctx: Perm("approvals.decide"), db: DB,
                  body: ApprovalDecision | None = None) -> ApprovalOut:
    """🛡 decider ≠ requester (403 SELF_APPROVAL). Executes the action."""
    return await approvals_service.decide(db, ctx, approval_id, approve=True, note=body.note if body else None)


@router.post("/approvals/{approval_id}/reject", response_model=ApprovalOut)
async def reject(approval_id: uuid.UUID, ctx: Perm("approvals.decide"), db: DB,
                 body: ApprovalDecision | None = None) -> ApprovalOut:
    return await approvals_service.decide(db, ctx, approval_id, approve=False, note=body.note if body else None)
