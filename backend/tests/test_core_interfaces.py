"""Cross-module interfaces used by the weather/bench/highlights modules."""

import uuid

from sqlalchemy import event, select

from app.core.database import engine
from app.core.events import _handlers, on
from app.modules.bookings.models import Booking
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.models import Lobby
from app.modules.slots import service as slots
from app.modules.slots.models import Slot
from app.modules.wallet.models import WalletTransaction
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, lobby, make_slot, make_venue, pay


async def _confirmed_lobby(client, db, make_user, *, price=100_000):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=price)
    slot = await make_slot(db, pitch, hours_ahead=20)
    lob = (await book(client, host, slot, total_spots=2))["lobby"]
    await pay(client, host, lob["id"])
    await join(client, p1, lob["id"])
    await pay(client, p1, lob["id"])
    assert (await lobby(client, host, lob["id"]))["status"] == "confirmed"
    return host, p1, slot, lob


async def test_transfer_to_indoor_slot(client, db, make_user):
    host, _, old_slot, lob = await _confirmed_lobby(client, db, make_user)
    indoor_turf, indoor_pitch = await make_venue(db, indoor=True, price=120_000, name="Dry Dome")
    new_slot = await make_slot(db, indoor_pitch, hours_ahead=20)
    events = []

    async def record(db, **payload):
        events.append(payload)

    on("lobby.transferred")(record)
    try:
        lobby_row = await lobbies.get_lobby(db, uuid.UUID(lob["id"]))
        locked = await slots.lock_slot(db, new_slot.id)
        released = await lobbies.transfer_to_slot(db, lobby_row, locked)
        await db.commit()
    finally:
        _handlers["lobby.transferred"].remove(record)

    assert released.id == old_slot.id
    assert events == [{"lobby_id": uuid.UUID(lob["id"]), "old_slot_id": old_slot.id, "new_slot_id": new_slot.id}]
    detail = await lobby(client, host, lob["id"])
    assert detail["turf"]["slug"] == indoor_turf.slug and detail["pitch"]["is_indoor"] is True
    assert detail["status"] == "confirmed" and detail["share_paise"] == lob["share_paise"]
    new_booking = await db.get(Booking, uuid.UUID(detail["booking"]["id"]))
    assert new_booking.transferred_from_id == uuid.UUID(lob["booking"]["id"])
    assert detail["booking"]["transferred_from_id"] == lob["booking"]["id"]
    statuses = {s.id: s.status for s in (await db.scalars(
        select(Slot).execution_options(populate_existing=True))).all()}
    assert statuses[old_slot.id] == "available" and statuses[new_slot.id] == "booked"


async def test_rain_check_cancel_with_bonus(client, db, make_user):
    host, p1, slot, lob = await _confirmed_lobby(client, db, make_user)
    lobby_row = await lobbies.get_lobby(db, uuid.UUID(lob["id"]))
    refunded = await lobbies.cancel_lobby(db, lobby_row, refund_kind="rain_check", bonus_paise=2_500,
                                          note="Rain-check by the host")
    await db.commit()
    assert refunded == 100_000
    rows = (await db.scalars(select(WalletTransaction).where(WalletTransaction.user_id == p1.id))).all()
    assert sorted((t.kind, t.amount_paise) for t in rows) == [("bonus", 2_500), ("rain_check", 50_000)]
    detail = await lobby(client, host, lob["id"])
    assert detail["status"] == "cancelled" and detail["booking"]["status"] == "cancelled"
    await db.refresh(slot)
    assert slot.status == "available"


async def test_lobby_summaries_batch(client, db, make_user):
    host = await make_user("Host")
    _, pitch = await make_venue(db)
    for h in (20, 21, 22):
        await book(client, host, await make_slot(db, pitch, hours_ahead=h), total_spots=4)
    db.expunge_all()
    rows = (await db.execute(select(Lobby).order_by(Lobby.start_at))).unique().scalars().all()
    summaries = await lobbies.lobby_summaries(db, rows, lat=9.98, lng=76.30)
    assert [s.filled_spots for s in summaries] == [1, 1, 1]
    assert all(s.distance_km is not None and s.host.name == "Host" for s in summaries)


async def test_list_endpoints_have_constant_query_count(client, db, make_user):
    """Feed / mine / turf list issue the same number of queries for 2 or 6 rows (no N+1)."""
    host, viewer = await make_user("Host"), await make_user("Viewer")
    _, pitch = await make_venue(db)
    others = [await make_user(f"P{i}") for i in range(6)]

    async def count_queries(path: str, user) -> int:
        statements: list[str] = []

        def before(conn, cursor, statement, *args):
            statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", before)
        try:
            resp = await client.get(f"{API}{path}", headers=auth_headers(user))
            assert resp.status_code == 200, resp.text
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", before)
        return len(statements)

    async def add_lobbies(n: int, start: int) -> None:
        for i in range(n):
            lob = (await book(client, host, await make_slot(db, pitch, hours_ahead=start + i), total_spots=8))["lobby"]
            await join(client, others[i % len(others)], lob["id"])

    await add_lobbies(2, 10)
    small = [await count_queries("/lobbies", viewer), await count_queries("/lobbies/mine", host),
             await count_queries("/turfs", viewer)]
    await add_lobbies(4, 20)
    large = [await count_queries("/lobbies", viewer), await count_queries("/lobbies/mine", host),
             await count_queries("/turfs", viewer)]
    assert small == large, (small, large)
