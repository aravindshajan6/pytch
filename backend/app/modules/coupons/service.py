"""Coupons: validation, redemption (row-locked) and reversal + admin management.

Rules (research §5, contract §Player-facing coupons)
* A coupon discounts only the redeeming player's own share (for a host paying the full booking the
  discountable base is their per-seat share).
* Redemption locks the coupon row (`SELECT … FOR UPDATE`) and re-checks total / per-user limits,
  first-booking-only, targeting (sport / venue / provider), validity window, minimum amount and cap.
* A failed / cancelled / refunded payment reverses its redemption (`used_count` decremented) — see
  `reverse_for_payment`, called from the payments module.
* Funding: `platform` discounts never reduce the venue payout; `provider` (100 %) and `shared`
  (`provider_share_pct` %) are deducted in the provider's settlement.

Lock order (everywhere): lobby → payment → coupon → redemption → wallet user.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, BadRequest, Conflict, NotFound
from app.core.ratelimit import enforce
from app.core.timeutils import utcnow
from app.modules.admin.auditing import Actor, audit
from app.modules.audit import service as audit_service
from app.modules.coupons.models import Coupon, CouponRedemption
from app.modules.coupons.schemas import (
    CouponInput,
    CouponOut,
    CouponPatch,
    CouponRedemptionOut,
    CouponValidation,
    validate_coupon_shape,
)
from app.modules.lobbies.models import Lobby
from app.modules.payments.models import Payment
from app.modules.users.models import User


class CouponInvalid(AppError):
    code, status_code, message = "COUPON_INVALID", 400, "That coupon can't be applied"


class CouponExhausted(AppError):
    code, status_code, message = "COUPON_EXHAUSTED", 409, "This coupon has been fully redeemed"


REASON_MESSAGES = {
    "not_found": "That code isn't valid",
    "inactive": "This coupon is no longer active",
    "not_started": "This coupon isn't active yet",
    "expired": "This coupon has expired",
    "exhausted": "This coupon has been fully redeemed",
    "per_user_limit": "You've already used this coupon",
    "first_booking_only": "This coupon is only for your first booking",
    "sport": "This coupon isn't valid for this sport",
    "venue": "This coupon isn't valid at this venue",
    "provider": "This coupon isn't valid at this venue",
    "min_amount": "Your share is below this coupon's minimum amount",
    "not_applicable": "This coupon doesn't apply to this payment",
}


def normalize_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


def compute_discount(coupon: Coupon, base_paise: int) -> int:
    if base_paise <= 0:
        return 0
    if coupon.discount_type == "percent":
        discount = base_paise * (coupon.percent_off or 0) // 100
        if coupon.max_discount_paise is not None:
            discount = min(discount, coupon.max_discount_paise)
    else:
        discount = coupon.amount_off_paise or 0
    return max(0, min(discount, base_paise))


def provider_share_of(coupon: Coupon, discount_paise: int) -> int:
    """Part of a discount borne by the provider (deducted from their settlement)."""
    if coupon.funded_by == "provider":
        return discount_paise
    if coupon.funded_by == "shared":
        return discount_paise * coupon.provider_share_pct // 100
    return 0


def discount_base(lobby: Lobby, purpose: str, amount_paise: int) -> int:
    """What a coupon may discount: the payer's own seat (host paying the full booking → one share)."""
    if purpose == "full":
        return min(amount_paise, lobby.share_paise)
    if purpose == "cover_remaining":
        return 0
    return amount_paise


async def _evaluate(
    db: AsyncSession, coupon: Coupon, user_id: uuid.UUID, lobby: Lobby, base_paise: int, now: datetime
) -> tuple[int, str | None]:
    """(discount, None) when applicable, else (0, reason)."""
    if not coupon.is_active:
        return 0, "inactive"
    if coupon.starts_at is not None and now < coupon.starts_at:
        return 0, "not_started"
    if coupon.ends_at is not None and now >= coupon.ends_at:
        return 0, "expired"
    if coupon.usage_limit_total is not None and coupon.used_count >= coupon.usage_limit_total:
        return 0, "exhausted"
    if coupon.sports and lobby.sport not in coupon.sports:
        return 0, "sport"
    if coupon.turf_ids and lobby.turf_id not in set(coupon.turf_ids):
        return 0, "venue"
    if coupon.provider_id is not None:
        from app.modules.turfs.models import Turf

        provider_id = await db.scalar(select(Turf.provider_id).where(Turf.id == lobby.turf_id))
        if provider_id != coupon.provider_id:
            return 0, "provider"
    if base_paise <= 0:
        return 0, "not_applicable"
    if base_paise < coupon.min_amount_paise:
        return 0, "min_amount"
    used_by_me = await db.scalar(
        select(func.count()).select_from(CouponRedemption).where(
            CouponRedemption.coupon_id == coupon.id,
            CouponRedemption.user_id == user_id,
            CouponRedemption.status == "applied",
        )
    )
    if int(used_by_me or 0) >= coupon.usage_limit_per_user:
        return 0, "per_user_limit"
    if coupon.first_booking_only and await db.scalar(
        select(exists().where(Payment.user_id == user_id, Payment.status == "paid"))
    ):
        return 0, "first_booking_only"
    discount = compute_discount(coupon, base_paise)
    if discount <= 0:
        return 0, "not_applicable"
    return discount, None


