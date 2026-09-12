"""Regression tests for the money & business-logic audit findings (SEC2-01 … SEC2-11, SEC4-01, SEC4-03).

Each test reproduces the auditor's PoC against the API and asserts the fixed behaviour.
"""

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app.core.database import SessionLocal
from app.core.timeutils import utcnow
from app.modules.admin.models import ApprovalRequest
from app.modules.audit.models import AuditLog
from app.modules.bench import service as bench
from app.modules.bench.models import BenchStatus
from app.modules.gamification.models import XpEvent
from app.modules.highlights.models import Clip
from app.modules.lobbies.models import Lobby
from app.modules.notifications.models import Notification
from app.modules.payments.models import Payment
from app.modules.users.models import PlayerStats, User
from app.modules.wallet import service as wallet_service
from app.modules.wallet.models import WalletTransaction
from app.modules.weather import service as ws
from tests.admin_helpers import ADMIN, as_role
from tests.community_factories import hour_from_now, make_lobby, make_pitch, make_users
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, lobby, make_slot, make_venue, pay, wallet
from tests.test_community_highlights import ready_recording

SHARE = 25_000  # ₹500 pitch split two ways


# ─────────────────────────────── helpers ───────────────────────────────


async def _coupon(client, db, code: str, off: int = 10_000) -> None:
    _, admin = await as_role(db, "super_admin")
    r = await client.post(f"{ADMIN}/coupons", headers=admin, json={
        "code": code, "description": "test", "discount_type": "flat", "amount_off_paise": off,
        "usage_limit_total": 100, "usage_limit_per_user": 1})
    assert r.status_code == 201, r.text


async def _pay_with_coupon(client, user, lobby_id: str, code: str) -> dict:
    r = await client.post(f"{API}/lobbies/{lobby_id}/pay", json={"use_credits": False, "coupon_code": code},
                          headers=auth_headers(user))
    assert r.status_code == 200, r.text
    intent = r.json()
    done = await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete", json={"outcome": "success"},
                             headers=auth_headers(user))
    assert done.json()["status"] == "paid", done.text
    return intent


async def _leave(client, user, lobby_id: str) -> None:
    r = await client.post(f"{API}/lobbies/{lobby_id}/leave", headers=auth_headers(user))
    assert r.status_code == 200, r.text


async def _balance(user) -> int:
    async with SessionLocal() as s:
        return await wallet_service.get_balance(s, user.id)


async def _assert_ledgers_consistent() -> None:
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(User.id, User.wallet_balance_paise,
                   select(func.coalesce(func.sum(WalletTransaction.amount_paise), 0))
                   .where(WalletTransaction.user_id == User.id).scalar_subquery())
        )).all()
    assert all(bal == total for _, bal, total in rows), rows


async def _confirmed_split(client, db, make_user, *, hours_ahead: float = 24):
    """Host + one member, split two ways (₹250 each), confirmed. Returns (host, member, lobby)."""
    host, member = await make_user("Host"), await make_user("Member")
    _, pitch = await make_venue(db, price=2 * SHARE)
    lob = (await book(client, host, await make_slot(db, pitch, hours_ahead=hours_ahead), total_spots=2))["lobby"]
    await join(client, member, lob["id"])
    return host, member, lob


async def _member_payment(db, user) -> Payment:
    return await db.scalar(select(Payment).where(Payment.user_id == user.id, Payment.status == "paid")
                           .execution_options(populate_existing=True))


# ─────────────────────── SEC2-01 dropout credit is net of coupons ───────────────────────


async def test_sec2_01_dropout_credit_never_launders_coupon_value(client, db, make_user):
    await _coupon(client, db, "HUNDRED")
    host, carol, lob = await _confirmed_split(client, db, make_user)
    await _pay_with_coupon(client, carol, lob["id"], "HUNDRED")  # ₹150 cash for a ₹250 seat
    await pay(client, host, lob["id"], use_credits=False)
    assert (await lobby(client, host, lob["id"]))["status"] == "confirmed"

    await _leave(client, carol, lob["id"])  # dropout: no refund
    dave = await make_user("Dave")
    await join(client, dave, lob["id"])
    await pay(client, dave, lob["id"], use_credits=False)  # ₹250 cash for the seat
    # Carol gets back what she actually paid (₹150), not the gross ₹250 share
    assert (await wallet(client, carol))["balance_paise"] == SHARE - 10_000

    # …and never more than what the newcomer actually paid (newcomer used a coupon)
    await _coupon(client, db, "HUNDRED2")
    host2, erin, lob2 = await _confirmed_split(client, db, make_user)
    await pay(client, erin, lob2["id"], use_credits=False)  # ₹250 cash
    await pay(client, host2, lob2["id"], use_credits=False)
    await _leave(client, erin, lob2["id"])
    frank = await make_user("Frank")
    await join(client, frank, lob2["id"])
    await _pay_with_coupon(client, frank, lob2["id"], "HUNDRED2")  # ₹150 cash
    assert (await wallet(client, erin))["balance_paise"] == SHARE - 10_000
    await _assert_ledgers_consistent()


