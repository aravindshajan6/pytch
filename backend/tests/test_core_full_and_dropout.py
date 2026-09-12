"""Full mode (host fronts + auto-reimbursement) and the dropout rule with a discounted sub."""

import uuid

import pytest
from sqlalchemy import select

from app.core.events import _handlers, on
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.models import LobbyMember
from app.modules.users.models import User
from app.modules.wallet.models import WalletTransaction
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, lobby, make_slot, make_venue, pay, wallet


@pytest.fixture
def captured_events():
    """Record domain events emitted during a test (handlers are removed afterwards)."""
    seen: list[tuple[str, dict]] = []
    registered = []
    for name in ("lobby.confirmed", "member.dropped", "sub.paid", "match.completed", "lobby.expired"):
        async def handler(db, _name=name, **payload):
            seen.append((_name, payload))
        on(name)(handler)
        registered.append((name, handler))
    yield seen
    for name, handler in registered:
        _handlers[name].remove(handler)


async def test_full_mode_confirms_on_host_payment_and_reimburses_host(client, db, make_user, captured_events):
    host, p1, p2 = await make_user("Host"), await make_user("Anu"), await make_user("Binu")
    _, pitch = await make_venue(db, price=150_000)
    slot = await make_slot(db, pitch, hours_ahead=48)
    lob = (await book(client, host, slot, mode="full", total_spots=10))["lobby"]
    assert lob["share_paise"] == 15_000

    # a joiner paying before the host has paid is held until confirmation
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])
    assert (await wallet(client, host))["balance_paise"] == 0

    intent = await pay(client, host, lob["id"])
    assert intent["purpose"] == "full" and intent["amount_paise"] == 150_000
    confirmed = await lobby(client, host, lob["id"])
    assert confirmed["status"] == "confirmed" and confirmed["booking"]["status"] == "confirmed"
    assert ("lobby.confirmed", {"lobby_id": uuid.UUID(lob["id"])}) in captured_events
    assert (await wallet(client, host))["balance_paise"] == 15_000  # deferred reimbursement for p1

    await join(client, p2, lob["id"])
    await pay(client, p2, lob["id"])
    w = await wallet(client, host)
    assert w["balance_paise"] == 30_000
    assert {t["kind"] for t in w["transactions"]} == {"reimbursement"}

    # feed shows the open match to strangers; quick-match picks it
    stranger = await make_user("Stranger")
    feed = (await client.get(f"{API}/lobbies", headers=auth_headers(stranger))).json()
    assert [item["id"] for item in feed["items"]] == [lob["id"]] and feed["items"][0]["spots_left"] == 7
    own_feed = (await client.get(f"{API}/lobbies", headers=auth_headers(host))).json()
    assert own_feed["total"] == 0  # members don't see their own lobbies in the feed


async def test_dropout_then_sub_pays_and_dropout_gets_80_percent(client, db, make_user, captured_events):
    host, p1, p2 = await make_user("Host"), await make_user("Anu"), await make_user("Binu")
    sub = await make_user("Sub")
    _, pitch = await make_venue(db, price=150_000)
    slot = await make_slot(db, pitch, hours_ahead=4)
    lob = (await book(client, host, slot, total_spots=3))["lobby"]
    for user in (host, p1, p2):
        if user is not host:
            await join(client, user, lob["id"])
        await pay(client, user, lob["id"])
    assert (await lobby(client, host, lob["id"]))["status"] == "confirmed"

    # p1 drops out of the confirmed match: no refund, seat reopens, member.dropped emitted
    resp = await client.post(f"{API}/lobbies/{lob['id']}/leave", headers=auth_headers(p1))
    assert resp.status_code == 200 and resp.json()["spots_left"] == 1
    assert (await wallet(client, p1))["balance_paise"] == 0
    dropped = [p for name, p in captured_events if name == "member.dropped"]
    assert len(dropped) == 1 and dropped[0]["user_id"] == p1.id and dropped[0]["was_paid"] is True
    assert 3 < dropped[0]["hours_to_kickoff"] <= 4

    # the bench module reserves a discounted sub seat through the interface
    lobby_row = await lobbies.get_lobby(db, uuid.UUID(lob["id"]))
    sub_user = await db.get(User, sub.id)
    member = await lobbies.add_sub_member(db, lobby_row, sub_user, sos_id=None, discount_paise=10_000)
    await db.commit()
    assert member.role == "sub" and member.share_paise == 40_000 and member.status == "joined"

    intent = await pay(client, sub, lob["id"])
    assert intent["purpose"] == "sub_share" and intent["amount_paise"] == 40_000 and intent["status"] == "paid"

    w = await wallet(client, p1)
    assert w["balance_paise"] == 40_000  # exactly what the sub paid = 80 % of the 50,000 share
    assert w["transactions"][0]["kind"] == "dropout_credit"
    subs_paid = [p for name, p in captured_events if name == "sub.paid"]
    assert subs_paid == [{"lobby_id": uuid.UUID(lob["id"]), "user_id": sub.id, "member_id": member.id, "sos_id": None}]
    after = await lobby(client, host, lob["id"])
    assert after["spots_left"] == 0 and any(m["role"] == "sub" and m["status"] == "paid" for m in after["members"])

    # the dropout's compensation is recorded (so a second payer wouldn't pay them again)
    dropout_row = await db.scalar(
        select(LobbyMember).where(LobbyMember.user_id == p1.id).execution_options(populate_existing=True)
    )
    assert dropout_row.compensated_paise == 40_000

    # completing the match emits match.completed (dev tool path)
    done = await client.post(f"{API}/dev/lobbies/{lob['id']}/complete", headers=auth_headers(host))
    assert done.status_code == 200 and done.json()["status"] == "completed"
    assert ("match.completed", {"lobby_id": uuid.UUID(lob["id"])}) in captured_events


async def test_cancel_refunds_everyone_net_of_reimbursements(client, db, make_user):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch, hours_ahead=48)
    lob = (await book(client, host, slot, mode="full", total_spots=4))["lobby"]
    await pay(client, host, lob["id"])
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])
    assert (await wallet(client, host))["balance_paise"] == 25_000

    booking_id = (await lobby(client, host, lob["id"]))["booking"]["id"]
    resp = await client.post(f"{API}/bookings/{booking_id}/cancel", headers=auth_headers(host))
    assert resp.status_code == 200 and resp.json()["status"] == "cancelled"
    # host fronted 100,000 and got 25,000 back already → 75,000 refunded; p1 gets their 25,000
    assert (await wallet(client, host))["balance_paise"] == 100_000
    assert (await wallet(client, p1))["balance_paise"] == 25_000
    total = sum(t.amount_paise for t in (await db.scalars(select(WalletTransaction))).all())
    assert total == 125_000  # exactly what was paid in, nothing more
