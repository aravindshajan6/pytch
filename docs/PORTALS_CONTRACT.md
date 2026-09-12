# PYTCH — Portals Contract (Partner portal · Admin console · Channel API)

Shapes: [`frontend/src/types/partner.ts`](../frontend/src/types/partner.ts), [`frontend/src/types/admin.ts`](../frontend/src/types/admin.ts)
(player shapes stay in `api.ts`). Research basis: [`docs/research/PORTALS_RESEARCH.md`](research/PORTALS_RESEARCH.md).
Errors use the usual `{error:{code,message,details}}` body. 🔑 = owner-only · 🧑‍💼 = manager+ · 🛡 = step-up TOTP required.

## Three identities, three audiences

| Portal | Who | Login | Token `aud` | Signing key | Where |
|---|---|---|---|---|---|
| Player app | players | phone OTP | `app` | `JWT_SECRET` | web `:8080` `/app/*` |
| Partner portal | venue owners & staff | phone OTP (same identity as a player account) | `partner` | `JWT_SECRET` | web `:8080` `/partner/*` |
| Admin console | Pytch staff | email + password (argon2id) + **mandatory TOTP** | `admin` | `ADMIN_JWT_SECRET` (separate) | **separate origin** `:8090` (bound to localhost; own nginx server block) |

* Every token carries `iss`, `aud`, `type`, `sid`. Cross-audience use is impossible (PyJWT verifies `aud`; admin uses another key).
* Sessions (`auth_sessions`): refresh rotation with **reuse detection** (reuse ⇒ session revoked), instant revocation via Redis marker, logout-all.
* Players/partners: bearer tokens (localStorage, separate keys `pytch-auth` / `pytch-partner-auth`).
* Admin: access token **in memory only** (15 min) + refresh token in **httpOnly SameSite=Strict cookie** `pytch_admin_rt` (path `/api/v1/admin/auth`), CSRF double-submit (`pytch_admin_csrf` cookie → `X-CSRF-Token`). Idle timeout 15 min, absolute 12 h.
* The public nginx server returns **404 for `/api/v1/admin/*`**; only the admin server block (`:8090`) proxies it. Optional `ADMIN_IP_ALLOWLIST` (CIDRs) enforced by API + nginx.
* Suspended/banned users are rejected on every authenticated player/partner request (`403 ACCOUNT_SUSPENDED`).

## Player-facing additions (module `coupons`, `payments`)
| Method | Path | Body | Response |
|---|---|---|---|
| POST 🔒 | `/coupons/validate` | `{code, lobby_id}` | `{valid, code, discount_paise, final_paise, message}` |
| POST 🔒 | `/lobbies/{id}/pay` | `PayRequest` now accepts `coupon_code?` | `PaymentIntent` gains `discount_paise`, `coupon_code` |

