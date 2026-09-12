"""Payments console: lists, refunds (with maker–checker above a threshold), webhooks, reconciliation.

Refund accounting (a captured payment = `credits_applied + payable` of real value; the coupon
discount was never paid):
* destination `credits` → `wallet.credit(kind="refund")`; `source` → Razorpay refund (razorpay mode)
  or a simulated success (mock mode), only up to the provider-captured part (`payable`).
* `payment.meta` keeps `refunds[]`, `refunded_paise`, `refunded_source_paise`; fully refunded ⇒
  status `refunded` + coupon redemption reversed. Partial refunds keep status `paid`.
* For lobby payments the member's `compensated_paise` advances, so a later cancellation never
  refunds the same money twice.
* Cap (`refund_cap`): never more than is still *held for the seat* — paid − compensated (earlier refunds,
  dropout credits already paid out) − coupon discounts − (host) reimbursements already received. A payment
  from an earlier stint of a re-used seat row is settled (0). The maker–checker threshold is cumulative
  over all admin refunds on the seat.
* Refunding a seat of a live (forming/confirmed) match is a goodwill refund: the seat stays paid and the
  match keeps its state; the platform absorbs it (the venue is still paid the booking total). Because
  `compensated_paise` advances, a later cancellation refunds only what is left, a later dropout credit is
  capped at what is left, and a full-mode host's fronted amount (hence future reimbursements) shrinks by
  what was refunded — so money out never exceeds money in.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, BadRequest, Conflict, NotFound
from app.core.pagination import Page
from app.core.timeutils import ist_day_bounds, utcnow
from app.modules.admin.auditing import Actor, audit
from app.modules.admin.deps import AdminContext
from app.modules.admin.models import ApprovalRequest
from app.modules.admin.schemas import (
    AdminPaymentDetail,
    AdminPaymentRefundOut,
    AdminPaymentRow,
    AdminWalletTxnOut,
    ApprovalPending,
    ReconciliationDay,
    ReconciliationMismatch,
    RefundRequest,
    RefundResult,
    WebhookEventOut,
)
from app.modules.admin.services.common import (
    PAYER,
    count,
    day_range,
    like_term,
    payment_row,
    payment_row_by_id,
    payment_rows_query,
    phone_match,
    show_phone,
)
from app.modules.bookings.models import Booking
from app.modules.coupons import service as coupons
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify
from app.modules.payments import ledger
from app.modules.payments.models import Payment, WebhookEvent
from app.modules.payments.providers import ProviderError, create_refund
from app.modules.platform import service as platform
from app.modules.users.models import User
from app.modules.wallet import service as wallet
from app.modules.wallet.models import WalletTransaction


class RefundFailed(AppError):
    code, status_code, message = "PAYMENT_FAILED", 502, "The refund could not be processed"


# ═══════════════════════════ lists ═══════════════════════════


async def list_payments(
    db: AsyncSession, ctx: AdminContext, *, status: str | None, provider: str | None, q: str | None,
    date_from: date | None, date_to: date | None, limit: int, offset: int,
) -> Page[AdminPaymentRow]:
    stmt = payment_rows_query()
    if status == "partially_refunded":  # partial refunds keep status `paid`; the refunded total lives in meta
        stmt = stmt.where(Payment.status == "paid",
                          func.coalesce(Payment.meta["refunded_paise"].as_integer(), 0) > 0)
    elif status:
        stmt = stmt.where(Payment.status == status)
    if provider:
        stmt = stmt.where(Payment.provider == provider)
    if q:
        term = q.strip()
        like = like_term(term)
        conds = [PAYER.name.ilike(like, escape="\\"), phone_match(PAYER.phone, term, ctx.sees_pii),
                 Booking.code.ilike(like, escape="\\"),
                 Payment.provider_payment_id == term, Payment.provider_order_id == term]
        try:
            conds.append(Payment.id == uuid.UUID(term))
        except ValueError:
            pass
        stmt = stmt.where(or_(*[c for c in conds if c is not None]))
    lo, hi = day_range(date_from, date_to)
    if lo is not None:
        stmt = stmt.where(Payment.created_at >= lo)
    if hi is not None:
        stmt = stmt.where(Payment.created_at < hi)
    total = await count(db, stmt)
    rows = (await db.execute(stmt.order_by(Payment.created_at.desc(), Payment.id).limit(limit).offset(offset))).all()
    return Page(items=[payment_row(r, ctx.sees_pii) for r in rows], total=total, limit=limit, offset=offset)


def _refund_entries(meta: dict[str, Any]) -> list[AdminPaymentRefundOut]:
    out = []
    for r in meta.get("refunds") or []:
        if not isinstance(r, dict):
            continue
        try:
            at = datetime.fromisoformat(str(r["at"])) if r.get("at") else None
        except ValueError:
            at = None
        out.append(AdminPaymentRefundOut(
            ref=str(r.get("ref") or ""), amount_paise=int(r.get("amount_paise") or 0),
            destination="source" if r.get("destination") == "source" else "credits",
            reason=r.get("reason"), by=r.get("by"), at=at,
            approval_id=str(r["approval_id"]) if r.get("approval_id") else None,
            kind="cancellation" if r.get("kind") == "cancellation" else "admin_refund",
        ))
    return out


async def payment_detail(db: AsyncSession, ctx: AdminContext, payment_id: uuid.UUID) -> AdminPaymentDetail:
    row = await payment_row_by_id(db, payment_id, ctx.sees_pii)
    payment = await db.get(Payment, payment_id)
    if row is None or payment is None:
        raise NotFound("Payment not found")
    meta = dict(payment.meta or {})
    left, source_left = 0, 0
    if payment.status == "paid":
        lobby = await lobbies.get_lobby(db, payment.lobby_id) if payment.lobby_id else None
        left, source_left = await refund_cap(db, payment, lobby)
        if payment.provider not in ("mock", "razorpay"):
            source_left = 0
    return AdminPaymentDetail(
        **row.model_dump(), user_id=payment.user_id, lobby_id=payment.lobby_id, member_id=payment.member_id,
        provider_order_id=payment.provider_order_id, failure_reason=payment.failure_reason,
        refunded_paise=int(meta.get("refunded_paise", 0)),
        refunded_source_paise=int(meta.get("refunded_source_paise", 0)),
        refundable_paise=left, refundable_to_source_paise=source_left,
        seat_refunded_paise=await _member_refunded(db, payment), refunds=_refund_entries(meta),
    )


_PII_KEYS = {"email", "contact", "phone", "vpa", "name", "card", "bank", "wallet", "notes", "address",
             "customer_id", "token_id", "acquirer_data", "upi"}


def _redact(value: Any) -> Any:
    """Strip personal data from raw gateway payloads for roles that see masked PII."""
    if isinstance(value, dict):
        return {k: ("[redacted]" if k.lower() in _PII_KEYS else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


async def webhook_events(db: AsyncSession, *, limit: int = 100, pii: bool = False) -> list[WebhookEventOut]:
    rows = (await db.scalars(select(WebhookEvent).order_by(WebhookEvent.created_at.desc()).limit(limit))).all()
    return [WebhookEventOut(id=e.id, provider=e.provider, event=e.event, created_at=e.created_at,
                            payload=dict(e.payload or {}) if pii else _redact(dict(e.payload or {}))) for e in rows]


async def wallet_transactions(
    db: AsyncSession, ctx: AdminContext, *, user_id: uuid.UUID | None, kind: str | None, limit: int, offset: int
) -> Page[AdminWalletTxnOut]:
    stmt = select(WalletTransaction, User.name, User.phone).join(User, User.id == WalletTransaction.user_id)
    if user_id:
        stmt = stmt.where(WalletTransaction.user_id == user_id)
    if kind:
        stmt = stmt.where(WalletTransaction.kind == kind)
    total = await count(db, stmt)
    rows = (await db.execute(stmt.order_by(WalletTransaction.created_at.desc(), WalletTransaction.id)
                             .limit(limit).offset(offset))).all()
    return Page(items=[
        AdminWalletTxnOut(id=t.id, user_id=t.user_id, user_name=name, user_phone=show_phone(phone, ctx.sees_pii),
                          amount_paise=t.amount_paise, kind=t.kind, note=t.note,
                          balance_after_paise=t.balance_after_paise, ref_type=t.ref_type, ref_id=t.ref_id,
                          created_at=t.created_at)
        for t, name, phone in rows
    ], total=total, limit=limit, offset=offset)


async def reconciliation(db: AsyncSession, day: date) -> ReconciliationDay:
    lo, hi = ist_day_bounds(day)
    captured = (await db.execute(
        select(func.coalesce(func.sum(Payment.payable_paise), 0), func.count(Payment.id))
        .where(Payment.provider.in_(("mock", "razorpay")), Payment.paid_at >= lo, Payment.paid_at < hi,
               Payment.status.in_(("paid", "refunded")))
    )).one()
    refunded = await db.scalar(
        select(func.coalesce(func.sum(func.coalesce(Payment.meta["refunded_source_paise"].as_integer(), 0)), 0))
        .where(Payment.refunded_at >= lo, Payment.refunded_at < hi)
    )
    issued, spent = (await db.execute(
        select(
            func.coalesce(func.sum(WalletTransaction.amount_paise).filter(WalletTransaction.amount_paise > 0), 0),
            func.coalesce(-func.sum(WalletTransaction.amount_paise).filter(WalletTransaction.amount_paise < 0), 0),
        ).where(WalletTransaction.created_at >= lo, WalletTransaction.created_at < hi)
    )).one()

    mismatches: list[ReconciliationMismatch] = []
    closed = (await db.execute(
        select(Payment.id, Lobby.status).join(Lobby, Lobby.id == Payment.lobby_id)
        .where(Payment.status == "paid", Payment.paid_at >= lo, Payment.paid_at < hi,
               Lobby.status.in_(("expired", "cancelled"))).limit(100)
    )).all()
    mismatches += [ReconciliationMismatch(payment_id=pid, issue=f"captured but the match is {st} and not refunded")
                   for pid, st in closed]
    seatless = (await db.execute(
        select(Payment.id).outerjoin(LobbyMember, LobbyMember.id == Payment.member_id)
        .where(Payment.status == "paid", Payment.paid_at >= lo, Payment.paid_at < hi, Payment.lobby_id.is_not(None),
               or_(LobbyMember.id.is_(None), LobbyMember.status.not_in(("paid", "left")))).limit(100)
    )).scalars().all()
    mismatches += [ReconciliationMismatch(payment_id=pid, issue="paid payment with no active seat") for pid in seatless]
    no_ref = (await db.execute(
        select(Payment.id).where(Payment.provider == "razorpay", Payment.status == "paid",
                                 Payment.provider_payment_id.is_(None), Payment.paid_at >= lo, Payment.paid_at < hi)
        .limit(100)
    )).scalars().all()
    mismatches += [ReconciliationMismatch(payment_id=pid, issue="captured without a Razorpay payment id")
                   for pid in no_ref]
    return ReconciliationDay(date=day, captured_paise=int(captured[0]), captured_count=int(captured[1]),
                             refunded_paise=int(refunded or 0), credits_issued_paise=int(issued),
                             credits_spent_paise=int(spent), mismatches=mismatches)


# ═══════════════════════════ refunds ═══════════════════════════


def refundable(payment: Payment) -> tuple[int, int]:
    """Per-payment view: (real value not yet refunded by an admin, part of it still on the source rail).
    Doesn't know about money that left the seat another way — use `refund_cap` for the admin limit."""
    meta = payment.meta or {}
    real = payment.amount_paise - (payment.discount_paise or 0)  # credits_applied + payable
    left = real - int(meta.get("refunded_paise", 0))
    source_left = payment.payable_paise - int(meta.get("refunded_source_paise", 0))
    return max(left, 0), max(min(source_left, left), 0)


