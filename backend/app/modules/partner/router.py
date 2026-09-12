"""Partner (venue) portal — `/api/v1/partner/*`, audience "partner". Thin: parse → service → schema.

Access rules: onboarding endpoints accept any partner login; everything operational requires an APPROVED
provider (`Partner`), manager+ (`PartnerManager`) or owner (`PartnerOwner`) where the contract says so, and
staff venue scoping is enforced inside the services (`partner.scope`).
"""

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.core.config import settings
from app.core.deps import DB, Credentials
from app.core.errors import Forbidden, NotFound
from app.core.pagination import PageParams, page_params
from app.core.ratelimit import client_ip, enforce, user_agent
from app.modules.auth.schemas import OtpRequest, OtpRequestResponse, OtpVerify, RefreshRequest
from app.modules.channels import manage
from app.modules.channels import service as channels
from app.modules.channels.models import SlotBlock
from app.modules.channels.schemas import (
    BulkBlockRequest,
    BulkBlockResult,
    ChannelsOverview,
    CreateApiKeyRequest,
    CreateBlockRequest,
    CreatedApiKey,
    CreatedWebhook,
    CreateFeedRequest,
    CreateWebhookRequest,
    ExportOut,
    FeedOut,
    ResolveConflictRequest,
    SlotBlockOut,
    SyncConflictOut,
    UpdateBlockRequest,
    UpdateFeedRequest,
    WebhookTestResult,
)
from app.modules.partner import auth, finance, operations, service, venues
from app.modules.partner.deps import (
    Partner,
    PartnerContext,
    PartnerManager,
    PartnerOwner,
    PartnerUser,
    get_partner_context_any_status,
)
from app.modules.partner.schemas import (
    CalendarView,
    OkResponse,
    PartnerAuth,
    PartnerBookingsPage,
    PartnerDashboard,
    PartnerEarnings,
    PartnerMe,
    PartnerVenue,
    PitchInput,
    PitchUpdate,
    SettlementDetail,
    SettlementOut,
    VenueUpdate,
)
from app.modules.partner.scope import get_pitch, partner_actor
from app.modules.providers.schemas import (
    InviteMemberRequest,
    PartnerMemberOut,
    PartnerMembership,
    ProviderApplication,
    ProviderOut,
    ProviderUpdate,
    UpdateMemberRequest,
    UpdatePartnerSelf,
)
from app.modules.turfs.schemas import PitchOut

router = APIRouter(prefix="/partner", tags=["partner"])

AnyStatus = Annotated[PartnerContext, Depends(get_partner_context_any_status)]
BookingSource = Literal[
    "pytch", "walk_in", "phone", "playo", "hudle", "khelomore", "other_app", "ical", "api", "maintenance"
]


async def _owner_any_status(ctx: AnyStatus) -> PartnerContext:
    if ctx.role != "owner":
        raise Forbidden("Requires owner access")
    return ctx


OwnerAnyStatus = Annotated[PartnerContext, Depends(_owner_any_status)]


# ─────────────────────────── auth & onboarding ───────────────────────────


@router.post("/auth/otp/request", response_model=OtpRequestResponse)
async def otp_request(body: OtpRequest, request: Request) -> OtpRequestResponse:
    return await auth.request_otp(body.phone, ip=client_ip(request))


@router.post("/auth/otp/verify", response_model=PartnerAuth)
async def otp_verify(body: OtpVerify, db: DB, request: Request) -> PartnerAuth:
    await enforce(f"otp-verify-ip:{client_ip(request)}", settings.otp_verify_ip_max, 600)
    return await auth.verify_otp(db, body.phone, body.code, ip=client_ip(request), user_agent=user_agent(request))


@router.post("/auth/refresh", response_model=PartnerAuth)
async def refresh(body: RefreshRequest, db: DB) -> PartnerAuth:
    return await auth.refresh(db, body.refresh_token)


