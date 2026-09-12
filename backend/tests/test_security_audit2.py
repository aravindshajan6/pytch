"""Regression tests for the second security audit (auth / realtime / edge findings)."""

import uuid
from datetime import date

import pytest
from starlette.requests import Request

from app.core.config import settings
from app.core.security import create_token
from tests.conftest import auth_headers

API = "/api/v1"


class FakeWS:
    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.headers = headers or {}
        self.closed: int | None = None
        self.sent: list[str] = []

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = code

    async def send_text(self, text: str) -> None:
        self.sent.append(text)


# SEC3-04 — the WS token travels in the subprotocol header, never the URL
def test_ws_token_from_subprotocol_or_bearer_only():
    from app.realtime.router import _token_from_handshake

    assert _token_from_handshake(FakeWS({"sec-websocket-protocol": "pytch.v1, abc.def.ghi"})) == "abc.def.ghi"
    assert _token_from_handshake(FakeWS({"authorization": "Bearer xyz"})) == "xyz"
    assert _token_from_handshake(FakeWS({"sec-websocket-protocol": "other, abc"})) == ""
    assert _token_from_handshake(FakeWS()) == ""


# SEC1-05 — session-less tokens can never be revoked, so they're refused everywhere
async def test_sessionless_tokens_refused(client, make_user):
    user = await make_user("NoSid")
    bare = {"Authorization": f"Bearer {create_token(user.id, 'access')}"}
    assert (await client.get(f"{API}/users/me", headers=bare)).status_code == 401
    assert (await client.get(f"{API}/users/me", headers=auth_headers(user))).status_code == 200


# SEC1-01 — revoking a session closes its live sockets on every instance
async def test_session_revocation_closes_sockets(db, make_user, monkeypatch):
    from app.modules.auth import sessions
    from app.realtime.manager import ConnectionManager

    user = await make_user("Live")
    session, access, _ = await sessions.create_session(db, subject_type="user", subject_id=user.id, audience="app")
    await db.commit()

    from app.realtime.router import _authenticate_full, _still_valid

    auth = await _authenticate_full(access)
    assert auth is not None and auth[2] == session.id
    assert await _still_valid(user.id, session.id)

    published: list[str] = []

    async def fake_publish(channel, event, data):
        published.append(channel)

    monkeypatch.setattr("app.realtime.publisher.publish", fake_publish)
    await sessions.revoke_session(db, session.id, "logout")
    await db.commit()
    assert published == [f"session:{session.id}"]
    assert not await _still_valid(user.id, session.id)
    assert await _authenticate_full(access) is None

    mgr = ConnectionManager()
    ws = FakeWS()
    assert mgr.register(ws, user.id)
    mgr.subscribe(ws, f"user:{user.id}")
    mgr.subscribe(ws, f"session:{session.id}")
    await mgr._deliver(f"session:{session.id}", "{}")
    assert ws.closed == 4401 and mgr.connection_count == 0


# SEC3-03 — per-user connection cap, per-connection channel cap, real pitches only
async def test_ws_caps_and_pitch_existence(db, make_user):
    from app.realtime import manager as mgr_mod
    from app.realtime.router import _can_subscribe
    from tests.partner_helpers import make_provider, provider_venue

    mgr = mgr_mod.ConnectionManager()
    uid = uuid.uuid4()
    sockets = [FakeWS() for _ in range(mgr_mod.MAX_CONNECTIONS_PER_USER)]
    assert all(mgr.register(ws, uid) for ws in sockets)
    assert not mgr.register(FakeWS(), uid)
    mgr.disconnect(sockets[0])
    assert mgr.register(FakeWS(), uid)

    ws = sockets[1]
    assert all(mgr.subscribe(ws, f"pitch:{i}") for i in range(mgr_mod.MAX_CHANNELS_PER_CONNECTION))
    assert not mgr.subscribe(ws, "pitch:overflow")

    player = await make_user("Player")
    provider = await make_provider(db, await make_user("Owner"))
    _, pitch = await provider_venue(db, provider)
    assert await _can_subscribe(player.id, f"pitch:{pitch.id}", "app")
    assert not await _can_subscribe(player.id, f"pitch:{uuid.uuid4()}", "app")
    pitch.is_active = False
    await db.commit()
    assert not await _can_subscribe(player.id, f"pitch:{pitch.id}", "app")


