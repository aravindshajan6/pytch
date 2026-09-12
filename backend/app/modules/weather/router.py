import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Query, Request

from app.core.config import settings
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest
from app.core.ratelimit import client_ip, enforce
from app.core.timeutils import ist_today
from app.modules.lobbies.detail_schemas import LobbyDetail, RainCheckResponse
from app.modules.weather import service
from app.modules.weather.schemas import HourWeather, TransferAlternative, TransferRequest, WeatherAlertOut

router = APIRouter(prefix="/weather", tags=["weather"])


# Public (used before login), so it is bounded: service area only, coordinates snapped to the forecast
# grid (~5 km — finer than the upstream model), and rate-limited per IP. Keeps upstream quota and the
# Redis cache key space small no matter what clients send.
_GRID = 0.05


def _snap(v: float) -> float:
    return round(round(v / _GRID) * _GRID, 2)


@router.get("/forecast", response_model=list[HourWeather])
async def forecast(
    request: Request,
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    date: date | None = None,
) -> list[HourWeather]:
    await enforce(f"weather-forecast:{client_ip(request)}", 60, 300, "Too many forecast requests — try again soon")
    if not (settings.service_lat_min <= lat <= settings.service_lat_max
            and settings.service_lng_min <= lng <= settings.service_lng_max):
        raise BadRequest("Forecasts are only available inside the PYTCH service area")
    day = date or ist_today()
    if not (ist_today() - timedelta(days=1) <= day <= ist_today() + timedelta(days=7)):
        raise BadRequest("Forecasts are available from yesterday to 7 days ahead")
    return await service.forecast_day(_snap(lat), _snap(lng), day)


@router.get("/alerts", response_model=list[WeatherAlertOut])
async def my_alerts(db: DB, user: CurrentUser) -> list[WeatherAlertOut]:
    return await service.my_open_alerts(db, user)


@router.get("/alerts/{alert_id}", response_model=WeatherAlertOut)
async def get_alert(alert_id: uuid.UUID, db: DB, user: CurrentUser) -> WeatherAlertOut:
    return await service.get_alert(db, alert_id, user)


@router.get("/alerts/{alert_id}/alternatives", response_model=list[TransferAlternative])
async def alternatives(alert_id: uuid.UUID, db: DB, user: CurrentUser) -> list[TransferAlternative]:
    return await service.alternatives(db, alert_id, user)


@router.post("/alerts/{alert_id}/transfer", response_model=LobbyDetail)
async def transfer(alert_id: uuid.UUID, body: TransferRequest, db: DB, user: CurrentUser) -> LobbyDetail:
    return await service.transfer(db, alert_id, user, body.slot_id)


@router.post("/alerts/{alert_id}/rain-check", response_model=RainCheckResponse)
async def rain_check(alert_id: uuid.UUID, db: DB, user: CurrentUser) -> RainCheckResponse:
    return await service.rain_check(db, alert_id, user)


@router.post("/alerts/{alert_id}/dismiss", response_model=WeatherAlertOut)
async def dismiss(alert_id: uuid.UUID, db: DB, user: CurrentUser) -> WeatherAlertOut:
    return await service.dismiss(db, alert_id, user)
