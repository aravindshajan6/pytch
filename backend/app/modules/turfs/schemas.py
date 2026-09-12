"""Turf / pitch / slot read models. Layer 1 — depends on nothing but core."""

import uuid
from datetime import datetime
from typing import Literal

from app.core.schemas import Schema

Sport = Literal["football", "cricket", "badminton", "pickleball", "basketball"]
SlotStatus = Literal["available", "held", "booked", "blocked"]


class HourWeather(Schema):
    time: datetime
    temperature_c: float
    precipitation_probability: int
    precipitation_mm: float
    weather_code: int
    is_risky: bool


class TurfSummary(Schema):
    id: uuid.UUID
    slug: str
    name: str
    area: str
    address: str
    lat: float
    lng: float
    cover_url: str | None
    sports: list[Sport]
    has_indoor: bool
    has_outdoor: bool
    has_camera: bool
    amenities: list[str]
    min_price_per_hour_paise: int
    rating_avg: float
    rating_count: int
    distance_km: float | None
    open_lobbies_count: int
    is_featured: bool = False  # "Feature on Discover" (admin console) — featured venues rank first by default


class PitchOut(Schema):
    id: uuid.UUID
    turf_id: uuid.UUID
    name: str
    sport: Sport
    format: str
    capacity: int
    is_indoor: bool
    has_camera: bool
    camera_price_paise: int
    price_per_hour_paise: int
    peak_price_per_hour_paise: int


class TurfDetail(TurfSummary):
    description: str
    photos: list[str]
    phone: str | None
    open_time: str  # "06:00"
    close_time: str
    pitches: list[PitchOut]


class SlotOut(Schema):
    id: uuid.UUID
    pitch_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    price_paise: int
    is_peak: bool
    status: SlotStatus
    held_until: datetime | None
    open_lobby_id: uuid.UUID | None = None
    weather: HourWeather | None = None


class SlotDetail(Schema):
    slot: SlotOut
    pitch: PitchOut
    turf: TurfSummary
