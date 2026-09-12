"""Lobby features: eligibility gates, feed, quick match, teams, kick, chat, visibility, mine, seat expiry."""

from datetime import timedelta

from sqlalchemy import update

from app.core.timeutils import utcnow
from app.modules.lobbies.jobs import complete_finished_matches, expire_holds
from app.modules.lobbies.models import LobbyMember
from app.modules.users.models import PlayerStats
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, lobby, make_slot, make_venue, pay


async def _set_skill(db, user, true_skill, *, verified=False):
    await db.execute(
        update(PlayerStats)
        .where(PlayerStats.user_id == user.id)
        .values(true_skill=true_skill, is_verified_playmaker=verified, tier="skilled", ratings_received=10)
    )
    await db.commit()


async def test_eligibility_gates(client, db, make_user):
    host, weak, strong, unrated = (await make_user("Host"), await make_user("Weak"), await make_user("Strong"),
                                   await make_user("New"))
    await _set_skill(db, weak, 58.4)
    await _set_skill(db, strong, 71.0, verified=True)
    _, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=6, min_true_skill=65))["lobby"]

    resp = await client.post(f"{API}/lobbies/{lob['id']}/join", headers=auth_headers(weak))
    assert resp.status_code == 403
    err = resp.json()["error"]
    assert err["code"] == "NOT_ELIGIBLE" and err["details"]["reasons"] == ["Needs True Skill 65 — you're 58"]
    resp = await client.post(f"{API}/lobbies/{lob['id']}/join", headers=auth_headers(unrated))
    assert resp.json()["error"]["details"]["reasons"] == ["Needs True Skill 65 — you're not rated yet"]

    detail = await lobby(client, weak, lob["id"])
    assert detail["eligibility"] == {"can_join": False, "reasons": ["Needs True Skill 65 — you're 58"]}
    assert (await lobby(client, host, lob["id"]))["eligibility"]["can_join"] is True

    # feed hides ineligible lobbies unless asked
    assert (await client.get(f"{API}/lobbies", headers=auth_headers(weak))).json()["total"] == 0
    shown = (await client.get(f"{API}/lobbies", params={"include_ineligible": "true"},
                              headers=auth_headers(weak))).json()
    assert shown["total"] == 1
    assert (await client.get(f"{API}/lobbies", headers=auth_headers(strong))).json()["total"] == 1

    await join(client, strong, lob["id"])

    # verified-only gate
    slot2 = await make_slot(db, pitch, hours_ahead=30)
    lob2 = (await book(client, host, slot2, total_spots=4, verified_only=True))["lobby"]
    resp = await client.post(f"{API}/lobbies/{lob2['id']}/join", headers=auth_headers(weak))
    assert resp.status_code == 403 and "Verified Playmakers only" in resp.json()["error"]["details"]["reasons"][0]
    await join(client, strong, lob2["id"])


async def test_quick_match_ranks_and_explains(client, db, make_user):
    host, me = await make_user("Host"), await make_user("Me", home_lat=9.99, home_lng=76.29)
    near_turf, near_pitch = await make_venue(db, lat=9.9975, lng=76.2926)
    _, far_pitch = await make_venue(db, lat=10.1076, lng=76.3516)
    near = (await book(client, host, await make_slot(db, near_pitch, hours_ahead=3), total_spots=4))["lobby"]
    await book(client, host, await make_slot(db, far_pitch, hours_ahead=60), total_spots=4)

    resp = (await client.get(f"{API}/lobbies/quick-match", params={"sport": "football"},
                             headers=auth_headers(me))).json()
    assert resp["lobby"]["id"] == near["id"] and resp["score"] > 0
    assert resp["reasons"][0].startswith("Kicks off in") and resp["reasons"][1].endswith("km away")
    assert any(r.startswith("Skill match") for r in resp["reasons"])
    assert resp["lobby"]["distance_km"] is not None and resp["lobby"]["turf"]["slug"] == near_turf.slug

    none = (await client.get(f"{API}/lobbies/quick-match", params={"sport": "badminton"},
                             headers=auth_headers(me))).json()
    assert none["lobby"] is None and none["reasons"]


