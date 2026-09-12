"""Channel API (API keys, scopes, rate limit, idempotency, conflicts) and signed webhook delivery."""

import hashlib
import hmac
from datetime import timedelta

import httpx
from sqlalchemy import func, select

from app.core.timeutils import to_ist, utcnow
from app.modules.channels import api as channel_api
from app.modules.channels import fetch
from app.modules.channels.jobs import backoff, deliver_webhooks
from app.modules.channels.models import ProviderApiKey, SlotBlock, SyncConflict, WebhookDelivery
from app.modules.notifications.models import Notification
from tests.core_helpers import book
from tests.partner_helpers import (  # noqa: F401  (reset_fetch_hooks is an autouse fixture)
    API,
    future_run,
    gen_slots,
    make_provider,
    partner_headers,
    provider_venue,
    public_resolver,
    reset_fetch_hooks,
)


async def install_hook(client, owner, *, events: list[str], url: str = "https://hooks.example.com/pytch") -> dict:
    fetch.install_test_hooks(resolver=public_resolver)
    resp = await client.post(f"{API}/partner/channels/webhooks", headers=partner_headers(owner),
                             json={"url": url, "events": events})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _key(client, owner, scopes: list[str]) -> str:
    resp = await client.post(f"{API}/partner/channels/api-keys", headers=partner_headers(owner),
                             json={"name": "Front-desk POS", "scopes": scopes})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["key"].startswith("pk_live_") and body["api_key"]["prefix"] == body["key"][:16]
    return body["key"]


