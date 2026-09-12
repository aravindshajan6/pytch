"""Manual mirroring: every Pytch booking on a partner venue becomes a "block it on your other apps" to-do (+ live
alert on `venue:<turf>`); a released booking closes it or asks to unblock. Venue-scoped, audited."""

import uuid

import pytest
from sqlalchemy import select

from app.core.database import SessionLocal
from app.modules.audit.models import AuditLog
from app.modules.channels import handlers as mirror_handlers
from app.modules.channels.models import MirrorTask
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.models import Lobby
from tests.core_helpers import book, make_slot, make_venue
from tests.partner_helpers import API, add_member, gen_slots, make_provider, partner_headers, provider_venue


@pytest.fixture
def published(monkeypatch):
    events: list[tuple[str, str, dict]] = []

    async def fake_publish(channel, event, data):
        events.append((channel, event, data))

    monkeypatch.setattr("app.realtime.publisher.publish", fake_publish)
    return events


async def _tasks(**where) -> list[MirrorTask]:
    async with SessionLocal() as s:
        q = select(MirrorTask)
        for k, v in where.items():
            q = q.where(getattr(MirrorTask, k) == v)
        return list((await s.scalars(q.order_by(MirrorTask.created_at))).all())


async def test_pytch_booking_creates_block_todo_and_alert(client, db, make_user, published):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)
    slot = (await gen_slots(db, pitch))[-1]
    res = await book(client, host, slot)

    [task] = await _tasks(lobby_id=uuid.UUID(res["lobby"]["id"]))
    assert (task.action, task.status, task.slot_id, task.booking_code) == ("block", "open", slot.id,
                                                                            res["booking"]["code"])
    alert = [e for e in published if e[0] == f"venue:{turf.id}"]
    assert alert and alert[0][1] == "mirror.task" and alert[0][2]["action"] == "block"
    assert alert[0][2]["pitch_name"] == pitch.name and "phone" not in str(alert[0][2]).lower()  # no player PII

    listed = (await client.get(f"{API}/partner/mirror-tasks", headers=partner_headers(owner, provider.id))).json()
    assert [t["id"] for t in listed] == [str(task.id)] and listed[0]["turf_name"] == turf.name

    # tick it off → gone from open, in done, audited, other screens told
    r = await client.patch(f"{API}/partner/mirror-tasks/{task.id}", headers=partner_headers(owner, provider.id),
                           json={"done": True})
    assert r.status_code == 200 and r.json()["status"] == "done" and r.json()["resolved_by_name"] == "Owner"
    assert (await client.get(f"{API}/partner/mirror-tasks", headers=partner_headers(owner, provider.id))).json() == []
    done = (await client.get(f"{API}/partner/mirror-tasks", params={"status": "done"},
                             headers=partner_headers(owner, provider.id))).json()
    assert [t["id"] for t in done] == [str(task.id)]
    assert any(e[1] == "mirror.task_updated" for e in published)
    async with SessionLocal() as s:
        assert await s.scalar(select(AuditLog.id).where(AuditLog.action == "mirror_task.update"))
    # undo works too
    r = await client.patch(f"{API}/partner/mirror-tasks/{task.id}", headers=partner_headers(owner, provider.id),
                           json={"done": False})
    assert r.json()["status"] == "open"


async def test_release_before_blocking_closes_the_todo(client, db, make_user, published):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    res = await book(client, host, (await gen_slots(db, pitch))[-1])
    lobby_id = uuid.UUID(res["lobby"]["id"])
    async with SessionLocal() as s:
        await lobbies.expire_lobby(s, await lobbies.get_lobby(s, lobby_id, for_update=True))
        await s.commit()
    [task] = await _tasks(lobby_id=lobby_id)
    assert task.status == "obsolete"  # never blocked elsewhere → nothing to undo, no unblock to-do
    assert any(e[1] == "mirror.task_closed" for e in published)


