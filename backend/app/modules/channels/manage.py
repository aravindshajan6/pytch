"""Partner-portal management of channels: iCal feeds (import), iCal exports, API keys, webhooks, conflicts."""

import time
import uuid
from datetime import timedelta

import orjson
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt, encrypt, keyed_hash, random_token, sign_payload
from app.core.errors import AppError, Conflict, NotFound
from app.core.ratelimit import enforce
from app.core.timeutils import utcnow
from app.modules.audit import service as audit
from app.modules.channels import fetch, ical, service
from app.modules.channels.models import ChannelFeed, ProviderApiKey, ProviderWebhook, SlotBlock, SyncConflict
from app.modules.channels.schemas import (
    ApiKeyOut,
    ChannelsOverview,
    CreateApiKeyRequest,
    CreatedApiKey,
    CreatedWebhook,
    CreateFeedRequest,
    CreateWebhookRequest,
    ExportOut,
    FeedOut,
    ResolveConflictRequest,
    SyncConflictOut,
    UpdateFeedRequest,
    WebhookOut,
    WebhookTestResult,
)
from app.modules.lobbies.models import Lobby
from app.modules.partner.deps import PartnerContext
from app.modules.partner.scope import get_pitch, partner_actor, scoped_pitches
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch

MAX_FEEDS = 30
MAX_API_KEYS = 10
MAX_WEBHOOKS = 5
API_KEY_PREFIX = "pk_live_"


def api_base_url() -> str:
    return f"{settings.public_web_url.rstrip('/')}{settings.api_prefix}/channel/v1"


def export_url(token: str) -> str:
    return f"{settings.public_web_url.rstrip('/')}{settings.api_prefix}/ical/{token}.ics"


async def _audit(db: AsyncSession, ctx: PartnerContext, action: str, summary: str, *, target_type: str,
                 target_id: object, changes: dict | None = None) -> None:
    actor = partner_actor(ctx)
    await audit.record(db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label, action=action,
                       summary=summary, target_type=target_type, target_id=target_id, changes=changes)


# ─────────────────────────── serialisation ───────────────────────────


def feed_out(feed: ChannelFeed, pitch: Pitch) -> FeedOut:
    return FeedOut(
        id=feed.id, pitch_id=feed.pitch_id, pitch_name=pitch.name, turf_name=pitch.turf.name, name=feed.name,
        source=feed.source, url_hint=feed.url_hint, is_active=feed.is_active,  # type: ignore[arg-type]
        last_synced_at=feed.last_synced_at, last_status=feed.last_status,  # type: ignore[arg-type]
        last_error=feed.last_error, last_event_count=feed.last_event_count,
    )


def export_out(pitch: Pitch) -> ExportOut:
    return ExportOut(pitch_id=pitch.id, pitch_name=pitch.name, turf_name=pitch.turf.name,
                     ical_url=export_url(pitch.ical_export_token) if pitch.ical_export_token else None)


def api_key_out(key: ProviderApiKey) -> ApiKeyOut:
    return ApiKeyOut(id=key.id, name=key.name, prefix=key.prefix, scopes=list(key.scopes),  # type: ignore[arg-type]
                     last_used_at=key.last_used_at, created_at=key.created_at, revoked_at=key.revoked_at)


def webhook_out(hook: ProviderWebhook) -> WebhookOut:
    return WebhookOut(id=hook.id, url=hook.url, events=list(hook.events), is_active=hook.is_active,  # type: ignore[arg-type]
                      last_delivery_at=hook.last_delivery_at, last_status_code=hook.last_status_code,
                      consecutive_failures=hook.consecutive_failures)