def _raise_for(reason: str) -> None:
    if reason == "exhausted":
        raise CouponExhausted(details={"reason": reason})
    raise CouponInvalid(REASON_MESSAGES.get(reason, REASON_MESSAGES["not_applicable"]), details={"reason": reason})


# ═══════════════════════════ player: validate ═══════════════════════════


async def validate(db: AsyncSession, user: User, code: str, lobby_id: uuid.UUID) -> CouponValidation:
    """POST /coupons/validate — a dry run for the payer's seat; never reserves the coupon."""
    await enforce(f"coupon-validate:{user.id}", 20, 600, "Too many coupon attempts — try again in a few minutes")
    from app.modules.lobbies.service import find_active_member, get_lobby

    lobby = await get_lobby(db, lobby_id)
    member = find_active_member(lobby, user.id)
    if member is None and lobby.visibility != "public":
        raise NotFound("Match not found")
    if member is not None and member.role == "host" and lobby.mode == "full":
        purpose, amount = "full", lobby.booking.total_paise
    elif member is not None:
        purpose, amount = ("sub_share" if member.role == "sub" else "share"), member.share_paise
    else:
        purpose, amount = "share", lobby.share_paise
    normalized = normalize_code(code)
    coupon = await db.scalar(select(Coupon).where(Coupon.code == normalized))
    if coupon is None:
        discount, reason = 0, "not_found"
    else:
        discount, reason = await _evaluate(db, coupon, user.id, lobby, discount_base(lobby, purpose, amount), utcnow())
    if reason:
        return CouponValidation(valid=False, code=normalized, discount_paise=0, final_paise=amount,
                                message=REASON_MESSAGES.get(reason, REASON_MESSAGES["not_applicable"]))
    return CouponValidation(valid=True, code=normalized, discount_paise=discount, final_paise=amount - discount,
                            message=f"₹{discount / 100:,.0f} off your share")


# ═══════════════════════════ payments integration ═══════════════════════════


async def reserve(
    db: AsyncSession, *, code: str, user_id: uuid.UUID, lobby: Lobby, purpose: str, amount_paise: int
) -> tuple[Coupon, int]:
    """Row-lock the coupon, re-validate every rule and take one use. Caller records the redemption
    (`record_redemption`) once the payment row exists, and commits."""
    coupon = await db.scalar(
        select(Coupon).where(Coupon.code == normalize_code(code)).with_for_update()
        .execution_options(populate_existing=True)
    )
    if coupon is None:
        _raise_for("not_found")
    assert coupon is not None
    discount, reason = await _evaluate(db, coupon, user_id, lobby, discount_base(lobby, purpose, amount_paise),
                                       utcnow())
    if reason:
        _raise_for(reason)
    coupon.used_count += 1
    return coupon, discount


async def record_redemption(
    db: AsyncSession, coupon: Coupon, *, user_id: uuid.UUID, payment_id: uuid.UUID, lobby_id: uuid.UUID | None,
    discount_paise: int,
) -> CouponRedemption:
    redemption = CouponRedemption(
        id=uuid.uuid4(), coupon_id=coupon.id, user_id=user_id, payment_id=payment_id, lobby_id=lobby_id,
        discount_paise=discount_paise, status="applied", created_at=utcnow(),
    )
    db.add(redemption)
    await db.flush([redemption])
    return redemption


