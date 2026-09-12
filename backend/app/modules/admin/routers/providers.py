import uuid
from typing import Literal

from fastapi import APIRouter, Query

from app.core.deps import DB
from app.modules.admin.routers.common import Perm
from app.modules.admin.schemas import (
    AdminCreateVenue,
    AdminPitchOut,
    AdminProviderDetail,
    AdminProviderRow,
    AdminVenueRow,
    AdminVenueUpdate,
    AssignTurfs,
    PitchActiveUpdate,
    ProviderAdminUpdate,
    ProviderReview,
    ProviderStatusChange,
)
from app.modules.admin.services import providers as service

router = APIRouter(tags=["admin · providers & venues"])


@router.get("/providers", response_model=list[AdminProviderRow])
async def list_providers(
    ctx: Perm("providers.view"), db: DB, status: Literal["pending", "approved", "rejected", "suspended"] | None = None,
    q: str | None = Query(None, max_length=80),
) -> list[AdminProviderRow]:
    return await service.list_providers(db, ctx, status=status, q=q)


@router.get("/providers/{provider_id}", response_model=AdminProviderDetail)
async def get_provider(provider_id: uuid.UUID, ctx: Perm("providers.view"), db: DB) -> AdminProviderDetail:
    return await service.provider_detail(db, ctx, provider_id)


@router.post("/providers/{provider_id}/review", response_model=AdminProviderDetail)
async def review(provider_id: uuid.UUID, body: ProviderReview, ctx: Perm("providers.manage"),
                 db: DB) -> AdminProviderDetail:
    return await service.review(db, ctx, provider_id, body)


@router.post("/providers/{provider_id}/status", response_model=AdminProviderDetail)
async def set_status(provider_id: uuid.UUID, body: ProviderStatusChange, ctx: Perm("providers.manage"),
                     db: DB) -> AdminProviderDetail:
    return await service.set_status(db, ctx, provider_id, body)


@router.patch("/providers/{provider_id}", response_model=AdminProviderDetail)
async def update_provider(provider_id: uuid.UUID, body: ProviderAdminUpdate, ctx: Perm("providers.manage"),
                          db: DB) -> AdminProviderDetail:
    return await service.update(db, ctx, provider_id, body)


@router.post("/providers/{provider_id}/turfs", response_model=AdminProviderDetail)
async def assign_turfs(provider_id: uuid.UUID, body: AssignTurfs, ctx: Perm("providers.manage"),
                       db: DB) -> AdminProviderDetail:
    """🛡 The provider's complete venue list — venues of this provider missing from it are unassigned."""
    return await service.assign_turfs(db, ctx, provider_id, body.turf_ids)


@router.post("/providers/{provider_id}/venues", response_model=AdminProviderDetail, status_code=201)
async def create_venue(provider_id: uuid.UUID, body: AdminCreateVenue, ctx: Perm("providers.manage"),
                       db: DB) -> AdminProviderDetail:
    """🛡 Onboard a venue (turf + pitches + 14 days of slots), usually from an entry of the provider's application
    (`application_index` — each entry once). Coordinates must lie inside the service area."""
    return await service.create_venue(db, ctx, provider_id, body)


@router.get("/venues", response_model=list[AdminVenueRow])
async def list_venues(
    _: Perm("venues.view"), db: DB, q: str | None = Query(None, max_length=80), provider_id: uuid.UUID | None = None,
    active: bool | None = None,
) -> list[AdminVenueRow]:
    return await service.list_venues(db, q=q, provider_id=provider_id, active=active)


@router.patch("/venues/{turf_id}", response_model=AdminVenueRow)
async def update_venue(turf_id: uuid.UUID, body: AdminVenueUpdate, ctx: Perm("venues.manage"), db: DB) -> AdminVenueRow:
    return await service.update_venue(db, ctx, turf_id, body)


@router.patch("/pitches/{pitch_id}", response_model=AdminPitchOut)
async def update_pitch(pitch_id: uuid.UUID, body: PitchActiveUpdate, ctx: Perm("venues.manage"),
                       db: DB) -> AdminPitchOut:
    return await service.set_pitch_active(db, ctx, pitch_id, body.is_active)