async def conflict_outs(db: AsyncSession, conflicts: list[SyncConflict]) -> list[SyncConflictOut]:
    pitch_ids = {c.pitch_id for c in conflicts}
    lobby_ids = {c.lobby_id for c in conflicts if c.lobby_id}
    pitches = {p.id: p for p in (await db.execute(select(Pitch).where(Pitch.id.in_(pitch_ids)))).unique()
               .scalars().all()} if pitch_ids else {}
    lobbies = {lid: (title, status) for lid, title, status in (await db.execute(
        select(Lobby.id, Lobby.title, Lobby.status).where(Lobby.id.in_(lobby_ids)))).all()} if lobby_ids else {}
    # no Pytch game involved → the slot is held by another block (walk-in, phone, maintenance…)
    slot_ids = {c.slot_id for c in conflicts if c.lobby_id is None and c.slot_id}
    holders = {sid: (kind, source) for sid, kind, source in (await db.execute(
        select(Slot.id, SlotBlock.kind, SlotBlock.source).join(SlotBlock, SlotBlock.id == Slot.block_id)
        .where(Slot.id.in_(slot_ids)))).all()} if slot_ids else {}
    out = []
    for c in conflicts:
        pitch = pitches.get(c.pitch_id)
        lobby = lobbies.get(c.lobby_id) if c.lobby_id else None
        holder = holders.get(c.slot_id) if c.slot_id and not c.lobby_id else None
        out.append(SyncConflictOut(
            id=c.id, pitch_name=pitch.name if pitch else "", turf_name=pitch.turf.name if pitch else "",
            source=c.source, external_ref=c.external_ref, external_start_at=c.external_start_at,  # type: ignore[arg-type]
            external_end_at=c.external_end_at, summary=c.summary, lobby_id=c.lobby_id,
            lobby_title=lobby[0] if lobby else None,
            holder_kind="pytch" if c.lobby_id else ("block" if holder else None),
            lobby_status=lobby[1] if lobby else None,  # type: ignore[arg-type]
            holder_source=holder[1] if holder else None,  # type: ignore[arg-type]
            holder_label=lobby[0] if lobby else (service.block_label(*holder) if holder else None),
            status=c.status, resolution=c.resolution, resolution_note=c.resolution_note,  # type: ignore[arg-type]
            created_at=c.created_at,
        ))
    return out


# ─────────────────────────── overview ───────────────────────────


async def overview(db: AsyncSession, ctx: PartnerContext) -> ChannelsOverview:
    pitches = await scoped_pitches(db, ctx)
    by_id = {p.id: p for p in pitches}
    feeds = (await db.scalars(
        select(ChannelFeed).where(ChannelFeed.provider_id == ctx.provider.id).order_by(ChannelFeed.created_at)
    )).all()
    is_owner = ctx.role == "owner"
    keys = (await db.scalars(
        select(ProviderApiKey).where(ProviderApiKey.provider_id == ctx.provider.id)
        .order_by(ProviderApiKey.created_at.desc())
    )).all() if is_owner else []
    hooks = (await db.scalars(
        select(ProviderWebhook).where(ProviderWebhook.provider_id == ctx.provider.id)
        .order_by(ProviderWebhook.created_at)
    )).all() if is_owner else []
    open_conflicts = await db.scalar(
        select(func.count(SyncConflict.id)).where(
            SyncConflict.provider_id == ctx.provider.id, SyncConflict.status == "open",
            SyncConflict.pitch_id.in_(list(by_id) or [uuid.uuid4()]),
        )
    ) or 0
    return ChannelsOverview(
        feeds=[feed_out(f, by_id[f.pitch_id]) for f in feeds if f.pitch_id in by_id],
        exports=[export_out(p) for p in pitches if p.is_active],
        api_keys=[api_key_out(k) for k in keys],
        webhooks=[webhook_out(h) for h in hooks],
        open_conflicts=int(open_conflicts),
        api_base_url=api_base_url(),
    )


# ─────────────────────────── feeds ───────────────────────────


async def _get_feed(db: AsyncSession, ctx: PartnerContext, feed_id: uuid.UUID) -> tuple[ChannelFeed, Pitch]:
    feed = await db.get(ChannelFeed, feed_id)
    if feed is None or feed.provider_id != ctx.provider.id:
        raise NotFound("Feed not found")
    pitch = await get_pitch(db, ctx, feed.pitch_id)  # staff scoping
    return feed, pitch


