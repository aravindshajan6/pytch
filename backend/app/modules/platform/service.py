"""Platform-wide runtime configuration, sports catalog and broadcasts.

Runtime settings
    `await get_setting(key)` returns the admin override stored in `app_settings` or, when there is
    none, the live default from `core.config.settings` (so env overrides / test monkeypatching keep
    working). Overrides are cached in Redis for a few seconds and invalidated on every change.

Sports catalog
    `sports_catalog` replaces the static `core.constants.SPORTS`; it is seeded from that constant the
    first time it is read while empty. `GET /meta` shows active sports only.

Broadcasts
    A segment (areas / sports / active within N days) → one in-app notification per active player.
    Large segments are delivered by a background task in batches.
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import orjson
from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import SPORTS
from app.core.database import SessionLocal
from app.core.errors import AppError, BadRequest, NotFound
from app.core.logging import logger
from app.core.redis import get_redis
from app.core.timeutils import utcnow
from app.modules.admin.auditing import Actor, audit
from app.modules.admin.models import AdminUser
from app.modules.audit import service as audit_service
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify_many
from app.modules.platform.models import AppSetting, Broadcast, SportCatalog
from app.modules.platform.schemas import (
    BroadcastInput,
    BroadcastOut,
    BroadcastSegment,
    BroadcastSegmentOut,
    SettingOut,
    SportCatalogInput,
    SportCatalogOut,
)
from app.modules.users.models import User

_SETTINGS_CACHE = "pytch:settings:v1"
_SETTINGS_TTL = 30
_SPORTS_CACHE = "pytch:meta:sports:v1"
_SPORTS_TTL = 60

# ═══════════════════════════ runtime settings ═══════════════════════════


@dataclass(frozen=True)
class SettingDef:
    key: str
    type: str  # bool | int | money | string
    label: str
    description: str
    default: Callable[[], Any]
    min: int | None = None
    max: int | None = None
    max_len: int = 200


def _cfg(name: str) -> Callable[[], Any]:
    return lambda: getattr(settings, name)


REGISTRY: dict[str, SettingDef] = {
    d.key: d
    for d in (
        SettingDef("bookings_enabled", "bool", "Bookings enabled",
                   "Kill switch — when off, players can't create new bookings (existing matches continue).",
                   lambda: True),
        SettingDef("signups_enabled", "bool", "Player sign-ups enabled",
                   "Kill switch — when off, new phone numbers can't create accounts (existing players still log in).",
                   lambda: True),
        SettingDef("partner_signups_enabled", "bool", "Partner applications enabled",
                   "Kill switch — when off, new venue partners can't submit applications.", lambda: True),
        SettingDef("channel_sync_enabled", "bool", "Automatic channel sync",
                   "Calendar-feed import/export, the Channel API and webhooks for venue partners. When off, partners "
                   "log bookings from other apps by hand (clash alerts stay on).", _cfg("channel_sync_enabled")),
        SettingDef("maintenance_banner", "string", "Maintenance banner",
                   "Message shown at the top of the player app. Empty = hidden.", lambda: None, max_len=200),
        SettingDef("split_window_minutes", "int", "Split payment window (min)",
                   "How long every player has to pay their share before a split booking expires.",
                   _cfg("split_window_minutes"), 5, 240),
        SettingDef("sub_discount_pct", "int", "Sub discount (%)",
                   "Discount a sub gets on the share when answering an SOS.", _cfg("sub_discount_pct"), 0, 90),
        SettingDef("sos_window_hours", "int", "Auto-SOS window (h)",
                   "A paid dropout within this many hours of kickoff raises an SOS automatically.",
                   _cfg("sos_window_hours"), 1, 72),
        SettingDef("rain_transfer_cover_paise", "money", "Rain transfer cover",
                   "Maximum price difference Pytch covers when moving a rained-out match indoors.",
                   _cfg("rain_transfer_cover_paise"), 0, 1_000_000),
        SettingDef("rain_bonus_paise", "money", "Rain-check bonus",
                   "Bonus credits each paid player receives when a match is rain-checked.",
                   _cfg("rain_bonus_paise"), 0, 200_000),
        SettingDef("default_commission_bps", "int", "Default commission (bps)",
                   "Commission for new venue partners, in basis points (1000 = 10%).",
                   _cfg("default_commission_bps"), 0, 5000),
        SettingDef("refund_dual_approval_paise", "money", "Dual-approval refund threshold",
                   "Refunds above this amount need a second admin to approve.",
                   _cfg("refund_dual_approval_paise"), 0, 100_000_000),
    )
}


class SignupsPaused(AppError):
    code, status_code, message = "SIGNUPS_PAUSED", 503, "New sign-ups are paused right now — please try again later"


async def _load_overrides(db: AsyncSession | None) -> dict[str, Any]:
    if db is not None:
        rows = (await db.execute(select(AppSetting.key, AppSetting.value))).all()
    else:
        async with SessionLocal() as own:
            rows = (await own.execute(select(AppSetting.key, AppSetting.value))).all()
    return {k: (v or {}).get("v") for k, v in rows if k in REGISTRY}


async def _overrides(db: AsyncSession | None = None) -> dict[str, Any]:
    try:
        raw = await get_redis().get(_SETTINGS_CACHE)
    except Exception:  # Redis down → read through to the DB
        raw = None
    if raw is not None:
        return orjson.loads(raw)
    data = await _load_overrides(db)
    try:
        await get_redis().set(_SETTINGS_CACHE, orjson.dumps(data), ex=_SETTINGS_TTL)
    except Exception:
        pass
    return data


async def get_setting(key: str, db: AsyncSession | None = None) -> Any:
    """Current value of a runtime setting (admin override, else config default)."""
    definition = REGISTRY[key]
    overrides = await _overrides(db)
    return overrides[key] if key in overrides else definition.default()


async def get_settings(keys: list[str], db: AsyncSession | None = None) -> dict[str, Any]:
    overrides = await _overrides(db)
    return {k: overrides[k] if k in overrides else REGISTRY[k].default() for k in keys}


async def invalidate_settings_cache() -> None:
    try:
        await get_redis().delete(_SETTINGS_CACHE)
    except Exception:
        logger.warning("settings cache invalidation failed")


async def ensure_signups_open(db: AsyncSession | None = None) -> None:
    """Raise 503 SIGNUPS_PAUSED when new player accounts are switched off."""
    if not await get_setting("signups_enabled", db):
        raise SignupsPaused()


async def ensure_partner_signups_open(db: AsyncSession | None = None) -> None:
    if not await get_setting("partner_signups_enabled", db):
        raise SignupsPaused("New venue partner applications are paused right now")


def _coerce(definition: SettingDef, value: Any) -> Any:
    t = definition.type
    if t == "bool":
        if not isinstance(value, bool):
            raise BadRequest(f"{definition.label} must be true or false")
        return value
    if t in ("int", "money"):
        if isinstance(value, bool) or not isinstance(value, int):
            raise BadRequest(f"{definition.label} must be a whole number")
        if definition.min is not None and value < definition.min:
            raise BadRequest(f"{definition.label} must be at least {definition.min}")
        if definition.max is not None and value > definition.max:
            raise BadRequest(f"{definition.label} must be at most {definition.max}")
        return value
    if value is None:
        return None
    if not isinstance(value, str):
        raise BadRequest(f"{definition.label} must be text")
    value = value.strip()
    if len(value) > definition.max_len:
        raise BadRequest(f"{definition.label} must be at most {definition.max_len} characters")
    return value or None


def _setting_out(definition: SettingDef, row: AppSetting | None, updated_by: str | None) -> SettingOut:
    has = row is not None and "v" in (row.value or {})
    return SettingOut(
        key=definition.key,
        value=row.value["v"] if has and row is not None else definition.default(),
        default=definition.default(),
        type=definition.type,  # type: ignore[arg-type]
        label=definition.label,
        description=definition.description,
        updated_by=updated_by,
        updated_at=row.updated_at if row is not None else None,
    )


async def list_settings(db: AsyncSession) -> list[SettingOut]:
    rows = (
        await db.execute(select(AppSetting, AdminUser.email).outerjoin(
            AdminUser, AdminUser.id == AppSetting.updated_by_admin_id))
    ).all()
    by_key = {row.key: (row, email) for row, email in rows}
    out = []
    for key, definition in REGISTRY.items():
        row, email = by_key.get(key, (None, None))
        out.append(_setting_out(definition, row, email))
    return out


async def put_setting(db: AsyncSession, ctx: Actor, key: str, value: Any, reason: str | None = None) -> SettingOut:
    definition = REGISTRY.get(key)
    if definition is None:
        raise NotFound("Unknown setting")
    new_value = _coerce(definition, value)
    row = await db.scalar(select(AppSetting).where(AppSetting.key == key).with_for_update())
    old_value = row.value.get("v") if row is not None and row.value else definition.default()
    now = utcnow()
    if row is None:
        row = AppSetting(key=key, value={"v": new_value}, updated_by_admin_id=ctx.admin.id, updated_at=now)
        db.add(row)
    else:
        row.value = {"v": new_value}
        row.updated_by_admin_id = ctx.admin.id
        row.updated_at = now
    summary = f"Changed {definition.label}" + (f" — {reason}" if reason else "")
    changes: dict[str, Any] = {key: [old_value, new_value]}
    if reason:
        changes["reason"] = reason
    await audit(db, ctx, "settings.update", summary, target_type="setting", target_id=key, changes=changes)
    await db.commit()
    await invalidate_settings_cache()
    return _setting_out(definition, row, ctx.admin.email)


# ═══════════════════════════ sports catalog ═══════════════════════════


async def _seed_catalog_if_empty() -> None:
    async with SessionLocal() as own:
        if await own.scalar(select(exists().select_from(SportCatalog))):
            return
        now = utcnow()
        await own.execute(
            insert(SportCatalog)
            .values([
                {"key": s["key"], "label": s["label"], "emoji": s["emoji"], "formats": list(s["formats"]),
                 "is_active": True, "sort_order": i * 10, "created_at": now, "updated_at": now}
                for i, s in enumerate(SPORTS)
            ])
            .on_conflict_do_nothing()
        )
        await own.commit()


def _sport_out(row: SportCatalog) -> SportCatalogOut:
    return SportCatalogOut(key=row.key, label=row.label, emoji=row.emoji, formats=list(row.formats or []),
                           is_active=row.is_active, sort_order=row.sort_order)


async def list_sports(db: AsyncSession, *, active_only: bool = False) -> list[SportCatalogOut]:
    await _seed_catalog_if_empty()
    stmt = select(SportCatalog).order_by(SportCatalog.sort_order, SportCatalog.key)
    if active_only:
        stmt = stmt.where(SportCatalog.is_active.is_(True))
    return [_sport_out(r) for r in (await db.scalars(stmt)).all()]


async def meta_sports() -> list[dict[str, Any]]:
    """Active sports for GET /meta (`SportMeta` shape), cached briefly."""
    try:
        raw = await get_redis().get(_SPORTS_CACHE)
        if raw is not None:
            return orjson.loads(raw)
    except Exception:
        pass
    async with SessionLocal() as own:
        rows = await list_sports(own, active_only=True)
    data = [{"key": r.key, "label": r.label, "emoji": r.emoji, "formats": r.formats} for r in rows]
    try:
        await get_redis().set(_SPORTS_CACHE, orjson.dumps(data), ex=_SPORTS_TTL)
    except Exception:
        pass
    return data


async def upsert_sport(db: AsyncSession, ctx: Actor, key: str, body: SportCatalogInput) -> SportCatalogOut:
    key = key.strip().lower()
    if not (2 <= len(key) <= 16 and key[0].isalpha() and all(c.isalnum() or c == "_" for c in key)):
        raise BadRequest("Sport keys are 2–16 lower-case letters, digits or _")
    formats = [f.strip()[:16] for f in body.formats if f.strip()]
    await _seed_catalog_if_empty()
    row = await db.scalar(select(SportCatalog).where(SportCatalog.key == key).with_for_update())
    sort_order = body.sort_order
    if sort_order is None:
        sort_order = row.sort_order if row is not None else int(
            await db.scalar(select(func.coalesce(func.max(SportCatalog.sort_order), 0))) or 0) + 10
    after = {"label": body.label, "emoji": body.emoji, "formats": formats, "is_active": body.is_active,
             "sort_order": sort_order}
    if row is None:
        before: dict[str, Any] = {}
        now = utcnow()
        row = SportCatalog(key=key, created_at=now, updated_at=now, **after)
        db.add(row)
        action = "catalog.sport_create"
    else:
        before = {"label": row.label, "emoji": row.emoji, "formats": list(row.formats or []),
                  "is_active": row.is_active, "sort_order": row.sort_order}
        for field, value in after.items():
            setattr(row, field, value)
        action = "catalog.sport_update"
    await audit(db, ctx, action, f"Sport catalog: {key}", target_type="sport", target_id=key,
                changes=audit_service.diff(before, after))
    await db.commit()
    try:
        await get_redis().delete(_SPORTS_CACHE)
    except Exception:
        pass
    return _sport_out(row)


# ═══════════════════════════ broadcasts ═══════════════════════════

BROADCAST_INLINE_LIMIT = 500
_BATCH = 500
_background: set[asyncio.Task] = set()


def _segment_query(segment: BroadcastSegment | dict[str, Any]):
    seg = segment if isinstance(segment, dict) else segment.model_dump()
    stmt = select(User.id).where(User.is_bot.is_(False), User.status == "active")
    if seg.get("areas"):
        stmt = stmt.where(User.home_area.in_(seg["areas"]))
    if seg.get("sports"):
        stmt = stmt.where(User.preferred_sports.overlap(list(seg["sports"])))
    if seg.get("active_days"):
        since = utcnow() - timedelta(days=int(seg["active_days"]))
        played = exists(
            select(LobbyMember.id)
            .join(Lobby, Lobby.id == LobbyMember.lobby_id)
            .where(LobbyMember.user_id == User.id, LobbyMember.status == "paid", Lobby.start_at >= since)
        )
        stmt = stmt.where(or_(User.last_seen_at >= since, played))
    return stmt


async def preview_recipients(db: AsyncSession, segment: BroadcastSegment) -> int:
    return int(await db.scalar(select(func.count()).select_from(_segment_query(segment).subquery())) or 0)


def _broadcast_out(row: Broadcast, created_by: str | None) -> BroadcastOut:
    return BroadcastOut(
        id=row.id, title=row.title, body=row.body, url=row.url,
        segment=BroadcastSegmentOut(**{k: (row.segment or {}).get(k) for k in ("areas", "sports", "active_days")}),
        recipient_count=row.recipient_count, created_by=created_by, created_at=row.created_at,
    )


async def list_broadcasts(db: AsyncSession, *, limit: int = 100) -> list[BroadcastOut]:
    rows = (
        await db.execute(
            select(Broadcast, AdminUser.email)
            .outerjoin(AdminUser, AdminUser.id == Broadcast.created_by_admin_id)
            .order_by(Broadcast.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [_broadcast_out(b, email) for b, email in rows]


async def _deliver_batch(db: AsyncSession, user_ids: list[uuid.UUID], title: str, body: str,
                         data: dict[str, Any]) -> None:
    """In-app notification (+ realtime push after commit) for each recipient. Caller commits."""
    await notify_many(db, user_ids, "broadcast", title, body, data)


async def _deliver_in_background(broadcast_id: uuid.UUID) -> None:
    """Large segments: keyset-paginate recipients and insert notifications in batches."""
    try:
        async with SessionLocal() as db:
            b = await db.get(Broadcast, broadcast_id)
            if b is None:
                return
            data = {"broadcast_id": str(b.id), **({"url": b.url} if b.url else {})}
            base = _segment_query(b.segment or {})
            last: uuid.UUID | None = None
            sent = 0
            while True:
                stmt = base.order_by(User.id).limit(_BATCH)
                if last is not None:
                    stmt = stmt.where(User.id > last)
                ids = list((await db.scalars(stmt)).all())
                if not ids:
                    break
                await _deliver_batch(db, ids, b.title, b.body, data)
                await db.commit()
                sent += len(ids)
                last = ids[-1]
            b = await db.get(Broadcast, broadcast_id)
            if b is not None:
                b.status = "sent"
                b.recipient_count = sent
                await db.commit()
    except Exception:
        logger.exception("broadcast %s delivery failed", broadcast_id)
        async with SessionLocal() as db:
            b = await db.get(Broadcast, broadcast_id)
            if b is not None:
                b.status = "failed"
                await db.commit()


async def send_broadcast(db: AsyncSession, ctx: Actor, body: BroadcastInput) -> BroadcastOut:
    count = await preview_recipients(db, body.segment)
    segment = body.segment.model_dump(exclude_none=True)
    background = count > BROADCAST_INLINE_LIMIT
    row = Broadcast(
        id=uuid.uuid4(), title=body.title, body=body.body, url=body.url, segment=segment, recipient_count=count,
        status="sending" if background else "sent", created_by_admin_id=ctx.admin.id, created_at=utcnow(),
    )
    db.add(row)
    await db.flush()
    await audit(db, ctx, "broadcast.send", f"Broadcast “{body.title}” to {count} players", target_type="broadcast",
                target_id=row.id, changes={"segment": segment, "recipients": count, "title": body.title})
    if not background and count:
        ids = list((await db.scalars(_segment_query(body.segment))).all())
        data = {"broadcast_id": str(row.id), **({"url": body.url} if body.url else {})}
        await _deliver_batch(db, ids, body.title, body.body, data)
    await db.commit()
    if background:
        task = asyncio.create_task(_deliver_in_background(row.id), name=f"broadcast-{row.id}")
        _background.add(task)
        task.add_done_callback(_background.discard)
    return _broadcast_out(row, ctx.admin.email)
