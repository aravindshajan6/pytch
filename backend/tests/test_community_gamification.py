"""Gamification handlers, /gamification/me, leaderboards, notifications inbox, realtime payloads."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.events import emit
from app.core.timeutils import IST, utcnow
from app.modules.bench import service as bench
from app.modules.bench.models import BenchStatus
from app.modules.gamification.catalog import BADGES
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.lobbies.models import Lobby
from app.modules.notifications.models import Notification
from app.modules.notifications.service import notify
from app.modules.users.models import PlayerStats
from app.modules.weather import service as ws
from app.realtime.publisher import build_envelope
from tests.community_factories import KOCHI, hour_from_now, make_lobby, make_pitch, make_users
from tests.conftest import auth_headers

API = "/api/v1"


async def stats_of(user_id: uuid.UUID) -> PlayerStats:
    async with SessionLocal() as s:
        return await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user_id))


async def badges_of(user_id: uuid.UUID) -> set[str]:
    async with SessionLocal() as s:
        return set((await s.scalars(select(UserBadge.badge_code).where(UserBadge.user_id == user_id))).all())


async def add_xp(user_id: uuid.UUID, amount: int, days_ago: float = 0) -> None:
    async with SessionLocal() as s:
        s.add(XpEvent(id=uuid.uuid4(), user_id=user_id, amount=amount, reason="test",
                      created_at=utcnow() - timedelta(days=days_ago)))
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user_id))
        stats.xp += amount
        await s.commit()


# ───────────────────────────── handlers ─────────────────────────────
async def test_match_completed_rewards_players_once(db, make_user):
    host, *players = await make_users(make_user, 3, prefix="Owl")
    pitch = await make_pitch(db)
    kickoff = datetime.now(IST).replace(hour=21, minute=30, second=0, microsecond=0)
    if kickoff.astimezone(UTC) > utcnow():
        kickoff -= timedelta(days=1)
    async with SessionLocal() as s:  # host played the previous ISO week → streak continues
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == host.id))
        stats.streak_weeks, stats.matches_hosted = 3, 4
        stats.last_match_at = (kickoff - timedelta(days=7)).astimezone(UTC)
        await s.commit()
    lobby = await make_lobby(db, pitch, host, players, start=kickoff.astimezone(UTC), status="completed",
                             completed_at=utcnow(), total_spots=4)
    for _ in range(2):  # re-emitted event must not double count
        async with SessionLocal() as s:
            await emit(s, "match.completed", lobby_id=lobby.id)
            await s.commit()

    p = await stats_of(players[0].id)
    assert p.matches_played == 1 and p.xp == 100 and p.streak_weeks == 1 and p.level == 2
    assert {"first_whistle", "night_owl"} <= await badges_of(players[0].id)
    h = await stats_of(host.id)
    assert h.matches_played == 1
    assert h.last_match_at == kickoff.astimezone(UTC)
    assert h.streak_weeks == 4
    assert "on_fire" in await badges_of(host.id)
    assert "squad_leader" not in await badges_of(host.id)


async def test_lobby_confirmed_dropout_and_sub(db, make_user):
    host, mate = await make_users(make_user, 2, prefix="Host")
    pitch = await make_pitch(db)
    lobby = await make_lobby(db, pitch, host, [mate], start=hour_from_now(5), total_spots=4)
    async with SessionLocal() as s:
        await emit(s, "lobby.confirmed", lobby_id=lobby.id)
        await emit(s, "lobby.confirmed", lobby_id=lobby.id)
        await emit(s, "member.dropped", lobby_id=lobby.id, user_id=mate.id, member_id=uuid.uuid4(),
                   hours_to_kickoff=5.0, was_paid=True)
        await emit(s, "member.dropped", lobby_id=lobby.id, user_id=mate.id, member_id=uuid.uuid4(),
                   hours_to_kickoff=30.0, was_paid=True)
        await s.commit()
    h = await stats_of(host.id)
    assert h.matches_hosted == 1 and h.xp == 50
    assert (await stats_of(mate.id)).dropouts == 1

    sub = await make_user("Super Sub")
    async with SessionLocal() as s:
        st = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == sub.id))
        st.subs_made = 4
        await s.commit()
        await emit(s, "sub.paid", lobby_id=lobby.id, user_id=sub.id, member_id=uuid.uuid4(), sos_id=None)
        await s.commit()
    st = await stats_of(sub.id)
    assert st.subs_made == 5 and st.xp == 150
    assert {"hero_sub", "super_sub"} <= await badges_of(sub.id)


# ───────────────────────────── /gamification/me + leaderboard ─────────────────────────────
async def test_gamification_me(client, make_user):
    me = await make_user("Climber")
    await add_xp(me.id, 250)
    await add_xp(me.id, 100, days_ago=10)
    r = await client.get(f"{API}/gamification/me", headers=auth_headers(me))
    assert r.status_code == 200
    body = r.json()
    assert body["xp"] == 350 and body["level"] == 3
    assert body["level_xp_start"] == 300 and body["next_level_xp"] == 600
    assert abs(body["progress"] - 50 / 300) < 1e-3
    assert body["weekly_xp"] == 250
    assert len(body["badges"]) == len(BADGES) and all(b["earned_at"] is None for b in body["badges"])
    assert [e["amount"] for e in body["recent_xp"]] == [250, 100]


async def test_leaderboards(client, make_user):
    me = await make_user("Me")
    rivals = await make_users(make_user, 3, prefix="Rival")
    bot = await make_user("Botty", is_bot=True)
    await add_xp(me.id, 120)
    await add_xp(rivals[0].id, 500)
    await add_xp(rivals[1].id, 300)
    await add_xp(rivals[2].id, 900, days_ago=9)  # outside the weekly window
    await add_xp(bot.id, 5000)

    week = (await client.get(f"{API}/leaderboard", params={"metric": "xp", "period": "week"},
                             headers=auth_headers(me))).json()
    assert [e["user"]["name"] for e in week["entries"]] == ["Rival 0", "Rival 1", "Me"]
    assert [e["rank"] for e in week["entries"]] == [1, 2, 3]
    assert week["me"]["rank"] == 3 and week["me"]["value"] == 120

    alltime = (await client.get(f"{API}/leaderboard", params={"metric": "xp", "period": "all"},
                                headers=auth_headers(me))).json()
    assert alltime["entries"][0]["user"]["name"] == "Rival 2"
    assert "Botty" not in {e["user"]["name"] for e in alltime["entries"]}

    async with SessionLocal() as s:
        for user, ts, n in ((rivals[0], 81.0, 12), (rivals[1], 90.0, 2), (me, 64.0, 5)):
            st = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user.id))
            st.true_skill, st.ratings_received = ts, n
        await s.commit()
    skill = (await client.get(f"{API}/leaderboard", params={"metric": "true_skill", "period": "all"},
                              headers=auth_headers(me))).json()
    assert [(e["user"]["name"], e["value"]) for e in skill["entries"]] == [("Rival 0", 81.0), ("Me", 64.0)]
    assert skill["me"]["rank"] == 2
    unrated = await make_user("Unrated")
    none = (await client.get(f"{API}/leaderboard", params={"metric": "true_skill", "period": "all"},
                             headers=auth_headers(unrated))).json()
    assert none["me"] is None

    r = await client.get(f"{API}/leaderboard", params={"metric": "goals"}, headers=auth_headers(me))
    assert r.status_code == 422


# ───────────────────────────── notifications ─────────────────────────────
async def test_notifications_inbox(client, make_user):
    me, other = await make_users(make_user, 2, prefix="Inbox")
    async with SessionLocal() as s:
        for i in range(5):
            await notify(s, me.id, "badge_earned", f"Badge {i}", "body", {"n": i})
        await notify(s, other.id, "badge_earned", "Not yours", "body")
        await s.commit()

    page = (await client.get(f"{API}/notifications", params={"limit": 2}, headers=auth_headers(me))).json()
    assert page["total"] == 5 and page["unread_count"] == 5 and len(page["items"]) == 2
    assert page["limit"] == 2 and page["offset"] == 0

    first = page["items"][0]["id"]
    r = await client.post(f"{API}/notifications/{first}/read", headers=auth_headers(me))
    assert r.status_code == 200 and r.json()["read_at"] is not None
    unread = (await client.get(f"{API}/notifications", params={"unread_only": True}, headers=auth_headers(me))).json()
    assert unread["total"] == 4 and unread["unread_count"] == 4

    async with SessionLocal() as s:
        theirs = await s.scalar(select(Notification.id).where(Notification.user_id == other.id))
    r = await client.post(f"{API}/notifications/{theirs}/read", headers=auth_headers(me))
    assert r.status_code == 404

    assert (await client.post(f"{API}/notifications/read-all", headers=auth_headers(me))).json() == {"updated": 4}
    assert (await client.post(f"{API}/notifications/read-all", headers=auth_headers(me))).json() == {"updated": 0}
    after = (await client.get(f"{API}/notifications", headers=auth_headers(me))).json()
    assert after["unread_count"] == 0


# ───────────────────────────── realtime payloads ─────────────────────────────
async def test_realtime_payloads_are_serialisable(db, make_user):
    """Every event we queue must survive orjson (asyncpg UUIDs are not plain uuid.UUID)."""
    host, *players = await make_users(make_user, 3, prefix="Wire")
    bencher = await make_user("Wire Bencher", preferred_sports=["football"])
    db.add(BenchStatus(user_id=bencher.id, is_active=True, lat=KOCHI[0], lng=KOCHI[1], radius_km=5,
                       sports=["football"], active_until=utcnow() + timedelta(hours=1)))
    await db.commit()
    pitch = await make_pitch(db)
    lobby = await make_lobby(db, pitch, host, players, start=hour_from_now(3), total_spots=6)
    async with SessionLocal() as s:
        lob = await s.get(Lobby, lobby.id)
        await ws.create_alert(s, lob, probability=85, mm=5.5)
        await bench.create_or_merge_sos(s, lob, reason="manual", spots=1, created_by_id=host.id)
        await s.flush()
        await bench.cancel_open_sos(s, lob.id)
        pending = list(s.sync_session.info.get("pytch_pending_publish", []))
        events = {name for _, name, _ in pending}
        assert {"lobby.updated", "sos.new", "sos.closed", "notification.new"} <= events
        for channel, name, data in pending:
            build_envelope(channel, name, data)  # raises TypeError if not serialisable
        await s.rollback()