async def _seat_held(db: AsyncSession, payment: Payment, lobby: Lobby | None) -> int | None:
    """Money still actually held for the payment's seat (None = not a lobby seat payment).

    Same formula as a cancellation (`lobbies._refund_everyone`): paid − already compensated (admin
    refunds, dropout credits, earlier refunds) − coupon discounts − (host) reimbursements received.
    A payment from an earlier stint of a re-used seat row (paid before the member re-joined) is settled.
    """
    if lobby is None or payment.member_id is None:
        return None
    member = next((m for m in lobby.members if m.id == payment.member_id), None)
    if member is None:
        return 0
    if payment.paid_at is not None and member.joined_at is not None and payment.paid_at < member.joined_at:
        return 0
    discount = (await ledger.paid_discounts(db, lobby.id, member_ids=[member.id])).get(member.id, 0)
    held = member.paid_paise - member.compensated_paise - discount
    if member.user_id == lobby.host_id:
        held -= await lobbies.host_reimbursed(db, lobby)
    return max(held, 0)


async def refund_cap(db: AsyncSession, payment: Payment, lobby: Lobby | None) -> tuple[int, int]:
    """(max an admin may still refund, part of it that may go to source): the per-payment remainder,
    capped by what is still held for the seat — never what already went back as a dropout credit,
    a host reimbursement or an earlier refund (SEC2-02)."""
    left, source_left = refundable(payment)
    held = await _seat_held(db, payment, lobby)
    if held is not None:
        left = min(left, held)
    return left, min(source_left, left)


