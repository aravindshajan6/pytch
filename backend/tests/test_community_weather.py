"""Weather: risk rules, Open-Meteo parsing/caching (HTTP mocked), alternatives filter, host actions, scan job."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.core.timeutils import utcnow
from app.modules.gamification.models import UserBadge
from app.modules.lobbies.models import Lobby
from app.modules.notifications.models import Notification
from app.modules.slots.models import Slot
from app.modules.weather import jobs as weather_jobs
from app.modules.weather import service as ws
from app.modules.weather.models import WeatherAlert
from tests.community_factories import KOCHI, hour_from_now, make_lobby, make_pitch, make_slot, make_users
from tests.conftest import auth_headers

API = "/api/v1"


def km_north(km: float) -> float:
    return KOCHI[0] + km / 111.32


def fake_payload(*, start: datetime, hours: int = 72, prob=10, mm=0.0, risky: set[datetime] | None = None):
    start = start.replace(minute=0, second=0, microsecond=0)
    times, probs, mms = [], [], []
    for i in range(hours):
        t = start + timedelta(hours=i)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        hot = risky is not None and t in risky
        probs.append(90 if hot else prob)
        mms.append(6.5 if hot else mm)
    return {"hourly": {"time": times, "temperature_2m": [27.5] * hours, "precipitation_probability": probs,
                       "precipitation": mms, "weather_code": [63 if p >= 60 else 2 for p in probs]}}


@pytest.fixture
def forecast(monkeypatch):
    """Replace the Open-Meteo HTTP call; records calls."""
    state = {"calls": 0, "payload": fake_payload(start=utcnow() - timedelta(hours=2)), "fail": False}

    async def fake_request(lat, lng):
        state["calls"] += 1
        if state["fail"]:
            raise TimeoutError("open-meteo timed out")
        return state["payload"]

    monkeypatch.setattr(ws, "_request_forecast", fake_request)
    return state


# ───────────────────────────── rules ─────────────────────────────
def test_risk_and_severity_thresholds():
    assert ws.is_risky(60, 0) and ws.is_risky(10, 2.0)
    assert not ws.is_risky(59, 1.9)
    assert ws.severity_for(80, 0) == "warning"
    assert ws.severity_for(10, 5.0) == "warning"
    assert ws.severity_for(65, 2.5) == "watch"
    assert "Heavy rain likely (85%)" in ws.alert_summary(85, 6.0, datetime(2026, 9, 12, 13, 30, tzinfo=UTC))
    assert "7 PM" in ws.alert_summary(85, 6.0, datetime(2026, 9, 12, 13, 30, tzinfo=UTC))  # IST


def test_window_aggregates_overlapping_buckets():
    base = datetime(2026, 9, 12, 13, 0, tzinfo=UTC)
    hours = [
        {"t": (base + timedelta(hours=i)).isoformat(), "temp": 26 + i, "p": p, "mm": mm, "code": c}
        for i, (p, mm, c) in enumerate([(20, 0.0, 2), (70, 3.1, 63), (10, 0.0, 1)])
    ]
    # IST 19:00–20:00 slot = 13:30–14:30 UTC → buckets 13:00 and 14:00
    hw = ws.window_weather(hours, base + timedelta(minutes=30), base + timedelta(minutes=90))
    assert hw.precipitation_probability == 70 and hw.precipitation_mm == 3.1 and hw.weather_code == 63
    assert hw.is_risky and hw.temperature_c == pytest.approx(26.5)
    assert ws.window_weather(hours, base + timedelta(days=3), base + timedelta(days=3, hours=1)) is None


async def test_forecast_cache_and_graceful_failure(forecast):
    first = await ws.hourly_forecast(9.981, 76.299)
    second = await ws.hourly_forecast(9.9812, 76.2991)  # same 2-dp cell → cache hit
    assert first and first == second
    assert forecast["calls"] == 1

    forecast["fail"] = True
    assert await ws.hourly_forecast(10.5, 76.9) == []
    assert await ws.hourly_forecast(10.5, 76.9) == []  # failure is cached briefly too
    assert forecast["calls"] == 2


async def test_forecast_endpoint_returns_ist_day(client, forecast):
    from app.core.timeutils import ist_today

    r = await client.get(f"{API}/weather/forecast", params={"lat": 9.98, "lng": 76.3, "date": str(ist_today())})
    assert r.status_code == 200
    hours = r.json()
    assert 0 < len(hours) <= 24
    assert {"time", "temperature_c", "precipitation_probability", "precipitation_mm", "weather_code",
            "is_risky"} <= set(hours[0])


async def test_forecast_for_slots_outdoor_only(db, forecast):
    outdoor = await make_pitch(db, name="Open Air")
    indoor = await make_pitch(db, name="Dome", indoor=True)
    start = hour_from_now(3)
    s1, s2 = await make_slot(db, outdoor, start), await make_slot(db, indoor, start)
    async with SessionLocal() as s:
        p_out, p_in = await s.get(type(outdoor), outdoor.id), await s.get(type(indoor), indoor.id)
        out = await ws.forecast_for_slots(p_out, [s1])
        assert set(out) == {s1.id} and out[s1.id].precipitation_probability == 10
        assert await ws.forecast_for_slots(p_in, [s2]) == {}


# ───────────────────────────── alerts & host actions ─────────────────────────────
@pytest.fixture
async def rainy_match(db, make_user):
    host, *players = await make_users(make_user, 4, prefix="Rain")
    outdoor = await make_pitch(db, name="Open Air", price=150000)
    kickoff = hour_from_now(26)
    lobby = await make_lobby(db, outdoor, host, players, start=kickoff, status="confirmed", total_spots=10)
    async with SessionLocal() as s:
        lob = await s.get(Lobby, lobby.id)
        alert = await ws.create_alert(s, lob, probability=88, mm=6.2)
        await s.commit()
        alert_id = alert.id

    def indoor(name, km, price, **kw):
        return make_pitch(db, name=name, lat=km_north(km), lng=KOCHI[1], indoor=True, price=price, **kw)

    good_near = await indoor("Dome Near", 3, 160000)
    good_far = await indoor("Dome Far", 6, 140000)
    pricey = await indoor("Dome Pricey", 2, 180000)
    too_far = await indoor("Dome Aluva", 15, 150000)
    shuttle = await indoor("Shuttle Hall", 1, 50000, sport="badminton", fmt="doubles", capacity=4)
    open_air = await make_pitch(db, name="Other Outdoor", lat=km_north(1), lng=KOCHI[1], price=150000)
    booked = await indoor("Dome Booked", 1, 150000)
    late = await indoor("Dome Late", 1, 150000)
    slots = {
        "near": await make_slot(db, good_near, kickoff),
        "far": await make_slot(db, good_far, kickoff + timedelta(hours=1)),
        "pricey": await make_slot(db, pricey, kickoff),
        "too_far": await make_slot(db, too_far, kickoff),
        "shuttle": await make_slot(db, shuttle, kickoff),
        "open_air": await make_slot(db, open_air, kickoff),
        "booked": await make_slot(db, booked, kickoff, status="booked"),
        "late": await make_slot(db, late, kickoff + timedelta(hours=2)),
    }
    return {"lobby": lobby, "host": host, "players": players, "alert_id": alert_id, "slots": slots}


async def test_alert_visible_to_members(client, rainy_match, make_user):
    m = rainy_match
    alerts = (await client.get(f"{API}/weather/alerts", headers=auth_headers(m["players"][0]))).json()
    assert [a["id"] for a in alerts] == [str(m["alert_id"])]
    assert alerts[0]["severity"] == "warning" and alerts[0]["is_host"] is False
    host_view = (await client.get(f"{API}/weather/alerts/{m['alert_id']}", headers=auth_headers(m["host"]))).json()
    assert host_view["is_host"] is True
    outsider = await make_user("Nosy")
    r = await client.get(f"{API}/weather/alerts/{m['alert_id']}", headers=auth_headers(outsider))
    assert r.status_code == 403
    async with SessionLocal() as s:
        notes = (await s.scalars(select(Notification).where(Notification.type == "weather_alert"))).all()
        assert len(notes) == 4
        assert all(n.data["url"] == f"/app/weather/{m['alert_id']}" for n in notes)
    detail = (await client.get(f"{API}/lobbies/{m['lobby'].id}", headers=auth_headers(m["host"]))).json()
    assert detail["weather_alert"]["id"] == str(m["alert_id"])


async def test_alternatives_filtering(client, rainy_match):
    m = rainy_match
    r = await client.get(f"{API}/weather/alerts/{m['alert_id']}/alternatives", headers=auth_headers(m["players"][0]))
    assert r.status_code == 403
    r = await client.get(f"{API}/weather/alerts/{m['alert_id']}/alternatives", headers=auth_headers(m["host"]))
    assert r.status_code == 200, r.text
    alts = r.json()
    assert [a["slot"]["id"] for a in alts] == [str(m["slots"]["near"].id), str(m["slots"]["far"].id)]
    near, far = alts
    assert near["price_diff_paise"] == 10000 and near["covered_by_pytch"] is True
    assert far["price_diff_paise"] == -10000 and far["covered_by_pytch"] is False
    assert near["distance_km"] == pytest.approx(3.0, abs=0.1)
    assert near["pitch"]["is_indoor"] is True and near["turf"]["name"] == "Dome Near"


async def test_transfer_moves_match_indoors(client, rainy_match):
    m = rainy_match
    url = f"{API}/weather/alerts/{m['alert_id']}/transfer"
    r = await client.post(url, json={"slot_id": str(m["slots"]["pricey"].id)}, headers=auth_headers(m["host"]))
    assert r.status_code == 422  # beyond the ₹200 rain guarantee
    r = await client.post(url, json={"slot_id": str(m["slots"]["booked"].id)}, headers=auth_headers(m["host"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "SLOT_UNAVAILABLE"

    target = m["slots"]["near"]
    r = await client.post(url, json={"slot_id": str(target.id)}, headers=auth_headers(m["host"]))
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["pitch"]["id"] == str(target.pitch_id) and detail["pitch"]["is_indoor"] is True
    assert detail["weather_alert"] is None
    async with SessionLocal() as s:
        alert = await s.get(WeatherAlert, m["alert_id"])
        assert alert.status == "transferred" and alert.resolved_at is not None
        assert (await s.get(Slot, target.id)).status == "booked"
        assert (await s.get(Slot, m["lobby"].slot_id)).status == "available"
        moved = (await s.scalars(select(Notification).where(Notification.type == "match_transferred"))).all()
        assert len(moved) == 4
        dancers = (await s.scalars(select(UserBadge.user_id).where(UserBadge.badge_code == "rain_dancer"))).all()
        assert dancers == []  # Rain Dancer is earned by playing the rescued match (match.completed), not the move
    r = await client.post(url, json={"slot_id": str(m["slots"]["far"].id)}, headers=auth_headers(m["host"]))
    assert r.status_code == 409  # already resolved


async def test_rain_check_refunds_with_bonus(client, rainy_match):
    m = rainy_match
    r = await client.post(f"{API}/weather/alerts/{m['alert_id']}/rain-check", headers=auth_headers(m["players"][0]))
    assert r.status_code == 403
    r = await client.post(f"{API}/weather/alerts/{m['alert_id']}/rain-check", headers=auth_headers(m["host"]))
    assert r.status_code == 200, r.text
    body = r.json()
    share = m["lobby"].share_paise
    assert body["refunded_paise_total"] == share * 4
    assert body["lobby"]["status"] == "cancelled"
    async with SessionLocal() as s:
        alert = await s.get(WeatherAlert, m["alert_id"])
        assert alert.status == "rain_checked"
        from app.modules.users.models import User
        balances = {u.id: u.wallet_balance_paise for u in (await s.scalars(select(User))).unique().all()}
        for uid in [p.id for p in m["players"]]:
            assert balances[uid] == share + 2500
        assert balances[m["host"].id] == share  # the host decides the rain-check → no bonus for them


async def test_dismiss(client, rainy_match):
    m = rainy_match
    r = await client.post(f"{API}/weather/alerts/{m['alert_id']}/dismiss", headers=auth_headers(m["host"]))
    assert r.status_code == 200 and r.json()["status"] == "dismissed"
    assert (await client.get(f"{API}/weather/alerts", headers=auth_headers(m["host"]))).json() == []


async def test_scan_job_creates_one_alert_per_risky_outdoor_game(db, make_user, forecast):
    host, mate = await make_users(make_user, 2, prefix="Scan")
    outdoor = await make_pitch(db, name="Scan Outdoor")
    indoor = await make_pitch(db, name="Scan Indoor", indoor=True, lat=km_north(4))
    dry = await make_pitch(db, name="Dry Outdoor", lat=km_north(8))
    kickoff = hour_from_now(20)
    wet = await make_lobby(db, outdoor, host, [mate], start=kickoff, total_spots=4)
    await make_lobby(db, indoor, host, [mate], start=kickoff, total_spots=4)
    await make_lobby(db, dry, host, [mate], start=kickoff + timedelta(hours=3), total_spots=4)
    forecast["payload"] = fake_payload(start=utcnow() - timedelta(hours=2), risky={kickoff})

    async with SessionLocal() as s:
        assert await weather_jobs.scan_upcoming(s) == 1
    async with SessionLocal() as s:
        alerts = (await s.scalars(select(WeatherAlert))).all()
        assert len(alerts) == 1 and alerts[0].lobby_id == wet.id and alerts[0].severity == "warning"
        assert await s.scalar(select(func.count()).select_from(Notification).where(
            Notification.type == "weather_alert")) == 2
        alerts[0].status = "dismissed"
        await s.commit()
    async with SessionLocal() as s:  # dismissed → no re-alert for the same kickoff
        assert await weather_jobs.scan_upcoming(s) == 0
        assert await s.scalar(select(func.count()).select_from(WeatherAlert)) == 1


async def test_dev_storm_and_cancel_closes_alert(client, db, make_user):
    from app.core.events import emit

    host, mate = await make_users(make_user, 2, prefix="Storm")
    indoor = await make_pitch(db, name="Storm Indoor", indoor=True)
    lobby = await make_lobby(db, indoor, host, [mate], start=hour_from_now(30), total_spots=4)
    r = await client.post(f"{API}/dev/lobbies/{lobby.id}/storm", headers=auth_headers(host))
    assert r.status_code == 200, r.text
    alert = r.json()
    assert alert["severity"] == "warning" and alert["status"] == "open" and alert["is_host"] is True
    again = await client.post(f"{API}/dev/lobbies/{lobby.id}/storm", headers=auth_headers(host))
    assert again.json()["id"] == alert["id"]
    async with SessionLocal() as s:
        await emit(s, "lobby.cancelled", lobby_id=lobby.id)
        await s.commit()
        assert (await s.get(WeatherAlert, alert["id"])).status == "expired"


async def test_recorded_match_only_moves_to_camera_pitches_and_badge_waits_for_the_game(client, db, make_user):
    """FUNC5-01: a paid recording never silently vanishes on a transfer. FUNC5-18: Rain Dancer is for playing it."""
    from app.modules.lobbies import service as lobbies

    host, *players = await make_users(make_user, 3, prefix="Cam")
    outdoor = await make_pitch(db, name="Open Air Cam", price=150000, camera_fee=25000)
    kickoff = hour_from_now(26)
    lobby = await make_lobby(db, outdoor, host, players, start=kickoff, total_spots=10, recorded=True)
    async with SessionLocal() as s:
        alert = await ws.create_alert(s, await s.get(Lobby, lobby.id), probability=88, mm=6.2)
        await s.commit()
        alert_id = alert.id
    no_cam = await make_pitch(db, name="Dome Plain", lat=km_north(1), lng=KOCHI[1], indoor=True, price=150000)
    cam = await make_pitch(db, name="Dome Cam", lat=km_north(4), lng=KOCHI[1], indoor=True, price=150000,
                           camera_fee=25000)
    plain_slot, cam_slot = await make_slot(db, no_cam, kickoff), await make_slot(db, cam, kickoff)

    alts = (await client.get(f"{API}/weather/alerts/{alert_id}/alternatives", headers=auth_headers(host))).json()
    assert [a["pitch"]["id"] for a in alts] == [str(cam.id)]  # the closer camera-less dome isn't offered
    url = f"{API}/weather/alerts/{alert_id}/transfer"
    assert (await client.post(url, json={"slot_id": str(plain_slot.id)}, headers=auth_headers(host))).status_code == 422
    r = await client.post(url, json={"slot_id": str(cam_slot.id)}, headers=auth_headers(host))
    assert r.status_code == 200, r.text
    assert r.json()["recorded"] is True

    async with SessionLocal() as s:
        assert (await s.scalars(select(UserBadge).where(UserBadge.badge_code == "rain_dancer"))).all() == []
        lob = await s.get(Lobby, lobby.id)
        lob.start_at, lob.end_at = utcnow() - timedelta(hours=2), utcnow() - timedelta(hours=1)
        await lobbies.complete_match(s, lob)
        await s.commit()
        dancers = set((await s.scalars(select(UserBadge.user_id).where(UserBadge.badge_code == "rain_dancer"))).all())
    assert dancers == {host.id, *(p.id for p in players)}
