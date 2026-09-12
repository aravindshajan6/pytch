# PYTCH: Research Brief for the Provider Portal and Admin Console

*Researched 2026-09-12. `[UNVERIFIED]` = not confirmed from a primary source. Tax and RBI items need sign-off from a CA or lawyer before launch.*

---

## 1. Venue partner apps: competitive audit

| Capability | Playo Partner | Hudle Partner | KheloMore Partner | Playtomic Manager | CourtReserve / Skedda |
|---|---|---|---|---|---|
| Calendar and slots, block, maintenance | Yes, add/block slots and schedule maintenance | Slot system | Create/block slots | Yes | Yes; Skedda has per-space buffers |
| Offline or walk-in entry | Tracks online vs offline | Yes | "Online and offline bookings from one dashboard" | Yes | Guest/drop-in |
| Pricing rules | Varies by court, time, day and sport, plus discounts | Dynamic coupons | Not stated | Simple or advanced rules (court × day × time) | Member tiers, packages |
| Memberships | Advances and renewals | Membership automation | Not stated | One-off to yearly, auto-billed | Yes |
| Staff roles | Front desk, accountant, owner/admin | Role-based | Not stated | Yes | Front desk, pro, director, owner |
| Reports | Revenue by sport, peak times, occupancy, GST invoices | Weekly sales, reconciliation | Daily/weekly/monthly revenue | Occupancy and cancellations | Utilisation dashboard |
| Payouts | "Track pending payouts" | Integrated UPI collection | "Instant settlements" (claimed) | Stripe Connect. Split shares paid out on payment; the booker's share **2 h after the match ends** | n/a |
| Commission | "Small commission per booking", % **undisclosed** | **0% commission** (SaaS play) | Free listing, % **undisclosed** | SaaS plan plus a % fee on online payments | SaaS subscription |
| API | None public | None public | None public | **Read-only** bookings API (GET only, 3-month history) | API, webhooks (Skedda), iCal feeds |

