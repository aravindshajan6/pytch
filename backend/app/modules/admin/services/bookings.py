"""Bookings console: search, full detail (lobby, members, payments, blocks, conflicts), force-cancel."""

import uuid
from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.core.pagination import Page
from app.core.timeutils import utcnow
from app.modules.admin.auditing import audit
from app.modules.admin.deps import AdminContext
from app.modules.admin.models import ApprovalRequest
from app.modules.admin.schemas import (
    AdminBlockRow,
    AdminBookingDetail,
    AdminBookingRow,
    AdminCancelBooking,
    AdminConflictRow,
    AdminLobbyInfo,
    AdminLobbyMemberRow,
    ApprovalPending,
)
from app.modules.admin.services import payments as admin_payments
from app.modules.admin.services.common import (
    HOST,
    booking_row,
    booking_rows_query,
    count,
    day_range,
    like_term,
    payment_row,
    payment_rows_query,
    phone_match,
    show_phone,
)
from app.modules.bookings.models import Booking
from app.modules.channels.models import SlotBlock, SyncConflict
from app.modules.lobbies import service as lobbies
from app.modules.lobbies.models import Lobby
from app.modules.payments.models import Payment
from app.modules.platform import service as platform


async def list_bookings(
    db: AsyncSession, ctx: AdminContext, *, q: str | None, status: str | None, date_from: date | None,
    date_to: date | None, limit: int, offset: int,
) -> Page[AdminBookingRow]:
    stmt = booking_rows_query()
    if q:
        term = q.strip()
        like = like_term(term)
        stmt = stmt.where(or_(Booking.code.ilike(like, escape="\\"), Lobby.title.ilike(like, escape="\\"),
                              Lobby.code.ilike(like, escape="\\"), HOST.name.ilike(like, escape="\\"),
                              phone_match(HOST.phone, term, ctx.sees_pii)))
    if status:
        stmt = stmt.where(Booking.status == status)
    lo, hi = day_range(date_from, date_to)
    if lo is not None:
        stmt = stmt.where(Lobby.start_at >= lo)
    if hi is not None:
        stmt = stmt.where(Lobby.start_at < hi)
    total = await count(db, stmt)
    rows = (await db.execute(stmt.order_by(Lobby.start_at.desc(), Booking.id).limit(limit).offset(offset))).all()
    return Page(items=[booking_row(r, ctx.sees_pii) for r in rows], total=total, limit=limit, offset=offset)


async def _lobby_for_booking_id(db: AsyncSession, booking_id: uuid.UUID) -> Lobby:
    """The lobby owning a booking — following transfers forward for superseded bookings."""
    current = booking_id
    for _ in range(10):
        lobby_id = await db.scalar(select(Lobby.id).where(Lobby.booking_id == current))
        if lobby_id is not None:
            return await lobbies.get_lobby(db, lobby_id)
        nxt = await db.scalar(select(Booking.id).where(Booking.transferred_from_id == current))
        if nxt is None:
            break
        current = nxt
    raise NotFound("Booking not found")


async def booking_detail(db: AsyncSession, ctx: AdminContext, booking_id: uuid.UUID) -> AdminBookingDetail:
    lobby = await _lobby_for_booking_id(db, booking_id)
    pii = ctx.sees_pii
    row = (await db.execute(booking_rows_query().where(Lobby.id == lobby.id))).first()
    assert row is not None
    payments = (await db.execute(payment_rows_query().where(Payment.lobby_id == lobby.id)
                                 .order_by(Payment.created_at))).all()
    conflicts = (await db.scalars(
        select(SyncConflict).where(or_(SyncConflict.lobby_id == lobby.id, SyncConflict.slot_id == lobby.slot_id))
        .order_by(SyncConflict.created_at.desc()).limit(50))).all()
    blocks = (await db.scalars(
        select(SlotBlock).where(and_(SlotBlock.pitch_id == lobby.pitch_id, SlotBlock.start_at < lobby.end_at,
                                     SlotBlock.end_at > lobby.start_at))
        .order_by(SlotBlock.start_at).limit(50))).all()
    booking = lobby.booking
    return AdminBookingDetail(
        booking=booking_row(row, pii),
        lobby=AdminLobbyInfo(
            id=lobby.id, code=lobby.code, title=lobby.title, sport=lobby.sport, format=lobby.format, mode=lobby.mode,
            visibility=lobby.visibility, status=lobby.status, total_spots=lobby.total_spots,
            share_paise=lobby.share_paise, start_at=lobby.start_at, end_at=lobby.end_at,
            pay_deadline=lobby.pay_deadline, turf_id=lobby.turf_id, turf_name=lobby.turf.name,
            pitch_id=lobby.pitch_id, pitch_name=lobby.pitch.name, notes=lobby.notes, created_at=lobby.created_at,
            confirmed_at=lobby.confirmed_at, completed_at=lobby.completed_at,
        ),
        members=[
            AdminLobbyMemberRow(
                user_id=m.user_id, name=m.user.name, phone=show_phone(m.user.phone, pii), role=m.role,
                status=m.status, share_paise=m.share_paise, paid_paise=m.paid_paise, discount_paise=m.discount_paise,
                compensated_paise=m.compensated_paise, joined_at=m.joined_at, paid_at=m.paid_at, left_at=m.left_at,
            )
            for m in lobby.members
        ],
        payments=[payment_row(r, pii) for r in payments],
        conflicts=[
            AdminConflictRow(id=c.id, source=c.source, external_ref=c.external_ref,
                             external_start_at=c.external_start_at, external_end_at=c.external_end_at,
                             summary=c.summary, status=c.status, resolution=c.resolution, created_at=c.created_at)
            for c in conflicts
        ],
        blocks=[
            AdminBlockRow(id=b.id, kind=b.kind, source=b.source, status=b.status, start_at=b.start_at,
                          end_at=b.end_at, customer_name=b.customer_name if pii else None)
            for b in blocks
        ],
        transferred_from_id=booking.transferred_from_id,
    )


