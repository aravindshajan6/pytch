import uuid
from datetime import date, datetime

from pydantic import Field

from app.core.schemas import InputSchema, Schema
from app.modules.turfs.schemas import Sport
from app.modules.users.schemas import Tier, UserPublic


class TagCount(Schema):
    tag: str
    count: int


class PendingRating(Schema):
    lobby_id: uuid.UUID
    title: str
    sport: Sport
    turf_name: str
    start_at: datetime
    closes_at: datetime
    teammates: list[UserPublic]


class RatingInput(InputSchema):
    ratee_id: uuid.UUID
    skill: int = Field(ge=1, le=5)
    fair_play: int = Field(ge=1, le=5)
    reliability: int = Field(ge=1, le=5)
    showed_up: bool = True
    tags: list[str] = Field(default_factory=list, max_length=3)


class SubmitRatingsRequest(InputSchema):
    ratings: list[RatingInput] = Field(min_length=1, max_length=30)


class SubmitRatingsResponse(Schema):
    submitted: int
    xp_awarded: int


class VerifiedCriterion(Schema):
    key: str
    label: str
    current: float
    target: float
    met: bool


class VerifiedProgress(Schema):
    eligible: bool
    criteria: list[VerifiedCriterion]


class HistoryPoint(Schema):
    date: date
    true_skill: float


class RatingSummary(Schema):
    ratings_received: int
    distinct_raters: int
    avg_skill: float | None
    avg_fair_play: float | None
    avg_reliability: float | None
    true_skill: float | None
    tier: Tier
    is_verified_playmaker: bool
    top_tags: list[TagCount]
    history: list[HistoryPoint]
    verified_progress: VerifiedProgress
