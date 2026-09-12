from fastapi import APIRouter

from app.core.deps import DB
from app.modules.auth import service
from app.modules.auth.schemas import AuthTokens, OtpRequest, OtpRequestResponse, OtpVerify, RefreshRequest

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/otp/request", response_model=OtpRequestResponse)
async def request_otp(body: OtpRequest) -> OtpRequestResponse:
    return await service.request_otp(body.phone)


@router.post("/otp/verify", response_model=AuthTokens)
async def verify_otp(body: OtpVerify, db: DB) -> AuthTokens:
    return await service.verify_otp(db, body.phone, body.code)


@router.post("/refresh", response_model=AuthTokens)
async def refresh(body: RefreshRequest, db: DB) -> AuthTokens:
    return await service.refresh(db, body.refresh_token)
