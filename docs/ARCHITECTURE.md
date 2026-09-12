# PYTCH — Architecture

```
                         ┌──────────────────────────── docker compose ────────────────────────────┐
  Browser (React SPA) ──▶│ web (nginx)  ── /api, /ws, /media ──▶ api (FastAPI × N) ──▶ Postgres 16  │
   REST + WebSocket      │   static SPA                          │   ▲                  ▲           │
                         │                                       ▼   │ PSUBSCRIBE        │           │
                         │                                     Redis 7 ◀── PUBLISH ── worker ───────┘
                         └──────────────────────────────────────────────────────────────────────────┘
```

| Service | Tech | Role |
|---|---|---|
| `web` | React 19 + Vite 7 + Tailwind 4 → nginx | SPA; reverse-proxies `/api`, `/ws`, `/media` to `api` (same origin: no CORS, WS just works). |
| `api` | FastAPI, SQLAlchemy 2 async, asyncpg, Pydantic v2 | REST + WebSocket. Stateless; scale horizontally. Runs migrations + idempotent seed on start. |
| `worker` | same image, `python -m app.worker` | Periodic jobs (hold expiry, match completion, weather scans, recording pipeline, bench expiry). Redis lock per job. |
| `db` | PostgreSQL 16 | Source of truth. Pessimistic row locks on `slots`. |
| `redis` | Redis 7 | OTP store, rate limits, weather cache, job locks, **pub/sub backplane** for WebSockets. |

## Backend layout (`backend/app`)

```
core/        config, database, redis, security (JWT), errors, deps, events (domain bus),
             geo (haversine), timeutils (IST), codes, pagination, constants, schemas base
db/          Base + naming conventions; models.py imports every model (Alembic target)
realtime/    publisher (publish / publish_on_commit), manager (Redis PSUBSCRIBE fan-out), router (/ws)
modules/<m>/ models.py · schemas.py · service.py · router.py · handlers.py (events) · jobs.py (worker)
seed/        idempotent demo data (python -m app.seed)
worker.py    job scheduler
```

**Rules**
1. Routers are thin: parse → call service → return schema. No SQL in routers.
2. Services own transactions: they `await db.commit()` at the end of a use-case.
3. Realtime events are queued with `publish_on_commit` so they only fire after commit.
4. Cross-module reactions go through `app.core.events` (`emit`/`@on`), not direct imports, where a module would otherwise import a "higher" module.
5. Money = integer paise. Time = UTC `timestamptz`; IST only for day boundaries / display.
6. Errors = `AppError` subclasses → contract error body.

### Schema layering (import DAG — never import upward)
```
L0 users.schemas
L1 turfs.schemas · bookings.schemas · payments.schemas · wallet.schemas · notifications.schemas · gamification.schemas · auth.schemas
L2 lobbies.schemas (LobbySummary…) · weather.schemas · ratings.schemas
L3 bench.schemas (SOSRequestOut) · highlights.schemas (RecordingOut, ClipOut)
L4 lobbies.detail_schemas (LobbyDetail, CreateBookingResponse, AcceptSOSResponse, RainCheckResponse) · users.profile_schemas (PlayerProfile)
```

## State machines

### Slot
```
available ──(POST /bookings: FOR UPDATE NOWAIT)──▶ held (held_until, held_by, booking_id)
held ──(lobby confirmed)──▶ booked
held ──(hold expired / lobby expired / cancelled)──▶ available
booked ──(host cancel >6h / rain-check / transfer away)──▶ available
```
Every transition publishes `slot.updated` on `pitch:<pitch_id>`.

### Lobby + booking
```
                   split: all N shares paid before pay_deadline (30m)
   ┌─────────┐     full : host paid the full amount (hold 10m)           ┌───────────┐  end_at passed   ┌───────────┐
   │ forming │ ──────────────────────────────────────────────────────▶  │ confirmed │ ───────────────▶ │ completed │
   └─────────┘                                                           └───────────┘  (worker)        └───────────┘
      │  deadline passed (worker) → expired: slot released, paid shares → credits (kind=refund)
      │  host cancel → cancelled: same refunds
      ▼
   expired / cancelled
```
Booking status mirrors: `pending_payment → confirmed → completed`, or `expired` / `cancelled`.

