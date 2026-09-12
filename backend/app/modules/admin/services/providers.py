"""Service-provider (venue partner) and venue administration."""

import uuid
from datetime import time, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import SPORTS
from app.core.errors import BadRequest, Conflict, NotFound
from app.core.timeutils import utcnow
from app.modules.admin.auditing import audit
from app.modules.admin.deps import AdminContext
from app.modules.admin.models import AdminUser, ApprovalRequest
from app.modules.admin.schemas import (
    AdminApplicationVenue,
    AdminCreateVenue,
    AdminPitchOut,
    AdminProviderDetail,
    AdminProviderRow,
    AdminVenueRow,
    AdminVenueUpdate,
    ProviderAdminUpdate,
    ProviderMemberBrief,
    ProviderReview,
    ProviderStatusChange,
)
from app.modules.admin.services.common import like_term, phone_match, show_phone
from app.modules.audit import service as audit_service
from app.modules.bookings.models import Booking
from app.modules.channels.models import SyncConflict
from app.modules.lobbies.models import Lobby
from app.modules.notifications.service import notify_many
from app.modules.providers.models import Provider, ProviderMember
from app.modules.providers.service import owner_user_ids, slugify
from app.modules.settlements.models import Settlement
from app.modules.settlements.service import settlement_out
from app.modules.slots.service import generate_slots_for_pitch
from app.modules.turfs.models import Pitch, Turf

CONFIRMED = ("confirmed", "completed")
CREATED_TURFS_KEY = "created_turfs"  # provider.application[…] = {"<application index>": "<turf id>"} (onboarded venues)

# ═══════════════════════════ venues ═══════════════════════════


