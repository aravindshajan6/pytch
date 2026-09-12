import uuid

from fastapi import APIRouter, Query

from app.core.config import settings
from app.core.deps import DB, CurrentUser
from app.modules.bench import service
from app.modules.bench.schemas import BenchNearby, BenchStatusOut, BenchUpdate, CreateSOSRequest, SOSRequestOut
from app.modules.lobbies.detail_schemas import AcceptSOSResponse
from app.modules.turfs.schemas import Sport

router = APIRouter(prefix="/bench", tags=["bench"])


@router.get("/me", response_model=BenchStatusOut)
async def get_me(db: DB, user: CurrentUser) -> BenchStatusOut:
    return await service.get_bench(db, user)


@router.put("/me", response_model=BenchStatusOut)
async def put_me(body: BenchUpdate, db: DB, user: CurrentUser) -> BenchStatusOut:
    return await service.update_bench(db, user, body)


@router.get("/nearby", response_model=BenchNearby)
async def nearby(
    db: DB,
    user: CurrentUser,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    sport: Sport | None = None,
    radius_km: float = Query(settings.bench_default_radius_km, gt=0, le=50),
) -> BenchNearby:
    return await service.nearby(db, user, lat=lat, lng=lng, sport=sport, radius_km=radius_km)


@router.get("/sos", response_model=list[SOSRequestOut])
async def sos_feed(db: DB, user: CurrentUser) -> list[SOSRequestOut]:
    return await service.sos_feed(db, user)


@router.post("/sos", response_model=SOSRequestOut)
async def create_sos(body: CreateSOSRequest, db: DB, user: CurrentUser) -> SOSRequestOut:
    return await service.create_manual_sos(db, user, body)


@router.post("/sos/{sos_id}/accept", response_model=AcceptSOSResponse)
async def accept(sos_id: uuid.UUID, db: DB, user: CurrentUser) -> AcceptSOSResponse:
    return await service.accept_sos(db, sos_id, user)


@router.post("/sos/{sos_id}/decline")
async def decline(sos_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    await service.decline_sos(db, sos_id, user)
    return {"ok": True}