# SEC1-03 — OTP send is limited per IP and globally, not just per phone
async def test_otp_request_limited_per_ip_and_globally(client, monkeypatch):
    monkeypatch.setattr(settings, "otp_ip_max_requests", 3)
    ip = {"X-Real-IP": "203.0.113.7"}
    for i in range(3):
        r = await client.post(f"{API}/auth/otp/request", json={"phone": f"+9198765000{i:02d}"}, headers=ip)
        assert r.status_code == 200, r.text
    r = await client.post(f"{API}/auth/otp/request", json={"phone": "+919876500099"}, headers=ip)
    assert r.status_code == 429
    r = await client.post(f"{API}/partner/auth/otp/request", json={"phone": "+919876500098"}, headers=ip)
    assert r.status_code == 429  # partner login shares the budget
    ok = await client.post(f"{API}/auth/otp/request", json={"phone": "+919876500097"},
                           headers={"X-Real-IP": "203.0.113.8"})
    assert ok.status_code == 200

    monkeypatch.setattr(settings, "otp_ip_max_requests", 100)
    monkeypatch.setattr(settings, "otp_global_max_per_minute", 4)  # 4 already used above
    r = await client.post(f"{API}/auth/otp/request", json={"phone": "+919876500096"},
                          headers={"X-Real-IP": "198.51.100.1"})
    assert r.status_code == 429


async def test_otp_verify_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(settings, "otp_verify_ip_max", 2)
    ip = {"X-Real-IP": "203.0.113.9"}
    for i in range(2):
        r = await client.post(f"{API}/auth/otp/verify", json={"phone": f"+9198765001{i:02d}", "code": "000000"},
                              headers=ip)
        assert r.status_code != 429
    r = await client.post(f"{API}/auth/otp/verify", json={"phone": "+919876500150", "code": "000000"}, headers=ip)
    assert r.status_code == 429


# SEC3-06 — forwarding headers are honoured only from trusted proxies
def test_client_ip_ignores_spoofed_headers_from_untrusted_peers():
    from app.core.ratelimit import client_ip

    def req(peer: str, **headers: str) -> Request:
        raw = [(k.replace("_", "-").encode(), v.encode()) for k, v in headers.items()]
        return Request({"type": "http", "client": (peer, 1234), "headers": raw})

    assert client_ip(req("172.18.0.5", x_real_ip="49.37.1.2")) == "49.37.1.2"  # nginx on the docker network
    assert client_ip(req("8.8.8.8", x_real_ip="10.0.0.1")) == "8.8.8.8"  # internet peer can't spoof
    assert client_ip(req("8.8.8.8", x_forwarded_for="10.0.0.1")) == "8.8.8.8"
    assert client_ip(req("127.0.0.1")) == "127.0.0.1"


# SEC4-04 — avatar URLs are https or our own media only
@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "http://tracker.example/p.png"])
async def test_avatar_url_scheme_validated(client, make_user, url):
    user = await make_user("Avi")
    r = await client.patch(f"{API}/users/me", headers=auth_headers(user), json={"avatar_url": url})
    assert r.status_code == 422


async def test_avatar_url_https_ok(client, make_user):
    user = await make_user("Avi")
    r = await client.patch(f"{API}/users/me", headers=auth_headers(user),
                           json={"avatar_url": "https://cdn.example/a.png"})
    assert r.status_code == 200 and r.json()["avatar_url"] == "https://cdn.example/a.png"


# SEC3-02 — the public forecast proxy only serves the service area, a bounded window, and is rate-limited
async def test_weather_forecast_bounds(client):
    today = date.today().isoformat()
    r = await client.get(f"{API}/weather/forecast", params={"lat": 51.5, "lng": -0.12, "date": today})
    assert r.status_code == 400
    r = await client.get(f"{API}/weather/forecast", params={"lat": 9.97, "lng": 76.28, "date": "2030-01-01"})
    assert r.status_code == 400


