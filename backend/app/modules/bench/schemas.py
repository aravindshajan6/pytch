"""Bench / SOS models. Layer 3 (embeds LobbySummary)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import InputSchema, Schema
from app.modules.lobbies.schemas import LobbySummary
from app.modules.turfs.schemas import Sport

SOSStatus = Literal["open", "filled", "expired", "cancelled"]


class BenchStatusOut(Schema):
    is_active: bool
    lat: float | None
    lng: float | None
    radius_km: float
    sports: list[Sport]
    active_until: datetime | None
    subs_made: int


class BenchUpdate(InputSchema):
    is_active: bool
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    radius_km: float | None = Field(None, ge=1, le=25)
    sports: list[Sport] | None = None
    duration_minutes: int | None = Field(None, ge=30, le=240)


class Blip(Schema):
    lat: float
    lng: float


class BenchNearby(Schema):
    count: int
    blips: list[Blip]


class SOSRequestOut(Schema):
    id: uuid.UUID
    lobby: LobbySummary
    reason: Literal["dropout", "manual"]
    spots_needed: int
    spots_filled: int
    discount_pct: int
    original_share_paise: int
    discounted_share_paise: int
    status: SOSStatus
    expires_at: datetime
    distance_km: float | None
    created_at: datetime


class CreateSOSRequest(InputSchema):
    lobby_id: uuid.UUID
    spots: int = Field(ge=1, le=10)
