"""Channel API (integrators): API-key auth, scopes, per-key rate limit, idempotency, and the use-cases."""

import hashlib
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import orjson
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import constant_time_equals, keyed_hash
from app.core.deps import DB, Credentials
from app.core.errors import AppError, Conflict, Forbidden, NotFound, Unauthorized
from app.core.ratelimit import enforce
from app.core.redis import get_redis
from app.core.timeutils import ist_day_bounds, utcnow
from app.modules.audit import service as audit
from app.modules.channels import service
from app.modules.channels.models import ProviderApiKey, SlotBlock
from app.modules.channels.schemas import AvailabilityOut, ChannelBlockOut, ChannelBlockRequest, ChannelPitchOut
from app.modules.partner.deps import ProviderNotApproved
from app.modules.providers.models import Provider
from app.modules.slots.models import Slot
from app.modules.slots.service import SlotUnavailable
from app.modules.turfs.models import Pitch, Turf

RATE_LIMIT_PER_MINUTE = 120
IDEMPOTENCY_TTL = 24 * 3600
_KEY_RE = re.compile(r"^pk_live_[A-Za-z0-9_-]{20,64}$")
_IDEM_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,100}$")


@dataclass
class ApiKeyContext:
    key: ProviderApiKey
    provider: Provider

    @property
    def actor(self) -> service.Actor:
        return service.Actor(type="api_key", id=self.key.id,
                             label=f"API key {self.key.prefix}… “{self.key.name}” @ {self.provider.name}")


async def get_api_key(db: DB, creds: Credentials) -> ApiKeyContext:
    if creds is None:
        raise Unauthorized("API key required")
    raw = creds.credentials.strip()
    if not _KEY_RE.match(raw):
        raise Unauthorized("Invalid API key")
    digest = keyed_hash(raw)
    key = await db.scalar(select(ProviderApiKey).where(ProviderApiKey.key_hash == digest))
    if key is None or not constant_time_equals(key.key_hash, digest) or key.revoked_at is not None:
        raise Unauthorized("Invalid API key")
    provider = await db.get(Provider, key.provider_id)
    if provider is None or provider.status != "approved":
        raise ProviderNotApproved()
    await enforce(f"channel-api:{key.id}", RATE_LIMIT_PER_MINUTE, 60,
                  f"API rate limit exceeded ({RATE_LIMIT_PER_MINUTE} requests/min)")
    now = utcnow()
    if key.last_used_at is None or now - key.last_used_at > timedelta(minutes=1):
        key.last_used_at = now
        await db.commit()
    return ApiKeyContext(key=key, provider=provider)


def require_scope(scope: str) -> Callable[..., Awaitable[ApiKeyContext]]:
    async def _dep(ctx: ApiKeyContext = Depends(get_api_key)) -> ApiKeyContext:
        if scope not in (ctx.key.scopes or []):
            raise Forbidden(f"This API key lacks the “{scope}” scope")
        return ctx

    return _dep


async def idempotent(
    ctx: ApiKeyContext,
    idem_key: str | None,
    operation: str,
    body: dict[str, Any],
    handler: Callable[[], Awaitable[tuple[int, Any]]],
) -> tuple[int, Any]:
    """Replay the stored response for a repeated `Idempotency-Key` (same key + same request → same answer;
    same key + different request → 422; concurrent duplicate → 409). Errors aren't stored (safe to retry)."""
    if idem_key is None:
        return await handler()
    if not _IDEM_RE.match(idem_key):
        raise AppError("Idempotency-Key must be 1–100 characters of [A-Za-z0-9_.:-]", code="VALIDATION_ERROR",
                       status_code=422)
    redis = get_redis()
    rkey = f"pytch:idem:{ctx.key.id}:{hashlib.sha256(idem_key.encode()).hexdigest()}"
    fingerprint = hashlib.sha256(orjson.dumps([operation, body], option=orjson.OPT_SORT_KEYS)).hexdigest()

    async def replay(raw: str) -> tuple[int, Any]:
        stored = orjson.loads(raw)
        if stored.get("fp") != fingerprint:
            raise AppError("This Idempotency-Key was already used for a different request",
                           code="VALIDATION_ERROR", status_code=422)
        if stored.get("pending"):
            raise Conflict("A request with this Idempotency-Key is still being processed")
        return int(stored["status"]), stored["body"]

    if not await redis.set(rkey, orjson.dumps({"fp": fingerprint, "pending": True}), nx=True, ex=60):
        existing = await redis.get(rkey)
        if existing:
            return await replay(existing)
    try:
        status, payload = await handler()
    except BaseException:
        await redis.delete(rkey)
        raise
    await redis.set(rkey, orjson.dumps({"fp": fingerprint, "status": status, "body": payload}), ex=IDEMPOTENCY_TTL)
    return status, payload


