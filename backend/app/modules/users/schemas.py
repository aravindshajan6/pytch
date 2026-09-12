import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.core.schemas import InputSchema, Schema
from app.modules.users.models import User

Sport = Literal["football", "cricket", "badminton", "pickleball", "basketball"]
SkillLevel = Literal["beginner", "intermediate", "advanced", "pro"]
DominantFoot = Literal["left", "right", "both"]
Tier = Literal["rookie", "regular", "skilled", "elite"]


class UserPublic(Schema):
    id: uuid.UUID
    name: str
    avatar_url: str | None
    home_area: str | None
    position: str | None
    preferred_sports: list[str]
    level: int
    tier: Tier
    true_skill: float | None
    is_verified_playmaker: bool

    @classmethod
    def from_user(cls, user: User) -> "UserPublic":
        stats = user.stats
        return cls(
            id=user.id,
            name=user.name,
            avatar_url=user.avatar_url,
            home_area=user.home_area,
            position=user.position,
            preferred_sports=list(user.preferred_sports or []),
            level=stats.level if stats else 1,
            tier=(stats.tier if stats else "rookie"),  # type: ignore[arg-type]
            true_skill=round(stats.true_skill, 1) if stats and stats.true_skill is not None else None,
            is_verified_playmaker=bool(stats and stats.is_verified_playmaker),
        )


class UserMe(UserPublic):
    phone: str
    bio: str | None
    self_skill_level: SkillLevel | None
    dominant_foot: DominantFoot | None
    home_lat: float | None
    home_lng: float | None
    xp: int
    wallet_balance_paise: int
    onboarded: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: User) -> "UserMe":
        public = UserPublic.from_user(user)
        return cls(
            **public.model_dump(),
            phone=user.phone,
            bio=user.bio,
            self_skill_level=user.self_skill_level,  # type: ignore[arg-type]
            dominant_foot=user.dominant_foot,  # type: ignore[arg-type]
            home_lat=user.home_lat,
            home_lng=user.home_lng,
            xp=user.stats.xp if user.stats else 0,
            wallet_balance_paise=user.wallet_balance_paise,
            onboarded=user.onboarded,
            created_at=user.created_at,
        )


class UserUpdate(InputSchema):
    name: str | None = Field(None, min_length=2, max_length=80)
    bio: str | None = Field(None, max_length=280)
    avatar_url: str | None = Field(None, max_length=500)
    position: str | None = Field(None, max_length=40)
    preferred_sports: list[Sport] | None = None
    self_skill_level: SkillLevel | None = None
    dominant_foot: DominantFoot | None = None
    home_lat: float | None = Field(None, ge=-90, le=90)
    home_lng: float | None = Field(None, ge=-180, le=180)
    home_area: str | None = Field(None, max_length=80)
    onboarded: bool | None = None

    @field_validator("avatar_url")
    @classmethod
    def _safe_avatar(cls, v: str | None) -> str | None:
        """Only https images or our own media — no javascript:/data: URLs or plain-http trackers."""
        if v and (not v.startswith(("https://", "/media/")) or ".." in v or "\\" in v or any(c.isspace() for c in v)):
            raise ValueError("avatar_url must be an https:// or /media/ URL")
        return v or None
