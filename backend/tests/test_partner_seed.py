
"""The portals demo seed keeps every invariant and gives working demo logins (runs the full demo seed)."""

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.passwords import verify_password
from app.modules.admin.models import AdminUser
from app.modules.channels.models import SlotBlock, SyncConflict
from app.modules.coupons.models import Coupon
from app.modules.lobbies.models import Lobby
from app.modules.providers.models import Provider
from app.modules.settlements.models import Settlement
from app.modules.slots.models import Slot
from app.seed.builder import Seeder
from app.seed.portals import ADMIN_PASSWORD, OWNER_PHONE, STAFF_PHONE, seed_portals
from tests.partner_helpers import API

pytestmark = pytest.mark.usefixtures("channel_sync_on")  # these tests exercise automatic sync


async def _login(client, phone: str) -> dict[str, str]:
    resp = await client.post(f"{API}/partner/auth/otp/verify", json={"phone": phone, "code": "123456"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_portals_seed_invariants_and_demo_logins(client, db):
    await Seeder(db).run()
    result = await seed_portals(db)
    assert result is not None
    summary, seeder = result
    assert summary["conflicts"] == 2 and summary["settlements"] == 2 and summary["coupons"] == 4
    assert await seed_portals(db) is None  # idempotent

    # every blocked slot points at an active block of the venue's provider; no block overrides a Pytch booking
    bad = await db.scalar(
        select(func.count()).select_from(Slot).outerjoin(SlotBlock, SlotBlock.id == Slot.block_id)
        .where(Slot.status == "blocked", (SlotBlock.id.is_(None)) | (SlotBlock.status != "active"))
    )
    assert bad == 0
    assert await db.scalar(select(func.count()).select_from(Slot).where(
        Slot.block_id.is_not(None), Slot.booking_id.is_not(None))) == 0
    sources = set((await db.scalars(select(SlotBlock.source).distinct())).all())
    assert {"walk_in", "phone", "playo", "hudle", "maintenance"} <= sources
    for c in (await db.scalars(select(SyncConflict))).all():
        lobby = await db.get(Lobby, c.lobby_id)
        assert c.status == "open" and lobby is not None and lobby.slot_id == c.slot_id

    for s in (await db.scalars(select(Settlement))).all():
        base = s.gross_paise - s.refunds_paise
        assert s.commission_paise == round(s.gross_paise * s.commission_bps / 10000)
        assert s.net_payable_paise == (s.gross_paise - s.refunds_paise - s.provider_discounts_paise
                                       + s.adjustments_paise - s.commission_paise - s.gst_on_commission_paise
                                       - s.tcs_paise - s.tds_paise)
        assert s.tcs_paise == round(base * settings.tcs_bps / 10000) and s.status == "paid"

    admin = (await db.scalars(select(AdminUser).where(AdminUser.email == "admin@pytch.local"))).one()
    # the demo password is public → first login forces a password change and MFA enrolment
    assert admin.role == "super_admin" and admin.must_change_password and admin.totp_enabled_at is None
    assert verify_password(admin.password_hash, ADMIN_PASSWORD)
    assert await db.scalar(select(func.count()).select_from(Provider).where(Provider.status == "pending")) == 1
    assert {c.code for c in (await db.scalars(select(Coupon))).all()} >= {"FIRSTKICK", "KOCHI20", "TURFCO15"}

    owner = await _login(client, OWNER_PHONE)
    venues = (await client.get(f"{API}/partner/venues", headers=owner)).json()
    assert len(venues) == 4
    assert (await client.get(f"{API}/partner/dashboard", headers=owner)).status_code == 200
    cal = await client.get(f"{API}/partner/calendar", params={"turf_id": venues[0]["id"]}, headers=owner)
    assert cal.status_code == 200 and any(c["occupancy"] for c in cal.json()["cells"])
    overview = (await client.get(f"{API}/partner/channels", headers=owner)).json()
    assert overview["open_conflicts"] == 2 and len(overview["feeds"]) == 1 and len(overview["api_keys"]) == 1
    assert len((await client.get(f"{API}/partner/settlements", headers=owner)).json()) == 2
    team = (await client.get(f"{API}/partner/team", headers=owner)).json()
    assert sorted(m["role"] for m in team) == ["manager", "owner", "staff", "staff"]
    staff_venues = (await client.get(f"{API}/partner/venues", headers=await _login(client, STAFF_PHONE))).json()
    assert len(staff_venues) == 2

    api = await client.get(f"{API}/channel/v1/pitches", headers={"Authorization": f"Bearer {seeder.api_key}"})
    assert api.status_code == 200 and len(api.json()) >= 4
    assert seeder.export_url
    ics = await client.get(seeder.export_url[seeder.export_url.index("/api/v1"):])
    assert ics.status_code == 200 and "BEGIN:VCALENDAR" in ics.text