**Membership:** `joined` (seat reserved, unpaid; `reserved_until` = now+10 min, or now+5 min for subs, never beyond `pay_deadline`) → `paid`. Unpaid past `reserved_until` → `removed` (worker). `left` when a member leaves.
Seats counted = members with status in (`joined`,`paid`). `filled_spots` counts both; `paid_spots` only paid.

**Share maths:** `total = slot.price_paise + (recorded ? pitch.camera_price_paise : 0)`;
`share = ceil(total / total_spots / 100) * 100` (whole rupees). Host's seat in full mode owes `total` (purpose=`full`).

**Full mode reimbursement:** each non-host member payment (purpose `share`) is credited to the host's wallet (`kind=reimbursement`).

**Dropout rule:** paid member leaves a *confirmed* lobby → status `left`, seat reopens, `emit member.dropped`.
If kickoff is within `SOS_WINDOW_HOURS` (6 h) the bench module auto-creates an SOS. When a sub later pays for that seat,
the earliest uncompensated dropout gets credited what the sub really paid — **net of coupons on both sides**, capped at what the
dropout really paid (a seat paid entirely by coupon earns nothing) (`kind=dropout_credit`); `compensated_paise` records it.
In *forming* lobbies a leaving paid member is simply refunded to credits.

**Payment capture (single code path):** `payments.service.capture(db, payment, provider_payment_id)` — used by mock completion, Razorpay verify and Razorpay webhook. Idempotent. If the lobby can no longer accept it (expired/cancelled/seat removed) the captured amount is refunded to credits and payment marked `refunded`.

### SOS
```
open ──(spots_filled == spots_needed)──▶ filled
open ──(kickoff passed / lobby cancelled)──▶ expired / cancelled
```
Accept = row-lock SOS, add member `role=sub` with `discount_paise = share * sub_discount_pct/100`, 5-min seat hold, return payment intent.

### Weather alert
`open → transferred | rain_checked | dismissed | expired (kickoff passed)`

## Cross-module service interfaces (stable — both backend owners rely on these)

