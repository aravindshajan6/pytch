"""Booking concurrency, validation, discovery (turfs), slot grids and slot generation."""

import asyncio
from datetime import timedelta

from sqlalchemy import func, select

from app.core.timeutils import IST, ist_today
from app.modules.lobbies.models import Lobby
from app.modules.slots.jobs import generate_rolling_slots
from app.modules.slots.models import Slot
from app.modules.slots.service import generate_slots_for_pitch
from tests.conftest import auth_headers
from tests.core_helpers import API, book, make_slot, make_venue


async def test_concurrent_bookings_exactly_one_wins(client, db, make_user):
    a, b = await make_user("Alpha"), await make_user("Beta")
    _, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    body = {"slot_id": str(slot.id), "mode": "split", "total_spots": 4, "visibility": "public"}

    r1, r2 = await asyncio.gather(
        client.post(f"{API}/bookings", json=body, headers=auth_headers(a)),
        client.post(f"{API}/bookings", json=body, headers=auth_headers(b)),
    )
    statuses = sorted([r1.status_code, r2.status_code])
    assert statuses == [201, 409], (r1.text, r2.text)
    loser = r1 if r1.status_code == 409 else r2
    assert loser.json()["error"]["code"] in ("SLOT_LOCKED", "SLOT_UNAVAILABLE")
    assert await db.scalar(select(func.count()).select_from(Lobby)) == 1

    # a later attempt sees the hold
    again = await client.post(f"{API}/bookings", json=body, headers=auth_headers(b))
    assert again.status_code == 409 and again.json()["error"]["code"] == "SLOT_UNAVAILABLE"


async def test_many_concurrent_bookings_single_winner(client, db, make_user):
    users = [await make_user(f"P{i}") for i in range(6)]
    _, pitch = await make_venue(db)
    slot = await make_slot(db, pitch)
    body = {"slot_id": str(slot.id), "mode": "full", "total_spots": 6, "visibility": "public"}
    results = await asyncio.gather(
        *(client.post(f"{API}/bookings", json=body, headers=auth_headers(u)) for u in users)
    )
    assert [r.status_code for r in results].count(201) == 1
    losers = [r.json()["error"]["code"] for r in results if r.status_code != 201]
    assert set(losers) <= {"SLOT_LOCKED", "SLOT_UNAVAILABLE"}


async def test_booking_validation(client, db, make_user):
    host = await make_user()
    _, pitch = await make_venue(db, capacity=10, camera=False)
    slot = await make_slot(db, pitch)
    too_many = await client.post(f"{API}/bookings", json={"slot_id": str(slot.id), "mode": "split",
                                                           "total_spots": 15, "visibility": "public"},
                                 headers=auth_headers(host))
    assert too_many.status_code == 422 and too_many.json()["error"]["code"] == "VALIDATION_ERROR"
    no_cam = await client.post(f"{API}/bookings", json={"slot_id": str(slot.id), "mode": "split", "total_spots": 4,
                                                         "visibility": "public", "recorded": True},
                               headers=auth_headers(host))
    assert no_cam.status_code == 422
    past = await make_slot(db, pitch, hours_ahead=-2)
    started = await client.post(f"{API}/bookings", json={"slot_id": str(past.id), "mode": "split", "total_spots": 4,
                                                          "visibility": "public"}, headers=auth_headers(host))
    assert started.status_code == 409 and started.json()["error"]["code"] == "SLOT_UNAVAILABLE"


async def test_recorded_booking_fees_and_booking_endpoints(client, db, make_user):
    host, other = await make_user("Host"), await make_user("Other")
    _, pitch = await make_venue(db, camera=True, camera_price=30_000, price=150_000)
    slot = await make_slot(db, pitch)
    created = await book(client, host, slot, total_spots=4, recorded=True, mode="full")
    booking = created["booking"]
    assert booking["recording_fee_paise"] == 30_000 and booking["total_paise"] == 180_000
    assert created["lobby"]["share_paise"] == 45_000 and created["lobby"]["recorded"] is True
    assert created["lobby"]["my_membership"]["share_paise"] == 180_000  # host fronts the total in full mode

    got = await client.get(f"{API}/bookings/{booking['id']}", headers=auth_headers(host))
    assert got.status_code == 200 and got.json()["code"].startswith("PY-")
    hidden = await client.get(f"{API}/bookings/{booking['id']}", headers=auth_headers(other))
    assert hidden.status_code == 404

    not_host = await client.post(f"{API}/bookings/{booking['id']}/cancel", headers=auth_headers(other))
    assert not_host.status_code in (403, 404)
    cancelled = await client.post(f"{API}/bookings/{booking['id']}/cancel", headers=auth_headers(host))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    await db.refresh(slot)
    assert slot.status == "available"