# ─────────────────────────── use-cases ───────────────────────────


async def _pitch(db: AsyncSession, ctx: ApiKeyContext, pitch_id: uuid.UUID) -> Pitch:
    pitch = await db.get(Pitch, pitch_id)
    if pitch is None or pitch.turf.provider_id != ctx.provider.id or not pitch.is_active:
        raise NotFound("Pitch not found")
    return pitch


async def list_pitches(db: AsyncSession, ctx: ApiKeyContext) -> list[ChannelPitchOut]:
    rows = (
        await db.execute(
            select(Pitch)
            .join(Turf, Turf.id == Pitch.turf_id)
            .where(Turf.provider_id == ctx.provider.id, Pitch.is_active.is_(True), Turf.is_active.is_(True))
            .order_by(Turf.name, Pitch.name)
        )
    ).unique().scalars().all()
    return [ChannelPitchOut(id=p.id, turf_id=p.turf_id, turf_name=p.turf.name, name=p.name, sport=p.sport,
                            format=p.format, capacity=p.capacity, is_indoor=p.is_indoor) for p in rows]


async def availability(db: AsyncSession, ctx: ApiKeyContext, pitch_id: uuid.UUID, day: date) -> list[AvailabilityOut]:
    pitch = await _pitch(db, ctx, pitch_id)
    start, end = ist_day_bounds(day)
    rows = (
        await db.execute(
            select(Slot.start_at, Slot.end_at, Slot.status)
            .where(Slot.pitch_id == pitch.id, Slot.start_at >= start, Slot.start_at < end)
            .order_by(Slot.start_at)
        )
    ).all()
    now = utcnow()
    return [AvailabilityOut(start_at=s, end_at=e, available=status == "available" and s > now) for s, e, status in rows]


def _block_out(block: SlotBlock) -> dict[str, Any]:
    return ChannelBlockOut(
        id=block.id, pitch_id=block.pitch_id, start_at=block.start_at, end_at=block.end_at,
        source=block.source, external_ref=block.external_ref, status=block.status,  # type: ignore[arg-type]
    ).model_dump(mode="json")


async def create_block(db: AsyncSession, ctx: ApiKeyContext, req: ChannelBlockRequest) -> tuple[int, dict[str, Any]]:
    pitch = await _pitch(db, ctx, req.pitch_id)
    now = utcnow()
    service.validate_range(pitch, req.start_at, req.end_at, now)
    await service.ensure_slots_until(db, pitch, req.end_at)
    if not [s for s in await service.covered_slots(db, pitch.id, req.start_at, req.end_at) if s.end_at > now]:
        raise service.BlockInvalid("There are no bookable hours in that range")
    source = req.source or "api"
    result = await service.sync_external_block(
        db, provider_id=ctx.provider.id, pitch=pitch, source=source, external_ref=req.external_ref,
        start=req.start_at, end=req.end_at, customer_name=req.customer_name, api_key_id=ctx.key.id, strict=True,
    )
    if result.outcome == "conflict":
        # rejected, not double booked: no SyncConflict / owner alert (strict mode records nothing); keep any slots
        # materialised above and release the row locks
        await db.commit()
        raise SlotUnavailable("That time overlaps an existing booking",
                              details={"slot_ids": [str(i) for i in result.conflict_slot_ids]})
    assert result.block is not None
    if result.outcome != "unchanged":
        actor = ctx.actor
        await audit.record(
            db, actor_type=actor.type, actor_id=actor.id, actor_label=actor.label,
            action="block.api_upsert", target_type="slot_block", target_id=result.block.id,
            summary=f"{service.SOURCE_LABELS.get(source, source)} booking {result.outcome} via API on {pitch.name}, "
                    f"{service.when_label(req.start_at, req.end_at)}",
            changes={"external_ref": req.external_ref, "outcome": result.outcome},
        )
    await db.commit()
    return (201 if result.outcome == "created" else 200), _block_out(result.block)


async def cancel_block(db: AsyncSession, ctx: ApiKeyContext, external_ref: str) -> tuple[int, None]:
    blocks = (
        await db.scalars(
            select(SlotBlock)
            .where(SlotBlock.provider_id == ctx.provider.id, SlotBlock.external_ref == external_ref,
                   SlotBlock.api_key_id.is_not(None))
            .with_for_update()
        )
    ).all()
    if not blocks:
        raise NotFound("Block not found")
    for block in blocks:
        if block.status in service.LIVE_BLOCK_STATUSES:
            await service.cancel_block(db, block=block, actor=ctx.actor, reason="cancelled via API")
    return 204, None
