"""Thin wrapper so every admin mutation writes its audit entry the same way (same transaction)."""

from typing import Any, Protocol

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit_service
from app.modules.audit.models import AuditLog


class _Admin(Protocol):
    id: Any
    email: str
    role: str


class Actor(Protocol):
    """Structural type satisfied by `admin.deps.AdminContext`."""

    admin: _Admin
    request: Request

    @property
    def label(self) -> str: ...


async def audit(
    db: AsyncSession,
    ctx: Actor | None,
    action: str,
    summary: str,
    *,
    target_type: str | None = None,
    target_id: Any = None,
    changes: dict[str, Any] | None = None,
) -> AuditLog:
    """Record an admin action (ctx=None → system actor, e.g. the worker). Caller commits."""
    if ctx is None:
        return await audit_service.record(
            db, actor_type="system", actor_id=None, actor_label="system", action=action, summary=summary,
            target_type=target_type, target_id=target_id, changes=changes,
        )
    return await audit_service.record(
        db,
        actor_type="admin",
        actor_id=ctx.admin.id,
        actor_label=ctx.label,
        action=action,
        summary=summary,
        target_type=target_type,
        target_id=target_id,
        changes=changes,
        request=ctx.request,
    )
