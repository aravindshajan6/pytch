"""Admin authentication: password + mandatory TOTP, lockout, replay, recovery codes, cookie sessions,
CSRF, refresh rotation with reuse detection, idle timeout, audience isolation, IP allowlist."""

from datetime import timedelta

import pyotp
from sqlalchemy import select, update

from app.core.config import settings
from app.core.crypto import decrypt
from app.core.security import create_token
from app.core.timeutils import utcnow
from app.modules.admin.models import AdminUser
from app.modules.audit.models import AuditLog
from app.modules.auth.models import AuthSession
from tests.admin_helpers import (
    ADMIN,
    PASSWORD,
    admin_token,
    bearer,
    code,
    cookie_headers,
    cookie_value,
    fresh_code,
    login,
    make_admin,
    set_cookies,
)


async def _actions(db) -> list[str]:
    return list((await db.scalars(select(AuditLog.action).order_by(AuditLog.id))).all())


async def test_first_login_enrolls_mfa_then_forces_password_change(client, db):
    admin, _ = await make_admin(db, "super_admin", enrolled=False, must_change=True)

    r = await client.post(f"{ADMIN}/auth/login", json={"email": admin.email.upper(), "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mfa_enrolled"] is False and body["must_change_password"] is True
    token = body["mfa_token"]

    # verify before enrolment is refused; enrolment returns a secret + otpauth URI
    assert (await client.post(f"{ADMIN}/auth/mfa/verify", json={"mfa_token": token, "code": "123456"})) \
        .json()["error"]["code"] == "MFA_REQUIRED"
    start = (await client.post(f"{ADMIN}/auth/mfa/enroll/start", json={"mfa_token": token})).json()
    secret = start["secret"]
    assert start["otpauth_uri"].startswith("otpauth://totp/") and "PYTCH" in start["otpauth_uri"]
    await db.refresh(admin)
    assert admin.totp_secret_enc and secret not in admin.totp_secret_enc and decrypt(admin.totp_secret_enc) == secret

    bad = await client.post(f"{ADMIN}/auth/mfa/enroll/confirm", json={"mfa_token": token, "code": "000000"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_MFA_CODE"
    ok = await client.post(f"{ADMIN}/auth/mfa/enroll/confirm",
                           json={"mfa_token": token, "code": pyotp.TOTP(secret).now()})
    assert ok.status_code == 200, ok.text
    auth = ok.json()
    assert len(auth["recovery_codes"]) == 10 and auth["admin"]["mfa_enrolled"] is True
    assert "password_hash" not in ok.text and "totp" not in ok.text.lower()

    cookies = set_cookies(ok)
    rt = cookies["pytch_admin_rt"].lower()
    assert "httponly" in rt and "samesite=strict" in rt and "path=/api/v1/admin/auth" in rt
    assert "httponly" not in cookies["pytch_admin_csrf"].lower()
    assert "path=/" in cookies["pytch_admin_csrf"].lower()

    # hardening headers on every admin response
    assert ok.headers["cache-control"] == "no-store" and ok.headers["x-frame-options"] == "DENY"
    assert ok.headers["x-content-type-options"] == "nosniff" and ok.headers["referrer-policy"] == "no-referrer"

    await db.refresh(admin)
    stored = admin
    assert len(stored.recovery_code_hashes) == 10 and auth["recovery_codes"][0] not in stored.recovery_code_hashes

    # the mfa_token is single-use
    again = await client.post(f"{ADMIN}/auth/mfa/enroll/confirm", json={"mfa_token": token, "code": code(secret, 1)})
    assert again.status_code in (401, 409)

    headers = bearer(auth["access_token"])
    client.cookies.clear()
    # must-change-password: only auth endpoints work
    blocked = await client.get(f"{ADMIN}/system/health", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "PASSWORD_POLICY"
    assert (await client.get(f"{ADMIN}/auth/me", headers=headers)).json()["must_change_password"] is True

    weak = await client.post(f"{ADMIN}/auth/password", headers=headers,
                             json={"current_password": PASSWORD, "new_password": "short"})
    assert weak.status_code == 400 and weak.json()["error"]["code"] == "PASSWORD_POLICY"
    wrong = await client.post(f"{ADMIN}/auth/password", headers=headers,
                              json={"current_password": "nope-nope-nope", "new_password": "Brand-New-Secret-42"})
    assert wrong.status_code == 400
    good = await client.post(f"{ADMIN}/auth/password", headers=headers,
                             json={"current_password": PASSWORD, "new_password": "Brand-New-Secret-42"})
    assert good.status_code == 200, good.text
    assert (await client.get(f"{ADMIN}/system/health", headers=headers)).status_code == 200

    actions = await _actions(db)
    assert {"admin.mfa_enrolled", "admin.login", "admin.password_change"} <= set(actions)


async def test_wrong_password_locks_account_and_unknown_email_is_generic(client, db):
    admin, _ = await make_admin(db, "ops")
    for _ in range(settings.admin_max_failed_logins - 1):
        r = await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": "wrong-password-1"})
        assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    wrong_msg = r.json()["error"]["message"]
    r = await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": "wrong-password-1"})
    assert r.status_code == 423 and r.json()["error"]["code"] == "ACCOUNT_LOCKED"
    # even the right password is refused while locked
    r = await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD})
    assert r.status_code == 423
    assert "admin.login_locked" in await _actions(db)

    unknown = await client.post(f"{ADMIN}/auth/login", json={"email": "nobody@pytch.test", "password": "whatever-12"})
    assert unknown.status_code == 401 and unknown.json()["error"] == {
        "code": "INVALID_CREDENTIALS", "message": wrong_msg, "details": None}


async def test_login_is_rate_limited_per_ip(client, db):
    for i in range(10):
        await client.post(f"{ADMIN}/auth/login", json={"email": f"x{i}@pytch.test", "password": "whatever-12"})
    r = await client.post(f"{ADMIN}/auth/login", json={"email": "y@pytch.test", "password": "whatever-12"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"


async def test_totp_replay_rejected_and_recovery_codes_single_use(client, db):
    admin, secret = await make_admin(db, "finance")
    current = await fresh_code(db, admin, secret)
    t1 = (await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD})).json()
    assert (await client.post(f"{ADMIN}/auth/mfa/verify",
                              json={"mfa_token": t1["mfa_token"], "code": current})).status_code == 200
    # same code again on a new login → replay
    t2 = (await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD})).json()
    replay = await client.post(f"{ADMIN}/auth/mfa/verify", json={"mfa_token": t2["mfa_token"], "code": current})
    assert replay.status_code == 401 and replay.json()["error"]["code"] == "INVALID_MFA_CODE"

    # recovery codes: issue a known set, use one twice
    from app.core import totp

    codes = totp.new_recovery_codes(3)
    await db.execute(update(AdminUser).where(AdminUser.id == admin.id)
                     .values(recovery_code_hashes=[totp.hash_recovery_code(c) for c in codes]))
    await db.commit()
    ok = await client.post(f"{ADMIN}/auth/mfa/verify", json={"mfa_token": t2["mfa_token"],
                                                             "recovery_code": codes[0].lower()})
    assert ok.status_code == 200, ok.text
    t3 = (await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD})).json()
    reuse = await client.post(f"{ADMIN}/auth/mfa/verify", json={"mfa_token": t3["mfa_token"],
                                                                "recovery_code": codes[0]})
    assert reuse.status_code == 401
    await db.refresh(admin)
    assert len(admin.recovery_code_hashes) == 2
    assert "admin.recovery_code_used" in await _actions(db)


