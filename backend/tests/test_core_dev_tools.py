"""Demo controls: bots fill a lobby through the real join/pay path; dropout runs the real leave path."""

import asyncio

from sqlalchemy import func, select

from app.modules.dev import lobby_tools
from app.modules.users.models import User
from tests.conftest import auth_headers
from tests.core_helpers import API, book, lobby, make_slot, make_venue, pay, wallet


async def _drain_fill_tasks() -> None:
    for _ in range(100):
        if not lobby_tools._background:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("dev fill did not finish")


async def test_fill_then_dropout(client, db, make_user, monkeypatch):
    monkeypatch.setattr(lobby_tools, "JOIN_TO_PAY_SECONDS", 0)
    monkeypatch.setattr(lobby_tools, "BETWEEN_BOTS_SECONDS", 0)
    host = await make_user("Host")
    _, pitch = await make_venue(db, price=150_000)
    slot = await make_slot(db, pitch, hours_ahead=20)
    lob = (await book(client, host, slot, total_spots=4, min_true_skill=60))["lobby"]
    await pay(client, host, lob["id"])

    resp = await client.post(f"{API}/dev/lobbies/{lob['id']}/fill", headers=auth_headers(host))
    assert resp.status_code == 200 and resp.json() == {"ok": True}
    await _drain_fill_tasks()

    filled = await lobby(client, host, lob["id"])
    assert filled["status"] == "confirmed" and filled["paid_spots"] == 4
    bots = (await db.scalars(select(User).where(User.is_bot.is_(True)))).all()
    assert len(bots) == 3 and all(b.phone.startswith("+910000000") for b in bots)
    assert all(b.stats.true_skill >= 60 for b in bots)  # fitted to the lobby's gate

    dropped = await client.post(f"{API}/dev/lobbies/{lob['id']}/dropout", headers=auth_headers(host))
    assert dropped.status_code == 200 and dropped.json()["spots_left"] == 1

    # refilling brings in a fresh bot (the dropout isn't re-seated); their payment compensates the dropout
    await client.post(f"{API}/dev/lobbies/{lob['id']}/fill", headers=auth_headers(host))
    await _drain_fill_tasks()
    assert (await lobby(client, host, lob["id"]))["spots_left"] == 0
    assert await db.scalar(select(func.count()).select_from(User).where(User.is_bot.is_(True))) == 4
    assert (await wallet(client, host))["balance_paise"] == 0


async def test_complete_requires_confirmed(client, db, make_user):
    host = await make_user("Host")
    _, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=4))["lobby"]
    resp = await client.post(f"{API}/dev/lobbies/{lob['id']}/complete", headers=auth_headers(host))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "LOBBY_CLOSED"
