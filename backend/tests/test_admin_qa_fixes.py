"""Regressions for the admin-console QA pass (FUNC7-*): venue onboarding from applications, full-list venue
assignment, bank-change notifications, admin password reset, previous sign-in, broadcast links, UTR format,
payment filters/refund caps, cancellation credits history, wallet adjustment kind, audit target types,
bot-free credits liability and `is_featured` on Discover."""

import uuid

from sqlalchemy import func, select

from app.modules.admin.models import AdminUser, ApprovalRequest
from app.modules.audit.models import AuditLog
from app.modules.auth.models import AuthSession
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.wallet.models import WalletTransaction
from tests.admin_helpers import (
    ADMIN,
    PASSWORD,
    admin_token,
    as_role,
    bearer,
    login,
    make_admin,
    make_played_booking,
    make_provider_venue,
)
from tests.admin_helpers import make_provider as make_bare_provider
from tests.core_helpers import API, book, join, make_slot, make_venue, pay, wallet
from tests.partner_helpers import make_provider

APPLICATION = {
    "venues": [
        {"name": "Sea Breeze Arena", "area": "Fort Kochi", "address": "12 Beach Rd, Fort Kochi", "lat": 9.965,
         "lng": 76.242, "sports": ["football"], "pitch_count": 2, "has_indoor": False, "notes": None},
        {"name": "Hill Courts", "area": "Kakkanad", "address": "4 IT Park Rd, Kakkanad", "lat": None, "lng": None,
         "sports": ["badminton"], "pitch_count": 1, "has_indoor": True, "notes": "Indoor wooden courts"},
    ],
    "listed_on": [],
}


def _venue_body(**over) -> dict:
    body = {
        "application_index": 0, "name": "Sea Breeze Arena", "area": "Fort Kochi",
        "address": "12 Beach Rd, Fort Kochi", "lat": 9.965, "lng": 76.242, "open_time": "06:00",
        "close_time": "23:00",
        "pitches": [
            {"name": "Pitch A", "sport": "football", "format": "5v5", "capacity": 10,
             "price_per_hour_paise": 120_000, "peak_price_per_hour_paise": 150_000},
            {"name": "Pitch B", "sport": "football", "format": "7v7", "capacity": 14, "is_indoor": True,
             "price_per_hour_paise": 180_000, "peak_price_per_hour_paise": 220_000, "has_camera": True,
             "camera_price_paise": 20_000},
        ],
    }
    return {**body, **over}


# ─────────────── FUNC7-03 venues from a partner application ───────────────


