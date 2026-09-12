"""Users: self profile management and public player cards."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.core.logging import logger
from app.modules.gamification.catalog import BADGES
from app.modules.gamification.schemas import BadgeOut
from app.modules.gamification.service import earned_badge_codes
from app.modules.ratings.schemas import TagCount
from app.modules.users.models import PlayerStats, User
from app.modules.users.profile_schemas import PlayerProfile, PlayerStatsOut
from app.modules.users.schemas import UserMe, UserPublic, UserUpdate

TOP_TAGS = 5
_NON_NULLABLE = {"name", "preferred_sports", "onboarded"}


async def update_me(db: AsyncSession, user: User, patch: UserUpdate) -> UserMe:
    """Apply only the fields the client sent (explicit nulls clear nullable fields)."""
    for field, value in patch.model_dump(exclude_unset=True).items():
        if value is None and field in _NON_NULLABLE:
            continue
        setattr(user, field, value)
    await db.commit()
    return UserMe.from_user(user)


def top_tags(tag_counts: dict[str, int] | None, limit: int = TOP_TAGS) -> list[TagCount]:
    ranked = sorted((tag_counts or {}).items(), key=lambda kv: (-int(kv[1]), kv[0]))
    return [TagCount(tag=tag, count=int(count)) for tag, count in ranked[:limit] if int(count) > 0]


def _stats_out(stats: PlayerStats | None) -> PlayerStatsOut:
    if stats is None:
        stats = PlayerStats(xp=0, level=1, streak_weeks=0, matches_played=0, matches_hosted=0, subs_made=0,
                            dropouts=0, no_shows=0, ratings_received=0, ratings_given=0, tier="rookie",
                            is_verified_playmaker=False, tag_counts={})
    return PlayerStatsOut(
        matches_played=stats.matches_played or 0,
        matches_hosted=stats.matches_hosted or 0,
        subs_made=stats.subs_made or 0,
        dropouts=stats.dropouts or 0,
        no_shows=stats.no_shows or 0,
        ratings_received=stats.ratings_received or 0,
        ratings_given=stats.ratings_given or 0,
        avg_skill=_round(stats.avg_skill, 2),
        avg_fair_play=_round(stats.avg_fair_play, 2),
        avg_reliability=_round(stats.avg_reliability, 2),
        true_skill=_round(stats.true_skill, 1),
        tier=stats.tier or "rookie",  # type: ignore[arg-type]
        is_verified_playmaker=bool(stats.is_verified_playmaker),
        top_tags=top_tags(stats.tag_counts),
        streak_weeks=stats.streak_weeks or 0,
        xp=stats.xp or 0,
        level=stats.level or 1,
    )


def _round(value: float | None, digits: int) -> float | None:
    return round(value, digits) if value is not None else None


async def _earned_badges(db: AsyncSession, user_id: uuid.UUID) -> list[BadgeOut]:
    earned = await earned_badge_codes(db, user_id)
    badges = [
        BadgeOut(code=b.code, name=b.name, description=b.description, icon=b.icon, rarity=b.rarity,  # type: ignore[arg-type]
                 earned_at=earned[code])  # type: ignore[arg-type]
        for code, b in BADGES.items()
        if code in earned
    ]
    return sorted(badges, key=lambda b: b.earned_at, reverse=True)  # type: ignore[arg-type,return-value]


async def _pinned_clips(db: AsyncSession, user_id: uuid.UUID, viewer_id: uuid.UUID) -> list[Any]:
    """Highlights are owned by another module (written concurrently) — degrade to []."""
    try:
        from app.modules.highlights.service import pinned_clips_for_user
    except (ImportError, AttributeError):
        return []
    try:
        return list(await pinned_clips_for_user(db, user_id, viewer_id))
    except Exception:
        logger.exception("profile: pinned_clips_for_user failed")
        return []


async def player_profile(db: AsyncSession, user_id: uuid.UUID, viewer: User) -> PlayerProfile:
    user = viewer if viewer.id == user_id else await db.get(User, user_id)
    if user is None:
        raise NotFound("Player not found")
    return PlayerProfile(
        user=UserPublic.from_user(user),
        bio=user.bio,
        self_skill_level=user.self_skill_level,  # type: ignore[arg-type]
        dominant_foot=user.dominant_foot,  # type: ignore[arg-type]
        stats=_stats_out(user.stats),
        badges=await _earned_badges(db, user.id),
        pinned_clips=await _pinned_clips(db, user.id, viewer.id),
        joined_at=user.created_at,
    )
