"""RBAC (least privilege on every endpoint), step-up, team safety rails, hash-chained audit log."""

import uuid

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError

from app.core.timeutils import utcnow
from app.main import app
from app.modules.admin.deps import get_ready_admin_context
from app.modules.admin.models import AdminUser
from app.modules.audit import service as audit_service
from app.modules.audit.models import AuditLog
from tests.admin_helpers import ADMIN, admin_token, as_role, bearer, make_admin


def _deps(dependant) -> set:
    out = {dependant.call}
    for d in dependant.dependencies:
        out |= _deps(d)
    return out


def test_every_business_endpoint_is_permission_gated():
    """Deny by default: every /admin route outside /admin/auth runs the ready-admin guard (+ require_perm)."""
    checked = 0
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/v1/admin/") or path.startswith("/api/v1/admin/auth"):
            continue
        calls = _deps(route.dependant)
        assert get_ready_admin_context in calls, f"{path} is not guarded"
        if path != "/api/v1/admin/system/health":
            assert any(getattr(c, "__qualname__", "").startswith("require_perm") for c in calls), path
        checked += 1
    assert checked > 50


async def test_role_boundaries(client, db, make_user):
    user = await make_user("Anu")
    _, support = await as_role(db, "support")
    _, marketing = await as_role(db, "marketing")
    _, read_only = await as_role(db, "read_only")
    _, finance = await as_role(db, "finance")

    # support can't refund; marketing can't see payments or players
    r = await client.post(f"{ADMIN}/payments/00000000-0000-0000-0000-000000000000/refund", headers=support,
                          json={"amount_paise": 1000, "destination": "credits", "reason": "test refund"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    assert (await client.get(f"{ADMIN}/payments", headers=marketing)).status_code == 403
    assert (await client.get(f"{ADMIN}/users", headers=marketing)).status_code == 403
    assert (await client.get(f"{ADMIN}/analytics/overview", headers=marketing)).status_code == 200
    # read-only can look but not touch
    assert (await client.get(f"{ADMIN}/users", headers=read_only)).status_code == 200
    r = await client.put(f"{ADMIN}/settings/bookings_enabled", headers=read_only, json={"value": False})
    assert r.status_code == 403
    # support sees masked phones; finance sees them in full
    masked = (await client.get(f"{ADMIN}/users", headers=support)).json()["items"][0]["phone"]
    full = (await client.get(f"{ADMIN}/users", headers=finance)).json()["items"][0]["phone"]
    assert "•" in masked and full == user.phone

    # support wallet adjustments are capped at ₹500
    big = await client.post(f"{ADMIN}/users/{user.id}/wallet", headers=support,
                            json={"amount_paise": 50_100, "reason": "too generous"})
    assert big.status_code == 403
    ok = await client.post(f"{ADMIN}/users/{user.id}/wallet", headers=support,
                           json={"amount_paise": 50_000, "reason": "late start goodwill"})
    assert ok.status_code == 200 and ok.json()["wallet_balance_paise"] == 50_000


async def test_step_up_required_for_refund_payout_and_wallet(client, db, make_user):
    _, finance = await as_role(db, "finance", stepped_up=False)
    user = await make_user("Anu")
    zero = "00000000-0000-0000-0000-000000000000"
    for method, path, body in (
        ("post", f"/payments/{zero}/refund", {"amount_paise": 1000, "destination": "credits", "reason": "abc"}),
        ("post", f"/settlements/{zero}/pay", {"method": "manual_neft", "reference": "UTR123456"}),
        ("post", f"/users/{user.id}/wallet", {"amount_paise": 100, "reason": "abc"}),
        ("post", "/settlements/generate", {"period_start": "2026-01-01", "period_end": "2026-01-07"}),
    ):
        r = await getattr(client, method)(f"{ADMIN}{path}", headers=finance, json=body)
        assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED", path
    # reads don't need step-up
    assert (await client.get(f"{ADMIN}/payments", headers=finance)).status_code == 200


async def test_team_safety_rails(client, db):
    me, _ = await make_admin(db, "super_admin")
    headers = bearer(await admin_token(db, me))
    created = await client.post(f"{ADMIN}/team", headers=headers,
                                json={"email": "New.Ops@Pytch.test", "name": "New Ops", "role": "ops"})
    assert created.status_code == 201, created.text
    data = created.json()
    assert data["admin"]["email"] == "new.ops@pytch.test" and len(data["temporary_password"]) >= 16
    assert "password_hash" not in created.text
    other_id = data["admin"]["id"]

    # can't change yourself; can't remove the last super admin
    r = await client.patch(f"{ADMIN}/team/{me.id}", headers=headers, json={"role": "ops"})
    assert r.status_code == 403
    r = await client.post(f"{ADMIN}/team/{me.id}/reset-mfa", headers=headers)
    assert r.status_code == 403
    promoted = await client.patch(f"{ADMIN}/team/{other_id}", headers=headers, json={"role": "super_admin"})
    assert promoted.status_code == 200 and promoted.json()["role"] == "super_admin"
    # a brand-new admin can't act until MFA is enrolled and the temporary password changed
    fresh = await db.get(AdminUser, uuid.UUID(other_id))
    other_token = await admin_token(db, fresh)
    blocked = await client.get(f"{ADMIN}/team", headers=bearer(other_token))
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "MFA_REQUIRED"
    await db.execute(update(AdminUser).where(AdminUser.id == fresh.id)
                     .values(totp_enabled_at=utcnow(), must_change_password=False))
    await db.commit()
    # the other super admin demotes me → fine (one remains); then nobody can demote them
    r = await client.patch(f"{ADMIN}/team/{me.id}", headers=bearer(other_token), json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    last = await client.patch(f"{ADMIN}/team/{other_id}", headers=bearer(other_token), json={"role": "ops"})
    assert last.status_code == 403  # self
    team = (await client.get(f"{ADMIN}/team", headers=bearer(other_token))).json()
    assert {a["email"] for a in team} >= {me.email, "new.ops@pytch.test"}


async def test_last_super_admin_guard(client, db):
    """Two super admins demoting each other concurrently: the second one must hit LAST_SUPER_ADMIN.
    (The API can't reach it sequentially — the actor is always a remaining super admin — so we call the
    service with a stale context, which is exactly what the racing request holds.)"""
    from app.modules.admin.errors import LastSuperAdmin
    from app.modules.admin.schemas import UpdateAdminRequest
    from app.modules.admin.services import team as team_service

    a, _ = await make_admin(db, "super_admin")
    b, _ = await make_admin(db, "super_admin")
    r = await client.patch(f"{ADMIN}/team/{b.id}", headers=bearer(await admin_token(db, a)), json={"role": "ops"})
    assert r.status_code == 200 and r.json()["role"] == "ops"

    class StaleCtx:  # B's request, authorised before A's change committed
        admin, session, request, label = b, None, None, "b (super_admin)"

    with pytest.raises(LastSuperAdmin):
        await team_service.update(db, StaleCtx(), a.id, UpdateAdminRequest(is_active=False))
    await db.rollback()


async def test_mutations_are_audited_and_tampering_is_detected(client, db):
    admin, _ = await make_admin(db, "super_admin")
    headers = bearer(await admin_token(db, admin))
    r = await client.put(f"{ADMIN}/settings/maintenance_banner", headers=headers, json={"value": "Back at 6 AM"})
    assert r.status_code == 200, r.text
    r = await client.put(f"{ADMIN}/settings/split_window_minutes", headers=headers, json={"value": 45})
    assert r.status_code == 200
    logs = (await db.scalars(select(AuditLog).order_by(AuditLog.id))).all()
    entry = next(log for log in logs if log.action == "settings.update" and log.target_id == "split_window_minutes")
    assert entry.actor_type == "admin" and entry.actor_id == admin.id and entry.changes == {
        "split_window_minutes": [30, 45]}
    assert entry.actor_label.startswith(admin.email)
    entry_id = entry.id

    ok = (await client.get(f"{ADMIN}/audit/verify", headers=headers)).json()
    assert ok["ok"] is True and ok["checked"] == len(logs)
    page = (await client.get(f"{ADMIN}/audit", headers=headers, params={"action": "settings"})).json()
    assert page["total"] == 2 and all(i["action"].startswith("settings.") for i in page["items"])

    # the table is append-only at the DB level
    with pytest.raises(DBAPIError):
        await db.execute(text("UPDATE audit_logs SET summary = 'x' WHERE id = :i"), {"i": entry_id})
    await db.rollback()

    # a privileged attacker disabling the trigger can edit a row — the hash chain exposes it
    await db.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER USER"))
    await db.execute(text("UPDATE audit_logs SET changes = '{\"split_window_minutes\": [30, 5]}' WHERE id = :i"),
                     {"i": entry_id})
    await db.execute(text("ALTER TABLE audit_logs ENABLE TRIGGER USER"))
    await db.commit()
    broken = (await client.get(f"{ADMIN}/audit/verify", headers=headers)).json()
    assert broken == {"ok": False, "checked": broken["checked"], "broken_at": entry_id}
    assert (await audit_service.verify_chain(db))["ok"] is False
    health = (await client.get(f"{ADMIN}/system/health", headers=headers)).json()
    assert health["audit_chain_ok"] is False and health["db"] is True and health["redis"] is True
