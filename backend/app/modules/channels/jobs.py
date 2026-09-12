"""Worker jobs: iCal feed polling and signed webhook delivery (see `app.worker.JOBS`)."""

import uuid
from datetime import timedelta

import orjson
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt
from app.core.logging import logger
from app.core.timeutils import utcnow
from app.modules.audit import service as audit
from app.modules.channels import fetch
from app.modules.channels.manage import signed_headers
from app.modules.channels.models import ChannelFeed, ProviderWebhook, WebhookDelivery
from app.modules.channels.service import sync_feed
from app.modules.notifications.service import notify_many
from app.modules.providers.models import Provider
from app.modules.providers.service import owner_user_ids

FEED_BATCH = 50
WEBHOOK_BATCH = 50
WEBHOOK_LEASE = timedelta(minutes=2)  # a claimed delivery isn't picked up again while in flight
WEBHOOK_DISABLE_AFTER = 25  # consecutive failed attempts across deliveries
BACKOFF_BASE_SECONDS = 60
BACKOFF_MAX_SECONDS = 12 * 3600


def backoff(attempts: int) -> timedelta:
    """1 min, 3 min, 9 min, 27 min, 81 min, 4 h, 12 h …"""
    return timedelta(seconds=min(BACKOFF_BASE_SECONDS * 3 ** max(attempts - 1, 0), BACKOFF_MAX_SECONDS))


async def import_ical_feeds(db: AsyncSession) -> int:
    """Poll every due feed (last sync older than ICAL_IMPORT_INTERVAL_MINUTES). One feed failing never affects
    another: each runs in its own transaction and unexpected errors are contained."""
    now = utcnow()
    cutoff = now - timedelta(minutes=settings.ical_import_interval_minutes)
    feed_ids = (
        await db.scalars(
            select(ChannelFeed.id)
            .join(Provider, Provider.id == ChannelFeed.provider_id)
            .where(
                ChannelFeed.is_active.is_(True),
                Provider.status == "approved",
                or_(ChannelFeed.last_synced_at.is_(None), ChannelFeed.last_synced_at <= cutoff),
            )
            .order_by(ChannelFeed.last_synced_at.asc().nulls_first())
            .limit(FEED_BATCH)
        )
    ).all()
    done = 0
    for feed_id in feed_ids:
        try:
            feed = await db.get(ChannelFeed, feed_id)
            if feed is None:
                continue
            await sync_feed(db, feed)
            done += 1
        except Exception:  # isolation: log, reset the session and carry on with the next feed
            logger.exception("channels: feed %s sync crashed", feed_id)
            await db.rollback()
            try:
                crashed = await db.get(ChannelFeed, feed_id)
                if crashed is not None:
                    crashed.last_synced_at = utcnow()
                    crashed.consecutive_failures = (crashed.consecutive_failures or 0) + 1
                    crashed.last_error = "Internal error while syncing"
                    await db.commit()
            except Exception:
                await db.rollback()
    return done


async def _disable_webhook(db: AsyncSession, hook: ProviderWebhook) -> None:
    hook.is_active = False
    owners = await owner_user_ids(db, hook.provider_id)
    await notify_many(db, owners, "channel_webhook_disabled", "Webhook paused",
                      f"{fetch.url_hint(hook.url)} failed {hook.consecutive_failures} times in a row and was paused.",
                      {"url": "/partner/channels", "webhook_id": hook.id})
    await audit.record(db, actor_type="system", actor_id=None, actor_label="channel-sync",
                       action="channel.webhook_disabled", target_type="provider_webhook", target_id=hook.id,
                       summary=f"Webhook {fetch.url_hint(hook.url)} disabled after repeated failures",
                       changes={"provider_id": str(hook.provider_id), "failures": hook.consecutive_failures})


async def _deliver_one(db: AsyncSession, delivery_id: uuid.UUID) -> None:
    delivery = await db.get(WebhookDelivery, delivery_id)
    if delivery is None or delivery.status != "pending":
        return
    hook = await db.get(ProviderWebhook, delivery.webhook_id)
    if hook is None or not hook.is_active:
        delivery.status, delivery.last_error = "failed", "webhook disabled"
        await db.commit()
        return
    body = orjson.dumps(delivery.payload)
    headers = signed_headers(decrypt(hook.secret_enc), body, delivery.event, str(delivery.payload.get("id")))
    delivery.attempts += 1
    code: int | None = None
    error: str | None = None
    try:
        code = await fetch.safe_post(hook.url, body, headers)
    except (fetch.FetchError, fetch.UnsafeUrl) as exc:
        error = exc.message if isinstance(exc, fetch.UnsafeUrl) else str(exc)
    now = utcnow()
    hook.last_delivery_at, hook.last_status_code = now, code
    delivery.response_code = code
    if code is not None and 200 <= code < 300:
        delivery.status, delivery.last_error = "ok", None
        hook.consecutive_failures = 0
    else:
        delivery.last_error = (error or f"HTTP {code}")[:300]
        hook.consecutive_failures += 1
        if delivery.attempts >= settings.webhook_max_attempts:
            delivery.status = "failed"
        else:
            delivery.next_attempt_at = now + backoff(delivery.attempts)
        if hook.consecutive_failures >= WEBHOOK_DISABLE_AFTER and hook.is_active:
            await _disable_webhook(db, hook)
    await db.commit()


async def deliver_webhooks(db: AsyncSession) -> int:
    """Send due deliveries. Rows are claimed with SKIP LOCKED + a short lease, so several workers never send the
    same delivery concurrently and no row lock is held during the HTTP call."""
    now = utcnow()
    due = (
        await db.scalars(
            select(WebhookDelivery)
            .where(WebhookDelivery.status == "pending", WebhookDelivery.next_attempt_at <= now)
            .order_by(WebhookDelivery.next_attempt_at)
            .limit(WEBHOOK_BATCH)
            .with_for_update(skip_locked=True)
        )
    ).all()
    if not due:
        return 0
    ids = [d.id for d in due]
    for d in due:
        d.next_attempt_at = now + WEBHOOK_LEASE
    await db.commit()
    for delivery_id in ids:
        try:
            await _deliver_one(db, delivery_id)
        except Exception:
            logger.exception("channels: webhook delivery %s crashed", delivery_id)
            await db.rollback()
    return len(ids)
