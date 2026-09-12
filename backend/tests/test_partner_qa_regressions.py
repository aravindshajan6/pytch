"""Regressions from the partner-portal QA pass (FUNC6-*): payout-account change visibility, provider-specific
alerts, switched-off pitches on the calendar, clashing imports that hold no slot, conflict wording + auto-close,
dashboard/earnings periods, closures & phone search in the bookings list, bulk-block labels, own display name,
team scope validation, venue phone normalisation."""

import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.core.timeutils import to_ist, utcnow
from app.modules.audit.models import AuditLog
from app.modules.bookings.models import Booking
from app.modules.channels.models import SlotBlock, SyncConflict
from app.modules.channels.service import sync_feed
from app.modules.lobbies.models import Lobby
from app.modules.notifications.models import Notification
from app.modules.partner.finance import estimate_net
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
from tests.test_channels_ical import _feed, _ics


def _block(pitch, slot, **kw) -> dict:
    return {"pitch_id": str(pitch.id), "start_at": slot.start_at.isoformat(), "end_at": slot.end_at.isoformat(),
            "kind": "booking", "source": "walk_in", **kw}


async def test_bank_change_is_visible_and_dashboard_alerts_are_provider_specific(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner, name="Approved Co")
    provider.bank_account_name, provider.bank_ifsc, provider.bank_account_last4 = "Old Name", "SBIN0000001", "1111"
    await db.commit()
    await make_provider(db, owner, status="pending", name="Second Venture")  # another business, still in review
    h = partner_headers(owner, provider.id)

    before = (await client.get(f"{API}/partner/provider", headers=h)).json()
    assert before["payouts_on_hold"] is False and before["pending_bank_change"] is None
    alerts = (await client.get(f"{API}/partner/dashboard", headers=h)).json()["alerts"]
    # the *other* business's application is not "a change waiting for approval" here
    assert (alerts["pending_application"], alerts["pending_bank_change"], alerts["payouts_on_hold"]) == (
        False, False, False)

    resp = await client.patch(f"{API}/partner/provider", headers=h, json={
        "bank_account_name": "New Name", "bank_ifsc": "hdfc0009999", "bank_account_last4": "2222"})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["bank_account_last4"] == "1111" and out["payouts_on_hold"] is True  # old account until approved
    pending = out["pending_bank_change"]
    assert {k: pending[k] for k in ("account_name", "ifsc", "last4")} == {
        "account_name": "New Name", "ifsc": "HDFC0009999", "last4": "2222"}
    assert pending["requested_at"] and set(pending) == {"account_name", "ifsc", "last4", "requested_at"}
    again = (await client.get(f"{API}/partner/provider", headers=h)).json()
    assert again["pending_bank_change"]["last4"] == "2222"  # survives a reload
    alerts = (await client.get(f"{API}/partner/dashboard", headers=h)).json()["alerts"]
    assert alerts["pending_bank_change"] is True and alerts["payouts_on_hold"] is True
    assert alerts["pending_application"] is False


async def test_switched_off_pitch_keeps_its_bookings_on_the_calendar(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 2)
    await book(client, host, run[0], title="Sunday league")
    h = partner_headers(owner)
    idle = await client.post(f"{API}/partner/venues/{turf.id}/pitches", headers=h, json={
        "name": "Court Z", "sport": "football", "format": "5v5", "capacity": 10, "price_per_hour_paise": 100_000,
        "peak_price_per_hour_paise": 120_000})
    assert idle.status_code == 201, idle.text

    venue = (await client.get(f"{API}/partner/venues", headers=h)).json()[0]
    counts = {p["id"]: p["upcoming_bookings"] for p in venue["pitches"]}
    assert counts == {str(pitch.id): 1, idle.json()["id"]: 0}  # the manager is warned before switching it off

    for pid in (pitch.id, idle.json()["id"]):
        assert (await client.patch(f"{API}/partner/pitches/{pid}", headers=h,
                                   json={"is_active": False})).status_code == 200
    day = str(to_ist(run[0].start_at).date())
    cal = (await client.get(f"{API}/partner/calendar", headers=h,
                            params={"turf_id": str(turf.id), "from": day, "days": 1})).json()
    assert [(p["id"], p["is_active"]) for p in cal["pitches"]] == [(str(pitch.id), False)]  # idle pitch: hidden
    assert {c["slot_id"] for c in cal["cells"]} == {str(run[0].id)}  # booked cells only — nothing bookable
    assert cal["cells"][0]["occupancy"]["lobby_title"] == "Sunday league"