async def test_func7_03_create_venue_from_application(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner, status="pending")
    provider.application = APPLICATION
    await db.commit()
    _, ops = await as_role(db, "ops")

    detail = (await client.get(f"{ADMIN}/providers/{provider.id}", headers=ops)).json()
    assert [v["name"] for v in detail["application_venues"]] == ["Sea Breeze Arena", "Hill Courts"]
    assert detail["application_venues"][0]["turf_id"] is None

    # coordinates outside the service area, a bad format, an unknown application entry → refused
    far = await client.post(f"{ADMIN}/providers/{provider.id}/venues", headers=ops,
                            json=_venue_body(lat=28.61, lng=77.21))
    assert far.status_code == 400 and "lat" in far.json()["error"]["details"]["fields"]
    bad_fmt = _venue_body()
    bad_fmt["pitches"][0]["format"] = "11v11"
    assert (await client.post(f"{ADMIN}/providers/{provider.id}/venues", headers=ops, json=bad_fmt)).status_code == 400
    missing = await client.post(f"{ADMIN}/providers/{provider.id}/venues", headers=ops,
                                json=_venue_body(application_index=5))
    assert missing.status_code == 400

    r = await client.post(f"{ADMIN}/providers/{provider.id}/venues", headers=ops, json=_venue_body())
    assert r.status_code == 201, r.text
    out = r.json()
    [venue] = out["venues"]
    assert venue["name"] == "Sea Breeze Arena" and venue["pitch_count"] == 2
    assert venue["provider_id"] == str(provider.id)
    assert out["application_venues"][0]["turf_id"] == venue["id"]
    assert out["application_venues"][1]["turf_id"] is None

    turf = await db.get(Turf, uuid.UUID(venue["id"]))
    assert turf.slug.startswith("sea-breeze-arena-fort-kochi") and turf.is_active and not turf.is_featured
    pitches = (await db.scalars(select(Pitch).where(Pitch.turf_id == turf.id))).all()
    assert {p.name for p in pitches} == {"Pitch A", "Pitch B"}
    b = next(p for p in pitches if p.name == "Pitch B")
    assert b.has_camera and b.camera_price_paise == 20_000 and b.is_indoor
    slots = await db.scalar(select(func.count()).select_from(Slot).where(Slot.pitch_id.in_([p.id for p in pitches])))
    assert slots > 0  # 14 days of hourly slots, same generator as the partner portal

    # each application entry is onboarded once
    again = await client.post(f"{ADMIN}/providers/{provider.id}/venues", headers=ops, json=_venue_body())
    assert again.status_code == 409
    # a second venue with the same name gets its own slug
    other = await client.post(f"{ADMIN}/providers/{provider.id}/venues", headers=ops,
                              json=_venue_body(application_index=None))
    assert other.status_code == 201
    slugs = set((await db.scalars(select(Turf.slug))).all())
    assert len(slugs) == 2

    log = await db.scalar(select(AuditLog).where(AuditLog.action == "venue.create", AuditLog.target_id == str(turf.id)))
    assert log is not None and log.changes["application_index"] == 0 and log.changes["slots"] == slots
    note = await db.scalar(select(Notification).where(Notification.user_id == owner.id,
                                                      Notification.type == "venue_live"))
    assert note is not None and note.data["url"] == f"/partner/venues/{turf.id}"