async def cancel_booking(
    db: AsyncSession, ctx: AdminContext, booking_id: uuid.UUID, body: AdminCancelBooking
) -> AdminBookingDetail | ApprovalPending:
    """Force-cancel (any time before completion). Everyone is refunded: `source` sends the provider-
    captured part back to the original payment method, anything else (credits used) returns as credits.
    Source refunds above REFUND_DUAL_APPROVAL_PAISE are queued for a second admin (maker–checker)."""
    lobby = await _lobby_for_booking_id(db, booking_id)
    lobby = await lobbies.get_lobby(db, lobby.id, for_update=True)
    if body.refund_destination == "source" and lobby.status in ("forming", "confirmed"):
        exposure = await admin_payments.source_refund_exposure(db, lobby)
        threshold = await platform.get_setting("refund_dual_approval_paise", db)
        if exposure > threshold:
            pending = await db.scalar(select(func.count()).select_from(ApprovalRequest).where(
                ApprovalRequest.action == "booking.cancel", ApprovalRequest.target_id == str(lobby.booking_id),
                ApprovalRequest.status == "pending"))
            if pending:
                raise Conflict("A cancellation for this booking is already awaiting approval")
            approval = ApprovalRequest(
                id=uuid.uuid4(), action="booking.cancel", target_type="booking", target_id=str(lobby.booking_id),
                payload={"refund_destination": "source", "reason": body.reason, "exposure_paise": exposure},
                summary=f"Cancel {lobby.booking.code} with ₹{exposure / 100:,.2f} back to source — {body.reason}"[:300],
                status="pending", requested_by_admin_id=ctx.admin.id, created_at=utcnow(),
            )
            db.add(approval)
            await db.flush([approval])
            await audit(db, ctx, "approval.request", f"Requested approval: {approval.summary}",
                        target_type="booking", target_id=lobby.booking_id,
                        changes={"approval_id": str(approval.id), **approval.payload, "threshold_paise": threshold})
            await db.commit()
            return ApprovalPending(approval_id=approval.id,
                                   message="Source refunds above the threshold need a second admin — request queued")
    await execute_cancel(db, ctx, lobby, body.refund_destination, body.reason)
    await db.commit()
    return await booking_detail(db, ctx, lobby.booking_id)


async def _record_cancellation_credits(db: AsyncSession, ctx: AdminContext, lobby: Lobby,
                                      compensated_before: dict[uuid.UUID, int], reason: str) -> None:
    """History only: a cancellation returns each seat's money as credits and marks its payments `refunded` —
    write what went back into those payments' meta (`refunds[]`, `refunded_paise`) so the payment drawer shows it."""
    returned = {m.id: m.compensated_paise - compensated_before.get(m.id, m.compensated_paise) for m in lobby.members}
    returned = {mid: n for mid, n in returned.items() if n > 0}
    if not returned:
        return
    await db.flush()
    payments = (await db.scalars(
        select(Payment).where(Payment.lobby_id == lobby.id, Payment.member_id.in_(returned),
                              Payment.status == "refunded")
        .order_by(Payment.paid_at.desc()).with_for_update().execution_options(populate_existing=True)
    )).all()
    now = utcnow().isoformat()
    for p in payments:
        left = returned.get(p.member_id, 0)  # type: ignore[arg-type]
        amount = min(left, admin_payments.refundable(p)[0])
        if amount <= 0:
            continue
        returned[p.member_id] = left - amount  # type: ignore[index]
        meta = dict(p.meta or {})
        meta["refunds"] = [*meta.get("refunds", []), {
            "ref": f"credits:cancel:{lobby.booking_id}", "amount_paise": amount, "destination": "credits",
            "reason": f"Booking cancelled — {reason}"[:300], "at": now, "by": ctx.label, "kind": "cancellation",
        }]
        meta["refunded_paise"] = int(meta.get("refunded_paise", 0)) + amount
        p.meta = meta


async def execute_cancel(db: AsyncSession, ctx: AdminContext, lobby: Lobby, refund_destination: str,
                         reason: str) -> None:
    """Cancel + refund (caller holds the lobby lock and commits). Shared by direct and approved cancels."""
    before = {"lobby_status": lobby.status, "booking_status": lobby.booking.status}
    to_source = 0
    if refund_destination == "source" and lobby.status in ("forming", "confirmed"):
        to_source = await admin_payments.source_refund_for_cancellation(db, ctx, lobby, reason)
    compensated_before = {m.id: m.compensated_paise for m in lobby.members}
    credited = await lobbies.cancel_lobby(db, lobby, note=f"Cancelled by Pytch support — {reason}")
    await _record_cancellation_credits(db, ctx, lobby, compensated_before, reason)
    await audit(db, ctx, "booking.cancel", f"Cancelled {lobby.booking.code} — {reason}", target_type="booking",
                target_id=lobby.booking_id,
                changes={"lobby_status": [before["lobby_status"], "cancelled"],
                         "booking_status": [before["booking_status"], "cancelled"],
                         "refund_destination": refund_destination, "refunded_to_source_paise": to_source,
                         "refunded_to_credits_paise": credited, "reason": reason})
