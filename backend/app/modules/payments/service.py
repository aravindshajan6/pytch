"""Payments: intents (credits first), one idempotent capture path, provider callbacks.

Lock order everywhere: lobby row → payment row → coupon → wallet user rows (prevents deadlocks with
leave/expiry). `create_intent` takes the payer's user row lock *before* inserting the payment (FK key-share
then FOR UPDATE on the same row deadlocks two concurrent payments by one user).
`create_intent` / `capture` / `fail` never commit; the use-case functions below do.
"""

import uuid
from typing import Any

import orjson
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, BadRequest, Conflict, NotFound
from app.core.timeutils import utcnow
from app.modules.coupons import service as coupons
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.errors import AlreadyPaid, LobbyClosed, NotMember, PaymentWindowClosed
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify
from app.modules.payments import ledger
from app.modules.payments.models import Payment, WebhookEvent
from app.modules.payments.providers import ProviderError, get_provider, razorpay
from app.modules.payments.schemas import (
    PaymentIntent,
    PaymentOut,
    RazorpayCheckoutOptions,
    RazorpayPrefill,
    RazorpayVerifyRequest,
)
from app.modules.users.models import User
from app.modules.wallet import service as wallet


class PaymentFailed(AppError):
    code, status_code, message = "PAYMENT_FAILED", 402, "Payment could not be started — please try again"


class InvalidSignature(AppError):
    code, status_code, message = "INVALID_SIGNATURE", 400, "Payment signature verification failed"


_PURPOSE_LABEL = {
    "share": "Share",
    "full": "Full booking",
    "sub_share": "Sub seat",
    "cover_remaining": "Cover remaining seats",
}


def payment_out(payment: Payment) -> PaymentOut:
    return PaymentOut.model_validate(payment)


def _intent(payment: Payment, razorpay_options: RazorpayCheckoutOptions | None = None) -> PaymentIntent:
    return PaymentIntent(
        payment_id=payment.id,
        status=payment.status,  # type: ignore[arg-type]
        provider=payment.provider,  # type: ignore[arg-type]
        purpose=payment.purpose,  # type: ignore[arg-type]
        amount_paise=payment.amount_paise,
        credits_applied_paise=payment.credits_applied_paise,
        discount_paise=payment.discount_paise or 0,
        coupon_code=(payment.meta or {}).get("coupon_code"),
        payable_paise=payment.payable_paise,
        lobby_id=payment.lobby_id,
        razorpay=razorpay_options,
    )


async def _lock_payment(db: AsyncSession, payment_id: uuid.UUID) -> Payment:
    await db.flush()
    payment = await db.scalar(
        select(Payment).where(Payment.id == payment_id).with_for_update().execution_options(populate_existing=True)
    )
    if payment is None:
        raise NotFound("Payment not found")
    return payment


# ═══════════════════════════ interfaces ═══════════════════════════