async def test_func7_03_create_venue_rbac_and_step_up(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    provider.application = APPLICATION
    await db.commit()
    _, marketing = await as_role(db, "marketing")
    _, ops_cold = await as_role(db, "ops", stepped_up=False)
    url = f"{ADMIN}/providers/{provider.id}/venues"
    assert (await client.post(url, headers=marketing, json=_venue_body())).status_code == 403
    r = await client.post(url, headers=ops_cold, json=_venue_body())
    assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED"
    rejected = await make_provider(db, await make_user("Other"), status="rejected")
    _, ops = await as_role(db, "ops")
    assert (await client.post(f"{ADMIN}/providers/{rejected.id}/venues", headers=ops,
                              json=_venue_body(application_index=None))).status_code == 409


# ─────────────── FUNC7-06 assign venues = full list (unassign works) ───────────────


async def test_func7_06_assign_venues_sets_the_full_list(client, db, make_user):
    _, ops = await as_role(db, "ops")
    host = await make_user("Host")
    provider = await make_bare_provider(db, name="Coastal Sports")
    other = await make_bare_provider(db, name="Rival Turfs")
    keep, _ = await make_provider_venue(db, provider)
    drop, drop_pitch = await make_provider_venue(db, provider)
    steal, _ = await make_provider_venue(db, other)
    # an upcoming game at the venue being unassigned (ownership changes, the booking stays)
    await make_played_booking(db, drop_pitch, host, hours_ago=-30, status="confirmed")

    before = (await client.get(f"{ADMIN}/providers/{provider.id}", headers=ops)).json()
    assert {v["id"]: v["upcoming_bookings"] for v in before["venues"]}[str(drop.id)] == 1

    r = await client.post(f"{ADMIN}/providers/{provider.id}/turfs", headers=ops,
                          json={"turf_ids": [str(keep.id), str(steal.id)]})
    assert r.status_code == 200, r.text
    assert {v["id"] for v in r.json()["venues"]} == {str(keep.id), str(steal.id)}
    for t in (keep, drop, steal):
        await db.refresh(t)
    assert keep.provider_id == provider.id and steal.provider_id == provider.id and drop.provider_id is None
    log = await db.scalar(select(AuditLog).where(AuditLog.action == "provider.assign_venues"))
    assert log.changes["turfs"][str(drop.id)] == [str(provider.id), None]
    assert log.changes["turfs"][str(steal.id)] == [str(other.id), str(provider.id)]
    assert log.changes["upcoming_games"] == {str(drop.id): 1}

    # an empty list unassigns everything; unknown ids are refused
    assert (await client.post(f"{ADMIN}/providers/{provider.id}/turfs", headers=ops,
                              json={"turf_ids": [str(uuid.uuid4())]})).status_code == 400
    r = await client.post(f"{ADMIN}/providers/{provider.id}/turfs", headers=ops, json={"turf_ids": []})
    assert r.status_code == 200 and r.json()["venues"] == []


# ─────────────── FUNC7-07 bank-change decisions notify the owners ───────────────


async def test_func7_07_bank_change_decisions_notify_owners(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    provider.payouts_on_hold = True
    await db.commit()
    _, finance = await as_role(db, "finance")

    def request() -> ApprovalRequest:
        return ApprovalRequest(
            id=uuid.uuid4(), action="provider.bank_change", target_type="provider", target_id=str(provider.id),
            payload={"old": {"bank_account_last4": "1111"}, "new": {"bank_account_last4": "2222"}},
            summary="Bank change", status="pending", requested_by_provider_id=provider.id,
        )

    a1 = request()
    db.add(a1)
    await db.commit()
    assert (await client.post(f"{ADMIN}/approvals/{a1.id}/approve", headers=finance)).status_code == 200
    resumed = await db.scalar(select(Notification).where(Notification.user_id == owner.id))
    assert resumed.type == "payouts_resumed" and resumed.data["url"] == "/partner/settings"

    provider.payouts_on_hold = True
    a2 = request()
    db.add(a2)
    await db.commit()
    r = await client.post(f"{ADMIN}/approvals/{a2.id}/reject", headers=finance, json={"note": "Name mismatch"})
    assert r.status_code == 200 and r.json()["result"]["payouts_on_hold"] is False
    rejected = await db.scalar(select(Notification).where(Notification.user_id == owner.id,
                                                          Notification.type == "bank_change_rejected"))
    assert rejected is not None and "Name mismatch" in rejected.body


# ─────────────── FUNC7-11 admin password reset ───────────────


async def test_func7_11_super_admin_resets_a_password(client, db):
    boss, _ = await make_admin(db, "super_admin")
    boss_h = bearer(await admin_token(db, boss))
    target, secret = await make_admin(db, "finance")
    other_token = await admin_token(db, target)
    _, ops_h = await as_role(db, "ops")

    assert (await client.post(f"{ADMIN}/team/{target.id}/reset-password", headers=ops_h)).status_code == 403
    assert (await client.post(f"{ADMIN}/team/{boss.id}/reset-password", headers=boss_h)).status_code == 403
    cold = bearer(await admin_token(db, boss, stepped_up=False))
    r = await client.post(f"{ADMIN}/team/{target.id}/reset-password", headers=cold)
    assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED"

    r = await client.post(f"{ADMIN}/team/{target.id}/reset-password", headers=boss_h)
    assert r.status_code == 200, r.text
    temp = r.json()["temporary_password"]
    assert len(temp) >= 16 and r.json()["sessions_revoked"] == 1 and "password_hash" not in r.text
    assert (await client.get(f"{ADMIN}/payments", headers=bearer(other_token))).status_code == 401
    await db.refresh(target)
    assert target.must_change_password is True and target.totp_enabled_at is not None  # MFA untouched

    old = await client.post(f"{ADMIN}/auth/login", json={"email": target.email, "password": PASSWORD})
    assert old.status_code == 401
    new = await client.post(f"{ADMIN}/auth/login", json={"email": target.email, "password": temp})
    assert new.status_code == 200 and new.json()["must_change_password"] is True
    log = await db.scalar(select(AuditLog).where(AuditLog.action == "admin.reset_password"))
    assert log.target_id == str(target.id) and temp not in str(log.changes)


# ─────────────── FUNC7-12 previous sign-in ───────────────


async def test_func7_12_previous_sign_in_is_not_the_current_one(client, db):
    admin, secret = await make_admin(db, "ops")
    first = await login(client, db, admin, secret)
    me1 = (await client.get(f"{ADMIN}/auth/me", headers=bearer(first["access"]))).json()
    assert me1["previous_login_at"] is None and me1["last_login_at"] is not None
    second = await login(client, db, admin, secret)
    me2 = (await client.get(f"{ADMIN}/auth/me", headers=bearer(second["access"]))).json()
    assert me2["previous_login_at"] == me1["last_login_at"]
    assert me2["last_login_at"] > me1["last_login_at"]


# ─────────────── FUNC7-17 broadcast links ───────────────


async def test_func7_17_broadcast_links_are_in_app_paths_only(client, db, make_user):
    await make_user("Anu")
    _, marketing = await as_role(db, "marketing")
    body = {"title": "Hello", "body": "Monsoon deals", "segment": {}}
    for url in ("/app/../../x", "//evil.example.com", "/foo/bar", "/app//evil.com", "/app\\evil", "/app/x?next=//e",
                "https://pytch.in/app", "/app/wallet#frag", "/application"):
        r = await client.post(f"{ADMIN}/broadcasts", headers=marketing, json={**body, "url": url})
        assert r.status_code == 422, url
        assert r.json()["error"]["details"][0]["loc"][-1] == "url"
    for url in ("/app", "/app/wallet", "/partner/bookings/", "/app/discover?sport=football&area=Kaloor", ""):
        r = await client.post(f"{ADMIN}/broadcasts", headers=marketing, json={**body, "url": url})
        assert r.status_code == 201, (url, r.text)


# ─────────────── FUNC7-18 UTR format ───────────────


async def test_func7_18_manual_payouts_need_a_real_utr(client, db, make_user):
    _, maker = await as_role(db, "finance")
    _, checker = await as_role(db, "finance")
    host = await make_user("Host")
    provider = await make_bare_provider(db)
    _, pitch = await make_provider_venue(db, provider)
    await make_played_booking(db, pitch, host, hours_ago=72)
    from datetime import timedelta

    from app.core.timeutils import ist_today

    period = {"period_start": str(ist_today() - timedelta(days=10)), "period_end": str(ist_today() - timedelta(days=1))}
    gen = await client.post(f"{ADMIN}/settlements/generate", headers=maker, json=period)
    assert gen.status_code == 200, gen.text
    [row] = gen.json()
    assert (await client.post(f"{ADMIN}/settlements/{row['id']}/approve", headers=checker)).status_code == 200
    for bad in ("UTR12345", "UTR-1234567890", "A" * 23):
        r = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker,
                              json={"method": "manual_neft", "reference": bad})
        assert r.status_code == 400 and r.json()["error"]["details"]["fields"]["reference"], bad
    ok = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker,
                           json={"method": "manual_neft", "reference": "123456789012"})  # IMPS RRN (12 digits)
    assert ok.status_code == 200 and ok.json()["status"] == "paid"


