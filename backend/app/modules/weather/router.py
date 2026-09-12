import uuid
from datetime import date

from fastapi import APIRouter, Query

from app.core.deps import DB, CurrentUser
from app.core.timeutils import ist_today
from app.modules.lobbies.detail_schemas import LobbyDetail, RainCheckResponse
from app.modules.weather import service
from app.modules.weather.schemas import HourWeather, TransferAlternative, TransferRequest, WeatherAlertOut

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("/forecast", response_model=list[HourWeather])
async def forecast(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    date: date | None = None,
) -> list[HourWeather]:
    return await service.forecast_day(lat, lng, date or ist_today())


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
