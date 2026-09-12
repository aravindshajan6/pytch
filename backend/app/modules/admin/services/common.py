"""Small helpers shared by admin services (PII masking, date filters, row builders)."""

import re
import uuid
from datetime import date, datetime

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.timeutils import ist_day_bounds
from app.modules.admin.schemas import AdminBookingRow, AdminPaymentRow
from app.modules.bookings.models import Booking
from app.modules.coupons.models import Coupon
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.payments.models import Payment
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User


def mask_phone(phone: str | None) -> str:
    """"+919876543210" → "+91 98••• ••210" (support / read-only roles)."""
    if not phone:
        return ""
    digits = phone.lstrip("+")
    if len(digits) < 7:
        return "•" * len(phone)
    cc, rest = digits[:-10] or digits[:2], digits[-10:]
    return f"+{cc} {rest[:2]}••• ••{rest[-3:]}"


def like_term(term: str) -> str:
    """ILIKE pattern with the user's own wildcards escaped — pair with `.ilike(p, escape="\\")`."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def phone_match(column, term: str, pii: bool):
    """PII roles search phones by substring; masked roles only by exact number, so search results can't be
    used as an oracle to recover a masked phone digit by digit."""
    if pii:
        return column.ilike(like_term(term), escape="\\")
    return column == re.sub(r"[\s\-()]", "", term)


def show_phone(phone: str | None, pii: bool) -> str:
    return (phone or "") if pii else mask_phone(phone)


def csv_cell(value: object) -> object:
    """Neutralise spreadsheet formula injection in exported text (=, +, -, @, tab, CR)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def day_range(start: date | None, end: date | None) -> tuple[datetime | None, datetime | None]:
    """IST calendar dates (inclusive) → UTC [from, to)."""
    lo = ist_day_bounds(start)[0] if start else None
    hi = ist_day_bounds(end)[1] if end else None
    return lo, hi


async def count(db: AsyncSession, stmt: Select) -> int:
    return int(await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)


# ── bookings ──

_host = aliased(User)
HOST = _host  # the host alias used by booking_rows_query


def booking_rows_query() -> Select:
    paid = (
        select(LobbyMember.lobby_id, func.coalesce(func.sum(LobbyMember.paid_paise), 0).label("paid"))
        .group_by(LobbyMember.lobby_id)
        .subquery()
    )
    return (
        select(
            Booking.id, Booking.code, Lobby.id.label("lobby_id"), Lobby.title, Turf.name.label("turf_name"),
            Pitch.name.label("pitch_name"), _host.name.label("host_name"), _host.phone.label("host_phone"),
            Lobby.mode, Booking.status, Lobby.start_at, Booking.total_paise,
            func.coalesce(paid.c.paid, 0).label("paid_paise"), Booking.created_at,
        )
        .select_from(Booking)
        .join(Lobby, Lobby.booking_id == Booking.id)
        .join(Turf, Turf.id == Lobby.turf_id)
        .join(Pitch, Pitch.id == Lobby.pitch_id)
        .join(_host, _host.id == Booking.host_id)
        .outerjoin(paid, paid.c.lobby_id == Lobby.id)
    )


def booking_row(r, pii: bool) -> AdminBookingRow:
    return AdminBookingRow(
        id=r.id, code=r.code, lobby_id=r.lobby_id, lobby_title=r.title, turf_name=r.turf_name,
        pitch_name=r.pitch_name, host_name=r.host_name, host_phone=show_phone(r.host_phone, pii),
        mode=r.mode, status=r.status, start_at=r.start_at, total_paise=r.total_paise,
        paid_paise=int(r.paid_paise), created_at=r.created_at,
    )


# ── payments ──

_payer = aliased(User)
PAYER = _payer  # the payer alias used by payment_rows_query (filter on this, not on User)


def payment_rows_query() -> Select:
    return (
        select(
            Payment.id, _payer.name.label("user_name"), _payer.phone.label("user_phone"),
            Lobby.title.label("lobby_title"), Booking.code.label("booking_code"), Payment.purpose, Payment.provider,
            Payment.amount_paise, Payment.discount_paise, Payment.credits_applied_paise, Payment.payable_paise,
            Payment.status, Coupon.code.label("coupon_code"), Payment.provider_payment_id, Payment.created_at,
            Payment.paid_at,
        )
        .select_from(Payment)
        .join(_payer, _payer.id == Payment.user_id)
        .outerjoin(Lobby, Lobby.id == Payment.lobby_id)
        .outerjoin(Booking, Booking.id == Payment.booking_id)
        .outerjoin(Coupon, Coupon.id == Payment.coupon_id)
    )


def payment_row(r, pii: bool) -> AdminPaymentRow:
    return AdminPaymentRow(
        id=r.id, user_name=r.user_name, user_phone=show_phone(r.user_phone, pii), lobby_title=r.lobby_title,
        booking_code=r.booking_code, purpose=r.purpose, provider=r.provider, amount_paise=r.amount_paise,
        discount_paise=r.discount_paise or 0, credits_applied_paise=r.credits_applied_paise,
        payable_paise=r.payable_paise, status=r.status, coupon_code=r.coupon_code,
        provider_payment_id=r.provider_payment_id, created_at=r.created_at, paid_at=r.paid_at,
    )


async def payment_row_by_id(db: AsyncSession, payment_id: uuid.UUID, pii: bool) -> AdminPaymentRow | None:
    r = (await db.execute(payment_rows_query().where(Payment.id == payment_id))).first()
    return payment_row(r, pii) if r else None
