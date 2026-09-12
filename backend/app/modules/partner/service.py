"""Partner onboarding (applications), provider profile (incl. maker–checker bank changes) and team management."""

import inspect
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, Conflict, Forbidden, NotFound
from app.core.logging import logger
from app.core.ratelimit import enforce
from app.core.timeutils import utcnow
from app.modules.admin.models import ApprovalRequest
from app.modules.audit import service as audit
from app.modules.auth import sessions
from app.modules.partner import auth
from app.modules.partner.deps import PartnerContext
from app.modules.partner.schemas import PartnerMe
from app.modules.partner.scope import partner_actor
from app.modules.providers.models import Provider, ProviderMember
from app.modules.providers.schemas import (
    InviteMemberRequest,
    PartnerMemberOut,
    PartnerMembership,
    ProviderApplication,
    ProviderOut,
    ProviderUpdate,
    UpdateMemberRequest,
    UpdatePartnerSelf,
)
from app.modules.providers.service import (
    member_out,
    membership_out,
    provider_out_loaded,
    unique_provider_slug,
)
from app.modules.turfs.models import Turf
from app.modules.users.models import User

BANK_FIELDS = ("bank_account_name", "bank_ifsc", "bank_account_last4")
MAX_TEAM = 50


async def _audit(db: AsyncSession, ctx: PartnerContext, action: str, summary: str, *, target_type: str,
                 target_id: Any, changes: dict | None = None) -> None:
    actor = partner_actor(ctx)
    await audit.record(db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label, action=action,
                       summary=summary, target_type=target_type, target_id=target_id, changes=changes)


# ─────────────────────────── onboarding ───────────────────────────


async def partner_signups_enabled(db: AsyncSession) -> bool:
    """Runtime kill switch owned by the admin console (`platform.service.get_setting`); default on."""
    try:
        from app.modules.platform.service import get_setting  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        return True
    try:
        params = list(inspect.signature(get_setting).parameters)
        if params and params[0] == "db":
            value = await get_setting(db, "partner_signups_enabled")
        elif len(params) > 1:
            value = await get_setting("partner_signups_enabled", db)
        else:
            value = await get_setting("partner_signups_enabled")
    except Exception:  # never block onboarding because the settings store is unavailable
        logger.warning("partner: could not read partner_signups_enabled", exc_info=True)
        return True
    if isinstance(value, dict):
        value = value.get("v", True)
    return True if value is None else bool(value)


async def apply(db: AsyncSession, user: User, req: ProviderApplication) -> PartnerMembership:
    """Create a pending provider with the caller as owner (admin reviews it)."""
    if not await partner_signups_enabled(db):
        raise Forbidden("New venue sign-ups are paused right now — please try again later")
    await enforce(f"partner-apply:{user.id}", 5, 86400, "Too many applications today")
    pending = await db.scalar(
        select(Provider.id)
        .join(ProviderMember, ProviderMember.provider_id == Provider.id)
        .where(ProviderMember.user_id == user.id, ProviderMember.role == "owner",
               ProviderMember.status == "active", Provider.status == "pending")
    )
    if pending is not None:
        raise Conflict("You already have an application under review")
    provider = Provider(
        id=uuid.uuid4(),
        name=req.business_name,
        slug=await unique_provider_slug(db, req.business_name),
        legal_name=req.legal_name,
        gstin=req.gstin,
        entity_type=req.entity_type,
        contact_name=req.contact_name,
        contact_phone=user.phone,
        contact_email=req.contact_email,
        city=req.city,
        address=req.address,
        status="pending",
        commission_bps=settings.default_commission_bps,
        bank_account_name=req.bank_account_name,
        bank_ifsc=req.bank_ifsc,
        bank_account_last4=req.bank_account_last4,
        application={
            "venues": [v.model_dump(mode="json") for v in req.venues],
            "listed_on": list(req.listed_on),
            "submitted_at": utcnow().isoformat(),
            "submitted_by_user_id": str(user.id),
        },
    )
    db.add(provider)
    await db.flush([provider])
    member = ProviderMember(id=uuid.uuid4(), provider_id=provider.id, user_id=user.id, role="owner", status="active")
    db.add(member)
    await db.flush([member])
    await audit.record(
        db, actor_type="provider", actor_id=user.id, actor_label=f"{user.name} @ {provider.name} (owner)",
        action="provider.apply", target_type="provider", target_id=provider.id,
        summary=f"Venue partner application: {provider.name} ({len(req.venues)} venue(s), {req.city})",
        changes={"venues": len(req.venues), "listed_on": list(req.listed_on)},
    )
    await db.commit()
    await db.refresh(member, attribute_names=["provider"])
    return membership_out(member)


