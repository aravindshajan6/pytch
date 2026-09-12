"""Split payments: all-or-nothing within the window, expiry refunds, leave refunds, credits, late captures."""

from datetime import timedelta

from sqlalchemy import select, update

from app.core.timeutils import utcnow
from app.modules.bookings.models import Booking
from app.modules.lobbies.jobs import expire_holds
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment
from app.modules.slots.models import Slot
from app.modules.wallet.service import credit
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, lobby, make_slot, make_venue, pay, wallet


async def test_split_flow_confirms_and_books_slot(client, db, make_user):
    host, p1, p2 = await make_user("Host"), await make_user("Anu"), await make_user("Binu")
    _, pitch = await make_venue(db, price=150_000)
    slot = await make_slot(db, pitch)

    created = await book(client, host, slot, total_spots=3)
    lob = created["lobby"]
    assert created["booking"]["status"] == "pending_payment"
    assert lob["share_paise"] == 50_000 and lob["status"] == "forming" and lob["pay_deadline"]
    assert lob["my_membership"]["role"] == "host" and lob["invite_url"].endswith(lob["code"])

    # slot is held for the split window
    slots = (await client.get(f"{API}/pitches/{pitch.id}/slots",
                              params={"date": str((slot.start_at + timedelta(hours=5, minutes=30)).date())})).json()
    held = next(s for s in slots if s["id"] == str(slot.id))
    assert held["status"] == "held" and held["open_lobby_id"] == lob["id"]

    intent = await pay(client, host, lob["id"])
    assert intent["purpose"] == "share" and intent["provider"] == "mock" and intent["status"] == "paid"
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])
    mid = await lobby(client, host, lob["id"])
    assert mid["status"] == "forming" and mid["paid_spots"] == 2 and mid["filled_spots"] == 2

    await join(client, p2, lob["id"])
    await pay(client, p2, lob["id"])
    final = await lobby(client, host, lob["id"])
    assert final["status"] == "confirmed" and final["paid_spots"] == 3 and final["spots_left"] == 0
    assert final["booking"]["status"] == "confirmed" and final["pay_deadline"] is None

    await db.refresh(slot)
    assert slot.status == "booked"
    confirmed_notes = (await db.scalars(select(Notification).where(Notification.type == "lobby_confirmed"))).all()
    assert {n.user_id for n in confirmed_notes} == {host.id, p1.id, p2.id}

    # joining a full, confirmed lobby is rejected
    p3 = await make_user("Chinnu")
    resp = await client.post(f"{API}/lobbies/{lob['id']}/join", headers=auth_headers(p3))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "LOBBY_FULL"

    msgs = (await client.get(f"{API}/lobbies/{lob['id']}/messages", headers=auth_headers(host))).json()
    assert any("confirmed" in m["body"] for m in msgs) and all(m["kind"] == "system" for m in msgs)


async def test_split_expiry_refunds_to_credits_and_releases_slot(client, db, make_user):
    host, p1, p2 = await make_user("Host"), await make_user("Anu"), await make_user("Binu")
    _, pitch = await make_venue(db, price=150_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=3))["lobby"]
    await pay(client, host, lob["id"])
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])
    await join(client, p2, lob["id"])  # joined but never pays
    pending = await pay(client, p2, lob["id"], complete=False)
    assert pending["status"] == "created"

    past = utcnow() - timedelta(minutes=1)
    await db.execute(update(Lobby).where(Lobby.id == lob["id"]).values(pay_deadline=past))
    await db.commit()
    assert await expire_holds(db) >= 1

    after = await lobby(client, host, lob["id"])
    assert after["status"] == "expired" and after["booking"]["status"] == "expired"
    assert (await wallet(client, host))["balance_paise"] == 50_000
    assert (await wallet(client, p1))["balance_paise"] == 50_000
    assert (await wallet(client, p2))["balance_paise"] == 0
    await db.refresh(slot)
    assert slot.status == "available" and slot.booking_id is None
    statuses = {p.status for p in (await db.scalars(select(Payment).where(Payment.lobby_id == lob["id"]))).all()}
    assert statuses == {"refunded", "cancelled"}

    # a late capture of the pending intent is refunded to credits, not applied
    late = await client.post(f"{API}/payments/{pending['payment_id']}/mock/complete", json={"outcome": "success"},
                             headers=auth_headers(p2))
    assert late.status_code == 200 and late.json()["status"] == "cancelled"

    # the slot is bookable again
    again = await client.post(f"{API}/bookings", json={"slot_id": str(slot.id), "mode": "split", "total_spots": 2,
                                                      "visibility": "private"}, headers=auth_headers(p2))
    assert again.status_code == 201


