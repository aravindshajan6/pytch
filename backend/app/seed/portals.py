"""Demo data for the partner portal, channel sync and admin console (runs after the player-world seed).

Idempotent: skipped when the demo provider already exists. Everything respects the live invariants — blocked slots
point at their `SlotBlock`, conflicts reference real Pytch lobbies, settlements use the contract formula.

Demo logins
    Partner (OTP 123456 in demo mode):  Rahul Varghese  +919999900010  owner of "Kochi Turf Co." (4 venues)
                                        Anjali Thomas   +919999900011  manager
                                        Vishnu Prasad   +919999900012  staff (2 venues)
                                        Sneha Kurian    +919999900013  pending application (admin review queue)
    Admin (password, MFA enrolment on first login):  admin@pytch.local (super_admin), finance@pytch.local (finance)
"""

import random
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import encrypt, keyed_hash, random_token
from app.core.passwords import hash_password
from app.core.timeutils import IST, ist_today, to_ist, utcnow
from app.modules.admin.models import AdminUser
from app.modules.bookings.models import Booking
from app.modules.channels.fetch import url_hint
from app.modules.channels.models import ChannelFeed, ProviderApiKey, SlotBlock, SyncConflict
from app.modules.channels.service import SOURCE_LABELS, feed_ref, when_label
from app.modules.coupons.models import Coupon
from app.modules.lobbies.models import Lobby
from app.modules.notifications.models import Notification
from app.modules.providers.models import Provider, ProviderMember
from app.modules.settlements.models import Settlement, SettlementLine
from app.modules.slots.models import Slot
from app.modules.turfs.models import Pitch, Turf
from app.modules.users.models import PlayerStats, User

DEMO_PROVIDER_SLUG = "kochi-turf-co"
OWNER_PHONE = "+919999900010"
MANAGER_PHONE = "+919999900011"
STAFF_PHONE = "+919999900012"
APPLICANT_PHONE = "+919999900013"
INVITED_PHONE = "+919999900016"
ADMIN_PASSWORD = "Pytch!Admin2026"  # demo only
ADMINS = (("admin@pytch.local", "Asha Admin", "super_admin"), ("finance@pytch.local", "Faisal Finance", "finance"))


@dataclass(frozen=True)
class ProviderSpec:
    slug: str
    name: str
    legal_name: str
    owner_name: str
    owner_phone: str
    gstin: str
    pan_last4: str
    entity_type: str
    email: str
    address: str
    bank_name: str
    ifsc: str
    last4: str
    commission_bps: int
    venues: int


PROVIDERS = (
    ProviderSpec(DEMO_PROVIDER_SLUG, "Kochi Turf Co.", "Kochi Turf Company Pvt Ltd", "Rahul Varghese", OWNER_PHONE,
                 "32AAKCK4821L1Z5", "4821", "company", "rahul@kochiturf.co", "MG Road, Ernakulam, Kochi 682016",
                 "Kochi Turf Company Pvt Ltd", "HDFC0001822", "7731", 1000, 4),
    ProviderSpec("coastal-sports-collective", "Coastal Sports Collective", "Coastal Sports LLP", "Fathima Rasheed",
                 "+919999900014", "32AAQFC5190M1Z2", "5190", "llp", "fathima@coastalsports.in",
                 "Beach Rd, Fort Kochi 682001", "Coastal Sports LLP", "FDRL0001044", "2290", 1200, 4),
    ProviderSpec("greenfield-arenas", "Greenfield Arenas", "Greenfield Arenas (Prop. Joseph Mathew)", "Joseph Mathew",
                 "+919999900015", "32ABFPM7702K1ZQ", "7702", "proprietorship", "joseph@greenfieldarenas.in",
                 "Seaport-Airport Rd, Kalamassery 683104", "Joseph Mathew", "SBIN0070231", "0417", 900, 0),
)

CUSTOMERS = [
    "Arun Das", "Nikhil Menon", "Shabeer Ali", "Jithin Joseph", "Akhil Raj", "Fahad Hassan", "Sreejith P",
    "Ananthu Krishnan", "Midhun Mohan", "Rohit Nair", "Basil Eldho", "Irfan Rahman", "Vivek Pillai", "Aswin Babu",
    "Ajmal Siddique", "Sachin Varghese", "Hari Shankar", "Tony Chacko", "Deepak Kurup", "Nabeel Musthafa",
]
TEAMS = ["Infopark FC", "Kakkanad Strikers", "TCS Fives", "UST Warriors", "Edappally Ballers", "Vyttila United",
         "Old Boys SH College", "Friday Night Futsal"]