async def reverse_for_payment(db: AsyncSession, payment_id: uuid.UUID) -> bool:
    """Payment failed / cancelled / fully refunded → give the use back. Idempotent. Caller commits."""
    await db.flush()
    coupon_id = await db.scalar(
        select(CouponRedemption.coupon_id).where(
            CouponRedemption.payment_id == payment_id, CouponRedemption.status == "applied"
        )
    )
    if coupon_id is None:
        return False
    coupon = await db.scalar(
        select(Coupon).where(Coupon.id == coupon_id).with_for_update().execution_options(populate_existing=True)
    )
    redemption = await db.scalar(
        select(CouponRedemption)
        .where(CouponRedemption.payment_id == payment_id, CouponRedemption.status == "applied")
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if redemption is None or coupon is None:
        return False
    redemption.status = "reversed"
    coupon.used_count = max(0, coupon.used_count - 1)
    return True


# ═══════════════════════════ admin ═══════════════════════════


def potential_budget_paise(data: dict[str, Any]) -> int | None:
    """Worst-case spend of a coupon (None = unbounded) — high budgets need a fresh step-up."""
    per_use = data.get("amount_off_paise") if data.get("discount_type") == "flat" else data.get("max_discount_paise")
    if per_use is None or data.get("usage_limit_total") is None:
        return None
    return int(per_use) * int(data["usage_limit_total"])


async def _totals(db: AsyncSession, coupon_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not coupon_ids:
        return {}
    rows = await db.execute(
        select(CouponRedemption.coupon_id, func.coalesce(func.sum(CouponRedemption.discount_paise), 0))
        .where(CouponRedemption.coupon_id.in_(coupon_ids), CouponRedemption.status == "applied")
        .group_by(CouponRedemption.coupon_id)
    )
    return {cid: int(total) for cid, total in rows.all()}


def coupon_out(coupon: Coupon, total_discount: int = 0) -> CouponOut:
    return CouponOut(
        id=coupon.id, code=coupon.code, description=coupon.description,
        discount_type=coupon.discount_type,  # type: ignore[arg-type]
        percent_off=coupon.percent_off, amount_off_paise=coupon.amount_off_paise,
        max_discount_paise=coupon.max_discount_paise, min_amount_paise=coupon.min_amount_paise,
        starts_at=coupon.starts_at, ends_at=coupon.ends_at, usage_limit_total=coupon.usage_limit_total,
        usage_limit_per_user=coupon.usage_limit_per_user, used_count=coupon.used_count,
        first_booking_only=coupon.first_booking_only, sports=list(coupon.sports or []),
        turf_ids=list(coupon.turf_ids or []), provider_id=coupon.provider_id,
        funded_by=coupon.funded_by,  # type: ignore[arg-type]
        provider_share_pct=coupon.provider_share_pct, is_active=coupon.is_active,
        total_discount_paise=total_discount, created_at=coupon.created_at,
    )


async def list_coupons(db: AsyncSession, *, q: str | None, active: bool | None) -> list[CouponOut]:
    stmt = select(Coupon).order_by(Coupon.created_at.desc())
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Coupon.code.ilike(like), Coupon.description.ilike(like)))
    if active is not None:
        stmt = stmt.where(Coupon.is_active.is_(active))
    coupons = (await db.scalars(stmt.limit(500))).all()
    totals = await _totals(db, [c.id for c in coupons])
    return [coupon_out(c, totals.get(c.id, 0)) for c in coupons]


async def get_coupon(db: AsyncSession, coupon_id: uuid.UUID, *, for_update: bool = False) -> Coupon:
    stmt = select(Coupon).where(Coupon.id == coupon_id)
    if for_update:
        stmt = stmt.with_for_update()
    coupon = await db.scalar(stmt)
    if coupon is None:
        raise NotFound("Coupon not found")
    return coupon


_FIELDS = ("code", "description", "discount_type", "percent_off", "amount_off_paise", "max_discount_paise",
           "min_amount_paise", "starts_at", "ends_at", "usage_limit_total", "usage_limit_per_user",
           "first_booking_only", "sports", "turf_ids", "provider_id", "funded_by", "provider_share_pct", "is_active")


def _snapshot(coupon: Coupon) -> dict[str, Any]:
    return {f: getattr(coupon, f) for f in _FIELDS}


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    data = dict(data)
    if "code" in data and data["code"] is not None:
        data["code"] = normalize_code(data["code"])
    if data.get("discount_type") == "percent":
        data["amount_off_paise"] = None
        if not data.get("max_discount_paise"):
            data["max_discount_paise"] = None
    elif data.get("discount_type") == "flat":
        data["percent_off"] = None
        data["max_discount_paise"] = None
    if data.get("funded_by") in ("platform", "provider"):
        data["provider_share_pct"] = 0 if data["funded_by"] == "platform" else 100
    return data


async def create_coupon(db: AsyncSession, ctx: Actor, body: CouponInput) -> CouponOut:
    data = _clean(body.model_dump())
    now = utcnow()
    coupon = Coupon(id=uuid.uuid4(), used_count=0, created_by_admin_id=ctx.admin.id, created_at=now,
                    updated_at=now, **data)
    db.add(coupon)
    try:
        await db.flush([coupon])
    except IntegrityError as exc:
        await db.rollback()
        raise Conflict("A coupon with this code already exists") from exc
    await audit(db, ctx, "coupon.create", f"Created coupon {coupon.code}", target_type="coupon",
                target_id=coupon.id, changes={k: [None, v] for k, v in data.items()})
    await _notify_funding_provider(db, coupon, "created")
    await db.commit()
    return coupon_out(coupon)


