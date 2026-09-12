"""Highlights models. Layer 3 (Recording embeds LobbySummary)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.core.schemas import InputSchema, Schema
from app.modules.lobbies.schemas import LobbySummary
from app.modules.turfs.schemas import Sport
from app.modules.users.schemas import UserPublic

RecordingStatus = Literal["scheduled", "processing", "ready", "failed"]


class RecordingSummary(Schema):
    id: uuid.UUID
    status: RecordingStatus
    thumbnail_url: str | None
    ready_at: datetime | None


class ClipOut(Schema):
    id: uuid.UUID
    recording_id: uuid.UUID
    owner: UserPublic
    title: str
    start_s: float
    end_s: float
    video_url: str
    thumbnail_url: str | None
    tags: list[str]
    is_pinned: bool
    likes_count: int
    liked_by_me: bool
    views: int
    turf_name: str
    sport: Sport
    created_at: datetime


class RecordingOut(Schema):
    id: uuid.UUID
    lobby_id: uuid.UUID
    status: RecordingStatus
    video_url: str | None
    thumbnail_url: str | None
    duration_s: float | None
    ready_at: datetime | None
    lobby: LobbySummary
    clips: list[ClipOut]


class CreateClipRequest(InputSchema):
    title: str = Field(min_length=1, max_length=80)
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    tags: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _window(self) -> "CreateClipRequest":
        length = self.end_s - self.start_s
        if length < 1 or length > 60:
            raise ValueError("clip must be between 1 and 60 seconds long")
        return self


class ViewsOut(Schema):
    views: int
