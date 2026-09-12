"""Partner-portal request context.

Tokens: audience "partner" (phone OTP identity = `users` row). The acting provider is chosen with
the `X-Provider-Id` header (required when the user belongs to several providers).
"""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select

from app.core.deps import DB, Credentials, authenticate_user
from app.core.errors import AppError, Forbidden, Unauthorized
from app.modules.providers.models import Provider, ProviderMember
from app.modules.users.models import User

ROLE_RANK = {"staff": 1, "manager": 2, "owner": 3}


class ProviderNotApproved(AppError):
    code, status_code, message = "PROVIDER_NOT_APPROVED", 403, "Your venue account isn't approved yet"


class ProviderRequired(AppError):
    code, status_code, message = "PROVIDER_REQUIRED", 403, "No venue account linked to this login"


@dataclass
class PartnerContext:
    user: User
    provider: Provider
    member: ProviderMember

    @property
    def role(self) -> str:
        return self.member.role

    def can_access_turf(self, turf_id: uuid.UUID) -> bool:
        scope = self.member.turf_ids
        return scope is None or str(turf_id) in {str(t) for t in scope}


async def get_partner_user(db: DB, creds: Credentials) -> User:
    """Any authenticated partner-audience user (used by onboarding before approval)."""
    if creds is None:
        raise Unauthorized()
    return await authenticate_user(db, creds.credentials, "partner")


PartnerUser = Annotated[User, Depends(get_partner_user)]


async def _resolve(db: DB, user: User, provider_id: uuid.UUID | None) -> tuple[Provider, ProviderMember]:
    q = select(ProviderMember).where(ProviderMember.user_id == user.id, ProviderMember.status == "active")
    if provider_id:
        q = q.where(ProviderMember.provider_id == provider_id)
    members = (await db.scalars(q)).all()
    if not members:
        if provider_id:  # e.g. removed from this business while its tab was open
            raise ProviderRequired("You no longer have access to this venue account")
        raise ProviderRequired()
    if len(members) > 1 and provider_id is None:
        raise AppError("Choose a venue account", code="PROVIDER_REQUIRED", status_code=400,
                       details={"provider_ids": [str(m.provider_id) for m in members]})
    member = members[0]
    return member.provider, member


async def get_partner_context_any_status(
    db: DB,
    user: PartnerUser,
    x_provider_id: Annotated[uuid.UUID | None, Header()] = None,
) -> PartnerContext:
    """Membership required, provider may still be pending (application status screens)."""
    provider, member = await _resolve(db, user, x_provider_id)
    return PartnerContext(user=user, provider=provider, member=member)


async def get_partner_context(
    ctx: Annotated[PartnerContext, Depends(get_partner_context_any_status)],
) -> PartnerContext:
    """Membership in an APPROVED provider — the default for every operational partner endpoint."""
    if ctx.provider.status != "approved":
        raise ProviderNotApproved(details={"status": ctx.provider.status, "reason": ctx.provider.status_reason})
    return ctx


def require_partner_role(minimum: str):
    """Dependency factory: owner > manager > staff."""

    async def _dep(ctx: Annotated[PartnerContext, Depends(get_partner_context)]) -> PartnerContext:
        if ROLE_RANK.get(ctx.role, 0) < ROLE_RANK[minimum]:
            raise Forbidden(f"Requires {minimum} access")
        return ctx

    return _dep


Partner = Annotated[PartnerContext, Depends(get_partner_context)]
PartnerManager = Annotated[PartnerContext, Depends(require_partner_role("manager"))]
PartnerOwner = Annotated[PartnerContext, Depends(require_partner_role("owner"))]