def _bearer(key: str, **extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", **extra}


async def test_api_key_auth_scopes_and_availability(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    slots = await gen_slots(db, pitch)
    read_key = await _key(client, owner, ["availability:read"])
    stored = (await db.scalars(select(ProviderApiKey))).one()
    assert read_key not in (stored.key_hash, stored.prefix)  # only a keyed hash is stored

    pitches = await client.get(f"{API}/channel/v1/pitches", headers=_bearer(read_key))
    assert pitches.status_code == 200 and pitches.json()[0]["id"] == str(pitch.id)
    day = to_ist(slots[-1].start_at).date()
    avail = await client.get(f"{API}/channel/v1/availability", params={"pitch_id": str(pitch.id), "date": str(day)},
                             headers=_bearer(read_key))
    assert avail.status_code == 200 and set(avail.json()[0]) == {"start_at", "end_at", "available"}

    body = {"pitch_id": str(pitch.id), "start_at": slots[-1].start_at.isoformat(),
            "end_at": slots[-1].end_at.isoformat(), "external_ref": "bk-1"}
    no_scope = await client.post(f"{API}/channel/v1/blocks", json=body, headers=_bearer(read_key))
    assert no_scope.status_code == 403
    assert (await client.get(f"{API}/channel/v1/pitches", headers=_bearer("pk_live_" + "x" * 32))).status_code == 401
    assert (await client.get(f"{API}/channel/v1/pitches")).status_code == 401
    # a partner session token is not an API key
    assert (await client.get(f"{API}/channel/v1/pitches", headers=partner_headers(owner))).status_code == 401

    # other providers' pitches are invisible
    rival = await make_provider(db, await make_user("Rival"))
    _, rival_pitch = await provider_venue(db, rival)
    hidden = await client.get(f"{API}/channel/v1/availability",
                              params={"pitch_id": str(rival_pitch.id), "date": str(day)}, headers=_bearer(read_key))
    assert hidden.status_code == 404

    # revocation is immediate
    assert (await client.delete(f"{API}/partner/channels/api-keys/{stored.id}",
                                headers=partner_headers(owner))).status_code == 204
    assert (await client.get(f"{API}/channel/v1/pitches", headers=_bearer(read_key))).status_code == 401


async def test_api_blocks_idempotency_conflicts_and_cancel(client, db, make_user):
    owner, player = await make_user("Owner"), await make_user("Player")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 3)
    key = await _key(client, owner, ["availability:read", "blocks:write"])
    body = {"pitch_id": str(pitch.id), "start_at": run[0].start_at.isoformat(),
            "end_at": run[0].end_at.isoformat(), "external_ref": "hudle-778", "source": "hudle",
            "customer_name": "Team Blue"}

    first = await client.post(f"{API}/channel/v1/blocks", json=body, headers=_bearer(key, **{"Idempotency-Key": "k1"}))
    assert first.status_code == 201, first.text
    replay = await client.post(f"{API}/channel/v1/blocks", json=body, headers=_bearer(key, **{"Idempotency-Key": "k1"}))
    assert replay.status_code == 201 and replay.json() == first.json()
    mismatch = await client.post(f"{API}/channel/v1/blocks", json={**body, "external_ref": "other"},
                                 headers=_bearer(key, **{"Idempotency-Key": "k1"}))
    assert mismatch.status_code == 422
    # same booking pushed again without an idempotency key → no-op (external_ref is the natural key)
    same = await client.post(f"{API}/channel/v1/blocks", json=body, headers=_bearer(key))
    assert same.status_code == 200 and same.json()["id"] == first.json()["id"]
    assert await db.scalar(select(func.count()).select_from(SlotBlock)) == 1
    await db.refresh(run[0])
    assert run[0].status == "blocked"

    # an external booking over a Pytch booking is simply rejected (409): Pytch keeps the slot, nothing was double
    # booked, so no conflict record and no "double booking" alert
    await book(client, player, run[2])
    clash = {**body, "external_ref": "hudle-779", "start_at": run[2].start_at.isoformat(),
             "end_at": run[2].end_at.isoformat()}
    resp = await client.post(f"{API}/channel/v1/blocks", json=clash, headers=_bearer(key))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "SLOT_UNAVAILABLE"
    assert resp.json()["error"]["details"] == {"slot_ids": [str(run[2].id)]}
    assert await db.scalar(select(func.count()).select_from(SyncConflict)) == 0
    assert await db.scalar(select(func.count()).select_from(Notification).where(
        Notification.type == "sync_conflict")) == 0
    assert await db.scalar(select(func.count()).select_from(SlotBlock).where(
        SlotBlock.external_ref == "hudle-779")) == 0
    await db.refresh(run[2])
    assert run[2].status == "held"

    # moving the external booking re-claims slots (old released, new blocked)
    moved = await client.post(f"{API}/channel/v1/blocks", headers=_bearer(key), json={
        **body, "start_at": run[1].start_at.isoformat(), "end_at": run[1].end_at.isoformat()})
    assert moved.status_code == 200
    await db.refresh(run[0])
    await db.refresh(run[1])
    assert (run[0].status, run[1].status) == ("available", "blocked")

    gone = await client.delete(f"{API}/channel/v1/blocks/hudle-778", headers=_bearer(key))
    assert gone.status_code == 204
    await db.refresh(run[1])
    assert run[1].status == "available"
    assert (await client.delete(f"{API}/channel/v1/blocks/nope", headers=_bearer(key))).status_code == 404


async def test_api_rate_limit_per_key(client, db, make_user, monkeypatch):
    owner = await make_user("Owner")
    await make_provider(db, owner)
    key = await _key(client, owner, ["availability:read"])
    monkeypatch.setattr(channel_api, "RATE_LIMIT_PER_MINUTE", 3)
    codes = [(await client.get(f"{API}/channel/v1/pitches", headers=_bearer(key))).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


async def test_webhook_create_validates_url_and_rejects_private_targets(client, db, make_user):
    owner = await make_user("Owner")
    await make_provider(db, owner)
    for bad in ("http://hooks.example.com/x", "https://127.0.0.1/x", "https://10.0.0.5/hook",
                "https://169.254.169.254/latest/meta-data", "https://localhost/x"):
        resp = await client.post(f"{API}/partner/channels/webhooks", headers=partner_headers(owner),
                                 json={"url": bad, "events": ["slot.booked"]})
        assert resp.status_code == 400, bad
    fetch.install_test_hooks(resolver=lambda h, p: _private(h, p))
    rebind = await client.post(f"{API}/partner/channels/webhooks", headers=partner_headers(owner),
                               json={"url": "https://evil.example.com/x", "events": ["slot.booked"]})
    assert rebind.status_code == 400


async def _private(host: str, port: int) -> list[str]:
    return ["192.168.1.10"]


async def test_webhook_delivery_is_signed_and_retried_with_backoff(client, db, make_user, monkeypatch):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    created = await install_hook(client, owner, events=["slot.blocked"])
    secret = created["secret"]
    assert secret.startswith("whsec_") and "secret" not in created["webhook"]

    received: list[httpx.Request] = []
    answers = iter([500, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request)
        return httpx.Response(next(answers))

    fetch.install_test_hooks(resolver=public_resolver, transport=httpx.MockTransport(handler))
    run = future_run(await gen_slots(db, pitch), 1)
    await client.post(f"{API}/partner/blocks", headers=partner_headers(owner), json={
        "pitch_id": str(pitch.id), "start_at": run[0].start_at.isoformat(), "end_at": run[0].end_at.isoformat(),
        "kind": "block", "source": "maintenance"})

    assert await deliver_webhooks(db) == 1
    delivery = (await db.scalars(select(WebhookDelivery))).one()
    await db.refresh(delivery)
    assert delivery.status == "pending" and delivery.attempts == 1 and delivery.response_code == 500
    assert delivery.next_attempt_at > utcnow() + backoff(1) - timedelta(seconds=5)
    assert await deliver_webhooks(db) == 0  # not due yet

    delivery.next_attempt_at = utcnow() - timedelta(seconds=1)
    await db.commit()
    assert await deliver_webhooks(db) == 1
    await db.refresh(delivery)
    assert delivery.status == "ok" and delivery.attempts == 2

    req = received[-1]
    assert req.url == "https://hooks.example.com/pytch" and req.headers["X-Pytch-Event"] == "slot.blocked"
    parts = dict(p.split("=", 1) for p in req.headers["X-Pytch-Signature"].split(","))
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + req.content, hashlib.sha256).hexdigest()
    assert hmac.compare_digest(parts["v1"], expected)
    assert set(httpx.Response(200, content=req.content).json()) == {
        "id", "event", "occurred_at", "pitch_id", "start_at", "end_at", "status"}

    # gives up after WEBHOOK_MAX_ATTEMPTS
    monkeypatch.setattr("app.modules.channels.jobs.settings.webhook_max_attempts", 3)
    fetch.install_test_hooks(resolver=public_resolver, transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    delivery.status, delivery.attempts, delivery.next_attempt_at = "pending", 2, utcnow() - timedelta(seconds=1)
    await db.commit()
    await deliver_webhooks(db)
    await db.refresh(delivery)
    assert delivery.status == "failed" and delivery.attempts == 3

    test = await client.post(f"{API}/partner/channels/webhooks/{created['webhook']['id']}/test",
                             headers=partner_headers(owner))
    assert test.status_code == 200 and test.json() == {"status_code": 503, "ok": False}


def test_backoff_is_exponential_and_capped():
    assert [backoff(n).total_seconds() for n in (1, 2, 3)] == [60, 180, 540]
    assert backoff(20) == timedelta(hours=12)
