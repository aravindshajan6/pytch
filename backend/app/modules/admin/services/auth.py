"""Admin authentication: email + password (argon2id) → mandatory TOTP → short-lived session.

Flow
    POST /login            password check (rate-limited per IP and per email, timing-equalised,
                           generic error, lockout after N failures) → 5-min single-use `mfa_token`
    POST /mfa/enroll/*     first login only: TOTP secret (stored encrypted) + 10 recovery codes
    POST /mfa/verify       TOTP (replay-protected via `totp_last_step`) or a single-use recovery code
    → session: access token in the JSON body (kept in memory by the SPA) + refresh token in an
      httpOnly SameSite=Strict cookie scoped to /api/v1/admin/auth, CSRF double-submit cookie.

Secrets are never logged; responses never contain hashes.
"""

import asyncio
import uuid
from datetime import timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import totp
from app.core.config import settings
from app.core.crypto import constant_time_equals, decrypt, encrypt, keyed_hash, random_token
from app.core.errors import AppError, Conflict, NotFound, Unauthorized
from app.core.passwords import DUMMY_HASH, hash_password, needs_rehash, password_problems, verify_password
from app.core.ratelimit import client_ip, enforce, user_agent
from app.core.redis import get_redis
from app.core.security import create_token, decode_claims
from app.core.timeutils import utcnow
from app.modules.admin.auditing import audit
from app.modules.admin.deps import AdminContext, StepUpRequired, check_ip_allowed
from app.modules.admin.errors import AccountLocked, CsrfFailed, InvalidCredentials, InvalidMfaCode, PasswordPolicy
from app.modules.admin.models import AdminUser
from app.modules.admin.permissions import perms_for
from app.modules.admin.schemas import (
    AdminAuth,
    AdminAuthWithRecovery,
    AdminLoginResponse,
    AdminMe,
    AdminSessionOut,
    MfaEnrollStart,
    StepUpResponse,
)
from app.modules.auth import sessions
from app.modules.auth.models import AuthSession

REFRESH_COOKIE = "pytch_admin_rt"
CSRF_COOKIE = "pytch_admin_csrf"
COOKIE_PATH = f"{settings.api_prefix}/admin/auth"
MAX_LIVE_SESSIONS = 3
MFA_MAX_ATTEMPTS = 5
LOGIN_IP_LIMIT = (10, 15 * 60)  # attempts per window
LOGIN_EMAIL_LIMIT = (10, 15 * 60)

_MFA_USED = "pytch:admin:mfa-used:"
_MFA_ATTEMPTS = "pytch:admin:mfa-attempts:"
_UNKNOWN_FAILS = "pytch:admin:login-fail:"


class WrongCurrentPassword(AppError):
    code, status_code, message = "INVALID_CREDENTIALS", 400, "Your current password is incorrect"


def _email_key(email: str) -> str:
    return keyed_hash("admin-email:" + email)[:32]  # never put raw emails in Redis keys


def _pw_fingerprint(admin: AdminUser) -> str:
    """Binds an mfa_token to the password it was issued for (a password change voids it)."""
    return keyed_hash("pwv:" + admin.password_hash)[:16]


async def _verify_pw(password_hash: str, password: str) -> bool:
    return await asyncio.to_thread(verify_password, password_hash, password)


def admin_me(admin: AdminUser) -> AdminMe:
    return AdminMe(
        id=admin.id, email=admin.email, name=admin.name, role=admin.role,  # type: ignore[arg-type]
        permissions=perms_for(admin.role), mfa_enrolled=admin.totp_enabled_at is not None,
        must_change_password=admin.must_change_password, last_login_at=admin.last_login_at,
        last_login_ip=admin.last_login_ip, previous_login_at=admin.previous_login_at,
        previous_login_ip=admin.previous_login_ip,
    )


class _SelfActor:
    """Audit actor for auth events before an AdminContext exists."""

    def __init__(self, admin: AdminUser, request: Request) -> None:
        self.admin, self.request = admin, request

    @property
    def label(self) -> str:
        return f"{self.admin.email} ({self.admin.role})"


# ═══════════════════════════ login ═══════════════════════════


