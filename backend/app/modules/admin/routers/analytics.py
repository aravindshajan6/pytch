from typing import Literal

from fastapi import APIRouter

from app.core.deps import DB
from app.modules.admin.routers.common import Perm
from app.modules.admin.schemas import (
    AnalyticsOverview,
    CohortTable,
    Heatmap,
    SportMix,
    TimeSeries,
    VenueAnalyticsRow,
)
from app.modules.admin.services import analytics as service

router = APIRouter(prefix="/analytics", tags=["admin · analytics"])
Range = Literal["7d", "30d", "90d"]


@router.get("/overview", response_model=AnalyticsOverview)
async def overview(_: Perm("analytics.view"), db: DB, range: Range = "30d") -> AnalyticsOverview:
    return await service.overview(db, range)


@router.get("/timeseries", response_model=TimeSeries)
async def timeseries(
    _: Perm("analytics.view"), db: DB,
    metric: Literal["gmv", "bookings", "new_players", "net_revenue", "active_players"] = "gmv",
    range: Range = "30d", granularity: Literal["day", "week"] = "day",
) -> TimeSeries:
    return await service.timeseries(db, metric, range, granularity)


@router.get("/cohorts", response_model=CohortTable)
async def cohorts(_: Perm("analytics.view"), db: DB) -> CohortTable:
    return await service.cohorts(db)


@router.get("/venues", response_model=list[VenueAnalyticsRow])
async def venues(_: Perm("analytics.view"), db: DB, range: Range = "30d") -> list[VenueAnalyticsRow]:
    return await service.venues(db, range)


@router.get("/heatmap", response_model=Heatmap)
async def heatmap(_: Perm("analytics.view"), db: DB, range: Range = "30d") -> Heatmap:
    return await service.heatmap(db, range)


@router.get("/sports", response_model=SportMix)
async def sports(_: Perm("analytics.view"), db: DB, range: Range = "30d") -> SportMix:
    return await service.sports(db, range)
