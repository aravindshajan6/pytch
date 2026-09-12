"""Runtime settings & kill switches, sports catalog → /meta, analytics, players, providers & venues,
broadcasts, system health, CLI."""

from datetime import datetime, timedelta

from sqlalchemy import select

from app.cli import create_admin, reset_admin_mfa
from app.modules.admin.models import AdminUser
from app.modules.audit.models import AuditLog
from app.modules.notifications.models import Notification
from tests.admin_helpers import (
    ADMIN,
    as_role,
    make_played_booking,
    make_provider,
    make_provider_venue,
)
from tests.conftest import auth_headers
from tests.core_helpers import API, book, make_slot, make_venue


async def test_bookings_kill_switch_and_runtime_rules(client, db, make_user):
    _, sa = await as_role(db, "super_admin")
    host = await make_user("Host")
    _, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)

    r = await client.put(f"{ADMIN}/settings/bookings_enabled", headers=sa, json={"value": False})
    assert r.status_code == 200 and r.json()["value"] is False and r.json()["default"] is True
    bad = await client.put(f"{ADMIN}/settings/bookings_enabled", headers=sa, json={"value": "no"})
    assert bad.status_code == 400
    blocked = await client.post(f"{API}/bookings", headers=auth_headers(host),
                                json={"slot_id": str(slot.id), "mode": "split", "total_spots": 3,
                                      "visibility": "public"})
    assert blocked.status_code == 503 and blocked.json()["error"]["code"] == "BOOKINGS_PAUSED"

    await client.put(f"{ADMIN}/settings/bookings_enabled", headers=sa, json={"value": True})
    out_of_range = await client.put(f"{ADMIN}/settings/split_window_minutes", headers=sa, json={"value": 1})
    assert out_of_range.status_code == 400
    await client.put(f"{ADMIN}/settings/split_window_minutes", headers=sa, json={"value": 45})
    created = await book(client, host, slot)
    deadline = datetime.fromisoformat(created["lobby"]["pay_deadline"])
    booked_at = datetime.fromisoformat(created["booking"]["created_at"])
    assert timedelta(minutes=44) < deadline - booked_at <= timedelta(minutes=45, seconds=5)

    settings_list = (await client.get(f"{ADMIN}/settings", headers=sa)).json()
    split = next(s for s in settings_list if s["key"] == "split_window_minutes")
    assert split["value"] == 45 and split["default"] == 30 and split["type"] == "int" and split["updated_by"]
    assert {s["key"] for s in settings_list} >= {"signups_enabled", "partner_signups_enabled", "maintenance_banner",
                                                "sub_discount_pct", "rain_bonus_paise", "refund_dual_approval_paise"}


async def test_signups_switch_blocks_only_new_accounts(client, db, make_user):
    _, sa = await as_role(db, "super_admin")
    existing = await make_user("Existing", phone="+919812345678")
    await client.put(f"{ADMIN}/settings/signups_enabled", headers=sa, json={"value": False})

    async def otp_login(phone: str):
        code = (await client.post(f"{API}/auth/otp/request", json={"phone": phone})).json()["dev_code"]
        return await client.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})

    assert (await otp_login(existing.phone)).status_code == 200
    new = await otp_login("+919800011122")
    assert new.status_code == 503 and new.json()["error"]["code"] == "SIGNUPS_PAUSED"


async def test_meta_reads_catalog_and_banner(client, db):
    _, sa = await as_role(db, "super_admin")
    sports = (await client.get(f"{ADMIN}/catalog/sports", headers=sa)).json()
    assert {s["key"] for s in sports} >= {"football", "cricket", "badminton"}
    r = await client.put(f"{ADMIN}/catalog/sports/cricket", headers=sa,
                         json={"label": "Cricket Nets", "emoji": "🏏", "formats": ["nets"], "is_active": False,
                               "sort_order": 10})
    assert r.status_code == 200 and r.json()["is_active"] is False
    r = await client.put(f"{ADMIN}/catalog/sports/tennis", headers=sa,
                         json={"label": "Tennis", "emoji": "🎾", "formats": ["singles"], "sort_order": 99})
    assert r.status_code == 200
    await client.put(f"{ADMIN}/settings/maintenance_banner", headers=sa, json={"value": "  Payments down 2–3 AM "})
    meta = (await client.get(f"{API}/meta")).json()
    keys = [s["key"] for s in meta["sports"]]
    assert "cricket" not in keys and keys[-1] == "tennis" and "football" in keys
    assert meta["maintenance_banner"] == "Payments down 2–3 AM"
    assert set(meta["sports"][0]) == {"key", "label", "emoji", "formats"}