# ─────────────────────────── provider profile ───────────────────────────


async def update_self(db: AsyncSession, user: User, req: UpdatePartnerSelf) -> PartnerMe:
    """A partner login sets its own display name (first login leaves the generated "Player 1234")."""
    if req.name != user.name:
        before = user.name
        user.name = req.name
        await audit.record(db, actor_type="user", actor_id=user.id, actor_label=req.name, action="user.update_name",
                           summary="Changed their display name (partner portal)", target_type="user",
                           target_id=user.id, changes={"name": [before, req.name]})
        await db.commit()
    return await auth.me(db, user)


async def get_provider(db: AsyncSession, ctx: PartnerContext) -> ProviderOut:
    return await provider_out_loaded(db, ctx.provider)


async def update_provider(db: AsyncSession, ctx: PartnerContext, req: ProviderUpdate) -> ProviderOut:
    """Owner edits. Bank-detail changes are NOT applied here: payouts go on hold and a `provider.bank_change`
    approval request (old/new in its payload) waits for an admin (four-eyes)."""
    provider = ctx.provider
    fields = req.model_dump(exclude_unset=True)
    plain = {k: v for k, v in fields.items() if k not in BANK_FIELDS}
    for key in ("name", "contact_name"):
        if key in plain and plain[key] is None:
            plain.pop(key)
    before = {k: getattr(provider, k) for k in plain}
    for k, v in plain.items():
        setattr(provider, k, v)
    changes = audit.diff(before, plain)
    if changes:
        await _audit(db, ctx, "provider.update", f"Updated business profile ({', '.join(changes)})",
                     target_type="provider", target_id=provider.id, changes=changes)

    bank_new = {k: fields[k] for k in BANK_FIELDS if k in fields}
    old = {k: getattr(provider, k) for k in BANK_FIELDS}
    if bank_new and any(old[k] != v for k, v in bank_new.items()):
        new = {**old, **bank_new}
        superseded = (await db.scalars(
            select(ApprovalRequest).where(
                ApprovalRequest.action == "provider.bank_change", ApprovalRequest.target_id == str(provider.id),
                ApprovalRequest.status == "pending",
            )
        )).all()
        for req_row in superseded:
            req_row.status = "rejected"
            req_row.decided_at = utcnow()
            req_row.decision_note = "Superseded by a newer request from the provider"
        approval = ApprovalRequest(
            id=uuid.uuid4(),
            action="provider.bank_change",
            target_type="provider",
            target_id=str(provider.id),
            payload={"old": old, "new": new, "requested_by_user_id": str(ctx.user.id)},
            summary=f"{provider.name}: payout account change to {new.get('bank_account_name') or '—'} "
                    f"(IFSC {new.get('bank_ifsc') or '—'}, ••{new.get('bank_account_last4') or '—'})"[:300],
            status="pending",
            requested_by_provider_id=provider.id,
        )
        db.add(approval)
        provider.payouts_on_hold = True
        await db.flush([approval])
        await _audit(db, ctx, "provider.bank_change_request", "Requested payout bank change (payouts on hold)",
                     target_type="approval_request", target_id=approval.id,
                     changes={"old_last4": old["bank_account_last4"], "new_last4": new["bank_account_last4"],
                              "superseded": len(superseded)})
    await db.commit()
    return await provider_out_loaded(db, provider)


# ─────────────────────────── team ───────────────────────────


async def list_team(db: AsyncSession, ctx: PartnerContext) -> list[PartnerMemberOut]:
    members = (
        (await db.execute(
            select(ProviderMember).where(ProviderMember.provider_id == ctx.provider.id,
                                         ProviderMember.status != "removed")
            .order_by(ProviderMember.created_at)
        )).unique().scalars().all()
    )
    return [member_out(m) for m in members]


async def _validate_turf_ids(db: AsyncSession, ctx: PartnerContext, turf_ids: list[uuid.UUID] | None) -> list | None:
    if turf_ids is None:
        return None
    wanted = set(turf_ids)
    owned = set((await db.scalars(select(Turf.id).where(Turf.provider_id == ctx.provider.id,
                                                        Turf.id.in_(wanted)))).all()) if wanted else set()
    if wanted - owned:
        raise AppError("Unknown venue in turf_ids", code="VALIDATION_ERROR", status_code=422,
                       details={"turf_ids": sorted(str(t) for t in wanted - owned)})
    return sorted(str(t) for t in wanted)


