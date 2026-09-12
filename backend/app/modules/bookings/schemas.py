"""Booking read/write models. Layer 1."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import InputSchema, Schema

LobbyMode = Literal["split", "full"]
Visibility = Literal["public", "private"]
BookingStatus = Literal["pending_payment", "confirmed", "completed", "cancelled", "expired"]


class CreateBookingRequest(InputSchema):
    slot_id: uuid.UUID
    mode: LobbyMode
    total_spots: int = Field(ge=2, le=30)
    visibility: Visibility = "private"
    title: str | None = Field(None, max_length=80)
    recorded: bool = False
    min_true_skill: float | None = Field(None, ge=0, le=100)
    verified_only: bool = False
    notes: str | None = Field(None, max_length=500)


class BookingOut(Schema):
    id: uuid.UUID
    code: str
    slot_id: uuid.UUID
    lobby_id: uuid.UUID
    host_id: uuid.UUID
    mode: LobbyMode
    status: BookingStatus
    pitch_fee_paise: int
    recording_fee_paise: int
    total_paise: int
    recorded: bool
    start_at: datetime
    end_at: datetime
    expires_at: datetime | None
    confirmed_at: datetime | None
    created_at: datetime
    transferred_from_id: uuid.UUID | None
