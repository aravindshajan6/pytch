"""Provider & membership helpers shared by the partner portal (read/write) and the admin console (read-only)."""

import re
import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.modules.providers.models import Provider, ProviderMember
from app.modules.providers.schemas import (
    MemberUserRef,
    PartnerMemberOut,
    PartnerMembership,
    PartnerUserOut,
    PendingBankChange,
    ProviderOut,
)
from app.modules.turfs.models import Turf
from app.modules.users.models import User


def mask_phone(phone: str | None) -> str | None:
    """"+919876543210" → "+91 98••• ••210" (player phones shown to venues)."""
    if not phone:
        return None
    digits = phone.lstrip("+")
    if len(digits) < 8:
        return "••••"
    cc, rest = (digits[:2], digits[2:]) if phone.startswith("+91") else (digits[:-10] or digits[:2], digits[-10:])
    return f"+{cc} {rest[:2]}••• ••{rest[-3:]}"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:60] or "venue-partner"


async def unique_provider_slug(db: AsyncSession, name: str) -> str:
    base = slugify(name)
    slug, n = base, 1
    while await db.scalar(select(Provider.id).where(Provider.slug == slug)):
        n += 1
        slug = f"{base[:55]}-{n}"
    return slug


async def get_provider(db: AsyncSession, provider_id: uuid.UUID) -> Provider:
    provider = await db.get(Provider, provider_id)
    if provider is None:
        raise NotFound("Provider not found")
    return provider


async def venue_counts(db: AsyncSession, provider_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not provider_ids:
        return {}
    rows = await db.execute(
        select(Turf.provider_id, func.count(Turf.id)).where(Turf.provider_id.in_(provider_ids)).group_by(
            Turf.provider_id
        )
    )
    return {pid: n for pid, n in rows.all()}


def provider_out(provider: Provider, *, venue_count: int,
                 pending_bank_change: PendingBankChange | None = None) -> ProviderOut:
    return ProviderOut(
        id=provider.id,
        name=provider.name,
        slug=provider.slug,
        legal_name=provider.legal_name,
        gstin=provider.gstin,
        contact_name=provider.contact_name,
        contact_phone=provider.contact_phone,
        contact_email=provider.contact_email,
        city=provider.city,
        address=provider.address,
        status=provider.status,  # type: ignore[arg-type]
        status_reason=provider.status_reason,
        commission_bps=provider.commission_bps,
        settlement_cycle=provider.settlement_cycle,  # type: ignore[arg-type]
        bank_account_name=provider.bank_account_name,
        bank_account_last4=provider.bank_account_last4,
        bank_ifsc=provider.bank_ifsc,
        kyc_verified=provider.kyc_verified_at is not None,
        payouts_on_hold=bool(provider.payouts_on_hold),
        pending_bank_change=pending_bank_change,
        venue_count=venue_count,
        created_at=provider.created_at,
    )


async def pending_bank_change(db: AsyncSession, provider_id: uuid.UUID) -> PendingBankChange | None:
    """The newest `provider.bank_change` approval still waiting for Pytch finance (masked: IFSC + last 4 only)."""
    from app.modules.admin.models import ApprovalRequest  # admin owns the maker–checker queue

    row = await db.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.action == "provider.bank_change", ApprovalRequest.target_id == str(provider_id),
            ApprovalRequest.status == "pending",
        ).order_by(ApprovalRequest.created_at.desc()).limit(1)
    )
    if row is None:
        return None
    new = (row.payload or {}).get("new") or {}
    return PendingBankChange(account_name=new.get("bank_account_name"), ifsc=new.get("bank_ifsc"),
                             last4=new.get("bank_account_last4"), requested_at=row.created_at)


async def provider_out_loaded(db: AsyncSession, provider: Provider) -> ProviderOut:
    counts = await venue_counts(db, [provider.id])
    return provider_out(provider, venue_count=counts.get(provider.id, 0),
                        pending_bank_change=await pending_bank_change(db, provider.id))


def _uuid_list(values: list | None) -> list[uuid.UUID] | None:
    if values is None:
        return None
    return [uuid.UUID(str(v)) for v in values]


def membership_out(member: ProviderMember) -> PartnerMembership:
    provider = member.provider
    return PartnerMembership(
        provider_id=provider.id,
        provider_name=provider.name,
        provider_status=provider.status,  # type: ignore[arg-type]
        role=member.role,  # type: ignore[arg-type]
        turf_ids=_uuid_list(member.turf_ids),
    )


async def memberships_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[PartnerMembership]:
    """Active memberships (any provider status — pending/rejected drive the onboarding screens)."""
    members = (
        (
            await db.execute(
                select(ProviderMember)
                .where(ProviderMember.user_id == user_id, ProviderMember.status == "active")
                .order_by(ProviderMember.created_at)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    return [membership_out(m) for m in members]


def has_default_name(user: User) -> bool:
    """First OTP login names the account "Player <last 4 digits>" (see `auth.service.get_or_create_user`)."""
    return not (user.name or "").strip() or user.name == f"Player {(user.phone or '')[-4:]}"


def partner_user_out(user: User) -> PartnerUserOut:
    return PartnerUserOut(id=user.id, name=user.name, phone=user.phone, avatar_url=user.avatar_url,
                          name_is_default=has_default_name(user))


def member_out(member: ProviderMember) -> PartnerMemberOut:
    user = member.user if member.status != "invited" else None
    return PartnerMemberOut(
        id=member.id,
        user=MemberUserRef(id=user.id, name=user.name, avatar_url=user.avatar_url) if user is not None else None,
        phone=(user.phone if user is not None else member.invited_phone) or "",
        role=member.role,  # type: ignore[arg-type]
        status=member.status,  # type: ignore[arg-type]
        turf_ids=_uuid_list(member.turf_ids),
        created_at=member.created_at,
    )


async def owner_user_ids(db: AsyncSession, provider_id: uuid.UUID) -> list[uuid.UUID]:
    """Users to alert for a provider (active owners)."""
    rows = await db.scalars(
        select(ProviderMember.user_id).where(
            ProviderMember.provider_id == provider_id,
            ProviderMember.role == "owner",
            ProviderMember.status == "active",
            ProviderMember.user_id.is_not(None),
        )
    )
    return [r for r in rows.all() if r is not None]


async def activate_invites(db: AsyncSession, user: User) -> int:
    """First partner login of an invited phone → the pending invites become active memberships. Caller commits."""
    invites = (
        (
            await db.execute(
                select(ProviderMember).where(
                    ProviderMember.invited_phone == user.phone, ProviderMember.status == "invited"
                )
            )
        )
        .unique()
        .scalars()
        .all()
    )
    activated = 0
    for invite in invites:
        existing = (
            await db.execute(
                select(ProviderMember).where(
                    ProviderMember.provider_id == invite.provider_id,
                    ProviderMember.user_id == user.id,
                    ProviderMember.id != invite.id,
                )
            )
        ).unique().scalar_one_or_none()
        if existing is not None:  # an older (removed) row for the same person: reuse it
            if existing.status == "active":
                invite.status = "removed"
                continue
            existing.role, existing.turf_ids, existing.status = invite.role, invite.turf_ids, "active"
            invite.status = "removed"
        else:
            invite.user_id = user.id
            invite.status = "active"
        activated += 1
    return activated
