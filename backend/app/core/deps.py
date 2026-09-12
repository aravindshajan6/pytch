"""Shared FastAPI dependencies (player audience).

Partner and admin contexts live in `app.modules.partner.deps` and `app.modules.admin.deps`.
"""

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import AppError, DemoDisabled, Unauthorized
from app.core.security import Audience, decode_claims
from app.core.timeutils import utcnow
from app.modules.users.models import User

bearer = HTTPBearer(auto_error=False)

DB = Annotated[AsyncSession, Depends(get_db)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


class AccountSuspended(AppError):
    code, status_code, message = "ACCOUNT_SUSPENDED", 403, "This account is suspended"


def ensure_user_active(user: User) -> None:
    """Block suspended/banned accounts (a suspension past `suspended_until` lapses automatically)."""
    if user.status == "active":
        return
    if user.status == "suspended" and user.suspended_until and user.suspended_until <= utcnow():
        return
    raise AccountSuspended(
        "This account is banned" if user.status == "banned" else "This account is suspended",
        details={"reason": user.status_reason, "until": user.suspended_until},
    )


async def authenticate_user(db: AsyncSession, token: str, audience: Audience) -> User:
    """Validate an access token for a `users`-backed audience (app | partner)."""
    from app.modules.auth.sessions import is_revoked

    claims = decode_claims(token, "access", audience=audience)
    sid = claims.get("sid")
    if sid is None:  # every issued token is session-bound; a session-less token could never be revoked
        raise Unauthorized("Session required — please log in again")
    if await is_revoked(sid):
        raise Unauthorized("Session ended — please log in again")
    user = await db.get(User, claims["sub"])
    if user is None:
        raise Unauthorized("Account not found")
    ensure_user_active(user)
    return user


async def get_current_user(db: DB, creds: Credentials) -> User:
    if creds is None:
        raise Unauthorized()
    return await authenticate_user(db, creds.credentials, "app")


async def get_optional_user(db: DB, creds: Credentials) -> User | None:
    if creds is None:
        return None
    try:
        return await get_current_user(db, creds)
    except (Unauthorized, AccountSuspended):
        return None


def require_demo_mode() -> None:
    if not settings.demo_mode:
        raise DemoDisabled()


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
