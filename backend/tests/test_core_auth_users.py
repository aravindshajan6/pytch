"""OTP auth flow, refresh, rate limiting, demo accounts, /users endpoints and player profiles."""

from sqlalchemy import update

from app.modules.gamification.service import award_badge
from app.modules.users.models import PlayerStats
from tests.conftest import auth_headers
from tests.core_helpers import API

PHONE = "+919812345678"


async def test_otp_login_flow(client):
    req = await client.post(f"{API}/auth/otp/request", json={"phone": PHONE})
    assert req.status_code == 200
    body = req.json()
    assert body["sent"] is True and body["expires_in"] == 300 and len(body["dev_code"]) == 6

    wrong_code = "000000" if body["dev_code"] != "000000" else "111111"
    wrong = await client.post(f"{API}/auth/otp/verify", json={"phone": PHONE, "code": wrong_code})
    assert wrong.status_code == 400 and wrong.json()["error"]["code"] == "INVALID_OTP"

    ok = await client.post(f"{API}/auth/otp/verify", json={"phone": PHONE, "code": body["dev_code"]})
    assert ok.status_code == 200, ok.text
    tokens = ok.json()
    assert tokens["is_new_user"] is True and tokens["token_type"] == "bearer"
    assert tokens["user"]["name"] == "Player 5678" and tokens["user"]["onboarded"] is False
    assert tokens["user"]["tier"] == "rookie" and tokens["user"]["wallet_balance_paise"] == 0

    # a code is single-use
    reuse = await client.post(f"{API}/auth/otp/verify", json={"phone": PHONE, "code": body["dev_code"]})
    assert reuse.status_code == 400

    me = await client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200 and me.json()["phone"] == PHONE

    refreshed = await client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200 and refreshed.json()["is_new_user"] is False
    bad = await client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert bad.status_code == 401

    # second login → existing user
    code = (await client.post(f"{API}/auth/otp/request", json={"phone": PHONE})).json()["dev_code"]
    again = await client.post(f"{API}/auth/otp/verify", json={"phone": PHONE, "code": code})
    assert again.json()["is_new_user"] is False and again.json()["user"]["id"] == tokens["user"]["id"]


async def test_otp_rate_limit_and_attempt_cap(client):
    phone = "+919800000001"
    for _ in range(5):
        assert (await client.post(f"{API}/auth/otp/request", json={"phone": phone})).status_code == 200
    limited = await client.post(f"{API}/auth/otp/request", json={"phone": "+919800000001"})
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "RATE_LIMITED"

    other = "+919800000002"
    code = (await client.post(f"{API}/auth/otp/request", json={"phone": other})).json()["dev_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        await client.post(f"{API}/auth/otp/verify", json={"phone": other, "code": wrong})
    burned = await client.post(f"{API}/auth/otp/verify", json={"phone": other, "code": code})
    assert burned.status_code == 400  # code invalidated after too many wrong attempts


async def test_demo_accounts_accept_fixed_code(client):
    ok = await client.post(f"{API}/auth/otp/verify", json={"phone": "+919999900001", "code": "123456"})
    assert ok.status_code == 200 and ok.json()["is_new_user"] is True
    nope = await client.post(f"{API}/auth/otp/verify", json={"phone": "+919812300000", "code": "123456"})
    assert nope.status_code == 400
    invalid = await client.post(f"{API}/auth/otp/request", json={"phone": "98123"})
    assert invalid.status_code == 422


async def test_update_me_and_profiles(client, db, make_user):
    me, other = await make_user("Me"), await make_user("Other")
    patch = await client.patch(
        f"{API}/users/me",
        json={"name": "Kiran", "bio": "Box-to-box", "preferred_sports": ["football", "badminton"],
              "home_lat": 9.99, "home_lng": 76.3, "home_area": "Kaloor", "dominant_foot": "left", "position": None},
        headers=auth_headers(me),
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["name"] == "Kiran" and patch.json()["preferred_sports"] == ["football", "badminton"]
    bad = await client.patch(f"{API}/users/me", json={"preferred_sports": ["chess"]}, headers=auth_headers(me))
    assert bad.status_code == 422

    await db.execute(
        update(PlayerStats).where(PlayerStats.user_id == other.id).values(
            true_skill=66.4, tier="skilled", ratings_received=9, matches_played=12,
            tag_counts={"Engine": 4, "Playmaker": 6, "Great passer": 1, "Safe hands": 2, "Speedster": 3, "Wall": 1},
        )
    )
    await award_badge(db, other.id, "first_whistle")
    await db.commit()

    profile = await client.get(f"{API}/users/{other.id}", headers=auth_headers(me))
    assert profile.status_code == 200, profile.text
    p = profile.json()
    assert p["user"]["true_skill"] == 66.4 and p["stats"]["matches_played"] == 12
    top = [t["tag"] for t in p["stats"]["top_tags"]]
    assert top == ["Playmaker", "Engine", "Speedster", "Safe hands", "Great passer"]
    assert [b["code"] for b in p["badges"]] == ["first_whistle"] and p["badges"][0]["earned_at"]
    assert isinstance(p["pinned_clips"], list)

    mine = (await client.get(f"{API}/users/me/profile", headers=auth_headers(me))).json()
    assert mine["user"]["name"] == "Kiran" and mine["badges"] == [] and mine["bio"] == "Box-to-box"
    missing = await client.get(f"{API}/users/00000000-0000-0000-0000-000000000000", headers=auth_headers(me))
    assert missing.status_code == 404
    assert (await client.get(f"{API}/users/me")).status_code == 401
