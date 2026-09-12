"""True Skill ratings: aggregation maths, submission rules, no-shows, Verified Playmaker award/revoke."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.core.events import emit
from app.core.timeutils import utcnow
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.lobbies.models import LobbyMember
from app.modules.notifications.models import Notification
from app.modules.ratings import service as rs
from app.modules.ratings.models import MatchRating
from app.modules.users.models import PlayerStats
from tests.community_factories import hour_from_now, make_lobby, make_pitch, make_users
from tests.conftest import auth_headers

API = "/api/v1"


def rating(ratee, skill=4, fair=4, rel=4, showed_up=True, tags=None):
    return {"ratee_id": str(ratee.id), "skill": skill, "fair_play": fair, "reliability": rel,
            "showed_up": showed_up, "tags": tags or []}


async def fresh_stats(user_id: uuid.UUID) -> PlayerStats:
    async with SessionLocal() as s:
        return await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user_id))


@pytest.fixture
async def completed_match(db, make_user):
    host, *players = await make_users(make_user, 5, prefix="Rater")
    pitch = await make_pitch(db)
    lobby = await make_lobby(db, pitch, host, players, start=hour_from_now(-3), status="completed",
                             completed_at=utcnow() - timedelta(hours=1), total_spots=5)
    return lobby, host, players


# ───────────────────────────── pure maths ─────────────────────────────
def test_bayesian_prior_and_weighting():
    assert rs.bayesian_mean(0, 0) == pytest.approx(3.0)
    assert rs.bayesian_mean(5 * 1.0, 1.0) == pytest.approx((12 + 5) / 5)
    # a heavier rating moves the mean further
    assert rs.bayesian_mean(5 * 1.0, 1.0) > rs.bayesian_mean(5 * 0.5, 0.5)


def test_rater_credibility_weight_bounds():
    assert rs.rater_weight(rs.credibility(0, 0, False)) == pytest.approx(0.5)
    assert rs.rater_weight(rs.credibility(30, 40, True)) == pytest.approx(1.0)
    mid = rs.rater_weight(rs.credibility(5, 5, False))
    assert 0.5 < mid < 1.0
    # verified status alone raises credibility
    assert rs.credibility(5, 5, True) > rs.credibility(5, 5, False)


def test_true_skill_formula_and_confidence_shrink():
    assert rs.true_skill_from(5, 5, 5, 10) == pytest.approx(100)
    assert rs.true_skill_from(1, 1, 1, 10) == pytest.approx(0)
    assert rs.true_skill_from(3, 3, 3, 1) == pytest.approx(50)
    # half confidence → halfway between raw (100) and 50
    assert rs.true_skill_from(5, 5, 5, 5) == pytest.approx(75)
    # skill dominates (0.6 weight)
    assert rs.true_skill_from(5, 3, 3, 10) > rs.true_skill_from(3, 5, 5, 10)


def test_tiers():
    assert rs.tier_for(90, 2) == "rookie"
    assert rs.tier_for(54.9, 3) == "regular"
    assert rs.tier_for(55, 3) == "skilled"
    assert rs.tier_for(69.9, 8) == "skilled"
    assert rs.tier_for(70, 8) == "elite"


def _stats_with(n: int, avg: float, weight_each: float = 1.0) -> PlayerStats:
    s = PlayerStats(user_id=uuid.uuid4(), ratings_received=0, weight_sum=0.0, skill_wsum=0.0, fair_play_wsum=0.0,
                    reliability_wsum=0.0, no_shows=0, distinct_raters=0, tag_counts={})
    for _ in range(n):
        rs.apply_rating(s, round(avg), round(avg), round(avg), weight_each)
    return s


def test_outlier_dampening_only_after_five_ratings():
    four = _stats_with(4, 5)
    assert not rs.is_outlier(four, 1, 5, 5)
    five = _stats_with(5, 5)
    assert five.avg_skill > 4.0
    assert rs.is_outlier(five, 1, 5, 5)  # revenge rating: deviates > 2
    assert not rs.is_outlier(five, 3, 4, 4)  # honest-but-lower rating
    # damped weight moves the mean half as far as an undamped one would
    damped, undamped = _stats_with(5, 5), _stats_with(5, 5)
    rs.apply_rating(damped, 1, 1, 1, 1.0 * rs.OUTLIER_FACTOR)
    rs.apply_rating(undamped, 1, 1, 1, 1.0)
    assert damped.avg_skill > undamped.avg_skill


def test_no_show_hits_reliability_only():
    s = _stats_with(6, 4)
    skill, fair, rel = s.avg_skill, s.avg_fair_play, s.avg_reliability
    rs.apply_no_show(s)
    assert s.no_shows == 1
    assert s.ratings_received == 6
    assert s.avg_skill == pytest.approx(skill)
    assert s.avg_fair_play == pytest.approx(fair)
    assert s.avg_reliability < rel


def test_verified_criteria_labels_and_eligibility():
    s = _stats_with(8, 5)
    s.distinct_raters = 5
    assert rs.is_verified_eligible(s)
    keys = {c.key: c for c in rs.verified_criteria(s)}
    assert set(keys) == {"ratings", "distinct_raters", "skill", "fair_play", "reliability", "no_shows"}
    assert all(c.label and c.met for c in keys.values())
    s.no_shows = 2
    assert not rs.is_verified_eligible(s)


# ───────────────────────────── submission rules ─────────────────────────────
async def test_submit_happy_path_and_idempotency(client, completed_match):
    lobby, host, players = completed_match
    url = f"{API}/ratings/lobbies/{lobby.id}"
    body = {"ratings": [rating(players[0], 5, 4, 5, tags=["Great passer", "Engine"]), rating(players[1], 3, 4, 4)]}
    resp = await client.post(url, json=body, headers=auth_headers(host))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"submitted": 2, "xp_awarded": 30}

    again = await client.post(url, json=body, headers=auth_headers(host))
    assert again.json() == {"submitted": 0, "xp_awarded": 0}
    async with SessionLocal() as s:
        rows = (await s.scalars(select(MatchRating).where(MatchRating.rater_id == host.id))).all()
        assert len(rows) == 2
        assert all(r.weight == pytest.approx(0.5) for r in rows)  # brand-new rater → minimum credibility
        assert all(r.true_skill_after is not None for r in rows)
        xp = await s.scalar(select(func.sum(XpEvent.amount)).where(XpEvent.user_id == host.id))
        assert xp == 30

    ratee = await fresh_stats(players[0].id)
    assert ratee.ratings_received == 1
    assert ratee.distinct_raters == 1
    assert ratee.tag_counts == {"Great passer": 1, "Engine": 1}
    assert ratee.avg_skill == pytest.approx((12 + 0.5 * 5) / 4.5)
    assert (await fresh_stats(host.id)).ratings_given == 2

    pending = (await client.get(f"{API}/ratings/pending", headers=auth_headers(host))).json()
    assert len(pending) == 1
    assert {t["id"] for t in pending[0]["teammates"]} == {str(p.id) for p in players[2:]}

    summary = (await client.get(f"{API}/ratings/me", headers=auth_headers(players[0]))).json()
    assert summary["ratings_received"] == 1
    assert summary["tier"] == "rookie"
    assert len(summary["history"]) == 1
    assert summary["verified_progress"]["eligible"] is False
    assert {t["tag"] for t in summary["top_tags"]} == {"Great passer", "Engine"}


async def test_submit_rejects_bad_requests(client, completed_match, make_user):
    lobby, host, players = completed_match
    url = f"{API}/ratings/lobbies/{lobby.id}"
    outsider = await make_user("Outsider")

    r = await client.post(url, json={"ratings": [rating(players[0])]}, headers=auth_headers(outsider))
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_MEMBER"

    r = await client.post(url, json={"ratings": [rating(host)]}, headers=auth_headers(host))
    assert r.status_code == 422 and "yourself" in r.json()["error"]["message"]

    r = await client.post(url, json={"ratings": [rating(outsider)]}, headers=auth_headers(host))
    assert r.status_code == 422

    r = await client.post(url, json={"ratings": [rating(players[0], tags=["Invented tag"])]},
                          headers=auth_headers(host))
    assert r.status_code == 422

    r = await client.post(url, json={"ratings": [rating(players[0]), rating(players[0])]}, headers=auth_headers(host))
    assert r.status_code == 422

    r = await client.post(url, json={"ratings": [rating(players[0], skill=6)]}, headers=auth_headers(host))
    assert r.status_code == 422

    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(MatchRating)) == 0


async def test_rating_window(client, db, make_user):
    host, mate = await make_users(make_user, 2, prefix="Window")
    pitch = await make_pitch(db)
    stale = await make_lobby(db, pitch, host, [mate], start=hour_from_now(-60), status="completed",
                             completed_at=utcnow() - timedelta(hours=49), total_spots=2)
    r = await client.post(f"{API}/ratings/lobbies/{stale.id}", json={"ratings": [rating(mate)]},
                          headers=auth_headers(host))
    assert r.status_code == 409 and r.json()["error"]["code"] == "RATING_WINDOW_CLOSED"

    upcoming = await make_lobby(db, pitch, host, [mate], start=hour_from_now(5), status="confirmed", total_spots=2)
    r = await client.post(f"{API}/ratings/lobbies/{upcoming.id}", json={"ratings": [rating(mate)]},
                          headers=auth_headers(host))
    assert r.status_code == 409 and r.json()["error"]["code"] == "RATING_WINDOW_CLOSED"
    assert (await client.get(f"{API}/ratings/pending", headers=auth_headers(host))).json() == []


async def test_no_show_needs_two_reports_and_counts_once(client, completed_match):
    lobby, host, players = completed_match
    url = f"{API}/ratings/lobbies/{lobby.id}"
    absentee = players[3]
    await client.post(url, json={"ratings": [rating(absentee, showed_up=False)]}, headers=auth_headers(host))
    assert (await fresh_stats(absentee.id)).no_shows == 0
    await client.post(url, json={"ratings": [rating(absentee, showed_up=False)]}, headers=auth_headers(players[0]))
    after_two = await fresh_stats(absentee.id)
    assert after_two.no_shows == 1
    await client.post(url, json={"ratings": [rating(absentee, showed_up=False)]}, headers=auth_headers(players[1]))
    after_three = await fresh_stats(absentee.id)
    assert after_three.no_shows == 1
    assert after_three.ratings_received == 3
    # synthetic 1-star drags reliability below the plain average of the three 4-star ratings
    assert after_three.avg_reliability < after_three.avg_skill
    async with SessionLocal() as s:
        member = await s.scalar(select(LobbyMember).where(LobbyMember.lobby_id == lobby.id,
                                                          LobbyMember.user_id == absentee.id))
        assert member.attended is False


async def test_outlier_rating_is_damped_on_submit(client, completed_match):
    lobby, host, players = completed_match
    target = players[0]
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == target.id))
        for _ in range(6):
            rs.apply_rating(stats, 5, 5, 5, 1.0)
        await s.commit()
    await client.post(f"{API}/ratings/lobbies/{lobby.id}", json={"ratings": [rating(target, 1, 1, 1)]},
                      headers=auth_headers(host))
    async with SessionLocal() as s:
        row = await s.scalar(select(MatchRating).where(MatchRating.ratee_id == target.id))
        assert row.weight == pytest.approx(0.5 * rs.OUTLIER_FACTOR)


async def test_verified_playmaker_award_and_revoke(db, make_user):
    user = await make_user("Almost Verified")
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user.id).with_for_update())
        for _ in range(8):
            rs.apply_rating(stats, 5, 5, 5, 1.0)
        stats.distinct_raters = 5
        await rs.evaluate_verified(s, stats)
        await s.commit()
    s1 = await fresh_stats(user.id)
    assert s1.is_verified_playmaker and s1.verified_at is not None
    async with SessionLocal() as s:
        assert await s.scalar(select(UserBadge).where(UserBadge.user_id == user.id,
                                                      UserBadge.badge_code == "verified_playmaker"))
        xp_rows = (await s.scalars(select(XpEvent).where(XpEvent.user_id == user.id,
                                                         XpEvent.reason == rs.VERIFIED_XP_REASON))).all()
        assert len(xp_rows) == 1
        types = set((await s.scalars(select(Notification.type).where(Notification.user_id == user.id))).all())
        assert {"verified_playmaker", "badge_earned"} <= types

    # a string of bad ratings → loses the badge
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user.id).with_for_update())
        for _ in range(6):
            rs.apply_rating(stats, 1, 2, 2, 1.0)
        await rs.evaluate_verified(s, stats)
        await s.commit()
    s2 = await fresh_stats(user.id)
    assert not s2.is_verified_playmaker and s2.verified_at is None
    async with SessionLocal() as s:
        assert await s.scalar(select(UserBadge).where(UserBadge.user_id == user.id,
                                                      UserBadge.badge_code == "verified_playmaker")) is None

    # winning it back doesn't pay the XP twice
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == user.id).with_for_update())
        for _ in range(30):
            rs.apply_rating(stats, 5, 5, 5, 1.0)
        await rs.evaluate_verified(s, stats)
        await s.commit()
    assert (await fresh_stats(user.id)).is_verified_playmaker
    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(XpEvent).where(
            XpEvent.user_id == user.id, XpEvent.reason == rs.VERIFIED_XP_REASON)) == 1


async def test_verified_awarded_through_live_submission(client, db, make_user):
    host, *mates = await make_users(make_user, 6, prefix="Squad")
    star = mates[0]
    async with SessionLocal() as s:  # 7 strong ratings from 4 raters already on record
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == star.id))
        for _ in range(7):
            rs.apply_rating(stats, 5, 5, 5, 1.0)
        stats.distinct_raters = 4
        await s.commit()
    pitch = await make_pitch(db)
    lobby = await make_lobby(db, pitch, host, mates, start=hour_from_now(-2), status="completed",
                             completed_at=utcnow() - timedelta(minutes=30), total_spots=6)
    r = await client.post(f"{API}/ratings/lobbies/{lobby.id}", json={"ratings": [rating(star, 5, 5, 5)]},
                          headers=auth_headers(host))
    assert r.status_code == 200
    final = await fresh_stats(star.id)
    assert final.ratings_received == 8 and final.distinct_raters == 5
    assert final.is_verified_playmaker
    me = (await client.get(f"{API}/ratings/me", headers=auth_headers(star))).json()
    assert me["verified_progress"]["eligible"] is True
    assert me["is_verified_playmaker"] is True


async def test_match_completed_sends_rating_requests(db, completed_match):
    lobby, host, players = completed_match
    async with SessionLocal() as s:
        await emit(s, "match.completed", lobby_id=lobby.id)
        await s.commit()
    async with SessionLocal() as s:
        notes = (await s.scalars(select(Notification).where(Notification.type == "rating_request"))).all()
        assert {n.user_id for n in notes} == {host.id, *(p.id for p in players)}
        assert all(n.data["url"] == f"/app/rate/{lobby.id}" for n in notes)