async def _bookings_30d(db: AsyncSession, turf_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
    """turf_id → (bookings, gmv) for confirmed/completed bookings played in the last 30 days."""
    if not turf_ids:
        return {}
    since = utcnow() - timedelta(days=30)
    rows = await db.execute(
        select(Lobby.turf_id, func.count(Booking.id), func.coalesce(func.sum(Booking.total_paise), 0))
        .join(Lobby, Lobby.booking_id == Booking.id)
        .where(Lobby.turf_id.in_(turf_ids), Booking.status.in_(CONFIRMED), Lobby.start_at >= since,
               Lobby.start_at < utcnow())
        .group_by(Lobby.turf_id)
    )
    return {tid: (int(n), int(g)) for tid, n, g in rows.all()}


async def _upcoming(db: AsyncSession, turf_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """turf_id → Pytch games (forming/confirmed) that haven't ended yet."""
    if not turf_ids:
        return {}
    rows = await db.execute(
        select(Lobby.turf_id, func.count(Lobby.id))
        .where(Lobby.turf_id.in_(turf_ids), Lobby.status.in_(("forming", "confirmed")), Lobby.end_at > utcnow())
        .group_by(Lobby.turf_id)
    )
    return {tid: int(n) for tid, n in rows.all()}


async def venue_rows(db: AsyncSession, turfs: list[Turf]) -> list[AdminVenueRow]:
    stats = await _bookings_30d(db, [t.id for t in turfs])
    upcoming = await _upcoming(db, [t.id for t in turfs])
    provider_ids = {t.provider_id for t in turfs if t.provider_id}
    names = dict((await db.execute(select(Provider.id, Provider.name).where(Provider.id.in_(provider_ids)))).all()) \
        if provider_ids else {}
    out = []
    for t in turfs:
        pitches = list(t.pitches)
        out.append(AdminVenueRow(
            id=t.id, slug=t.slug, name=t.name, area=t.area, provider_id=t.provider_id,
            provider_name=names.get(t.provider_id), pitch_count=len(pitches),
            sports=sorted({p.sport for p in pitches}), is_active=t.is_active, is_featured=t.is_featured,
            rating_avg=t.rating_avg, bookings_30d=stats.get(t.id, (0, 0))[0], upcoming_bookings=upcoming.get(t.id, 0),
        ))
    return out


async def list_venues(db: AsyncSession, *, q: str | None, provider_id: uuid.UUID | None,
                      active: bool | None) -> list[AdminVenueRow]:
    stmt = select(Turf).order_by(Turf.name)
    if q:
        like = like_term(q.strip())
        stmt = stmt.where(or_(Turf.name.ilike(like, escape="\\"), Turf.area.ilike(like, escape="\\"),
                              Turf.slug.ilike(like, escape="\\")))
    if provider_id:
        stmt = stmt.where(Turf.provider_id == provider_id)
    if active is not None:
        stmt = stmt.where(Turf.is_active.is_(active))
    turfs = list((await db.scalars(stmt.limit(1000))).all())
    return await venue_rows(db, turfs)


async def update_venue(db: AsyncSession, ctx: AdminContext, turf_id: uuid.UUID,
                       body: AdminVenueUpdate) -> AdminVenueRow:
    turf = await db.scalar(select(Turf).where(Turf.id == turf_id).with_for_update())
    if turf is None:
        raise NotFound("Venue not found")
    patch = body.model_dump(exclude_unset=True)
    if patch.get("name") is None:
        patch.pop("name", None)
    for key in ("is_active", "is_featured"):
        if key in patch and patch[key] is None:
            patch.pop(key)
    before = {k: getattr(turf, k) for k in patch}
    for k, v in patch.items():
        setattr(turf, k, v)
    changes = audit_service.diff(before, patch)
    if changes:
        await audit(db, ctx, "venue.update", f"Edited venue {turf.name}", target_type="turf", target_id=turf.id,
                    changes=changes)
    await db.commit()
    return (await venue_rows(db, [turf]))[0]


async def set_pitch_active(db: AsyncSession, ctx: AdminContext, pitch_id: uuid.UUID, is_active: bool) -> AdminPitchOut:
    pitch = await db.scalar(select(Pitch).where(Pitch.id == pitch_id).with_for_update(of=Pitch))
    if pitch is None:
        raise NotFound("Pitch not found")
    if pitch.is_active != is_active:
        await audit(db, ctx, "pitch.update", f"{'Activated' if is_active else 'Deactivated'} pitch {pitch.name}",
                    target_type="pitch", target_id=pitch.id, changes={"is_active": [pitch.is_active, is_active]})
        pitch.is_active = is_active
        await db.commit()
    return AdminPitchOut.model_validate(pitch)


# ═══════════════════════════ providers ═══════════════════════════


async def _provider_aggregates(db: AsyncSession, provider_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
    if not provider_ids:
        return {}
    since = utcnow() - timedelta(days=30)
    venues = dict((await db.execute(
        select(Turf.provider_id, func.count(Turf.id)).where(Turf.provider_id.in_(provider_ids))
        .group_by(Turf.provider_id))).all())
    gmv = dict((await db.execute(
        select(Turf.provider_id, func.coalesce(func.sum(Booking.total_paise), 0))
        .select_from(Booking).join(Lobby, Lobby.booking_id == Booking.id).join(Turf, Turf.id == Lobby.turf_id)
        .where(Turf.provider_id.in_(provider_ids), Booking.status.in_(CONFIRMED), Lobby.start_at >= since,
               Lobby.start_at < utcnow())
        .group_by(Turf.provider_id))).all())
    conflicts = dict((await db.execute(
        select(SyncConflict.provider_id, func.count(SyncConflict.id))
        .where(SyncConflict.provider_id.in_(provider_ids), SyncConflict.status == "open")
        .group_by(SyncConflict.provider_id))).all())
    return {pid: {"venues": int(venues.get(pid, 0)), "gmv": int(gmv.get(pid, 0)),
                  "conflicts": int(conflicts.get(pid, 0))} for pid in provider_ids}


async def list_providers(db: AsyncSession, ctx: AdminContext, *, status: str | None,
                         q: str | None) -> list[AdminProviderRow]:
    stmt = select(Provider).order_by(Provider.created_at.desc())
    if status:
        stmt = stmt.where(Provider.status == status)
    if q:
        like = like_term(q.strip())
        stmt = stmt.where(or_(Provider.name.ilike(like, escape="\\"), Provider.contact_name.ilike(like, escape="\\"),
                              phone_match(Provider.contact_phone, q.strip(), ctx.sees_pii),
                              Provider.city.ilike(like, escape="\\")))
    providers = list((await db.scalars(stmt.limit(1000))).all())
    agg = await _provider_aggregates(db, [p.id for p in providers])
    return [
        AdminProviderRow(
            id=p.id, name=p.name, city=p.city, status=p.status,  # type: ignore[arg-type]
            contact_name=p.contact_name, contact_phone=show_phone(p.contact_phone, ctx.sees_pii),
            venue_count=agg[p.id]["venues"], commission_bps=p.commission_bps, gmv_30d_paise=agg[p.id]["gmv"],
            open_conflicts=agg[p.id]["conflicts"], payouts_on_hold=p.payouts_on_hold, created_at=p.created_at,
        )
        for p in providers
    ]


async def _get_provider(db: AsyncSession, provider_id: uuid.UUID, *, for_update: bool = False) -> Provider:
    stmt = select(Provider).where(Provider.id == provider_id)
    if for_update:
        stmt = stmt.with_for_update(of=Provider).execution_options(populate_existing=True)
    provider = (await db.execute(stmt)).unique().scalar_one_or_none()
    if provider is None:
        raise NotFound("Provider not found")
    return provider


def _created_turfs(p: Provider) -> dict[str, str]:
    """application index (str) → turf id of the venues already onboarded from the partner's application."""
    raw = (p.application or {}).get(CREATED_TURFS_KEY)
    return {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


def _num(x: object) -> float | None:
    return float(x) if isinstance(x, int | float) and not isinstance(x, bool) else None


async def _application_venues(db: AsyncSession, p: Provider) -> list[AdminApplicationVenue]:
    venues = (p.application or {}).get("venues")
    if not isinstance(venues, list):
        return []
    created = _created_turfs(p)
    ids = []
    for tid in created.values():
        try:
            ids.append(uuid.UUID(tid))
        except ValueError:
            continue
    names = dict((await db.execute(select(Turf.id, Turf.name).where(Turf.id.in_(ids)))).all()) if ids else {}
    out = []
    for i, v in enumerate(venues):
        if not isinstance(v, dict):
            continue
        turf_id = next((t for t in names if str(t) == created.get(str(i))), None)
        out.append(AdminApplicationVenue(
            index=i, name=str(v.get("name") or f"Venue {i + 1}"), area=str(v.get("area") or ""),
            address=str(v.get("address") or ""), lat=_num(v.get("lat")), lng=_num(v.get("lng")),
            sports=[str(x) for x in v.get("sports") or [] if isinstance(x, str)],
            pitch_count=int(v.get("pitch_count") or 1) if isinstance(v.get("pitch_count"), int) else 1,
            has_indoor=v.get("has_indoor") is True, notes=v.get("notes") if isinstance(v.get("notes"), str) else None,
            turf_id=turf_id, turf_name=names.get(turf_id) if turf_id else None,
        ))
    return out


async def provider_detail(db: AsyncSession, ctx: AdminContext, provider_id: uuid.UUID) -> AdminProviderDetail:
    p = await _get_provider(db, provider_id)
    pii = ctx.sees_pii
    turfs = list((await db.scalars(select(Turf).where(Turf.provider_id == p.id).order_by(Turf.name))).all())
    settlements = (await db.scalars(select(Settlement).where(Settlement.provider_id == p.id)
                                    .order_by(Settlement.period_end.desc()).limit(20))).all()
    reviewer = await db.scalar(select(AdminUser.email).where(AdminUser.id == p.reviewed_by_admin_id)) \
        if p.reviewed_by_admin_id else None
    members = [
        ProviderMemberBrief(name=m.user.name if m.user is not None else None,
                            phone=show_phone(m.user.phone if m.user is not None else m.invited_phone, pii),
                            role=m.role, status=m.status)
        for m in (await db.execute(select(ProviderMember).where(ProviderMember.provider_id == p.id)
                                   .order_by(ProviderMember.created_at))).unique().scalars()
    ]
    return AdminProviderDetail(
        application_venues=await _application_venues(db, p),
        id=p.id, name=p.name, slug=p.slug, legal_name=p.legal_name, gstin=p.gstin, contact_name=p.contact_name,
        contact_phone=show_phone(p.contact_phone, pii), contact_email=p.contact_email if pii else None, city=p.city,
        address=p.address, status=p.status, status_reason=p.status_reason,  # type: ignore[arg-type]
        commission_bps=p.commission_bps, settlement_cycle=p.settlement_cycle,  # type: ignore[arg-type]
        bank_account_name=p.bank_account_name, bank_account_last4=p.bank_account_last4, bank_ifsc=p.bank_ifsc,
        kyc_verified=p.kyc_verified_at is not None, venue_count=len(turfs), created_at=p.created_at,
        entity_type=p.entity_type, pan_last4=p.pan_last4, razorpay_account_id=p.razorpay_account_id,
        payouts_on_hold=p.payouts_on_hold, notes=p.notes, application=dict(p.application or {}), members=members,
        venues=await venue_rows(db, turfs), settlements=[settlement_out(s) for s in settlements],
        reviewed_by=reviewer, reviewed_at=p.reviewed_at,
    )


async def review(db: AsyncSession, ctx: AdminContext, provider_id: uuid.UUID,
                 body: ProviderReview) -> AdminProviderDetail:
    p = await _get_provider(db, provider_id, for_update=True)
    if p.status != "pending":
        raise Conflict(f"Only pending applications can be reviewed (this one is {p.status})")
    if body.decision == "reject" and not (body.reason or "").strip():
        raise BadRequest("Give a reason when rejecting an application")
    now = utcnow()
    before = {"status": p.status, "commission_bps": p.commission_bps}
    p.status = "approved" if body.decision == "approve" else "rejected"
    p.status_reason = (body.reason or None) if body.decision == "reject" else None
    if body.decision == "approve":
        if body.commission_bps is not None:
            p.commission_bps = body.commission_bps
        p.kyc_verified_at = p.kyc_verified_at or now
    p.reviewed_by_admin_id = ctx.admin.id
    p.reviewed_at = now
    await audit(db, ctx, f"provider.{'approve' if body.decision == 'approve' else 'reject'}",
                f"{'Approved' if body.decision == 'approve' else 'Rejected'} provider {p.name}",
                target_type="provider", target_id=p.id,
                changes={**audit_service.diff(before, {"status": p.status, "commission_bps": p.commission_bps}),
                         "reason": body.reason})
    await db.commit()
    return await provider_detail(db, ctx, p.id)


async def set_status(db: AsyncSession, ctx: AdminContext, provider_id: uuid.UUID,
                     body: ProviderStatusChange) -> AdminProviderDetail:
    p = await _get_provider(db, provider_id, for_update=True)
    allowed = {("approved", "suspended"), ("suspended", "approved")}
    if (p.status, body.status) not in allowed:
        raise Conflict(f"Can't change a {p.status} provider to {body.status}")
    before = p.status
    p.status = body.status
    p.status_reason = body.reason if body.status == "suspended" else None
    await audit(db, ctx, f"provider.{'suspend' if body.status == 'suspended' else 'reinstate'}",
                f"{p.name}: {before} → {body.status} — {body.reason}", target_type="provider", target_id=p.id,
                changes={"status": [before, body.status], "reason": body.reason})
    await db.commit()
    return await provider_detail(db, ctx, p.id)


async def update(db: AsyncSession, ctx: AdminContext, provider_id: uuid.UUID,
                 body: ProviderAdminUpdate) -> AdminProviderDetail:
    """Commission / cycle / notes apply at once. A new payout destination (Razorpay linked account)
    is four-eyes: payouts go on hold and a `provider.bank_change` approval is queued."""
    p = await _get_provider(db, provider_id, for_update=True)
    patch = body.model_dump(exclude_unset=True)
    for key in ("commission_bps", "settlement_cycle"):
        if key in patch and patch[key] is None:
            patch.pop(key)
    new_account = patch.pop("razorpay_account_id", p.razorpay_account_id)
    before = {k: getattr(p, k) for k in patch}
    for k, v in patch.items():
        setattr(p, k, v)
    changes: dict[str, Any] = audit_service.diff(before, patch)
    if new_account != p.razorpay_account_id:
        approval = ApprovalRequest(
            id=uuid.uuid4(), action="provider.bank_change", target_type="provider", target_id=str(p.id),
            payload={"old": {"razorpay_account_id": p.razorpay_account_id},
                     "new": {"razorpay_account_id": new_account}},
            summary=f"Change payout account of {p.name}", status="pending", requested_by_admin_id=ctx.admin.id,
            created_at=utcnow(),
        )
        db.add(approval)
        p.payouts_on_hold = True
        changes["razorpay_account_id"] = {"requested": new_account, "approval_id": str(approval.id)}
    if changes:
        await audit(db, ctx, "provider.update", f"Edited provider {p.name}", target_type="provider", target_id=p.id,
                    changes=changes)
    await db.commit()
    return await provider_detail(db, ctx, p.id)


async def assign_turfs(db: AsyncSession, ctx: AdminContext, provider_id: uuid.UUID,
                       turf_ids: list[uuid.UUID]) -> AdminProviderDetail:
    """Set the provider's complete venue list. Listed venues are assigned to it (moved away from another provider
    if needed); its venues missing from the list are unassigned (`provider_id = NULL`). Ownership only — bookings
    already made at a venue are kept (the UI warns with the number of upcoming games)."""
    p = await _get_provider(db, provider_id, for_update=True)
    wanted = set(turf_ids)
    turfs = list((await db.scalars(
        select(Turf).where(or_(Turf.id.in_(wanted), Turf.provider_id == p.id)).order_by(Turf.id).with_for_update()
    )).all())
    if not wanted <= {t.id for t in turfs}:
        raise BadRequest("Some venues don't exist")
    moved = {str(t.id): [str(t.provider_id) if t.provider_id else None, str(p.id)] for t in turfs
             if t.id in wanted and t.provider_id != p.id}
    removed = {str(t.id): [str(p.id), None] for t in turfs if t.id not in wanted and t.provider_id == p.id}
    upcoming = await _upcoming(db, [uuid.UUID(k) for k in (*moved, *removed)])
    for t in turfs:
        if t.id in wanted:
            t.provider_id = p.id
        elif t.provider_id == p.id:
            t.provider_id = None
    if moved or removed:
        parts = [f"assigned {len(moved)}" if moved else "", f"unassigned {len(removed)}" if removed else ""]
        await audit(db, ctx, "provider.assign_venues", f"{p.name}: {', '.join(x for x in parts if x)} venue(s)",
                    target_type="provider", target_id=p.id,
                    changes={"turfs": {**moved, **removed},
                             "upcoming_games": {k: n for k, n in ((str(t), n) for t, n in upcoming.items()) if n}})
    await db.commit()
    return await provider_detail(db, ctx, p.id)


# ═══════════════════════════ onboarding venues ═══════════════════════════

_FORMATS = {sp["key"]: set(sp["formats"]) for sp in SPORTS}


def _hhmm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


async def _unique_turf_slug(db: AsyncSession, name: str, area: str) -> str:
    # "Smashpoint Edappally" in Edappally → smashpoint-edappally, not smashpoint-edappally-edappally
    base = slugify(name if area.strip().lower() in name.lower() else f"{name} {area}")[:70].strip("-") or "venue"
    slug, n = base, 1
    while await db.scalar(select(Turf.id).where(Turf.slug == slug)):
        n += 1
        slug = f"{base[:72]}-{n}"
    return slug


async def create_venue(db: AsyncSession, ctx: AdminContext, provider_id: uuid.UUID,
                       body: AdminCreateVenue) -> AdminProviderDetail:
    """Onboard a venue for a provider (usually from an entry of its application): the turf, its pitches and
    14 days of slots — the same slot generation the partner portal uses when a pitch is added."""
    p = await _get_provider(db, provider_id, for_update=True)  # serialises onboarding per provider
    if p.status == "rejected":
        raise Conflict("This application was rejected — venues can't be onboarded for it")
    lat_ok = settings.service_lat_min <= body.lat <= settings.service_lat_max
    lng_ok = settings.service_lng_min <= body.lng <= settings.service_lng_max
    if not (lat_ok and lng_ok):
        raise BadRequest("Coordinates are outside the service area — check the pin",
                         details={"fields": {"lat": "Outside the service area", "lng": "Outside the service area"},
                                  "bounds": [settings.service_lat_min, settings.service_lng_min,
                                             settings.service_lat_max, settings.service_lng_max]})
    open_t, close_t = _hhmm(body.open_time), _hhmm(body.close_time)
    if close_t != time(0, 0) and close_t <= open_t:
        raise BadRequest("Closing time must be after opening time (use 00:00 for midnight)",
                         details={"fields": {"close_time": "Must be after the opening time"}})
    for i, pitch in enumerate(body.pitches):
        if pitch.format not in _FORMATS.get(pitch.sport, set()):
            raise BadRequest(f"{pitch.name}: format must be one of {sorted(_FORMATS.get(pitch.sport, set()))} "
                             f"for {pitch.sport}", details={"fields": {f"pitches.{i}.format": "Invalid format"}})
    if len({pitch.name.strip().lower() for pitch in body.pitches}) != len(body.pitches):
        raise BadRequest("Pitch names must be unique within a venue")

    application = dict(p.application or {})
    created = _created_turfs(p)
    if body.application_index is not None:
        venues = application.get("venues")
        if not isinstance(venues, list) or body.application_index >= len(venues):
            raise BadRequest("That venue isn't part of this provider's application")
        existing = created.get(str(body.application_index))
        if existing and await db.scalar(select(Turf.id).where(Turf.id == uuid.UUID(existing))):
            raise Conflict("This application venue was already created", details={"turf_id": existing})

    turf = Turf(
        id=uuid.uuid4(), slug=await _unique_turf_slug(db, body.name, body.area), name=body.name,
        description=body.description.strip(), area=body.area, address=body.address, lat=body.lat, lng=body.lng,
        phone=body.phone, amenities=body.amenities, photos=[], open_time=open_t, close_time=close_t,
        rating_count=0, is_active=True, is_featured=False, provider_id=p.id,
    )
    db.add(turf)
    await db.flush([turf])
    slots = 0
    for spec in body.pitches:
        pitch = Pitch(
            id=uuid.uuid4(), turf_id=turf.id, name=spec.name.strip(), sport=spec.sport, format=spec.format,
            capacity=spec.capacity, is_indoor=spec.is_indoor, has_camera=spec.has_camera,
            camera_price_paise=spec.camera_price_paise if spec.has_camera else 0,
            price_per_hour_paise=spec.price_per_hour_paise, peak_price_per_hour_paise=spec.peak_price_per_hour_paise,
            is_active=True,
        )
        pitch.turf = turf
        db.add(pitch)
        await db.flush([pitch])
        slots += await generate_slots_for_pitch(db, pitch, days=14)
    if body.application_index is not None:
        application[CREATED_TURFS_KEY] = {**created, str(body.application_index): str(turf.id)}
        p.application = application  # reassign: JSONB change tracking
    await audit(db, ctx, "venue.create", f"Onboarded venue {turf.name} for {p.name} ({len(body.pitches)} pitch(es))",
                target_type="turf", target_id=turf.id,
                changes={"provider_id": str(p.id), "application_index": body.application_index, "slug": turf.slug,
                         "lat": body.lat, "lng": body.lng, "open_time": body.open_time, "close_time": body.close_time,
                         "pitches": [{"name": x.name, "sport": x.sport, "format": x.format,
                                      "price": x.price_per_hour_paise, "peak": x.peak_price_per_hour_paise}
                                     for x in body.pitches],
                         "slots": slots})
    owners = await owner_user_ids(db, p.id)
    if owners:
        await notify_many(db, owners, "venue_live", f"{turf.name} is set up on Pytch",
                          f"Pytch added {turf.name} with {len(body.pitches)} pitch(es) to your partner portal. "
                          "Check prices and opening hours in Venues.", {"url": f"/partner/venues/{turf.id}"})
    await db.commit()
    return await provider_detail(db, ctx, p.id)