@router.post("/auth/logout", response_model=OkResponse)
async def logout(_: PartnerUser, db: DB, creds: Credentials) -> OkResponse:
    assert creds is not None
    await auth.logout(db, creds.credentials)
    return OkResponse()


@router.get("/me", response_model=PartnerMe)
async def me(user: PartnerUser, db: DB) -> PartnerMe:
    return await auth.me(db, user)


@router.patch("/me", response_model=PartnerMe)
async def update_me(body: UpdatePartnerSelf, user: PartnerUser, db: DB) -> PartnerMe:
    return await service.update_self(db, user, body)


@router.post("/applications", response_model=PartnerMembership, status_code=201)
async def apply(body: ProviderApplication, user: PartnerUser, db: DB) -> PartnerMembership:
    return await service.apply(db, user, body)


@router.get("/provider", response_model=ProviderOut)
async def get_provider(ctx: AnyStatus, db: DB) -> ProviderOut:
    return await service.get_provider(db, ctx)


@router.patch("/provider", response_model=ProviderOut)
async def update_provider(body: ProviderUpdate, ctx: OwnerAnyStatus, db: DB) -> ProviderOut:
    return await service.update_provider(db, ctx, body)


# ─────────────────────────── dashboard & calendar ───────────────────────────


@router.get("/dashboard", response_model=PartnerDashboard)
async def dashboard(ctx: Partner, db: DB, turf_id: uuid.UUID | None = None) -> PartnerDashboard:
    return await operations.dashboard(db, ctx, turf_id)


@router.get("/calendar", response_model=CalendarView)
async def calendar(
    ctx: Partner,
    db: DB,
    turf_id: uuid.UUID,
    from_: Annotated[date | None, Query(alias="from")] = None,
    days: Annotated[int, Query(ge=1, le=7)] = 7,
) -> CalendarView:
    return await operations.calendar(db, ctx, turf_id, from_, days)


# ─────────────────────────── blocks ───────────────────────────


async def _scoped_block(db: DB, ctx: PartnerContext, block_id: uuid.UUID) -> SlotBlock:
    block = await db.get(SlotBlock, block_id)
    if block is None or block.provider_id != ctx.provider.id:
        raise NotFound("Block not found")
    await get_pitch(db, ctx, block.pitch_id)  # staff venue scoping
    return block


@router.post("/blocks", response_model=SlotBlockOut, status_code=201)
async def create_block(body: CreateBlockRequest, ctx: Partner, db: DB) -> SlotBlockOut:
    pitch = await get_pitch(db, ctx, body.pitch_id)
    block = await channels.create_block(db, provider_id=ctx.provider.id, pitch=pitch, req=body,
                                        actor=partner_actor(ctx))
    return await channels.block_out(db, block)


@router.post("/blocks/bulk", response_model=BulkBlockResult)
async def bulk_block(body: BulkBlockRequest, ctx: PartnerManager, db: DB) -> BulkBlockResult:
    pitches = [await get_pitch(db, ctx, pid) for pid in dict.fromkeys(body.pitch_ids)]
    return await channels.bulk_block(db, provider_id=ctx.provider.id, pitches=pitches, req=body,
                                     actor=partner_actor(ctx))


@router.patch("/blocks/{block_id}", response_model=SlotBlockOut)
async def update_block(block_id: uuid.UUID, body: UpdateBlockRequest, ctx: Partner, db: DB) -> SlotBlockOut:
    block = await _scoped_block(db, ctx, block_id)
    block = await channels.update_block(db, block=block, req=body, actor=partner_actor(ctx))
    return await channels.block_out(db, block)


@router.delete("/blocks/{block_id}", status_code=204)
async def cancel_block(block_id: uuid.UUID, ctx: Partner, db: DB) -> Response:
    block = await _scoped_block(db, ctx, block_id)
    await channels.cancel_block(db, block=block, actor=partner_actor(ctx))
    return Response(status_code=204)


# ─────────────────────────── bookings ───────────────────────────


