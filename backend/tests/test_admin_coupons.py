"""Coupons: admin CRUD, validation rules, discounted payments (seat credited gross), reversal on
failure / cancellation, and a row-locked redemption race."""

import asyncio
from datetime import timedelta

from sqlalchemy import select

from app.core.timeutils import utcnow
from app.modules.audit.models import AuditLog
from app.modules.coupons.models import Coupon, CouponRedemption
from app.modules.lobbies.models import LobbyMember
from tests.admin_helpers import ADMIN, admin_token, as_role, bearer, make_admin
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, make_slot, make_venue, wallet


def _coupon(**over) -> dict:
    return {"code": "KICKOFF", "description": "Launch offer", "discount_type": "percent", "percent_off": 20,
            "max_discount_paise": 15_000, "usage_limit_total": 100, "usage_limit_per_user": 1, **over}


async def _create(client, headers, **over) -> dict:
    r = await client.post(f"{ADMIN}/coupons", headers=headers, json=_coupon(**over))
    assert r.status_code == 201, r.text
    return r.json()


async def _validate(client, user, code, lobby_id) -> dict:
    r = await client.post(f"{API}/coupons/validate", headers=auth_headers(user), json={"code": code,
                                                                                      "lobby_id": lobby_id})
    assert r.status_code == 200, r.text
    return r.json()


async def test_admin_coupon_crud_and_audit(client, db):
    admin, headers = await as_role(db, "marketing")
    c = await _create(client, headers, code="monsoon-50")
    assert c["code"] == "MONSOON-50" and c["used_count"] == 0 and c["total_discount_paise"] == 0
    dup = await client.post(f"{ADMIN}/coupons", headers=headers, json=_coupon(code="MONSOON-50"))
    assert dup.status_code == 409
    bad = await client.post(f"{ADMIN}/coupons", headers=headers, json=_coupon(code="FLAT", discount_type="flat"))
    assert bad.status_code == 422  # flat needs amount_off_paise
    r = await client.patch(f"{ADMIN}/coupons/{c['id']}", headers=headers, json={"percent_off": 30})
    assert r.status_code == 200 and r.json()["percent_off"] == 30
    r = await client.post(f"{ADMIN}/coupons/{c['id']}/disable", headers=headers)
    assert r.json()["is_active"] is False
    listed = (await client.get(f"{ADMIN}/coupons", headers=headers, params={"active": "false"})).json()
    assert [x["code"] for x in listed] == ["MONSOON-50"]
    actions = (await db.scalars(select(AuditLog.action).where(AuditLog.target_id == c["id"]))).all()
    assert list(actions) == ["coupon.create", "coupon.update", "coupon.disable"]

    # unbounded / high-budget coupons need a fresh step-up
    _, stale = await as_role(db, "marketing", stepped_up=False)
    r = await client.post(f"{ADMIN}/coupons", headers=stale, json=_coupon(code="BIG", usage_limit_total=None))
    assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED"
    small = await client.post(f"{ADMIN}/coupons", headers=stale, json=_coupon(code="SMALL", usage_limit_total=10))
    assert small.status_code == 201
    assert admin is not None


async def test_validation_rules(client, db, make_user):
    _, headers = await as_role(db, "super_admin")
    host, other = await make_user("Host"), await make_user("Other")
    _, pitch = await make_venue(db, price=150_000)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=3))["lobby"]  # share ₹500

    await _create(client, headers, code="TWENTY")
    v = await _validate(client, host, " twenty ", lob["id"])
    assert v == {"valid": True, "code": "TWENTY", "discount_paise": 10_000, "final_paise": 40_000,
                 "message": v["message"]}
    assert (await _validate(client, host, "NOPE", lob["id"]))["valid"] is False

    await _create(client, headers, code="MIN", min_amount_paise=60_000)
    assert (await _validate(client, host, "MIN", lob["id"]))["message"].startswith("Your share is below")
    await _create(client, headers, code="BADMINTON", sports=["badminton"])
    assert (await _validate(client, host, "BADMINTON", lob["id"]))["valid"] is False
    await _create(client, headers, code="OLD", starts_at=(utcnow() - timedelta(days=3)).isoformat(),
                  ends_at=(utcnow() - timedelta(days=1)).isoformat())
    assert "expired" in (await _validate(client, host, "OLD", lob["id"]))["message"]
    await _create(client, headers, code="FLAT900", discount_type="flat", amount_off_paise=90_000, percent_off=None,
                  max_discount_paise=None)
    flat = await _validate(client, host, "FLAT900", lob["id"])
    assert flat["discount_paise"] == 50_000 and flat["final_paise"] == 0  # capped at the share

    # first-booking-only: a player who already paid for something isn't eligible
    await _create(client, headers, code="FIRST", first_booking_only=True)
    assert (await _validate(client, other, "FIRST", lob["id"]))["valid"] is True
    from tests.core_helpers import pay

    await pay(client, host, lob["id"])
    after = await _validate(client, host, "FIRST", lob["id"])
    assert after["valid"] is False and "first booking" in after["message"]