async def create_intent(
    db: AsyncSession,
    *,
    user: User,
    lobby: Lobby,
    member: LobbyMember | None,
    purpose: str,
    amount_paise: int,
    use_credits: bool,
    provider: str | None = None,
    coupon_code: str | None = None,
) -> PaymentIntent:
    """Create a payment for a lobby seat. A coupon (optional) discounts the payer's own share, then
    credits are applied; if they cover everything the payment uses provider `wallet` and is captured
    immediately. `amount_paise` stays the gross seat price (the seat is credited in full — the
    discount's funder absorbs it). Caller holds the lobby lock + commits.

    Any earlier open intent for the same seat is cancelled (and its credits / coupon use returned),
    so a seat never has two live intents.
    """
    if member is not None:
        await ledger.cancel_pending_payments(db, member_ids=[member.id], reason="superseded by a new attempt")
    now = utcnow()
    await db.flush()  # credits returned by a superseded intent must count towards this one
    coupon, discount = None, 0
    if coupon_code and coupon_code.strip():
        coupon, discount = await coupons.reserve(db, code=coupon_code, user_id=user.id, lobby=lobby,
                                                 purpose=purpose, amount_paise=amount_paise)
    net = amount_paise - discount
    # Lock the payer's wallet row before any FK insert referencing it (payment, redemption) — see
    # `wallet.lock_owner`. Concurrent payments by one user then serialize and each sees the real balance
    # (lock order stays coupon → wallet user).
    payer = await wallet.lock_owner(db, user.id)
    credits = min(payer.wallet_balance_paise, net) if use_credits else 0
    payable = net - credits
    chosen = "wallet" if payable == 0 else (provider or settings.payment_provider)
    payment = Payment(
        id=uuid.uuid4(),
        user_id=user.id,
        lobby_id=lobby.id,
        booking_id=lobby.booking_id,
        member_id=member.id if member else None,
        purpose=purpose,
        provider=chosen,
        amount_paise=amount_paise,
        credits_applied_paise=credits,
        payable_paise=payable,
        status="created",
        coupon_id=coupon.id if coupon is not None else None,
        discount_paise=discount,
        meta={"coupon_code": coupon.code} if coupon is not None else {},
        created_at=now,
        updated_at=now,
    )
    db.add(payment)
    await db.flush()
    if coupon is not None:
        await coupons.record_redemption(db, coupon, user_id=user.id, payment_id=payment.id, lobby_id=lobby.id,
                                        discount_paise=discount)
    if credits > 0:
        await wallet.debit(db, user.id, credits, f"{_PURPOSE_LABEL.get(purpose, 'Payment')} · {lobby.title}",
                           ref_type="payment", ref_id=payment.id)

    if chosen == "wallet":
        payment = await capture(db, payment)
        return _intent(payment)

    try:
        order_id = await get_provider(chosen).create_order(
            amount_paise=payable,
            receipt=str(payment.id),
            notes={"payment_id": str(payment.id), "lobby_id": str(lobby.id), "purpose": purpose},
        )
    except ProviderError as exc:
        raise PaymentFailed(str(exc)) from exc  # the request's transaction (incl. credit debit) rolls back
    payment.provider_order_id = order_id
    options = None
    if chosen == "razorpay":
        options = RazorpayCheckoutOptions(
            key_id=settings.razorpay_key_id or "",
            order_id=order_id,
            amount=payable,
            name=settings.app_name,
            description=f"{_PURPOSE_LABEL.get(purpose, 'Payment')} · {lobby.title}"[:250],
            prefill=RazorpayPrefill(name=user.name, contact=user.phone),
        )
    return _intent(payment, options)


async def capture(db: AsyncSession, payment: Payment, *, provider_payment_id: str | None = None) -> Payment:
    """The single "money arrived" code path (mock, Razorpay verify, Razorpay webhook, wallet).

    Idempotent. If the lobby can no longer accept the payment (expired/cancelled, seat gone,
    window closed, intent superseded) the captured amount is refunded to credits → `refunded`.
    Caller commits.
    """
    lobby = await lobbies.get_lobby(db, payment.lobby_id, for_update=True) if payment.lobby_id else None
    payment = await _lock_payment(db, payment.id)
    if payment.status in ("paid", "refunded"):
        return payment
    if provider_payment_id and not payment.provider_payment_id:
        payment.provider_payment_id = provider_payment_id
    now = utcnow()
    payment.paid_at = now

    member = next((m for m in lobby.members if m.id == payment.member_id), None) if lobby else None
    if payment.status != "created":
        reason: str | None = "This payment attempt had already been cancelled"
    elif lobby is None:
        reason = "This match no longer exists"
    else:
        reason = lobbies.payment_block_reason(lobby, member, payment.purpose, payment.amount_paise, now)
    if reason:
        await _refund_captured(db, payment, reason)
        return payment

    payment.status = "paid"
    assert lobby is not None and member is not None
    await lobbies.apply_captured_payment(db, lobby, member, payment)
    return payment


async def _refund_captured(db: AsyncSession, payment: Payment, reason: str) -> None:
    """Money came in but can't be used: return all of it (credits + provider part) as credits."""
    if payment.coupon_id is not None:
        await coupons.reverse_for_payment(db, payment.id)
    meta = dict(payment.meta or {})
    amount = payment.payable_paise + (0 if meta.get(ledger.CREDITS_RETURNED) else payment.credits_applied_paise)
    meta[ledger.CREDITS_RETURNED] = True
    payment.meta = meta
    payment.status = "refunded"
    payment.refunded_at = utcnow()
    payment.failure_reason = reason[:255]
    if amount > 0:
        await wallet.credit(db, payment.user_id, amount, "refund", f"Refund — {reason}"[:200],
                            ref_type="payment", ref_id=payment.id)
        data: dict[str, Any] = {"payment_id": str(payment.id), "url": "/app/wallet"}
        if payment.lobby_id:
            data["lobby_id"] = str(payment.lobby_id)
        await notify(db, payment.user_id, "wallet_credit", "Payment refunded as Pytch Credits",
                     f"{reason}. ₹{amount / 100:,.0f} is back in your wallet.", data)


