from datetime import datetime
from typing import Literal

from app.core.schemas import Schema
from app.modules.users.schemas import UserPublic

BadgeRarity = Literal["common", "rare", "epic", "legendary"]


class BadgeOut(Schema):
    code: str
    name: str
    description: str
    icon: str
    rarity: BadgeRarity
    earned_at: datetime | None


class XpEventOut(Schema):
    amount: int
    reason: str
    created_at: datetime


class GamificationMe(Schema):
    xp: int
    level: int
    level_xp_start: int
    next_level_xp: int
    progress: float
    streak_weeks: int
    weekly_xp: int
    badges: list[BadgeOut]
    recent_xp: list[XpEventOut]


class LeaderboardEntry(Schema):
    rank: int
    user: UserPublic
    value: float


class LeaderboardOut(Schema):
    metric: Literal["xp", "true_skill"]
    period: Literal["week", "all"]
    entries: list[LeaderboardEntry]
    me: LeaderboardEntry | None