# ─────────────── FUNC7-09/16 + refund caps from the server ───────────────


async def _paid_lobby(client, db, make_user, *, price=100_000):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=price)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=2))["lobby"]
    await join(client, p1, lob["id"])
    await pay(client, host, lob["id"], use_credits=False)
    await pay(client, p1, lob["id"], use_credits=False)
    return host, p1, lob


async def test_func7_09_16_payment_filters_and_server_refund_cap(client, db, make_user):
    _, finance = await as_role(db, "finance")
    host, p1, lob = await _paid_lobby(client, db, make_user)
    payment = await db.scalar(select(Payment).where(Payment.user_id == p1.id, Payment.status == "paid"))
    d = (await client.get(f"{ADMIN}/payments/{payment.id}", headers=finance)).json()
    assert d["refundable_paise"] == 50_000 and d["refundable_to_source_paise"] == 50_000
    assert d["refunds"] == [] and d["seat_refunded_paise"] == 0 and d["user_id"] == str(p1.id)

    r = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                          json={"amount_paise": 20_000, "destination": "credits", "reason": "Lights failed"})
    assert r.status_code == 200, r.text
    d = (await client.get(f"{ADMIN}/payments/{payment.id}", headers=finance)).json()
    assert d["refundable_paise"] == 30_000 and d["refunded_paise"] == 20_000 and d["seat_refunded_paise"] == 20_000
    [entry] = d["refunds"]
    assert entry["amount_paise"] == 20_000 and entry["destination"] == "credits" and entry["kind"] == "admin_refund"

    partial = (await client.get(f"{ADMIN}/payments", headers=finance, params={"status": "partially_refunded"})).json()
    assert [p["id"] for p in partial["items"]] == [str(payment.id)]
    paid = (await client.get(f"{ADMIN}/payments", headers=finance, params={"status": "paid"})).json()
    assert paid["total"] == 2
    assert (await client.get(f"{ADMIN}/payments", headers=finance, params={"status": "cancelled"})).status_code == 200
    over = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                             json={"amount_paise": 30_100, "destination": "credits", "reason": "too much"})
    assert over.status_code == 400 and over.json()["error"]["details"]["refundable_paise"] == 30_000


