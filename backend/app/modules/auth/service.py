"""Phone OTP login. Codes live in Redis (TTL) with a per-phone request rate limit and an attempt cap."""

import hmac
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.codes import otp_code
from app.core.config import settings
from app.core.errors import AppError, RateLimited, Unauthorized
from app.core.logging import logger
from app.core.redis import get_redis
from app.core.security import create_token, decode_token
from app.core.timeutils import utcnow
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


async def request_otp(phone: str) -> OtpRequestResponse:
    """Issue a 6-digit code (5 min TTL). Max `otp_max_requests` per `otp_window_seconds` per phone."""
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


def _tokens(user: User, *, is_new: bool) -> AuthTokens:
    return AuthTokens(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
        expires_in=settings.access_token_minutes * 60,
        user=UserMe.from_user(user),
        is_new_user=is_new,
    )


async def _get_by_phone(db: AsyncSession, phone: str) -> User | None:
    return (await db.execute(select(User).where(User.phone == phone))).unique().scalar_one_or_none()


async def verify_otp(db: AsyncSession, phone: str, code: str) -> AuthTokens:
    """Verify the code; first login creates the user ("Player XXXX") + their stats row."""
    await _check_code(phone, code)
    now = utcnow()
    user = await _get_by_phone(db, phone)
    is_new = user is None
    if user is None:
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
    await db.commit()
    return _tokens(user, is_new=is_new)


async def refresh(db: AsyncSession, refresh_token: str) -> AuthTokens:
    user_id = decode_token(refresh_token, "refresh")
    user = await db.get(User, user_id)
    if user is None:
        raise Unauthorized("Account not found")
    return _tokens(user, is_new=False)