async def login(db: AsyncSession, request: Request, email: str, password: str) -> AdminLoginResponse:
    check_ip_allowed(request)
    ip = client_ip(request)
    email = email.strip().lower()
    ekey = _email_key(email)
    await enforce(f"admin-login-ip:{ip}", *LOGIN_IP_LIMIT, "Too many sign-in attempts — try again later")
    await enforce(f"admin-login-email:{ekey}", *LOGIN_EMAIL_LIMIT, "Too many sign-in attempts — try again later")
    now = utcnow()
    admin = await db.scalar(select(AdminUser).where(AdminUser.email == email).with_for_update())

    if admin is None:  # same work + same answers as a real account (no enumeration)
        await _verify_pw(DUMMY_HASH, password)
        redis = get_redis()
        fails = await redis.incr(_UNKNOWN_FAILS + ekey)
        if fails == 1:
            await redis.expire(_UNKNOWN_FAILS + ekey, settings.admin_lockout_minutes * 60)
        if fails >= settings.admin_max_failed_logins:
            # identical body to a real locked account (incl. retry_after) — no enumeration via lockout
            ttl = await redis.ttl(_UNKNOWN_FAILS + ekey)
            raise AccountLocked(details={"retry_after": max(int(ttl), 1)})
        raise InvalidCredentials()

    if admin.locked_until is not None and admin.locked_until > now:
        await _verify_pw(DUMMY_HASH, password)
        raise AccountLocked(details={"retry_after": int((admin.locked_until - now).total_seconds()) + 1})

    ok = await _verify_pw(admin.password_hash, password)
    if not ok or not admin.is_active:
        admin.failed_logins = (admin.failed_logins or 0) + 1
        if admin.failed_logins >= settings.admin_max_failed_logins:
            admin.failed_logins = 0
            admin.locked_until = now + timedelta(minutes=settings.admin_lockout_minutes)
            await audit(db, _SelfActor(admin, request), "admin.login_locked",
                        f"Account locked after {settings.admin_max_failed_logins} failed sign-ins",
                        target_type="admin", target_id=admin.id, changes={"ip": ip})
            await db.commit()
            raise AccountLocked(details={"retry_after": settings.admin_lockout_minutes * 60})
        await db.commit()
        raise InvalidCredentials()

    admin.failed_logins = 0
    admin.locked_until = None
    if needs_rehash(admin.password_hash):
        admin.password_hash = await asyncio.to_thread(hash_password, password)
    await db.commit()
    token = create_token(admin.id, "mfa", audience="admin", extra={"pwv": _pw_fingerprint(admin)})
    return AdminLoginResponse(mfa_token=token, mfa_enrolled=admin.totp_enabled_at is not None,
                              must_change_password=admin.must_change_password)


# ═══════════════════════════ MFA ═══════════════════════════


async def _mfa_admin(db: AsyncSession, request: Request, token: str) -> tuple[AdminUser, str]:
    """Validate an mfa_token (unused, not burned, same password) and row-lock its admin."""
    check_ip_allowed(request)
    await enforce(f"admin-mfa-ip:{client_ip(request)}", 30, 15 * 60, "Too many attempts — try again later")
    claims = decode_claims(token, "mfa", audience="admin")
    jti = str(claims.get("jti") or "")
    if not jti or await get_redis().exists(_MFA_USED + jti):
        raise Unauthorized("This sign-in step has expired — please log in again")
    admin = await db.scalar(
        select(AdminUser).where(AdminUser.id == claims["sub"]).with_for_update()
        .execution_options(populate_existing=True)
    )
    if admin is None or not admin.is_active or not constant_time_equals(str(claims.get("pwv", "")),
                                                                        _pw_fingerprint(admin)):
        raise Unauthorized("This sign-in step has expired — please log in again")
    return admin, jti


async def _wrong_code(jti: str) -> None:
    redis = get_redis()
    n = await redis.incr(_MFA_ATTEMPTS + jti)
    if n == 1:
        await redis.expire(_MFA_ATTEMPTS + jti, 600)
    if n >= MFA_MAX_ATTEMPTS:
        await redis.set(_MFA_USED + jti, "1", ex=600)
        raise Unauthorized("Too many wrong codes — please log in again")
    raise InvalidMfaCode()


