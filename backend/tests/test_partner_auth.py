"""Partner login (OTP → partner-audience session), audience isolation, invites, player sessions."""

import pytest
from sqlalchemy import select

from app.core.errors import Unauthorized
from app.core.security import create_token, decode_claims
from app.modules.admin.deps import load_admin_session
from app.modules.auth.models import AuthSession
from app.modules.providers.models import ProviderMember
from tests.conftest import auth_headers
from tests.partner_helpers import API, make_provider, partner_headers

OWNER_PHONE = "+919812000001"


async def _partner_login(client, phone: str) -> dict:
    code = (await client.post(f"{API}/partner/auth/otp/request", json={"phone": phone})).json()["dev_code"]
    resp = await client.post(f"{API}/partner/auth/otp/verify", json={"phone": phone, "code": code})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_partner_otp_login_returns_memberships_and_partner_tokens(client, db, make_user):
    owner = await make_user("Rahul", phone=OWNER_PHONE)
    provider = await make_provider(db, owner, name="Kochi Turf Co")

    body = await _partner_login(client, OWNER_PHONE)
    assert body["token_type"] == "bearer" and body["user"]["id"] == str(owner.id)
    assert body["memberships"] == [{
        "provider_id": str(provider.id), "provider_name": "Kochi Turf Co", "provider_status": "approved",
        "role": "owner", "turf_ids": None,
    }]
    claims = decode_claims(body["access_token"], "access", audience="partner")
    assert claims["aud"] == "partner" and "sid" in claims
    session = await db.get(AuthSession, claims["sid"])
    assert session.audience == "partner"

    me = await client.get(f"{API}/partner/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["memberships"][0]["role"] == "owner"

    # refresh rotates; the old refresh token is then treated as stolen (session revoked)
    r1 = await client.post(f"{API}/partner/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r1.status_code == 200 and r1.json()["memberships"]
    reuse = await client.post(f"{API}/partner/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert reuse.status_code == 401
    after = await client.get(f"{API}/partner/me", headers={"Authorization": f"Bearer {r1.json()['access_token']}"})
    assert after.status_code == 401


async def test_new_phone_gets_empty_memberships_and_can_logout(client):
    body = await _partner_login(client, "+919812000002")
    assert body["memberships"] == []
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert (await client.post(f"{API}/partner/auth/logout", headers=headers)).json() == {"ok": True}
    assert (await client.get(f"{API}/partner/me", headers=headers)).status_code == 401
    again = await client.post(f"{API}/partner/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert again.status_code == 401


async def test_audiences_are_isolated(client, db, make_user):
    owner = await make_user("Owner", phone=OWNER_PHONE)
    await make_provider(db, owner)
    partner_tok = (await _partner_login(client, OWNER_PHONE))["access_token"]

    # partner token → player endpoints: rejected
    assert (await client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {partner_tok}"})).status_code == 401
    assert (await client.get(f"{API}/wallet", headers={"Authorization": f"Bearer {partner_tok}"})).status_code == 401
    # partner token → admin console: rejected (different audience *and* signing key)
    with pytest.raises(Unauthorized):
        await load_admin_session(db, partner_tok)
    admin_probe = await client.get(f"{API}/admin/auth/me", headers={"Authorization": f"Bearer {partner_tok}"})
    assert admin_probe.status_code in (401, 403, 404)  # never 200
    # player token → partner endpoints: rejected
    player = auth_headers(owner)
    assert (await client.get(f"{API}/partner/me", headers=player)).status_code == 401
    assert (await client.get(f"{API}/partner/dashboard", headers=player)).status_code == 401
    # player refresh token can't be used as a partner refresh token either
    player_login = await client.post(f"{API}/auth/otp/verify", json={"phone": "+919999900001", "code": "123456"})
    player_refresh = player_login.json()["refresh_token"]
    cross = await client.post(f"{API}/partner/auth/refresh", json={"refresh_token": player_refresh})
    assert cross.status_code == 401


async def test_invited_member_activates_on_first_partner_login(client, db, make_user):
    owner = await make_user("Owner", phone=OWNER_PHONE)
    provider = await make_provider(db, owner)
    invite = await client.post(f"{API}/partner/team", json={"phone": "+919812000077", "role": "manager"},
                               headers=partner_headers(owner))
    assert invite.status_code == 201, invite.text
    assert invite.json()["status"] == "invited" and invite.json()["user"] is None

    body = await _partner_login(client, "+919812000077")
    assert [m["role"] for m in body["memberships"]] == ["manager"]
    member = (await db.execute(select(ProviderMember).where(ProviderMember.provider_id == provider.id,
                                                            ProviderMember.role == "manager"))).unique().scalar_one()
    assert member.status == "active" and str(member.user_id) == body["user"]["id"]


async def test_suspended_user_rejected_everywhere(client, db, make_user):
    owner = await make_user("Owner", phone=OWNER_PHONE)
    await make_provider(db, owner)
    owner.status = "suspended"
    await db.commit()
    resp = await client.get(f"{API}/partner/me", headers=partner_headers(owner))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "ACCOUNT_SUSPENDED"
    code = (await client.post(f"{API}/partner/auth/otp/request", json={"phone": OWNER_PHONE})).json()["dev_code"]
    login = await client.post(f"{API}/partner/auth/otp/verify", json={"phone": OWNER_PHONE, "code": code})
    assert login.status_code == 403


async def test_player_sessions_rotate_and_detect_reuse(client, db):
    ok = await client.post(f"{API}/auth/otp/verify", json={"phone": "+919999900001", "code": "123456"})
    tokens = ok.json()
    assert "sid" in decode_claims(tokens["access_token"], "access", audience="app")
    r1 = (await client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).json()
    assert r1["refresh_token"] != tokens["refresh_token"] and r1["user"]["phone"] == "+919999900001"
    # replaying the rotated refresh token = theft signal → whole session revoked
    stolen = await client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert stolen.status_code == 401
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": r1["refresh_token"]})).status_code == 401
    me = await client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {r1['access_token']}"})
    assert me.status_code == 401
    session = (await db.scalars(select(AuthSession).where(AuthSession.audience == "app"))).one()
    assert session.revoked_reason == "refresh_reuse"


async def test_player_logout_and_legacy_refresh(client, make_user):
    ok = (await client.post(f"{API}/auth/otp/verify", json={"phone": "+919999900002", "code": "123456"})).json()
    headers = {"Authorization": f"Bearer {ok['access_token']}"}
    assert (await client.post(f"{API}/auth/logout", headers=headers)).json() == {"ok": True}
    assert (await client.get(f"{API}/users/me", headers=headers)).status_code == 401
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": ok["refresh_token"]})).status_code == 401
    # a refresh token without a session id (pre-sessions format) is refused
    user = await make_user("Legacy")
    legacy = create_token(user.id, "refresh")
    resp = await client.post(f"{API}/auth/refresh", json={"refresh_token": legacy})
    assert resp.status_code == 401
