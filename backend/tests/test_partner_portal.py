"""Partner portal: onboarding, approval gate, roles & venue scoping, provider profile, team, venues, bookings."""

import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.core.timeutils import to_ist, utcnow
from app.modules.admin.models import ApprovalRequest
from app.modules.audit.models import AuditLog
from app.modules.auth import sessions
from app.modules.providers.models import Provider
from app.modules.slots.models import Slot
from tests.conftest import auth_headers
from tests.core_helpers import book
from tests.partner_helpers import API, add_member, gen_slots, make_provider, partner_headers, provider_venue

APPLICATION = {
    "business_name": "Smashpoint Arena",
    "contact_name": "Sneha Kurian",
    "contact_email": "sneha@example.com",
    "city": "Kochi",
    "address": "NH 66, Edappally, Kochi",
    "gstin": "32ABCDE1234F1Z5",
    "venues": [{"name": "Smashpoint Edappally", "area": "Edappally", "address": "NH 66, Edappally",
                "sports": ["badminton"], "pitch_count": 4, "has_indoor": True}],
    "bank_ifsc": "hdfc0001234",
    "bank_account_last4": "4321",
    "listed_on": ["playo", "hudle"],
}


async def test_application_creates_pending_provider_gated_from_operations(client, db, make_user):
    user = await make_user("Sneha")
    resp = await client.post(f"{API}/partner/applications", json=APPLICATION, headers=partner_headers(user))
    assert resp.status_code == 201, resp.text
    membership = resp.json()
    assert membership["provider_status"] == "pending" and membership["role"] == "owner"
    provider = await db.get(Provider, uuid.UUID(membership["provider_id"]))
    assert provider.bank_ifsc == "HDFC0001234" and provider.application["listed_on"] == ["playo", "hudle"]
    assert await db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "provider.apply")) == 1

    again = await client.post(f"{API}/partner/applications", json=APPLICATION, headers=partner_headers(user))
    assert again.status_code == 409

    headers = partner_headers(user)
    status_screen = await client.get(f"{API}/partner/provider", headers=headers)
    assert status_screen.status_code == 200 and status_screen.json()["status"] == "pending"
    for path in ("/partner/dashboard", "/partner/venues", "/partner/bookings", "/partner/channels", "/partner/team"):
        blocked = await client.get(f"{API}{path}", headers=headers)
        assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "PROVIDER_NOT_APPROVED", path
    bad = {**APPLICATION, "gstin": "NOT-A-GSTIN"}
    assert (await client.post(f"{API}/partner/applications", json=bad, headers=headers)).status_code == 422


async def test_staff_scoping_and_role_checks(client, db, make_user):
    owner, manager, staff = await make_user("Owner"), await make_user("Manager"), await make_user("Staff")
    provider = await make_provider(db, owner)
    turf_a, pitch_a = await provider_venue(db, provider, name="Arena A")
    turf_b, pitch_b = await provider_venue(db, provider, name="Arena B")
    await add_member(db, provider, manager, "manager")
    await add_member(db, provider, staff, "staff", turf_ids=[turf_a.id])
    other_owner = await make_user("Rival")
    rival = await make_provider(db, other_owner)
    turf_x, pitch_x = await provider_venue(db, rival, name="Rival Arena")

    s = partner_headers(staff)
    venues = (await client.get(f"{API}/partner/venues", headers=s)).json()
    assert [v["name"] for v in venues] == ["Arena A"]
    assert (await client.get(f"{API}/partner/calendar", params={"turf_id": str(turf_a.id), "days": 1},
                             headers=s)).status_code == 200
    assert (await client.get(f"{API}/partner/calendar", params={"turf_id": str(turf_b.id)},
                             headers=s)).status_code == 404
    # other providers' ids are never trusted
    assert (await client.get(f"{API}/partner/calendar", params={"turf_id": str(turf_x.id)},
                             headers=partner_headers(owner))).status_code == 404
    assert (await client.patch(f"{API}/partner/pitches/{pitch_x.id}", json={"name": "Hacked"},
                               headers=partner_headers(owner))).status_code == 404
    # staff can't touch pricing, managers can
    price = {"price_per_hour_paise": 99_900}
    assert (await client.patch(f"{API}/partner/pitches/{pitch_a.id}", json=price, headers=s)).status_code == 403
    assert (await client.patch(f"{API}/partner/pitches/{pitch_a.id}", json=price,
                               headers=partner_headers(manager))).status_code == 200
    # only owners invite or mint API keys
    invite = {"phone": "+919812345000", "role": "staff"}
    assert (await client.post(f"{API}/partner/team", json=invite, headers=partner_headers(manager))).status_code == 403
    key_body = {"name": "POS", "scopes": ["availability:read"]}
    assert (await client.post(f"{API}/partner/channels/api-keys", json=key_body,
                              headers=partner_headers(manager))).status_code == 403
    assert (await client.post(f"{API}/partner/channels/api-keys", json=key_body,
                              headers=partner_headers(owner))).status_code == 201
    # staff can't bulk-block; scoped staff don't see the provider-wide statements
    assert (await client.get(f"{API}/partner/settlements", headers=s)).status_code == 403
    assert (await client.get(f"{API}/partner/settlements", headers=partner_headers(manager))).status_code == 200