MAINTENANCE_NOTES = ["Turf grooming & infill top-up", "Floodlight servicing", "Net replacement", "Deep clean"]


class PortalSeeder:
    def __init__(self, db: AsyncSession, *, seed: int = 20260912) -> None:
        self.db = db
        self.rng = random.Random(seed)
        self.now = utcnow()
        self.today = ist_today()
        self.users: dict[str, User] = {}
        self.providers: dict[str, Provider] = {}
        self.turfs_by_provider: dict[str, list[Turf]] = defaultdict(list)
        self.admins: dict[str, AdminUser] = {}
        self.api_key: str | None = None
        self.export_url: str | None = None
        self.counts: dict[str, int] = defaultdict(int)

    # ── helpers ──
    def phone(self) -> str:
        return f"+9198{self.rng.randint(10_000_000, 99_999_999)}"

    async def user(self, name: str, phone: str) -> User:
        user = (await self.db.execute(select(User).where(User.phone == phone))).unique().scalar_one_or_none()
        if user is None:
            user = User(id=uuid.uuid4(), phone=phone, name=name, preferred_sports=["football"], onboarded=True,
                        wallet_balance_paise=0, is_bot=False, home_area="Kakkanad",
                        created_at=self.now - timedelta(days=self.rng.randint(90, 200)))
            user.stats = PlayerStats(user_id=user.id)
            self.db.add(user)
            await self.db.flush([user])
        self.users[phone] = user
        return user

    # ── admins, providers, team ──
    async def admin_accounts(self) -> None:
        pw_hash = hash_password(ADMIN_PASSWORD)
        for email, name, role in ADMINS:
            admin = (await self.db.execute(select(AdminUser).where(AdminUser.email == email))).scalar_one_or_none()
            if admin is None:
                admin = AdminUser(id=uuid.uuid4(), email=email, name=name, role=role, is_active=True,
                                  password_hash=pw_hash, password_changed_at=self.now,
                                  must_change_password=True,  # demo password is public → forced change + MFA
                                  recovery_code_hashes=[], failed_logins=0)
                self.db.add(admin)
            self.admins[role] = admin
        await self.db.flush()

    async def _upcoming_lobby_counts(self) -> dict[uuid.UUID, int]:
        rows = (await self.db.execute(
            select(Lobby.turf_id, Lobby.id).where(Lobby.status.in_(("forming", "confirmed")), Lobby.start_at > self.now)
        )).all()
        counts: dict[uuid.UUID, int] = defaultdict(int)
        for turf_id, _ in rows:
            counts[turf_id] += 1
        return counts

    async def provider_accounts(self) -> None:
        turfs = list((await self.db.execute(select(Turf).order_by(Turf.name))).unique().scalars().all())
        busy = await self._upcoming_lobby_counts()
        # the demo owner gets the four venues with the most games coming up (conflicts + a lively calendar)
        ranked = sorted(turfs, key=lambda t: (-busy.get(t.id, 0), t.name))
        remaining = list(ranked)
        reviewer = self.admins.get("super_admin")
        for i, spec in enumerate(PROVIDERS):
            owner = await self.user(spec.owner_name, spec.owner_phone)
            provider = Provider(
                id=uuid.uuid4(), name=spec.name, slug=spec.slug, legal_name=spec.legal_name, gstin=spec.gstin,
                pan_last4=spec.pan_last4, pan_enc=encrypt(f"AAKPV{spec.pan_last4}Q"), entity_type=spec.entity_type,
                contact_name=spec.owner_name, contact_phone=spec.owner_phone, contact_email=spec.email, city="Kochi",
                address=spec.address, status="approved", commission_bps=spec.commission_bps,
                settlement_cycle="weekly", bank_account_name=spec.bank_name, bank_account_last4=spec.last4,
                bank_ifsc=spec.ifsc, kyc_verified_at=self.now - timedelta(days=60 - i * 7),
                reviewed_by_admin_id=reviewer.id if reviewer else None,
                reviewed_at=self.now - timedelta(days=62 - i * 7),
                application={"venues": [], "listed_on": ["playo", "hudle"], "seed": True},
                created_at=self.now - timedelta(days=65 - i * 7),
            )
            self.db.add(provider)
            await self.db.flush([provider])
            self.db.add(ProviderMember(id=uuid.uuid4(), provider_id=provider.id, user_id=owner.id, role="owner",
                                       status="active"))
            self.providers[spec.slug] = provider
            take = remaining[: spec.venues] if spec.venues else remaining
            remaining = remaining[len(take):]
            for turf in take:
                turf.provider_id = provider.id
                self.turfs_by_provider[spec.slug].append(turf)
        demo = self.providers[DEMO_PROVIDER_SLUG]
        demo_turfs = self.turfs_by_provider[DEMO_PROVIDER_SLUG]
        manager = await self.user("Anjali Thomas", MANAGER_PHONE)
        staff = await self.user("Vishnu Prasad", STAFF_PHONE)
        self.db.add_all([
            ProviderMember(id=uuid.uuid4(), provider_id=demo.id, user_id=manager.id, role="manager", status="active"),
            ProviderMember(id=uuid.uuid4(), provider_id=demo.id, user_id=staff.id, role="staff", status="active",
                           turf_ids=[str(t.id) for t in demo_turfs[:2]]),
            ProviderMember(id=uuid.uuid4(), provider_id=demo.id, user_id=None, invited_phone=INVITED_PHONE,
                           role="staff", status="invited", turf_ids=[str(demo_turfs[0].id)]),
        ])

        applicant = await self.user("Sneha Kurian", APPLICANT_PHONE)
        pending = Provider(
            id=uuid.uuid4(), name="Smashpoint Badminton Arena", slug="smashpoint-badminton-arena",
            legal_name="Smashpoint Sports Pvt Ltd", gstin="32AAHCS3310P1Z9", contact_name="Sneha Kurian",
            contact_phone=APPLICANT_PHONE, contact_email="sneha@smashpoint.in", city="Kochi",
            address="Near Lulu Mall, Edappally, Kochi 682024", status="pending",
            commission_bps=settings.default_commission_bps, bank_account_name="Smashpoint Sports Pvt Ltd",
            bank_ifsc="ICIC0000456", bank_account_last4="9034",
            application={
                "venues": [
                    {"name": "Smashpoint Edappally", "area": "Edappally", "address": "Near Lulu Mall, Edappally",
                     "lat": 10.0271, "lng": 76.3080, "sports": ["badminton", "pickleball"], "pitch_count": 6,
                     "has_indoor": True, "notes": "Synthetic mats, AC, pro shop"},
                    {"name": "Smashpoint Kaloor", "area": "Kaloor", "address": "Stadium Link Rd, Kaloor",
                     "lat": 9.9978, "lng": 76.2931, "sports": ["badminton"], "pitch_count": 4, "has_indoor": True,
                     "notes": None},
                ],
                "listed_on": ["playo", "khelomore"],
                "submitted_at": (self.now - timedelta(days=1, hours=3)).isoformat(),
                "submitted_by_user_id": str(applicant.id),
            },
            created_at=self.now - timedelta(days=1, hours=3),
        )
        self.db.add(pending)
        await self.db.flush([pending])
        self.db.add(ProviderMember(id=uuid.uuid4(), provider_id=pending.id, user_id=applicant.id, role="owner",
                                   status="active"))
        await self.db.flush()

    # ── blocks (walk-ins, phone, other apps, maintenance) ──
    def _source(self) -> str:
        return self.rng.choices(["walk_in", "phone", "playo", "hudle", "khelomore", "maintenance"],
                                weights=[28, 24, 20, 14, 4, 10])[0]

    def _block_fields(self, source: str, price: int, hours: int) -> dict[str, Any]:
        rng = self.rng
        if source == "maintenance":
            return {"kind": "block", "customer_name": None, "customer_phone": None, "amount_paise": 0,
                    "payment_mode": None, "notes": rng.choice(MAINTENANCE_NOTES), "external_ref": None}
        name = rng.choice(TEAMS) if rng.random() < 0.3 else rng.choice(CUSTOMERS)
        amount = price * hours
        if source in ("playo", "hudle", "khelomore"):
            ref = f"{source[:2].upper()}{rng.randint(100000, 999999)}"
            return {"kind": "booking", "customer_name": name, "customer_phone": None, "amount_paise": amount,
                    "payment_mode": "online_other", "notes": f"{SOURCE_LABELS[source]} booking #{ref}",
                    "external_ref": None}
        mode = rng.choices(["cash", "upi", "unpaid"], weights=[45, 45, 10])[0]
        return {"kind": "booking", "customer_name": name, "customer_phone": self.phone(), "amount_paise": amount,
                "payment_mode": mode, "notes": rng.choice([None, None, "Regulars — Friday league", "Bring own bibs",
                                                           "Advance ₹500 paid"]), "external_ref": None}

    async def _add_block(self, provider: Provider, pitch: Pitch, slots: list[Slot], source: str,
                         created_by: User | None, **extra: Any) -> SlotBlock:
        fields = self._block_fields(source, slots[0].price_paise, len(slots))
        fields.update(extra)
        block = SlotBlock(id=uuid.uuid4(), provider_id=provider.id, pitch_id=pitch.id, start_at=slots[0].start_at,
                          end_at=slots[-1].end_at, source=source, status="active",
                          created_by_user_id=created_by.id if created_by else None,
                          created_at=min(slots[0].start_at, self.now) - timedelta(hours=self.rng.randint(2, 70)),
                          **fields)
        self.db.add(block)
        await self.db.flush([block])
        for s in slots:
            s.status, s.block_id, s.held_until, s.held_by_id, s.booking_id = "blocked", block.id, None, None, None
        self.counts["blocks"] += 1
        return block

    async def upcoming_blocks(self) -> None:
        for slug, provider in self.providers.items():
            owner = next(self.users[spec.owner_phone] for spec in PROVIDERS if spec.slug == slug)
            staffer = self.users[STAFF_PHONE] if slug == DEMO_PROVIDER_SLUG else owner
            per_day = (0, 2) if slug == DEMO_PROVIDER_SLUG else (0, 1)
            for turf in self.turfs_by_provider[slug]:
                pitch_ids = [p.id for p in turf.pitches if p.is_active]
                end = self.now + timedelta(days=7)
                slots = list((await self.db.execute(
                    select(Slot).where(Slot.pitch_id.in_(pitch_ids), Slot.start_at > self.now + timedelta(hours=1),
                                       Slot.start_at < end).order_by(Slot.pitch_id, Slot.start_at)
                )).unique().scalars().all())
                by_pitch_day: dict[tuple[uuid.UUID, date], list[Slot]] = defaultdict(list)
                for s in slots:
                    by_pitch_day[(s.pitch_id, to_ist(s.start_at).date())].append(s)
                pitches = {p.id: p for p in turf.pitches}
                ordered = sorted(by_pitch_day.items(), key=lambda kv: (str(kv[0][0]), kv[0][1]))
                for (pitch_id, _day), day_slots in ordered:
                    free = [s for s in day_slots if s.status == "available"]
                    for _ in range(self.rng.randint(*per_day)):
                        if not free:
                            break
                        source = self._source()
                        if source == "maintenance":
                            early = [s for s in free if to_ist(s.start_at).hour <= 7]
                            if not early:
                                continue
                            chosen = [early[0]]
                        else:
                            evening = [s for s in free if 16 <= to_ist(s.start_at).hour <= 21] or free
                            start = self.rng.choice(evening)
                            chosen = [start]
                            nxt = next((s for s in free if s.start_at == start.end_at), None)
                            if nxt is not None and self.rng.random() < 0.25:
                                chosen.append(nxt)
                        creator = staffer if source in ("walk_in", "phone") else owner
                        await self._add_block(provider, pitches[pitch_id], chosen, source, creator)
                        free = [s for s in free if s not in chosen]

    async def past_blocks(self) -> None:
        """Four weeks of recorded walk-ins/phone/other-app bookings → revenue charts & heat-map."""
        provider = self.providers[DEMO_PROVIDER_SLUG]
        staffer = self.users[STAFF_PHONE]
        for turf in self.turfs_by_provider[DEMO_PROVIDER_SLUG]:
            pitches = [p for p in turf.pitches if p.is_active]
            existing = {(s.pitch_id, s.start_at) for s in (await self.db.execute(
                select(Slot).where(Slot.pitch_id.in_([p.id for p in pitches]),
                                   Slot.start_at > self.now - timedelta(days=29), Slot.start_at < self.now)
            )).unique().scalars().all()}
            for days_ago in range(1, 29):
                day = self.today - timedelta(days=days_ago)
                for _ in range(self.rng.randint(1, 3)):
                    pitch = self.rng.choice(pitches)
                    hour = self.rng.choice([6, 7, 17, 18, 19, 20, 21, 21, 20, 19])
                    start = datetime.combine(day, time(hour), tzinfo=IST).astimezone(UTC)
                    if (pitch.id, start) in existing:
                        continue
                    local = to_ist(start)
                    peak = local.weekday() >= 5 or 17 <= local.hour < 22
                    slot = Slot(id=uuid.uuid4(), pitch_id=pitch.id, start_at=start, end_at=start + timedelta(hours=1),
                                price_paise=pitch.peak_price_per_hour_paise if peak else pitch.price_per_hour_paise,
                                is_peak=peak, status="available", created_at=start - timedelta(days=14))
                    self.db.add(slot)
                    await self.db.flush([slot])
                    existing.add((pitch.id, start))
                    source = self.rng.choices(["walk_in", "phone", "playo", "hudle"], weights=[35, 30, 20, 15])[0]
                    await self._add_block(provider, pitch, [slot], source, staffer)

    # ── channels: feed, export, API key, conflicts ──
    async def channels(self) -> None:
        provider = self.providers[DEMO_PROVIDER_SLUG]
        owner = self.users[OWNER_PHONE]
        turf = self.turfs_by_provider[DEMO_PROVIDER_SLUG][0]
        pitch = sorted((p for p in turf.pitches if p.is_active), key=lambda p: p.name)[0]

        feed_url = "https://calendar.google.com/calendar/ical/kochiturfco%40gmail.com/private-3f9c1d7e2b8a/basic.ics"
        feed = ChannelFeed(id=uuid.uuid4(), provider_id=provider.id, pitch_id=pitch.id,
                           name="Front-desk Google Calendar",
                           source="other_app", url_enc=encrypt(feed_url), url_hint=url_hint(feed_url),
                           is_active=False,  # paused in the demo: the URL is illustrative (worker would fail on it)
                           last_synced_at=self.now - timedelta(hours=2), last_status="ok", last_error=None,
                           last_event_count=2, consecutive_failures=0)
        self.db.add(feed)
        await self.db.flush([feed])
        free = list((await self.db.execute(
            select(Slot).where(Slot.pitch_id == pitch.id, Slot.status == "available",
                               Slot.start_at > self.now + timedelta(days=2),
                               Slot.start_at < self.now + timedelta(days=6))
            .order_by(Slot.start_at)
        )).unique().scalars().all())
        imported = [s for s in free if 9 <= to_ist(s.start_at).hour <= 11][:2]
        for i, slot in enumerate(imported):
            await self._add_block(provider, pitch, [slot], "other_app", None, kind="booking",
                                  customer_name=["Corporate trial — Zoho", "Coaching: Kerala Blasters Academy"][i],
                                  customer_phone=None, amount_paise=0, payment_mode=None,
                                  notes="Imported from calendar", feed_id=feed.id,
                                  external_ref=feed_ref(feed.id, f"{uuid.uuid4().hex[:12]}@google.com"))

        pitch.ical_export_token = random_token(24)
        base = settings.public_web_url.rstrip("/")
        self.export_url = f"{base}{settings.api_prefix}/ical/{pitch.ical_export_token}.ics"

        raw = "pk_live_" + random_token(24)
        self.api_key = raw
        self.db.add(ProviderApiKey(id=uuid.uuid4(), provider_id=provider.id, name="Front-desk POS (demo)",
                                   prefix=raw[:16], key_hash=keyed_hash(raw),
                                   scopes=["availability:read", "blocks:write"], created_by_user_id=owner.id,
                                   last_used_at=self.now - timedelta(hours=5),
                                   created_at=self.now - timedelta(days=20)))

        turf_ids = [t.id for t in self.turfs_by_provider[DEMO_PROVIDER_SLUG]]
        lobbies = list((await self.db.execute(
            select(Lobby).where(Lobby.turf_id.in_(turf_ids), Lobby.status.in_(("forming", "confirmed")),
                                Lobby.start_at > self.now + timedelta(hours=2)).order_by(Lobby.start_at).limit(2)
        )).unique().scalars().all())
        for i, lobby in enumerate(lobbies):
            source = ["playo", "hudle"][i]
            ref = f"{source[:2].upper()}{self.rng.randint(100000, 999999)}"
            summary = (f"{SOURCE_LABELS[source]} booking {when_label(lobby.start_at, lobby.end_at)} overlaps "
                       f"Pytch game “{lobby.title}”")[:300]
            conflict = SyncConflict(
                id=uuid.uuid4(), provider_id=provider.id, pitch_id=lobby.pitch_id, slot_id=lobby.slot_id,
                lobby_id=lobby.id, source=source, external_ref=ref, external_start_at=lobby.start_at,
                external_end_at=lobby.end_at, summary=summary, status="open",
                created_at=self.now - timedelta(minutes=35 + 50 * i),
            )
            self.db.add(conflict)
            self.db.add(Notification(
                id=uuid.uuid4(), user_id=owner.id, type="sync_conflict", title="Double booking detected ⚠️",
                body=f"{summary} at {lobby.turf.name}. Pytch kept the first confirmed booking — resolve it in "
                     "Channels.",
                data={"url": "/partner/channels", "conflict_id": str(conflict.id)}, created_at=conflict.created_at,
            ))
            self.counts["conflicts"] += 1
        await self.db.flush()

    # ── coupons ──
    async def coupons(self) -> None:
        admin = self.admins.get("super_admin")
        demo = self.providers[DEMO_PROVIDER_SLUG]
        specs = [
            dict(code="FIRSTKICK", description="50% off your first booking (up to ₹100)", discount_type="percent",
                 percent_off=50, max_discount_paise=10_000, first_booking_only=True, usage_limit_per_user=1,
                 funded_by="platform"),
            dict(code="KOCHI20", description="₹20 off any game in Kochi", discount_type="flat", amount_off_paise=2_000,
                 min_amount_paise=10_000, usage_limit_per_user=5, funded_by="platform"),
            dict(code="MONSOON50", description="Monsoon special — 50% off (ended)", discount_type="percent",
                 percent_off=50, max_discount_paise=15_000, starts_at=self.now - timedelta(days=75),
                 ends_at=self.now - timedelta(days=15), usage_limit_total=500, used_count=212, funded_by="platform"),
            dict(code="TURFCO15", description="15% off at Kochi Turf Co. venues (venue-funded)",
                 discount_type="percent", percent_off=15, max_discount_paise=7_500, usage_limit_per_user=3,
                 provider_id=demo.id, turf_ids=[t.id for t in self.turfs_by_provider[DEMO_PROVIDER_SLUG]],
                 funded_by="provider", starts_at=self.now - timedelta(days=3), ends_at=self.now + timedelta(days=45)),
        ]
        for spec in specs:
            if await self.db.scalar(select(Coupon.id).where(Coupon.code == spec["code"])):
                continue
            self.db.add(Coupon(id=uuid.uuid4(), created_by_admin_id=admin.id if admin else None, is_active=True,
                               **{"min_amount_paise": 0, "used_count": 0, **spec}))
            self.counts["coupons"] += 1
        await self.db.flush()

    # ── settlements (historical, paid) ──
    async def settlements(self) -> None:
        provider = self.providers[DEMO_PROVIDER_SLUG]
        turf_ids = [t.id for t in self.turfs_by_provider[DEMO_PROVIDER_SLUG]]
        this_monday = self.today - timedelta(days=self.today.weekday())
        cutoff = self.now - timedelta(hours=settings.settlement_hold_hours)
        rows = (await self.db.execute(
            select(Booking, Lobby.turf_id, Lobby.start_at, Lobby.end_at).join(Lobby, Lobby.booking_id == Booking.id)
            .where(Lobby.turf_id.in_(turf_ids), Booking.status == "completed", Lobby.end_at <= cutoff)
        )).all()
        weeks: dict[date, list] = defaultdict(list)
        for booking, turf_id, start, _end in rows:
            local = to_ist(start).date()
            monday = local - timedelta(days=local.weekday())
            if monday < this_monday:
                weeks[monday].append((booking, turf_id, start))
        chosen = sorted(weeks, reverse=True)[:2]
        if len(chosen) < 2:  # not enough history — fall back to the last two full weeks (possibly empty)
            chosen = [this_monday - timedelta(days=7), this_monday - timedelta(days=14)]
        finance = self.admins.get("finance")
        admin = self.admins.get("super_admin")
        tds_bps = settings.tds_194o_bps if provider.pan_last4 else settings.tds_194o_no_pan_bps
        for monday in sorted(chosen):
            items = weeks.get(monday, [])
            gross = sum(b.pitch_fee_paise for b, _, _ in items)
            refunds = provider_disc = adjustments = 0
            commission = round(gross * provider.commission_bps / 10000)
            gst = round(commission * settings.gst_on_commission_bps / 10000)
            tcs = round((gross - refunds) * settings.tcs_bps / 10000)
            tds = round((gross - refunds) * tds_bps / 10000)
            net = gross - refunds - provider_disc + adjustments - commission - gst - tcs - tds
            period_end = monday + timedelta(days=6)
            generated = datetime.combine(period_end + timedelta(days=2), time(10), tzinfo=IST).astimezone(UTC)
            settlement = Settlement(
                id=uuid.uuid4(), provider_id=provider.id, period_start=monday, period_end=period_end,
                booking_count=len(items), gross_paise=gross, refunds_paise=refunds,
                provider_discounts_paise=provider_disc, adjustments_paise=adjustments,
                commission_bps=provider.commission_bps, commission_paise=commission, gst_on_commission_paise=gst,
                tcs_paise=tcs, tds_paise=tds, net_payable_paise=net, status="paid",
                generated_by_admin_id=admin.id if admin else None, payout_method="manual_neft",
                approved_by_admin_id=finance.id if finance else None, approved_at=generated + timedelta(hours=3),
                paid_at=generated + timedelta(days=1), payout_ref=f"UTR{self.rng.randint(10**11, 10**12 - 1)}",
                created_at=generated,
            )
            self.db.add(settlement)
            await self.db.flush([settlement])
            for booking, turf_id, start in items:
                self.db.add(SettlementLine(
                    id=uuid.uuid4(), settlement_id=settlement.id, booking_id=booking.id, turf_id=turf_id,
                    played_at=start, gross_paise=booking.pitch_fee_paise, refunds_paise=0, provider_discounts_paise=0,
                    commission_paise=round(booking.pitch_fee_paise * provider.commission_bps / 10000),
                    created_at=generated,
                ))
            self.counts["settlements"] += 1
        await self.db.flush()

    async def mirror_todos(self) -> None:
        """"Blocked on other apps?" to-dos for upcoming Pytch games at partner venues (the demo lobbies are seeded
        directly, so the booking.created handler never ran). Games more than a day out are already ticked off."""
        from app.modules.bookings.models import Booking
        from app.modules.channels import mirror
        from app.modules.channels.models import MirrorTask

        now = utcnow()
        rows = (await self.db.execute(
            select(Lobby.id, Lobby.slot_id, Booking.code, Lobby.start_at)
            .join(Booking, Booking.id == Lobby.booking_id).join(Turf, Turf.id == Lobby.turf_id)
            .where(Lobby.status.in_(("forming", "confirmed")), Lobby.start_at > now, Turf.provider_id.is_not(None))
        )).all()
        owner = self.users[OWNER_PHONE]
        for lobby_id, slot_id, code, start_at in rows:
            await mirror.slot_taken(self.db, lobby_id=lobby_id, slot_id=slot_id, booking_code=code)
            if start_at - now > timedelta(days=1):
                task = await self.db.scalar(select(MirrorTask).where(MirrorTask.lobby_id == lobby_id))
                if task is not None:
                    task.status, task.resolved_at, task.resolved_by_user_id = "done", now, owner.id

    async def run(self) -> dict[str, int]:
        await self.admin_accounts()
        await self.provider_accounts()
        await self.upcoming_blocks()
        await self.past_blocks()
        await self.channels()
        await self.coupons()
        await self.settlements()
        await self.mirror_todos()
        await self.db.commit()
        return {"providers": len(self.providers) + 1, "blocks": self.counts["blocks"],
                "conflicts": self.counts["conflicts"], "coupons": self.counts["coupons"],
                "settlements": self.counts["settlements"], "admins": len(self.admins)}


async def seed_portals(db: AsyncSession) -> tuple[dict[str, int], PortalSeeder] | None:
    """Idempotent entry point (skips when the demo provider exists or the player world isn't seeded)."""
    if await db.scalar(select(Provider.id).where(Provider.slug == DEMO_PROVIDER_SLUG)):
        return None
    if not await db.scalar(select(Turf.id).limit(1)):
        return None
    seeder = PortalSeeder(db)
    return await seeder.run(), seeder
