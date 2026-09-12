"""Regression tests for the feature/portals security review findings (#1–#8)."""

import os

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.modules.payments.models import Payment
from app.modules.platform.schemas import BroadcastInput
from tests.admin_helpers import ADMIN, as_role, make_provider, make_provider_venue
from tests.core_helpers import book, join, make_slot, make_venue, pay


async def _paid_lobby(client, db, make_user, *, price):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=price)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=2))["lobby"]
    await join(client, p1, lob["id"])
    await pay(client, host, lob["id"], use_credits=False)
    await pay(client, p1, lob["id"], use_credits=False)
    return host, p1, lob


# #1 — demo mode / demo seed can never run in production
def test_production_refuses_demo_mode(monkeypatch):
    from app.core.config import Settings

    secrets = dict(JWT_SECRET="x" * 40, ADMIN_JWT_SECRET="y" * 40, API_KEY_PEPPER="p" * 40,
                   DATA_ENCRYPTION_KEY="k" * 44)
    for k, v in secrets.items():
        monkeypatch.setenv(k, v)
    prod = dict(environment="production", admin_cookie_secure=True, cors_origins=["https://pytch.in"])
    with pytest.raises(ValidationError, match="DEMO_MODE"):
        Settings(**prod, demo_mode=True)
    Settings(**prod, demo_mode=False)  # fine without demo mode
    with pytest.raises(ValidationError, match="ADMIN_COOKIE_SECURE"):
        Settings(**{**prod, "admin_cookie_secure": False})
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        Settings(**{**prod, "cors_origins": ["https://pytch.in", "http://localhost:5173"]})


async def test_seed_refuses_outside_demo_mode(monkeypatch):
    from app.core.config import settings
    from app.seed import __main__ as seed_main

    monkeypatch.setattr(settings, "demo_mode", False)
    assert await seed_main.main(["--reset"]) == 1  # refused, nothing truncated
    assert os.environ.get("DEMO_MODE") == "true"


# #3 — splitting a large refund must not dodge the second admin
async def test_split_refunds_hit_the_cumulative_threshold(client, db, make_user):
    _, finance = await as_role(db, "finance")
    _, p1, _ = await _paid_lobby(client, db, make_user, price=1_200_000)  # ₹6,000 shares, threshold ₹5,000
    payment = await db.scalar(select(Payment).where(Payment.user_id == p1.id, Payment.status == "paid"))
    first = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                              json={"amount_paise": 400_000, "destination": "credits", "reason": "part 1"})
    assert first.status_code == 200
    second = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                               json={"amount_paise": 150_000, "destination": "credits", "reason": "part 2"})
    assert second.status_code == 202 and second.json()["error"]["code"] == "APPROVAL_REQUIRED"


async def test_force_cancel_with_large_source_refund_needs_approval(client, db, make_user):
    _, ops = await as_role(db, "super_admin")
    _, checker = await as_role(db, "finance")
    _, _, lob = await _paid_lobby(client, db, make_user, price=1_200_000)
    booking_id = lob["booking"]["id"]
    r = await client.post(f"{ADMIN}/bookings/{booking_id}/cancel", headers=ops,
                          json={"reason": "Venue flooded", "refund_destination": "source"})
    assert r.status_code == 202 and r.json()["error"]["code"] == "APPROVAL_REQUIRED"
    still = (await client.get(f"{ADMIN}/bookings/{booking_id}", headers=ops)).json()
    assert still["lobby"]["status"] != "cancelled"
    ok = await client.post(f"{ADMIN}/approvals/{r.json()['approval_id']}/approve", headers=checker,
                           json={"note": "Confirmed"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    done = (await client.get(f"{ADMIN}/bookings/{booking_id}", headers=ops)).json()
    assert done["lobby"]["status"] == "cancelled"


# #4 — broadcast links are in-app paths only
@pytest.mark.parametrize("url", ["//evil.example/login", "/\\evil.com", "https://evil.com", "/%2F%2Fevil"])
def test_broadcast_url_rejects_offsite(url):
    with pytest.raises(ValidationError):
        BroadcastInput(title="Hi", body="There", url=url)


# #5 — masked roles can't use search as an oracle for phones
async def test_masked_roles_cannot_substring_search_phones(client, db, make_user):
    target = await make_user("Target", phone="+919876500210")
    _, support = await as_role(db, "support")
    _, ops = await as_role(db, "ops")
    wild = await client.get(f"{ADMIN}/users", headers=support, params={"q": "+9198_6%210"})
    assert all(u["id"] != str(target.id) for u in wild.json()["items"])
    partial = await client.get(f"{ADMIN}/users", headers=support, params={"q": "98765"})
    assert all(u["id"] != str(target.id) for u in partial.json()["items"])
    exact = await client.get(f"{ADMIN}/users", headers=support, params={"q": "+919876500210"})
    assert [u["id"] for u in exact.json()["items"]] == [str(target.id)]
    assert "•" in exact.json()["items"][0]["phone"]  # still masked
    pii = await client.get(f"{ADMIN}/users", headers=ops, params={"q": "98765"})
    assert str(target.id) in [u["id"] for u in pii.json()["items"]]
    literal = await client.get(f"{ADMIN}/users", headers=ops, params={"q": "%"})
    assert literal.json()["total"] == 0  # wildcard is literal, not "match everything"


# #6 — re-homing a venue only via the step-up providers endpoint
async def test_venue_patch_cannot_change_provider(client, db):
    _, ops = await as_role(db, "ops")
    a, b = await make_provider(db, name="A Turfs"), await make_provider(db, name="B Turfs")
    turf, _ = await make_provider_venue(db, a)
    r = await client.patch(f"{ADMIN}/venues/{turf.id}", headers=ops, json={"provider_id": str(b.id)})
    assert r.status_code == 422
    await db.refresh(turf)
    assert turf.provider_id == a.id


# #7 — lockout body is identical for real and unknown emails
async def test_lockout_response_does_not_enumerate(client, db):
    from tests.admin_helpers import make_admin

    await make_admin(db, email="real@pytch.test", role="ops")
    bodies = {}
    # distinct client IPs so the per-IP rate limit (a separate control) doesn't mask the lockout body
    for ip, email in (("10.9.0.1", "real@pytch.test"), ("10.9.0.2", "ghost@pytch.test")):
        for _ in range(6):
            r = await client.post(f"{ADMIN}/auth/login", json={"email": email, "password": "Wrong-Password-1!"},
                                  headers={"X-Real-IP": ip})
        bodies[email] = (r.status_code, r.json()["error"]["code"], sorted((r.json()["error"]["details"] or {}).keys()))
    assert bodies["real@pytch.test"] == bodies["ghost@pytch.test"]


# #8 — the admin API never answers cross-origin preflights
async def test_admin_api_has_no_cors(client):
    pre = await client.options(f"{ADMIN}/auth/refresh", headers={
        "Origin": "http://localhost:8080", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in pre.headers
    public = await client.options("/api/v1/turfs", headers={
        "Origin": "http://localhost:8080", "Access-Control-Request-Method": "GET"})
    assert public.headers.get("access-control-allow-origin") == "http://localhost:8080"