async def test_cancel_confirmed_too_late(client, db, make_user):
    host = await make_user("Host")
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch, hours_ahead=3)
    created = await book(client, host, slot, total_spots=2, mode="full")
    intent = (await client.post(f"{API}/lobbies/{created['lobby']['id']}/pay", json={"use_credits": False},
                                headers=auth_headers(host))).json()
    assert intent["purpose"] == "full" and intent["amount_paise"] == 100_000
    await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete", json={"outcome": "success"},
                      headers=auth_headers(host))
    resp = await client.post(f"{API}/bookings/{created['booking']['id']}/cancel", headers=auth_headers(host))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "TOO_LATE"


async def test_turf_discovery_and_slot_grid(client, db, make_user, monkeypatch):
    async def fake_forecast(pitch, slots):
        return {s.id: {"time": s.start_at, "temperature_c": 28.5, "precipitation_probability": 70,
                       "precipitation_mm": 3.2, "weather_code": 63, "is_risky": True} for s in slots}

    monkeypatch.setattr("app.modules.weather.service.forecast_for_slots", fake_forecast)
    host = await make_user("Host")
    near, near_pitch = await make_venue(db, lat=9.9975, lng=76.2926, name="Kaloor Kickoff", price=120_000)
    far, _ = await make_venue(db, lat=10.1076, lng=76.3516, name="Aluva Arena", price=90_000, indoor=True,
                              sport="badminton", fmt="doubles", capacity=4)
    slot = await make_slot(db, near_pitch, hours_ahead=30)
    await book(client, host, slot, total_spots=4)

    page = (await client.get(f"{API}/turfs", params={"lat": 9.9975, "lng": 76.2926})).json()
    assert page["total"] == 2 and page["items"][0]["slug"] == near.slug
    first = page["items"][0]
    assert first["distance_km"] < 0.1 and first["open_lobbies_count"] == 1 and first["sports"] == ["football"]
    assert first["has_outdoor"] and not first["has_indoor"] and first["min_price_per_hour_paise"] == 120_000

    by_price = (await client.get(f"{API}/turfs", params={"sort": "price"})).json()
    assert by_price["items"][0]["slug"] == far.slug and by_price["items"][0]["distance_km"] is None
    indoor = (await client.get(f"{API}/turfs", params={"indoor": "true"})).json()
    assert [t["slug"] for t in indoor["items"]] == [far.slug]
    q = (await client.get(f"{API}/turfs", params={"q": "kickoff"})).json()
    assert [t["slug"] for t in q["items"]] == [near.slug]
    radius = (await client.get(f"{API}/turfs", params={"lat": 9.9975, "lng": 76.2926, "radius_km": 5})).json()
    assert radius["total"] == 1

    detail = (await client.get(f"{API}/turfs/{near.slug}")).json()
    assert detail["open_time"] == "06:00" and len(detail["pitches"]) == 1
    assert (await client.get(f"{API}/turfs/nope")).status_code == 404

    day = slot.start_at.astimezone(IST).date()
    grid = (await client.get(f"{API}/pitches/{near_pitch.id}/slots", params={"date": str(day)})).json()
    assert [s["status"] for s in grid] == ["held"] and grid[0]["open_lobby_id"]
    assert grid[0]["weather"]["precipitation_probability"] == 70 and grid[0]["weather"]["is_risky"] is True
    slot_detail = (await client.get(f"{API}/slots/{slot.id}")).json()
    assert slot_detail["slot"]["open_lobby_id"] and slot_detail["turf"]["slug"] == near.slug


async def test_slot_generation_is_idempotent(db):
    _, pitch = await make_venue(db, price=100_000, peak_price=150_000)
    created = await generate_slots_for_pitch(db, pitch, days=3)
    await db.commit()
    assert 17 * 2 <= created <= 17 * 3  # 06:00–23:00 → 17 hourly slots/day (today's past hours skipped)
    assert await generate_slots_for_pitch(db, pitch, days=3) == 0
    assert await generate_rolling_slots(db) > 0  # extends to the 14-day horizon

    tomorrow = ist_today() + timedelta(days=1)
    rows = (await db.scalars(select(Slot).where(Slot.pitch_id == pitch.id).order_by(Slot.start_at))).all()
    tomorrow_rows = [s for s in rows if s.start_at.astimezone(IST).date() == tomorrow]
    assert len(tomorrow_rows) == 17
    for s in tomorrow_rows:
        local = s.start_at.astimezone(IST)
        peak = local.weekday() >= 5 or 17 <= local.hour < 22
        assert s.is_peak == peak and s.price_paise == (150_000 if peak else 100_000)
    assert tomorrow_rows[0].start_at.astimezone(IST).hour == 6
