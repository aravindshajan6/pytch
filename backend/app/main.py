from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
from fastapi.staticfiles import StaticFiles

import app.db.models  # noqa: F401  (register all mappers)
from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, logger
from app.core.redis import close_redis
from app.modules import iter_routers, register_event_handlers
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


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.app_name} API",
        version="1.0.0",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    register_error_handlers(app)

    for router in iter_routers():
        app.include_router(router, prefix=settings.api_prefix)
    app.include_router(ws_router)
    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False)

    media = Path(settings.media_dir)
    media.mkdir(parents=True, exist_ok=True)
    app.mount(settings.media_url_prefix, StaticFiles(directory=media), name="media")
    return app


app = create_app()
