"""Factories for partner-portal / channel tests."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_token
from app.core.timeutils import utcnow
from app.modules.providers.models import Provider, ProviderMember
from app.modules.slots.models import Slot
from app.modules.slots.service import generate_slots_for_pitch
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User
from tests.core_helpers import make_venue

API = "/api/v1"


def partner_headers(user: User, provider_id: uuid.UUID | None = None) -> dict[str, str]:
    token = create_token(user.id, "access", audience="partner", session_id=uuid.uuid4())
    headers = {"Authorization": f"Bearer {token}"}
    if provider_id:
        headers["X-Provider-Id"] = str(provider_id)
    return headers


async def make_provider(
    db: AsyncSession, owner: User, *, status: str = "approved", name: str | None = None
) -> Provider:
    provider = Provider(
        id=uuid.uuid4(), name=name or f"Turf Co {uuid.uuid4().hex[:4]}", slug=f"p-{uuid.uuid4().hex[:10]}",
        contact_name=owner.name, contact_phone=owner.phone, city="Kochi", status=status, commission_bps=1000,
        application={},
    )
    db.add(provider)
    await db.flush()
    db.add(ProviderMember(id=uuid.uuid4(), provider_id=provider.id, user_id=owner.id, role="owner", status="active"))
    await db.commit()
    return provider


async def add_member(db: AsyncSession, provider: Provider, user: User, role: str,
                     turf_ids: list[uuid.UUID] | None = None) -> ProviderMember:
    member = ProviderMember(id=uuid.uuid4(), provider_id=provider.id, user_id=user.id, role=role, status="active",
                            turf_ids=[str(t) for t in turf_ids] if turf_ids is not None else None)
    db.add(member)
    await db.commit()
    return member


async def provider_venue(db: AsyncSession, provider: Provider, **kw) -> tuple[Turf, Pitch]:
    turf, pitch = await make_venue(db, **kw)
    turf.provider_id = provider.id
    await db.commit()
    return turf, pitch


async def gen_slots(db: AsyncSession, pitch: Pitch) -> list[Slot]:
    await generate_slots_for_pitch(db, pitch, days=3)
    await db.commit()
    rows = await db.execute(select(Slot).where(Slot.pitch_id == pitch.id).order_by(Slot.start_at))
    return list(rows.unique().scalars().all())


def future_run(slots: list[Slot], n: int, *, min_hours_ahead: float = 3) -> list[Slot]:
    """n consecutive free slots starting at least `min_hours_ahead` from now."""
    cutoff = utcnow() + timedelta(hours=min_hours_ahead)
    candidates = [s for s in slots if s.start_at >= cutoff and s.status == "available"]
    for i in range(len(candidates) - n + 1):
        run = candidates[i:i + n]
        if all(run[j].end_at == run[j + 1].start_at for j in range(n - 1)):
            return run
    raise AssertionError("no consecutive free slots")


@pytest.fixture(autouse=True)
def reset_fetch_hooks():
    """Import into a test module to always restore real DNS/transport after each test."""
    yield
    from app.modules.channels import fetch

    fetch.reset_test_hooks()


async def public_resolver(host: str, port: int) -> list[str]:
    return ["93.184.216.34"]  # pretend every name resolves to a public address
