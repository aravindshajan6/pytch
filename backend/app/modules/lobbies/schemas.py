"""Lobby base read models (Layer 2). Composite `LobbyDetail` lives in `detail_schemas.py`
to keep the import graph acyclic (bench/highlights schemas embed `LobbySummary`)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import InputSchema, Schema
from app.modules.bookings.schemas import LobbyMode, Visibility
from app.modules.turfs.schemas import Sport
from app.modules.users.schemas import UserPublic

LobbyStatus = Literal["forming", "confirmed", "completed", "expired", "cancelled"]
MemberRole = Literal["host", "player", "sub"]
MemberStatus = Literal["joined", "paid", "left", "removed"]
Team = Literal["A", "B"]


class LobbyTurfRef(Schema):
    id: uuid.UUID
    slug: str
    name: str
    area: str
    lat: float
    lng: float
    cover_url: str | None


class LobbyPitchRef(Schema):
    id: uuid.UUID
    name: str
    is_indoor: bool
    has_camera: bool


class LobbySummary(Schema):
    id: uuid.UUID
    code: str
    title: str
    sport: Sport
    format: str
    mode: LobbyMode
    visibility: Visibility
    status: LobbyStatus
    host: UserPublic
    start_at: datetime
    end_at: datetime
    turf: LobbyTurfRef
    pitch: LobbyPitchRef
    total_spots: int
    filled_spots: int
    paid_spots: int
    spots_left: int
    share_paise: int
    pay_deadline: datetime | None
    min_true_skill: float | None
    verified_only: bool
    recorded: bool
    distance_km: float | None
    avg_true_skill: float | None
    member_avatars: list[UserPublic]


class LobbyMemberOut(Schema):
    user: UserPublic
    role: MemberRole
    status: MemberStatus
    team: Team | None
    share_paise: int
    paid_paise: int
    discount_paise: int
    joined_at: datetime
    paid_at: datetime | None
    reserved_until: datetime | None


class Eligibility(Schema):
    can_join: bool
    reasons: list[str]


class LobbyMessageOut(Schema):
    id: uuid.UUID
    lobby_id: uuid.UUID
    user: UserPublic | None
    kind: Literal["chat", "system"]
    body: str
    created_at: datetime


class SendMessageRequest(InputSchema):
    body: str = Field(min_length=1, max_length=500)


class QuickMatchResponse(Schema):
    lobby: LobbySummary | None
    score: float
    reasons: list[str]