async def _member_refunded(db: AsyncSession, payment: Payment) -> int:
    """Admin refunds already issued on this seat (all its payments) — the maker–checker threshold is
    cumulative per seat, so a refund can't be split across a member's payments to dodge it."""
    if payment.member_id is None:
        return int((payment.meta or {}).get("refunded_paise", 0))
    metas = (await db.scalars(select(Payment.meta).where(Payment.member_id == payment.member_id))).all()
    return sum(int((m or {}).get("refunded_paise", 0)) for m in metas)


def _check_cap(amount: int, cap: int) -> None:
    if amount > cap:
        raise BadRequest(f"At most ₹{cap / 100:,.2f} of this payment can still be refunded — the rest already went "
                         "back (refunds, dropout credit or host reimbursements)", details={"refundable_paise": cap})


async def lock_payment_with_lobby(db: AsyncSession, payment_id: uuid.UUID) -> tuple[Payment, Lobby | None]:
    """Lock order: lobby → payment (same as the payments module)."""
    lobby_id = await db.scalar(select(Payment.lobby_id).where(Payment.id == payment_id))
    lobby = await lobbies.get_lobby(db, lobby_id, for_update=True) if lobby_id else None
    await db.flush()
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id).with_for_update()
                              .execution_options(populate_existing=True))
    if payment is None:
        raise NotFound("Payment not found")
    return payment, lobby


