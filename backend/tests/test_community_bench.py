"""Live bench + SOS: activation, nearby radar, dispatch, accept (discounted sub seat), lifecycle."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.events import emit
from app.core.geo import haversine_km
from app.core.timeutils import utcnow
from app.modules.bench import jobs as bench_jobs
from app.modules.bench import service as bench
from app.modules.bench.models import BenchStatus, SOSDispatch, SOSRequest
from app.modules.gamification.models import UserBadge
from app.modules.lobbies.models import LobbyMember
from app.modules.notifications.models import Notification
from app.modules.users.models import PlayerStats
from tests.community_factories import KOCHI, hour_from_now, make_lobby, make_pitch, make_users
from tests.conftest import auth_headers

API = "/api/v1"


async def put_bench(db, user, *, lat, lng, sports=("football",), radius=5.0, minutes=120, active=True):
    db.add(BenchStatus(user_id=user.id, is_active=active, lat=lat, lng=lng, radius_km=radius, sports=list(sports),
                       active_until=utcnow() + timedelta(minutes=minutes)))
    await db.commit()


def offset_km(lat: float, lng: float, north_km: float) -> tuple[float, float]:
    return lat + north_km / 111.32, lng


@pytest.fixture
async def sos_setup(db, make_user):
    """Confirmed 10-spot match 3 h out with 9 paid members (1 seat open) + a ring of benchers."""
    host, *players = await make_users(make_user, 9, prefix="Squad")
    pitch = await make_pitch(db, price=150000)
    lobby = await make_lobby(db, pitch, host, players, start=hour_from_now(3), status="confirmed", total_spots=10)
    near = await make_user("Near Bencher", preferred_sports=["football"])
    near2 = await make_user("Second Bencher", preferred_sports=["football"])
    shuttler = await make_user("Badminton Bencher", preferred_sports=["badminton"])
    far = await make_user("Far Bencher", preferred_sports=["football"])
    await put_bench(db, near, lat=offset_km(*KOCHI, 2)[0], lng=KOCHI[1])
    await put_bench(db, near2, lat=offset_km(*KOCHI, 3)[0], lng=KOCHI[1])
    await put_bench(db, shuttler, lat=KOCHI[0], lng=KOCHI[1], sports=("badminton",))
    await put_bench(db, far, lat=offset_km(*KOCHI, 30)[0], lng=KOCHI[1])
    await put_bench(db, players[0], lat=KOCHI[0], lng=KOCHI[1])  # already in the match
    return {"lobby": lobby, "host": host, "players": players, "near": near, "near2": near2,
            "shuttler": shuttler, "far": far}


async def test_bench_activation_rules(client, make_user):
    homeless = await make_user("No Home")
    r = await client.put(f"{API}/bench/me", json={"is_active": True}, headers=auth_headers(homeless))
    assert r.status_code == 422

    user = await make_user("Home Owner", home_lat=10.0159, home_lng=76.3419, preferred_sports=["football", "cricket"])
    before = utcnow()
    r = await client.put(f"{API}/bench/me", json={"is_active": True}, headers=auth_headers(user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_active"] is True
    assert (body["lat"], body["lng"]) == (10.0159, 76.3419)  # falls back to home
    assert body["radius_km"] == 5.0
    assert body["sports"] == ["football", "cricket"]
    from datetime import datetime
    until = datetime.fromisoformat(body["active_until"])
    assert timedelta(minutes=119) < until - before < timedelta(minutes=121)

    r = await client.put(f"{API}/bench/me", json={"is_active": True, "lat": 9.97, "lng": 76.28, "radius_km": 8,
                                                  "sports": ["football"], "duration_minutes": 30},
                         headers=auth_headers(user))
    assert r.json()["radius_km"] == 8 and r.json()["lat"] == 9.97

    r = await client.put(f"{API}/bench/me", json={"is_active": False}, headers=auth_headers(user))
    assert r.json()["is_active"] is False and r.json()["active_until"] is None
    assert (await client.get(f"{API}/bench/me", headers=auth_headers(user))).json()["is_active"] is False

    r = await client.put(f"{API}/bench/me", json={"is_active": True, "duration_minutes": 500},
                         headers=auth_headers(user))
    assert r.status_code == 422


async def test_nearby_counts_fuzzes_and_excludes_self(client, db, make_user):
    me = await make_user("Radar")
    await put_bench(db, me, lat=KOCHI[0], lng=KOCHI[1])
    real = []
    for i, km in enumerate((0.5, 1.5, 4.0)):
        u = await make_user(f"Blip {i}")
        lat, lng = offset_km(*KOCHI, km)
        await put_bench(db, u, lat=lat, lng=lng)
        real.append((lat, lng))
    far = await make_user("Far")
    await put_bench(db, far, lat=offset_km(*KOCHI, 12)[0], lng=KOCHI[1])
    off = await make_user("Off")
    await put_bench(db, off, lat=KOCHI[0], lng=KOCHI[1], active=False)
    stale = await make_user("Stale")
    await put_bench(db, stale, lat=KOCHI[0], lng=KOCHI[1], minutes=-5)
    shuttler = await make_user("Shuttler")
    await put_bench(db, shuttler, lat=KOCHI[0], lng=KOCHI[1], sports=("badminton",))

    r = await client.get(f"{API}/bench/nearby", params={"lat": KOCHI[0], "lng": KOCHI[1], "sport": "football"},
                         headers=auth_headers(me))
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 3
    assert len(data["blips"]) == 3
    for blip in data["blips"]:
        nearest = min(haversine_km(blip["lat"], blip["lng"], la, ln) for la, ln in real)
        assert 0.0 < nearest <= 0.45  # ±300 m per axis, never exact
        assert (blip["lat"], blip["lng"]) not in real

    everyone = (await client.get(f"{API}/bench/nearby", params={"lat": KOCHI[0], "lng": KOCHI[1]},
                                 headers=auth_headers(me))).json()
    assert everyone["count"] == 4  # + badminton bencher, still excluding self / off / stale / far


def test_fuzz_is_stable_and_bounded():
    import uuid
    uid = uuid.uuid4()
    a = bench.fuzz_point(uid, 10.0, 76.3, salt="h1")
    assert a == bench.fuzz_point(uid, 10.0, 76.3, salt="h1")
    assert a != (10.0, 76.3)
    assert haversine_km(a[0], a[1], 10.0, 76.3) < 0.45


async def test_manual_sos_dispatch_and_accept_with_discount(client, sos_setup, make_user):
    s = sos_setup
    lobby, host = s["lobby"], s["host"]

    r = await client.post(f"{API}/bench/sos", json={"lobby_id": str(lobby.id), "spots": 1},
                          headers=auth_headers(s["players"][1]))
    assert r.status_code == 403
    r = await client.post(f"{API}/bench/sos", json={"lobby_id": str(lobby.id), "spots": 2}, headers=auth_headers(host))
    assert r.status_code == 422  # only 1 seat open

    r = await client.post(f"{API}/bench/sos", json={"lobby_id": str(lobby.id), "spots": 1}, headers=auth_headers(host))
    assert r.status_code == 200, r.text
    sos = r.json()
    share = lobby.share_paise
    assert sos["reason"] == "manual" and sos["status"] == "open"
    assert sos["discount_pct"] == 20
    assert sos["original_share_paise"] == share
    assert sos["discounted_share_paise"] == share - share * 20 // 100

    async with SessionLocal() as db:
        dispatched = set((await db.scalars(select(SOSDispatch.user_id).where(SOSDispatch.sos_id == sos["id"]))).all())
        assert dispatched == {s["near"].id, s["near2"].id}
        sos_notes = (await db.scalars(select(Notification).where(Notification.type == "sos"))).all()
        assert {n.user_id for n in sos_notes} == dispatched

    feed = (await client.get(f"{API}/bench/sos", headers=auth_headers(s["near"]))).json()
    assert [f["id"] for f in feed] == [sos["id"]]
    assert feed[0]["distance_km"] == pytest.approx(2.0, abs=0.1)
    assert (await client.get(f"{API}/bench/sos", headers=auth_headers(s["far"]))).json() == []
    assert (await client.get(f"{API}/bench/sos", headers=auth_headers(s["shuttler"]))).json() == []

    r = await client.post(f"{API}/bench/sos/{sos['id']}/accept", headers=auth_headers(s["near"]))
    assert r.status_code == 200, r.text
    detail = r.json()["lobby"]
    mine = detail["my_membership"]
    assert mine["role"] == "sub" and mine["status"] == "joined"
    assert mine["discount_paise"] == share * 20 // 100
    assert mine["share_paise"] == share - share * 20 // 100
    assert mine["reserved_until"] is not None
    assert detail["spots_left"] == 0

    # the seat is taken → the next bencher is too late
    r = await client.post(f"{API}/bench/sos/{sos['id']}/accept", headers=auth_headers(s["near2"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "SOS_CLOSED"

    async with SessionLocal() as db:
        resp = await db.scalar(select(SOSDispatch.response).where(SOSDispatch.sos_id == sos["id"],
                                                                  SOSDispatch.user_id == s["near"].id))
        assert resp == "accepted"


async def test_sos_skill_gate_and_decline(client, db, make_user):
    host, *players = await make_users(make_user, 8, prefix="Gate")
    pitch = await make_pitch(db)
    lobby = await make_lobby(db, pitch, host, players, start=hour_from_now(2), status="confirmed", total_spots=10,
                             min_true_skill=60)
    rookie = await make_user("Rookie Bencher")
    await put_bench(db, rookie, lat=KOCHI[0], lng=KOCHI[1])
    pro = await make_user("Pro Bencher")
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == pro.id))
        stats.true_skill, stats.ratings_received, stats.tier = 72.0, 12, "elite"
        await s.commit()
    await put_bench(db, pro, lat=KOCHI[0], lng=KOCHI[1])

    r = await client.post(f"{API}/bench/sos", json={"lobby_id": str(lobby.id), "spots": 2}, headers=auth_headers(host))
    assert r.status_code == 200
    sos_id = r.json()["id"]
    async with SessionLocal() as s:
        dispatched = set((await s.scalars(select(SOSDispatch.user_id).where(SOSDispatch.sos_id == sos_id))).all())
    assert dispatched == {pro.id}

    r = await client.post(f"{API}/bench/sos/{sos_id}/accept", headers=auth_headers(rookie))
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_ELIGIBLE"
    assert r.json()["error"]["details"]["reasons"]

    assert (await client.post(f"{API}/bench/sos/{sos_id}/decline", headers=auth_headers(pro))).json() == {"ok": True}
    assert (await client.get(f"{API}/bench/sos", headers=auth_headers(pro))).json() == []


async def test_dropout_auto_sos_merges_and_sub_paid_closes(db, sos_setup):
    s = sos_setup
    lobby, host, dropper = s["lobby"], s["host"], s["players"][2]
    async with SessionLocal() as session:
        member = await session.scalar(select(LobbyMember).where(LobbyMember.lobby_id == lobby.id,
                                                                LobbyMember.user_id == dropper.id))
        member.status, member.left_at = "left", utcnow()
        await emit(session, "member.dropped", lobby_id=lobby.id, user_id=dropper.id, member_id=member.id,
                   hours_to_kickoff=2.5, was_paid=True)
        await session.commit()
    async with SessionLocal() as session:
        sos = await session.scalar(select(SOSRequest).where(SOSRequest.lobby_id == lobby.id))
        assert sos.reason == "dropout" and sos.spots_needed == 1 and sos.status == "open"
        assert sos.expires_at == lobby.start_at
        # a second dropout merges into the same SOS
        await emit(session, "member.dropped", lobby_id=lobby.id, user_id=s["players"][3].id,
                   member_id=member.id, hours_to_kickoff=2.4, was_paid=True)
        # outside the SOS window / unpaid → ignored
        await emit(session, "member.dropped", lobby_id=lobby.id, user_id=s["players"][4].id,
                   member_id=member.id, hours_to_kickoff=10, was_paid=True)
        await emit(session, "member.dropped", lobby_id=lobby.id, user_id=s["players"][5].id,
                   member_id=member.id, hours_to_kickoff=1, was_paid=False)
        await session.commit()
    async with SessionLocal() as session:
        rows = (await session.scalars(select(SOSRequest).where(SOSRequest.lobby_id == lobby.id))).all()
        assert len(rows) == 1 and rows[0].spots_needed == 2
        sos_id = rows[0].id

        sub = s["near"]
        await emit(session, "sub.paid", lobby_id=lobby.id, user_id=sub.id, member_id=member.id, sos_id=sos_id)
        await session.commit()
    async with SessionLocal() as session:
        sos = await session.get(SOSRequest, sos_id)
        assert sos.spots_filled == 1 and sos.status == "open"
        await emit(session, "sub.paid", lobby_id=lobby.id, user_id=s["near2"].id, member_id=member.id, sos_id=sos_id)
        await session.commit()
    async with SessionLocal() as session:
        sos = await session.get(SOSRequest, sos_id)
        assert sos.spots_filled == 2 and sos.status == "filled"
        found = (await session.scalars(select(Notification).where(Notification.user_id == host.id,
                                                                  Notification.type == "sub_found"))).all()
        assert len(found) == 2
        # gamification: Hero Sub
        stats = await session.scalar(select(PlayerStats).where(PlayerStats.user_id == s["near"].id))
        assert stats.subs_made == 1 and stats.xp == 150
        assert await session.scalar(select(UserBadge).where(UserBadge.user_id == s["near"].id,
                                                            UserBadge.badge_code == "hero_sub"))


async def test_cancel_and_expiry_close_sos(db, sos_setup):
    s = sos_setup
    lobby = s["lobby"]
    async with SessionLocal() as session:
        lob = await session.get(type(lobby), lobby.id)
        sos, _ = await bench.create_or_merge_sos(session, lob, reason="manual", spots=1, created_by_id=s["host"].id)
        await session.commit()
        await emit(session, "lobby.cancelled", lobby_id=lobby.id)
        await session.commit()
        assert (await session.get(SOSRequest, sos.id)).status == "cancelled"

    # expiry job: stale bench + SOS past kickoff
    async with SessionLocal() as session:
        lob = await session.get(type(lobby), lobby.id)
        sos, _ = await bench.create_or_merge_sos(session, lob, reason="manual", spots=1, created_by_id=s["host"].id)
        sos.expires_at = utcnow() - timedelta(minutes=1)
        bench_row = await session.get(BenchStatus, s["near"].id)
        bench_row.active_until = utcnow() - timedelta(minutes=1)
        await session.commit()
        processed = await bench_jobs.expire_bench_and_sos(session)
        assert processed >= 2
    async with SessionLocal() as session:
        assert (await session.get(SOSRequest, sos.id)).status == "expired"
        assert (await session.get(BenchStatus, s["near"].id)).is_active is False


async def test_dev_sos_near_me(client, db, make_user):
    me = await make_user("Demo Sub", home_lat=KOCHI[0], home_lng=KOCHI[1], preferred_sports=["football"])
    await make_pitch(db, name="Nearby Fives")
    r = await client.post(f"{API}/dev/sos-near-me", headers=auth_headers(me))
    assert r.status_code == 200, r.text
    sos = r.json()
    assert sos["status"] == "open" and sos["spots_needed"] == 1
    assert sos["lobby"]["spots_left"] == 1 and sos["lobby"]["status"] == "confirmed"
    kickoff_in = (sos["lobby"]["start_at"])
    assert kickoff_in
    bench_me = (await client.get(f"{API}/bench/me", headers=auth_headers(me))).json()
    assert bench_me["is_active"] is True
    feed = (await client.get(f"{API}/bench/sos", headers=auth_headers(me))).json()
    assert sos["id"] in [f["id"] for f in feed]
    r = await client.post(f"{API}/bench/sos/{sos['id']}/accept", headers=auth_headers(me))
    assert r.status_code == 200, r.text
    assert r.json()["lobby"]["my_membership"]["role"] == "sub"