Sources: [Playo Partner blog](https://blog.playo.co/playo-partner-app/), [Hudle list-your-venue](https://www.hudle.in/list-your-sports-venue), [KheloMore Partner (Play Store)](https://play.google.com/store/apps/details?id=com.khelomore.pnp.vendor), [TurfTown Venue Manager](https://play.google.com/store/apps/details?id=com.turftown_vm&hl=en_IN), [Playtomic pricing rules](https://helpmanager.playtomic.com/hc/en-gb/articles/20534703609745-Club-Membership-Feature), [Playtomic payments](https://helpmanager.playtomic.com/hc/en-gb/articles/20534669386641-The-Payments-Section), [Playtomic API](https://third-party.playtomic.io/endpoints/bookings/), [CourtReserve features](https://courtreserve.com/features/), [Skedda features](https://www.skedda.com/features).

Indian commission percentages are not published. Local anecdote puts them at about 5–15% `[UNVERIFIED]`. Owners resent paying commission on repeat customers they already have ([Cuetronix/Clutchr](https://clutchr.in/blog/turf-business-profitability-guide)).

### Prioritised provider-portal checklist

- **Must-have (v1):** day/week grid per pitch; one-tap walk-in, phone or WhatsApp entry tagged by channel; block and maintenance slots (including recurring); pricing rules (base, time bands, weekday/weekend, holiday overrides, per sport and pitch); booking list with payment and split status; settlement statements and invoices; staff roles (Owner, Manager, Front-desk, Accountant); push/WhatsApp alerts for new, cancelled and rescheduled bookings; reviews with replies; revenue and occupancy reports.
- **Should-have:** recurring team bookings and memberships; venue-funded coupons; per-pitch iCal export/import; customer CRM (repeat players, notes, blocklist); multi-venue accounts; weather-cancellation flow.
- **Later:** equipment rental/POS; dynamic pricing; partner REST API and webhooks; tournaments and leagues; white-label venue website.

---

## 2. Keeping bookings consistent across channels

**Current practice.** None of Playo, Hudle or KheloMore publishes a partner API, iCal feed or channel-manager integration `[UNVERIFIED: none found]`. Owners avoid double bookings by hand: they block slots in each app, or keep one app as their master calendar and treat the others as secondary. Playtomic's API is read-only.

**How other industries do it:**
- **iCal (RFC 5545) is pull-only and slow, so use it for visibility, not conflict prevention.** Google Calendar refreshes subscribed feeds every 8–12 h, up to 24 h ([CourtReserve](http://help.courtreserve.com/en/articles/11180356-calendar-feeds-from-courtreserve-for-system-users)); Skedda sees about 4 h ([Skedda](https://support.skedda.com/en/articles/105789-calendar-syncing)); Apple Calendar can do 5–15 min. Airbnb polls every 2–3 h, and iCal carries only dates ([Lodgify](https://www.lodgify.com/blog/airbnb-calendar-sync/)). RFC 7986 `REFRESH-INTERVAL` is only a SHOULD ([§5.7](https://datatracker.ietf.org/doc/html/rfc7986)).
- **Hotel channel managers push over two-way APIs.** SiteMinder pushes availability and rates at about 2-minute intervals and holds inventory locally when a push fails ([SiteMinder](https://www.siteminder.com/channel-manager/)).
- **Google Calendar push notifications** carry no event body; each one only triggers a fetch, and watch channels expire ([Google](https://developers.google.com/workspace/calendar/api/guides/push)).
- **Webhook practice:** HMAC-SHA256 over the raw body plus a timestamp, a 5-min tolerance, dedupe on event ID, fast acknowledgement with async processing, and a re-fetch of the authoritative object before acting ([Hooklistener](https://www.hooklistener.com/learn/stripe-webhook-security-guide)).

**Recommended architecture** (decisions are in the final section):
1. **PYTCH's database is the single source of truth.** Model each pitch-slot as a time range. The database enforces no overlap across confirmed bookings, payment holds (10-min TTL) and blocks.
2. **Manual quick-block** in the provider app (one tap, with an optional channel tag: Playo, Hudle, phone). In practice this is the main defence. Conflict window: however long the human takes, usually 1–5 min.
3. **Per-pitch iCal export.** Secret, rotatable, tokenised URL containing only busy blocks with stable UIDs and `STATUS:CANCELLED` on cancellation. For the owner's own view only.
4. **iCal import** from any feed the owner has, such as their Google Calendar "secret address". Poll every 5 min using conditional GET (ETag / If-Modified-Since). Store events as `external_block` rows keyed by source UID. Conflict window: poll interval plus source lag, about 5–15 min.
5. **Partner REST API** (later; for venue software and any OTA willing to integrate):
   - Per-venue scoped API keys, stored hashed.
   - An `Idempotency-Key` header on create, block and cancel.
   - HMAC-signed webhooks (`booking.created`, `booking.cancelled`, `block.created`) with timestamp and event ID.
   - Exponential-backoff retries for 72 h, plus a replay endpoint.
   - Near-real-time: seconds.
6. **Handling a conflict.** An imported block that overlaps a confirmed PYTCH booking is never dropped silently:
   - Alert the venue and PYTCH ops within about 1 min.
   - The booking that was confirmed first wins by default.
   - The venue gets a "Resolve" screen: keep the PYTCH booking and move the external one, or release it.
   - If the PYTCH booking is released, players get a one-tap alternative (another pitch or time nearby), an automatic full refund, and a goodwill credit.
   - Track an **overbooking rate per venue** for ranking and penalties.

---

## 3. Admin console security

Source standards:
- OWASP ASVS 5.0 (May 2025): [V6](https://asvs.dev/v5.0.0/V6-Authentication/), [V7](https://asvs.dev/v5.0.0/V7-Session-Management/), [V16](https://asvs.dev/v5.0.0/V16-Security-Logging-and-Error-Handling/)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- OWASP cheat sheets: [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238), [RFC 9700 §4.14](https://datatracker.ietf.org/doc/html/rfc9700)

**Checklist for FastAPI + React (target ASVS Level 2, plus the Level 3 items marked):**
- **Separate origin.** Serve the admin SPA from `admin.pytch.in` with its own API host or router, its own cookie and its own CORS allow-list. Never share cookies with the player app.
- **Sessions, not JWTs, for admin.** Opaque ID in `__Host-pytch_admin` (`Secure; HttpOnly; SameSite=Strict; Path=/`), stored server-side so it can be revoked instantly (ASVS 7.4.1–7.4.2). New ID at login and step-up (7.2.4). Idle 15 min, absolute 12 h, matching NIST AAL3 (AAL2 allows 24 h / 1 h). At most 2 concurrent sessions per admin (7.1.2).
- **CSRF:** SameSite=Strict, plus a required `X-CSRF-Token` header (signed double-submit, bound to the session), plus rejecting any `Sec-Fetch-Site` other than `same-origin`/`none` and checking `Origin`.
- **Mobile and provider tokens.** Short-lived access tokens (10–15 min). Rotate refresh tokens and revoke the whole token family if an old one is reused (RFC 9700).
- **Password hashing.** Argon2id with m=19 MiB, t=2, p=1, or m=46 MiB, t=1, p=1. Optional pepper kept in the secret manager. Minimum 12 characters (ASVS recommends 15). Check against breached-password lists (6.2.12).
- **TOTP MFA, mandatory for every admin (6.3.3).** Enrol at first login (QR code, then confirm one code). 30-s step, accept ±1 step, and store the last accepted step so no code is reused (RFC 6238 §5.2, ASVS 6.5.1). Seed encrypted with KMS. 10 single-use recovery codes, stored hashed. MFA reset needs a second super admin plus an out-of-band notice (6.3.7). Level 3: WebAuthn/passkeys for super admins.
- **Step-up re-auth** (fresh TOTP, valid 5 min; ASVS 7.5.1/7.5.3) before payouts or hold releases, refunds over ₹2,000 or any bulk refund, commission changes, venue bank-account changes, role changes, coupons with budget over ₹25k, and PII exports. **Four-eyes approval** for bank-account changes and bulk refunds.
- **Rate limiting and lockout:** Redis token bucket per account (5/min) and per IP (30/min); after 10 failures, exponential backoff up to 30 min, never a permanent lock; alert on lockout and on new-device logins.
- **Network:** put the admin behind Cloudflare Access or a zero-trust proxy with an IP allow-list, on top of MFA.
- **Audit log** (ASVS 16.3.1–16.4.2): append-only table where the app role has INSERT and SELECT only. A trigger rejects UPDATE/DELETE and TRUNCATE is revoked, because row triggers don't fire on TRUNCATE ([AppMaster](https://appmaster.io/blog/tamper-evident-audit-trails-postgresql)). Hash chain `row_hash = SHA-256(prev_hash ‖ canonical_json)`, with the daily chain head written to object-lock storage. Record actor, role, IP, user agent, action, target, before/after, reason and request ID. Erase PII by appending a redaction event.
- **Headers:** nonce-based strict CSP (`default-src 'self'; script-src 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`), HSTS preload, `nosniff`, `Referrer-Policy: no-referrer`.
- **RBAC** (deny by default and checked on the server for every endpoint):

| Role | Can | Cannot |
|---|---|---|
| Super admin (2 people) | Everything, role management, config | Act without step-up |
| Operations | Venues, onboarding, bookings, conflicts, games, SOS, weather reschedules | Commission, payouts, roles |
| Finance | Settlements, payout release or hold, refunds, invoices, tax reports | Edit venues or roles |
| Support | Look up users and bookings (PII masked), refunds up to ₹2,000, issue credits up to cap | Exports, payouts |
| Marketing | Coupons within budget, analytics | Individual PII, finance |
| Read-only / analyst | Dashboards | Any write |

---

## 4. Payments for a two-sided marketplace in India

- **Razorpay Route** ([docs](https://razorpay.com/docs/payments/route/), [transfers](https://razorpay.com/docs/payments/route/transfer-funds-to-linked-accounts/), [schedules](https://razorpay.com/docs/payments/route/schedule-settlement/), [reversals](https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/)): each venue is a Linked Account (24-h cooling period after creation). Transfers go via Orders, Payments or directly. A transfer with `on_hold_until` settles the day after the hold lifts; with no date it is held indefinitely. Linked-account settlement defaults to T+2 and can't be faster than the main account. `reverse_all` on a refund claws the money back from the venue, but not for partial refunds spread over several transfers (use the Reversal API).
  - **Eligibility risk:** since the RBI Payment Aggregator rules of September 2025, Route needs turnover above ₹40 lakh (GSTR-3B) in FY25 or FY26 and a written payer-payee transparency confirmation. A new startup may not qualify yet `[confirm with Razorpay]`.
- **Refunds** ([API](https://razorpay.com/docs/api/refunds/create-normal/)): full or partial; `speed=normal` takes 5–7 working days, `optimum` is instant where possible; allowed only within 6 months of payment; the unique `receipt` works as an idempotency key; statuses pending/processed/failed.
- **Settlement cadence.** Playtomic pays out immediately, and the booker's share 2 h after the match ends. KheloMore advertises "instant" settlement. **Recommendation for PYTCH:** hold each transfer until slot end + 24 h (the dispute and no-show window), which works out to about T+1–T+2 after play, with a weekly statement.
- **GST and TDS/TCS** (Kerala is intra-state):
  - **Commission** is PYTCH's own service to the venue: **18% GST** ([ClearTax](https://cleartax.in/s/gst-applicable-on-ecommerce-sale)). A player convenience fee is also PYTCH's supply at 18%.
  - **The turf booking** is the venue's supply. PYTCH does not collect this GST because Section 9(5) does not cover it. It is probably 18% under SAC 999652; the September 2025 cut to 5% for gyms and health clubs seems not to cover turfs `[UNVERIFIED]`.
  - **TCS (Section 52 CGST):** **0.5%** of the net taxable value (0.25% CGST + 0.25% SGST) since 10 July 2024. File GSTR-8 by the 10th of the following month ([TaxGuru](https://taxguru.in/goods-and-service-tax/cgst-e-commerce-operator-tcs-collection-rate-reduced-0-25-percent.html)). Applies to GST-registered venues.
  - **TDS (194-O, now Income-tax Act 2025 §393 from 1 April 2026):** **0.1%** of the *gross* amount. **5%** if the venue has not given a PAN. No TDS for an individual or HUF venue with PAN below ₹5 lakh a year ([Terra Insight](https://www.terra-insight.com/insights/section-194o-tds-0-1-percent-current-rate-history-india/)).
- **Wallet and credits: important risk.** RBI's **Draft PPI Directions (22 April 2026)** keep the closed-system exemption for "any entity *other than a marketplace*". If they become final, PYTCH could not run a stored-value wallet without a PPI licence, and the directions also force refunds of balances on closed instruments ([Khaitan & Co](https://www.khaitanco.com/sites/default/files/2026-05/ERGO_RBI_PPI_12May2026.pdf); whether they are final by September 2026 is `[UNVERIFIED]`). Model credits as **promotional discounts, not stored value**: never purchasable, non-transferable, non-withdrawable, expiring, and funded by PYTCH. Send cash refunds **to the original payment source** only.

---

## 5. Coupons and promo codes

Best practice follows [Voucherify's validation rules and limits](https://support.voucherify.io/article/529-validation-rules-campaign-limits) and [Voucherify's stacking rules](https://support.voucherify.io/article/604-stacking-rules).

- **Campaign:** percent/flat, value, max-discount cap, minimum order, validity window with weekday and time bands, total budget (₹) and redemptions, per-user and per-day limits, first-booking-only, targeting (city/venue/sport/pitch/segment), `funded_by` (platform/venue/shared %), stackable flag and priority, status, creator.
- **Code** (many per campaign): public, or unique single-use.
- **Redemption:** code, user, booking, payment share, amount, funder amounts, status (reserved → committed → reversed), device ID, phone, payment fingerprint.
- **Rules:** reserve at checkout with a TTL, commit on capture, release on failure. A cancellation before play restores the use; a no-show does not. One coupon per payment share, plus credits. With split payments a coupon discounts only the redeemer's share, which keeps per-user limits simple. "First booking" = the verified phone has never had a captured booking.
- **Abuse prevention** ([Prelude](https://prelude.so/blog/prevent-promotion-abuse)): limits per OTP-verified phone, device ID and UPI VPA/card; velocity alerts (e.g. 20+ redemptions of one code in 10 min, or several accounts on one device); auto-stop when the budget runs out; unique codes for high-value offers.
- **Settlement effect:** a *platform-funded* discount does **not** reduce the venue payout (commission is on the pre-discount price and PYTCH absorbs the cost). A *venue-funded* discount lowers the venue's gross, and commission is on the discounted price. Each is its own statement line.

---

## 6. Admin analytics

Definitions follow [a16z's marketplace metrics](https://a16z.com/13-metrics-for-marketplace-companies/).

| Metric | Definition |
|---|---|
| GMV | Sum of captured booking value before discounts, minus refunds, per period |
| Take rate | (Commission + convenience fees − platform-funded discounts) ÷ GMV |
| Net revenue | Commission + fees − platform discounts − refund write-offs, excluding GST |
| Bookings | Confirmed bookings (captured payment), split by channel (app vs walk-in logged) |
| Utilisation | Booked hours ÷ bookable hours (opening hours − blocks), per pitch, venue, day part |
| Open-game fill rate | Games reaching the required player count by kickoff ÷ open games created |
| Split-payment completion | Bookings where every share was paid by the deadline ÷ split bookings |
| Cancellation / refund rate | Cancelled ÷ confirmed, split by who cancelled (player, venue, weather); refund ₹ ÷ GMV |
| D7 / D30 retention | Share of a signup-week (or first-booking-week) cohort with a booking or game in days 1–7 or 1–30 |
| Repeat rate | Share of users with 2 or more bookings within 30 days, and GMV retention per cohort |
| SOS fill rate / time | SOS requests filled ÷ raised; median minutes to fill |
| Weather reschedules | Weather-flagged cancellations and reschedules ÷ bookings, and ₹ refunded |
| Venue overbooking rate | Conflicts where a PYTCH booking was released ÷ PYTCH bookings, per venue |

---

## Recommendations for PYTCH

| Area | Decision |
|---|---|
| v1 provider portal | Grid calendar, quick-block and walk-in entry, pricing rules, 4 staff roles, settlement statements, alerts, reviews, basic reports |
| Source of truth | PYTCH's database, with overlap exclusion across bookings, holds and blocks; 10-min payment hold |
| Sync, v1 | Manual quick-block (conflict window about 1–5 min), per-pitch iCal export, iCal import polled every 5 min (about 5–15 min) |
| Sync, v2 | Partner API: hashed scoped keys, Idempotency-Key, HMAC webhooks with 5-min tolerance, 72-h retries; Google Calendar two-way sync |
| Conflict policy | Confirmed-first wins; alert within 1 min; resolve screen; auto-alternative plus refund plus credit; overbooking rate per venue |
| Admin authentication | Separate origin, server sessions in `__Host-` cookie, 15-min idle / 12-h absolute, mandatory TOTP with 10 recovery codes, Argon2id m=19 MiB t=2 p=1 |
| Sensitive actions | Step-up TOTP, four-eyes approval for bank-account changes and bulk refunds, hash-chained append-only audit log |
| Payouts | Route transfer per booking, held until slot end + 24 h, then about T+1–T+2; weekly statement. Confirm Route eligibility now; fallback `[TBD]` |
| Statement lines | Gross, venue-funded discount, platform discount (memo only), commission, 18% GST on commission, TCS 0.5%, TDS 0.1% (5% without PAN), refunds and reversals, adjustments, net |
| Venue tax fields | GSTIN (optional), PAN (mandatory), entity type, state, running TDS-threshold total |
| Credits | Promotional, non-withdrawable, expiring, platform-funded only; refunds to source; get a legal opinion on the draft PPI rules |
| Coupons | Campaign / Code / Redemption model with funder split; applies per payment share; per-phone, per-device and per-VPA limits plus velocity checks |
| North-star metrics | GMV, take rate, utilisation, open-game fill rate, D30 retention, venue overbooking rate |
