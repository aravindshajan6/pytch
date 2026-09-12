"""Feature modules. Each module is self-contained:

    models.py    SQLAlchemy models (tables it owns)
    schemas.py   Pydantic request/response models (mirror frontend/src/types/api.ts)
    service.py   business logic (no FastAPI imports)
    router.py    HTTP endpoints — exports `router`
    handlers.py  (optional) domain-event subscribers, see app.core.events
    jobs.py      (optional) periodic worker jobs, see app.worker
"""

import importlib
import importlib.util
from collections.abc import Iterator

from fastapi import APIRouter

ROUTER_MODULES = [
    "meta",
    "auth",
    "users",
    "turfs",
    "slots",
    "bookings",
    "lobbies",
    "payments",
    "wallet",
    "ratings",
    "bench",
    "highlights",
    "weather",
    "notifications",
    "gamification",
    "dev",
    "coupons",
    "partner",
    "channels",
    "admin",
]


def iter_routers(with_names: bool = False) -> Iterator:
    for name in ROUTER_MODULES:
        router: APIRouter = importlib.import_module(f"app.modules.{name}.router").router
        yield (name, router) if with_names else router


def register_event_handlers() -> None:
    """Import every `handlers.py` so their @on(...) subscriptions register."""
    for name in ROUTER_MODULES:
        spec = importlib.util.find_spec(f"app.modules.{name}.handlers")
        if spec is not None:
            importlib.import_module(f"app.modules.{name}.handlers")