async def test_clashing_import_holds_nothing_and_conflicts_explain_and_close_themselves(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 2)
    feed = await _feed(db, provider, pitch)  # tags imports as Playo
    created = await book(client, host, run[0], title="Friday Fives")  # forming: players still paying
    h = partner_headers(owner)
    walk_in = await client.post(f"{API}/partner/blocks", headers=h,
                                json=_block(pitch, run[1], customer_name="Anand", amount_paise=90_000))
    assert walk_in.status_code == 201, walk_in.text
    body = _ics(("clash-pytch", run[0].start_at, run[0].end_at, ""), ("clash-walkin", run[1].start_at,
                                                                      run[1].end_at, ""))
    await sync_feed(db, feed, body=body)

    blocks = {b.external_ref.split(":", 1)[1]: b for b in (await db.scalars(
        select(SlotBlock).where(SlotBlock.feed_id == feed.id))).all()}
    assert {k: b.status for k, b in blocks.items()} == {"clash-pytch": "conflicted", "clash-walkin": "conflicted"}

    # FUNC6-05: the card/alert says what actually holds the slot
    conflicts = {c["external_ref"].split(":", 1)[1]: c for c in (await client.get(
        f"{API}/partner/channels/conflicts", params={"status": "open"}, headers=h)).json()}
    pytch_side, walkin_side = conflicts["clash-pytch"], conflicts["clash-walkin"]
    assert (pytch_side["holder_kind"], pytch_side["lobby_status"], pytch_side["holder_label"]) == (
        "pytch", "forming", "Friday Fives")
    assert (walkin_side["holder_kind"], walkin_side["holder_source"], walkin_side["holder_label"],
            walkin_side["lobby_status"]) == ("block", "walk_in", "Walk-in booking", None)
    bodies = sorted((await db.scalars(select(Notification.body).where(Notification.type == "sync_conflict"))).all())
    assert len(bodies) == 2
    assert any("still holds the slot while its players pay" in b for b in bodies)
    assert any("walk-in booking logged first keeps the slot" in b for b in bodies)
    assert not any("confirmed" in b for b in bodies)

    # FUNC6-03: the losing imports are not bookings anywhere
    page = (await client.get(f"{API}/partner/bookings", headers=h)).json()
    assert page["total"] == 2 and {r["source"] for r in page["items"]} == {"pytch", "walk_in"}
    assert "Playo" not in (await client.get(f"{API}/partner/bookings/export.csv", headers=h)).text
    day = str(to_ist(run[0].start_at).date())
    earnings = (await client.get(f"{API}/partner/earnings", params={"from": day, "to": day}, headers=h)).json()
    assert earnings["by_turf"][0]["bookings"] == 1 and earnings["offline_revenue_paise"] == 90_000
    dash = (await client.get(f"{API}/partner/dashboard", headers=h)).json()
    assert {e["source"] for e in dash["upcoming"]} == {"pytch", "walk_in"} and dash["alerts"]["open_conflicts"] == 2
    cal = (await client.get(f"{API}/partner/calendar", headers=h,
                            params={"turf_id": str(turf.id), "from": day, "days": 1})).json()
    flagged = {c["slot_id"]: c for c in cal["cells"] if c["has_conflict"]}
    assert set(flagged) == {str(run[0].id), str(run[1].id)}
    assert flagged[str(run[1].id)]["occupancy"]["source"] == "walk_in"  # the real booking, not the import

    # FUNC6-06: the walk-in is cancelled → its conflict closes itself and the next sync gives the hour to the import
    assert (await client.delete(f"{API}/partner/blocks/{walk_in.json()['id']}", headers=h)).status_code == 204
    closed = await db.get(SyncConflict, uuid.UUID(walkin_side["id"]))
    await db.refresh(closed)
    assert closed.status == "obsolete" and closed.resolved_at is not None
    await sync_feed(db, feed, body=body)
    await db.refresh(blocks["clash-walkin"])
    await db.refresh(run[1])
    assert blocks["clash-walkin"].status == "active" and run[1].block_id == blocks["clash-walkin"].id

    # … and the Pytch game is cancelled → that conflict closes too (the dashboard stops counting it)
    cancelled = await client.post(f"{API}/bookings/{created['booking']['id']}/cancel", headers=auth_headers(host))
    assert cancelled.status_code == 200, cancelled.text
    other = await db.get(SyncConflict, uuid.UUID(pytch_side["id"]))
    await db.refresh(other)
    assert other.status == "obsolete"
    assert (await client.get(f"{API}/partner/dashboard", headers=h)).json()["alerts"]["open_conflicts"] == 0
    resolve = await client.post(f"{API}/partner/channels/conflicts/{other.id}/resolve", headers=h,
                                json={"resolution": "kept_pytch"})
    assert resolve.status_code == 409