async def fail(db: AsyncSession, payment: Payment, reason: str) -> Payment:
    """Provider reported failure: `created` → `failed`, credits applied are returned. Caller commits."""
    if payment.lobby_id:
        await lobbies.get_lobby(db, payment.lobby_id, for_update=True)
    payment = await _lock_payment(db, payment.id)
    if payment.status != "created":
        return payment
    payment.status = "failed"
    payment.failure_reason = reason[:255]
    if payment.coupon_id is not None:
        await coupons.reverse_for_payment(db, payment.id)
    await ledger.return_applied_credits(db, payment, "Credits returned — payment failed")
    return payment


# ═══════════════════════════ use cases (commit) ═══════════════════════════


async def pay_for_seat(
    db: AsyncSession, user: User, lobby_id: uuid.UUID, *, use_credits: bool, provider: str | None = None,
    coupon_code: str | None = None,
) -> PaymentIntent:
    """POST /lobbies/{id}/pay — pay for *my* seat, whatever its type:
    host in full mode → `full` (booking total); sub → `sub_share` (discounted); else `share`."""
    lobby = await lobbies.get_lobby(db, lobby_id, for_update=True)
    member = lobbies.find_active_member(lobby, user.id)
    if member is None:
        raise NotMember()
    if member.status == "paid":
        raise AlreadyPaid()
    now = utcnow()
    if member.reserved_until is not None and member.reserved_until < now and member.role != "host":
        raise PaymentWindowClosed("Your seat reservation expired — rejoin if spots are left")
    if member.role == "host" and lobby.mode == "full":
        purpose, amount = "full", lobby.booking.total_paise
    elif member.role == "sub":
        purpose, amount = "sub_share", member.share_paise
    else:
        purpose, amount = "share", member.share_paise
    reason = lobbies.payment_block_reason(lobby, member, purpose, amount, now)
    if reason:
        raise PaymentWindowClosed(reason)
    intent = await create_intent(db, user=user, lobby=lobby, member=member, purpose=purpose, amount_paise=amount,
                                 use_credits=use_credits, provider=provider, coupon_code=coupon_code)
    await db.commit()
    return intent


async def cover_remaining(
    db: AsyncSession, user: User, lobby_id: uuid.UUID, *, use_credits: bool, coupon_code: str | None = None
) -> PaymentIntent:
    """POST /lobbies/{id}/cover-remaining — host pays every unpaid seat to lock a split game now."""
    if coupon_code and coupon_code.strip():  # coupons only ever discount the payer's own seat
        raise coupons.CouponInvalid(coupons.REASON_MESSAGES["not_applicable"], details={"reason": "not_applicable"})
    lobby = await lobbies.get_lobby(db, lobby_id, for_update=True)
    if lobby.host_id != user.id:
        raise lobbies.NotHost()
    if lobby.mode != "split" or lobby.status != "forming":
        raise LobbyClosed("Cover remaining is only available while a split match is forming")
    host = lobbies.host_member(lobby)
    amount = lobbies.cover_amount(lobby)
    if host is None or amount <= 0:
        raise AlreadyPaid("Every seat is already paid")
    reason = lobbies.payment_block_reason(lobby, host, "cover_remaining", amount, utcnow())
    if reason:
        raise PaymentWindowClosed(reason)
    intent = await create_intent(db, user=user, lobby=lobby, member=host, purpose="cover_remaining",
                                 amount_paise=amount, use_credits=use_credits)
    await db.commit()
    return intent


async def _owned_payment(db: AsyncSession, user: User, payment_id: uuid.UUID) -> Payment:
    payment = await db.get(Payment, payment_id)
    if payment is None or payment.user_id != user.id:
        raise NotFound("Payment not found")
    return payment


