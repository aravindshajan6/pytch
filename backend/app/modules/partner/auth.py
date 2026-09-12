"""Partner-portal login: same phone-OTP store, rate limits and `users` identity as players, but separate
sessions/tokens (audience "partner"). Invited team members are activated on their first partner login."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import ensure_user_active
from app.core.errors import Unauthorized
from app.core.security import decode_claims
from app.modules.auth import service as auth_service
from app.modules.auth import sessions
from app.modules.auth.schemas import OtpRequestResponse
from app.modules.partner.schemas import PartnerAuth, PartnerMe
from app.modules.providers.service import activate_invites, memberships_for_user, partner_user_out
from app.modules.users.models import User


async def request_otp(phone: str, ip: str | None = None) -> OtpRequestResponse:
    return await auth_service.request_otp(phone, ip=ip)


async def _auth(db: AsyncSession, user: User, access: str, refresh: str) -> PartnerAuth:
    return PartnerAuth(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.partner_access_token_minutes * 60,
        user=partner_user_out(user),
        memberships=await memberships_for_user(db, user.id),
    )


async def verify_otp(db: AsyncSession, phone: str, code: str, *, ip: str | None, user_agent: str | None) -> PartnerAuth:
    await auth_service.check_code(phone, code)
    user, _ = await auth_service.get_or_create_user(db, phone)
    ensure_user_active(user)
    await activate_invites(db, user)
    _, access, refresh = await sessions.create_session(
        db, subject_type="user", subject_id=user.id, audience="partner", ip=ip, user_agent=user_agent
    )
    await db.commit()
    return await _auth(db, user, access, refresh)


async def refresh(db: AsyncSession, refresh_token: str) -> PartnerAuth:
    session, access, new_refresh = await auth_service.rotate_explained(db, refresh_token, "partner")
    user = await db.get(User, session.subject_id)
    if user is None:
        raise Unauthorized("Account not found")
    ensure_user_active(user)
    await db.commit()
    return await _auth(db, user, access, new_refresh)


async def logout(db: AsyncSession, access_token: str) -> None:
    claims = decode_claims(access_token, "access", audience="partner")
    sid = claims.get("sid")
    if sid is not None:
        await sessions.revoke_session(db, sid, "logout")
        await db.commit()


async def me(db: AsyncSession, user: User) -> PartnerMe:
    return PartnerMe(user=partner_user_out(user), memberships=await memberships_for_user(db, user.id))