async def create_feed(db: AsyncSession, ctx: PartnerContext, req: CreateFeedRequest) -> FeedOut:
    pitch = await get_pitch(db, ctx, req.pitch_id)
    count = await db.scalar(select(func.count(ChannelFeed.id)).where(ChannelFeed.provider_id == ctx.provider.id))
    if (count or 0) >= MAX_FEEDS:
        raise Conflict(f"You can connect at most {MAX_FEEDS} calendars")
    await enforce(f"feed-create:{ctx.provider.id}", 20, 3600, "Too many calendar connections — try again later")
    url = await fetch.validate_public_url(req.url)
    try:  # validate by fetching + parsing once
        result = await fetch.safe_get(url)
        now = utcnow()
        events = ical.parse_feed(result.body, window_start=now,
                                 window_end=now + timedelta(days=service.IMPORT_WINDOW_DAYS))
    except (fetch.FetchError, ical.FeedParseError) as exc:
        raise AppError(f"Couldn't read that calendar: {exc}", code="VALIDATION_ERROR", status_code=400) from exc
    feed = ChannelFeed(
        id=uuid.uuid4(), provider_id=ctx.provider.id, pitch_id=pitch.id, name=req.name, source=req.source,
        url_enc=encrypt(url), url_hint=fetch.url_hint(url), is_active=True, consecutive_failures=0,
        last_event_count=len(events),
    )
    db.add(feed)
    await db.flush([feed])
    await _audit(db, ctx, "channel.feed_create", f"Connected calendar “{req.name}” to {pitch.name}",
                 target_type="channel_feed", target_id=feed.id,
                 changes={"pitch_id": str(pitch.id), "source": req.source, "url_hint": feed.url_hint})
    await db.commit()
    await service.sync_feed(db, feed, body=result.body, etag=result.etag)
    return feed_out(feed, pitch)


async def update_feed(db: AsyncSession, ctx: PartnerContext, feed_id: uuid.UUID, req: UpdateFeedRequest) -> FeedOut:
    feed, pitch = await _get_feed(db, ctx, feed_id)
    changes = {}
    if req.name is not None and req.name != feed.name:
        changes["name"] = [feed.name, req.name]
        feed.name = req.name
    if req.is_active is not None and req.is_active != feed.is_active:
        changes["is_active"] = [feed.is_active, req.is_active]
        feed.is_active = req.is_active
        if req.is_active:
            feed.consecutive_failures = 0
    if changes:
        await _audit(db, ctx, "channel.feed_update", f"Updated calendar “{feed.name}”", target_type="channel_feed",
                     target_id=feed.id, changes=changes)
    await db.commit()
    return feed_out(feed, pitch)


async def delete_feed(db: AsyncSession, ctx: PartnerContext, feed_id: uuid.UUID) -> None:
    feed, pitch = await _get_feed(db, ctx, feed_id)
    blocks = (await db.scalars(
        select(SlotBlock).where(SlotBlock.feed_id == feed.id, SlotBlock.status.in_(service.LIVE_BLOCK_STATUSES),
                                SlotBlock.end_at > utcnow())
    )).all()
    for b in blocks:  # imported bookings disappear with their source
        await service.cancel_block_rows(db, b)
    await service.close_obsolete_conflicts(db, SyncConflict.feed_id == feed.id,
                                           note=f"Auto-closed: calendar “{feed.name}” was disconnected")
    await _audit(db, ctx, "channel.feed_delete", f"Disconnected calendar “{feed.name}” ({len(blocks)} blocks freed)",
                 target_type="channel_feed", target_id=feed.id, changes={"pitch_id": str(pitch.id)})
    await db.delete(feed)
    await db.commit()


async def sync_feed_now(db: AsyncSession, ctx: PartnerContext, feed_id: uuid.UUID) -> FeedOut:
    feed, pitch = await _get_feed(db, ctx, feed_id)
    await enforce(f"feed-sync:{feed.id}", 1, 15, "This calendar was just synced — try again in a few seconds")
    await service.sync_feed(db, feed)
    await db.refresh(feed)
    return feed_out(feed, pitch)


