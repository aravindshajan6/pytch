"""Settlement maths & workflow, admin refunds (credits / source / dual approval), bank-change approvals,
force-cancel with refunds to source."""

import uuid
from datetime import timedelta

from sqlalchemy import select

from app.core.timeutils import ist_today
from app.modules.admin.models import ApprovalRequest
from app.modules.payments.models import Payment
from app.modules.providers.models import Provider
from app.modules.settlements.jobs import auto_generate_drafts, closed_periods
from app.modules.settlements.models import Settlement, SettlementLine
from tests.admin_helpers import (
    ADMIN,
    as_role,
    make_played_booking,
    make_provider,
    make_provider_venue,
)
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, make_slot, make_venue, pay, wallet

PERIOD = {"period_start": str(ist_today() - timedelta(days=10)), "period_end": str(ist_today() - timedelta(days=1))}


async def test_settlement_maths_hold_window_and_one_line_per_booking(client, db, make_user):
    maker, maker_h = await as_role(db, "finance")
    _, checker_h = await as_role(db, "finance")
    host = await make_user("Host")
    provider = await make_provider(db, pan=True, commission_bps=1000)
    _, pitch = await make_provider_venue(db, provider)
    await make_played_booking(db, pitch, host, hours_ago=72, price=100_000)
    await make_played_booking(db, pitch, host, hours_ago=48, price=150_000)
    recent, _ = await make_played_booking(db, pitch, host, hours_ago=20, price=90_000, status="confirmed")  # in hold
    await make_played_booking(db, pitch, host, hours_ago=96, price=70_000, status="cancelled")  # never payable

    r = await client.post(f"{ADMIN}/settlements/generate", headers=maker_h, json=PERIOD)
    assert r.status_code == 200, r.text
    [row] = r.json()
    gross = 250_000
    commission = 25_000  # 10 %
    gst = 4_500  # 18 % of commission
    tcs = 1_250  # 0.5 % of (gross − refunds)
    tds = 250  # 0.1 % (PAN on file)
    assert row["booking_count"] == 2 and row["gross_paise"] == gross
    assert (row["commission_paise"], row["gst_on_commission_paise"], row["tcs_paise"], row["tds_paise"]) == \
           (commission, gst, tcs, tds)
    assert row["net_payable_paise"] == gross - commission - gst - tcs - tds
    assert row["status"] == "draft" and row["generated_by"] == maker.email

    # re-running is idempotent: bookings settle once (the recent one is still inside the hold window)
    again = await client.post(f"{ADMIN}/settlements/generate", headers=maker_h, json=PERIOD)
    assert again.status_code == 200 and again.json() == []
    lines = (await db.scalars(select(SettlementLine.booking_id))).all()
    assert len(lines) == 2 and recent.id not in lines

    detail = (await client.get(f"{ADMIN}/settlements/{row['id']}", headers=checker_h)).json()
    assert len(detail["lines"]) == 2 and detail["lines"][0]["commission_paise"] == 10_000

    # maker ≠ checker
    self_ok = await client.post(f"{ADMIN}/settlements/{row['id']}/approve", headers=maker_h)
    assert self_ok.status_code == 403 and self_ok.json()["error"]["code"] == "SELF_APPROVAL"
    ok = await client.post(f"{ADMIN}/settlements/{row['id']}/approve", headers=checker_h)
    assert ok.status_code == 200 and ok.json()["status"] == "approved"

    # payouts: blocked while on hold; NEFT needs a UTR; Route needs a linked account
    provider = await db.get(Provider, provider.id)
    provider.payouts_on_hold = True
    await db.commit()
    self_pay = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=checker_h,
                                 json={"method": "manual_neft", "reference": "HDFCN5202612345"})
    assert self_pay.status_code == 403 and self_pay.json()["error"]["code"] == "SELF_APPROVAL"
    held = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                             json={"method": "manual_neft", "reference": "HDFCN5202612345"})
    assert held.status_code == 409 and held.json()["error"]["details"] == {"reason": "payouts_on_hold"}
    provider.payouts_on_hold = False
    await db.commit()
    no_utr = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                               json={"method": "manual_neft"})
    assert no_utr.status_code == 400
    no_acct = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                                json={"method": "razorpay_route"})
    assert no_acct.status_code == 409
    paid = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                             json={"method": "manual_neft", "reference": "HDFCN5202612345"})
    assert paid.status_code == 200 and paid.json()["status"] == "paid"
    assert paid.json()["payout_ref"] == "HDFCN5202612345"
    # a bounced NEFT can be marked failed, but a retry needs a fresh approval (never a direct re-pay)
    bounced = await client.post(f"{ADMIN}/settlements/{row['id']}/fail", headers=maker_h, json={"reason": "bounced"})
    assert bounced.json()["status"] == "failed" and bounced.json()["payout_ref"] is None
    repay = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                              json={"method": "manual_neft", "reference": "HDFCN5202699999"})
    assert repay.status_code == 409

    csv = await client.get(f"{ADMIN}/settlements/{row['id']}/export.csv", headers=checker_h)
    assert csv.status_code == 200 and "net_payable_paise" in csv.text