# ─────────────── SEC2-02 admin refunds are capped by what the seat still holds ───────────────


async def test_sec2_02_refund_after_dropout_credit_is_capped(client, db, make_user):
    _, finance = await as_role(db, "finance")
    host, carol, lob = await _confirmed_split(client, db, make_user, hours_ahead=48)
    await pay(client, carol, lob["id"], use_credits=False)
    await pay(client, host, lob["id"], use_credits=False)
    await _leave(client, carol, lob["id"])
    await _coupon(client, db, "SUB100")
    dave = await make_user("Dave")
    await join(client, dave, lob["id"])
    await _pay_with_coupon(client, dave, lob["id"], "SUB100")  # Carol is credited ₹150 of her ₹250
    assert (await wallet(client, carol))["balance_paise"] == 15_000

    payment = await _member_payment(db, carol)
    over = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                             json={"amount_paise": SHARE, "destination": "credits", "reason": "double dip"})
    assert over.status_code == 400 and over.json()["error"]["details"]["refundable_paise"] == 10_000
    ok = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                           json={"amount_paise": 10_000, "destination": "credits", "reason": "penalty waived"})
    assert ok.status_code == 200, ok.text
    again = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                              json={"amount_paise": 100, "destination": "credits", "reason": "more"})
    assert again.status_code == 400
    assert (await wallet(client, carol))["balance_paise"] == SHARE  # exactly what she paid, not more

    # a later cancellation doesn't pay her again either
    r = await client.post(f"{API}/bookings/{lob['booking']['id']}/cancel", headers=auth_headers(host))
    assert r.status_code == 200, r.text
    assert (await wallet(client, carol))["balance_paise"] == SHARE
    await _assert_ledgers_consistent()


async def test_sec2_02_approval_executor_rechecks_the_cap(client, db, make_user):
    maker, _ = await as_role(db, "finance")
    _, checker = await as_role(db, "finance")
    host, carol, lob = await _confirmed_split(client, db, make_user)
    await pay(client, carol, lob["id"], use_credits=False)
    await pay(client, host, lob["id"], use_credits=False)
    payment = await _member_payment(db, carol)
    # queued while the money was still held …
    approval = ApprovalRequest(id=uuid.uuid4(), action="payment.refund", target_type="payment",
                               target_id=str(payment.id), summary="refund",
                               payload={"amount_paise": SHARE, "destination": "credits", "reason": "queued"},
                               status="pending", requested_by_admin_id=maker.id, created_at=utcnow())
    db.add(approval)
    await db.commit()
    # … then Carol drops out and is fully compensated by a newcomer
    await _leave(client, carol, lob["id"])
    dave = await make_user("Dave")
    await join(client, dave, lob["id"])
    await pay(client, dave, lob["id"], use_credits=False)
    assert (await wallet(client, carol))["balance_paise"] == SHARE

    r = await client.post(f"{ADMIN}/approvals/{approval.id}/approve", headers=checker)
    assert r.status_code == 200 and r.json()["status"] == "failed", r.text
    assert (await wallet(client, carol))["balance_paise"] == SHARE


async def test_sec2_02_full_mode_host_refund_nets_out_reimbursements(client, db, make_user):
    _, finance = await as_role(db, "finance")
    host, bob = await make_user("Hank"), await make_user("Bob")
    _, pitch = await make_venue(db, price=2 * SHARE)
    lob = (await book(client, host, await make_slot(db, pitch, hours_ahead=48), mode="full", total_spots=2))["lobby"]
    intent = await pay(client, host, lob["id"], use_credits=False)  # host fronts ₹500
    await join(client, bob, lob["id"])
    await pay(client, bob, lob["id"], use_credits=False)
    assert (await wallet(client, host))["balance_paise"] == SHARE  # ₹250 reimbursed

    pid = intent["payment_id"]
    full = await client.post(f"{ADMIN}/payments/{pid}/refund", headers=finance,
                             json={"amount_paise": 2 * SHARE, "destination": "source", "reason": "double"})
    assert full.status_code == 400 and full.json()["error"]["details"]["refundable_paise"] == SHARE
    ok = await client.post(f"{ADMIN}/payments/{pid}/refund", headers=finance,
                           json={"amount_paise": SHARE, "destination": "source", "reason": "goodwill"})
    assert ok.status_code == 200, ok.text
    # the match stays confirmed (goodwill refund of the host's own seat) …
    assert (await lobby(client, host, lob["id"]))["status"] == "confirmed"
    # … and a later cancellation only refunds what is still held: host 0, Bob his ₹250
    r = await client.post(f"{API}/bookings/{lob['booking']['id']}/cancel", headers=auth_headers(host))
    assert r.status_code == 200, r.text
    assert (await wallet(client, host))["balance_paise"] == SHARE
    assert (await wallet(client, bob))["balance_paise"] == SHARE
    await _assert_ledgers_consistent()


