"""Tenant scoping for partner requests: never trust client-supplied turf/pitch ids — everything is resolved
through `ctx.provider.id` and the member's venue scope. Foreign or out-of-scope resources are reported as 404
(no existence leak)."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.modules.channels.service import Actor
from app.modules.partner.deps import PartnerContext
from app.modules.turfs.models import Pitch, Turf


def partner_actor(ctx: PartnerContext) -> Actor:
    return Actor(
        type="provider",
        id=ctx.user.id,
        label=f"{ctx.user.name} @ {ctx.provider.name} ({ctx.role})",
        user_id=ctx.user.id,
    )


async def scoped_turfs(db: AsyncSession, ctx: PartnerContext) -> list[Turf]:
    turfs = (
        (await db.execute(select(Turf).where(Turf.provider_id == ctx.provider.id).order_by(Turf.name)))
        .unique()
        .scalars()
        .all()
    )
    return [t for t in turfs if ctx.can_access_turf(t.id)]


async def scoped_turf_ids(db: AsyncSession, ctx: PartnerContext) -> list[uuid.UUID]:
    ids = (await db.scalars(select(Turf.id).where(Turf.provider_id == ctx.provider.id))).all()
    return [i for i in ids if ctx.can_access_turf(i)]


async def get_turf(db: AsyncSession, ctx: PartnerContext, turf_id: uuid.UUID) -> Turf:
    turf = await db.get(Turf, turf_id)
    if turf is None or turf.provider_id != ctx.provider.id or not ctx.can_access_turf(turf.id):
        raise NotFound("Venue not found")
    return turf


async def get_pitch(db: AsyncSession, ctx: PartnerContext, pitch_id: uuid.UUID) -> Pitch:
    pitch = await db.get(Pitch, pitch_id)
    if pitch is None or pitch.turf.provider_id != ctx.provider.id or not ctx.can_access_turf(pitch.turf_id):
        raise NotFound("Pitch not found")
    return pitch


async def scoped_pitches(db: AsyncSession, ctx: PartnerContext, *, active_only: bool = False) -> list[Pitch]:
    q = (
        select(Pitch)
        .join(Turf, Turf.id == Pitch.turf_id)
        .where(Turf.provider_id == ctx.provider.id)
        .order_by(Turf.name, Pitch.name)
    )
    if active_only:
        q = q.where(Pitch.is_active.is_(True))
    pitches = (await db.execute(q)).unique().scalars().all()
    return [p for p in pitches if ctx.can_access_turf(p.turf_id)]
