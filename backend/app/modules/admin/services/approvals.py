"""Maker–checker approvals. A request is executed only when a *different* admin (with
`approvals.decide` + fresh step-up) approves it.

Actions
* `payment.refund` — created by `POST /admin/payments/{id}/refund` above REFUND_DUAL_APPROVAL_PAISE.
  payload: {amount_paise, destination: credits|source, reason}
* `wallet.adjust` — created by `POST /admin/users/{id}/wallet` for a credit above REFUND_DUAL_APPROVAL_PAISE.
  payload: {amount_paise, reason}. Approve → credits the player (ledger ref = the requesting admin).
* `provider.bank_change` — created by the partner portal when an owner edits bank details (and by
  the admin console for a new Razorpay linked account). While pending, `provider.payouts_on_hold`
  is true. payload: {"old": {<field>: value, …}, "new": {<field>: value, …}} with fields among
  bank_account_name, bank_ifsc, bank_account_last4, razorpay_account_id.
  Approve → the "new" values are applied (idempotent if already applied) and the hold is lifted.
  Reject  → the "old" values are restored and the hold is lifted.
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, BadRequest, Conflict, NotFound
from app.core.timeutils import utcnow
from app.modules.admin.auditing import audit
from app.modules.admin.deps import AdminContext
from app.modules.admin.errors import SelfApproval
from app.modules.admin.models import AdminUser, ApprovalRequest
from app.modules.admin.schemas import ApprovalOut
from app.modules.admin.services import payments as admin_payments
from app.modules.admin.services import users as admin_users
from app.modules.lobbies import service as lobbies_service
from app.modules.notifications.service import notify_many
from app.modules.providers.models import Provider
from app.modules.providers.service import owner_user_ids

BANK_FIELDS = ("bank_account_name", "bank_ifsc", "bank_account_last4", "razorpay_account_id")


async def _labels(db: AsyncSession, rows: list[ApprovalRequest]) -> tuple[dict[uuid.UUID, str], dict[uuid.UUID, str]]:
    admin_ids = {i for r in rows for i in (r.requested_by_admin_id, r.decided_by_admin_id) if i}
    provider_ids = {r.requested_by_provider_id for r in rows if r.requested_by_provider_id}
    admins = dict((await db.execute(select(AdminUser.id, AdminUser.email).where(AdminUser.id.in_(admin_ids)))).all()) \
        if admin_ids else {}
    providers = dict((await db.execute(select(Provider.id, Provider.name).where(Provider.id.in_(provider_ids))))
                     .all()) if provider_ids else {}
    return admins, providers


def _out(r: ApprovalRequest, admins: dict, providers: dict) -> ApprovalOut:
    if r.requested_by_admin_id:
        requested_by = admins.get(r.requested_by_admin_id, "admin")
    elif r.requested_by_provider_id:
        requested_by = providers.get(r.requested_by_provider_id, "provider")
    else:
        requested_by = "system"
    return ApprovalOut(
        id=r.id, action=r.action, target_type=r.target_type, target_id=r.target_id, summary=r.summary,
        payload=dict(r.payload or {}), status=r.status,  # type: ignore[arg-type]
        requested_by=requested_by, decided_by=admins.get(r.decided_by_admin_id) if r.decided_by_admin_id else None,
        decided_at=r.decided_at, decision_note=r.decision_note, result=dict(r.result) if r.result else None,
        created_at=r.created_at,
    )


async def list_approvals(db: AsyncSession, *, status: str | None, limit: int = 200) -> list[ApprovalOut]:
    stmt = select(ApprovalRequest).order_by(ApprovalRequest.created_at.desc())
    if status:
        stmt = stmt.where(ApprovalRequest.status == status)
    rows = list((await db.scalars(stmt.limit(limit))).all())
    admins, providers = await _labels(db, rows)
    return [_out(r, admins, providers) for r in rows]


async def get_approval(db: AsyncSession, approval_id: uuid.UUID) -> ApprovalOut:
    r = await db.get(ApprovalRequest, approval_id)
    if r is None:
        raise NotFound("Approval not found")
    admins, providers = await _labels(db, [r])
    return _out(r, admins, providers)


# ═══════════════════════════ executors ═══════════════════════════

Executor = Callable[[AsyncSession, AdminContext, ApprovalRequest, bool], Awaitable[dict[str, Any]]]


async def _exec_refund(db: AsyncSession, ctx: AdminContext, approval: ApprovalRequest, approve: bool) -> dict:
    if not approve:
        return {}
    payload = approval.payload or {}
    amount = int(payload.get("amount_paise", 0))
    destination = str(payload.get("destination", "credits"))
    if amount <= 0 or destination not in ("credits", "source"):
        raise BadRequest("Malformed refund request")
    payment, lobby = await admin_payments.lock_payment_with_lobby(db, uuid.UUID(approval.target_id))
    ref = await admin_payments.execute_refund(
        db, ctx, payment, lobby, amount=amount, destination=destination,
        reason=str(payload.get("reason") or "Approved refund"), approval_id=approval.id,
    )
    await audit(db, ctx, "payment.refund", f"Refunded ₹{amount / 100:,.2f} to {destination} (approved request)",
                target_type="payment", target_id=payment.id,
                changes={"approval_id": str(approval.id), "amount_paise": amount, "destination": destination,
                         "ref": ref, "status": payment.status})
    return {"refund_id": ref, "payment_status": payment.status}


async def _exec_bank_change(db: AsyncSession, ctx: AdminContext, approval: ApprovalRequest, approve: bool) -> dict:
    provider = await db.scalar(select(Provider).where(Provider.id == uuid.UUID(approval.target_id))
                               .with_for_update(of=Provider).execution_options(populate_existing=True))
    if provider is None:
        raise NotFound("Provider not found")
    payload = approval.payload or {}
    if approve:  # {"new": {...}} (partner portal / console); tolerate a flat payload of bank fields
        values = payload.get("new") or payload.get("after") or {k: payload[k] for k in BANK_FIELDS if k in payload}
    else:
        values = payload.get("old") or payload.get("before") or payload.get("previous")
        if not values:
            raise BadRequest("This request has no previous values to restore")
    if not isinstance(values, dict):
        raise BadRequest("Malformed bank-change request")
    applied = {}
    for field in BANK_FIELDS:
        if field in values:
            old = getattr(provider, field)
            setattr(provider, field, values[field])
            if old != values[field]:
                applied[field] = [old, values[field]]
    await db.flush()
    still_pending = await db.scalar(
        select(func.count()).select_from(ApprovalRequest).where(
            ApprovalRequest.action == "provider.bank_change", ApprovalRequest.target_id == approval.target_id,
            ApprovalRequest.status == "pending", ApprovalRequest.id != approval.id))
    hold_before = provider.payouts_on_hold
    if not still_pending:
        provider.payouts_on_hold = False
    if approve:
        provider.kyc_verified_at = utcnow()
    await audit(db, ctx, f"provider.bank_change_{'approve' if approve else 'reject'}",
                f"{'Applied' if approve else 'Reverted'} payout details for {provider.name}",
                target_type="provider", target_id=provider.id,
                changes={**applied, "payouts_on_hold": [hold_before, provider.payouts_on_hold],
                         "approval_id": str(approval.id)})
    await _notify_bank_decision(db, provider, approve, note=approval.decision_note, resumed=hold_before
                                and not provider.payouts_on_hold)
    return {"applied": list(applied), "payouts_on_hold": provider.payouts_on_hold}


async def _notify_bank_decision(db: AsyncSession, provider: Provider, approve: bool, *, note: str | None,
                                resumed: bool) -> None:
    """Tell the provider's owners how their payout-account change ended (the portal promised a notification)."""
    owners = await owner_user_ids(db, provider.id)
    if not owners:
        return
    data = {"url": "/partner/settings", "provider_id": str(provider.id)}
    if approve:
        title = "Payouts resumed" if resumed else "Payout account updated"
        body = ("Your new payout details were verified by Pytch finance."
                + (" Payouts have resumed." if resumed else " Another change is still under review."))
        await notify_many(db, owners, "payouts_resumed" if resumed else "bank_change_approved", title, body, data)
    else:
        body = ("Your payout-account change wasn't approved, so we kept your previous account"
                + (" and payouts have resumed" if resumed else "") + "."
                + (f" Note from Pytch: {note}" if note else " Contact Pytch support if you need help."))
        await notify_many(db, owners, "bank_change_rejected", "Payout account change not approved", body[:500], data)