async def test_analytics_endpoints(client, db, make_user):
    _, analyst = await as_role(db, "read_only")
    host = await make_user("Host")
    provider = await make_provider(db, commission_bps=1000)
    _, pitch = await make_provider_venue(db, provider)
    await make_played_booking(db, pitch, host, hours_ago=30, price=100_000)
    await make_played_booking(db, pitch, host, hours_ago=24 * 10, price=80_000)  # previous 7-day window

    ov = (await client.get(f"{ADMIN}/analytics/overview", headers=analyst, params={"range": "7d"})).json()
    kpi = {k["key"]: k for k in ov["kpis"]}
    assert kpi["gmv"]["value"] == 100_000 and kpi["gmv"]["previous"] == 80_000 and kpi["gmv"]["unit"] == "paise"
    assert kpi["bookings"]["value"] == 1 and kpi["completed_matches"]["value"] == 1
    assert kpi["net_revenue"]["value"] == 10_000 and kpi["take_rate"]["value"] == 10.0
    assert kpi["active_players"]["value"] == 1
    assert len(ov["kpis"]) == 16 and all(k["hint"] for k in ov["kpis"])

    ts = (await client.get(f"{ADMIN}/analytics/timeseries", headers=analyst,
                           params={"metric": "gmv", "range": "7d", "granularity": "day"})).json()
    assert len(ts["points"]) == 7 and len(ts["previous"]) == 7
    assert sum(p["value"] for p in ts["points"]) == 100_000 and sum(p["value"] for p in ts["previous"]) == 80_000
    weekly = (await client.get(f"{ADMIN}/analytics/timeseries", headers=analyst,
                               params={"metric": "net_revenue", "range": "30d", "granularity": "week"})).json()
    assert sum(p["value"] for p in weekly["points"]) == 18_000

    venues = (await client.get(f"{ADMIN}/analytics/venues", headers=analyst, params={"range": "30d"})).json()
    assert venues[0]["gmv_paise"] == 180_000 and venues[0]["provider_name"] == provider.name
    assert venues[0]["occupancy_pct"] == 100.0
    heat = (await client.get(f"{ADMIN}/analytics/heatmap", headers=analyst)).json()
    assert sum(c["bookings"] for c in heat["cells"]) == 2
    mix = (await client.get(f"{ADMIN}/analytics/sports", headers=analyst)).json()
    assert mix["rows"] == [{"sport": "football", "bookings": 2, "gmv_paise": 180_000}]
    cohorts = (await client.get(f"{ADMIN}/analytics/cohorts", headers=analyst)).json()["cohorts"]
    assert len(cohorts) == 8 and sum(c["size"] for c in cohorts) == 1


async def test_player_moderation(client, db, make_user):
    _, ops = await as_role(db, "ops")
    user = await make_user("Rowdy")
    detail = (await client.get(f"{ADMIN}/users/{user.id}", headers=ops)).json()
    assert detail["status"] == "active" and detail["public"]["name"] == "Rowdy"

    r = await client.post(f"{ADMIN}/users/{user.id}/status", headers=ops,
                          json={"status": "suspended", "reason": "Abusive chat",
                                "until": (datetime.now().astimezone() + timedelta(days=3)).isoformat()})
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    denied = await client.get(f"{API}/wallet", headers=auth_headers(user))
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "ACCOUNT_SUSPENDED"
    r = await client.post(f"{ADMIN}/users/{user.id}/status", headers=ops, json={"status": "active",
                                                                              "reason": "Appeal accepted"})
    assert r.json()["status"] == "active" and r.json()["status_reason"] is None
    assert (await client.get(f"{API}/wallet", headers=auth_headers(user))).status_code == 200
    page = (await client.get(f"{ADMIN}/users", headers=ops, params={"q": "rowd"})).json()
    assert page["total"] == 1
    actions = (await db.scalars(select(AuditLog.action).where(AuditLog.target_id == str(user.id)))).all()
    assert list(actions) == ["user.suspended", "user.reinstate"]

    # CSV export: data.export (finance) only, audited
    assert (await client.get(f"{ADMIN}/users/export.csv", headers=ops)).status_code == 403
    _, finance = await as_role(db, "finance")
    csv = await client.get(f"{ADMIN}/users/export.csv", headers=finance)
    assert csv.status_code == 200 and user.phone in csv.text
    assert await db.scalar(select(AuditLog.id).where(AuditLog.action == "user.export"))


