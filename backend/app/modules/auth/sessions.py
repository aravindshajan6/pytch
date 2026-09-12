"""Session lifecycle shared by all audiences.

* Refresh tokens rotate on every use (new jti). Presenting a stale refresh token = token theft
  signal → the whole session is revoked ("reuse detection").
* Revocation is effective immediately for access tokens: a Redis marker is checked on each request.
* Admin sessions additionally enforce an idle timeout and record MFA time for step-up checks.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Unauthorized
from app.core.redis import get_redis
from app.core.security import Audience, create_token, decode_claims, default_ttl
from app.core.timeutils import utcnow
from app.modules.auth.models import AuthSession

_REVOKED_PREFIX = "pytch:revoked-sid:"
_REVOKED_TTL = 60 * 60 * 2  # ≥ longest access-token lifetime


def _new_jti() -> str:
    return uuid.uuid4().hex


async def create_session(
    db: AsyncSession,
    *,
    subject_type: str,
    subject_id: uuid.UUID,
    audience: Audience,
    ip: str | None = None,
    user_agent: str | None = None,
    mfa_verified: bool = False,
) -> tuple[AuthSession, str, str]:
    """Create a session; returns (session, access_token, refresh_token). Caller commits."""
    now = utcnow()
    jti = _new_jti()
    session = AuthSession(
        id=uuid.uuid4(),
        subject_type=subject_type,
        subject_id=subject_id,
        audience=audience,
        current_refresh_jti=jti,
        last_seen_at=now,
        expires_at=now + default_ttl(audience, "refresh"),
        mfa_verified_at=now if mfa_verified else None,
        ip=ip,
        user_agent=user_agent,
        created_at=now,
    )
    db.add(session)
    access = create_token(subject_id, "access", audience=audience, session_id=session.id)
    refresh = create_token(subject_id, "refresh", audience=audience, session_id=session.id, jti=jti,
                           ttl=session.expires_at - now)
    return session, access, refresh


async def rotate_refresh(db: AsyncSession, refresh_token: str, *, audience: Audience) -> tuple[AuthSession, str, str]:
    """Validate + rotate a refresh token. Returns (session, access, refresh). Caller commits."""
    claims = decode_claims(refresh_token, "refresh", audience=audience)
    sid = claims.get("sid")
    if sid is None:
        raise Unauthorized("Session required — please log in again")
    session = await db.scalar(select(AuthSession).where(AuthSession.id == sid).with_for_update())
    now = utcnow()
    if session is None or session.audience != audience or session.subject_id != claims["sub"]:
        raise Unauthorized("Session not found")
    if session.revoked_at is not None or session.expires_at <= now:
        raise Unauthorized("Session ended — please log in again")
    if claims.get("jti") != session.current_refresh_jti:
        await _revoke(db, session, "refresh_reuse")
        await db.commit()
        raise Unauthorized("Session revoked for your security — please log in again")
    session.current_refresh_jti = _new_jti()
    session.last_seen_at = now
    access = create_token(session.subject_id, "access", audience=audience, session_id=session.id)
    refresh = create_token(session.subject_id, "refresh", audience=audience, session_id=session.id,
                           jti=session.current_refresh_jti, ttl=session.expires_at - now)
    return session, access, refresh


async def _revoke(db: AsyncSession, session: AuthSession, reason: str) -> None:
    if session.revoked_at is None:
        session.revoked_at = utcnow()
        session.revoked_reason = reason[:60]
    await get_redis().set(_REVOKED_PREFIX + str(session.id), "1", ex=_REVOKED_TTL)
    # close this session's live WebSockets on every API instance right away
    from app.realtime.publisher import publish

    await publish(f"session:{session.id}", "session.revoked", {"reason": reason[:60]})


async def revoke_session(db: AsyncSession, session_id: uuid.UUID, reason: str) -> None:
    session = await db.get(AuthSession, session_id)
    if session is not None:
        await _revoke(db, session, reason)


async def revoke_all(
    db: AsyncSession, *, subject_type: str, subject_id: uuid.UUID, reason: str, audience: str | None = None,
    except_session: uuid.UUID | None = None,
) -> int:
    """Revoke every live session of a subject (logout everywhere, suspension, password change)."""
    q = select(AuthSession).where(
        AuthSession.subject_type == subject_type,
        AuthSession.subject_id == subject_id,
        AuthSession.revoked_at.is_(None),
    )
    if audience:
        q = q.where(AuthSession.audience == audience)
    sessions = (await db.scalars(q)).all()
    n = 0
    for s in sessions:
        if s.id != except_session:
            await _revoke(db, s, reason)
            n += 1
    return n


async def is_revoked(session_id: uuid.UUID) -> bool:
    return bool(await get_redis().exists(_REVOKED_PREFIX + str(session_id)))


async def mark_mfa(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(update(AuthSession).where(AuthSession.id == session_id).values(mfa_verified_at=utcnow()))


def step_up_fresh(session: AuthSession, window: timedelta) -> bool:
    return session.mfa_verified_at is not None and utcnow() - session.mfa_verified_at <= window


def idle_expired(session: AuthSession, idle: timedelta, now: datetime | None = None) -> bool:
    return (now or utcnow()) - session.last_seen_at > idle
