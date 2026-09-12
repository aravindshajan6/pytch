"""Audit-log browsing/verification and system health."""

from datetime import date, datetime

from sqlalchemy import String, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.core.redis import get_redis
from app.modules.admin.models import ApprovalRequest
from app.modules.admin.schemas import AuditEntry, AuditPage, ChainVerification, JobStatus, SystemHealth
from app.modules.admin.services.common import count, day_range, like_term
from app.modules.audit import service as audit_service
from app.modules.audit.models import AuditLog
from app.modules.channels.models import ChannelFeed, SyncConflict, WebhookDelivery

_LAST_VERIFY = "pytch:audit:last-verify"

# every `target_type` the code writes (admin, partner, channel and system audit calls) — the audit filter's options
AUDIT_TARGET_TYPES = (
    "admin", "approval", "approval_request", "booking", "broadcast", "channel_feed", "coupon", "payment", "pitch",
    "provider", "provider_api_key", "provider_member", "provider_webhook", "session", "setting", "settlement",
    "slot_block", "sport", "sync_conflict", "turf", "user",
)


async def audit_target_types(db: AsyncSession) -> list[str]:
    """Known target types + any other value actually present in the log (older or future writers)."""
    present = (await db.scalars(
        select(AuditLog.target_type).where(AuditLog.target_type.is_not(None)).distinct().limit(200)
    )).all()
    return sorted({*AUDIT_TARGET_TYPES, *(t for t in present if t)})


def _entry(log: AuditLog) -> AuditEntry:
    return AuditEntry(
        id=log.id, occurred_at=log.occurred_at, actor_type=log.actor_type,  # type: ignore[arg-type]
        actor_label=log.actor_label, action=log.action, target_type=log.target_type, target_id=log.target_id,
        summary=log.summary, changes=dict(log.changes or {}), ip=log.ip, hash=log.hash,
    )


async def audit_page(
    db: AsyncSession, *, actor: str | None, action: str | None, target_type: str | None, target_id: str | None,
    date_from: date | None, date_to: date | None, limit: int, offset: int,
) -> AuditPage:
    stmt = select(AuditLog)
    if actor:
        like = like_term(actor.strip())
        stmt = stmt.where(or_(AuditLog.actor_label.ilike(like, escape="\\"),
                              AuditLog.actor_id.cast(String).ilike(like, escape="\\")))
    if action:
        a = action.strip()
        if a.endswith(".") or "." not in a:  # "payment" / "payment." → every payment.* action
            stmt = stmt.where(AuditLog.action.like(f"{a.rstrip('.')}.%"))
        else:
            stmt = stmt.where(AuditLog.action == a)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    lo, hi = day_range(date_from, date_to)
    if lo is not None:
        stmt = stmt.where(AuditLog.occurred_at >= lo)
    if hi is not None:
        stmt = stmt.where(AuditLog.occurred_at < hi)
    total = await count(db, stmt)
    rows = (await db.scalars(stmt.order_by(AuditLog.id.desc()).limit(limit).offset(offset))).all()
    return AuditPage(items=[_entry(r) for r in rows], total=total, limit=limit, offset=offset)


async def verify_full(db: AsyncSession) -> ChainVerification:
    result = await audit_service.verify_chain(db)
    try:
        await get_redis().set(_LAST_VERIFY, "1" if result["ok"] else "0", ex=24 * 3600)
    except Exception:
        pass
    if not result["ok"]:
        logger.error("AUDIT CHAIN BROKEN at id=%s", result["broken_at"])
    return ChainVerification(**result)


async def verify_tail(db: AsyncSession, n: int = 500) -> bool | None:
    """Cheap tamper check of the newest `n` rows (hash + linkage), used by the health page."""
    rows = list((await db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(n))).all())
    if not rows:
        return None
    rows.reverse()
    prev = rows[0].prev_hash
    for log in rows:
        if log.prev_hash != prev or audit_service.compute_hash(prev, audit_service._row_payload(log)) != log.hash:
            return False
        prev = log.hash
    return True


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


async def health(db: AsyncSession) -> SystemHealth:
    db_ok = redis_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    heartbeat, jobs = None, []
    try:
        from app.worker import JOBS

        redis = get_redis()
        await redis.ping()
        heartbeat = _parse(await redis.get("pytch:worker:heartbeat"))
        values = await redis.mget([f"pytch:job-last:{j.target}" for j in JOBS]) if JOBS else []
        jobs = [JobStatus(name=j.target.split(":")[-1], last_run_at=_parse(v))
                for j, v in zip(JOBS, values, strict=True)]
    except Exception:
        redis_ok = False
    try:
        from app.realtime.manager import manager

        ws = int(manager.connection_count)
    except Exception:
        ws = 0

    async def _n(stmt) -> int:
        try:
            return int(await db.scalar(stmt) or 0)
        except Exception:
            await db.rollback()
            return 0

    pending_webhooks = await _n(select(func.count()).select_from(WebhookDelivery)
                                .where(WebhookDelivery.status == "pending"))
    failing_feeds = await _n(select(func.count()).select_from(ChannelFeed)
                             .where(ChannelFeed.is_active.is_(True), ChannelFeed.last_status == "error"))
    open_conflicts = await _n(select(func.count()).select_from(SyncConflict).where(SyncConflict.status == "open"))
    pending_approvals = await _n(select(func.count()).select_from(ApprovalRequest)
                                 .where(ApprovalRequest.status == "pending"))
    chain_ok = await verify_tail(db) if db_ok else None
    return SystemHealth(
        db=db_ok, redis=redis_ok, worker_heartbeat_at=heartbeat, jobs=jobs, websocket_connections=ws,
        pending_webhooks=pending_webhooks, failing_feeds=failing_feeds, open_conflicts=open_conflicts,
        pending_approvals=pending_approvals, audit_chain_ok=chain_ok,
    )