async def _exec_booking_cancel(db: AsyncSession, ctx: AdminContext, approval: ApprovalRequest, approve: bool) -> dict:
    if not approve:
        return {}
    from app.modules.admin.services import bookings as admin_bookings

    payload = approval.payload or {}
    lobby = await admin_bookings._lobby_for_booking_id(db, uuid.UUID(approval.target_id))
    lobby = await lobbies_service.get_lobby(db, lobby.id, for_update=True)
    if lobby.status not in ("forming", "confirmed"):
        raise Conflict(f"This booking can no longer be cancelled (it is {lobby.status})")
    await admin_bookings.execute_cancel(db, ctx, lobby, str(payload.get("refund_destination", "source")),
                                        str(payload.get("reason") or "Approved cancellation"))
    return {"booking_id": approval.target_id, "lobby_status": lobby.status}


async def _exec_wallet_adjust(db: AsyncSession, ctx: AdminContext, approval: ApprovalRequest, approve: bool) -> dict:
    if not approve:
        return {}
    payload = approval.payload or {}
    amount = int(payload.get("amount_paise", 0))
    if amount <= 0:
        raise BadRequest("Malformed credit request")
    user = await admin_users.lock_player(db, uuid.UUID(approval.target_id))
    txn = await admin_users.apply_wallet_adjust(
        db, ctx, user, amount, str(payload.get("reason") or "Approved credit"), approval_id=approval.id,
        maker_id=approval.requested_by_admin_id,
    )
    return {"amount_paise": amount, "balance_after_paise": txn.balance_after_paise}


