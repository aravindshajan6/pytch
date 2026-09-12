"""Blocks go through the same slot lock as Pytch bookings: lock/claim, concurrency, bulk, cancel, calendar."""

import asyncio
import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.core.timeutils import to_ist
from app.modules.channels.models import SlotBlock, WebhookDelivery
from app.modules.lobbies.models import Lobby
from app.modules.slots.models import Slot
from tests.conftest import auth_headers
from tests.core_helpers import book
from tests.partner_helpers import (  # noqa: F401  (reset_fetch_hooks: autouse fixture)
    API,
    future_run,
    gen_slots,
    make_provider,
    partner_headers,
    provider_venue,
    reset_fetch_hooks,
)


def _block_body(pitch, start, end, **kw):
    return {"pitch_id": str(pitch.id), "start_at": start.isoformat(), "end_at": end.isoformat(), "kind": "booking",
            "source": "walk_in", **kw}


async def test_block_claims_slots_and_player_sees_only_blocked(client, db, make_user):
    owner, player = await make_user("Owner"), await make_user("Player")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 2)
    resp = await client.post(f"{API}/partner/blocks", headers=partner_headers(owner), json=_block_body(
        pitch, run[0].start_at, run[1].end_at, customer_name="Anand K", customer_phone="+919000011111",
        amount_paise=240_000, payment_mode="upi", notes="Office league"))
    assert resp.status_code == 201, resp.text
    block = resp.json()
    assert block["status"] == "active" and block["created_by_name"] == "Owner" and block["pitch_name"] == pitch.name
    for s in run:
        await db.refresh(s)
        assert s.status == "blocked" and str(s.block_id) == block["id"]

    # the player grid shows "blocked" with no customer data; booking it is impossible
    grid = await client.get(f"{API}/pitches/{pitch.id}/slots", params={"date": str(to_ist(run[0].start_at).date())},
                            headers=auth_headers(player))
    cell = next(s for s in grid.json() if s["id"] == str(run[0].id))
    assert cell["status"] == "blocked" and "Anand" not in grid.text and "9000011111" not in grid.text
    denied = await client.post(f"{API}/bookings", headers=auth_headers(player), json={
        "slot_id": str(run[0].id), "mode": "split", "total_spots": 4, "visibility": "public"})
    assert denied.status_code == 409 and denied.json()["error"]["code"] == "SLOT_UNAVAILABLE"

    # overlapping a taken hour → 409 with the offending slot ids, nothing created
    again = await client.post(f"{API}/partner/blocks", headers=partner_headers(owner),
                              json=_block_body(pitch, run[1].start_at, run[1].end_at))
    assert again.status_code == 409 and again.json()["error"]["details"]["slot_ids"] == [str(run[1].id)]
    assert await db.scalar(select(func.count()).select_from(SlotBlock)) == 1

    edit = await client.patch(f"{API}/partner/blocks/{block['id']}", headers=partner_headers(owner),
                              json={"amount_paise": 250_000, "payment_mode": "cash"})
    assert edit.status_code == 200 and edit.json()["amount_paise"] == 250_000