Coupon rules: applies to **the redeeming player's own share** only; platform-funded discounts never reduce the venue payout
(member's seat counts as fully paid); provider/shared-funded discounts are deducted in the provider's settlement.
Redemption row-locks the coupon (total + per-user limits, first-booking-only, sport/venue/provider targeting, validity window,
min amount, max cap). Failed/refunded payment ⇒ redemption `reversed`, `used_count` decremented.
Error codes: `COUPON_INVALID` (400, `details.reason`), `COUPON_EXHAUSTED` (409).

Player slot grids show `blocked` slots as unavailable (never leak external customer data).

---

## Partner portal — `/api/v1/partner` (module `partner`)

### Auth & onboarding
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/partner/auth/otp/request` | `{phone}` | `OtpRequestResponse` |
| POST | `/partner/auth/otp/verify` | `{phone, code}` | `PartnerAuth` (same OTP store/rate limits as players; creates the `users` row if new) |
| POST | `/partner/auth/refresh` | `{refresh_token}` | `PartnerAuth` |
| POST | `/partner/auth/logout` | – | `{ok}` |
| GET | `/partner/me` | – | `PartnerMe` (`user.name_is_default` = still the generated "Player 1234" → the portal asks for a name) |
| PATCH | `/partner/me` | `{name}` (2–80 chars, whitespace collapsed) | `PartnerMe` (own display name — same `users` row as the player app; audit `user.update_name`) |
| POST | `/partner/applications` | `ProviderApplication` | `PartnerMembership` (provider `pending`, caller = owner; audit) |
| GET | `/partner/provider` | – | `ProviderOut` (any status — drives the "under review" screen; carries `payouts_on_hold` and `pending_bank_change {account_name, ifsc, last4, requested_at}` — never a full account number) |
| PATCH 🔑 | `/partner/provider` | `ProviderUpdate` | `ProviderOut` (bank change ⇒ not applied: `payouts_on_hold=true` + `ApprovalRequest provider.bank_change`, shown as `pending_bank_change` until decided; a newer request supersedes the pending one) |

All endpoints below require an **approved** provider (`403 PROVIDER_NOT_APPROVED`) and respect staff venue scoping.

### Operations
| Method | Path | Query/Body | Response |
|---|---|---|---|
| GET | `/partner/dashboard` | `turf_id?` | `PartnerDashboard` (alerts are about the acting provider only: `pending_bank_change`, `payouts_on_hold`, `pending_application` = other approvals this provider requested; channel mix = games that *started* in the last 30 days) |
| GET | `/partner/calendar` | `turf_id, from, days(1..7)` | `CalendarView` (active pitches + switched-off pitches that still have bookings in range — `is_active=false`, occupied cells only) |
| POST | `/partner/blocks` | `CreateBlockRequest` | `SlotBlockOut` (all covered slots locked `FOR UPDATE NOWAIT`; `409 SLOT_LOCKED/SLOT_UNAVAILABLE` with `details.slot_ids`) |
| PATCH | `/partner/blocks/{id}` | `UpdateBlockRequest` | `SlotBlockOut` |
| DELETE | `/partner/blocks/{id}` | – | `204` (releases slots; webhook `block.cancelled`) |
| POST 🧑‍💼 | `/partner/blocks/bulk` | `BulkBlockRequest` | `BulkBlockResult` `{created (blocks), slots (hours), skipped[{slot_id,start_at,reason,label}]}` (occupied slots skipped, never overridden; `label` says what's there: "Pytch booking", "Walk-in booking", "Maintenance" …) |
| GET | `/partner/bookings` | `turf_id,status,source,from,to,q,include_closures,limit,offset` | `PartnerBookingsPage` — closures (`block_kind=block`, e.g. maintenance) only with `include_closures=true` (or `source=maintenance`); `conflicted` imports only with `status=conflicted`. `q` matches names/codes/notes and phones in any format (digits compared; offline phones by substring, Pytch players only by their full 10-digit number — still masked in the row) |
| GET | `/partner/bookings/export.csv` | same | `text/csv` (formula-injection guard; Indian phones in national format `98470 12345`) |
| GET | `/partner/venues` | – | `PartnerVenue[]` |
| PATCH 🧑‍💼 | `/partner/venues/{turf_id}` | `VenueUpdate` | `PartnerVenue` (`phone` accepts spaces/dashes/brackets — stored as digits with optional `+`; pitches carry `is_active` + `upcoming_bookings`) |
| POST 🧑‍💼 | `/partner/venues/{turf_id}/pitches` | `PitchInput` | `Pitch` (+ 14 days of slots) |
| PATCH 🧑‍💼 | `/partner/pitches/{id}` | `Partial<PitchInput>` | `Pitch` (`apply_to_future_slots` re-prices *available* future slots only) |
| GET 🧑‍💼 | `/partner/earnings` | `from,to` | `PartnerEarnings` (`unsettled_paise` = net of games already played and past `SETTLEMENT_HOLD_HOURS`, not yet in a statement; `upcoming_paise` = net of confirmed games still to play / inside the hold) |
| GET 🧑‍💼 | `/partner/settlements` | – | `SettlementOut[]` (unscoped members or the owner) |
| GET 🧑‍💼 | `/partner/settlements/{id}` | – | `SettlementDetail` |
| GET 🧑‍💼 | `/partner/team` | – | `PartnerMemberOut[]` (members' phone numbers → not for the front desk) |
| POST 🔑 | `/partner/team` | `InviteMemberRequest` | `PartnerMemberOut` (activates on that phone's first partner login) |
| PATCH 🔑 | `/partner/team/{id}` | `{role?, turf_ids?, status?}` | `PartnerMemberOut` (`turf_ids`: `null` = all venues, else a non-empty list — `[]` is `422`) |
| DELETE 🔑 | `/partner/team/{id}` | – | `204` (access to this provider ends on the next request — membership is checked on every call; their partner sessions are revoked only if this was their last venue account, so removing someone never logs them out of their own business) |

Staff (front desk) never read money or the roster: `earnings`, `settlements`, `team` are manager+ (`403` for staff), matching the
portal navigation. Role / scope changes reach an open portal session within a minute (it re-reads `/partner/me` every 60 s, on
window focus and on any `403`).

Realtime: partner tokens may open `/ws` (token as the 2nd subprotocol: `['pytch.v1', token]`) and subscribe to `pitch:<id>` for pitches they manage (`slot.updated`).

### Channels — keeping several booking apps consistent
The `slots` table is the **single source of truth**. Everything that occupies a pitch — Pytch bookings, walk-ins, phone bookings,
other apps (Playo/Hudle/KheloMore have no public partner APIs → owners mirror them here with *quick-block*), maintenance,
imported calendars, Channel-API pushes — goes through the same `FOR UPDATE NOWAIT` slot lock, so double-booking *inside* Pytch is impossible.
Residual risk is the lag of external systems; conflicts are surfaced, never silently overwritten (**first confirmed wins**).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/partner/channels` | – | `ChannelsOverview` |
| POST 🧑‍💼 | `/partner/channels/feeds` | `CreateFeedRequest` | `FeedOut` (URL fetched & parsed once to validate; stored encrypted) |
| PATCH/DELETE 🧑‍💼 | `/partner/channels/feeds/{id}` | `{name?, is_active?}` | `FeedOut` / `204` |
| POST | `/partner/channels/feeds/{id}/sync` | – | `FeedOut` (sync now) |
| POST 🧑‍💼 | `/partner/channels/exports/{pitch_id}` | – | `ExportOut` (creates/rotates secret iCal URL) |
| DELETE 🧑‍💼 | `/partner/channels/exports/{pitch_id}` | – | `204` |
| POST 🔑 | `/partner/channels/api-keys` | `{name, scopes}` | `CreatedApiKey` (key shown once; stored as keyed hash) |
| DELETE 🔑 | `/partner/channels/api-keys/{id}` | – | `204` |
| POST 🔑 | `/partner/channels/webhooks` | `{url(https), events}` | `CreatedWebhook` (secret shown once) |
| DELETE 🔑 | `/partner/channels/webhooks/{id}` | – | `204` |
| POST 🔑 | `/partner/channels/webhooks/{id}/test` | – | `{status_code, ok}` |
| GET | `/partner/channels/conflicts` | `status?` (`open\|resolved\|ignored\|obsolete`) | `SyncConflictOut[]` (`holder_kind pytch\|block`, `lobby_status`, `holder_source`, `holder_label` — what actually holds the slot) |
| POST 🧑‍💼 | `/partner/channels/conflicts/{id}/resolve` | `{resolution: kept_pytch\|moved_external\|ignored, note?}` | `SyncConflictOut` (`409` once it is no longer open) |

**iCal import** (worker, every `ICAL_IMPORT_INTERVAL_MINUTES`=5 per feed, conditional GET with ETag): each VEVENT (UID) in the next 14 days
→ upsert `SlotBlock(source=feed.source, external_ref=UID, feed_id)` over overlapping slots; the event title is kept as the block's label
(`customer_name`, partner-only — never in player views or export feeds); events removed/cancelled upstream ⇒ block cancelled;
overlap with a Pytch-held/booked slot or another block ⇒ `SyncConflict` + notify owner (the text says what keeps the slot: a confirmed game,
a game still collecting payments, or the block logged first) + audit. An event that can't claim **any** slot is stored as `status=conflicted`
— not a booking: never counted on the dashboard/earnings, listed, exported or shown on the calendar; a later sync claims the hours if they free up.
SSRF-safe fetch (https only, public IPs only, 2 MB cap, 10 s timeout). Feed failing 3× ⇒ `last_status=error`, dashboard alert.

**Conflicts close themselves** (`status=obsolete`, `resolution_note` says why) when one side disappears: the Pytch hold/booking on the slot is
released (expired / cancelled), the block holding the slot is cancelled, the external booking is removed, or its feed is disconnected.
Block statuses: `active` · `conflicted` · `cancelled`. Conflict statuses: `open` · `resolved` · `ignored` · `obsolete`.
**iCal export**: `GET /api/v1/ical/{token}.ics` (public, unguessable token) — occupied slots only, no customer PII (`SUMMARY: Booked`).

### Channel API (for integrators) — `/api/v1/channel/v1` (module `channels`)
Auth: `Authorization: Bearer pk_live_…` (hash lookup, per-key rate limit 120/min, scopes). Writes take `Idempotency-Key`.
| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/channel/v1/pitches` | availability:read | provider's pitches |
| GET | `/channel/v1/availability?pitch_id&date` | availability:read | `[{start_at,end_at,available}]` — no PII |
| POST | `/channel/v1/blocks` | blocks:write | `{pitch_id,start_at,end_at,external_ref,source?,customer_name?}` → block (`409 SLOT_UNAVAILABLE` with `details.slot_ids` when any hour is taken — the write is rejected, so **no** conflict record or owner alert: nothing was double booked) |
| DELETE | `/channel/v1/blocks/{external_ref}` | blocks:write | cancel |

**Webhooks** (worker delivery, exponential backoff up to `WEBHOOK_MAX_ATTEMPTS`): events `slot.booked`, `slot.released`, `slot.blocked`,
`block.cancelled`; body `{id, event, occurred_at, pitch_id, start_at, end_at, status}`; header
`X-Pytch-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. Webhook URLs must be https + public (SSRF guard).

---

## Admin console — `/api/v1/admin` (module `admin`) — separate origin `:8090`

### Auth (no self-signup; bootstrap with `python -m app.cli create-admin`)
| Method | Path | Body | Response / notes |
|---|---|---|---|
| POST | `/admin/auth/login` | `{email, password}` | `AdminLoginResponse` — generic `401 INVALID_CREDENTIALS` (timing-equalised); `423 ACCOUNT_LOCKED` after 5 fails (15 min); rate-limit per IP+email |
| POST | `/admin/auth/mfa/enroll/start` | `{mfa_token}` | `MfaEnrollStart` (only when not enrolled) |
| POST | `/admin/auth/mfa/enroll/confirm` | `{mfa_token, code}` | `AdminAuth` + `recovery_codes` (10, shown once) + cookies |
| POST | `/admin/auth/mfa/verify` | `{mfa_token, code? , recovery_code?}` | `AdminAuth` + cookies (code replay blocked; recovery code single-use) |
| POST | `/admin/auth/refresh` | cookie + `X-CSRF-Token` | `AdminAuth` (rotates) |
| POST | `/admin/auth/logout` | cookie + `X-CSRF-Token` | `{ok}` clears cookies, revokes session |
| POST | `/admin/auth/step-up` | `{code}` | `StepUpResponse` (5-min window) |
| GET | `/admin/auth/me` | – | `AdminMe` (`previous_login_at/ip` = the sign-in before the current one) |
| POST 🛡 | `/admin/auth/password` | `{current_password, new_password}` | `{ok}` (policy; revokes other sessions) |
| GET / DELETE | `/admin/auth/sessions[/{id}]` | – | `AdminSessionOut[]` / `204` |

Must-change-password and must-enroll-MFA states only allow the auth endpoints.

### Business endpoints (permission → see `admin/permissions.py`)
| Area | Endpoints |
|---|---|
| Analytics `analytics.view` | `GET /admin/analytics/overview?range` · `/timeseries?metric&range&granularity` · `/cohorts` · `/venues?range` · `/heatmap?range` · `/sports?range` |
| Players `users.*` | `GET /admin/users?q&status&limit&offset` · `GET /admin/users/{id}` · 🛡`POST /admin/users/{id}/status` (`SetUserStatus`; revokes sessions) · 🛡`POST /admin/users/{id}/wallet` (`WalletAdjust`) · 🛡`POST /admin/users/{id}/logout-all` |
| Providers `providers.*` | `GET /admin/providers?status&q` · `GET /admin/providers/{id}` (+ `application_venues[]` with the turf created from each) · 🛡`POST /admin/providers/{id}/review` · 🛡`POST /admin/providers/{id}/status` `{status: approved\|suspended, reason}` · 🛡`PATCH /admin/providers/{id}` · 🛡`POST /admin/providers/{id}/turfs` `{turf_ids}` (the provider's **complete** venue list — its venues missing from it are unassigned) · 🛡`POST /admin/providers/{id}/venues` `AdminCreateVenue` → 201 (onboard a venue — usually `application_index` of the application — with pitches + 14 days of slots; coordinates must be inside the service area; each application entry once, `409` otherwise) |
| Venues `venues.*` | `GET /admin/venues?q&provider_id&active` · `PATCH /admin/venues/{id}` · `PATCH /admin/pitches/{id}` `{is_active}` |
| Bookings `bookings.*` | `GET /admin/bookings?q&status&from&to` · `GET /admin/bookings/{id}` (lobby + members + payments + blocks/conflicts) · 🛡`POST /admin/bookings/{id}/cancel` (`AdminCancelBooking`) |
| Payments `payments.*` | `GET /admin/payments?status(created\|paid\|partially_refunded\|failed\|refunded\|cancelled)&provider&q&from&to` · `GET /admin/payments/{id}` → `AdminPaymentDetail` (refund history, `refundable_paise` = server cap, `seat_refunded_paise`) · 🛡`POST /admin/payments/{id}/refund` (`RefundRequest`; > `REFUND_DUAL_APPROVAL_PAISE` ⇒ `202 APPROVAL_REQUIRED`) · `GET /admin/payments/webhook-events` · `GET /admin/payments/reconciliation?date` · `GET /admin/wallet/transactions?user_id&kind` |
| Approvals `approvals.decide` | `GET /admin/approvals?status` · 🛡`POST /admin/approvals/{id}/approve` · 🛡`POST /admin/approvals/{id}/reject` `{note}` — **decider ≠ requester** (`403 SELF_APPROVAL`) |
| Settlements `payouts.*` | `GET /admin/settlements?status&provider_id` · 🛡`POST /admin/settlements/generate` · `GET /admin/settlements/{id}` · 🛡`POST /admin/settlements/{id}/approve` (approver ≠ generator) · 🛡`POST /admin/settlements/{id}/pay` (`PaySettlement`; payer ≠ approver; `manual_neft` needs the bank UTR/reference, 12–22 letters/digits) · 🛡`POST /admin/settlements/{id}/fail` (approved, or a paid `manual_neft` that bounced) · `GET /admin/settlements/{id}/export.csv` (`data.export`) |
| Coupons `coupons.*` | `GET /admin/coupons?q&active` · `POST /admin/coupons` · `PATCH /admin/coupons/{id}` · `POST /admin/coupons/{id}/disable` · `GET /admin/coupons/{id}/redemptions` |
| Catalog `catalog.manage` | `GET /admin/catalog/sports` · `PUT /admin/catalog/sports/{key}` (feeds `GET /meta` sports) |
| Broadcasts `broadcast.send` | `GET /admin/broadcasts` · `POST /admin/broadcasts/preview` → `{recipients}` · `POST /admin/broadcasts` (`url`: in-app path `/app…` or `/partner…`, segments `[A-Za-z0-9_-]`, optional `?query`; `//`, `..`, `\` rejected → 422 on `url`) |
| Settings `settings.*` | `GET /admin/settings` · 🛡`PUT /admin/settings/{key}` `{value}` (kill switches: `bookings_enabled`, `signups_enabled`, `partner_signups_enabled`, `maintenance_banner`; rules: split window, sub discount, SOS window, rain cover/bonus, default commission, refund dual-approval threshold) |
| Audit `audit.view` | `GET /admin/audit?actor&action&target_type&target_id&from&to` · `GET /admin/audit/target-types` · `GET /admin/audit/verify` |
| Team `admins.manage` | `GET /admin/team` · 🛡`POST /admin/team` → `CreatedAdmin` · 🛡`PATCH /admin/team/{id}` `{role?, is_active?}` (cannot remove last super_admin or self) · 🛡`POST /admin/team/{id}/reset-mfa` · 🛡`POST /admin/team/{id}/reset-password` → `{admin, temporary_password, sessions_revoked}` (super admin, never self; must change at next sign-in; MFA kept) · 🛡`POST /admin/team/{id}/revoke-sessions` |
| System | `GET /admin/system/health` (any admin) |

**Every mutating admin/partner endpoint writes an `audit_logs` entry in the same transaction** (hash-chained, DB-enforced append-only).

## Settlement maths (per provider, per period; booking payable once `end_at + SETTLEMENT_HOLD_HOURS` passed)
```
gross            = Σ pitch fee of confirmed/completed Pytch bookings at the provider's venues
refunds          = Σ refunds on those bookings borne by the venue (weather rain-checks are platform-borne → 0)
provider_disc    = Σ provider-funded share of coupon discounts on those bookings
adjustments      = Σ manual ± (admin, audited)
commission       = round(gross × commission_bps / 10000)
gst_on_comm      = round(commission × 18%)
tcs              = round((gross − refunds) × 0.5%)        (GST s.52)
tds              = round((gross − refunds) × 0.1%)        (s.194-O; 5% if no PAN)
net_payable      = gross − refunds − provider_disc + adjustments − commission − gst_on_comm − tcs − tds
```
Tax rates are config (`TCS_BPS`, `TDS_194O_BPS`, …) — confirm with a CA before go-live.
