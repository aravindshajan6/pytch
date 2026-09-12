"""Catalog, broadcasts, runtime settings, audit log, team and system health."""

import uuid
from datetime import date
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Header, Query

from app.core.deps import DB
from app.modules.admin.deps import ReadyAdmin
from app.modules.admin.routers.common import Perm
from app.modules.admin.schemas import (
    AdminAccountOut,
    AuditPage,
    ChainVerification,
    CreateAdminRequest,
    CreatedAdmin,
    LogoutAllResponse,
    ResetPasswordResult,
    SystemHealth,
    UpdateAdminRequest,
)
from app.modules.admin.services import system as system_service
from app.modules.admin.services import team as team_service
from app.modules.platform import service as platform
from app.modules.platform.schemas import (
    BroadcastInput,
    BroadcastOut,
    BroadcastPreview,
    BroadcastPreviewRequest,
    SettingOut,
    SettingUpdate,
    SportCatalogInput,
    SportCatalogOut,
)

router = APIRouter(tags=["admin · platform"])

# ───────────── catalog ─────────────


@router.get("/catalog/sports", response_model=list[SportCatalogOut])
async def list_sports(_: Perm("catalog.manage"), db: DB) -> list[SportCatalogOut]:
    return await platform.list_sports(db)


@router.put("/catalog/sports/{key}", response_model=SportCatalogOut)
async def put_sport(key: str, body: SportCatalogInput, ctx: Perm("catalog.manage"), db: DB) -> SportCatalogOut:
    return await platform.upsert_sport(db, ctx, key, body)


# ───────────── broadcasts ─────────────


@router.get("/broadcasts", response_model=list[BroadcastOut])
async def list_broadcasts(_: Perm("broadcast.send"), db: DB) -> list[BroadcastOut]:
    return await platform.list_broadcasts(db)


@router.post("/broadcasts/preview", response_model=BroadcastPreview)
async def preview(_: Perm("broadcast.send"), db: DB, body: BroadcastPreviewRequest) -> BroadcastPreview:
    return BroadcastPreview(recipients=await platform.preview_recipients(db, body.target()))


@router.post("/broadcasts", response_model=BroadcastOut, status_code=201)
async def send(body: BroadcastInput, ctx: Perm("broadcast.send"), db: DB) -> BroadcastOut:
    return await platform.send_broadcast(db, ctx, body)


# ───────────── settings ─────────────


@router.get("/settings", response_model=list[SettingOut])
async def list_settings(_: Perm("settings.view"), db: DB) -> list[SettingOut]:
    return await platform.list_settings(db)


@router.put("/settings/{key}", response_model=SettingOut)
async def put_setting(
    key: str,
    body: SettingUpdate,
    ctx: Perm("settings.manage"),
    db: DB,
    x_admin_reason: Annotated[str | None, Header(max_length=900)] = None,
) -> SettingOut:
    """🛡 Kill switches and business-rule overrides (audited with the admin's reason, applied within seconds)."""
    reason = unquote(x_admin_reason).strip()[:300] if x_admin_reason else None
    return await platform.put_setting(db, ctx, key, body.value, reason=reason or None)


# ───────────── audit ─────────────


@router.get("/audit", response_model=AuditPage)
async def audit_log(
    _: Perm("audit.view"), db: DB, actor: str | None = Query(None, max_length=160),
    action: str | None = Query(None, max_length=60), target_type: str | None = Query(None, max_length=40),
    target_id: str | None = Query(None, max_length=64), from_: date | None = Query(None, alias="from"),
    to: date | None = None, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
) -> AuditPage:
    return await system_service.audit_page(db, actor=actor, action=action, target_type=target_type,
                                           target_id=target_id, date_from=from_, date_to=to, limit=limit,
                                           offset=offset)


@router.get("/audit/target-types", response_model=list[str])
async def audit_target_types(_: Perm("audit.view"), db: DB) -> list[str]:
    """Options for the audit log's target filter."""
    return await system_service.audit_target_types(db)


@router.get("/audit/verify", response_model=ChainVerification)
async def verify_audit(_: Perm("audit.view"), db: DB) -> ChainVerification:
    return await system_service.verify_full(db)


# ───────────── team ─────────────


@router.get("/team", response_model=list[AdminAccountOut])
async def list_team(_: Perm("admins.manage", step_up=False), db: DB) -> list[AdminAccountOut]:
    return await team_service.list_team(db)


@router.post("/team", response_model=CreatedAdmin, status_code=201)
async def create_admin(body: CreateAdminRequest, ctx: Perm("admins.manage"), db: DB) -> CreatedAdmin:
    """🛡 Returns a temporary password once; the new admin must change it and enrol MFA at first login."""
    return await team_service.create(db, ctx, body)


@router.patch("/team/{admin_id}", response_model=AdminAccountOut)
async def update_admin(admin_id: uuid.UUID, body: UpdateAdminRequest, ctx: Perm("admins.manage"),
                       db: DB) -> AdminAccountOut:
    return await team_service.update(db, ctx, admin_id, body)


@router.post("/team/{admin_id}/reset-mfa", response_model=AdminAccountOut)
async def reset_mfa(admin_id: uuid.UUID, ctx: Perm("admins.manage"), db: DB) -> AdminAccountOut:
    return await team_service.reset_mfa(db, ctx, admin_id)


@router.post("/team/{admin_id}/reset-password", response_model=ResetPasswordResult)
async def reset_password(admin_id: uuid.UUID, ctx: Perm("admins.manage"), db: DB) -> ResetPasswordResult:
    """🛡 super admin, never yourself: temporary password (shown once) + must change it; sessions revoked."""
    return await team_service.reset_password(db, ctx, admin_id)


@router.post("/team/{admin_id}/revoke-sessions", response_model=LogoutAllResponse)
async def revoke_sessions(admin_id: uuid.UUID, ctx: Perm("admins.manage"), db: DB) -> LogoutAllResponse:
    return LogoutAllResponse(ok=True, revoked=await team_service.revoke_sessions(db, ctx, admin_id))


# ───────────── system ─────────────


@router.get("/system/health", response_model=SystemHealth)
async def health(_: ReadyAdmin, db: DB) -> SystemHealth:
    return await system_service.health(db)
