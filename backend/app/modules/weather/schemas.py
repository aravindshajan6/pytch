"""Weather models. Layer 2 (depends on turfs)."""

import uuid
from datetime import datetime
from typing import Literal

from app.core.schemas import InputSchema, Schema
from app.modules.turfs.schemas import HourWeather, PitchOut, SlotOut, TurfSummary

__all__ = ["HourWeather", "WeatherAlertOut", "TransferAlternative", "TransferRequest"]

WeatherSeverity = Literal["watch", "warning"]
WeatherAlertStatus = Literal["open", "transferred", "rain_checked", "dismissed", "expired"]


class WeatherAlertOut(Schema):
    id: uuid.UUID
    lobby_id: uuid.UUID
    booking_id: uuid.UUID
    lobby_title: str
    turf_name: str
    pitch_name: str
    start_at: datetime
    precipitation_probability: int
    precipitation_mm: float
    summary: str
    severity: WeatherSeverity
    status: WeatherAlertStatus
    is_host: bool
    created_at: datetime


class TransferAlternative(Schema):
    slot: SlotOut
    pitch: PitchOut
    turf: TurfSummary
    distance_km: float
    price_diff_paise: int
    covered_by_pytch: bool


class TransferRequest(InputSchema):
    slot_id: uuid.UUID
