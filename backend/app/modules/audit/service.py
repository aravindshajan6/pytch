"""Append-only, hash-chained audit trail.

Every admin mutation (and sensitive partner/system action) calls `record()` inside its
transaction. Rows are chained: hash = sha256(prev_hash ‖ canonical JSON of the row), serialised
with a transaction-scoped advisory lock so concurrent writers can't fork the chain.
`verify_chain()` recomputes hashes to detect tampering.
"""

import hashlib
import uuid
from datetime import datetime
from typing import Any

import orjson
from fastapi import Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import client_ip, user_agent
from app.core.timeutils import utcnow
from app.modules.audit.models import AuditLog

GENESIS = "0" * 64
_LOCK_KEY = 0x7079746368  # "pytch" — pg advisory lock id for the audit chain


def _canonical(row: dict[str, Any]) -> bytes:
    return orjson.dumps(row, option=orjson.OPT_SORT_KEYS, default=str)


def _row_payload(log: AuditLog) -> dict[str, Any]:
    return {
        "occurred_at": log.occurred_at.isoformat() if isinstance(log.occurred_at, datetime) else str(log.occurred_at),
        "actor_type": log.actor_type,
        "actor_id": str(log.actor_id) if log.actor_id else None,
        "actor_label": log.actor_label,
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "summary": log.summary,
        "changes": log.changes,
        "ip": log.ip,
    }


def compute_hash(prev_hash: str, payload: dict[str, Any]) -> str:
    return hashlib.sha256(prev_hash.encode() + _canonical(payload)).hexdigest()


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list[Any]]:
    """{"field": [old, new]} for changed keys — use for `changes`."""
    return {k: [before.get(k), after.get(k)] for k in after if before.get(k) != after.get(k)}


async def record(
    db: AsyncSession,
    *,
    actor_type: str,
    actor_id: uuid.UUID | None,
    actor_label: str,
    action: str,
    summary: str,
    target_type: str | None = None,
    target_id: Any = None,
    changes: dict[str, Any] | None = None,
    request: Request | None = None,
) -> AuditLog:
    """Append an audit entry (caller commits — the entry lives or dies with the change it describes)."""
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    prev = await db.scalar(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1))
    log = AuditLog(
        occurred_at=utcnow(),
        actor_type=actor_type,
        actor_id=actor_id,
        actor_label=actor_label[:160],
        action=action[:60],
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        summary=summary[:300],
        changes=orjson.loads(_canonical(changes or {})),
        ip=client_ip(request) if request else None,
        user_agent=user_agent(request) if request else None,
    )
    log.prev_hash = prev or GENESIS
    log.hash = compute_hash(log.prev_hash, _row_payload(log))
    db.add(log)
    await db.flush([log])
    return log


async def verify_chain(db: AsyncSession, *, limit: int | None = None) -> dict[str, Any]:
    """Recompute the chain from the start. Returns {"ok", "checked", "broken_at"}."""
    q = select(AuditLog).order_by(AuditLog.id)
    if limit:
        q = q.limit(limit)
    prev = GENESIS
    checked = 0
    for log in (await db.scalars(q)).all():
        if log.prev_hash != prev or compute_hash(prev, _row_payload(log)) != log.hash:
            return {"ok": False, "checked": checked, "broken_at": log.id}
        prev = log.hash
        checked += 1
    return {"ok": True, "checked": checked, "broken_at": None}
