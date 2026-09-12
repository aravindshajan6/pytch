"""XP, levels and badges. Callable from any module; caller commits."""

import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import utcnow
from app.modules.gamification.catalog import BADGES, level_for_xp
from app.modules.gamification.models import UserBadge, XpEvent
from app.modules.notifications.service import notify
from app.modules.users.models import PlayerStats
from app.realtime.publisher import publish_on_commit, user_channel


async def get_stats_for_update(db: AsyncSession, user_id: uuid.UUID) -> PlayerStats:
    """Row-lock the player's stats, creating the row if missing."""
    # flush + populate_existing: never compute on a stale identity-mapped row (lost updates)
    await db.flush()
    locked = (
        select(PlayerStats)
        .where(PlayerStats.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    stats = await db.scalar(locked)
    if stats is None:
        await db.execute(insert(PlayerStats).values(user_id=user_id).on_conflict_do_nothing())
        stats = await db.scalar(locked)
    assert stats is not None
    return stats


async def award_xp(
    db: AsyncSession, user_id: uuid.UUID, amount: int, reason: str, ref_id: uuid.UUID | None = None
) -> int:
    """Grant XP, handle level-ups. Returns the player's new level."""
    if amount <= 0:
        return 0
    stats = await get_stats_for_update(db, user_id)
    old_level = stats.level
    stats.xp += amount
    stats.level = level_for_xp(stats.xp)
    db.add(XpEvent(id=uuid.uuid4(), user_id=user_id, amount=amount, reason=reason, ref_id=ref_id, created_at=utcnow()))
    if stats.level > old_level:
        publish_on_commit(db, user_channel(user_id), "level.up", {"level": stats.level})
        await notify(
            db, user_id, "level_up", f"Level {stats.level} unlocked!", "Keep playing to climb the leaderboard.",
            {"level": stats.level, "url": "/app/profile"},
        )
    return stats.level


async def award_badge(db: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Idempotently grant a badge. Returns True when newly awarded."""
    badge = BADGES.get(code)
    if badge is None:
        raise ValueError(f"unknown badge {code}")
    now = utcnow()
    result = await db.execute(
        insert(UserBadge)
        .values(user_id=user_id, badge_code=code, awarded_at=now)
        .on_conflict_do_nothing()
        .returning(UserBadge.badge_code)
    )
    if result.scalar_one_or_none() is None:
        return False
    payload = {
        "code": badge.code,
        "name": badge.name,
        "description": badge.description,
        "icon": badge.icon,
        "rarity": badge.rarity,
        "earned_at": now.isoformat(),
    }
    publish_on_commit(db, user_channel(user_id), "badge.earned", payload)
    await notify(
        db, user_id, "badge_earned", f"{badge.icon} {badge.name} unlocked", badge.description,
        {"badge_code": code, "url": "/app/profile"},
    )
    return True


async def earned_badge_codes(db: AsyncSession, user_id: uuid.UUID) -> dict[str, object]:
    rows = await db.execute(select(UserBadge.badge_code, UserBadge.awarded_at).where(UserBadge.user_id == user_id))
    return {code: awarded_at for code, awarded_at in rows.all()}