```python
# app.modules.slots.service                         (owner: core)
async def lock_slot(db, slot_id) -> Slot            # SELECT … FOR UPDATE NOWAIT; raises SlotLocked(409 SLOT_LOCKED) / NotFound
async def hold_slot(db, slot, *, user_id, until, booking_id) -> None   # requires status available else SlotUnavailable(409)
async def book_slot(db, slot) -> None               # held → booked
async def release_slot(db, slot) -> None            # → available, clears hold fields
def slot_out(slot, *, weather=None, open_lobby_id=None) -> SlotOut
async def generate_slots_for_pitch(db, pitch, *, days=14) -> int   # idempotent rolling generation (seed + worker)

# app.modules.turfs.service                         (owner: core)
async def turf_summary(db, turf, *, lat=None, lng=None) -> TurfSummary
def pitch_out(pitch) -> PitchOut

# app.modules.lobbies.service                       (owner: core)
async def get_lobby(db, lobby_id, *, for_update=False) -> Lobby                      # NotFound
async def lobby_summary(db, lobby, *, lat=None, lng=None) -> LobbySummary
async def lobby_summaries(db, lobbies, *, lat=None, lng=None) -> list[LobbySummary]
async def lobby_detail(db, lobby, viewer: User) -> LobbyDetail
def eligibility(user: User, lobby: Lobby) -> Eligibility
async def add_sub_member(db, lobby, user, *, sos_id, discount_paise) -> LobbyMember  # raises LOBBY_FULL / ALREADY_MEMBER / LOBBY_CLOSED
                                                          # role=sub, status=joined, share=lobby.share-discount, reserved 5 min.
                                                          # Client then pays via POST /lobbies/{id}/pay (purpose=sub_share).
async def transfer_to_slot(db, lobby, new_slot) -> Slot   # new_slot already locked+available; returns old slot (released). emits lobby.transferred
async def cancel_lobby(db, lobby, *, refund_kind="refund", bonus_paise=0, note="") -> int  # refunds paid members as credits (+bonus); returns total refunded
async def complete_match(db, lobby) -> None               # confirmed → completed, emits match.completed
async def post_system_message(db, lobby_id, body) -> None
def active_members(lobby) -> list[LobbyMember]

# app.modules.payments.service                      (owner: core)
async def create_intent(db, *, user, lobby, member, purpose, amount_paise, use_credits) -> PaymentIntent
async def capture(db, payment, *, provider_payment_id=None) -> Payment

# Shared (already implemented)
app.modules.notifications.service.notify / notify_many
app.modules.wallet.service.credit / debit
app.modules.gamification.service.award_xp / award_badge / get_stats_for_update
app.realtime.publisher.publish_on_commit / publish + user_channel / lobby_channel / pitch_channel

# app.modules.bench.service                         (owner: community) — lazily imported by lobbies.lobby_detail
async def open_sos_for_lobby(db, lobby_id, viewer) -> SOSRequestOut | None
# app.modules.weather.service                       (owner: community)
async def open_alert_for_lobby(db, lobby, viewer) -> WeatherAlertOut | None
async def forecast_for_slots(pitch, slots) -> dict[slot_id, HourWeather]   # used by GET /pitches/{id}/slots
# app.modules.highlights.service                    (owner: community)
async def recording_summary_for_lobby(db, lobby_id) -> RecordingSummary | None
async def pinned_clips_for_user(db, user_id, viewer_id) -> list[ClipOut]       # used by users profile
```

## Domain events (`app.core.events`)
| Event | Emitted by | Handled by |
|---|---|---|
| `lobby.confirmed(lobby_id)` | lobbies | — (no rewards: a confirm → cancel loop must earn nothing) |
| `match.completed(lobby_id)` | lobbies (worker / dev) | ratings (rating requests), highlights (schedule recording), gamification (player + **host** XP, stats, streaks, badges incl. Rain Dancer for matches moved indoors) |
| `member.dropped(lobby_id, user_id, member_id, hours_to_kickoff, was_paid)` | lobbies | bench (auto-SOS within 6 h), gamification/stats (dropouts++) |
| `sub.paid(lobby_id, user_id, member_id, sos_id)` | lobbies (on capture of a sub seat) | bench (fill counter, close SOS, notify host), gamification (Hero Sub) |
| `lobby.cancelled / lobby.expired(lobby_id)` | lobbies | bench (cancel open SOS), weather (close alerts) |
| `lobby.transferred(lobby_id, old_slot_id, new_slot_id)` | lobbies | — (weather notifies) |

## Frontend layout (`frontend/src`)
```
app/          router (lazy routes), providers (Query, Motion, Toaster), RealtimeProvider, guards
components/
  ui/         design system: Button, Card, Chip, Avatar, Sheet, ProgressRing, Countdown, Segmented,
              Form (Input/Switch/Slider/Stepper), States (Skeleton/Empty/Error/PageHeader/Stat),
              TurfArt (generative covers), PlayerBits (Tier/Verified/TrueSkill/Sport badges), AnimatedNumber
  layout/     AppShell (sidebar + bottom nav + topbar), Logo
  three/      React-Three-Fiber scenes
features/<f>/ pages + feature components + hooks (api.ts)
lib/          api/client (fetch + refresh), api/endpoints (typed), api/queryKeys, realtime (WS client + hooks),
              format (₹, IST), sports, celebrate (confetti), cn
stores/       zustand: auth (persisted), location
types/api.ts  canonical contract
```