async def _claim_mfa_token(jti: str) -> None:
    """Single use: the first successful completion wins (atomic SET NX)."""
    if not await get_redis().set(_MFA_USED + jti, "1", nx=True, ex=600):
        raise Unauthorized("This sign-in step was already used — please log in again")


async def enroll_start(db: AsyncSession, request: Request, token: str) -> MfaEnrollStart:
    admin, _ = await _mfa_admin(db, request, token)
    if admin.totp_enabled_at is not None:
        raise Conflict("Two-factor authentication is already set up for this account")
    secret = totp.new_secret()
    admin.totp_secret_enc = encrypt(secret)
    admin.totp_last_step = None
    await db.commit()
    return MfaEnrollStart(secret=secret, otpauth_uri=totp.provisioning_uri(secret, admin.email))


async def enroll_confirm(
    db: AsyncSession, request: Request, token: str, code: str
) -> tuple[AdminAuthWithRecovery, str, AuthSession]:
    admin, jti = await _mfa_admin(db, request, token)
    if admin.totp_enabled_at is not None:
        raise Conflict("Two-factor authentication is already set up for this account")
    if not admin.totp_secret_enc:
        raise Conflict("Start the enrollment first")
    step = totp.verify(decrypt(admin.totp_secret_enc), code, last_used_step=admin.totp_last_step)
    if step is None:
        await _wrong_code(jti)
    await _claim_mfa_token(jti)
    codes = totp.new_recovery_codes(10)
    admin.totp_enabled_at = utcnow()
    admin.totp_last_step = step
    admin.recovery_code_hashes = [totp.hash_recovery_code(c) for c in codes]
    await audit(db, _SelfActor(admin, request), "admin.mfa_enrolled", "Two-factor authentication enabled",
                target_type="admin", target_id=admin.id)
    auth, refresh, session = await _open_session(db, request, admin)
    await db.commit()
    return AdminAuthWithRecovery(**auth.model_dump(), recovery_codes=codes), refresh, session


async def mfa_verify(
    db: AsyncSession, request: Request, token: str, code: str | None, recovery_code: str | None
) -> tuple[AdminAuth, str, AuthSession]:
    admin, jti = await _mfa_admin(db, request, token)
    if admin.totp_enabled_at is None or not admin.totp_secret_enc:
        raise AppError("Set up two-factor authentication first", code="MFA_REQUIRED", status_code=403)
    if bool(code) == bool(recovery_code):
        raise AppError("Enter either an authenticator code or a recovery code", code="VALIDATION_ERROR",
                       status_code=400)
    used_recovery = False
    if code:
        step = totp.verify(decrypt(admin.totp_secret_enc), code, last_used_step=admin.totp_last_step)
        if step is None:
            await _wrong_code(jti)
        await _claim_mfa_token(jti)
        admin.totp_last_step = step
    else:
        digest = totp.hash_recovery_code(recovery_code or "")
        remaining = list(admin.recovery_code_hashes or [])
        match = next((h for h in remaining if constant_time_equals(h, digest)), None)
        if match is None:
            await _wrong_code(jti)
        await _claim_mfa_token(jti)
        remaining.remove(match)
        admin.recovery_code_hashes = remaining  # single use
        used_recovery = True
    if used_recovery:
        await audit(db, _SelfActor(admin, request), "admin.recovery_code_used",
                    f"Signed in with a recovery code ({len(admin.recovery_code_hashes)} left)",
                    target_type="admin", target_id=admin.id)
    auth, refresh, session = await _open_session(db, request, admin)
    await db.commit()
    return auth, refresh, session


