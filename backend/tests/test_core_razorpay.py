"""Razorpay rail: checkout options, signature verification, HMAC webhooks with idempotency."""

import hashlib
import hmac

import orjson
import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.modules.payments import providers
from app.modules.payments.models import Payment, WebhookEvent
from tests.conftest import auth_headers
from tests.core_helpers import API, book, join, lobby, make_slot, make_venue

KEY_SECRET = "rzp_secret_test"
WEBHOOK_SECRET = "whsec_test"


@pytest.fixture
def razorpay_mode(monkeypatch):
    monkeypatch.setattr(settings, "payment_provider", "razorpay")
    monkeypatch.setattr(settings, "razorpay_key_id", "rzp_test_key")
    monkeypatch.setattr(settings, "razorpay_key_secret", KEY_SECRET)
    monkeypatch.setattr(settings, "razorpay_webhook_secret", WEBHOOK_SECRET)
    counter = iter(range(1, 1000))

    async def fake_order(self, *, amount_paise, receipt, notes):
        assert amount_paise > 0 and notes["payment_id"] == receipt
        return f"order_test{next(counter)}"

    monkeypatch.setattr(providers.RazorpayProvider, "create_order", fake_order)


def _sign(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


async def test_checkout_verify_and_webhook(client, db, make_user, razorpay_mode):
    host, p1 = await make_user("Host"), await make_user("Anu")
    _, pitch = await make_venue(db, price=100_000)
    slot = await make_slot(db, pitch)
    lob = (await book(client, host, slot, total_spots=2))["lobby"]

    intent = (await client.post(f"{API}/lobbies/{lob['id']}/pay", json={"use_credits": True},
                                headers=auth_headers(host))).json()
    assert intent["provider"] == "razorpay" and intent["razorpay"]["key_id"] == "rzp_test_key"
    order_id = intent["razorpay"]["order_id"]
    assert intent["razorpay"]["amount"] == 50_000 and intent["razorpay"]["prefill"]["name"] == "Host"

    bad = await client.post(f"{API}/payments/{intent['payment_id']}/verify", headers=auth_headers(host), json={
        "razorpay_order_id": order_id, "razorpay_payment_id": "pay_1", "razorpay_signature": "nope"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "INVALID_SIGNATURE"
    good = await client.post(f"{API}/payments/{intent['payment_id']}/verify", headers=auth_headers(host), json={
        "razorpay_order_id": order_id, "razorpay_payment_id": "pay_1",
        "razorpay_signature": _sign(KEY_SECRET, f"{order_id}|pay_1".encode())})
    assert good.status_code == 200 and good.json()["status"] == "paid"

    # p1 pays; confirmation arrives only through the webhook (delivered twice)
    await join(client, p1, lob["id"])
    intent2 = (await client.post(f"{API}/lobbies/{lob['id']}/pay", json={"use_credits": True},
                                 headers=auth_headers(p1))).json()
    event = {"event": "payment.captured", "payload": {"payment": {"entity": {
        "id": "pay_2", "order_id": intent2["razorpay"]["order_id"], "status": "captured"}}}}
    raw = orjson.dumps(event)
    unsigned = await client.post(f"{API}/payments/webhooks/razorpay", content=raw,
                                 headers={"X-Razorpay-Signature": "bad", "X-Razorpay-Event-Id": "evt_1"})
    assert unsigned.status_code == 400
    for _ in range(2):
        resp = await client.post(f"{API}/payments/webhooks/razorpay", content=raw, headers={
            "X-Razorpay-Signature": _sign(WEBHOOK_SECRET, raw), "X-Razorpay-Event-Id": "evt_1",
            "Content-Type": "application/json"})
        assert resp.status_code == 200 and resp.json() == {"ok": True}
    assert await db.scalar(select(func.count()).select_from(WebhookEvent)) == 1

    assert (await lobby(client, host, lob["id"]))["status"] == "confirmed"
    payment = await db.scalar(select(Payment).where(Payment.provider_payment_id == "pay_2"))
    assert payment is not None and payment.status == "paid"

    # a verify call arriving after the webhook is a no-op (idempotent capture)
    again = await client.post(f"{API}/payments/{intent2['payment_id']}/verify", headers=auth_headers(p1), json={
        "razorpay_order_id": intent2["razorpay"]["order_id"], "razorpay_payment_id": "pay_2",
        "razorpay_signature": _sign(KEY_SECRET, f"{intent2['razorpay']['order_id']}|pay_2".encode())})
    assert again.status_code == 200 and again.json()["status"] == "paid"
    mine = (await client.get(f"{API}/payments/mine", headers=auth_headers(p1))).json()
    assert [p["status"] for p in mine] == ["paid"]

    # mock completion is refused for Razorpay payments
    refused = await client.post(f"{API}/payments/{intent2['payment_id']}/mock/complete",
                                json={"outcome": "success"}, headers=auth_headers(p1))
    assert refused.status_code == 409
