"""Highlights: recording pipeline, clip validation, pin limit, likes/views, feed."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.events import emit
from app.core.timeutils import utcnow
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.highlights import jobs as highlight_jobs
from app.modules.highlights import service as hs
from app.modules.highlights.models import Clip, Recording
from app.modules.notifications.models import Notification
from tests.community_factories import hour_from_now, make_lobby, make_pitch, make_users
from tests.conftest import auth_headers

API = "/api/v1"


@pytest.fixture
async def recorded_match(db, make_user):
    host, *players = await make_users(make_user, 4, prefix="Cam")
    pitch = await make_pitch(db, name="Camera Arena", camera_fee=25000)
    lobby = await make_lobby(db, pitch, host, players, start=hour_from_now(-2), status="completed",
                             completed_at=utcnow() - timedelta(minutes=50), total_spots=4, recorded=True)
    return lobby, host, players


async def ready_recording(lobby_id) -> Recording:
    async with SessionLocal() as s:
        await emit(s, "match.completed", lobby_id=lobby_id)
        await s.commit()
    async with SessionLocal() as s:
        rec = await s.scalar(select(Recording).where(Recording.lobby_id == lobby_id))
        rec.process_after = utcnow() - timedelta(seconds=1)
        await s.commit()
    async with SessionLocal() as s:
        assert await highlight_jobs.process_recordings(s) == 1
    async with SessionLocal() as s:
        return await s.scalar(select(Recording).where(Recording.lobby_id == lobby_id))


def test_footage_library_is_available():
    library = hs.footage_library()
    assert library, "demo footage missing from media/footage"
    assert all(item["file"].endswith(".mp4") for item in library)


async def test_pipeline_schedules_and_processes(recorded_match):
    lobby, host, players = recorded_match
    async with SessionLocal() as s:
        await emit(s, "match.completed", lobby_id=lobby.id)
        await s.commit()
        rec = await s.scalar(select(Recording).where(Recording.lobby_id == lobby.id))
        assert rec.status == "scheduled"
        assert timedelta(seconds=10) < rec.process_after - utcnow() <= timedelta(seconds=21)
    async with SessionLocal() as s:
        assert await highlight_jobs.process_recordings(s) == 0  # not due yet
    rec = await ready_recording(lobby.id)
    assert rec.status == "ready"
    assert rec.video_url.startswith("/media/footage/") and rec.video_url.endswith(".mp4")
    assert rec.duration_s and rec.duration_s > 10
    assert rec.thumbnail_url.startswith("/media/thumbs/")
    async with SessionLocal() as s:
        notes = (await s.scalars(select(Notification).where(Notification.type == "recording_ready"))).all()
        assert {n.user_id for n in notes} == {host.id, *(p.id for p in players)}
        summary = await hs.recording_summary_for_lobby(s, lobby.id)
        assert summary.status == "ready" and summary.thumbnail_url == rec.thumbnail_url


async def test_unrecorded_match_has_no_recording(db, make_user):
    host, mate = await make_users(make_user, 2, prefix="NoCam")
    pitch = await make_pitch(db)
    lobby = await make_lobby(db, pitch, host, [mate], start=hour_from_now(-2), status="completed",
                             completed_at=utcnow(), total_spots=2)
    async with SessionLocal() as s:
        await emit(s, "match.completed", lobby_id=lobby.id)
        await s.commit()
        assert await s.scalar(select(Recording).where(Recording.lobby_id == lobby.id)) is None


async def test_clip_validation(client, recorded_match, make_user):
    lobby, host, players = recorded_match
    async with SessionLocal() as s:
        await emit(s, "match.completed", lobby_id=lobby.id)
        await s.commit()
        rec = await s.scalar(select(Recording).where(Recording.lobby_id == lobby.id))
    url = f"{API}/highlights/recordings/{rec.id}/clips"
    clip = {"title": "Worldie", "start_s": 2, "end_s": 9, "tags": ["goal"]}
    r = await client.post(url, json=clip, headers=auth_headers(host))
    assert r.status_code == 409  # still processing

    rec = await ready_recording(lobby.id)
    outsider = await make_user("Stranger")
    r = await client.post(url, json=clip, headers=auth_headers(outsider))
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_MEMBER"
    r = await client.post(url, json={**clip, "start_s": 0, "end_s": 61}, headers=auth_headers(host))
    assert r.status_code == 422
    r = await client.post(url, json={**clip, "start_s": 5, "end_s": 5.5}, headers=auth_headers(host))
    assert r.status_code == 422
    r = await client.post(url, json={**clip, "start_s": rec.duration_s - 2, "end_s": rec.duration_s + 5},
                          headers=auth_headers(host))
    assert r.status_code == 422

    r = await client.post(url, json={**clip, "tags": ["goal", " Goal ", "skill"]}, headers=auth_headers(players[0]))
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["video_url"] == rec.video_url and out["thumbnail_url"] == rec.thumbnail_url
    assert (out["start_s"], out["end_s"]) == (2, 9)
    assert out["tags"] == ["goal", "skill"]
    assert out["turf_name"] == "Camera Arena" and out["sport"] == "football"
    assert out["owner"]["id"] == str(players[0].id)
    async with SessionLocal() as s:
        xp = await s.scalar(select(XpEvent.amount).where(XpEvent.user_id == players[0].id,
                                                         XpEvent.reason.startswith("Clipped")))
        assert xp == 20

    r = await client.delete(f"{API}/highlights/clips/{out['id']}", headers=auth_headers(host))
    assert r.status_code == 403
    r = await client.delete(f"{API}/highlights/clips/{out['id']}", headers=auth_headers(players[0]))
    assert r.status_code == 204


async def test_pin_limit_likes_views_and_feed(client, recorded_match):
    lobby, host, players = recorded_match
    rec = await ready_recording(lobby.id)
    url = f"{API}/highlights/recordings/{rec.id}/clips"
    ids = []
    for i in range(4):
        r = await client.post(url, json={"title": f"Clip {i}", "start_s": i * 3, "end_s": i * 3 + 2, "tags": []},
                              headers=auth_headers(host))
        ids.append(r.json()["id"])
    for cid in ids[:3]:
        r = await client.post(f"{API}/highlights/clips/{cid}/pin", headers=auth_headers(host))
        assert r.status_code == 200 and r.json()["is_pinned"] is True
    r = await client.post(f"{API}/highlights/clips/{ids[3]}/pin", headers=auth_headers(host))
    assert r.status_code == 409 and r.json()["error"]["code"] == "LIMIT_REACHED"
    r = await client.post(f"{API}/highlights/clips/{ids[0]}/pin", headers=auth_headers(players[0]))
    assert r.status_code == 403
    assert (await client.delete(f"{API}/highlights/clips/{ids[0]}/pin", headers=auth_headers(host))).json()[
        "is_pinned"] is False
    assert (await client.post(f"{API}/highlights/clips/{ids[3]}/pin", headers=auth_headers(host))).status_code == 200
    async with SessionLocal() as s:
        assert await s.scalar(select(UserBadge).where(UserBadge.user_id == host.id,
                                                      UserBadge.badge_code == "highlight_reel"))
        pinned = await hs.pinned_clips_for_user(s, host.id, players[0].id)
        assert {c.id.hex for c in pinned} == {i.replace("-", "") for i in (ids[1], ids[2], ids[3])}

    # likes are idempotent per user
    target = ids[2]
    for user in (players[0], players[0], players[1]):
        r = await client.post(f"{API}/highlights/clips/{target}/like", headers=auth_headers(user))
    assert r.json()["likes_count"] == 2 and r.json()["liked_by_me"] is True
    r = await client.delete(f"{API}/highlights/clips/{target}/like", headers=auth_headers(players[0]))
    assert r.json()["likes_count"] == 1 and r.json()["liked_by_me"] is False
    r = await client.delete(f"{API}/highlights/clips/{target}/like", headers=auth_headers(players[0]))
    assert r.json()["likes_count"] == 1

    for n in (1, 2, 3):
        assert (await client.post(f"{API}/highlights/clips/{target}/view", headers=auth_headers(host))).json() == {
            "views": n}

    feed = (await client.get(f"{API}/highlights/feed", params={"sort": "trending"}, headers=auth_headers(host))).json()
    assert feed["total"] == 4 and feed["items"][0]["id"] == target
    recent = (await client.get(f"{API}/highlights/feed", params={"sort": "recent", "limit": 2},
                               headers=auth_headers(host))).json()
    assert [c["id"] for c in recent["items"]] == [ids[3], ids[2]]
    none = (await client.get(f"{API}/highlights/feed", params={"sport": "cricket"}, headers=auth_headers(host))).json()
    assert none["total"] == 0

    mine = (await client.get(f"{API}/highlights/users/{host.id}/clips", headers=auth_headers(players[1]))).json()
    assert len(mine) == 4 and mine[0]["is_pinned"] is True

    recs = (await client.get(f"{API}/highlights/recordings", headers=auth_headers(players[1]))).json()
    assert len(recs) == 1 and len(recs[0]["clips"]) == 4 and recs[0]["lobby"]["id"] == str(lobby.id)
    one = (await client.get(f"{API}/highlights/recordings/{rec.id}", headers=auth_headers(host))).json()
    assert one["status"] == "ready" and one["duration_s"] == rec.duration_s

    async with SessionLocal() as s:
        clip = await s.get(Clip, target)
        assert clip.likes_count == 1 and clip.views == 3