async def test_provider_review_and_venues(client, db, make_user):
    _, ops = await as_role(db, "ops")
    provider = await make_provider(db, status="pending", commission_bps=1000)
    turf, pitch = await make_provider_venue(db, provider)
    rows = (await client.get(f"{ADMIN}/providers", headers=ops, params={"status": "pending"})).json()
    assert [r["id"] for r in rows] == [str(provider.id)] and rows[0]["venue_count"] == 1

    no_reason = await client.post(f"{ADMIN}/providers/{provider.id}/review", headers=ops, json={"decision": "reject"})
    assert no_reason.status_code == 400
    ok = await client.post(f"{ADMIN}/providers/{provider.id}/review", headers=ops,
                           json={"decision": "approve", "commission_bps": 800})
    assert ok.status_code == 200, ok.text
    detail = ok.json()
    assert detail["status"] == "approved" and detail["commission_bps"] == 800 and detail["kyc_verified"] is True
    assert detail["reviewed_by"] and len(detail["venues"]) == 1

    susp = await client.post(f"{ADMIN}/providers/{provider.id}/status", headers=ops,
                             json={"status": "suspended", "reason": "Repeated overbooking"})
    assert susp.json()["status"] == "suspended"

    # a new payout destination is four-eyes: payouts go on hold + approval queued
    r = await client.patch(f"{ADMIN}/providers/{provider.id}", headers=ops,
                           json={"razorpay_account_id": "acc_NEWACCOUNT1", "notes": "Called owner"})
    assert r.status_code == 200 and r.json()["payouts_on_hold"] is True and r.json()["razorpay_account_id"] is None
    assert r.json()["notes"] == "Called owner"

    venues = (await client.get(f"{ADMIN}/venues", headers=ops, params={"provider_id": str(provider.id)})).json()
    assert venues[0]["id"] == str(turf.id) and venues[0]["sports"] == ["football"]
    v = await client.patch(f"{ADMIN}/venues/{turf.id}", headers=ops, json={"is_featured": True})
    assert v.json()["is_featured"] is True
    p = await client.patch(f"{ADMIN}/pitches/{pitch.id}", headers=ops, json={"is_active": False})
    assert p.status_code == 200 and p.json()["is_active"] is False


async def test_broadcast_and_health(client, db, make_user):
    _, mkt = await as_role(db, "marketing")
    a = await make_user("A", home_area="Kakkanad", preferred_sports=["football"])
    await make_user("B", home_area="Aluva", preferred_sports=["badminton"])
    seg = {"areas": ["Kakkanad"], "sports": ["football"]}
    prev = await client.post(f"{ADMIN}/broadcasts/preview", headers=mkt,
                             json={"title": "Monsoon league", "body": "Sign up now", "segment": seg})
    assert prev.json() == {"recipients": 1}
    sent = await client.post(f"{ADMIN}/broadcasts", headers=mkt,
                             json={"title": "Monsoon league", "body": "Sign up now", "url": "/app/play",
                                   "segment": seg})
    assert sent.status_code == 201 and sent.json()["recipient_count"] == 1
    notes = (await db.scalars(select(Notification).where(Notification.type == "broadcast"))).all()
    assert [n.user_id for n in notes] == [a.id] and notes[0].data["url"] == "/app/play"
    bad_url = await client.post(f"{ADMIN}/broadcasts", headers=mkt,
                                json={"title": "x" * 3, "body": "y" * 3, "url": "https://evil.example", "segment": {}})
    assert bad_url.status_code == 422
    assert len((await client.get(f"{ADMIN}/broadcasts", headers=mkt)).json()) == 1

    health = (await client.get(f"{ADMIN}/system/health", headers=mkt)).json()
    assert health["db"] is True and health["redis"] is True and health["pending_approvals"] == 0
    assert any(j["name"] == "auto_generate_drafts" for j in health["jobs"])


async def test_cli_create_and_reset(db, capsys):
    assert await create_admin("Root@Pytch.test", "Root", "super_admin", None) == 0
    out = capsys.readouterr().out
    assert "Temporary password" in out
    admin = await db.scalar(select(AdminUser).where(AdminUser.email == "root@pytch.test"))
    assert admin.must_change_password is True and admin.totp_enabled_at is None
    assert await create_admin("root@pytch.test", "Root", "super_admin", None) == 1  # duplicate
    assert await create_admin("weak@pytch.test", "Weak", "ops", "password1") == 1  # policy
    assert await reset_admin_mfa("root@pytch.test") == 0
    entries = (await db.scalars(select(AuditLog).where(AuditLog.actor_type == "system"))).all()
    assert [e.action for e in entries] == ["admin.create", "admin.reset_mfa"]
