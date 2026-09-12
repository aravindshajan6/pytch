"""Gamification read-side: progress card and leaderboards (additive to `service.py`)."""

import uuid
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import Select, and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutils import iso_week_key, utcnow
from app.modules.gamification.catalog import BADGES, level_for_xp, xp_for_level
from app.modules.gamification.models import XpEvent
from app.modules.gamification.schemas import (
    BadgeOut,
    GamificationMe,
    LeaderboardEntry,
    LeaderboardOut,
    XpEventOut,
)
from app.modules.gamification.service import earned_badge_codes
from app.modules.ratings.models import MatchRating
from app.modules.users.models import PlayerStats, User
from app.modules.users.schemas import UserPublic

Metric = Literal["xp", "true_skill"]
Period = Literal["week", "all"]

LEADERBOARD_SIZE = 50
MIN_RATINGS_FOR_TRUE_SKILL = 3
WEEK = timedelta(days=7)


def effective_streak(streak_weeks: int, last_match_at: datetime | None, now: datetime | None = None) -> int:
    """A streak is alive while the last match was this ISO week or last week."""
    if not last_match_at or not streak_weeks:
        return 0
    now = now or utcnow()
    if iso_week_key(last_match_at) in {iso_week_key(now), iso_week_key(now - WEEK)}:
        return streak_weeks
    return 0


async def weekly_xp(db: AsyncSession, user_id: uuid.UUID) -> int:
    since = utcnow() - WEEK
    return int(
        await db.scalar(
            select(func.coalesce(func.sum(XpEvent.amount), 0)).where(
                XpEvent.user_id == user_id, XpEvent.created_at >= since
            )
        )
        or 0
    )


async def gamification_me(db: AsyncSession, user: User) -> GamificationMe:
    stats = await db.scalar(select(PlayerStats).where(PlayerStats.user_id == user.id))
    xp = stats.xp if stats else 0
    level = level_for_xp(xp)
    start, nxt = xp_for_level(level), xp_for_level(level + 1)
    earned = await earned_badge_codes(db, user.id)
    badges = [
        BadgeOut(
            code=b.code, name=b.name, description=b.description, icon=b.icon, rarity=b.rarity,  # type: ignore[arg-type]
            earned_at=earned.get(b.code),  # type: ignore[arg-type]
        )
        for b in BADGES.values()
    ]
    # earned first (most recent first), then locked in catalogue order
    badges.sort(key=lambda b: (b.earned_at is None, -(b.earned_at.timestamp() if b.earned_at else 0)))
    recent = await db.scalars(
        select(XpEvent).where(XpEvent.user_id == user.id).order_by(XpEvent.created_at.desc()).limit(20)
    )
    return GamificationMe(
        xp=xp,
        level=level,
        level_xp_start=start,
        next_level_xp=nxt,
        progress=round(min(1.0, max(0.0, (xp - start) / (nxt - start))), 4) if nxt > start else 1.0,
        streak_weeks=effective_streak(stats.streak_weeks, stats.last_match_at) if stats else 0,
        weekly_xp=await weekly_xp(db, user.id),
        badges=badges,
        recent_xp=[XpEventOut.model_validate(e) for e in recent.all()],
    )


def _value_query(metric: Metric, period: Period) -> Select:
    """SELECT user_id, value for every ranked (non-bot) player."""
    if metric == "xp" and period == "all":
        return (
            select(PlayerStats.user_id.label("user_id"), PlayerStats.xp.label("value"))
            .join(User, User.id == PlayerStats.user_id)
            .where(User.is_bot.is_(False), PlayerStats.xp > 0)
        )
    if metric == "xp":
        since = utcnow() - WEEK
        value = func.sum(XpEvent.amount)
        return (
            select(XpEvent.user_id.label("user_id"), value.label("value"))
            .join(User, User.id == XpEvent.user_id)
            .where(User.is_bot.is_(False), XpEvent.created_at >= since)
            .group_by(XpEvent.user_id)
            .having(value > 0)
        )
    query = (
        select(PlayerStats.user_id.label("user_id"), PlayerStats.true_skill.label("value"))
        .join(User, User.id == PlayerStats.user_id)
        .where(
            User.is_bot.is_(False),
            PlayerStats.true_skill.is_not(None),
            PlayerStats.ratings_received >= MIN_RATINGS_FOR_TRUE_SKILL,
        )
    )
    if period == "week":  # players rated this week, ranked by current True Skill
        since = utcnow() - WEEK
        query = query.where(
            exists().where(and_(MatchRating.ratee_id == PlayerStats.user_id, MatchRating.created_at >= since))
        )
    return query


def _round(metric: Metric, value: float) -> float:
    return round(float(value), 1) if metric == "true_skill" else float(int(value))


async def leaderboard(db: AsyncSession, viewer: User, metric: Metric, period: Period) -> LeaderboardOut:
    values = _value_query(metric, period).subquery()
    rows = (
        await db.execute(
            select(User, values.c.value)
            .join(values, values.c.user_id == User.id)
            .order_by(values.c.value.desc(), User.name, User.id)
            .limit(LEADERBOARD_SIZE)
        )
    ).unique().all()
    entries = [
        LeaderboardEntry(rank=i + 1, user=UserPublic.from_user(user), value=_round(metric, value))
        for i, (user, value) in enumerate(rows)
    ]
    me = next((e for e in entries if e.user.id == viewer.id), None)
    if me is None:
        my_value = await db.scalar(select(values.c.value).where(values.c.user_id == viewer.id))
        if my_value is None and metric == "xp" and not viewer.is_bot:
            my_value = 0  # everyone has an XP position, even at zero
        if my_value is not None:
            ahead = await db.scalar(select(func.count()).select_from(values).where(values.c.value > my_value)) or 0
            me = LeaderboardEntry(rank=ahead + 1, user=UserPublic.from_user(viewer), value=_round(metric, my_value))
    return LeaderboardOut(metric=metric, period=period, entries=entries, me=me)