async def test_disconnecting_a_feed_closes_its_conflicts(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 1)
    feed = await _feed(db, provider, pitch)
    await book(client, host, run[0])
    await sync_feed(db, feed, body=_ics(("clash", run[0].start_at, run[0].end_at, "")))
    conflict = (await db.scalars(select(SyncConflict))).one()
    assert conflict.status == "open"

    assert (await client.delete(f"{API}/partner/channels/feeds/{feed.id}",
                                headers=partner_headers(owner))).status_code == 204
    await db.refresh(conflict)
    assert conflict.status == "obsolete" and conflict.resolution_note.startswith("Auto-closed")
    block = (await db.scalars(select(SlotBlock))).one()
    await db.refresh(block)
    assert block.status == "cancelled"
    assert await db.scalar(select(func.count()).select_from(SyncConflict).where(SyncConflict.status == "open")) == 0


async def test_channel_mix_counts_the_last_30_days_only(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 1)
    past = utcnow() - timedelta(days=3)
    db.add(SlotBlock(id=uuid.uuid4(), provider_id=provider.id, pitch_id=pitch.id, start_at=past,
                     end_at=past + timedelta(hours=1), kind="booking", source="phone", status="active",
                     amount_paise=50_000))
    await db.commit()
    h = partner_headers(owner)
    assert (await client.post(f"{API}/partner/blocks", headers=h, json=_block(pitch, run[0]))).status_code == 201
    mix = {m["source"]: m["count"] for m in (await client.get(f"{API}/partner/dashboard", headers=h)).json()[
        "channel_mix"]}
    assert mix.get("phone") == 1 and "walk_in" not in mix  # tomorrow's walk-in isn't "last 30 days"


async def test_unsettled_is_only_played_games_and_upcoming_is_separate(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 3)
    played = await book(client, host, run[0])
    ahead = await book(client, host, run[2])
    fees = {}
    for created, shift in ((played, True), (ahead, False)):
        lobby = await db.get(Lobby, uuid.UUID(created["lobby"]["id"]))
        booking = await db.get(Booking, lobby.booking_id)
        booking.status, lobby.status = "confirmed", "confirmed"
        if shift:  # played three days ago (well past the settlement hold)
            lobby.start_at, lobby.end_at = utcnow() - timedelta(days=3), utcnow() - timedelta(days=3, hours=-1)
        fees[shift] = booking.pitch_fee_paise
    await db.commit()
    e = (await client.get(f"{API}/partner/earnings", headers=partner_headers(owner))).json()
    assert e["unsettled_paise"] == estimate_net(provider, fees[True])[1] > 0
    assert e["upcoming_paise"] == estimate_net(provider, fees[False])[1] > 0


