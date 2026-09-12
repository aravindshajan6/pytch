"""Payment rails. `mock` (demo, no network) and `razorpay` (orders API + HMAC verification).

Both converge on `payments.service.capture` — providers only create orders and verify signatures.
"""

import hashlib
import hmac
import uuid
from typing import Protocol

import httpx

from app.core.config import settings
from app.core.logging import logger


class ProviderError(Exception):
    """The provider refused or failed to create an order."""


class OrderProvider(Protocol):
    name: str

    async def create_order(self, *, amount_paise: int, receipt: str, notes: dict[str, str]) -> str: ...


class MockProvider:
    """Built-in "Pytch Pay" sheet: orders are local ids, completion via `/payments/{id}/mock/complete`."""

    name = "mock"

    async def create_order(self, *, amount_paise: int, receipt: str, notes: dict[str, str]) -> str:
        return f"mock_order_{uuid.uuid4().hex[:20]}"


def _hmac_sha256(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


class RazorpayProvider:
    name = "razorpay"
    orders_url = "https://api.razorpay.com/v1/orders"

    def __init__(self, key_id: str | None, key_secret: str | None, webhook_secret: str | None) -> None:
        self.key_id = key_id
        self.key_secret = key_secret
        self.webhook_secret = webhook_secret

    async def create_order(self, *, amount_paise: int, receipt: str, notes: dict[str, str]) -> str:
        if not (self.key_id and self.key_secret):
            raise ProviderError("Razorpay keys are not configured")
        body = {"amount": amount_paise, "currency": "INR", "receipt": receipt[:40], "notes": notes}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(self.orders_url, json=body, auth=(self.key_id, self.key_secret))
        except httpx.HTTPError as exc:
            raise ProviderError(f"Razorpay unreachable: {exc}") from exc
        if resp.status_code >= 300:
            logger.warning("razorpay order failed status=%s body=%s", resp.status_code, resp.text[:300])
            raise ProviderError("Razorpay rejected the order")
        order_id = resp.json().get("id")
        if not order_id:
            raise ProviderError("Razorpay returned no order id")
        return str(order_id)

    def verify_payment_signature(self, order_id: str, payment_id: str, signature: str) -> bool:
        """Checkout signature = HMAC-SHA256("<order_id>|<payment_id>", key_secret)."""
        if not self.key_secret or not signature:
            return False
        expected = _hmac_sha256(self.key_secret, f"{order_id}|{payment_id}".encode())
        return hmac.compare_digest(expected, signature)

    def verify_webhook_signature(self, body: bytes, signature: str | None) -> bool:
        """Webhook signature = HMAC-SHA256(raw body, webhook_secret)."""
        if not self.webhook_secret or not signature:
            return False
        return hmac.compare_digest(_hmac_sha256(self.webhook_secret, body), signature)


async def _razorpay_post(url: str, body: dict) -> dict:
    rp = razorpay()
    if not (rp.key_id and rp.key_secret):
        raise ProviderError("Razorpay keys are not configured")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=body, auth=(rp.key_id, rp.key_secret))
    except httpx.HTTPError as exc:
        raise ProviderError(f"Razorpay unreachable: {exc}") from exc
    if resp.status_code >= 300:
        logger.warning("razorpay call failed url=%s status=%s", url, resp.status_code)
        raise ProviderError("Razorpay rejected the request")
    return resp.json()


async def create_refund(*, rail: str, provider_payment_id: str | None, amount_paise: int, receipt: str,
                        notes: dict[str, str]) -> str:
    """Refund to the original source on the rail the payment used. Razorpay: normal-speed refund
    (receipt = idempotency key); mock (demo): simulated instant success. Returns the refund id."""
    if rail != "razorpay":
        return f"mock_rfnd_{uuid.uuid4().hex[:20]}"
    if not provider_payment_id:
        raise ProviderError("This payment has no Razorpay payment id to refund")
    data = await _razorpay_post(f"https://api.razorpay.com/v1/payments/{provider_payment_id}/refund",
                                {"amount": amount_paise, "speed": "normal", "receipt": receipt[:40], "notes": notes})
    if not data.get("id"):
        raise ProviderError("Razorpay returned no refund id")
    return str(data["id"])


async def create_transfer(*, account_id: str, amount_paise: int, notes: dict[str, str]) -> str:
    """Razorpay Route direct transfer to a linked account; mock mode returns a simulated transfer id."""
    if settings.payment_provider != "razorpay":
        return f"trf_mock_{uuid.uuid4().hex[:18]}"
    data = await _razorpay_post("https://api.razorpay.com/v1/transfers",
                                {"account": account_id, "amount": amount_paise, "currency": "INR", "notes": notes})
    if not data.get("id"):
        raise ProviderError("Razorpay returned no transfer id")
    return str(data["id"])


def razorpay() -> RazorpayProvider:
    return RazorpayProvider(settings.razorpay_key_id, settings.razorpay_key_secret, settings.razorpay_webhook_secret)


def get_provider(name: str) -> OrderProvider:
    if name == "razorpay":
        return razorpay()
    if name == "mock":
        return MockProvider()
    raise ValueError(f"unknown payment provider {name!r}")
