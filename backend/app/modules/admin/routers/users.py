import uuid
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.core.deps import DB
from app.core.pagination import Page
from app.core.responses import ORJSONResponse
from app.modules.admin.routers.common import Perm
from app.modules.admin.schemas import (
    AdminUserDetail,
    AdminUserRow,
    ApprovalPending,
    LogoutAllResponse,
    SetUserStatus,
    WalletAdjust,
)
from app.modules.admin.services import users as service

router = APIRouter(prefix="/users", tags=["admin · players"])
Status = Literal["active", "suspended", "banned"]


@router.get("", response_model=Page[AdminUserRow])
async def list_users(
    ctx: Perm("users.view"), db: DB, q: str | None = Query(None, max_length=80), status: Status | None = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
) -> Page[AdminUserRow]:
    return await service.list_users(db, ctx, q=q, status=status, limit=limit, offset=offset)


@router.get("/export.csv")
async def export_csv(ctx: Perm("users.view", "data.export"), db: DB, q: str | None = Query(None, max_length=80),
                     status: Status | None = None) -> Response:
    """🛡 Full player list with PII — audited."""
    body = await service.export_csv(db, ctx, q=q, status=status)
    return Response(body, media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="pytch-players.csv"'})


@router.get("/{user_id}", response_model=AdminUserDetail)
async def get_user(user_id: uuid.UUID, ctx: Perm("users.view"), db: DB) -> AdminUserDetail:
    return await service.user_detail(db, ctx, user_id)


@router.post("/{user_id}/status", response_model=AdminUserDetail)
async def set_status(user_id: uuid.UUID, body: SetUserStatus, ctx: Perm("users.manage"), db: DB) -> AdminUserDetail:
    return await service.set_status(db, ctx, user_id, body)


@router.post("/{user_id}/wallet", response_model=AdminUserDetail,
             responses={202: {"model": ApprovalPending,
                              "description": "Credit above the threshold — queued for a second admin"}})
async def adjust_wallet(user_id: uuid.UUID, body: WalletAdjust, ctx: Perm("wallet.adjust"), db: DB):
    """🛡 200 → adjusted. Credits above REFUND_DUAL_APPROVAL_PAISE → 202 `{approval_id}` (APPROVAL_REQUIRED).
    Support: 409 LIMIT_REACHED past ₹1,000/player/day or ₹5,000/admin/day of credits."""
    result = await service.adjust_wallet(db, ctx, user_id, body)
    if isinstance(result, ApprovalPending):
        body_202 = result.model_dump(mode="json")
        body_202["error"] = {"code": "APPROVAL_REQUIRED", "message": result.message,
                             "details": {"approval_id": str(result.approval_id)}}
        return ORJSONResponse(body_202, status_code=202)
    return result


@router.post("/{user_id}/logout-all", response_model=LogoutAllResponse)
async def logout_all(user_id: uuid.UUID, ctx: Perm("users.manage"), db: DB) -> LogoutAllResponse:
    return LogoutAllResponse(ok=True, revoked=await service.logout_all(db, ctx, user_id))
