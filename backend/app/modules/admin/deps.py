"""Admin request context — the most restrictive guard in the system.

Checks, in order: IP allowlist → bearer token (admin audience, admin signing key) → session
(exists, not revoked, not expired, not idle) → admin account active & MFA enrolled → permission
→ optional step-up (TOTP within ADMIN_STEP_UP_MINUTES).
"""

import ipaddress
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import DB, Credentials
from app.core.errors import AppError, Forbidden, Unauthorized
from app.core.ratelimit import client_ip
from app.core.security import decode_claims
from app.core.timeutils import utcnow
from app.modules.admin.models import AdminUser
from app.modules.admin.permissions import STEP_UP_ACTIONS, has_perm
from app.modules.auth.models import AuthSession
from app.modules.auth.sessions import idle_expired, is_revoked, step_up_fresh

PII_ROLES = {"super_admin", "ops", "finance"}


class StepUpRequired(AppError):
    code, status_code, message = "STEP_UP_REQUIRED", 403, "Confirm with your authenticator code to continue"


class IpNotAllowed(AppError):
    code, status_code, message = "IP_NOT_ALLOWED", 403, "Admin access isn't allowed from this network"


class MfaRequired(AppError):
    code, status_code, message = "MFA_REQUIRED", 403, "Set up two-factor authentication to continue"


@dataclass
class AdminContext:
    admin: AdminUser
    session: AuthSession
    request: Request

    @property
    def label(self) -> str:
        return f"{self.admin.email} ({self.admin.role})"

    def can(self, perm: str) -> bool:
        return has_perm(self.admin.role, perm)

    @property
    def sees_pii(self) -> bool:
        """Support / read-only roles see masked phone numbers (research §3 RBAC)."""
        return self.admin.role in PII_ROLES


def check_ip_allowed(request: Request) -> None:
    if not settings.admin_ip_allowlist:
        return
    try:
        ip = ipaddress.ip_address(client_ip(request))
    except ValueError as exc:
        raise IpNotAllowed() from exc
    if not any(ip in ipaddress.ip_network(cidr, strict=False) for cidr in settings.admin_ip_allowlist):
        raise IpNotAllowed()


async def load_admin_session(db: AsyncSession, token: str) -> tuple[AdminUser, AuthSession]:
    claims = decode_claims(token, "access", audience="admin")
    sid = claims.get("sid")
    if sid is None or await is_revoked(sid):
        raise Unauthorized("Session ended — please log in again")
    session = await db.get(AuthSession, sid)
    now = utcnow()
    if (
        session is None
        or session.audience != "admin"
        or session.revoked_at is not None
        or session.expires_at <= now
        or session.subject_id != claims["sub"]
    ):
        raise Unauthorized("Session ended — please log in again")
    if idle_expired(session, timedelta(minutes=settings.admin_session_idle_minutes), now):
        session.revoked_at, session.revoked_reason = now, "idle_timeout"
        await db.commit()
        raise Unauthorized("Signed out after inactivity")
    admin = await db.get(AdminUser, claims["sub"])
    if admin is None or not admin.is_active:
        raise Unauthorized("Account disabled")
    if (now - session.last_seen_at).total_seconds() > 60:  # throttle writes
        session.last_seen_at = now
        await db.commit()
    return admin, session


async def get_admin_context(request: Request, db: DB, creds: Credentials) -> AdminContext:
    check_ip_allowed(request)
    if creds is None:
        raise Unauthorized()
    admin, session = await load_admin_session(db, creds.credentials)
    if admin.totp_enabled_at is None:
        raise MfaRequired()
    return AdminContext(admin=admin, session=session, request=request)


CurrentAdmin = Annotated[AdminContext, Depends(get_admin_context)]


async def get_ready_admin_context(ctx: CurrentAdmin) -> AdminContext:
    """Business endpoints: additionally require the temporary password to have been changed
    (must-change-password / must-enroll-MFA states only allow the auth endpoints)."""
    if ctx.admin.must_change_password:
        from app.modules.admin.errors import PasswordChangeRequired

        raise PasswordChangeRequired(details={"must_change_password": True})
    return ctx


ReadyAdmin = Annotated[AdminContext, Depends(get_ready_admin_context)]


def ensure_step_up(ctx: AdminContext) -> None:
    """Imperative step-up check for actions whose sensitivity depends on the payload."""
    if not step_up_fresh(ctx.session, timedelta(minutes=settings.admin_step_up_minutes)):
        raise StepUpRequired()


def require_perm(*perms: str, step_up: bool | None = None):
    """Dependency factory. `step_up=None` → automatic for STEP_UP_ACTIONS."""

    async def _dep(ctx: ReadyAdmin) -> AdminContext:
        for perm in perms:
            if not ctx.can(perm):
                raise Forbidden(f"Your role ({ctx.admin.role}) can't do this")
        needs_step_up = step_up if step_up is not None else any(p in STEP_UP_ACTIONS for p in perms)
        if needs_step_up and not step_up_fresh(ctx.session, timedelta(minutes=settings.admin_step_up_minutes)):
            raise StepUpRequired()
        return ctx

    return _dep
