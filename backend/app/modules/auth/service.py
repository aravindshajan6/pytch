"""Phone OTP login. Codes live in Redis (TTL) with a per-phone request rate limit and an attempt cap.

Player logins are session-backed (`auth.sessions`, audience "app"): refresh tokens rotate on every use and a
replayed (already-rotated) refresh token revokes the whole session. The partner portal reuses the same OTP store,
rate limits and `users` identity (`check_code`, `get_or_create_user`) with its own audience.
"""

import hmac
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.codes import otp_code
from app.core.config import settings
from app.core.deps import ensure_user_active
from app.core.errors import AppError, RateLimited, Unauthorized
from app.core.logging import logger
from app.core.ratelimit import enforce
from app.core.redis import get_redis
from app.core.security import decode_claims
from app.core.timeutils import utcnow
from app.modules.auth import sessions
from app.modules.auth.schemas import AuthTokens, OtpRequestResponse
from app.modules.users.models import PlayerStats, User
from app.modules.users.schemas import UserMe

MAX_VERIFY_ATTEMPTS = 5
DEMO_PHONE_PREFIX = "+9199999"  # seeded demo accounts
DEMO_CODE = "123456"


class InvalidOtp(AppError):
    code, status_code, message = "INVALID_OTP", 400, "That code is incorrect or has expired"


def _code_key(phone: str) -> str:
    return f"pytch:otp:code:{phone}"


def _attempts_key(phone: str) -> str:
    return f"pytch:otp:attempts:{phone}"


def _rate_key(phone: str) -> str:
    return f"pytch:otp:rl:{phone}"


async def request_otp(phone: str, ip: str | None = None) -> OtpRequestResponse:
    """Issue a 6-digit code (5 min TTL). Limits: `otp_max_requests` per `otp_window_seconds` per phone,
    `otp_ip_max_requests` per hour per IP and a global per-minute budget (SMS cost / bombing protection)."""
    if ip:
        await enforce(f"otp-ip:{ip}", settings.otp_ip_max_requests, 3600,
                      "Too many codes requested from this network — try again later")
    await enforce("otp-global", settings.otp_global_max_per_minute, 60,
                  "We're sending a lot of codes right now — try again in a minute")
    redis = get_redis()
    count = await redis.incr(_rate_key(phone))
    if count == 1:
        await redis.expire(_rate_key(phone), settings.otp_window_seconds)
    if count > settings.otp_max_requests:
        ttl = await redis.ttl(_rate_key(phone))
        raise RateLimited(f"Too many codes requested — try again in {max(ttl, 1) // 60 + 1} min")

    code = otp_code()
    async with redis.pipeline(transaction=True) as pipe:
        pipe.set(_code_key(phone), code, ex=settings.otp_ttl_seconds)
        pipe.delete(_attempts_key(phone))
        await pipe.execute()
    if settings.demo_mode:
        logger.info("OTP for %s: %s (demo mode)", phone, code)
    else:  # SMS gateway integration point
        logger.info("OTP issued for %s", phone[:-4] + "****")
    return OtpRequestResponse(sent=True, expires_in=settings.otp_ttl_seconds,
                              dev_code=code if settings.demo_mode else None)


async def _check_code(phone: str, code: str) -> None:
    if settings.demo_mode and phone.startswith(DEMO_PHONE_PREFIX) and code == DEMO_CODE:
        return
    redis = get_redis()
    stored = await redis.get(_code_key(phone))
    if stored is None:
        raise InvalidOtp()
    if not hmac.compare_digest(str(stored), code):
        attempts = await redis.incr(_attempts_key(phone))
        await redis.expire(_attempts_key(phone), settings.otp_ttl_seconds)
        if attempts >= MAX_VERIFY_ATTEMPTS:  # brute-force guard: burn the code
            await redis.delete(_code_key(phone), _attempts_key(phone))
        raise InvalidOtp()
    await redis.delete(_code_key(phone), _attempts_key(phone))


check_code = _check_code  # shared with the partner portal


def _tokens(user: User, access: str, refresh_token: str, *, is_new: bool) -> AuthTokens:
    return AuthTokens(
        access_token=access,
        refresh_token=refresh_token,
        expires_in=settings.access_token_minutes * 60,
        user=UserMe.from_user(user),
        is_new_user=is_new,
    )


async def _get_by_phone(db: AsyncSession, phone: str) -> User | None:
    return (await db.execute(select(User).where(User.phone == phone))).unique().scalar_one_or_none()


async def get_or_create_user(db: AsyncSession, phone: str) -> tuple[User, bool]:
    """The `users` row for a verified phone; first login creates it ("Player XXXX") + stats. Caller commits."""
    now = utcnow()
    user = await _get_by_phone(db, phone)
    is_new = user is None
    if user is None:
        from app.modules.platform.service import ensure_signups_open  # admin kill switch (existing users unaffected)

        await ensure_signups_open(db)
        user = User(id=uuid.uuid4(), phone=phone, name=f"Player {phone[-4:]}", preferred_sports=[],
                    wallet_balance_paise=0, onboarded=False, is_bot=False, created_at=now, updated_at=now)
        user.stats = PlayerStats(user_id=user.id, xp=0, level=1, tier="rookie", tag_counts={})
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:  # concurrent first login for the same phone
            await db.rollback()
            user = await _get_by_phone(db, phone)
            is_new = False
            if user is None:
                raise
    user.last_seen_at = now
    return user, is_new


async def verify_otp(
    db: AsyncSession, phone: str, code: str, *, ip: str | None = None, user_agent: str | None = None
) -> AuthTokens:
    """Verify the code, then open a player session (access + rotating refresh token)."""
    await _check_code(phone, code)
    user, is_new = await get_or_create_user(db, phone)
    ensure_user_active(user)
    _, access, refresh_token = await sessions.create_session(
        db, subject_type="user", subject_id=user.id, audience="app", ip=ip, user_agent=user_agent
    )
    await db.commit()
    return _tokens(user, access, refresh_token, is_new=is_new)


async def rotate_explained(db: AsyncSession, refresh_token: str, audience: str):
    """`sessions.rotate_refresh`, but when the session was ended because the account got suspended/banned the
    holder of a genuine refresh token learns why (403 ACCOUNT_SUSPENDED with reason/until), not a bare 401."""
    try:
        return await sessions.rotate_refresh(db, refresh_token, audience=audience)  # type: ignore[arg-type]
    except Unauthorized:
        try:
            claims = decode_claims(refresh_token, "refresh", audience=audience)  # type: ignore[arg-type]
        except AppError:
            raise
        user = await db.get(User, claims["sub"])
        if user is not None:
            ensure_user_active(user)
        raise


async def refresh(db: AsyncSession, refresh_token: str) -> AuthTokens:
    """Rotate a session-backed refresh token. Legacy tokens without `sid` are rejected; a replayed token
    revokes the session (reuse detection)."""
    session, access, new_refresh = await rotate_explained(db, refresh_token, "app")
    user = await db.get(User, session.subject_id)
    if user is None:
        raise Unauthorized("Account not found")
    ensure_user_active(user)
    await db.commit()
    return _tokens(user, access, new_refresh, is_new=False)


async def logout(db: AsyncSession, access_token: str) -> None:
    """Revoke the session behind this access token (idempotent)."""
    claims = decode_claims(access_token, "access", audience="app")
    sid = claims.get("sid")
    if sid is not None:
        await sessions.revoke_session(db, sid, "logout")
        await db.commit()
