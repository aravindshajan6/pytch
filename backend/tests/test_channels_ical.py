"""iCal export (no PII, valid VCALENDAR), iCal import (create/update/cancel, idempotent, conflicts), SSRF guard."""

import uuid
from datetime import UTC, timedelta

import httpx
import pytest
from icalendar import Calendar
from sqlalchemy import func, select

from app.core.crypto import encrypt
from app.core.timeutils import utcnow
from app.modules.channels import fetch
from app.modules.channels.jobs import import_ical_feeds
from app.modules.channels.models import ChannelFeed, SlotBlock, SyncConflict
from app.modules.channels.service import sync_feed
from app.modules.notifications.models import Notification
from tests.core_helpers import book
from tests.partner_helpers import (  # noqa: F401  (reset_fetch_hooks: autouse fixture)
    API,
    future_run,
    gen_slots,
    make_provider,
    partner_headers,
    provider_venue,
    public_resolver,
    reset_fetch_hooks,
)


def _ics(*events: tuple[str, object, object, str]) -> bytes:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Front desk//EN"]
    for uid, start, end, extra in events:
        lines += ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTART:{start:%Y%m%dT%H%M%SZ}", f"DTEND:{end:%Y%m%dT%H%M%SZ}",
                  "SUMMARY:Playo - Arun (7 players)"]
        if extra:
            lines.append(extra)
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode()


async def _feed(db, provider, pitch, **kw) -> ChannelFeed:
    feed = ChannelFeed(id=uuid.uuid4(), provider_id=provider.id, pitch_id=pitch.id, name="Front desk calendar",
                       source=kw.get("source", "playo"), url_enc=encrypt("https://calendar.example.com/secret.ics"),
                       url_hint="calendar.example.com/…/secret.ics", is_active=True, consecutive_failures=0)
    db.add(feed)
    await db.commit()
    return feed


