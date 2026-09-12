"""JWT issuing/validation for the three audiences.

    app      players (phone OTP)                      signed with JWT_SECRET
    partner  service-provider staff (phone OTP)       signed with JWT_SECRET, distinct `aud`
    admin    admin console (password + TOTP)          signed with ADMIN_JWT_SECRET (separate key)

Every token carries `aud` and `type`; a token minted for one audience can never be used for
another (PyJWT verifies `aud`). Session-backed tokens carry `sid` so they can be revoked.
"""

import uuid
from datetime import timedelta
from typing import Any, Literal

import jwt

from app.core.config import settings
from app.core.errors import Unauthorized
from app.core.timeutils import utcnow

TokenType = Literal["access", "refresh", "mfa"]
Audience = Literal["app", "partner", "admin"]

_ISSUER = "pytch"


def _secret(audience: Audience) -> str:
    return settings.admin_jwt_secret if audience == "admin" else settings.jwt_secret


def default_ttl(audience: Audience, token_type: TokenType) -> timedelta:
    if token_type == "mfa":
        return timedelta(minutes=5)
    if audience == "admin":
        return (
            timedelta(minutes=settings.admin_access_token_minutes)
            if token_type == "access"
            else timedelta(hours=settings.admin_session_absolute_hours)
        )
    if audience == "partner":
        return (
            timedelta(minutes=settings.partner_access_token_minutes)
            if token_type == "access"
            else timedelta(days=settings.partner_refresh_token_days)
        )
    return (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_days)
    )


def create_token(
    subject_id: uuid.UUID,
    token_type: TokenType,
    *,
    audience: Audience = "app",
    session_id: uuid.UUID | None = None,
    jti: str | None = None,
    ttl: timedelta | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    now = utcnow()
    payload: dict[str, Any] = {
        "iss": _ISSUER,
        "aud": audience,
        "sub": str(subject_id),
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + (ttl or default_ttl(audience, token_type))).timestamp()),
        "jti": jti or uuid.uuid4().hex,
    }
    if session_id is not None:
        payload["sid"] = str(session_id)
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _secret(audience), algorithm=settings.jwt_algorithm)


def decode_claims(token: str, expected_type: TokenType, *, audience: Audience = "app") -> dict[str, Any]:
    """Verify signature, expiry, issuer, audience and token type. Returns the claims."""
    try:
        claims = jwt.decode(
            token,
            _secret(audience),
            algorithms=[settings.jwt_algorithm],
            audience=audience,
            issuer=_ISSUER,
            options={"require": ["exp", "iat", "sub", "aud", "type"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized("Session expired") from exc
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid token") from exc
    if claims.get("type") != expected_type:
        raise Unauthorized("Invalid token type")
    try:
        claims["sub"] = uuid.UUID(claims["sub"])
        if "sid" in claims:
            claims["sid"] = uuid.UUID(claims["sid"])
    except (KeyError, ValueError) as exc:
        raise Unauthorized("Invalid token subject") from exc
    return claims


def decode_token(token: str, expected_type: TokenType, audience: Audience = "app") -> uuid.UUID:
    """Backward-compatible helper returning only the subject id."""
    return decode_claims(token, expected_type, audience=audience)["sub"]
