"""Periodic jobs for player accounts."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import utcnow
from app.modules.audit import service as audit_service
from app.modules.users.models import User


async def lift_lapsed_suspensions(db: AsyncSession) -> int:
    """Suspensions past `suspended_until` → active again, so the admin console, filters and broadcasts agree
    with what the API already allows (`ensure_user_active` lets lapsed suspensions through). Each lift is
    written to the audit log as a system action."""
    users = (await db.scalars(
        select(User)
        .where(User.status == "suspended", User.suspended_until.is_not(None), User.suspended_until <= utcnow())
        .with_for_update(of=User, skip_locked=True)
        .limit(500)
    )).all()
    for user in users:
        until, reason = user.suspended_until, user.status_reason
        user.status, user.suspended_until, user.status_reason = "active", None, None
        await audit_service.record(
            db, actor_type="system", actor_id=None, actor_label="Suspension expiry", action="user.reinstate",
            summary=f"Suspension of {user.name} ended automatically", target_type="user", target_id=user.id,
            changes={"status": ["suspended", "active"], "suspended_until": [until.isoformat(), None],
                     "reason": [reason, None]},
        )
    await db.commit()
    return len(users)