# ─────────────── SEC4-01 parallel credit payments by one payer: no deadlock / 500 ───────────────


async def test_sec4_01_parallel_credit_payments_serialize(client, db, make_user, monkeypatch):
    real_debit = wallet_service.debit

    async def slow_debit(*args, **kwargs):  # widen the race window between the two requests
        await asyncio.sleep(0.2)
        return await real_debit(*args, **kwargs)

    monkeypatch.setattr(wallet_service, "debit", slow_debit)
    payer = await make_user("Payer")
    _, pitch = await make_venue(db, price=2 * SHARE)
    lobs = [(await book(client, payer, await make_slot(db, pitch, hours_ahead=h), total_spots=2))["lobby"]
            for h in (30, 31)]
    async with SessionLocal() as s:
        await wallet_service.credit(s, payer.id, SHARE, "bonus", "exactly one share")
        await s.commit()

    async def pay_one(lob):
        return await client.post(f"{API}/lobbies/{lob['id']}/pay", json={"use_credits": True},
                                 headers=auth_headers(payer))

    results = await asyncio.gather(*(pay_one(lob) for lob in lobs), return_exceptions=True)
    assert all(not isinstance(r, Exception) for r in results), results
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    intents = sorted((r.json() for r in results), key=lambda i: i["credits_applied_paise"])
    # one is covered by the credits, the other sees the real (empty) balance and goes to the provider
    assert [i["credits_applied_paise"] for i in intents] == [0, SHARE]
    assert [i["status"] for i in intents] == ["created", "paid"]
    assert await _balance(payer) == 0
    await _assert_ledgers_consistent()


# ─────────────── SEC2-03 bench radar can't be trilaterated ───────────────


async def test_sec2_03_bench_nearby_reveals_at_most_the_grid_cell(client, db, make_user, monkeypatch):
    monkeypatch.setattr(bench, "NEARBY_RATE", (10_000, 60))
    monkeypatch.setattr(bench, "NEARBY_RATE_HOURLY", (10_000, 3600))
    victim, attacker = await make_user("Yara"), await make_user("Eve")
    # two exact positions ~1 km apart inside the same ~1.1 km grid cell
    spots = [(9.9612, 76.3212), (9.9689, 76.3288)]
    probes = [(9.9672 + dy, 76.3205 + dx) for dy in (-0.004, 0, 0.0031, 0.012) for dx in (-0.006, 0, 0.0047)]

    async def radar() -> list:
        out = []
        for lat, lng in probes:
            for radius in (0.3, 1.0, 1.7, 2, 3.3, 5, 12):
                r = await client.get(f"{API}/bench/nearby", headers=auth_headers(attacker),
                                     params={"lat": lat, "lng": lng, "radius_km": radius, "sport": "basketball"})
                assert r.status_code == 200, r.text
                out.append(r.json())
        return out

    seen = []
    for lat, lng in spots:
        r = await client.put(f"{API}/bench/me", headers=auth_headers(victim), json={
            "is_active": True, "lat": lat, "lng": lng, "sports": ["basketball"], "duration_minutes": 30})
        assert r.status_code == 200
        seen.append(await radar())
    # every probe (centre × radius) answers identically wherever the victim is inside the cell,
    # and the (stable, per-day) blip never sits on the victim
    assert seen[0] == seen[1]
    assert any(res["count"] == 1 for res in seen[0])
    for res in seen[0]:
        for blip in res["blips"]:
            assert (blip["lat"], blip["lng"]) not in spots

    # radius is clamped to the allowed set and the centre is snapped: sub-cell moves change nothing
    near = [await client.get(f"{API}/bench/nearby", headers=auth_headers(attacker),
                             params={"lat": 9.9651 + d, "lng": 76.3251, "radius_km": rad})
            for d, rad in ((0, 0.1), (0.0015, 1.9), (0.003, 2.0))]
    assert len({str(r.json()) for r in near}) == 1