@router.get("/bookings", response_model=PartnerBookingsPage)
async def bookings(
    ctx: Partner,
    db: DB,
    page: Annotated[PageParams, Depends(page_params)],
    turf_id: uuid.UUID | None = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
    source: BookingSource | None = None,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    include_closures: bool = False,
) -> PartnerBookingsPage:
    return await operations.list_bookings(db, ctx, turf_id=turf_id, status=status, source=source, date_from=from_,
                                          date_to=to, q=q, limit=page.limit, offset=page.offset,
                                          include_closures=include_closures)


@router.get("/bookings/export.csv")
async def bookings_csv(
    ctx: Partner,
    db: DB,
    turf_id: uuid.UUID | None = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
    source: BookingSource | None = None,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    include_closures: bool = False,
) -> Response:
    body = await operations.export_bookings_csv(db, ctx, turf_id=turf_id, status=status, source=source,
                                                date_from=from_, date_to=to, q=q, include_closures=include_closures)
    return Response(body, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": 'attachment; filename="pytch-bookings.csv"', "Cache-Control": "no-store"})


# ─────────────────────────── venues & pitches ───────────────────────────


@router.get("/venues", response_model=list[PartnerVenue])
async def list_venues(ctx: Partner, db: DB) -> list[PartnerVenue]:
    return await venues.list_venues(db, ctx)


@router.patch("/venues/{turf_id}", response_model=PartnerVenue)
async def update_venue(turf_id: uuid.UUID, body: VenueUpdate, ctx: PartnerManager, db: DB) -> PartnerVenue:
    return await venues.update_venue(db, ctx, turf_id, body)


@router.post("/venues/{turf_id}/pitches", response_model=PitchOut, status_code=201)
async def create_pitch(turf_id: uuid.UUID, body: PitchInput, ctx: PartnerManager, db: DB) -> PitchOut:
    return await venues.create_pitch(db, ctx, turf_id, body)


@router.patch("/pitches/{pitch_id}", response_model=PitchOut)
async def update_pitch(pitch_id: uuid.UUID, body: PitchUpdate, ctx: PartnerManager, db: DB) -> PitchOut:
    return await venues.update_pitch(db, ctx, pitch_id, body)


# ─────────────────────────── earnings & settlements ───────────────────────────


# Money and the team roster (everyone's phone number) are manager+ — the front desk (staff) sees neither,
# matching the portal navigation. Statements additionally need an unscoped member (see `finance`).


@router.get("/earnings", response_model=PartnerEarnings)
async def earnings(ctx: PartnerManager, db: DB, from_: Annotated[date | None, Query(alias="from")] = None,
                   to: date | None = None) -> PartnerEarnings:
    return await finance.earnings(db, ctx, from_, to)


@router.get("/settlements", response_model=list[SettlementOut])
async def settlements(ctx: PartnerManager, db: DB) -> list[SettlementOut]:
    return await finance.list_settlements(db, ctx)


@router.get("/settlements/{settlement_id}", response_model=SettlementDetail)
async def settlement(settlement_id: uuid.UUID, ctx: PartnerManager, db: DB) -> SettlementDetail:
    return await finance.settlement_detail(db, ctx, settlement_id)


# ─────────────────────────── team ───────────────────────────


@router.get("/team", response_model=list[PartnerMemberOut])
async def team(ctx: PartnerManager, db: DB) -> list[PartnerMemberOut]:
    return await service.list_team(db, ctx)


@router.post("/team", response_model=PartnerMemberOut, status_code=201)
async def invite(body: InviteMemberRequest, ctx: PartnerOwner, db: DB) -> PartnerMemberOut:
    return await service.invite(db, ctx, body)


@router.patch("/team/{member_id}", response_model=PartnerMemberOut)
async def update_member(member_id: uuid.UUID, body: UpdateMemberRequest, ctx: PartnerOwner, db: DB) -> PartnerMemberOut:
    return await service.update_member(db, ctx, member_id, body)


@router.delete("/team/{member_id}", status_code=204)
async def remove_member(member_id: uuid.UUID, ctx: PartnerOwner, db: DB) -> Response:
    await service.remove_member(db, ctx, member_id)
    return Response(status_code=204)


# ─────────────────────────── channels ───────────────────────────


@router.get("/channels", response_model=ChannelsOverview)
async def channels_overview(ctx: Partner, db: DB) -> ChannelsOverview:
    return await manage.overview(db, ctx)


@router.post("/channels/feeds", response_model=FeedOut, status_code=201)
async def create_feed(body: CreateFeedRequest, ctx: PartnerManager, db: DB) -> FeedOut:
    return await manage.create_feed(db, ctx, body)


@router.patch("/channels/feeds/{feed_id}", response_model=FeedOut)
async def update_feed(feed_id: uuid.UUID, body: UpdateFeedRequest, ctx: PartnerManager, db: DB) -> FeedOut:
    return await manage.update_feed(db, ctx, feed_id, body)


@router.delete("/channels/feeds/{feed_id}", status_code=204)
async def delete_feed(feed_id: uuid.UUID, ctx: PartnerManager, db: DB) -> Response:
    await manage.delete_feed(db, ctx, feed_id)
    return Response(status_code=204)


@router.post("/channels/feeds/{feed_id}/sync", response_model=FeedOut)
async def sync_feed(feed_id: uuid.UUID, ctx: Partner, db: DB) -> FeedOut:
    return await manage.sync_feed_now(db, ctx, feed_id)


@router.post("/channels/exports/{pitch_id}", response_model=ExportOut)
async def rotate_export(pitch_id: uuid.UUID, ctx: PartnerManager, db: DB) -> ExportOut:
    return await manage.rotate_export(db, ctx, pitch_id)


@router.delete("/channels/exports/{pitch_id}", status_code=204)
async def disable_export(pitch_id: uuid.UUID, ctx: PartnerManager, db: DB) -> Response:
    await manage.disable_export(db, ctx, pitch_id)
    return Response(status_code=204)


@router.post("/channels/api-keys", response_model=CreatedApiKey, status_code=201)
async def create_api_key(body: CreateApiKeyRequest, ctx: PartnerOwner, db: DB) -> CreatedApiKey:
    return await manage.create_api_key(db, ctx, body)


@router.delete("/channels/api-keys/{key_id}", status_code=204)
async def revoke_api_key(key_id: uuid.UUID, ctx: PartnerOwner, db: DB) -> Response:
    await manage.revoke_api_key(db, ctx, key_id)
    return Response(status_code=204)


@router.post("/channels/webhooks", response_model=CreatedWebhook, status_code=201)
async def create_webhook(body: CreateWebhookRequest, ctx: PartnerOwner, db: DB) -> CreatedWebhook:
    return await manage.create_webhook(db, ctx, body)


@router.delete("/channels/webhooks/{hook_id}", status_code=204)
async def delete_webhook(hook_id: uuid.UUID, ctx: PartnerOwner, db: DB) -> Response:
    await manage.delete_webhook(db, ctx, hook_id)
    return Response(status_code=204)


@router.post("/channels/webhooks/{hook_id}/test", response_model=WebhookTestResult)
async def test_webhook(hook_id: uuid.UUID, ctx: PartnerOwner, db: DB) -> WebhookTestResult:
    return await manage.test_webhook(db, ctx, hook_id)


@router.get("/channels/conflicts", response_model=list[SyncConflictOut])
async def conflicts(ctx: Partner, db: DB,
                    status: Literal["open", "resolved", "ignored", "obsolete"] | None = None) -> list[SyncConflictOut]:
    return await manage.list_conflicts(db, ctx, status)


@router.post("/channels/conflicts/{conflict_id}/resolve", response_model=SyncConflictOut)
async def resolve_conflict(conflict_id: uuid.UUID, body: ResolveConflictRequest, ctx: PartnerManager,
                           db: DB) -> SyncConflictOut:
    return await manage.resolve_conflict(db, ctx, conflict_id, body)