# ─────────────────────────── exports ───────────────────────────


async def rotate_export(db: AsyncSession, ctx: PartnerContext, pitch_id: uuid.UUID) -> ExportOut:
    pitch = await get_pitch(db, ctx, pitch_id)
    rotated = pitch.ical_export_token is not None
    pitch.ical_export_token = random_token(24)
    await _audit(db, ctx, "channel.export_rotate" if rotated else "channel.export_create",
                 f"{'Rotated' if rotated else 'Enabled'} iCal export for {pitch.name}", target_type="pitch",
                 target_id=pitch.id)
    await db.commit()
    return export_out(pitch)


async def disable_export(db: AsyncSession, ctx: PartnerContext, pitch_id: uuid.UUID) -> None:
    pitch = await get_pitch(db, ctx, pitch_id)
    if pitch.ical_export_token is None:
        return
    pitch.ical_export_token = None
    await _audit(db, ctx, "channel.export_disable", f"Disabled iCal export for {pitch.name}", target_type="pitch",
                 target_id=pitch.id)
    await db.commit()


# ─────────────────────────── API keys ───────────────────────────


async def create_api_key(db: AsyncSession, ctx: PartnerContext, req: CreateApiKeyRequest) -> CreatedApiKey:
    active = await db.scalar(select(func.count(ProviderApiKey.id)).where(
        ProviderApiKey.provider_id == ctx.provider.id, ProviderApiKey.revoked_at.is_(None)))
    if (active or 0) >= MAX_API_KEYS:
        raise Conflict(f"At most {MAX_API_KEYS} active API keys — revoke one first")
    raw = API_KEY_PREFIX + random_token(24)
    key = ProviderApiKey(
        id=uuid.uuid4(), provider_id=ctx.provider.id, name=req.name, prefix=raw[:16], key_hash=keyed_hash(raw),
        scopes=sorted(set(req.scopes)), created_by_user_id=ctx.user.id, created_at=utcnow(),
    )
    db.add(key)
    await db.flush([key])
    await _audit(db, ctx, "channel.api_key_create", f"Created API key “{req.name}” ({key.prefix}…)",
                 target_type="provider_api_key", target_id=key.id, changes={"scopes": key.scopes})
    await db.commit()
    return CreatedApiKey(key=raw, api_key=api_key_out(key))


async def revoke_api_key(db: AsyncSession, ctx: PartnerContext, key_id: uuid.UUID) -> None:
    key = await db.get(ProviderApiKey, key_id)
    if key is None or key.provider_id != ctx.provider.id:
        raise NotFound("API key not found")
    if key.revoked_at is None:
        key.revoked_at = utcnow()
        await _audit(db, ctx, "channel.api_key_revoke", f"Revoked API key “{key.name}” ({key.prefix}…)",
                     target_type="provider_api_key", target_id=key.id)
        await db.commit()


# ─────────────────────────── webhooks ───────────────────────────


async def create_webhook(db: AsyncSession, ctx: PartnerContext, req: CreateWebhookRequest) -> CreatedWebhook:
    count = await db.scalar(select(func.count(ProviderWebhook.id)).where(
        ProviderWebhook.provider_id == ctx.provider.id))
    if (count or 0) >= MAX_WEBHOOKS:
        raise Conflict(f"At most {MAX_WEBHOOKS} webhooks")
    url = await fetch.validate_public_url(req.url)
    secret = "whsec_" + random_token(24)
    hook = ProviderWebhook(
        id=uuid.uuid4(), provider_id=ctx.provider.id, url=url[:500], secret_enc=encrypt(secret),
        events=sorted(set(req.events)), is_active=True, consecutive_failures=0,
    )
    db.add(hook)
    await db.flush([hook])
    await _audit(db, ctx, "channel.webhook_create", f"Added webhook {fetch.url_hint(url)}",
                 target_type="provider_webhook", target_id=hook.id, changes={"events": hook.events})
    await db.commit()
    await db.refresh(hook)
    return CreatedWebhook(secret=secret, webhook=webhook_out(hook))