async def test_sec2_03_bench_count_is_bucketed_and_rate_limited(client, db, make_user):
    me = await make_user("Radar")
    for i in range(5):
        u = await make_user(f"Bencher {i}")
        db.add(BenchStatus(user_id=u.id, is_active=True, lat=9.9672 + i * 0.001, lng=76.3205, radius_km=5,
                           sports=["football"], active_until=utcnow() + timedelta(hours=1)))
    await db.commit()
    params = {"lat": 9.9672, "lng": 76.3205, "radius_km": 5}
    r = await client.get(f"{API}/bench/nearby", headers=auth_headers(me), params=params)
    assert r.json()["count"] == 4 and len(r.json()["blips"]) == 4  # "4+" — exact counts stop at 3
    codes = [(await client.get(f"{API}/bench/nearby", headers=auth_headers(me), params=params)).status_code
             for _ in range(bench.NEARBY_RATE[0])]
    assert codes[-1] == 429 and codes.count(200) == bench.NEARBY_RATE[0] - 1


# ─────────────── SEC2-04 host XP only for matches actually played ───────────────


async def test_sec2_04_confirm_cancel_loop_earns_no_host_xp(client, db, make_user):
    host = await make_user("Farmer")
    _, pitch = await make_venue(db, price=2 * SHARE)
    async with SessionLocal() as s:
        await wallet_service.credit(s, host.id, 2 * SHARE, "bonus", "seed")
        await s.commit()
    for h in (30, 32, 34):
        lob = (await book(client, host, await make_slot(db, pitch, hours_ahead=h), mode="full",
                          total_spots=2, visibility="private"))["lobby"]
        await pay(client, host, lob["id"])
        assert (await lobby(client, host, lob["id"]))["status"] == "confirmed"
        r = await client.post(f"{API}/bookings/{lob['booking']['id']}/cancel", headers=auth_headers(host))
        assert r.status_code == 200
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == host.id))
        assert stats.matches_hosted == 0 and stats.xp == 0

    lob = (await book(client, host, await make_slot(db, pitch, hours_ahead=40), mode="full", total_spots=2))["lobby"]
    await pay(client, host, lob["id"])
    done = await client.post(f"{API}/dev/lobbies/{lob['id']}/complete", headers=auth_headers(host))
    assert done.status_code == 200
    async with SessionLocal() as s:
        stats = await s.scalar(select(PlayerStats).where(PlayerStats.user_id == host.id))
        assert stats.matches_hosted == 1
        assert await s.scalar(select(func.count()).select_from(XpEvent).where(
            XpEvent.user_id == host.id, XpEvent.reason.startswith("Hosted"))) == 1


# ─────────────── SEC2-05 / SEC2-09 clips: XP once per recording, deduped views, private footage ───────────────


@pytest.fixture
async def private_recording(db, make_user):
    host, *players = await make_users(make_user, 3, prefix="Cam")
    pitch = await make_pitch(db, name="Camera Arena", camera_fee=25000)
    lob = await make_lobby(db, pitch, host, players, start=hour_from_now(-2), status="completed",
                           completed_at=utcnow() - timedelta(minutes=50), total_spots=3, recorded=True)
    await db.execute(update(Lobby).where(Lobby.id == lob.id).values(visibility="private"))
    await db.commit()
    return await ready_recording(lob.id), host, players


async def test_sec2_05_clip_xp_farming_and_view_inflation(client, private_recording, make_user):
    rec, host, players = private_recording
    bob = players[0]
    url = f"{API}/highlights/recordings/{rec.id}/clips"
    for i in range(4):  # create → delete → create …
        r = await client.post(url, json={"title": f"x{i}", "start_s": 0, "end_s": 5}, headers=auth_headers(bob))
        assert r.status_code == 201
        clip_id = r.json()["id"]
        if i < 3:
            assert (await client.delete(f"{API}/highlights/clips/{clip_id}", headers=auth_headers(bob))).status_code \
                == 204
    async with SessionLocal() as s:
        xp = (await s.scalars(select(XpEvent.amount).where(XpEvent.user_id == bob.id,
                                                            XpEvent.reason.startswith("Clipped")))).all()
    assert xp == [20]

    view = f"{API}/highlights/clips/{clip_id}/view"
    for _ in range(3):
        assert (await client.post(view, headers=auth_headers(bob))).json() == {"views": 0}  # owner: not counted
    for _ in range(3):
        assert (await client.post(view, headers=auth_headers(host))).json() == {"views": 1}  # once per viewer
    stranger = await make_user("Eve")
    assert (await client.post(view, headers=auth_headers(stranger))).status_code == 404
    async with SessionLocal() as s:
        assert (await s.get(Clip, uuid.UUID(clip_id))).views == 1