async def test_multi_provider_member_must_choose_provider(client, db, make_user):
    user = await make_user("Both")
    p1 = await make_provider(db, user, name="One")
    p2 = await make_provider(db, user, name="Two")
    no_header = await client.get(f"{API}/partner/team", headers=partner_headers(user))
    assert no_header.status_code == 400 and no_header.json()["error"]["code"] == "PROVIDER_REQUIRED"
    ok = await client.get(f"{API}/partner/provider", headers=partner_headers(user, p2.id))
    assert ok.json()["name"] == "Two"
    stranger = await make_user("Stranger")
    assert (await client.get(f"{API}/partner/provider", headers=partner_headers(stranger, p1.id))).status_code == 403


async def test_bank_change_needs_admin_approval(client, db, make_user):
    owner = await make_user("Owner")
    provider = await make_provider(db, owner)
    provider.bank_account_name, provider.bank_ifsc, provider.bank_account_last4 = "Old Name", "SBIN0000001", "1111"
    await db.commit()
    resp = await client.patch(f"{API}/partner/provider", headers=partner_headers(owner), json={
        "contact_email": "ops@turfco.in", "bank_account_name": "New Name", "bank_ifsc": "HDFC0009999",
        "bank_account_last4": "2222"})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["contact_email"] == "ops@turfco.in"
    assert (out["bank_account_name"], out["bank_ifsc"], out["bank_account_last4"]) == ("Old Name", "SBIN0000001",
                                                                                      "1111")
    await db.refresh(provider)
    assert provider.payouts_on_hold is True
    approval = (await db.scalars(select(ApprovalRequest))).one()
    assert approval.action == "provider.bank_change" and approval.status == "pending"
    assert approval.requested_by_provider_id == provider.id
    assert approval.payload["old"]["bank_account_last4"] == "1111"
    assert approval.payload["new"] == {"bank_account_name": "New Name", "bank_ifsc": "HDFC0009999",
                                       "bank_account_last4": "2222"}
    # managers can't edit the business profile
    manager = await make_user("Mgr")
    await add_member(db, provider, manager, "manager")
    assert (await client.patch(f"{API}/partner/provider", json={"contact_name": "X"},
                               headers=partner_headers(manager))).status_code == 403


async def test_team_remove_revokes_partner_sessions(client, db, make_user):
    owner, staff = await make_user("Owner"), await make_user("Staff", phone="+919812000555")
    provider = await make_provider(db, owner)
    member = await add_member(db, provider, staff, "staff")
    _, access, _ = await sessions.create_session(db, subject_type="user", subject_id=staff.id, audience="partner")
    await db.commit()
    staff_headers = {"Authorization": f"Bearer {access}"}
    assert (await client.get(f"{API}/partner/bookings", headers=staff_headers)).status_code == 200
    # the front desk sees neither the roster (everyone's phone) nor money — same as the portal navigation
    for path in ("/partner/team", "/partner/earnings", "/partner/settlements"):
        assert (await client.get(f"{API}{path}", headers=staff_headers)).status_code == 403, path

    patched = await client.patch(f"{API}/partner/team/{member.id}", json={"role": "manager"},
                                 headers=partner_headers(owner))
    assert patched.status_code == 200 and patched.json()["role"] == "manager"
    assert (await client.get(f"{API}/partner/team", headers=staff_headers)).status_code == 200
    assert (await client.delete(f"{API}/partner/team/{member.id}", headers=partner_headers(owner))).status_code == 204
    # it was their only venue account → signed out
    assert (await client.get(f"{API}/partner/team", headers=staff_headers)).status_code == 401
    team = (await client.get(f"{API}/partner/team", headers=partner_headers(owner))).json()
    assert [m["role"] for m in team] == ["owner"]
    owner_member = team[0]["id"]
    assert (await client.delete(f"{API}/partner/team/{owner_member}",
                                headers=partner_headers(owner))).status_code == 403