async def test_balance_teams_kick_chat_and_visibility(client, db, make_user):
    host = await make_user("Host")
    players = [await make_user(f"P{i}") for i in range(3)]
    for i, p in enumerate(players):
        await _set_skill(db, p, 40 + i * 15)
    outsider = await make_user("Outsider")
    _, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=6, visibility="private"))["lobby"]
    for p in players:  # private lobbies are joined through the invite link (code) first
        assert (await client.get(f"{API}/lobbies/code/{lob['code']}", headers=auth_headers(p))).status_code == 200
        await join(client, p, lob["id"])

    # private: hidden by id for strangers, reachable by code
    assert (await client.get(f"{API}/lobbies/{lob['id']}", headers=auth_headers(outsider))).status_code == 404
    by_code = await client.get(f"{API}/lobbies/code/{lob['code'].lower()}", headers=auth_headers(outsider))
    assert by_code.status_code == 200 and by_code.json()["id"] == lob["id"]

    balanced = (await client.post(f"{API}/lobbies/{lob['id']}/balance-teams", headers=auth_headers(host))).json()
    teams = [m["team"] for m in balanced["members"]]
    assert teams.count("A") == 2 and teams.count("B") == 2
    not_host = await client.post(f"{API}/lobbies/{lob['id']}/balance-teams", headers=auth_headers(players[0]))
    assert not_host.status_code == 403

    # chat: members only for posting
    sent = await client.post(f"{API}/lobbies/{lob['id']}/messages", json={"body": " Who's bringing bibs? "},
                             headers=auth_headers(players[0]))
    assert sent.status_code == 201 and sent.json()["body"] == "Who's bringing bibs?"
    assert sent.json()["user"]["name"] == "P0"
    denied = await client.post(f"{API}/lobbies/{lob['id']}/messages", json={"body": "hi"},
                               headers=auth_headers(outsider))
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "NOT_MEMBER"
    history = (await client.get(f"{API}/lobbies/{lob['id']}/messages", headers=auth_headers(host))).json()
    assert history[-1]["kind"] == "chat" and history[0]["kind"] == "system"
    assert [m["created_at"] for m in history] == sorted(m["created_at"] for m in history)

    # kick: only unpaid members
    await pay(client, players[1], lob["id"])
    paid_kick = await client.delete(f"{API}/lobbies/{lob['id']}/members/{players[1].id}", headers=auth_headers(host))
    assert paid_kick.status_code == 409
    kicked = await client.delete(f"{API}/lobbies/{lob['id']}/members/{players[2].id}", headers=auth_headers(host))
    assert kicked.status_code == 200 and kicked.json()["filled_spots"] == 3

    upcoming = (await client.get(f"{API}/lobbies/mine", params={"scope": "upcoming"},
                                 headers=auth_headers(players[0]))).json()
    assert [s["id"] for s in upcoming] == [lob["id"]]
    assert (await client.get(f"{API}/lobbies/mine", params={"scope": "past"},
                             headers=auth_headers(players[0]))).json() == []


async def test_unpaid_seat_released_by_worker_and_matches_complete(client, db, make_user):
    host, p1, p2 = await make_user("Host"), await make_user("Anu"), await make_user("Binu")
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch, hours_ahead=30)
    lob = (await book(client, host, slot, mode="full", total_spots=4))["lobby"]
    await pay(client, host, lob["id"])
    await join(client, p1, lob["id"])
    await db.execute(
        update(LobbyMember).where(LobbyMember.user_id == p1.id).values(reserved_until=utcnow() - timedelta(minutes=1))
    )
    await db.commit()
    late = await client.post(f"{API}/lobbies/{lob['id']}/pay", json={"use_credits": True}, headers=auth_headers(p1))
    assert late.status_code == 409 and late.json()["error"]["code"] == "PAYMENT_WINDOW_CLOSED"
    assert await expire_holds(db) == 1
    after = await lobby(client, host, lob["id"])
    assert after["filled_spots"] == 1 and after["status"] == "confirmed"
    # the released player can rejoin
    await join(client, p1, lob["id"])
    await join(client, p2, lob["id"])

    # end of match → completed by the worker
    from app.modules.lobbies.models import Lobby

    await db.execute(update(Lobby).where(Lobby.id == lob["id"]).values(end_at=utcnow() - timedelta(minutes=5),
                                                                       start_at=utcnow() - timedelta(minutes=65)))
    await db.commit()
    assert await complete_finished_matches(db) == 1
    done = await lobby(client, host, lob["id"])
    assert done["status"] == "completed" and done["booking"]["status"] == "completed"
    past = (await client.get(f"{API}/lobbies/mine", params={"scope": "past"}, headers=auth_headers(host))).json()
    assert [s["id"] for s in past] == [lob["id"]]