async def test_sec2_09_private_match_clips_stay_with_participants(client, private_recording, make_user):
    rec, host, players = private_recording
    r = await client.post(f"{API}/highlights/recordings/{rec.id}/clips",
                          json={"title": "Worldie", "start_s": 0, "end_s": 5}, headers=auth_headers(players[0]))
    clip_id = r.json()["id"]
    await client.post(f"{API}/highlights/clips/{clip_id}/pin", headers=auth_headers(players[0]))
    stranger = await make_user("Eve")
    feed = (await client.get(f"{API}/highlights/feed", params={"sort": "recent"},
                             headers=auth_headers(stranger))).json()
    assert feed["total"] == 0 and feed["items"] == []
    assert (await client.get(f"{API}/highlights/users/{players[0].id}/clips",
                             headers=auth_headers(stranger))).json() == []
    for method, path in (("post", "like"), ("post", "pin"), ("delete", "pin")):
        r = await getattr(client, method)(f"{API}/highlights/clips/{clip_id}/{path}", headers=auth_headers(stranger))
        assert r.status_code == 404
    assert (await client.delete(f"{API}/highlights/clips/{clip_id}", headers=auth_headers(stranger))).status_code \
        == 404
    profile = (await client.get(f"{API}/users/{players[0].id}", headers=auth_headers(stranger))).json()
    assert profile["pinned_clips"] == []
    # participants still see it
    mine = (await client.get(f"{API}/highlights/users/{players[0].id}/clips", headers=auth_headers(host))).json()
    assert [c["id"] for c in mine] == [clip_id]


# ─────────────── SEC2-06 rain-check can't be farmed ───────────────


async def _rain_check(client, db, host, players, *, title="Rainy"):
    pitch = await make_pitch(db, name=f"Open {uuid.uuid4().hex[:4]}")
    lob = await make_lobby(db, pitch, host, players, start=hour_from_now(26), total_spots=4, title=title)
    async with SessionLocal() as s:
        alert = await ws.create_alert(s, await s.get(Lobby, lob.id), probability=90, mm=7)
        await s.commit()
    r = await client.post(f"{API}/weather/alerts/{alert.id}/rain-check", headers=auth_headers(host))
    assert r.status_code == 200, r.text
    return lob


async def _weather_xp(user) -> int:
    async with SessionLocal() as s:
        return int(await s.scalar(select(func.coalesce(func.sum(XpEvent.amount), 0)).where(
            XpEvent.user_id == user.id, XpEvent.reason.startswith("Rain-checked"))))


async def _rain_bonuses(user) -> int:
    async with SessionLocal() as s:
        return int(await s.scalar(select(func.count()).select_from(WalletTransaction).where(
            WalletTransaction.user_id == user.id, WalletTransaction.kind == "bonus")))


async def test_sec2_06_rain_check_bonus_and_xp_rules(client, db, make_user):
    solo, host, mate = await make_users(make_user, 3, prefix="Rain")
    lob = await _rain_check(client, db, solo, [])  # only the host paid → refund only
    assert await _rain_bonuses(solo) == 0 and await _weather_xp(solo) == 0
    assert await _balance(solo) == lob.share_paise

    await _rain_check(client, db, host, [mate])  # two payers: the mate gets the bonus, the host the XP
    assert await _rain_bonuses(mate) == 1 and await _rain_bonuses(host) == 0
    assert await _weather_xp(host) == 40

    # the mate can't collect more than RAIN_BONUS_DAILY_CAP bonuses a day, however many hosts rain-check
    for i in range(3):
        other = await make_user(f"Host {i}")
        await _rain_check(client, db, other, [mate])
    from app.modules.lobbies.service import RAIN_BONUS_DAILY_CAP

    assert await _rain_bonuses(mate) == RAIN_BONUS_DAILY_CAP
    await _assert_ledgers_consistent()


# ─────────────── SEC2-07 slot hoarding ───────────────


async def test_sec2_07_open_holds_are_capped_and_rate_limited(client, db, make_user):
    hoarder = await make_user("Hoarder")
    _, pitch = await make_venue(db, price=2 * SHARE)
    slots = [await make_slot(db, pitch, hours_ahead=30 + i) for i in range(6)]
    first = [await book(client, hoarder, s, total_spots=8) for s in slots[:2]]
    third = await client.post(f"{API}/bookings", headers=auth_headers(hoarder),
                              json={"slot_id": str(slots[2].id), "mode": "split", "total_spots": 8})
    assert third.status_code == 409 and third.json()["error"]["code"] == "LIMIT_REACHED"
    full = await book(client, hoarder, slots[3], mode="full", total_spots=2)
    second_full = await client.post(f"{API}/bookings", headers=auth_headers(hoarder),
                                    json={"slot_id": str(slots[4].id), "mode": "full", "total_spots": 2})
    assert second_full.status_code == 409 and second_full.json()["error"]["code"] == "LIMIT_REACHED"
    # paying for (or cancelling) a hold frees a place
    await pay(client, hoarder, full["lobby"]["id"], use_credits=False)
    await book(client, hoarder, slots[4], mode="full", total_spots=2)
    await client.post(f"{API}/bookings/{first[0]['booking']['id']}/cancel", headers=auth_headers(hoarder))
    await book(client, hoarder, slots[2], total_spots=8)

    # rate limit: book → cancel loops can't churn a venue's calendar
    churner = await make_user("Churner")
    codes = []
    for i in range(12):
        slot = await make_slot(db, pitch, hours_ahead=60 + i)
        r = await client.post(f"{API}/bookings", headers=auth_headers(churner),
                              json={"slot_id": str(slot.id), "mode": "split", "total_spots": 2})
        codes.append(r.status_code)
        if r.status_code == 201:
            await client.post(f"{API}/bookings/{r.json()['booking']['id']}/cancel", headers=auth_headers(churner))
    assert codes[:10] == [201] * 10 and codes[10:] == [429, 429]