async def test_late_capture_after_expiry_is_refunded(client, db, make_user):
    host = await make_user("Host")
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=2))["lobby"]
    intent = await pay(client, host, lob["id"], complete=False)
    # expire the window without the worker having run yet
    await db.execute(update(Lobby).where(Lobby.id == lob["id"]).values(pay_deadline=utcnow() - timedelta(seconds=5)))
    await db.commit()
    done = await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete", json={"outcome": "success"},
                             headers=auth_headers(host))
    assert done.json()["status"] == "refunded"
    assert (await wallet(client, host))["balance_paise"] == 50_000


async def test_leave_before_confirm_refunds_share(client, db, make_user):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=150_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=3))["lobby"]
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])

    resp = await client.post(f"{API}/lobbies/{lob['id']}/leave", headers=auth_headers(p1))
    assert resp.status_code == 200
    body = resp.json()
    assert body["my_membership"] is None and body["filled_spots"] == 1 and body["status"] == "forming"
    w = await wallet(client, p1)
    assert w["balance_paise"] == 50_000 and w["transactions"][0]["kind"] == "refund"
    member = await db.scalar(select(LobbyMember).where(LobbyMember.user_id == p1.id))
    assert member.status == "left"

    # host can't leave
    resp = await client.post(f"{API}/lobbies/{lob['id']}/leave", headers=auth_headers(host))
    assert resp.status_code == 409


async def test_credits_covering_share_use_wallet_provider(client, db, make_user):
    host, p1 = await make_user("Host"), await make_user("Anu")
    await credit(db, p1.id, 80_000, "bonus", "welcome")
    await db.commit()
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=2))["lobby"]
    await join(client, p1, lob["id"])
    intent = await pay(client, p1, lob["id"], complete=False)
    assert intent["provider"] == "wallet" and intent["status"] == "paid"
    assert intent["credits_applied_paise"] == 50_000 and intent["payable_paise"] == 0
    assert (await wallet(client, p1))["balance_paise"] == 30_000

    # partial credits → mock pays the rest
    host_intent = await pay(client, host, lob["id"], use_credits=True, complete=False)
    assert host_intent["provider"] == "mock" and host_intent["payable_paise"] == 50_000

    resp = await client.post(f"{API}/lobbies/{lob['id']}/pay", json={"use_credits": True}, headers=auth_headers(p1))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "ALREADY_PAID"


async def test_failed_payment_returns_credits_and_retry_supersedes(client, db, make_user):
    host = await make_user("Host")
    await credit(db, host.id, 20_000, "bonus", "welcome")
    await db.commit()
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=2))["lobby"]
    first = await pay(client, host, lob["id"], complete=False)
    assert first["credits_applied_paise"] == 20_000
    assert (await wallet(client, host))["balance_paise"] == 0
    failed = await client.post(f"{API}/payments/{first['payment_id']}/mock/complete", json={"outcome": "failure"},
                               headers=auth_headers(host))
    assert failed.json()["status"] == "failed"
    assert (await wallet(client, host))["balance_paise"] == 20_000

    second = await pay(client, host, lob["id"], complete=False)
    third = await pay(client, host, lob["id"], complete=False)  # supersedes the second
    assert (await wallet(client, host))["balance_paise"] == 0
    rows = {p.id: p.status for p in (await db.scalars(select(Payment))).all()}
    assert rows[__import__("uuid").UUID(second["payment_id"])] == "cancelled"
    assert rows[__import__("uuid").UUID(third["payment_id"])] == "created"


async def test_cover_remaining_locks_the_game(client, db, make_user):
    host, p1, p2 = await make_user("Host"), await make_user("Anu"), await make_user("Binu")
    _, pitch = await make_venue(db, price=200_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=4))["lobby"]
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])
    await join(client, p2, lob["id"])  # unpaid

    resp = await client.post(f"{API}/lobbies/{lob['id']}/cover-remaining", json={"use_credits": False},
                             headers=auth_headers(host))
    assert resp.status_code == 200, resp.text
    intent = resp.json()
    assert intent["purpose"] == "cover_remaining" and intent["amount_paise"] == 3 * 50_000
    await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete", json={"outcome": "success"},
                      headers=auth_headers(host))
    final = await lobby(client, host, lob["id"])
    assert final["status"] == "confirmed" and final["paid_spots"] == 3 and final["spots_left"] == 1
    booking = await db.scalar(select(Booking).where(Booking.id == final["booking"]["id"]))
    await db.refresh(booking)
    assert booking.status == "confirmed"

    # a newcomer paying for the open seat reimburses the host who fronted it
    p3 = await make_user("Chinnu")
    await join(client, p3, lob["id"])
    await pay(client, p3, lob["id"])
    assert (await wallet(client, host))["balance_paise"] == 50_000
    slot_row = await db.get(Slot, slot.id)
    await db.refresh(slot_row)
    assert slot_row.status == "booked"