async def test_team_remove_keeps_access_to_the_members_own_business(client, db, make_user):
    owner, other = await make_user("Owner"), await make_user("Runs Own Turf")
    provider = await make_provider(db, owner, name="Host Co")
    own = await make_provider(db, other, name="Own Co")
    member = await add_member(db, provider, other, "manager")
    _, access, _ = await sessions.create_session(db, subject_type="user", subject_id=other.id, audience="partner")
    await db.commit()
    token = {"Authorization": f"Bearer {access}"}
    assert (await client.get(f"{API}/partner/team", headers={**token, "X-Provider-Id": str(provider.id)})
            ).status_code == 200
    assert (await client.delete(f"{API}/partner/team/{member.id}", headers=partner_headers(owner))).status_code == 204
    # access to the removing owner's business ends on the next request (membership is checked every time)…
    gone = await client.get(f"{API}/partner/team", headers={**token, "X-Provider-Id": str(provider.id)})
    assert gone.status_code == 403 and gone.json()["error"]["code"] == "PROVIDER_REQUIRED"
    # …but the same session keeps working for their own business
    mine = await client.get(f"{API}/partner/provider", headers={**token, "X-Provider-Id": str(own.id)})
    assert mine.status_code == 200 and mine.json()["name"] == "Own Co"
    assert (await client.get(f"{API}/partner/provider", headers=token)).json()["name"] == "Own Co"