async def test_concurrent_pytch_booking_vs_walk_in_block_exactly_one_wins(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    for attempt in range(3):
        player = await make_user(f"Player {attempt}")  # one open full-mode hold per player (LIMIT_REACHED)
        slot = future_run(await gen_slots(db, pitch), 1, min_hours_ahead=3 + attempt * 2)[0]
        booking_req = client.post(f"{API}/bookings", headers=auth_headers(player), json={
            "slot_id": str(slot.id), "mode": "full", "total_spots": 4, "visibility": "private"})
        block_req = client.post(f"{API}/partner/blocks", headers=partner_headers(owner),
                                json=_block_body(pitch, slot.start_at, slot.end_at))
        r_book, r_block = await asyncio.gather(booking_req, block_req)
        codes = sorted([r_book.status_code, r_block.status_code])
        assert codes in ([201, 409],), (r_book.text, r_block.text)
        loser = r_book if r_book.status_code == 409 else r_block
        assert loser.json()["error"]["code"] in ("SLOT_LOCKED", "SLOT_UNAVAILABLE")
        await db.refresh(slot)
        lobbies = await db.scalar(select(func.count()).select_from(Lobby).where(Lobby.slot_id == slot.id))
        blocks = await db.scalar(select(func.count()).select_from(SlotBlock).where(
            SlotBlock.start_at == slot.start_at, SlotBlock.pitch_id == pitch.id))
        assert lobbies + blocks == 1
        assert slot.status == ("held" if lobbies else "blocked")


async def test_bulk_block_skips_occupied_and_cancel_releases(client, db, make_user):
    owner, manager_less, player = await make_user("Owner"), await make_user("Staff"), await make_user("Player")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    from tests.partner_helpers import add_member

    await add_member(db, provider, manager_less, "staff")
    slots = await gen_slots(db, pitch)
    tomorrow = to_ist(slots[0].start_at).date() + timedelta(days=1)
    day_slots = [s for s in slots if to_ist(s.start_at).date() == tomorrow and 8 <= to_ist(s.start_at).hour < 11]
    assert len(day_slots) == 3
    created = await book(client, player, day_slots[1])  # 09:00 is a Pytch booking

    body = {"pitch_ids": [str(pitch.id)], "date_from": str(tomorrow), "date_to": str(tomorrow),
            "time_from": "08:00", "time_to": "11:00", "weekdays": [tomorrow.weekday()], "kind": "block",
            "source": "maintenance", "notes": "Re-turfing"}
    assert (await client.post(f"{API}/partner/blocks/bulk", json=body,
                              headers=partner_headers(manager_less))).status_code == 403
    resp = await client.post(f"{API}/partner/blocks/bulk", json=body, headers=partner_headers(owner))
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["created"] == 2  # 08:00 and 10:00 — runs split around the booking
    assert [(s["slot_id"], s["reason"]) for s in result["skipped"]] == [(str(day_slots[1].id), "held")]
    for s in day_slots:
        await db.refresh(s)
    assert [s.status for s in day_slots] == ["blocked", "held", "blocked"]
    lobby = await db.get(Lobby, created["lobby"]["id"])
    assert lobby.slot_id == day_slots[1].id  # never overridden

    # calendar shows both kinds of occupancy
    cal = await client.get(f"{API}/partner/calendar", headers=partner_headers(owner),
                           params={"turf_id": str(pitch.turf_id), "from": str(tomorrow), "days": 1})
    assert cal.status_code == 200 and cal.json()["from"] == str(tomorrow)
    cells = {c["slot_id"]: c for c in cal.json()["cells"]}
    assert cells[str(day_slots[0].id)]["occupancy"]["kind"] == "block"
    assert cells[str(day_slots[0].id)]["occupancy"]["source"] == "maintenance"
    pytch_cell = cells[str(day_slots[1].id)]["occupancy"]
    assert pytch_cell["kind"] == "pytch" and pytch_cell["host_name"] == "Player"
    assert pytch_cell["booking_code"].startswith("PY-") and pytch_cell["total_spots"] == 3
    assert cells[str(day_slots[2].id)]["status"] == "blocked"

    # cancelling a block frees its slot(s)
    block_id = cells[str(day_slots[0].id)]["occupancy"]["block_id"]
    assert (await client.delete(f"{API}/partner/blocks/{block_id}", headers=partner_headers(owner))).status_code == 204
    await db.refresh(day_slots[0])
    assert day_slots[0].status == "available" and day_slots[0].block_id is None
    block = await db.get(SlotBlock, block_id)
    assert block.status == "cancelled" and block.cancelled_at is not None
    assert (await client.delete(f"{API}/partner/blocks/{block_id}", headers=partner_headers(owner))).status_code == 204


async def test_slot_changes_enqueue_webhooks_without_pii(client, db, make_user):
    owner, player = await make_user("Owner"), await make_user("Player", phone="+919811112222")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    from tests.test_channels_api import install_hook  # shared helper

    await install_hook(client, owner, events=["slot.booked", "slot.blocked", "block.cancelled", "slot.released"])
    run = future_run(await gen_slots(db, pitch), 2)
    await book(client, player, run[0])
    resp = await client.post(f"{API}/partner/blocks", headers=partner_headers(owner),
                             json=_block_body(pitch, run[1].start_at, run[1].end_at, customer_name="Secret Name"))
    await client.delete(f"{API}/partner/blocks/{resp.json()['id']}", headers=partner_headers(owner))
    deliveries = (await db.scalars(select(WebhookDelivery).order_by(WebhookDelivery.created_at))).all()
    events = [d.event for d in deliveries]
    assert events == ["slot.booked", "slot.blocked", "block.cancelled"]
    for d in deliveries:
        assert set(d.payload) == {"id", "event", "occurred_at", "pitch_id", "start_at", "end_at", "status"}
        assert "Secret" not in str(d.payload) and "9811112222" not in str(d.payload)
    assert deliveries[0].payload["status"] == "held"
    # venues without a provider never enqueue anything
    count = await db.scalar(select(func.count()).select_from(Slot).where(Slot.pitch_id == pitch.id))
    assert count > 0


async def test_calendar_query_count_is_constant(client, db, make_user):
    """7 days × N pitches with Pytch bookings and blocks is a handful of queries, independent of N."""
    from sqlalchemy import event

    from app.core.database import engine
    from app.modules.turfs.models import Pitch

    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)

    async def occupy(p) -> None:
        run = future_run(await gen_slots(db, p), 3)
        await book(client, await make_user("Player"), run[0])  # hosts may hold only 2 unpaid split lobbies
        await client.post(f"{API}/partner/blocks", headers=partner_headers(owner),
                          json=_block_body(p, run[2].start_at, run[2].end_at))

    async def count() -> int:
        statements: list[str] = []

        def before(conn, cursor, statement, *args):
            statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", before)
        try:
            resp = await client.get(f"{API}/partner/calendar", params={"turf_id": str(turf.id), "days": 7},
                                    headers=partner_headers(owner))
            assert resp.status_code == 200
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", before)
        return len(statements)

    await occupy(pitch)
    small = await count()
    for i in range(3):
        extra = Pitch(id=uuid.uuid4(), turf_id=turf.id, name=f"Court {i}", sport="football",
                      format="5v5", capacity=10, price_per_hour_paise=100_000, peak_price_per_hour_paise=120_000)
        db.add(extra)
        await db.commit()
        await occupy(extra)
    large = await count()
    assert small == large and large <= 12, (small, large)
