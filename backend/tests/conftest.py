"""Test harness: real Postgres (`pytch_test` DB) + Redis db 15.

Tables are created fresh once per session and truncated after every test.
Use the `client` fixture for HTTP tests and `make_user` / `auth_headers` for auth.
"""

import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("PAYMENT_PROVIDER", "mock")
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://pytch:pytch@localhost:5433/pytch_test"
)
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL", "redis://localhost:6380/15")

import uuid  # noqa: E402
from collections.abc import AsyncIterator  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.redis import get_redis  # noqa: E402
from app.core.security import create_token  # noqa: E402
from app.db.models import Base  # noqa: E402
from app.main import app  # noqa: E402
from app.modules import register_event_handlers  # noqa: E402
from app.modules.users.models import PlayerStats, User  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
async def _schema() -> AsyncIterator[None]:
    register_event_handlers()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:
    yield
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    await get_redis().flushdb()


@pytest.fixture
async def db():
    async with SessionLocal() as session:
        yield session


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def make_user(db):
    async def _make(name: str = "Tester", phone: str | None = None, **fields) -> User:
        user = User(
            id=uuid.uuid4(),
            name=name,
            phone=phone or f"+9199{uuid.uuid4().int % 10**8:08d}",
            onboarded=True,
            **fields,
        )
        user.stats = PlayerStats(user_id=user.id)
        db.add(user)
        await db.commit()
        return user

    return _make


def auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_token(user.id, 'access')}"}
