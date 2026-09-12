"""Composite lobby responses (Layer 4). Imports bench/weather/highlights schemas —
nothing below this layer may import this module."""

from datetime import datetime

from app.core.schemas import Schema
from app.modules.bench.schemas import SOSRequestOut
from app.modules.bookings.schemas import BookingOut
from app.modules.highlights.schemas import RecordingSummary
from app.modules.lobbies.schemas import Eligibility, LobbyMemberOut, LobbySummary
from app.modules.weather.schemas import WeatherAlertOut


class LobbyDetail(LobbySummary):
    booking: BookingOut
    notes: str | None
    members: list[LobbyMemberOut]
    my_membership: LobbyMemberOut | None
    eligibility: Eligibility
    open_sos: SOSRequestOut | None
    weather_alert: WeatherAlertOut | None
    recording: RecordingSummary | None
    invite_url: str
    created_at: datetime


class CreateBookingResponse(Schema):
    booking: BookingOut
    lobby: LobbyDetail


class AcceptSOSResponse(Schema):
    """Seat reserved as a sub; client then pays via POST /lobbies/{id}/pay."""

    lobby: LobbyDetail


class RainCheckResponse(Schema):
    refunded_paise_total: int
    lobby: LobbyDetail
