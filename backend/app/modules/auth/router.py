from fastapi import APIRouter, Request

from app.core.config import settings
from app.core.deps import DB, Credentials, CurrentUser
from app.core.ratelimit import client_ip, enforce, user_agent
from app.modules.auth import service
from app.modules.auth.schemas import AuthTokens, OtpRequest, OtpRequestResponse, OtpVerify, RefreshRequest

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/otp/request", response_model=OtpRequestResponse)
async def request_otp(body: OtpRequest, request: Request) -> OtpRequestResponse:
    return await service.request_otp(body.phone, ip=client_ip(request))


@router.post("/otp/verify", response_model=AuthTokens)
async def verify_otp(body: OtpVerify, db: DB, request: Request) -> AuthTokens:
    await enforce(f"otp-verify-ip:{client_ip(request)}", settings.otp_verify_ip_max, 600)
    return await service.verify_otp(db, body.phone, body.code, ip=client_ip(request), user_agent=user_agent(request))


@router.post("/refresh", response_model=AuthTokens)
async def refresh(body: RefreshRequest, db: DB) -> AuthTokens:
    return await service.refresh(db, body.refresh_token)


@router.post("/logout")
async def logout(_: CurrentUser, db: DB, creds: Credentials) -> dict[str, bool]:
    """Revoke the current session (its access + refresh tokens stop working immediately)."""
    assert creds is not None  # CurrentUser already required a bearer token
    await service.logout(db, creds.credentials)
    return {"ok": True}