# ─────────────── SEC2-08 demo tools only on your own match ───────────────


async def test_sec2_08_dev_tools_are_host_scoped(client, db, make_user):
    host, mate, stranger = await make_users(make_user, 3, prefix="Dev")
    pitch = await make_pitch(db, name="Dev Arena")
    lob = await make_lobby(db, pitch, host, [mate], start=hour_from_now(30), total_spots=4)
    for tool in ("dropout", "complete", "fill", "storm"):
        r = await client.post(f"{API}/dev/lobbies/{lob.id}/{tool}", headers=auth_headers(stranger))
        assert r.status_code == 404, (tool, r.text)
    for tool in ("dropout", "complete", "storm"):
        r = await client.post(f"{API}/dev/lobbies/{lob.id}/{tool}", headers=auth_headers(mate))
        assert r.status_code in (403, 404), (tool, r.text)
    assert (await lobby(client, host, str(lob.id)))["status"] == "confirmed"
    assert len((await lobby(client, host, str(lob.id)))["members"]) == 2
    r = await client.post(f"{API}/dev/lobbies/{lob.id}/storm", headers=auth_headers(host))
    assert r.status_code == 200


# ─────────────── SEC2-09 chat access + private rejoin; SEC4-03 chat rate limit ───────────────


async def test_sec2_09_chat_is_for_current_members_and_private_join_needs_the_code(client, db, make_user):
    host, bob, eve = await make_user("Alice"), await make_user("Bob"), await make_user("Eve")
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch, hours_ahead=30), total_spots=4,
                      visibility="private"))["lobby"]
    msgs = f"{API}/lobbies/{lob['id']}/messages"
    await client.post(msgs, json={"body": "gate code is 4711"}, headers=auth_headers(host))
    join_url = f"{API}/lobbies/{lob['id']}/join"

    # a stranger who only learned the id can't join; with the invite code (or after opening it) they can
    assert (await client.post(join_url, headers=auth_headers(eve))).status_code == 404
    assert (await client.post(join_url, params={"code": lob["code"]}, headers=auth_headers(eve))).status_code == 200
    assert (await client.get(f"{API}/lobbies/code/{lob['code']}", headers=auth_headers(bob))).status_code == 200
    assert (await client.post(join_url, headers=auth_headers(bob))).status_code == 200
    assert (await client.get(msgs, headers=auth_headers(bob))).status_code == 200

    # removed by the host: no more chat, and no rejoining by id without the code
    r = await client.delete(f"{API}/lobbies/{lob['id']}/members/{bob.id}", headers=auth_headers(host))
    assert r.status_code == 200
    assert (await client.get(msgs, headers=auth_headers(bob))).status_code == 404  # private lobby hidden again
    assert (await client.post(join_url, headers=auth_headers(bob))).status_code == 404
    assert (await client.post(join_url, params={"code": lob["code"]}, headers=auth_headers(bob))).status_code == 200

    # a member who left loses the chat too
    await _leave(client, eve, lob["id"])
    assert (await client.get(msgs, headers=auth_headers(eve))).status_code == 403

    # public lobby: detail visible to anyone, chat only to members
    pub = (await book(client, host, await make_slot(db, pitch, hours_ahead=31), total_spots=4))["lobby"]
    outsider = await make_user("Outsider")
    assert (await client.get(f"{API}/lobbies/{pub['id']}", headers=auth_headers(outsider))).status_code == 200
    r = await client.get(f"{API}/lobbies/{pub['id']}/messages", headers=auth_headers(outsider))
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_MEMBER"


async def test_sec4_03_chat_is_rate_limited(client, db, make_user):
    host = await make_user("Chatty")
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=4))["lobby"]
    codes = [(await client.post(f"{API}/lobbies/{lob['id']}/messages", json={"body": f"m{i}"},
                                headers=auth_headers(host))).status_code for i in range(12)]
    assert codes[:10] == [201] * 10 and codes[10:] == [429, 429]