async def _open_session(db: AsyncSession, request: Request, admin: AdminUser) -> tuple[AdminAuth, str, AuthSession]:
    ip = client_ip(request)
    session, access, refresh = await sessions.create_session(
        db, subject_type="admin", subject_id=admin.id, audience="admin", ip=ip, user_agent=user_agent(request),
        mfa_verified=True,
    )
    now = utcnow()
    # keep the sign-in before this one: "Previous sign-in" must not show the session being opened right now
    admin.previous_login_at, admin.previous_login_ip = admin.last_login_at, admin.last_login_ip
    admin.last_login_at = now
    admin.last_login_ip = ip
    await db.flush()
    live = (
        await db.scalars(
            select(AuthSession)
            .where(AuthSession.subject_type == "admin", AuthSession.subject_id == admin.id,
                   AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
            .order_by(AuthSession.created_at.desc(), AuthSession.id)
        )
    ).all()
    for old in [s for s in live if s.id != session.id][MAX_LIVE_SESSIONS - 1:]:
        await sessions.revoke_session(db, old.id, "session_limit")
    await audit(db, _SelfActor(admin, request), "admin.login", "Signed in", target_type="admin", target_id=admin.id,
                changes={"session_id": str(session.id), "ip": ip})
    return AdminAuth(access_token=access, expires_in=settings.admin_access_token_minutes * 60,
                     admin=admin_me(admin)), refresh, session


# ═══════════════════════════ cookies / CSRF / refresh / logout ═══════════════════════════


def check_csrf(request: Request) -> None:
    """Double-submit: header X-CSRF-Token must equal the pytch_admin_csrf cookie (constant time).
    Cross-site fetches are rejected outright via Fetch Metadata."""
    site = request.headers.get("sec-fetch-site")
    if site and site not in ("same-origin", "none"):
        raise CsrfFailed()
    cookie = request.cookies.get(CSRF_COOKIE) or ""
    header = request.headers.get("x-csrf-token") or ""
    if not cookie or not header or not constant_time_equals(cookie, header):
        raise CsrfFailed()


def cookie_specs(refresh_token: str, session: AuthSession) -> list[dict[str, Any]]:
    max_age = max(int((session.expires_at - utcnow()).total_seconds()), 0)
    common = {"max_age": max_age, "secure": settings.admin_cookie_secure, "samesite": "strict"}
    return [
        {"key": REFRESH_COOKIE, "value": refresh_token, "httponly": True, "path": COOKIE_PATH, **common},
        {"key": CSRF_COOKIE, "value": random_token(24), "httponly": False, "path": "/", **common},
    ]


async def refresh(db: AsyncSession, request: Request, token: str | None) -> tuple[AdminAuth, str, AuthSession]:
    check_ip_allowed(request)
    check_csrf(request)
    await enforce(f"admin-refresh-ip:{client_ip(request)}", 60, 15 * 60)
    if not token:
        raise Unauthorized("Please log in")
    claims = decode_claims(token, "refresh", audience="admin")
    sid = claims.get("sid")
    existing = await db.get(AuthSession, sid) if sid else None
    now = utcnow()
    if existing is not None and existing.revoked_at is None and sessions.idle_expired(
            existing, timedelta(minutes=settings.admin_session_idle_minutes), now):
        await sessions.revoke_session(db, existing.id, "idle_timeout")
        await db.commit()
        raise Unauthorized("Signed out after inactivity")
    try:
        session, access, new_refresh = await sessions.rotate_refresh(db, token, audience="admin")
    except Unauthorized:
        if existing is not None:
            await db.refresh(existing)
            if existing.revoked_reason == "refresh_reuse":
                admin = await db.get(AdminUser, existing.subject_id)
                if admin is not None:
                    await audit(db, _SelfActor(admin, request), "admin.session_reuse_detected",
                                "Refresh token reuse detected — session revoked", target_type="admin",
                                target_id=admin.id, changes={"session_id": str(existing.id)})
                    await db.commit()
        raise
    admin = await db.get(AdminUser, session.subject_id)
    if admin is None or not admin.is_active or admin.totp_enabled_at is None:
        await sessions.revoke_session(db, session.id, "account_disabled")
        await db.commit()
        raise Unauthorized("Account disabled")
    await db.commit()
    return (AdminAuth(access_token=access, expires_in=settings.admin_access_token_minutes * 60,
                      admin=admin_me(admin)), new_refresh, session)


async def logout(db: AsyncSession, request: Request, token: str | None) -> None:
    check_csrf(request)
    if not token:
        return
    try:
        claims = decode_claims(token, "refresh", audience="admin")
    except Unauthorized:
        return
    sid = claims.get("sid")
    session = await db.get(AuthSession, sid) if sid else None
    if session is None or session.audience != "admin" or session.subject_id != claims["sub"]:
        return
    await sessions.revoke_session(db, session.id, "logout")
    admin = await db.get(AdminUser, session.subject_id)
    if admin is not None:
        await audit(db, _SelfActor(admin, request), "admin.logout", "Signed out", target_type="admin",
                    target_id=admin.id, changes={"session_id": str(session.id)})
    await db.commit()


# ═══════════════════════════ authenticated self-service ═══════════════════════════


async def step_up(db: AsyncSession, ctx: AdminContext, code: str) -> StepUpResponse:
    await enforce(f"admin-stepup:{ctx.admin.id}", 5, 5 * 60, "Too many attempts — wait a few minutes")
    admin = await db.scalar(
        select(AdminUser).where(AdminUser.id == ctx.admin.id).with_for_update()
        .execution_options(populate_existing=True)
    )
    if admin is None or not admin.totp_secret_enc:
        raise Unauthorized()
    step = totp.verify(decrypt(admin.totp_secret_enc), code, last_used_step=admin.totp_last_step)
    if step is None:
        raise InvalidMfaCode()
    admin.totp_last_step = step
    await sessions.mark_mfa(db, ctx.session.id)
    await audit(db, ctx, "admin.step_up", "Confirmed identity for sensitive actions", target_type="admin",
                target_id=admin.id)
    await db.commit()
    return StepUpResponse(valid_until=utcnow() + timedelta(minutes=settings.admin_step_up_minutes))


async def change_password(db: AsyncSession, ctx: AdminContext, current: str, new: str) -> None:
    if not sessions.step_up_fresh(ctx.session, timedelta(minutes=settings.admin_step_up_minutes)):
        raise StepUpRequired()
    await enforce(f"admin-password:{ctx.admin.id}", 5, 15 * 60, "Too many attempts — wait a few minutes")
    admin = await db.scalar(
        select(AdminUser).where(AdminUser.id == ctx.admin.id).with_for_update()
        .execution_options(populate_existing=True)
    )
    assert admin is not None
    if not await _verify_pw(admin.password_hash, current):
        raise WrongCurrentPassword()
    problems = password_problems(new, email=admin.email)
    if new == current:
        problems.append("Choose a password different from the current one")
    if problems:
        raise PasswordPolicy(problems[0], details={"problems": problems})
    admin.password_hash = await asyncio.to_thread(hash_password, new)
    admin.password_changed_at = utcnow()
    was_temporary = admin.must_change_password
    admin.must_change_password = False
    revoked = await sessions.revoke_all(db, subject_type="admin", subject_id=admin.id, reason="password_changed",
                                        audience="admin", except_session=ctx.session.id)
    await audit(db, ctx, "admin.password_change", "Changed password" + (" (temporary)" if was_temporary else ""),
                target_type="admin", target_id=admin.id, changes={"other_sessions_revoked": revoked})
    await db.commit()


async def list_sessions(db: AsyncSession, ctx: AdminContext) -> list[AdminSessionOut]:
    rows = (
        await db.scalars(
            select(AuthSession)
            .where(AuthSession.subject_type == "admin", AuthSession.subject_id == ctx.admin.id,
                   AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow())
            .order_by(AuthSession.created_at.desc())
        )
    ).all()
    return [
        AdminSessionOut(id=s.id, ip=s.ip, user_agent=s.user_agent, created_at=s.created_at,
                        last_seen_at=s.last_seen_at, expires_at=s.expires_at, current=s.id == ctx.session.id)
        for s in rows
    ]


async def revoke_own_session(db: AsyncSession, ctx: AdminContext, session_id: uuid.UUID) -> None:
    session = await db.get(AuthSession, session_id)
    if session is None or session.subject_type != "admin" or session.subject_id != ctx.admin.id:
        raise NotFound("Session not found")
    await sessions.revoke_session(db, session.id, "revoked_by_owner")
    await audit(db, ctx, "admin.session_revoke", "Revoked one of own sessions", target_type="session",
                target_id=session.id)
    await db.commit()