async def test_tds_without_pan_and_route_transfer_in_mock_mode(client, db, make_user):
    _, maker_h = await as_role(db, "finance")
    _, checker_h = await as_role(db, "super_admin")
    host = await make_user("Host")
    provider = await make_provider(db, pan=False, commission_bps=800)
    provider.razorpay_account_id = "acc_TESTLINKED01"
    await db.commit()
    _, pitch = await make_provider_venue(db, provider)
    await make_played_booking(db, pitch, host, hours_ago=50, price=200_000)
    [row] = (await client.post(f"{ADMIN}/settlements/generate", headers=maker_h,
                               json={**PERIOD, "provider_id": str(provider.id)})).json()
    assert row["commission_paise"] == 16_000 and row["gst_on_commission_paise"] == 2_880
    assert row["tcs_paise"] == 1_000 and row["tds_paise"] == 10_000  # 5 % without PAN
    assert row["net_payable_paise"] == 200_000 - 16_000 - 2_880 - 1_000 - 10_000
    await client.post(f"{ADMIN}/settlements/{row['id']}/approve", headers=checker_h)
    paid = (await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                              json={"method": "razorpay_route"})).json()
    assert paid["status"] == "paid" and paid["payout_ref"].startswith("trf_mock_")
    assert paid["payout_method"] == "razorpay_route"
    # double-payout attempt (pay → fail → pay) is impossible for Route transfers
    failed = await client.post(f"{ADMIN}/settlements/{row['id']}/fail", headers=checker_h,
                               json={"reason": "Bank returned the transfer"})
    assert failed.status_code == 409
    again = await client.post(f"{ADMIN}/settlements/{row['id']}/pay", headers=maker_h,
                              json={"method": "razorpay_route"})
    assert again.status_code == 409


async def test_worker_auto_drafts_are_idempotent(db, make_user):
    host = await make_user("Host")
    provider = await make_provider(db)
    _, pitch = await make_provider_venue(db, provider)
    week_start, _ = closed_periods("weekly", ist_today())[1]  # two weeks back: always past the hold window
    days_ago = (ist_today() - week_start).days
    await make_played_booking(db, pitch, host, hours_ago=24 * days_ago - 12)  # inside that week
    assert await auto_generate_drafts(db) == 1
    assert await auto_generate_drafts(db) == 0
    s = await db.scalar(select(Settlement))
    assert s.status == "draft" and s.generated_by_admin_id is None and s.booking_count == 1


async def _paid_lobby(client, db, make_user, *, price=100_000):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=price)
    lob = (await book(client, host, await make_slot(db, pitch), total_spots=2))["lobby"]
    await join(client, p1, lob["id"])
    await pay(client, host, lob["id"], use_credits=False)
    await pay(client, p1, lob["id"], use_credits=False)
    return host, p1, lob


async def test_refund_to_credits_and_to_source(client, db, make_user):
    _, finance = await as_role(db, "finance")
    host, p1, lob = await _paid_lobby(client, db, make_user)
    payment = await db.scalar(select(Payment).where(Payment.user_id == p1.id, Payment.status == "paid"))

    r = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                          json={"amount_paise": 10_000, "destination": "credits", "reason": "Pitch lights failed"})
    assert r.status_code == 200, r.text
    assert r.json()["payment"]["status"] == "paid" and r.json()["refund_id"].startswith("credits:")
    assert (await wallet(client, p1))["balance_paise"] == 10_000

    r = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                          json={"amount_paise": 40_000, "destination": "source", "reason": "Rest of the refund"})
    assert r.status_code == 200 and r.json()["payment"]["status"] == "refunded"
    assert r.json()["refund_id"].startswith("mock_rfnd_")
    over = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=finance,
                             json={"amount_paise": 1_000, "destination": "credits", "reason": "again"})
    assert over.status_code == 409
    await db.refresh(payment)
    assert payment.meta["refunded_paise"] == 50_000 and payment.meta["refunded_source_paise"] == 40_000
    assert len(payment.meta["refunds"]) == 2


