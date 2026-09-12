import uuid

from fastapi import APIRouter, Cookie, Request, Response, status

from app.core.deps import DB
from app.modules.admin.deps import CurrentAdmin
from app.modules.admin.schemas import (
    AdminAuth,
    AdminAuthWithRecovery,
    AdminLoginRequest,
    AdminLoginResponse,
    AdminMe,
    AdminSessionOut,
    ChangePasswordRequest,
    MfaConfirmRequest,
    MfaEnrollStart,
    MfaTokenRequest,
    MfaVerifyRequest,
    OkResponse,
    StepUpRequest,
    StepUpResponse,
)
from app.modules.admin.services import auth as service
from app.modules.auth.models import AuthSession

router = APIRouter(prefix="/auth", tags=["admin · auth"])


def _set_cookies(response: Response, refresh_token: str, session: AuthSession) -> None:
    for spec in service.cookie_specs(refresh_token, session):
        response.set_cookie(**spec)


def _clear_cookies(response: Response) -> None:
    from app.core.config import settings

    response.delete_cookie(service.REFRESH_COOKIE, path=service.COOKIE_PATH, secure=settings.admin_cookie_secure,
                           httponly=True, samesite="strict")
    response.delete_cookie(service.CSRF_COOKIE, path="/", secure=settings.admin_cookie_secure, samesite="strict")


@router.post("/login", response_model=AdminLoginResponse)
async def login(body: AdminLoginRequest, request: Request, db: DB) -> AdminLoginResponse:
    return await service.login(db, request, body.email, body.password)


@router.post("/mfa/enroll/start", response_model=MfaEnrollStart)
async def enroll_start(body: MfaTokenRequest, request: Request, db: DB) -> MfaEnrollStart:
    return await service.enroll_start(db, request, body.mfa_token)


@router.post("/mfa/enroll/confirm", response_model=AdminAuthWithRecovery)
async def enroll_confirm(body: MfaConfirmRequest, request: Request, response: Response,
                         db: DB) -> AdminAuthWithRecovery:
    out, refresh_token, session = await service.enroll_confirm(db, request, body.mfa_token, body.code)
    _set_cookies(response, refresh_token, session)
    return out


@router.post("/mfa/verify", response_model=AdminAuth)
async def mfa_verify(body: MfaVerifyRequest, request: Request, response: Response, db: DB) -> AdminAuth:
    out, refresh_token, session = await service.mfa_verify(db, request, body.mfa_token, body.code, body.recovery_code)
    _set_cookies(response, refresh_token, session)
    return out


@router.post("/refresh", response_model=AdminAuth)
async def refresh(request: Request, response: Response, db: DB,
                  pytch_admin_rt: str | None = Cookie(None)) -> AdminAuth:
    out, refresh_token, session = await service.refresh(db, request, pytch_admin_rt)
    _set_cookies(response, refresh_token, session)
    return out


@router.post("/logout", response_model=OkResponse)
async def logout(request: Request, response: Response, db: DB,
                 pytch_admin_rt: str | None = Cookie(None)) -> OkResponse:
    await service.logout(db, request, pytch_admin_rt)
    _clear_cookies(response)
    return OkResponse(ok=True)


@router.post("/step-up", response_model=StepUpResponse)
async def step_up(body: StepUpRequest, ctx: CurrentAdmin, db: DB) -> StepUpResponse:
    return await service.step_up(db, ctx, body.code)


@router.get("/me", response_model=AdminMe)
async def me(ctx: CurrentAdmin) -> AdminMe:
    return service.admin_me(ctx.admin)


@router.post("/password", response_model=OkResponse)
async def change_password(body: ChangePasswordRequest, ctx: CurrentAdmin, db: DB) -> OkResponse:
    """🛡 step-up required (fresh right after sign-in). Revokes every other session."""
    await service.change_password(db, ctx, body.current_password, body.new_password)
    return OkResponse(ok=True)


@router.get("/sessions", response_model=list[AdminSessionOut])
async def sessions(ctx: CurrentAdmin, db: DB) -> list[AdminSessionOut]:
    return await service.list_sessions(db, ctx)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(session_id: uuid.UUID, ctx: CurrentAdmin, db: DB) -> Response:
    await service.revoke_own_session(db, ctx, session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