async def invite(db: AsyncSession, ctx: PartnerContext, req: InviteMemberRequest) -> PartnerMemberOut:
    turf_ids = await _validate_turf_ids(db, ctx, req.turf_ids)
    existing_user = (await db.execute(select(User).where(User.phone == req.phone))).unique().scalar_one_or_none()
    rows = (await db.execute(
        select(ProviderMember).where(ProviderMember.provider_id == ctx.provider.id)
    )).unique().scalars().all()
    if len([m for m in rows if m.status != "removed"]) >= MAX_TEAM:
        raise Conflict(f"A venue account can have at most {MAX_TEAM} team members")
    for m in rows:
        same = m.invited_phone == req.phone or (existing_user is not None and m.user_id == existing_user.id)
        if same and m.status in ("active", "invited"):
            raise Conflict("That phone number is already on your team")
    # reuse a previously removed row for the same person (unique provider+user)
    member = next((m for m in rows if existing_user is not None and m.user_id == existing_user.id), None)
    if member is None:
        member = ProviderMember(id=uuid.uuid4(), provider_id=ctx.provider.id, user_id=None)
        db.add(member)
    member.invited_phone = req.phone
    member.role = req.role
    member.turf_ids = turf_ids
    member.status = "invited"
    await db.flush([member])
    await _audit(db, ctx, "team.invite", f"Invited {req.phone[:-4]}•••• as {req.role}", target_type="provider_member",
                 target_id=member.id, changes={"role": req.role, "turf_ids": turf_ids})
    await db.commit()
    await db.refresh(member)
    return member_out(member)


async def _get_member(db: AsyncSession, ctx: PartnerContext, member_id: uuid.UUID) -> ProviderMember:
    member = await db.get(ProviderMember, member_id)
    if member is None or member.provider_id != ctx.provider.id or member.status == "removed":
        raise NotFound("Team member not found")
    return member


async def _revoke_partner_sessions(db: AsyncSession, member: ProviderMember, reason: str) -> None:
    """Sign a removed member out — but only if this was their last venue account. Sessions aren't per provider,
    so revoking them would also log the person out of their *own* business; there the per-request membership
    check (`deps._resolve`) already cuts off this provider on the very next call."""
    if member.user_id is None:
        return
    others = await db.scalar(
        select(func.count(ProviderMember.id)).where(ProviderMember.user_id == member.user_id,
                                                    ProviderMember.status == "active", ProviderMember.id != member.id)
    )
    if not others:
        await sessions.revoke_all(db, subject_type="user", subject_id=member.user_id, reason=reason,
                                  audience="partner")


async def update_member(db: AsyncSession, ctx: PartnerContext, member_id: uuid.UUID,
                        req: UpdateMemberRequest) -> PartnerMemberOut:
    member = await _get_member(db, ctx, member_id)
    if member.role == "owner" or member.user_id == ctx.user.id:
        raise Forbidden("Owners can't change their own membership here")
    changes: dict[str, list] = {}
    if req.role is not None and req.role != member.role:
        changes["role"] = [member.role, req.role]
        member.role = req.role
    if "turf_ids" in req.model_fields_set:
        turf_ids = await _validate_turf_ids(db, ctx, req.turf_ids)
        if turf_ids != member.turf_ids:
            changes["turf_ids"] = [member.turf_ids, turf_ids]
            member.turf_ids = turf_ids
    if req.status is not None and req.status != member.status:
        if member.status == "invited" and req.status == "active":
            raise AppError("An invite activates when that person logs in", code="VALIDATION_ERROR", status_code=422)
        changes["status"] = [member.status, req.status]
        member.status = req.status
        if req.status == "removed":
            await _revoke_partner_sessions(db, member, "removed_from_team")
    if changes:
        await _audit(db, ctx, "team.update", f"Updated team member ({', '.join(changes)})",
                     target_type="provider_member", target_id=member.id, changes=changes)
    await db.commit()
    await db.refresh(member)
    return member_out(member)


async def remove_member(db: AsyncSession, ctx: PartnerContext, member_id: uuid.UUID) -> None:
    member = await _get_member(db, ctx, member_id)
    if member.role == "owner" or member.user_id == ctx.user.id:
        raise Forbidden("The owner can't be removed")
    member.status = "removed"
    await _revoke_partner_sessions(db, member, "removed_from_team")
    await _audit(db, ctx, "team.remove", f"Removed a {member.role} from the team", target_type="provider_member",
                 target_id=member.id)
    await db.commit()