# ─────────────── SEC2-10 manual credits: daily caps + maker–checker ───────────────


async def test_sec2_10_support_daily_caps(client, db, make_user):
    _, support = await as_role(db, "support")
    players = await make_users(make_user, 6, prefix="Goodwill")

    async def grant(user, amount):
        return await client.post(f"{ADMIN}/users/{user.id}/wallet", headers=support,
                                 json={"amount_paise": amount, "reason": "late start goodwill"})

    assert [(await grant(players[0], 50_000)).status_code for _ in range(2)] == [200, 200]
    r = await grant(players[0], 100)  # ₹1,000 per player per day
    assert r.status_code == 409 and r.json()["error"]["code"] == "LIMIT_REACHED"
    for p in players[1:5]:
        assert [(await grant(p, 50_000)).status_code for _ in range(2)] == [200, 200]
    r = await grant(players[5], 100)  # ₹5,000 per support admin per day
    assert r.status_code == 409 and r.json()["error"]["details"]["cap_paise"] == 500_000
    r = await client.post(f"{ADMIN}/users/{players[0].id}/wallet", headers=support,
                          json={"amount_paise": -100, "reason": "debits aren't capped"})
    assert r.status_code == 200 and r.json()["wallet_balance_paise"] == 100_000 - 100


async def test_sec2_10_large_credit_needs_a_second_admin(client, db, make_user):
    maker, maker_h = await as_role(db, "finance")
    _, checker_h = await as_role(db, "finance")
    player = await make_user("Lucky")
    r = await client.post(f"{ADMIN}/users/{player.id}/wallet", headers=maker_h,
                          json={"amount_paise": 10_000_000, "reason": "mint test"})
    assert r.status_code == 202 and r.json()["error"]["code"] == "APPROVAL_REQUIRED", r.text
    approval_id = r.json()["approval_id"]
    assert await _balance(player) == 0
    dup = await client.post(f"{ADMIN}/users/{player.id}/wallet", headers=maker_h,
                            json={"amount_paise": 600_000, "reason": "again"})
    assert dup.status_code == 409
    selfie = await client.post(f"{ADMIN}/approvals/{approval_id}/approve", headers=maker_h)
    assert selfie.status_code == 403 and selfie.json()["error"]["code"] == "SELF_APPROVAL"
    ok = await client.post(f"{ADMIN}/approvals/{approval_id}/approve", headers=checker_h)
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    assert await _balance(player) == 10_000_000
    async with SessionLocal() as s:
        txn = await s.scalar(select(WalletTransaction).where(WalletTransaction.user_id == player.id))
        assert txn.ref_type == "admin_approved" and txn.ref_id == maker.id
        actions = set((await s.scalars(select(AuditLog.action))).all())
    assert {"approval.request", "wallet.adjust", "approval.approved"} <= actions
    # small credits are still immediate
    r = await client.post(f"{ADMIN}/users/{player.id}/wallet", headers=maker_h,
                          json={"amount_paise": 10_000, "reason": "small goodwill"})
    assert r.status_code == 200


# ─────────────── SEC2-11 provider-funded coupons ───────────────


async def test_sec2_11_provider_funded_coupons_need_provider_admins(client, db, make_user):
    from tests.partner_helpers import make_provider

    owner = await make_user("Rahul")
    provider = await make_provider(db, owner)
    body = {"code": "VENUE20", "description": "venue promo", "discount_type": "percent", "percent_off": 20,
            "max_discount_paise": 10_000, "usage_limit_total": 10, "usage_limit_per_user": 1,
            "funded_by": "provider", "provider_id": str(provider.id)}
    _, marketing = await as_role(db, "marketing")
    r = await client.post(f"{ADMIN}/coupons", headers=marketing, json=body)
    assert r.status_code == 403
    platform_ok = await client.post(f"{ADMIN}/coupons", headers=marketing,
                                    json={**body, "code": "PLAT20", "funded_by": "platform", "provider_id": None})
    assert platform_ok.status_code == 201
    _, ops_stale = await as_role(db, "ops", stepped_up=False)
    r = await client.post(f"{ADMIN}/coupons", headers=ops_stale, json=body)
    assert r.status_code == 403 and r.json()["error"]["code"] == "STEP_UP_REQUIRED"
    _, ops = await as_role(db, "ops")
    created = await client.post(f"{ADMIN}/coupons", headers=ops, json=body)
    assert created.status_code == 201, created.text
    async with SessionLocal() as s:
        notes = (await s.scalars(select(Notification).where(Notification.user_id == owner.id))).all()
    assert [n.type for n in notes] == ["coupon_funding"] and "VENUE20" in notes[0].body

    cid = created.json()["id"]
    r = await client.patch(f"{ADMIN}/coupons/{cid}", headers=marketing, json={"percent_off": 50})
    assert r.status_code == 403
    r = await client.patch(f"{ADMIN}/coupons/{cid}", headers=marketing, json={"description": "renamed"})
    assert r.status_code == 200
    r = await client.patch(f"{ADMIN}/coupons/{platform_ok.json()['id']}", headers=marketing,
                           json={"funded_by": "provider", "provider_id": str(provider.id)})
    assert r.status_code == 403


