"""Factories + flow helpers for the core (booking/lobby/payment) tests."""

import uuid
from datetime import time, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import utcnow
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User
from tests.conftest import auth_headers

API = "/api/v1"


async def make_venue(
    db: AsyncSession,
    *,
    sport: str = "football",
    fmt: str = "5v5",
    capacity: int = 10,
    price: int = 150_000,
    peak_price: int = 180_000,
    camera: bool = False,
    camera_price: int = 30_000,
    indoor: bool = False,
    lat: float = 9.9816,
    lng: float = 76.2999,
    name: str | None = None,
) -> tuple[Turf, Pitch]:
    suffix = uuid.uuid4().hex[:6]
    turf = Turf(
        id=uuid.uuid4(), slug=f"arena-{suffix}", name=name or f"Arena {suffix}", area="Kaloor",
        address="1 Stadium Rd, Kochi", lat=lat, lng=lng, amenities=["Parking"], photos=[],
        open_time=time(6, 0), close_time=time(23, 0), rating_avg=4.4, rating_count=12,
    )
    pitch = Pitch(
        id=uuid.uuid4(), turf_id=turf.id, name="Pitch 1", sport=sport, format=fmt, capacity=capacity,
        is_indoor=indoor, has_camera=camera, camera_price_paise=camera_price if camera else 0,
        price_per_hour_paise=price, peak_price_per_hour_paise=peak_price,
    )
    db.add_all([turf, pitch])
    await db.commit()
    return turf, pitch


async def make_slot(db: AsyncSession, pitch: Pitch, *, hours_ahead: float = 24, price: int | None = None) -> Slot:
    start = (utcnow() + timedelta(hours=hours_ahead)).replace(minute=0, second=0, microsecond=0)
    slot = Slot(
        id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
        price_paise=price if price is not None else pitch.price_per_hour_paise, is_peak=False, status="available",
    )
    db.add(slot)
    await db.commit()
    return slot


async def book(client: AsyncClient, host: User, slot: Slot, **overrides) -> dict:
    body = {"slot_id": str(slot.id), "mode": "split", "total_spots": 3, "visibility": "public", **overrides}
    resp = await client.post(f"{API}/bookings", json=body, headers=auth_headers(host))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def join(client: AsyncClient, user: User, lobby_id: str) -> dict:
    resp = await client.post(f"{API}/lobbies/{lobby_id}/join", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def pay(
    client: AsyncClient, user: User, lobby_id: str, *, use_credits: bool = True, complete: bool = True
) -> dict:
    """Create an intent; if it needs the mock sheet, complete it successfully. Returns the intent."""
    resp = await client.post(f"{API}/lobbies/{lobby_id}/pay", json={"use_credits": use_credits},
                             headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    intent = resp.json()
    if complete and intent["status"] == "created":
        done = await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete",
                                 json={"outcome": "success"}, headers=auth_headers(user))
        assert done.status_code == 200, done.text
        intent["status"] = done.json()["status"]
    return intent


async def lobby(client: AsyncClient, user: User, lobby_id: str) -> dict:
    resp = await client.get(f"{API}/lobbies/{lobby_id}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def wallet(client: AsyncClient, user: User) -> dict:
    resp = await client.get(f"{API}/wallet", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()