# Chat is members-only live too: `chat:<lobby>` is a separate channel, dropped when a member leaves/is removed
async def test_lobby_chat_channel_is_members_only(client, db, make_user, monkeypatch):
    from app.realtime import manager as mgr_mod
    from app.realtime.publisher import build_envelope
    from app.realtime.router import _can_subscribe
    from tests.core_helpers import book, join, make_slot, make_venue

    published: list[tuple[str, str]] = []

    async def fake_publish(channel, event, data):
        published.append((channel, event))

    monkeypatch.setattr("app.realtime.publisher.publish", fake_publish)
    host, member, outsider = await make_user("Host"), await make_user("Mem"), await make_user("Out")
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=6, visibility="public"))["lobby"]
    await join(client, member, lob["id"])

    lobby_id = uuid.UUID(lob["id"])
    assert await _can_subscribe(outsider.id, f"lobby:{lobby_id}")  # public seat updates stay public
    assert not await _can_subscribe(outsider.id, f"chat:{lobby_id}")
    assert await _can_subscribe(member.id, f"chat:{lobby_id}")
    assert await _can_subscribe(host.id, f"chat:{lobby_id}")

    r = await client.post(f"{API}/lobbies/{lobby_id}/messages", json={"body": "hi"}, headers=auth_headers(member))
    assert r.status_code == 201
    assert (f"chat:{lobby_id}", "lobby.message") in published
    assert (f"lobby:{lobby_id}", "lobby.message") not in published

    r = await client.post(f"{API}/lobbies/{lobby_id}/leave", headers=auth_headers(member))
    assert r.status_code == 200, r.text
    assert (f"unsub:{member.id}", "unsubscribe") in published
    assert not await _can_subscribe(member.id, f"chat:{lobby_id}")

    mgr = mgr_mod.ConnectionManager()
    ws = FakeWS()
    mgr.register(ws, member.id)
    mgr.subscribe(ws, f"chat:{lobby_id}")
    mgr._revoke_subscription(str(member.id), build_envelope(f"unsub:{member.id}", "unsubscribe",
                                                           {"channel": f"chat:{lobby_id}"}))
    assert f"chat:{lobby_id}" not in mgr._by_ws[ws]


