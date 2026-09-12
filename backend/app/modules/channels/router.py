"""Public channel endpoints:

* Channel API for integrators — `/channel/v1/*`: `Authorization: Bearer pk_live_…` (keyed-hash lookup), scopes,
  120 requests/min per key, `Idempotency-Key` on writes.
* iCal export — `GET /ical/{token}.ics` (unguessable per-pitch token, busy times only, no PII).
"""

import re
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.core.deps import DB
from app.core.errors import NotFound
from app.core.ratelimit import client_ip, enforce
from app.core.responses import ORJSONResponse
from app.modules.channels import api
from app.modules.channels.api import ApiKeyContext, require_scope
from app.modules.channels.schemas import AvailabilityOut, ChannelBlockOut, ChannelBlockRequest, ChannelPitchOut
from app.modules.channels.service import export_calendar

router = APIRouter(tags=["channels"])
channel_api = APIRouter(prefix="/channel/v1", tags=["channel-api"])

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")

ReadKey = Annotated[ApiKeyContext, Depends(require_scope("availability:read"))]
WriteKey = Annotated[ApiKeyContext, Depends(require_scope("blocks:write"))]
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", max_length=100)]


@channel_api.get("/pitches", response_model=list[ChannelPitchOut])
async def pitches(db: DB, ctx: ReadKey) -> list[ChannelPitchOut]:
    return await api.list_pitches(db, ctx)


@channel_api.get("/availability", response_model=list[AvailabilityOut])
async def availability(db: DB, ctx: ReadKey, pitch_id: uuid.UUID, date: Annotated[date, Query()]) -> list[
    AvailabilityOut
]:
    return await api.availability(db, ctx, pitch_id, date)


@channel_api.post("/blocks", response_model=ChannelBlockOut, status_code=201)
async def create_block(body: ChannelBlockRequest, db: DB, ctx: WriteKey,
                       idempotency_key: IdempotencyKey = None) -> ORJSONResponse:
    status, payload = await api.idempotent(
        ctx, idempotency_key, "POST /blocks", body.model_dump(mode="json"),
        lambda: api.create_block(db, ctx, body),
    )
    return ORJSONResponse(payload, status_code=status)


@channel_api.delete("/blocks/{external_ref}", status_code=204)
async def cancel_block(external_ref: str, db: DB, ctx: WriteKey, idempotency_key: IdempotencyKey = None) -> Response:
    await api.idempotent(ctx, idempotency_key, f"DELETE /blocks/{external_ref}", {},
                         lambda: api.cancel_block(db, ctx, external_ref))
    return Response(status_code=204)


@router.get("/ical/{filename}", include_in_schema=False)
async def ical_export(filename: str, request: Request, db: DB) -> Response:
    token = filename[:-4] if filename.endswith(".ics") else ""
    if not _TOKEN_RE.match(token):
        raise NotFound("Calendar not found")
    await enforce(f"ical:{client_ip(request)}", 120, 60)
    body, etag = await export_calendar(db, token)
    headers = {"ETag": etag, "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex, nofollow",
               "Referrer-Policy": "no-referrer"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="text/calendar; charset=utf-8", headers=headers)


router.include_router(channel_api)