async def cancel_mine(db: AsyncSession, user: User, payment_id: uuid.UUID) -> PaymentOut:
    """The payer closed checkout: cancel the open intent now so its credits and coupon use come straight
    back (instead of staying held until a retry or the seat window ends). A late provider capture of a
    cancelled intent is refunded to credits by `capture`, so this is always safe. Idempotent."""
    owned = await _owned_payment(db, user, payment_id)
    if owned.lobby_id:
        await lobbies.get_lobby(db, owned.lobby_id, for_update=True)  # lock order: lobby → payment
    payment = await _lock_payment(db, payment_id)
    if payment.status == "created":
        payment.status = "cancelled"
        payment.failure_reason = "Checkout closed"
        if payment.coupon_id is not None:
            await coupons.reverse_for_payment(db, payment.id)
        await ledger.return_applied_credits(db, payment, "Credits returned — checkout closed")
        await db.commit()
    return payment_out(payment)


async def complete_mock(db: AsyncSession, user: User, payment_id: uuid.UUID, outcome: str) -> PaymentOut:
    """The built-in Pytch Pay sheet reports success/failure for a `mock` payment."""
    payment = await _owned_payment(db, user, payment_id)
    if payment.provider != "mock":
        raise Conflict("Only mock payments can be completed here")
    if payment.status == "created":  # no real money moves for mock — stale intents are a no-op
        if outcome == "success":
            payment = await capture(db, payment, provider_payment_id=f"mock_pay_{uuid.uuid4().hex[:20]}")
        else:
            payment = await fail(db, payment, "Payment declined (simulated)")
        await db.commit()
    return payment_out(payment)


async def verify_razorpay(
    db: AsyncSession, user: User, payment_id: uuid.UUID, body: RazorpayVerifyRequest
) -> PaymentOut:
    """Checkout success callback: verify the signature, then capture."""
    payment = await _owned_payment(db, user, payment_id)
    if payment.provider != "razorpay":
        raise Conflict("Not a Razorpay payment")
    valid = body.razorpay_order_id == payment.provider_order_id and razorpay().verify_payment_signature(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature
    )
    if not valid:
        raise InvalidSignature()
    payment = await capture(db, payment, provider_payment_id=body.razorpay_payment_id)
    await db.commit()
    return payment_out(payment)


async def handle_razorpay_webhook(
    db: AsyncSession, raw_body: bytes, signature: str | None, event_id: str | None
) -> None:
    """HMAC-verified, idempotent (webhook_events) processing of payment.captured / order.paid / payment.failed."""
    if not razorpay().verify_webhook_signature(raw_body, signature):
        raise InvalidSignature()
    try:
        data = orjson.loads(raw_body)
    except orjson.JSONDecodeError as exc:
        raise BadRequest("Invalid webhook payload") from exc
    event = str(data.get("event", ""))
    payload = data.get("payload") or {}
    pay_entity = (payload.get("payment") or {}).get("entity") or {}
    order_entity = (payload.get("order") or {}).get("entity") or {}
    order_id = pay_entity.get("order_id") or order_entity.get("id")
    key = event_id or f"{event}:{pay_entity.get('id') or order_id}"

    inserted = await db.scalar(
        insert(WebhookEvent)
        .values(id=key[:80], provider="razorpay", event=event[:64], payload=data, created_at=utcnow())
        .on_conflict_do_nothing()
        .returning(WebhookEvent.id)
    )
    if inserted is None:  # duplicate delivery
        return
    payment = await db.scalar(select(Payment).where(Payment.provider_order_id == order_id)) if order_id else None
    if payment is not None:
        if event in ("payment.captured", "order.paid"):
            await capture(db, payment, provider_payment_id=pay_entity.get("id"))
        elif event == "payment.failed":
            await fail(db, payment, str(pay_entity.get("error_description") or "Payment failed"))
    await db.commit()


async def my_payments(db: AsyncSession, user: User, *, limit: int = 100) -> list[PaymentOut]:
    rows = (
        await db.scalars(
            select(Payment).where(Payment.user_id == user.id).order_by(Payment.created_at.desc()).limit(limit)
        )
    ).all()
    return [payment_out(p) for p in rows]