# FUNC7-01/02/04 — inactive venues, suspended partners and disabled sports stop taking new bookings
@pytest.mark.parametrize("closure", ["venue_inactive", "provider_suspended", "sport_disabled"])
async def test_closed_venues_are_not_bookable(client, db, make_user, closure):
    from app.modules.platform.models import SportCatalog
    from app.modules.platform.service import list_sports
    from tests.core_helpers import make_slot, make_venue
    from tests.partner_helpers import make_provider

    host = await make_user("Host")
    turf, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    provider = await make_provider(db, await make_user("Owner"))
    turf.provider_id = provider.id
    await db.commit()
    assert (await client.get(f"{API}/turfs/{turf.slug}")).status_code == 200
    assert (await client.get(f"{API}/pitches/{pitch.id}/slots")).status_code == 200

    if closure == "venue_inactive":
        turf.is_active = False
    elif closure == "provider_suspended":
        provider.status = "suspended"
    else:
        await list_sports(db)  # seed the catalog
        row = await db.get(SportCatalog, pitch.sport)
        row.is_active = False
    await db.commit()
    from app.core.redis import get_redis
    await get_redis().delete("pytch:meta:sports:v1")

    assert (await client.get(f"{API}/turfs/{turf.slug}")).status_code == (404 if closure != "sport_disabled" else 200)
    assert (await client.get(f"{API}/pitches/{pitch.id}/slots")).status_code == 404
    listed = (await client.get(f"{API}/turfs", params={"limit": 50})).json()["items"]
    assert str(turf.id) not in {t["id"] for t in listed}
    r = await client.post(f"{API}/bookings", headers=auth_headers(host),
                          json={"slot_id": str(slot.id), "mode": "split", "total_spots": 4, "visibility": "public"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "SLOT_UNAVAILABLE"


# FUNC7-13 — lapsed suspensions flip back to active so console/filters/broadcasts agree with the API
async def test_lapsed_suspensions_are_lifted(db, make_user):
    from datetime import timedelta

    from app.core.timeutils import utcnow
    from app.modules.users.jobs import lift_lapsed_suspensions
    from app.modules.users.models import User

    lapsed = await make_user("Lapsed", status="suspended", suspended_until=utcnow() - timedelta(minutes=1),
                             status_reason="spam")
    still = await make_user("Still", status="suspended", suspended_until=utcnow() + timedelta(days=1))
    banned = await make_user("Banned", status="banned")
    assert await lift_lapsed_suspensions(db) == 1
    for u in (lapsed, still, banned):
        await db.refresh(u)
    assert (lapsed.status, lapsed.suspended_until, lapsed.status_reason) == ("active", None, None)
    assert still.status == "suspended" and banned.status == "banned"
    assert isinstance(lapsed, User)


# Re-verification follow-ups
def test_sos_bench_count_never_exact_above_three():
    from app.modules.bench.service import _bench_phrase

    assert _bench_phrase(3) == "SOS sent to 3 players on the bench"
    assert _bench_phrase(4) == "SOS sent to 4+ players on the bench"
    assert _bench_phrase(10) == "SOS sent to 10+ players on the bench"
    assert _bench_phrase(12) == "SOS sent to 10+ players on the bench"


async def test_disabled_sport_pitches_hidden_from_venue_detail_and_slot_detail(client, db, make_user):
    from app.core.redis import get_redis
    from app.modules.platform.models import SportCatalog
    from app.modules.platform.service import list_sports
    from tests.core_helpers import make_slot, make_venue

    turf, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    assert (await client.get(f"{API}/slots/{slot.id}")).status_code == 200
    await list_sports(db)
    (await db.get(SportCatalog, pitch.sport)).is_active = False
    await db.commit()
    await get_redis().delete("pytch:meta:sports:v1")
    assert (await client.get(f"{API}/slots/{slot.id}")).status_code == 404
    detail = await client.get(f"{API}/turfs/{turf.slug}")
    if detail.status_code == 200:  # venue may still list other sports' pitches
        assert pitch.sport not in detail.json()["sports"]
        assert str(pitch.id) not in {p["id"] for p in detail.json()["pitches"]}


async def test_refresh_after_suspension_explains_why(client, db, make_user):
    from datetime import timedelta

    from app.core.timeutils import utcnow
    from app.modules.auth import sessions
    from app.modules.users.models import User

    user = await make_user("Sus")
    _, _, refresh = await sessions.create_session(db, subject_type="user", subject_id=user.id, audience="app")
    await db.commit()
    u = await db.get(User, user.id)
    u.status, u.suspended_until, u.status_reason = "suspended", utcnow() + timedelta(days=2), "Abusive chat"
    await sessions.revoke_all(db, subject_type="user", subject_id=user.id, reason="suspended")
    await db.commit()
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 403 and r.json()["error"]["code"] == "ACCOUNT_SUSPENDED"
    assert r.json()["error"]["details"]["reason"] == "Abusive chat"
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": "garbage"})).status_code == 401


async def test_removed_member_loses_private_lobby_view(client, db, make_user):
    from tests.core_helpers import book, join, make_slot, make_venue

    host, kicked, leaver = await make_user("Host"), await make_user("Kicked"), await make_user("Leaver")
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=6, visibility="private"))["lobby"]
    for p in (kicked, leaver):
        await client.get(f"{API}/lobbies/code/{lob['code']}", headers=auth_headers(p))
        await join(client, p, lob["id"])
    await client.delete(f"{API}/lobbies/{lob['id']}/members/{kicked.id}", headers=auth_headers(host))
    await client.post(f"{API}/lobbies/{lob['id']}/leave", headers=auth_headers(leaver))
    from app.core.redis import get_redis
    await get_redis().delete(f"pytch:lobby-invite:{lob['id']}:{leaver.id}")  # history, not the code, grants view
    assert (await client.get(f"{API}/lobbies/{lob['id']}", headers=auth_headers(kicked))).status_code == 404
    assert (await client.get(f"{API}/lobbies/{lob['id']}", headers=auth_headers(leaver))).status_code == 200
    await client.get(f"{API}/lobbies/code/{lob['code']}", headers=auth_headers(kicked))  # the code works again
    assert (await client.get(f"{API}/lobbies/{lob['id']}", headers=auth_headers(kicked))).status_code == 200


@pytest.mark.parametrize("url", ["/media/../../etc/passwd", "https://x.example/a b.png", "/media/a\\b.png"])
async def test_avatar_url_path_tricks_rejected(client, make_user, url):
    user = await make_user("Avi")
    r = await client.patch(f"{API}/users/me", headers=auth_headers(user), json={"avatar_url": url})
    assert r.status_code == 422