async def execute_refund(
    db: AsyncSession, actor: Actor, payment: Payment, lobby: Lobby | None, *, amount: int, destination: str,
    reason: str, approval_id: uuid.UUID | None = None,
) -> str:
    """Move the money (no commit). Returns the refund reference. Caller holds lobby + payment locks."""
    if payment.status != "paid":
        raise Conflict(f"Only captured payments can be refunded (this one is {payment.status})")
    total_left, source_left = await refund_cap(db, payment, lobby)
    _check_cap(amount, total_left)
    if destination == "source":
        if payment.provider not in ("mock", "razorpay"):
            raise BadRequest("This payment was made with credits — refund it to credits")
        if amount > source_left:
            raise BadRequest(f"At most ₹{source_left / 100:,.2f} can go back to the original payment method",
                             details={"refundable_to_source_paise": source_left})
    fully_refunded = amount == refundable(payment)[0]  # the payment's own remainder, not the seat cap
    if fully_refunded and payment.coupon_id is not None:  # lock order: coupon before wallet user rows
        await coupons.reverse_for_payment(db, payment.id)
    if destination == "source":
        try:
            ref = await create_refund(rail=payment.provider, provider_payment_id=payment.provider_payment_id,
                                      amount_paise=amount,
                                      receipt=f"rf_{uuid.uuid4().hex[:24]}",
                                      notes={"payment_id": str(payment.id), "reason": reason[:200]})
        except ProviderError as exc:
            raise RefundFailed(str(exc)) from exc
    else:
        txn = await wallet.credit(db, payment.user_id, amount, "refund", f"Refund — {reason}"[:200],
                                  ref_type="admin_refund", ref_id=payment.id)
        ref = f"credits:{txn.id}"
    now = utcnow()
    meta = dict(payment.meta or {})
    meta["refunds"] = [*meta.get("refunds", []), {
        "ref": ref, "amount_paise": amount, "destination": destination, "reason": reason[:300],
        "at": now.isoformat(), "by": actor.label, **({"approval_id": str(approval_id)} if approval_id else {}),
    }]
    meta["refunded_paise"] = int(meta.get("refunded_paise", 0)) + amount
    if destination == "source":
        meta["refunded_source_paise"] = int(meta.get("refunded_source_paise", 0)) + amount
    payment.meta = meta
    payment.refunded_at = now
    compensation = amount
    if fully_refunded:
        payment.status = "refunded"
        compensation += payment.discount_paise or 0  # the seat's gross share is now fully settled
    if lobby is not None and payment.member_id is not None:
        member = next((m for m in lobby.members if m.id == payment.member_id), None)
        if member is not None:
            member.compensated_paise = min(member.paid_paise, member.compensated_paise + compensation)
    data: dict[str, Any] = {"payment_id": str(payment.id), "url": "/app/wallet"}
    body = (f"₹{amount / 100:,.0f} is back in your Pytch Credits." if destination == "credits"
            else f"₹{amount / 100:,.0f} is on its way back to your original payment method (5–7 working days).")
    await notify(db, payment.user_id, "wallet_credit", "Refund issued", body, data)
    return ref


