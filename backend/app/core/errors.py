"""Domain errors and their HTTP mapping.

Raise `AppError` subclasses (or `AppError(code, message, status)`) from services;
the handlers registered in `register_error_handlers` render the contract error body:
    {"error": {"code": "...", "message": "...", "details": ...}}
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import logger


class AppError(Exception):
    code = "INTERNAL_ERROR"
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    message = "Something went wrong"

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: Any = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.details = details
        super().__init__(self.message)


class BadRequest(AppError):
    code, status_code, message = "VALIDATION_ERROR", 400, "Bad request"


class Unauthorized(AppError):
    code, status_code, message = "UNAUTHORIZED", 401, "Authentication required"


class Forbidden(AppError):
    code, status_code, message = "FORBIDDEN", 403, "You can't do that"


class NotFound(AppError):
    code, status_code, message = "NOT_FOUND", 404, "Not found"


class Conflict(AppError):
    code, status_code, message = "CONFLICT", 409, "Conflict"


class RateLimited(AppError):
    code, status_code, message = "RATE_LIMITED", 429, "Too many requests — slow down"


class DemoDisabled(AppError):
    code, status_code, message = "DEMO_DISABLED", 404, "Demo controls are disabled"


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> ORJSONResponse:
        return ORJSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> ORJSONResponse:
        errors = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()
        ]
        return ORJSONResponse(_body("VALIDATION_ERROR", "Invalid request", errors), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> ORJSONResponse:
        code = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "VALIDATION_ERROR"}.get(
            exc.status_code, "INTERNAL_ERROR"
        )
        return ORJSONResponse(_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> ORJSONResponse:
        logger.exception("Unhandled error", exc_info=exc)
        return ORJSONResponse(_body("INTERNAL_ERROR", "Something went wrong"), status_code=500)