async def test_cancel_to_credits_records_refund_history(client, db, make_user):
    _, ops = await as_role(db, "ops")
    _, finance = await as_role(db, "finance")
    host, p1, lob = await _paid_lobby(client, db, make_user)
    r = await client.post(f"{ADMIN}/bookings/{lob['booking']['id']}/cancel", headers=ops,
                          json={"reason": "Venue flooded", "refund_destination": "credits"})
    assert r.status_code == 200, r.text
    for p in (await db.scalars(select(Payment).where(Payment.lobby_id == uuid.UUID(lob["id"])))).all():
        await db.refresh(p)
        assert p.status == "refunded" and p.meta["refunded_paise"] == 50_000
        d = (await client.get(f"{ADMIN}/payments/{p.id}", headers=finance)).json()
        [entry] = d["refunds"]
        assert entry["kind"] == "cancellation" and entry["destination"] == "credits"
        assert entry["amount_paise"] == 50_000 and d["refundable_paise"] == 0
    assert (await wallet(client, p1))["balance_paise"] == 50_000  # credits unchanged by the bookkeeping


# ─────────────── info items ───────────────


async def test_admin_wallet_adjustments_use_the_adjustment_kind(client, db, make_user):
    player = await make_user("Anu")
    _, finance = await as_role(db, "finance")
    for amount in (10_000, -4_000):
        r = await client.post(f"{ADMIN}/users/{player.id}/wallet", headers=finance,
                              json={"amount_paise": amount, "reason": "goodwill fix"})
        assert r.status_code == 200, r.text
    kinds = (await db.scalars(select(WalletTransaction.kind).where(WalletTransaction.user_id == player.id))).all()
    assert set(kinds) == {"adjustment"}
    ledger = await wallet(client, player)  # the player wallet API accepts the kind
    assert ledger["balance_paise"] == 6_000 and {t["kind"] for t in ledger["transactions"]} == {"adjustment"}