async def refund(
    db: AsyncSession, ctx: AdminContext, payment_id: uuid.UUID, body: RefundRequest
) -> RefundResult | ApprovalPending:
    payment, lobby = await lock_payment_with_lobby(db, payment_id)
    if payment.status != "paid":
        raise Conflict(f"Only captured payments can be refunded (this one is {payment.status})")
    total_left, _ = await refund_cap(db, payment, lobby)
    _check_cap(body.amount_paise, total_left)
    threshold = await platform.get_setting("refund_dual_approval_paise", db)
    already = await _member_refunded(db, payment)
    # cumulative per seat: splitting a large refund into small ones (or across the seat's payments)
    # must not dodge the second admin
    if already + body.amount_paise > threshold:
        pending = await db.scalar(select(func.count()).select_from(ApprovalRequest).where(
            ApprovalRequest.action == "payment.refund", ApprovalRequest.target_id == str(payment.id),
            ApprovalRequest.status == "pending"))
        if pending:
            raise Conflict("A refund for this payment is already awaiting approval")
        approval = ApprovalRequest(
            id=uuid.uuid4(), action="payment.refund", target_type="payment", target_id=str(payment.id),
            payload={"amount_paise": body.amount_paise, "destination": body.destination, "reason": body.reason},
            summary=f"Refund ₹{body.amount_paise / 100:,.2f} to {body.destination} — {body.reason}"[:300],
            status="pending", requested_by_admin_id=ctx.admin.id, created_at=utcnow(),
        )
        db.add(approval)
        await db.flush([approval])
        await audit(db, ctx, "approval.request", f"Requested approval: {approval.summary}", target_type="payment",
                    target_id=payment.id, changes={"approval_id": str(approval.id), **approval.payload,
                                                   "threshold_paise": threshold, "already_refunded_paise": already})
        await db.commit()
        return ApprovalPending(approval_id=approval.id,
                               message="Refunds above the threshold need a second admin — request queued")
    before = {"status": payment.status, "refunded_paise": int((payment.meta or {}).get("refunded_paise", 0))}
    ref = await execute_refund(db, ctx, payment, lobby, amount=body.amount_paise, destination=body.destination,
                               reason=body.reason)
    await audit(db, ctx, "payment.refund",
                f"Refunded ₹{body.amount_paise / 100:,.2f} to {body.destination} — {body.reason}",
                target_type="payment", target_id=payment.id,
                changes={"status": [before["status"], payment.status],
                         "refunded_paise": [before["refunded_paise"], payment.meta["refunded_paise"]],
                         "destination": body.destination, "ref": ref})
    await db.commit()
    row = await payment_row_by_id(db, payment.id, ctx.sees_pii)
    assert row is not None
    return RefundResult(payment=row, refund_id=ref, amount_paise=body.amount_paise, destination=body.destination)