async def test_ical_export_is_valid_and_has_no_pii(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Priya Host", phone="+919845001122")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 3)
    await book(client, host, run[0], title="Priya's Sunday Game")
    await client.post(f"{API}/partner/blocks", headers=partner_headers(owner), json={
        "pitch_id": str(pitch.id), "start_at": run[2].start_at.isoformat(), "end_at": run[2].end_at.isoformat(),
        "kind": "booking", "source": "phone", "customer_name": "Walkin Varghese", "customer_phone": "+919000012345"})

    exported = await client.post(f"{API}/partner/channels/exports/{pitch.id}", headers=partner_headers(owner))
    assert exported.status_code == 200
    url = exported.json()["ical_url"]
    path = url[url.index("/api/v1"):]
    resp = await client.get(path)
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/calendar")
    body = resp.text
    for secret in ("Priya", "Walkin", "Varghese", "9845001122", "9000012345", "Sunday", "Owner"):
        assert secret not in body
    cal = Calendar.from_ical(resp.content)
    assert cal.name == "VCALENDAR" and str(cal["VERSION"]) == "2.0"
    events = cal.walk("VEVENT")
    assert len(events) == 2 and {str(e["SUMMARY"]) for e in events} == {"Booked"}
    assert {str(e["UID"]) for e in events} == {f"slot-{run[0].id}@pytch.in", f"slot-{run[2].id}@pytch.in"}
    assert events[0].decoded("DTSTART").astimezone(UTC) == run[0].start_at

    etag = resp.headers["etag"]
    assert (await client.get(path, headers={"If-None-Match": etag})).status_code == 304
    rotated = (await client.post(f"{API}/partner/channels/exports/{pitch.id}", headers=partner_headers(owner))).json()
    assert rotated["ical_url"] != url
    assert (await client.get(path)).status_code == 404
    assert (await client.delete(f"{API}/partner/channels/exports/{pitch.id}",
                                headers=partner_headers(owner))).status_code == 204
    assert (await client.get(rotated["ical_url"][rotated["ical_url"].index("/api/v1"):])).status_code == 404
    assert (await client.get(f"{API}/ical/short.ics")).status_code == 404


async def test_ical_import_upserts_idempotently_and_raises_conflicts(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 5)
    feed = await _feed(db, provider, pitch)
    await book(client, host, run[4])  # Pytch sold this hour first

    body = _ics(("evt-a@playo", run[0].start_at, run[1].end_at, ""),  # 2 hours
                ("evt-b@playo", run[2].start_at, run[2].end_at, ""),
                ("evt-clash@playo", run[4].start_at, run[4].end_at, ""))
    await sync_feed(db, feed, body=body)
    await db.refresh(feed)
    assert feed.last_status == "ok" and feed.last_event_count == 3
    blocks = {b.external_ref.split(":", 1)[1]: b for b in (await db.scalars(select(SlotBlock))).all()}
    assert set(blocks) == {"evt-a@playo", "evt-b@playo", "evt-clash@playo"}
    assert all(b.source == "playo" and b.feed_id == feed.id for b in blocks.values())
    for s in run[:3]:
        await db.refresh(s)
        assert s.status == "blocked"
    await db.refresh(run[4])
    assert run[4].status == "held"  # never overridden
    conflict = (await db.scalars(select(SyncConflict))).one()
    assert conflict.slot_id == run[4].id and conflict.lobby_id is not None and conflict.status == "open"
    assert await db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == owner.id, Notification.type == "sync_conflict")) == 1
    # the clashing event holds no slot → stored as `conflicted`, not as an (active) booking
    assert [b.status for b in blocks.values()] == ["active", "active", "conflicted"]

    # identical poll → nothing changes, no duplicate conflict/alert
    stamp = {k: (b.updated_at, b.status) for k, b in blocks.items()}
    await sync_feed(db, feed, body=body)
    for k, b in blocks.items():
        await db.refresh(b)
        assert (b.updated_at, b.status) == stamp[k]
    assert await db.scalar(select(func.count()).select_from(SyncConflict)) == 1
    assert await db.scalar(select(func.count()).select_from(Notification).where(
        Notification.type == "sync_conflict")) == 1

    # evt-a shrinks to one hour, evt-b is cancelled upstream, evt-clash disappears
    changed = _ics(("evt-a@playo", run[0].start_at, run[0].end_at, ""),
                   ("evt-b@playo", run[2].start_at, run[2].end_at, "STATUS:CANCELLED"))
    await sync_feed(db, feed, body=changed)
    for b in blocks.values():
        await db.refresh(b)
    assert blocks["evt-a@playo"].status == "active" and blocks["evt-a@playo"].end_at == run[0].end_at
    assert blocks["evt-b@playo"].status == "cancelled" and blocks["evt-clash@playo"].status == "cancelled"
    for s in run[:4]:
        await db.refresh(s)
    assert [s.status for s in run[:3]] == ["blocked", "available", "available"]

    # the cancelled event comes back → same row re-activated (unique external ref)
    await sync_feed(db, feed, body=_ics(("evt-b@playo", run[2].start_at, run[2].end_at, "")))
    await db.refresh(blocks["evt-b@playo"])
    assert blocks["evt-b@playo"].status == "active"
    await db.refresh(blocks["evt-a@playo"])
    assert blocks["evt-a@playo"].status == "cancelled"