async def test_bookings_hide_closures_by_default_and_search_normalises_phones(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host Player", phone="+919876543210")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 3)
    await book(client, host, run[0])
    h = partner_headers(owner)
    assert (await client.post(f"{API}/partner/blocks", headers=h, json=_block(
        pitch, run[1], customer_name="Arjun", customer_phone="+919847012345"))).status_code == 201
    assert (await client.post(f"{API}/partner/blocks", headers=h, json=_block(
        pitch, run[2], kind="block", source="maintenance", notes="Relining"))).status_code == 201

    default = (await client.get(f"{API}/partner/bookings", headers=h)).json()
    assert default["total"] == 2 and all(r["source"] != "maintenance" for r in default["items"])
    everything = (await client.get(f"{API}/partner/bookings", params={"include_closures": True},
                                   headers=h)).json()
    closure = next(r for r in everything["items"] if r["source"] == "maintenance")
    assert everything["total"] == 3 and closure["block_kind"] == "block"
    assert "Maintenance" not in (await client.get(f"{API}/partner/bookings/export.csv", headers=h)).text

    async def search(q: str) -> list[dict]:
        return (await client.get(f"{API}/partner/bookings", params={"q": q}, headers=h)).json()["items"]

    for q in ("+91 98470 12345", "98470-12345", "12345"):
        assert [r["customer_name"] for r in await search(q)] == ["Arjun"], q
    # a Pytch player's full number finds their booking — still masked in the result …
    found = await search("+91 98765 43210")
    assert [(r["kind"], r["customer_phone"]) for r in found] == [("pytch", "+91 98••• ••210")]
    # … but partial digits never do (no digit-by-digit probing of the hidden part)
    assert await search("98765") == [] and await search("76543") == []


async def test_bulk_block_reports_hours_and_what_was_in_the_way(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    slots = await gen_slots(db, pitch)
    tomorrow = to_ist(slots[0].start_at).date() + timedelta(days=1)
    day = [s for s in slots if to_ist(s.start_at).date() == tomorrow and 8 <= to_ist(s.start_at).hour < 13]
    h = partner_headers(owner)
    assert (await client.post(f"{API}/partner/blocks", headers=h, json=_block(pitch, day[2]))).status_code == 201
    resp = await client.post(f"{API}/partner/blocks/bulk", headers=h, json={
        "pitch_ids": [str(pitch.id)], "date_from": str(tomorrow), "date_to": str(tomorrow), "time_from": "08:00",
        "time_to": "13:00", "weekdays": [tomorrow.weekday()], "kind": "block", "source": "maintenance"})
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert (result["created"], result["slots"]) == (2, 4)  # 08–10 and 11–13 around the walk-in
    assert [(s["reason"], s["label"]) for s in result["skipped"]] == [("blocked", "Walk-in booking")]


async def test_partner_login_sets_its_own_name(client, db, make_user):
    user = await make_user("Player 0555", phone="+919812000555")
    await make_provider(db, user)
    h = partner_headers(user)
    me = (await client.get(f"{API}/partner/me", headers=h)).json()
    assert me["user"]["name_is_default"] is True
    resp = await client.patch(f"{API}/partner/me", headers=h, json={"name": "  Sneha   Kurian "})
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["name"] == "Sneha Kurian" and resp.json()["user"]["name_is_default"] is False
    assert (await client.patch(f"{API}/partner/me", headers=h, json={"name": "S"})).status_code == 422
    assert (await client.patch(f"{API}/partner/me", headers=h, json={"name": "x" * 81})).status_code == 422
    assert await db.scalar(select(func.count()).select_from(AuditLog).where(
        AuditLog.action == "user.update_name")) == 1


async def test_team_scope_cannot_be_empty(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    turf, _ = await provider_venue(db, provider)
    h = partner_headers(owner)
    empty = await client.post(f"{API}/partner/team", headers=h, json={"phone": "+919812345000", "role": "staff",
                                                                      "turf_ids": []})
    assert empty.status_code == 422
    ok = await client.post(f"{API}/partner/team", headers=h, json={"phone": "+919812345000", "role": "staff",
                                                                   "turf_ids": [str(turf.id)]})
    assert ok.status_code == 201 and ok.json()["turf_ids"] == [str(turf.id)]
    assert (await client.patch(f"{API}/partner/team/{ok.json()['id']}", headers=h,
                               json={"turf_ids": []})).status_code == 422
    everywhere = await client.patch(f"{API}/partner/team/{ok.json()['id']}", headers=h, json={"turf_ids": None})
    assert everywhere.status_code == 200 and everywhere.json()["turf_ids"] is None


async def test_venue_phone_accepts_dashes_and_errors_name_the_field(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    turf, _ = await provider_venue(db, provider)
    h = partner_headers(owner)
    ok = await client.patch(f"{API}/partner/venues/{turf.id}", headers=h, json={"phone": "+91-98765-43210"})
    assert ok.status_code == 200 and ok.json()["phone"] == "+919876543210"
    landline = await client.patch(f"{API}/partner/venues/{turf.id}", headers=h, json={"phone": "(0484) 234 5678"})
    assert landline.status_code == 200 and landline.json()["phone"] == "04842345678"
    bad = await client.patch(f"{API}/partner/venues/{turf.id}", headers=h, json={"phone": "call us"})
    assert bad.status_code == 422 and bad.json()["error"]["details"][0]["loc"][-1] == "phone"