async def test_wallet_approval_payload_carries_the_player(client, db, make_user):
    player = await make_user("Lucky")
    _, maker = await as_role(db, "finance")
    r = await client.post(f"{ADMIN}/users/{player.id}/wallet", headers=maker,
                          json={"amount_paise": 9_000_000, "reason": "venue outage goodwill"})
    assert r.status_code == 202
    _, checker = await as_role(db, "finance")
    [a] = (await client.get(f"{ADMIN}/approvals", headers=checker, params={"status": "pending"})).json()
    assert a["action"] == "wallet.adjust" and a["target_type"] == "user" and a["target_id"] == str(player.id)
    assert a["payload"]["player_name"] == "Lucky" and a["payload"]["direction"] == "credit"
    assert a["payload"]["amount_paise"] == 9_000_000 and a["result"] is None


async def test_audit_target_types_and_bot_free_credits_liability(client, db, make_user):
    admin, _ = await make_admin(db, "super_admin")
    h = bearer(await admin_token(db, admin))
    types = (await client.get(f"{ADMIN}/audit/target-types", headers=h)).json()
    assert {"slot_block", "sync_conflict", "provider_api_key", "pitch", "channel_feed", "provider_member",
            "approval_request", "provider_webhook", "broadcast", "sport", "session"} <= set(types)
    _, marketing = await as_role(db, "marketing")
    assert (await client.get(f"{ADMIN}/audit/target-types", headers=marketing)).status_code == 403

    await make_user("Human", wallet_balance_paise=30_000)
    await make_user("Bot", wallet_balance_paise=900_000, is_bot=True)
    kpis = (await client.get(f"{ADMIN}/analytics/overview", headers=h, params={"range": "7d"})).json()["kpis"]
    assert next(k for k in kpis if k["key"] == "credits_outstanding")["value"] == 30_000


# ─────────────── FUNC7-15 featured venues on Discover ───────────────


async def test_func7_15_featured_venues_come_first(client, db, make_user):
    user = await make_user("Anu")
    _, ops = await as_role(db, "ops")
    top, _ = await make_venue(db, name="Top Rated")
    top.rating_avg = 4.9
    plain, _ = await make_venue(db, name="Plain")
    plain.rating_avg = 3.0
    await db.commit()
    r = await client.patch(f"{ADMIN}/venues/{plain.id}", headers=ops, json={"is_featured": True})
    assert r.status_code == 200 and r.json()["is_featured"] is True
    from tests.conftest import auth_headers

    items = (await client.get(f"{API}/turfs", headers=auth_headers(user))).json()["items"]  # default, no location
    assert [t["name"] for t in items] == ["Plain", "Top Rated"] and items[0]["is_featured"] is True
    by_rating = (await client.get(f"{API}/turfs", headers=auth_headers(user), params={"sort": "rating"})).json()
    assert [t["name"] for t in by_rating["items"]] == ["Top Rated", "Plain"]
    featured = (await client.get(f"{API}/turfs", headers=auth_headers(user),
                                 params={"sort": "featured", "lat": 9.98, "lng": 76.3})).json()
    assert featured["items"][0]["name"] == "Plain"
    detail = (await client.get(f"{API}/turfs/{plain.slug}", headers=auth_headers(user))).json()
    assert detail["is_featured"] is True


async def test_admin_sessions_revoked_on_reset_stay_revoked(db):
    """Sanity: the reset revokes server-side sessions (not just the access token)."""
    boss, _ = await make_admin(db, "super_admin")
    target, _ = await make_admin(db, "support")
    await admin_token(db, target)
    from app.modules.admin.services import team as team_service

    class Ctx:
        admin, session, request, label = boss, None, None, "boss (super_admin)"

    await team_service.reset_password(db, Ctx(), target.id)
    live = await db.scalar(select(func.count()).select_from(AuthSession).where(
        AuthSession.subject_id == target.id, AuthSession.revoked_at.is_(None)))
    assert live == 0
    assert (await db.get(AdminUser, target.id)).must_change_password is True
