from fastapi import APIRouter

from app.core.deps import DB, CurrentUser
from app.modules.coupons import service
from app.modules.coupons.schemas import CouponValidation, ValidateCouponRequest

router = APIRouter(prefix="/coupons", tags=["coupons"])


@router.post("/validate", response_model=CouponValidation)
async def validate(body: ValidateCouponRequest, user: CurrentUser, db: DB) -> CouponValidation:
    """Dry-run a code against the caller's seat in a lobby (never reserves a use)."""
    return await service.validate(db, user, body.code, body.lobby_id)