async def test_func5_03_closing_checkout_returns_held_credits(client, db, make_user):
    """Closing checkout cancels the open intent at once: credits (and coupon use) come straight back."""
    from app.modules.wallet import service as wallet_service
    from tests.core_helpers import book, join, make_slot, make_venue, wallet

    host, player = await make_user("Host"), await make_user("Payer")
    await wallet_service.credit(db, player.id, 20000, "bonus", "test credits")
    await db.commit()
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=6))["lobby"]
    await join(client, player, lob["id"])

    intent = (await client.post(f"{API}/lobbies/{lob['id']}/pay", json={"use_credits": True},
                                headers=auth_headers(player))).json()
    assert intent["status"] == "created" and intent["credits_applied_paise"] == 20000
    assert (await wallet(client, player))["balance_paise"] == 0

    stranger = await make_user("Stranger")
    r = await client.post(f"{API}/payments/{intent['payment_id']}/cancel", headers=auth_headers(stranger))
    assert r.status_code == 404
    r = await client.post(f"{API}/payments/{intent['payment_id']}/cancel", headers=auth_headers(player))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (await wallet(client, player))["balance_paise"] == 20000
    again = await client.post(f"{API}/payments/{intent['payment_id']}/cancel", headers=auth_headers(player))
    assert again.status_code == 200 and (await wallet(client, player))["balance_paise"] == 20000  # idempotent
    # a late "success" from the provider on the cancelled intent is refunded, never double-applied
    late = await client.post(f"{API}/payments/{intent['payment_id']}/mock/complete", json={"outcome": "success"},
                             headers=auth_headers(player))
    assert late.status_code == 200 and late.json()["status"] in ("cancelled", "refunded")


async def test_func5_15_wallet_lifetime_totals_skip_abandoned_checkouts(client, db, make_user):
    from tests.core_helpers import book, join, make_slot, make_venue, pay, wallet

    host, player = await make_user("Host"), await make_user("Payer")
    await wallet_service.credit(db, player.id, 20000, "bonus", "test credits")
    await db.commit()
    _, pitch = await make_venue(db)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=6))["lobby"]
    await join(client, player, lob["id"])
    intent = await pay(client, player, lob["id"], complete=False)  # credits held…
    await client.post(f"{API}/payments/{intent['payment_id']}/cancel", headers=auth_headers(player))  # …returned
    w = await wallet(client, player)
    assert (w["total_credited_paise"], w["total_spent_paise"]) == (20000, 0)
    await pay(client, player, lob["id"])  # really spends the credits this time
    w = await wallet(client, player)
    assert w["total_credited_paise"] == 20000 and w["total_spent_paise"] == 20000 and w["balance_paise"] == 0


async def test_sec2_10_split_credits_still_need_a_second_admin(client, db, make_user, monkeypatch):
    """Re-verification finding: 3 × ₹5,000 to one player by finance went through without approval."""
    from app.modules.platform import service as platform

    async def threshold(key, db=None):
        return 500_000 if key == "refund_dual_approval_paise" else await original(key, db)

    original = platform.get_setting
    monkeypatch.setattr(platform, "get_setting", threshold)
    player = await make_user("Split")
    _, finance = await as_role(db, "finance")
    body = {"amount_paise": 200_000, "reason": "Goodwill for a washed-out game"}
    codes = [(await client.post(f"{ADMIN}/users/{player.id}/wallet", headers=finance, json=body)).status_code
             for _ in range(3)]
    assert codes == [200, 200, 202]  # ₹2k + ₹2k fine; the third would take today's total to ₹6k > ₹5k threshold

    # an admin can't spread it over many players either: ≤ 4 × threshold of unapproved grants per day
    others = [await make_user(f"P{i}") for i in range(12)]
    results = [(await client.post(f"{ADMIN}/users/{p.id}/wallet", headers=finance,
                                  json={"amount_paise": 400_000, "reason": "Goodwill for a washed-out game"}))
               .status_code for p in others]
    assert results.count(200) == 4 and set(results[4:]) == {202}  # ₹4k (earlier) + 4 × ₹4k = ₹20k = 4 × ₹5k