EXECUTORS: dict[str, Executor] = {
    "payment.refund": _exec_refund,
    "wallet.adjust": _exec_wallet_adjust,
    "booking.cancel": _exec_booking_cancel,
    "provider.bank_change": _exec_bank_change,
}


async def decide(
    db: AsyncSession, ctx: AdminContext, approval_id: uuid.UUID, *, approve: bool, note: str | None
) -> ApprovalOut:
    approval = await db.scalar(select(ApprovalRequest).where(ApprovalRequest.id == approval_id).with_for_update())
    if approval is None:
        raise NotFound("Approval not found")
    if approval.status != "pending":
        raise Conflict(f"This request was already {approval.status}")
    if approval.requested_by_admin_id is not None and approval.requested_by_admin_id == ctx.admin.id:
        raise SelfApproval()
    executor = EXECUTORS.get(approval.action)
    if executor is None:
        raise BadRequest(f"Unknown approval action {approval.action}")
    approval.decided_by_admin_id = ctx.admin.id
    approval.decided_at = utcnow()
    approval.decision_note = (note or None) and note[:300]
    try:
        async with db.begin_nested():
            result = await executor(db, ctx, approval, approve)
        approval.status = "approved" if approve else "rejected"
        approval.result = result
    except AppError as exc:
        if not approve:
            raise
        approval.status = "failed"
        approval.result = {"error": exc.message, "code": exc.code}
    await audit(db, ctx, f"approval.{approval.status}", f"{approval.status.title()}: {approval.summary}",
                target_type="approval", target_id=approval.id,
                changes={"status": ["pending", approval.status], "action": approval.action, "note": note,
                         **({"result": approval.result} if approval.result else {})})
    await db.commit()
    return await get_approval(db, approval.id)