async def test_release_after_blocking_asks_to_unblock(client, db, make_user, published):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)
    res = await book(client, host, (await gen_slots(db, pitch))[-1])
    lobby_id = uuid.UUID(res["lobby"]["id"])
    [block] = await _tasks(lobby_id=lobby_id)
    await client.patch(f"{API}/partner/mirror-tasks/{block.id}", headers=partner_headers(owner, provider.id),
                       json={"done": True})
    async with SessionLocal() as s:
        await lobbies.cancel_lobby(s, await s.get(Lobby, lobby_id))
        await s.commit()
    tasks = await _tasks(lobby_id=lobby_id)
    assert [(t.action, t.status) for t in tasks] == [("block", "done"), ("unblock", "open")]
    unblock_alerts = [e for e in published if e[1] == "mirror.task" and e[2]["action"] == "unblock"]
    assert unblock_alerts and unblock_alerts[0][0] == f"venue:{turf.id}"


async def test_staff_only_see_their_venues_and_non_partner_venues_make_no_todos(client, db, make_user, published):
    owner, staff, host = await make_user("Owner"), await make_user("Desk"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf_a, pitch_a = await provider_venue(db, provider)
    _, pitch_b = await provider_venue(db, provider)
    await add_member(db, provider, staff, "staff", turf_ids=[turf_a.id])
    await book(client, host, (await gen_slots(db, pitch_a))[-1])
    other = await book(client, await make_user("Host2"), (await gen_slots(db, pitch_b))[-1])

    mine = (await client.get(f"{API}/partner/mirror-tasks", headers=partner_headers(staff, provider.id))).json()
    assert {t["pitch_id"] for t in mine} == {str(pitch_a.id)}
    [task_b] = await _tasks(lobby_id=uuid.UUID(other["lobby"]["id"]))
    r = await client.patch(f"{API}/partner/mirror-tasks/{task_b.id}", headers=partner_headers(staff, provider.id),
                           json={"done": True})
    assert r.status_code == 404  # another venue's to-do

    rival = await make_provider(db, await make_user("Rival"))
    r = await client.patch(f"{API}/partner/mirror-tasks/{task_b.id}",
                           headers=partner_headers(await make_user("Nope"), rival.id), json={"done": True})
    assert r.status_code in (403, 404)

    _, plain_pitch = await make_venue(db)  # Pytch-managed venue, no partner → nobody to alert
    plain = await book(client, await make_user("Host3"), await make_slot(db, plain_pitch))
    assert await _tasks(lobby_id=uuid.UUID(plain["lobby"]["id"])) == []


async def test_venue_alert_channel_is_partner_and_scope_only(db, make_user):
    from app.realtime.router import _can_subscribe

    owner, staff, player = await make_user("Owner"), await make_user("Desk"), await make_user("Player")
    provider = await make_provider(db, owner)
    turf_a, _ = await provider_venue(db, provider)
    turf_b, _ = await provider_venue(db, provider)
    await add_member(db, provider, staff, "staff", turf_ids=[turf_a.id])
    assert await _can_subscribe(owner.id, f"venue:{turf_b.id}", "partner")
    assert await _can_subscribe(staff.id, f"venue:{turf_a.id}", "partner")
    assert not await _can_subscribe(staff.id, f"venue:{turf_b.id}", "partner")
    assert not await _can_subscribe(player.id, f"venue:{turf_a.id}", "app")
    assert not await _can_subscribe(owner.id, f"venue:{turf_a.id}", "app")  # player audience never gets it
    provider.status = "suspended"
    await db.commit()
    assert not await _can_subscribe(owner.id, f"venue:{turf_a.id}", "partner")


async def test_move_indoors_unblocks_old_venue_and_blocks_new_one(client, db, make_user, published):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf_a, pitch_a = await provider_venue(db, provider)
    turf_b, pitch_b = await provider_venue(db, provider)
    old_slot = (await gen_slots(db, pitch_a))[-1]
    new_slot = (await gen_slots(db, pitch_b))[-1]
    res = await book(client, host, old_slot)
    lobby_id = uuid.UUID(res["lobby"]["id"])
    [block] = await _tasks(lobby_id=lobby_id)
    await client.patch(f"{API}/partner/mirror-tasks/{block.id}", headers=partner_headers(owner, provider.id),
                       json={"done": True})
    async with SessionLocal() as s:
        await mirror_handlers.booking_moved(s, lobby_id=lobby_id, old_slot_id=old_slot.id, new_slot_id=new_slot.id)
        await s.commit()
    tasks = {(t.action, t.slot_id, t.status) for t in await _tasks(lobby_id=lobby_id)}
    assert ("unblock", old_slot.id, "open") in tasks and ("block", new_slot.id, "open") in tasks
