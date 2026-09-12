"""Factories + flow helpers for admin-console tests."""

import time
import uuid
from datetime import timedelta

import pyotp
from httpx import AsyncClient, Response
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import totp
from app.core.crypto import encrypt
from app.core.passwords import hash_password
from app.core.timeutils import utcnow
from app.modules.admin.models import AdminUser
from app.modules.auth import sessions
from app.modules.bookings.models import Booking
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.providers.models import Provider
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import User

ADMIN = "/api/v1/admin"
PASSWORD = "Correct-Horse-Battery-9"
_HASH = hash_password(PASSWORD)  # computed once (argon2 is deliberately slow)


async def make_admin(
    db: AsyncSession, role: str = "super_admin", *, email: str | None = None, enrolled: bool = True,
    must_change: bool = False,
) -> tuple[AdminUser, str | None]:
    """An admin with the shared test password; returns (admin, base32 TOTP secret or None)."""
    secret = totp.new_secret() if enrolled else None
    now = utcnow()
    admin = AdminUser(
        id=uuid.uuid4(), email=email or f"{role}-{uuid.uuid4().hex[:6]}@pytch.test", name=role.title(), role=role,
        is_active=True, password_hash=_HASH, must_change_password=must_change, recovery_code_hashes=[],
        failed_logins=0, totp_secret_enc=encrypt(secret) if secret else None,
        totp_enabled_at=now if enrolled else None, created_at=now, updated_at=now,
    )
    db.add(admin)
    await db.commit()
    return admin, secret


def code(secret: str, offset_steps: int = 0) -> str:
    return pyotp.TOTP(secret).at(int(time.time()) + offset_steps * 30)


async def fresh_code(db: AsyncSession, admin: AdminUser, secret: str) -> str:
    """A TOTP code that isn't a replay (clears the stored last step first)."""
    await db.execute(update(AdminUser).where(AdminUser.id == admin.id).values(totp_last_step=None))
    await db.commit()
    return code(secret)


async def admin_token(db: AsyncSession, admin: AdminUser, *, stepped_up: bool = True) -> str:
    """Open a session directly (skips the slow password step); `stepped_up` = MFA just verified."""
    _, access, _ = await sessions.create_session(db, subject_type="admin", subject_id=admin.id, audience="admin",
                                                 mfa_verified=stepped_up)
    await db.commit()
    return access


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def as_role(db: AsyncSession, role: str, *, stepped_up: bool = True) -> tuple[AdminUser, dict[str, str]]:
    admin, _ = await make_admin(db, role)
    return admin, bearer(await admin_token(db, admin, stepped_up=stepped_up))


def set_cookies(resp: Response) -> dict[str, str]:
    """name → raw Set-Cookie header (so tests can assert attributes and reuse values)."""
    out = {}
    for header in resp.headers.get_list("set-cookie"):
        name = header.split("=", 1)[0]
        out[name] = header
    return out


def cookie_value(header: str) -> str:
    return header.split("=", 1)[1].split(";", 1)[0]


async def login(client: AsyncClient, db: AsyncSession, admin: AdminUser, secret: str) -> dict[str, str]:
    """Password + TOTP through the API. Returns {access, rt, csrf}."""
    r = await client.post(f"{ADMIN}/auth/login", json={"email": admin.email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    r = await client.post(f"{ADMIN}/auth/mfa/verify",
                          json={"mfa_token": r.json()["mfa_token"], "code": await fresh_code(db, admin, secret)})
    assert r.status_code == 200, r.text
    cookies = set_cookies(r)
    client.cookies.clear()
    return {"access": r.json()["access_token"], "rt": cookie_value(cookies["pytch_admin_rt"]),
            "csrf": cookie_value(cookies["pytch_admin_csrf"])}


def cookie_headers(rt: str, csrf: str | None, *, header_csrf: str | None = None) -> dict[str, str]:
    cookie = f"pytch_admin_rt={rt}" + (f"; pytch_admin_csrf={csrf}" if csrf else "")
    h = {"Cookie": cookie}
    if header_csrf is not None:
        h["X-CSRF-Token"] = header_csrf
    return h


# ── venue / booking factories for money tests ──


async def make_provider(db: AsyncSession, *, name: str = "Kick Arena Pvt Ltd", pan: bool = True,
                        commission_bps: int = 1000, status: str = "approved") -> Provider:
    p = Provider(
        id=uuid.uuid4(), name=name, slug=f"prov-{uuid.uuid4().hex[:8]}", contact_name="Owner",
        contact_phone=f"+9198{uuid.uuid4().int % 10**8:08d}", city="Kochi", status=status,
        commission_bps=commission_bps, settlement_cycle="weekly", pan_last4="1234" if pan else None,
        application={}, payouts_on_hold=False,
    )
    db.add(p)
    await db.commit()
    return p


async def make_provider_venue(db: AsyncSession, provider: Provider, *, price: int = 100_000) -> tuple[Turf, Pitch]:
    from datetime import time as dtime

    suffix = uuid.uuid4().hex[:6]
    turf = Turf(id=uuid.uuid4(), slug=f"t-{suffix}", name=f"Turf {suffix}", area="Kaloor", address="1 Rd", lat=9.98,
                lng=76.29, amenities=[], photos=[], open_time=dtime(6), close_time=dtime(23), provider_id=provider.id)
    pitch = Pitch(id=uuid.uuid4(), turf_id=turf.id, name="P1", sport="football", format="5v5", capacity=10,
                  is_indoor=False, has_camera=False, camera_price_paise=0, price_per_hour_paise=price,
                  peak_price_per_hour_paise=price)
    db.add_all([turf, pitch])
    await db.commit()
    return turf, pitch


async def make_played_booking(
    db: AsyncSession, pitch: Pitch, host: User, *, hours_ago: float, price: int = 100_000, status: str = "completed",
) -> tuple[Booking, Lobby]:
    """A booking whose slot started `hours_ago` hours ago (1 h slot), fully paid by the host."""
    start = (utcnow() - timedelta(hours=hours_ago)).replace(microsecond=0)
    slot = Slot(id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
                price_paise=price, is_peak=False, status="booked")
    booking = Booking(id=uuid.uuid4(), code=f"PY-{uuid.uuid4().hex[:6].upper()}", slot_id=slot.id, host_id=host.id,
                      mode="full", status=status, pitch_fee_paise=price, recording_fee_paise=0, total_paise=price,
                      recorded=False, confirmed_at=start - timedelta(days=1))
    lobby = Lobby(id=uuid.uuid4(), code=uuid.uuid4().hex[:6].upper(), booking_id=booking.id, slot_id=slot.id,
                  pitch_id=pitch.id, turf_id=pitch.turf_id, host_id=host.id, title="Past game", sport=pitch.sport,
                  format=pitch.format, mode="full", visibility="public", status=status, total_spots=2,
                  share_paise=price // 2, start_at=start, end_at=start + timedelta(hours=1),
                  confirmed_at=start - timedelta(days=1))
    db.add(slot)
    await db.flush()
    db.add(booking)
    await db.flush()
    slot.booking_id = booking.id
    db.add(lobby)
    await db.flush()
    db.add(LobbyMember(id=uuid.uuid4(), lobby_id=lobby.id, user_id=host.id, role="host", status="paid",
                       share_paise=price, paid_paise=price, discount_paise=0, compensated_paise=0,
                       joined_at=start - timedelta(days=1), paid_at=start - timedelta(days=1)))
    await db.commit()
    return booking, lobby
