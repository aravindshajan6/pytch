from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

import app.db.models  # noqa: F401  (register all mappers)
from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, logger
from app.core.redis import close_redis
from app.core.responses import ORJSONResponse
from app.modules import iter_routers, register_event_handlers
from app.modules.admin.security_headers import AdminSecurityHeaders
from app.modules.meta.router import health
from app.realtime.manager import manager
from app.realtime.router import router as ws_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    register_event_handlers()
    await manager.start()
    logger.info("%s API up (env=%s, demo=%s, payments=%s)", settings.app_name, settings.environment,
                settings.demo_mode, settings.payment_provider)
    yield
    await manager.stop()
    await close_redis()
    await engine.dispose()


class PublicOnlyCORSMiddleware(CORSMiddleware):
    """CORS for the player/partner API only. The admin console is same-origin (its own nginx server), so the
    admin API never answers cross-origin preflights or emits Access-Control-Allow-* headers."""

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[override]
        if scope["type"] == "http" and scope["path"].startswith(f"{settings.api_prefix}/admin"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


class ApiGZipMiddleware(GZipMiddleware):
    """Gzip JSON only. Media is already compressed, and re-encoding byte-range (206 / multipart/byteranges)
    responses breaks their Content-Length ("Response content longer than Content-Length")."""

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[override]
        if scope["type"] == "http" and scope["path"].startswith(settings.media_url_prefix):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


_hide_docs = settings.environment == "production" and not settings.demo_mode


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.app_name} API",
        version="1.0.0",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        # interactive docs only outside production (the admin API is never in the public schema)
        docs_url=None if _hide_docs else f"{settings.api_prefix}/docs",
        openapi_url=None if _hide_docs else f"{settings.api_prefix}/openapi.json",
    )
    app.add_middleware(
        PublicOnlyCORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ApiGZipMiddleware, minimum_size=1024)
    app.add_middleware(AdminSecurityHeaders)  # no-store / nosniff / no-referrer / DENY on /api/v1/admin/*
    register_error_handlers(app)

    for name, router in iter_routers(with_names=True):
        # admin surface stays out of the public OpenAPI document
        app.include_router(router, prefix=settings.api_prefix, include_in_schema=name != "admin")
    app.include_router(ws_router)
    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False)

    media = Path(settings.media_dir)
    media.mkdir(parents=True, exist_ok=True)
    app.mount(settings.media_url_prefix, StaticFiles(directory=media), name="media")
    return app


app = create_app()