async def _get_webhook(db: AsyncSession, ctx: PartnerContext, hook_id: uuid.UUID) -> ProviderWebhook:
    hook = await db.get(ProviderWebhook, hook_id)
    if hook is None or hook.provider_id != ctx.provider.id:
        raise NotFound("Webhook not found")
    return hook


async def delete_webhook(db: AsyncSession, ctx: PartnerContext, hook_id: uuid.UUID) -> None:
    hook = await _get_webhook(db, ctx, hook_id)
    await _audit(db, ctx, "channel.webhook_delete", f"Removed webhook {fetch.url_hint(hook.url)}",
                 target_type="provider_webhook", target_id=hook.id)
    await db.delete(hook)
    await db.commit()


def signed_headers(secret: str, body: bytes, event: str, delivery_id: str) -> dict[str, str]:
    ts = int(time.time())
    return {
        "Content-Type": "application/json",
        "User-Agent": fetch.USER_AGENT,
        "X-Pytch-Event": event,
        "X-Pytch-Delivery": delivery_id,
        "X-Pytch-Signature": f"t={ts},v1={sign_payload(secret, body, ts)}",
    }


async def test_webhook(db: AsyncSession, ctx: PartnerContext, hook_id: uuid.UUID) -> WebhookTestResult:
    hook = await _get_webhook(db, ctx, hook_id)
    await enforce(f"webhook-test:{hook.id}", 5, 60, "Too many test deliveries — wait a minute")
    now = utcnow()
    delivery_id = f"evt_test_{uuid.uuid4().hex[:16]}"
    body = orjson.dumps({"id": delivery_id, "event": "ping", "occurred_at": now.isoformat(), "pitch_id": None,
                         "start_at": None, "end_at": None, "status": "test"})
    try:
        code: int | None = await fetch.safe_post(hook.url, body, signed_headers(decrypt(hook.secret_enc), body,
                                                                                "ping", delivery_id))
    except (fetch.FetchError, fetch.UnsafeUrl):
        code = None
    hook.last_delivery_at, hook.last_status_code = now, code
    await db.commit()
    return WebhookTestResult(status_code=code, ok=code is not None and 200 <= code < 300)


# ─────────────────────────── conflicts ───────────────────────────


async def list_conflicts(db: AsyncSession, ctx: PartnerContext, status: str | None) -> list[SyncConflictOut]:
    pitch_ids = [p.id for p in await scoped_pitches(db, ctx)]
    if not pitch_ids:
        return []
    q = select(SyncConflict).where(SyncConflict.provider_id == ctx.provider.id, SyncConflict.pitch_id.in_(pitch_ids))
    if status:
        q = q.where(SyncConflict.status == status)
    conflicts = (await db.scalars(q.order_by(SyncConflict.created_at.desc()).limit(200))).all()
    return await conflict_outs(db, list(conflicts))


async def resolve_conflict(db: AsyncSession, ctx: PartnerContext, conflict_id: uuid.UUID,
                           req: ResolveConflictRequest) -> SyncConflictOut:
    conflict = await db.get(SyncConflict, conflict_id, with_for_update=True)
    if conflict is None or conflict.provider_id != ctx.provider.id:
        raise NotFound("Conflict not found")
    await get_pitch(db, ctx, conflict.pitch_id)  # staff scoping
    if conflict.status != "open":
        raise Conflict("This conflict closed itself — one of the bookings is gone" if conflict.status == "obsolete"
                       else "This conflict is already resolved")
    conflict.status = "ignored" if req.resolution == "ignored" else "resolved"
    conflict.resolution = req.resolution
    conflict.resolution_note = req.note
    conflict.resolved_at = utcnow()
    conflict.resolved_by_user_id = ctx.user.id
    await _audit(db, ctx, "channel.conflict_resolve", f"Conflict resolved: {req.resolution} — {conflict.summary}",
                 target_type="sync_conflict", target_id=conflict.id, changes={"resolution": req.resolution})
    await db.commit()
    return (await conflict_outs(db, [conflict]))[0]