async def test_large_refund_needs_a_second_admin(client, db, make_user):
    maker, maker_h = await as_role(db, "finance")
    _, checker_h = await as_role(db, "finance")
    _, support_h = await as_role(db, "support")
    host, p1, lob = await _paid_lobby(client, db, make_user, price=1_200_000)  # ₹6,000 shares
    payment = await db.scalar(select(Payment).where(Payment.user_id == p1.id, Payment.status == "paid"))

    r = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=maker_h,
                          json={"amount_paise": 600_000, "destination": "credits", "reason": "Venue closed"})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["error"]["code"] == "APPROVAL_REQUIRED" and body["approval_id"] == body["error"]["details"][
        "approval_id"]
    assert (await wallet(client, p1))["balance_paise"] == 0
    dup = await client.post(f"{ADMIN}/payments/{payment.id}/refund", headers=maker_h,
                            json={"amount_paise": 600_000, "destination": "credits", "reason": "Venue closed"})
    assert dup.status_code == 409

    pending = (await client.get(f"{ADMIN}/approvals", headers=checker_h, params={"status": "pending"})).json()
    assert [a["id"] for a in pending] == [body["approval_id"]] and pending[0]["requested_by"] == maker.email
    assert (await client.get(f"{ADMIN}/approvals", headers=support_h)).status_code == 403

    self_ok = await client.post(f"{ADMIN}/approvals/{body['approval_id']}/approve", headers=maker_h)
    assert self_ok.status_code == 403 and self_ok.json()["error"]["code"] == "SELF_APPROVAL"
    ok = await client.post(f"{ADMIN}/approvals/{body['approval_id']}/approve", headers=checker_h,
                           json={"note": "Confirmed with the venue"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    assert (await wallet(client, p1))["balance_paise"] == 600_000
    await db.refresh(payment)
    assert payment.status == "refunded"
    again = await client.post(f"{ADMIN}/approvals/{body['approval_id']}/approve", headers=checker_h)
    assert again.status_code == 409


async def test_bank_change_approval_applies_or_restores(client, db):
    _, checker_h = await as_role(db, "finance")
    provider = await make_provider(db)
    provider.bank_account_last4, provider.bank_ifsc, provider.payouts_on_hold = "9999", "HDFC0000001", True
    await db.commit()

    def request(new_last4: str) -> ApprovalRequest:
        return ApprovalRequest(
            id=uuid.uuid4(), action="provider.bank_change", target_type="provider", target_id=str(provider.id),
            payload={"old": {"bank_account_last4": "1111", "bank_ifsc": "SBIN0000001"},
                     "new": {"bank_account_last4": new_last4, "bank_ifsc": "HDFC0000001"}},
            summary="Bank change", status="pending", requested_by_provider_id=provider.id,
        )

    a1 = request("9999")
    db.add(a1)
    await db.commit()
    listed = (await client.get(f"{ADMIN}/approvals", headers=checker_h)).json()
    assert listed[0]["requested_by"] == provider.name
    ok = await client.post(f"{ADMIN}/approvals/{a1.id}/approve", headers=checker_h)
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    await db.refresh(provider)
    assert provider.payouts_on_hold is False and provider.bank_account_last4 == "9999"

    provider.payouts_on_hold = True
    a2 = request("5555")
    db.add(a2)
    await db.commit()
    rej = await client.post(f"{ADMIN}/approvals/{a2.id}/reject", headers=checker_h, json={"note": "Name mismatch"})
    assert rej.status_code == 200 and rej.json()["status"] == "rejected"
    await db.refresh(provider)
    assert provider.bank_account_last4 == "1111" and provider.bank_ifsc == "SBIN0000001"
    assert provider.payouts_on_hold is False


async def test_force_cancel_refunds_to_source(client, db, make_user):
    _, ops = await as_role(db, "ops")
    host, p1, lob = await _paid_lobby(client, db, make_user)
    r = await client.post(f"{ADMIN}/bookings/{lob['booking']['id']}/cancel", headers=ops,
                          json={"reason": "Venue flooded", "refund_destination": "source"})
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["lobby"]["status"] == "cancelled" and detail["booking"]["status"] == "cancelled"
    assert {p["status"] for p in detail["payments"]} == {"refunded"}
    # everything went back to the card/UPI — nothing left over as credits
    assert (await wallet(client, host))["balance_paise"] == 0
    assert (await wallet(client, p1))["balance_paise"] == 0
    for p in (await db.scalars(select(Payment).where(Payment.lobby_id == uuid.UUID(lob["id"])))).all():
        assert p.meta["refunded_source_paise"] == p.payable_paise
    listing = (await client.get(f"{ADMIN}/bookings", headers=ops, params={"status": "cancelled"})).json()
    assert listing["total"] == 1 and listing["items"][0]["code"] == lob["booking"]["code"]


async def test_force_cancel_refunds_to_credits(client, db, make_user):
    _, ops = await as_role(db, "ops")
    host, p1, lob = await _paid_lobby(client, db, make_user)
    r = await client.post(f"{ADMIN}/bookings/{lob['booking']['id']}/cancel", headers=ops,
                          json={"reason": "Venue flooded", "refund_destination": "credits"})
    assert r.status_code == 200
    assert (await wallet(client, host))["balance_paise"] == 50_000
    assert (await wallet(client, p1))["balance_paise"] == 50_000
    player_view = await client.get(f"{API}/lobbies/{lob['id']}", headers=auth_headers(p1))
    assert player_view.json()["status"] == "cancelled"