async def test_mfa_token_burned_after_too_many_wrong_codes(client, db):
    admin, secret = await make_admin(db, "ops")
    t = (await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD})).json()
    for _ in range(4):
        r = await client.post(f"{ADMIN}/auth/mfa/verify", json={"mfa_token": t["mfa_token"], "code": "000000"})
        assert r.json()["error"]["code"] == "INVALID_MFA_CODE"
    r = await client.post(f"{ADMIN}/auth/mfa/verify", json={"mfa_token": t["mfa_token"], "code": "000000"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"
    burned = await client.post(f"{ADMIN}/auth/mfa/verify",
                               json={"mfa_token": t["mfa_token"], "code": await fresh_code(db, admin, secret)})
    assert burned.status_code == 401


async def test_refresh_rotation_csrf_and_reuse_detection(client, db):
    admin, secret = await make_admin(db, "super_admin")
    s = await login(client, db, admin, secret)

    no_csrf = await client.post(f"{ADMIN}/auth/refresh", headers=cookie_headers(s["rt"], s["csrf"]))
    assert no_csrf.status_code == 403 and no_csrf.json()["error"]["code"] == "CSRF_FAILED"
    wrong = await client.post(f"{ADMIN}/auth/refresh", headers=cookie_headers(s["rt"], s["csrf"], header_csrf="x"))
    assert wrong.status_code == 403
    cross = await client.post(f"{ADMIN}/auth/refresh", headers={
        **cookie_headers(s["rt"], s["csrf"], header_csrf=s["csrf"]), "Sec-Fetch-Site": "cross-site"})
    assert cross.status_code == 403

    r = await client.post(f"{ADMIN}/auth/refresh", headers=cookie_headers(s["rt"], s["csrf"], header_csrf=s["csrf"]))
    assert r.status_code == 200, r.text
    new_rt = cookie_value(set_cookies(r)["pytch_admin_rt"])
    new_csrf = cookie_value(set_cookies(r)["pytch_admin_csrf"])
    assert new_rt != s["rt"]
    new_access = r.json()["access_token"]
    client.cookies.clear()
    assert (await client.get(f"{ADMIN}/auth/me", headers=bearer(new_access))).status_code == 200

    # replaying the old (rotated) refresh token = theft signal → whole session revoked
    reuse = await client.post(f"{ADMIN}/auth/refresh",
                              headers=cookie_headers(s["rt"], s["csrf"], header_csrf=s["csrf"]))
    assert reuse.status_code == 401
    client.cookies.clear()
    assert (await client.get(f"{ADMIN}/auth/me", headers=bearer(new_access))).status_code == 401
    after = await client.post(f"{ADMIN}/auth/refresh", headers=cookie_headers(new_rt, new_csrf, header_csrf=new_csrf))
    assert after.status_code == 401
    assert "admin.session_reuse_detected" in await _actions(db)


async def test_logout_requires_csrf_and_revokes(client, db):
    admin, secret = await make_admin(db, "ops")
    s = await login(client, db, admin, secret)
    r = await client.post(f"{ADMIN}/auth/logout", headers=cookie_headers(s["rt"], s["csrf"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "CSRF_FAILED"
    r = await client.post(f"{ADMIN}/auth/logout", headers=cookie_headers(s["rt"], s["csrf"], header_csrf=s["csrf"]))
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert any("max-age=0" in h.lower() or "expires=" in h.lower() for h in r.headers.get_list("set-cookie"))
    client.cookies.clear()
    assert (await client.get(f"{ADMIN}/auth/me", headers=bearer(s["access"]))).status_code == 401


async def test_idle_timeout_signs_out(client, db):
    admin, _ = await make_admin(db, "ops")
    token = await admin_token(db, admin)
    assert (await client.get(f"{ADMIN}/auth/me", headers=bearer(token))).status_code == 200
    stale = utcnow() - timedelta(minutes=settings.admin_session_idle_minutes + 1)
    await db.execute(update(AuthSession).where(AuthSession.subject_id == admin.id).values(last_seen_at=stale))
    await db.commit()
    r = await client.get(f"{ADMIN}/auth/me", headers=bearer(token))
    assert r.status_code == 401 and "inactivity" in r.json()["error"]["message"]
    session = await db.scalar(select(AuthSession).where(AuthSession.subject_id == admin.id)
                              .execution_options(populate_existing=True))
    assert session.revoked_reason == "idle_timeout"


async def test_audience_isolation(client, db, make_user):
    admin, _ = await make_admin(db, "super_admin")
    user = await make_user("Player")
    player_token = create_token(user.id, "access")
    partner_token = create_token(user.id, "access", audience="partner")
    forged = create_token(admin.id, "access", audience="app")  # right subject, wrong audience/key
    for token in (player_token, partner_token, forged):
        r = await client.get(f"{ADMIN}/system/health", headers=bearer(token))
        assert r.status_code == 401, token
    admin_access = await admin_token(db, admin)
    assert (await client.get(f"{ADMIN}/system/health", headers=bearer(admin_access))).status_code == 200
    assert (await client.get("/api/v1/wallet", headers=bearer(admin_access))).status_code == 401


async def test_ip_allowlist(client, db, monkeypatch):
    admin, _ = await make_admin(db, "super_admin")
    token = await admin_token(db, admin)
    monkeypatch.setattr(settings, "admin_ip_allowlist", ["10.0.0.0/8"])
    r = await client.get(f"{ADMIN}/system/health", headers={**bearer(token), "X-Real-IP": "192.168.1.5"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "IP_NOT_ALLOWED"
    r = await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD},
                          headers={"X-Real-IP": "8.8.8.8"})
    assert r.status_code == 403
    ok = await client.get(f"{ADMIN}/system/health", headers={**bearer(token), "X-Real-IP": "10.1.2.3"})
    assert ok.status_code == 200


async def test_step_up_window(client, db, make_user):
    admin, secret = await make_admin(db, "finance")
    token = await admin_token(db, admin, stepped_up=False)
    user = await make_user("Anu")
    body = {"amount_paise": 10_000, "reason": "Goodwill for a bad pitch"}
    r = await client.post(f"{ADMIN}/users/{user.id}/wallet", headers=bearer(token), json=body)
    assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED"
    bad = await client.post(f"{ADMIN}/auth/step-up", headers=bearer(token), json={"code": "000000"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_MFA_CODE"
    su = await client.post(f"{ADMIN}/auth/step-up", headers=bearer(token),
                           json={"code": await fresh_code(db, admin, secret)})
    assert su.status_code == 200 and su.json()["ok"] is True
    r = await client.post(f"{ADMIN}/users/{user.id}/wallet", headers=bearer(token), json=body)
    assert r.status_code == 200, r.text
    assert r.json()["wallet_balance_paise"] == 10_000


async def test_sessions_list_and_revoke(client, db):
    admin, _ = await make_admin(db, "ops")
    t1 = await admin_token(db, admin)
    t2 = await admin_token(db, admin)
    sessions = (await client.get(f"{ADMIN}/auth/sessions", headers=bearer(t1))).json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    other = next(s for s in sessions if not s["current"])
    assert (await client.delete(f"{ADMIN}/auth/sessions/{other['id']}", headers=bearer(t1))).status_code == 204
    assert (await client.get(f"{ADMIN}/auth/me", headers=bearer(t2))).status_code == 401