async def source_refund_exposure(db: AsyncSession, lobby: Lobby) -> int:
    """Upper bound of money a `refund_destination=source` cancellation would push back to cards/UPI."""
    rows = (await db.scalars(
        select(Payment).where(Payment.lobby_id == lobby.id, Payment.status == "paid",
                              Payment.provider.in_(("mock", "razorpay")))
    )).all()
    return sum(max(0, p.payable_paise - int((p.meta or {}).get("refunded_source_paise", 0))) for p in rows)


async def source_refund_for_cancellation(
    db: AsyncSession, actor: Actor, lobby: Lobby, reason: str
) -> int:
    """Before an admin cancels a lobby with `refund_destination=source`: send each member's
    provider-captured money back to source (capped at what they're owed); `cancel_lobby` then returns
    the rest (credits part) as credits. Returns the amount sent to source. Caller holds the lobby lock."""
    host_reimbursed = int(await db.scalar(
        select(func.coalesce(func.sum(WalletTransaction.amount_paise), 0)).where(
            WalletTransaction.user_id == lobby.host_id, WalletTransaction.kind == "reimbursement",
            WalletTransaction.ref_type == "lobby", WalletTransaction.ref_id == lobby.id)
    ) or 0)
    await db.flush()
    payments = (await db.scalars(
        select(Payment).where(Payment.lobby_id == lobby.id, Payment.status == "paid",
                              Payment.provider.in_(("mock", "razorpay")), Payment.member_id.is_not(None))
        .order_by(Payment.paid_at).with_for_update().execution_options(populate_existing=True)
    )).all()
    by_member: dict[uuid.UUID, list[Payment]] = {}
    for p in payments:
        by_member.setdefault(p.member_id, []).append(p)  # type: ignore[arg-type]
    sent = 0
    for member in lobby.members:
        mine = by_member.get(member.id)
        if not mine:
            continue
        discount = sum(p.discount_paise or 0 for p in mine)
        owed = member.paid_paise - member.compensated_paise - discount - (
            host_reimbursed if member.user_id == lobby.host_id else 0)
        for p in mine:
            if owed <= 0:
                break
            _, source_left = refundable(p)
            amount = min(source_left, owed)
            if amount <= 0:
                continue
            await execute_refund(db, actor, p, lobby, amount=amount, destination="source", reason=reason)
            owed -= amount
            sent += amount
    return sent

