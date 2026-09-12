"""Shared FastAPI dependencies."""

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import DemoDisabled, Unauthorized
from app.core.security import decode_token
from app.modules.users.models import User

_bearer = HTTPBearer(auto_error=False)

DB = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if creds is None:
        raise Unauthorized()
    user_id = decode_token(creds.credentials, "access")
    user = await db.get(User, user_id)
    if user is None:
        raise Unauthorized("Account not found")
    return user


async def get_optional_user(
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User | None:
    if creds is None:
        return None
    try:
        return await get_current_user(db, creds)
    except Unauthorized:
        return None


def require_demo_mode() -> None:
    if not settings.demo_mode:
        raise DemoDisabled()


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