async def update_coupon(db: AsyncSession, ctx: Actor, coupon_id: uuid.UUID, body: CouponPatch) -> CouponOut:
    coupon = await get_coupon(db, coupon_id, for_update=True)
    before = _snapshot(coupon)
    patch = body.model_dump(exclude_unset=True)
    if "code" in patch and patch["code"] is not None and normalize_code(patch["code"]) != coupon.code \
            and coupon.used_count > 0:
        raise Conflict("A coupon's code can't change once it has been redeemed")
    merged = _clean({**before, **{k: v for k, v in patch.items() if not (v is None and k in _NOT_NULL)}})
    try:
        validate_coupon_shape(merged)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    for field in _FIELDS:
        setattr(coupon, field, merged[field])
    try:
        await db.flush([coupon])
    except IntegrityError as exc:
        await db.rollback()
        raise Conflict("A coupon with this code already exists") from exc
    changes = audit_service.diff(before, _snapshot(coupon))
    await audit(db, ctx, "coupon.update", f"Edited coupon {coupon.code}", target_type="coupon", target_id=coupon.id,
                changes=changes)
    if changes and (before["funded_by"] in _PROVIDER_FUNDED or coupon.funded_by in _PROVIDER_FUNDED):
        await _notify_funding_provider(db, coupon, "updated", previous_provider_id=before["provider_id"])
    await db.commit()
    return coupon_out(coupon, (await _totals(db, [coupon.id])).get(coupon.id, 0))


_PROVIDER_FUNDED = ("provider", "shared")


async def _notify_funding_provider(
    db: AsyncSession, coupon: Coupon, verb: str, *, previous_provider_id: uuid.UUID | None = None
) -> None:
    """Tell the owners of a provider whose settlement funds (part of) a coupon — no silent charges."""
    from app.modules.notifications.service import notify
    from app.modules.providers.models import ProviderMember

    provider_ids = {pid for pid in (coupon.provider_id, previous_provider_id) if pid is not None}
    if not provider_ids:
        return
    owners = (await db.scalars(
        select(ProviderMember.user_id).where(ProviderMember.provider_id.in_(provider_ids),
                                             ProviderMember.role == "owner", ProviderMember.status == "active",
                                             ProviderMember.user_id.is_not(None))
    )).all()
    if coupon.funded_by in _PROVIDER_FUNDED:
        share = "100 %" if coupon.funded_by == "provider" else f"{coupon.provider_share_pct} %"
        body = (f"Coupon {coupon.code} was {verb} by Pytch: {share} of its discounts are deducted from your "
                "settlements. Contact Pytch support if you didn't agree to this.")
    else:
        body = f"Coupon {coupon.code} was {verb} by Pytch and is no longer funded from your settlements."
    for owner_id in set(owners):
        await notify(db, owner_id, "coupon_funding", f"Coupon {coupon.code} {verb}", body,
                     {"coupon_id": coupon.id, "url": "/partner/earnings"})


_NOT_NULL = {"code", "description", "discount_type", "min_amount_paise", "usage_limit_per_user", "first_booking_only",
             "sports", "turf_ids", "funded_by", "provider_share_pct", "is_active"}


async def disable_coupon(db: AsyncSession, ctx: Actor, coupon_id: uuid.UUID) -> CouponOut:
    coupon = await get_coupon(db, coupon_id, for_update=True)
    if coupon.is_active:
        coupon.is_active = False
        await audit(db, ctx, "coupon.disable", f"Disabled coupon {coupon.code}", target_type="coupon",
                    target_id=coupon.id, changes={"is_active": [True, False]})
        await db.commit()
    return coupon_out(coupon, (await _totals(db, [coupon.id])).get(coupon.id, 0))


async def list_redemptions(db: AsyncSession, coupon_id: uuid.UUID, *, limit: int = 500) -> list[CouponRedemptionOut]:
    await get_coupon(db, coupon_id)
    rows = (
        await db.execute(
            select(CouponRedemption, User.name, User.phone, Lobby.title)
            .join(User, User.id == CouponRedemption.user_id)
            .outerjoin(Lobby, Lobby.id == CouponRedemption.lobby_id)
            .where(CouponRedemption.coupon_id == coupon_id)
            .order_by(CouponRedemption.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        CouponRedemptionOut(id=r.id, user_name=name, user_phone=phone, payment_id=r.payment_id, lobby_title=title,
                            discount_paise=r.discount_paise, status=r.status,  # type: ignore[arg-type]
                            created_at=r.created_at)
        for r, name, phone, title in rows
    ]