async def test_feed_create_via_api_and_worker_failures(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    run = future_run(await gen_slots(db, pitch), 1)
    ics = _ics(("gcal-1", run[0].start_at, run[0].end_at, ""))
    calls: list[httpx.Request] = []
    state = {"mode": "ok"}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if state["mode"] == "down":
            return httpx.Response(500)
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, content=ics, headers={"ETag": '"v1"', "Content-Type": "text/calendar"})

    fetch.install_test_hooks(resolver=public_resolver, transport=httpx.MockTransport(handler))
    bad = await client.post(f"{API}/partner/channels/feeds", headers=partner_headers(owner), json={
        "pitch_id": str(pitch.id), "name": "GCal", "source": "other_app", "url": "https://10.0.0.5/cal.ics"})
    assert bad.status_code == 400
    resp = await client.post(f"{API}/partner/channels/feeds", headers=partner_headers(owner), json={
        "pitch_id": str(pitch.id), "name": "GCal", "source": "other_app",
        "url": "webcal://calendar.example.com/private-abc123/basic.ics"})
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["url_hint"] == "calendar.example.com/…/basic.ics" and "abc123" not in str(out)
    assert out["last_status"] == "ok" and out["last_event_count"] == 1
    feed = await db.get(ChannelFeed, uuid.UUID(out["id"]))
    assert "abc123" not in feed.url_enc  # stored encrypted
    await db.refresh(run[0])
    assert run[0].status == "blocked"
    assert str(calls[0].url).startswith("https://calendar.example.com/")

    # worker: due feeds only; conditional GET uses the ETag
    assert await import_ical_feeds(db) == 0
    feed.last_synced_at = utcnow() - timedelta(minutes=10)
    await db.commit()
    assert await import_ical_feeds(db) == 1
    assert calls[-1].headers.get("if-none-match") == '"v1"'

    # 3 consecutive failures → error status + owner alert (once)
    state["mode"] = "down"
    for _ in range(4):
        feed.last_synced_at = utcnow() - timedelta(minutes=10)
        await db.commit()
        await import_ical_feeds(db)
        await db.refresh(feed)
    assert feed.last_status == "error" and feed.consecutive_failures == 4 and "500" in feed.last_error
    assert await db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == owner.id, Notification.type == "channel_feed_error")) == 1
    await db.refresh(run[0])
    assert run[0].status == "blocked"  # failing feeds never drop existing blocks
    overview = (await client.get(f"{API}/partner/channels", headers=partner_headers(owner))).json()
    assert overview["feeds"][0]["last_status"] == "error"
    assert overview["api_base_url"].endswith("/api/v1/channel/v1")
    dash = (await client.get(f"{API}/partner/dashboard", headers=partner_headers(owner))).json()
    assert dash["alerts"]["failing_feeds"] == 1

    assert (await client.delete(f"{API}/partner/channels/feeds/{feed.id}",
                                headers=partner_headers(owner))).status_code == 204
    await db.refresh(run[0])
    assert run[0].status == "available"


@pytest.mark.parametrize("url", [
    "https://127.0.0.1/cal.ics", "https://10.0.0.5/cal.ics", "http://calendar.example.com/cal.ics",
    "https://169.254.169.254/latest/meta-data/", "https://[::1]/x", "https://user:pw@calendar.example.com/x",
    "https://localhost/x", "https://intranet/x", "ftp://calendar.example.com/x", "https://calendar.example.com:22/x",
    "https://0.0.0.0/x", "https://[::ffff:127.0.0.1]/x", "https://100.64.0.1/x",
])
async def test_ssrf_guard_rejects_unsafe_urls(url):
    fetch.install_test_hooks(resolver=public_resolver)
    with pytest.raises(fetch.UnsafeUrl):
        await fetch.validate_public_url(url)


async def test_ssrf_guard_dns_and_redirects():
    async def private(host: str, port: int) -> list[str]:
        return ["93.184.216.34", "10.1.2.3"]  # any private answer poisons the whole name

    fetch.install_test_hooks(resolver=private)
    with pytest.raises(fetch.UnsafeUrl):
        await fetch.validate_public_url("https://calendar.example.com/x")

    def redirecting(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "https://169.254.169.254/latest/meta-data/"})

    fetch.install_test_hooks(resolver=public_resolver, transport=httpx.MockTransport(redirecting))
    with pytest.raises(fetch.UnsafeUrl):
        await fetch.safe_get("https://calendar.example.com/x")

    def huge(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * (fetch.MAX_BYTES + 10))

    fetch.install_test_hooks(resolver=public_resolver, transport=httpx.MockTransport(huge))
    with pytest.raises(fetch.FetchError):
        await fetch.safe_get("https://calendar.example.com/x")
    assert fetch.is_public_ip("93.184.216.34") and not fetch.is_public_ip("172.16.0.1")
    assert await fetch.validate_public_url("https://93.184.216.34/ok.ics") == "https://93.184.216.34/ok.ics"