async def test_discounted_payment_credits_gross_share_and_reverses(client, db, make_user):
    _, headers = await as_role(db, "super_admin")
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=150_000)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=3))["lobby"]
    coupon = await _create(client, headers, code="TWENTY", usage_limit_total=5)

    r = await client.post(f"{API}/lobbies/{lob['id']}/pay", headers=auth_headers(host),
                          json={"use_credits": True, "coupon_code": "twenty"})
    assert r.status_code == 200, r.text
    intent = r.json()
    assert intent["amount_paise"] == 50_000 and intent["discount_paise"] == 10_000
    assert intent["payable_paise"] == 40_000 and intent["coupon_code"] == "TWENTY"
    done = await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete", headers=auth_headers(host),
                             json={"outcome": "success"})
    assert done.json()["status"] == "paid"
    member = await db.scalar(select(LobbyMember).where(LobbyMember.user_id == host.id))
    assert member.paid_paise == 50_000  # seat counts as fully paid — the platform absorbs the discount

    # a second attempt by the same user is refused (per-user limit)
    await join(client, p1, lob["id"])
    bad = await client.post(f"{API}/lobbies/{lob['id']}/pay", headers=auth_headers(p1),
                            json={"use_credits": True, "coupon_code": "NOPE"})
    assert bad.status_code == 400 and bad.json()["error"] == {
        "code": "COUPON_INVALID", "message": "That code isn't valid", "details": {"reason": "not_found"}}

    # failed payment → redemption reversed, use given back
    i2 = (await client.post(f"{API}/lobbies/{lob['id']}/pay", headers=auth_headers(p1),
                            json={"use_credits": True, "coupon_code": "TWENTY"})).json()
    c = await db.scalar(select(Coupon).where(Coupon.code == "TWENTY").execution_options(populate_existing=True))
    assert c.used_count == 2
    await client.post(f"{API}/payments/{i2['payment_id']}/mock/complete", headers=auth_headers(p1),
                      json={"outcome": "failure"})
    c = await db.scalar(select(Coupon).where(Coupon.code == "TWENTY").execution_options(populate_existing=True))
    assert c.used_count == 1
    statuses = sorted((await db.scalars(select(CouponRedemption.status))).all())
    assert statuses == ["applied", "reversed"]

    # host cancels the forming match → refund excludes the discount; coupon use restored
    cancel = await client.post(f"{API}/bookings/{lob['booking']['id']}/cancel", headers=auth_headers(host))
    assert cancel.status_code == 200, cancel.text
    assert (await wallet(client, host))["balance_paise"] == 40_000
    c = await db.scalar(select(Coupon).where(Coupon.code == "TWENTY").execution_options(populate_existing=True))
    assert c.used_count == 0

    red = (await client.get(f"{ADMIN}/coupons/{coupon['id']}/redemptions", headers=headers)).json()
    assert {r["status"] for r in red} == {"reversed"} and len(red) == 2


async def test_redemption_race_one_use_coupon(client, db, make_user):
    _, headers = await as_role(db, "super_admin")
    await _create(client, headers, code="ONCE", usage_limit_total=1)
    a, b = await make_user("A"), await make_user("B")
    _, pitch = await make_venue(db, price=100_000)
    lob_a = (await book(client, a, await make_slot(db, pitch, hours_ahead=24), total_spots=2))["lobby"]
    lob_b = (await book(client, b, await make_slot(db, pitch, hours_ahead=26), total_spots=2))["lobby"]

    async def attempt(user, lobby_id):
        return await client.post(f"{API}/lobbies/{lobby_id}/pay", headers=auth_headers(user),
                                 json={"use_credits": False, "coupon_code": "ONCE"})

    r1, r2 = await asyncio.gather(attempt(a, lob_a["id"]), attempt(b, lob_b["id"]))
    codes = sorted([r1.status_code, r2.status_code])
    assert codes == [200, 409], (r1.text, r2.text)
    loser = r1 if r1.status_code == 409 else r2
    assert loser.json()["error"]["code"] == "COUPON_EXHAUSTED"
    c = await db.scalar(select(Coupon).where(Coupon.code == "ONCE"))
    assert c.used_count == 1
    assert await db.scalar(select(CouponRedemption.status)) == "applied"


async def test_cover_remaining_rejects_coupons(client, db, make_user):
    admin, _ = await make_admin(db, "super_admin")
    await _create(client, bearer(await admin_token(db, admin)), code="TWENTY")
    host = await make_user("Host")
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=3))["lobby"]
    r = await client.post(f"{API}/lobbies/{lob['id']}/cover-remaining", headers=auth_headers(host),
                          json={"use_credits": True, "coupon_code": "TWENTY"})
    assert r.status_code == 400 and r.json()["error"]["details"] == {"reason": "not_applicable"}
