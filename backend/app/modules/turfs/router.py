from fastapi import APIRouter, Query

from app.core.deps import DB
from app.core.pagination import Page
from app.modules.turfs import service
from app.modules.turfs.schemas import Sport, TurfDetail, TurfSummary

router = APIRouter(tags=["turfs"])


@router.get("/turfs", response_model=Page[TurfSummary])
async def list_turfs(
    db: DB,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    radius_km: float = Query(25, gt=0, le=200),
    sport: Sport | None = None,
    indoor: bool | None = None,
    has_camera: bool | None = None,
    q: str | None = Query(None, max_length=80),
    sort: service.TurfSort = "distance",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> Page[TurfSummary]:
    return await service.list_turfs(
        db, lat=lat, lng=lng, radius_km=radius_km, sport=sport, indoor=indoor, has_camera=has_camera,
        q=q, sort=sort, limit=limit, offset=offset,
    )


@router.get("/turfs/{slug}", response_model=TurfDetail)
async def get_turf(
    slug: str,
    db: DB,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
) -> TurfDetail:
    return await service.turf_detail(db, slug, lat=lat, lng=lng)
