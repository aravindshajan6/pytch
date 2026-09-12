"""Player profile composite (Layer 4 — embeds badges and clips)."""

from datetime import datetime

from app.core.schemas import Schema
from app.modules.gamification.schemas import BadgeOut
from app.modules.highlights.schemas import ClipOut
from app.modules.ratings.schemas import TagCount
from app.modules.users.schemas import DominantFoot, SkillLevel, Tier, UserPublic


class PlayerStatsOut(Schema):
    matches_played: int
    matches_hosted: int
    subs_made: int
    dropouts: int
    no_shows: int
    ratings_received: int
    ratings_given: int
    avg_skill: float | None
    avg_fair_play: float | None
    avg_reliability: float | None
    true_skill: float | None
    tier: Tier
    is_verified_playmaker: bool
    top_tags: list[TagCount]
    streak_weeks: int
    xp: int
    level: int


class PlayerProfile(Schema):
    user: UserPublic
    bio: str | None
    self_skill_level: SkillLevel | None
    dominant_foot: DominantFoot | None
    stats: PlayerStatsOut
    badges: list[BadgeOut]
    pinned_clips: list[ClipOut]
    joined_at: datetime