async def test_new_pitch_generates_slots_and_repricing_only_touches_free_future_slots(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host")
    provider = await make_provider(db, owner)
    turf, pitch = await provider_venue(db, provider)
    created = await client.post(f"{API}/partner/venues/{turf.id}/pitches", headers=partner_headers(owner), json={
        "name": "Court 9", "sport": "badminton", "format": "doubles", "capacity": 4, "is_indoor": True,
        "has_camera": False, "camera_price_paise": 0, "price_per_hour_paise": 40_000,
        "peak_price_per_hour_paise": 50_000})
    assert created.status_code == 201, created.text
    new_id = uuid.UUID(created.json()["id"])
    assert await db.scalar(select(func.count()).select_from(Slot).where(Slot.pitch_id == new_id)) > 100

    slots = await gen_slots(db, pitch)
    future = [s for s in slots if s.start_at > utcnow() + timedelta(hours=3)]
    booked_slot, free_slot = future[0], future[1]
    await book(client, host, booked_slot)
    resp = await client.patch(f"{API}/partner/pitches/{pitch.id}", headers=partner_headers(owner), json={
        "price_per_hour_paise": 111_100, "peak_price_per_hour_paise": 222_200, "apply_to_future_slots": True})
    assert resp.status_code == 200 and resp.json()["price_per_hour_paise"] == 111_100
    await db.refresh(booked_slot)
    await db.refresh(free_slot)
    assert booked_slot.price_paise == 150_000 or booked_slot.price_paise == 180_000  # held slot untouched
    assert free_slot.price_paise == (222_200 if free_slot.is_peak else 111_100)

    venue = await client.patch(f"{API}/partner/venues/{turf.id}", headers=partner_headers(owner),
                               json={"amenities": ["Parking", "Showers"], "open_time": "07:00"})
    assert venue.status_code == 200 and venue.json()["open_time"] == "07:00"
    assert venue.json()["amenities"] == ["Parking", "Showers"] and venue.json()["pitch_count_active"] == 2


async def test_bookings_list_masks_player_phones_and_exports_csv(client, db, make_user):
    owner, host = await make_user("Owner"), await make_user("Host Player", phone="+919876543210")
    provider = await make_provider(db, owner)
    _, pitch = await provider_venue(db, provider)
    slots = await gen_slots(db, pitch)
    future = [s for s in slots if s.start_at > utcnow() + timedelta(hours=3)]
    await book(client, host, future[0], title="Friday Fives")
    walk_in = await client.post(f"{API}/partner/blocks", headers=partner_headers(owner), json={
        "pitch_id": str(pitch.id), "start_at": future[2].start_at.isoformat(), "end_at": future[2].end_at.isoformat(),
        "kind": "booking", "source": "walk_in", "customer_name": "=HYPERLINK(evil)", "customer_phone": "+919000000001",
        "amount_paise": 120_000, "payment_mode": "cash"})
    assert walk_in.status_code == 201, walk_in.text

    page = (await client.get(f"{API}/partner/bookings", headers=partner_headers(owner))).json()
    assert page["total"] == 2
    rows = {r["kind"]: r for r in page["items"]}
    assert rows["pytch"]["customer_phone"] == "+91 98••• ••210" and rows["pytch"]["customer_name"] == "Host Player"
    assert rows["pytch"]["payment_status"] == "pending" and rows["pytch"]["source"] == "pytch"
    assert rows["offline"]["customer_phone"] == "+919000000001" and rows["offline"]["payment_status"] == "paid"
    only_walkins = (await client.get(f"{API}/partner/bookings", params={"source": "walk_in"},
                                     headers=partner_headers(owner))).json()
    assert only_walkins["total"] == 1
    search = (await client.get(f"{API}/partner/bookings", params={"q": "friday"},
                               headers=partner_headers(owner))).json()
    assert [r["kind"] for r in search["items"]] == ["pytch"]

    csv_resp = await client.get(f"{API}/partner/bookings/export.csv", headers=partner_headers(owner))
    assert csv_resp.status_code == 200 and csv_resp.headers["content-type"].startswith("text/csv")
    text = csv_resp.text
    assert "98••• ••210" in text and "9876543210" not in text
    assert ",90000 00001," in text and "'+91" not in text  # phones in national format: no "+", no "'" guard
    assert "'=HYPERLINK(evil)" in text  # formula injection neutralised

    dash = await client.get(f"{API}/partner/dashboard", headers=partner_headers(owner))
    assert dash.status_code == 200, dash.text
    d = dash.json()
    assert len(d["revenue_series"]) == 14 and d["upcoming"] and d["occupancy_heatmap"]
    # "channel mix · last 30 days": both games are still to come, so neither counts yet
    assert sum(m["count"] for m in d["channel_mix"]) == 0
    earnings = await client.get(f"{API}/partner/earnings", headers=partner_headers(owner))
    assert earnings.status_code == 200 and "from" in earnings.json()
    # player views never leak anything about the walk-in
    grid = (await client.get(f"{API}/pitches/{pitch.id}/slots",
                             params={"date": str(to_ist(future[2].start_at).date())},
                             headers=auth_headers(host))).json()
    blocked = [s for s in grid if s["id"] == str(future[2].id)]
    assert not blocked or (blocked[0]["status"] == "blocked" and "HYPERLINK" not in str(blocked[0]))


async def test_realtime_partner_sockets_only_watch_own_pitches(db, make_user):
    from app.core.security import create_token
    from app.realtime.router import _authenticate, _can_subscribe

    owner, staff, player = await make_user("Owner"), await make_user("Staff"), await make_user("Player")
    provider = await make_provider(db, owner)
    turf_a, pitch_a = await provider_venue(db, provider)
    _, pitch_b = await provider_venue(db, provider)
    await add_member(db, provider, staff, "staff", turf_ids=[turf_a.id])
    rival = await make_provider(db, await make_user("Rival"))
    _, pitch_x = await provider_venue(db, rival)

    sid = uuid.uuid4()
    assert await _authenticate(create_token(owner.id, "access", audience="partner", session_id=sid)) == (
        owner.id, "partner")
    assert await _authenticate(create_token(player.id, "access", session_id=sid)) == (player.id, "app")
    assert await _authenticate(create_token(player.id, "access")) is None  # session-less tokens are refused
    assert await _authenticate("garbage") is None
    assert await _can_subscribe(owner.id, f"pitch:{pitch_a.id}", "partner")
    assert await _can_subscribe(owner.id, f"pitch:{pitch_b.id}", "partner")
    assert not await _can_subscribe(owner.id, f"pitch:{pitch_x.id}", "partner")
    assert await _can_subscribe(staff.id, f"pitch:{pitch_a.id}", "partner")
    assert not await _can_subscribe(staff.id, f"pitch:{pitch_b.id}", "partner")  # venue scoping
    assert not await _can_subscribe(owner.id, f"lobby:{uuid.uuid4()}", "partner")  # lobbies stay player-only
    assert await _can_subscribe(owner.id, f"user:{owner.id}", "partner")
    assert await _can_subscribe(player.id, f"pitch:{pitch_x.id}", "app")  # players: public availability
    provider.status = "suspended"
    await db.commit()
    assert not await _can_subscribe(owner.id, f"pitch:{pitch_a.id}", "partner")


async def test_partner_signups_kill_switch(client, db, make_user):
    from app.modules.platform.models import AppSetting

    db.add(AppSetting(key="partner_signups_enabled", value={"v": False}))
    await db.commit()
    user = await make_user("Late Applicant")
    resp = await client.post(f"{API}/partner/applications", json=APPLICATION, headers=partner_headers(user))
    assert resp.status_code == 403
    assert await db.scalar(select(func.count()).select_from(Provider)) == 0
