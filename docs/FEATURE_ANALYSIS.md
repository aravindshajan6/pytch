# PYTCH — Deep Feature Analysis

> Sports turf discovery, booking and matchmaking for Kochi, Kerala.
> This document analyses the original handoff (`project_handoff.md`) plus the five
> differentiating features, and records the product/engineering decisions taken.

---

## 0. What changed vs. the handoff (and why)

| Area | Handoff | PYTCH decision | Why |
|---|---|---|---|
| Venue model | `turfs` has one `sport_type` | `turfs` (venue) → `pitches` (court/pitch with sport, format, price, indoor flag, camera) → `slots` | Real venues host 5s + 7s football, badminton courts and cricket nets under one roof. Indoor/outdoor and camera availability are per-pitch properties — both are needed for weather transfers and highlight reels. |
| Booking vs. lobby | Separate tables, loosely linked | Every booking owns exactly one **lobby** (the "match room"). Two payment modes: **Split** (all-or-nothing, 30 min) and **Full** (host fronts, joiners auto-reimburse host) | One mental model for users: *a match*. Both payment modes remove the "debt collector" role. |
| Money | unspecified | Integer **paise** everywhere, ₹ rounding to whole rupee per share | No float rounding bugs; Razorpay uses paise natively. |
| Refunds | unspecified | Instant **Pytch Credits** (wallet ledger) | Instant, zero-fee, keeps money in the ecosystem (retention), trivially auditable. |
| Payments | Razorpay | `PaymentProvider` abstraction: `mock` (demo, default) and `razorpay` (orders + checkout.js + HMAC-verified webhooks) | App fully works offline/demo; swap to live keys via env. |
| Background work | TTL only | Dedicated **worker** container (hold expiry, match completion, weather scans, recording processing, bench expiry) with Redis leader-lock | TTL enforcement must not depend on a user having a tab open. |
| Cross-module coupling | — | In-process **domain event bus** (`match.completed`, `member.dropped`, `sub.paid` …) | Ratings, highlights, bench and gamification react to lobby lifecycle without lobbies importing them. |
| Realtime | WS + Redis pub/sub | Kept. **Invalidation-style** events (`lobby.updated {reason}`) → clients refetch; chat messages carry payload | Per-viewer fields (eligibility, my membership) stay correct; no stale snapshot fan-out. |
| Weather | "hyper-local API" | **Open-Meteo** hourly forecast per turf coordinate (free, no key), Redis-cached 30 min | Real data from day one, no vendor lock-in. |

---

## 1. Core platform (from handoff)

### 1.1 Turf discovery
- **Stories:** find venues near me by sport; see price, distance, indoor/outdoor, camera; see where games are already forming.
- **Mechanics:** Haversine distance from user location (browser geolocation, fallback: Kochi centre / onboarding home area). Filters: sport, indoor, camera, text search; sort by distance/price/rating. `open_lobbies_count` on each venue drives FOMO ("3 games forming here").
- **UI:** split map (dark Leaflet tiles, glowing markers with price pills) + list; animated filter chips.

### 1.2 Real-time booking (concurrency critical)
- **Mechanic:** `SELECT … FROM slots WHERE id=:id FOR UPDATE NOWAIT`.
  - Lock can't be taken → `409 SLOT_LOCKED` ("someone is checking out this slot right now").
  - Slot not `available` → `409 SLOT_UNAVAILABLE`.
  - Otherwise slot → `held` with `held_until` (30 min split / 10 min full) in the same transaction that creates the booking + lobby.
- **Live availability:** each slot change is published to `pitch:<id>`; open slot grids flip state instantly (held slots pulse amber, booked go dark).
- **Edge cases:** a hold expires while the host is on the payment sheet → payment is rejected (`PAYMENT_WINDOW_CLOSED`) and anything captured is refunded to credits; double-submit is idempotent through the unique `(pitch_id,start_at)` slot row and single booking per slot.

### 1.3 Matchmaking / lobbies
- Public lobbies appear in the **Play** feed (sport, date, distance, skill band).
- **Quick Match** ranks joinable lobbies: soonest kickoff, distance, skill proximity (|my true skill − lobby average|), fill ratio (games about to fill rank higher, since joining them triggers confirmation).
- Waiting room: live seats filling in, payment progress ring, countdown, chat, invite link / QR / WhatsApp share, host tools (balance teams, kick unpaid, SOS).
- **Auto team balancing:** snake draft on true skill → two teams with minimal skill delta.

---

## 2. Feature 1 — Peer-Verified "True Skill" Ratings

**Problem:** self-rated "Pro" players flood competitive lobbies.

**Mechanics**
1. Match completes (slot end passed, lobby confirmed) → every attendee gets a **48 h rating window** and a notification.
2. Rate each teammate on **Skill**, **Fair Play**, **Reliability** (1–5), a **showed-up** toggle and up to 3 **tags** ("Clinical finisher", "Wall at the back", "Great passer", "Keeps it cool", "Always on time", "Engine", "Playmaker", "Safe hands").
3. **Anonymous:** API never exposes rater identity; per-match results reveal only in aggregate.
4. Aggregation (per dimension) — weighted Bayesian mean:
   `avg = (prior_mean·prior_w + Σ wᵢ·scoreᵢ) / (prior_w + Σ wᵢ)` with prior 3.0, prior weight 4.
   Rater weight `wᵢ = 0.5 + 0.5·credibility(rater)` where credibility grows with the rater's own ratings count and verified status. **Outlier dampening:** once a ratee has ≥5 ratings, a score deviating >2 from their current mean is weighted ×0.5 (limits revenge ratings / friend-boosting).
5. **True Skill (0–100):** `((0.6·skill + 0.2·fair + 0.2·rel) − 1) / 4 · 100`, shrunk toward 50 by confidence `min(1, n/10)`. No-shows reported by ≥2 teammates hit reliability with a 1-star synthetic rating.
6. **Tiers:** `rookie` (<3 ratings) → `regular` (<55) → `skilled` (55–70) → `elite` (70+).
7. **Verified Playmaker** badge — all must hold: ≥8 ratings from ≥5 distinct raters, skill ≥4.0, fair play ≥4.0, reliability ≥4.0, ≤1 no-show. Re-evaluated on every rating; can be lost.
8. **Gating:** hosts can set `min_true_skill` and/or `verified_only`; eligibility reasons are returned so the UI explains *why* you can't join ("Need True Skill 65 — you're 58").

**Abuse vectors handled:** only co-participants of a completed match can rate; one rating per (match, rater, ratee); self-rating impossible; rater-credibility weighting; outlier dampening; rating window closes.

**Retention hooks:** "rate your squad" XP (+15/rating), visible progress checklist toward Verified Playmaker, True Skill history sparkline, FIFA-style player card.

---

## 3. Feature 2 — Zero-Friction Split Payments

**Problem:** one person fronts ₹1,500 and chases 9 UPI transfers for two days.

**Mechanics — Split mode (all-or-nothing)**
1. Host picks slot → chooses *Split*, number of players N → slot **held for 30 minutes**.
2. Share = `ceil(total / N)` rounded up to the rupee (e.g. ₹1,500 / 10 = ₹150).
3. Waiting room shares a link; every member (host included) pays their exact share (credits apply first).
4. All N paid before the deadline → booking **confirmed**, slot **booked**, confetti, everyone notified.
5. Deadline passes → lobby **expired**, slot **released**, every captured share **auto-refunded to credits**. Nobody is out of pocket, nobody chases anyone.
6. Host escape hatch: **Cover remaining** — host pays the unpaid shares to lock the game before the timer runs out.

**Full mode (host fronts, auto-reimbursed)** — for public "open matches" booked days ahead: host pays the full amount, booking confirmed immediately; every player who later joins pays a share that is **credited to the host's wallet** automatically.

**Payment rails:** `mock` provider (built-in Pytch Pay sheet: UPI/Card/Netbanking simulation) or Razorpay (order → checkout.js → signature verify → webhook with HMAC + idempotency table). Both converge on one `on_payment_captured` code path.

**Edge cases:** late payment after expiry → refunded to credits; member leaves before confirmation → share refunded; joined-but-unpaid members hold a seat for max 10 min then are released; paise rounding surplus is kept by the venue (documented).

---

## 4. Feature 3 — "Ready to Sub" Live Bench

**Problem:** two players drop out 30 minutes before kick-off.

**Mechanics**
1. **Bench toggle**: solo player goes live with location, radius (default 5 km), sports and a duration (auto-off after 1–4 h so the bench never goes stale).
2. **SOS trigger:** (a) a paid member leaves a confirmed match within **6 h** of kickoff → automatic SOS; (b) host presses *SOS* manually.
3. **Dispatch:** all active benchers within radius (Haversine from bench location to turf), matching sport, not already in the lobby, eligible for the lobby's skill gate → `sos.new` push over WebSocket + notification.
4. **Offer:** the spot at **20% off** the share. First to accept gets a 5-minute reserved seat to pay; unpaid → seat released back to the SOS.
5. **Who pays the 20%?** The **dropout rule**: when a sub pays for a dropout's seat, the dropout is credited exactly what the sub paid (80% of their share). The 20% is the dropout's penalty — no platform subsidy required, and it disincentivises late drops.
6. Hosts see a live "**12 players on the bench within 5 km**" counter (fuzzed blips on a radar, never exact locations).

**Retention hooks:** "Hero Sub" XP (+150), Hero Sub badge, subs count on player card; radar animation that feels alive.

---

## 5. Feature 4 — Turf Camera Integration & Highlight Reels

**Mechanics**
1. Pitches with `has_camera` offer **Recorded match** at booking time (+ camera fee, split with everyone).
2. After the match the recording pipeline runs: `scheduled → processing → ready` (worker). Raw footage + thumbnail served from `/media`.
3. **Clip editor:** scrub the raw footage, drag a range (max 60 s), title + tags → a clip is a non-destructive `(start_s, end_s)` window over the source (media-fragment playback; no transcoding needed for MVP; a future transcoder can materialise clips).
4. **Pin up to 3 clips** to the player profile; public **Highlights feed** (trending = likes + views decayed by age); likes; views.

**Future:** partner-camera ingest API (RTMP → object storage), automatic goal detection, clip transcoding to vertical 9:16.

---

## 6. Feature 5 — Weather-Smart Rescheduling

**Mechanics**
1. Worker scans confirmed/forming lobbies on **outdoor** pitches starting in the next 48 h; fetches Open-Meteo hourly forecast (cached by rounded coordinates).
2. **Risk rule:** precipitation probability ≥ 60% *or* precipitation ≥ 2 mm/h in the slot window → alert. `≥ 80% or ≥ 5 mm` = *warning*, else *watch*.
3. Host + members get a weather alert; host gets **one-click options**:
   - **Transfer indoors:** alternatives = indoor pitches, same sport, within 10 km, free slot at the same kickoff (±1 h), sorted by distance with price delta. Pytch covers up to **₹200** price difference ("rain guarantee"); options above that aren't offered. Transfer atomically locks the new slot (`FOR UPDATE NOWAIT`), releases the old one, moves the lobby, and notifies everyone.
   - **Rain-check:** cancel with **100% refund as credits** to every payer + ₹25 "rain bonus" each.
   - **Dismiss** ("we'll play in the rain").
4. Slot grids show hourly rain probability chips so users avoid risky slots *before* booking.

---

## 7. Retention & engagement design

- **XP & levels** for playing (+100), hosting (+50), rating (+15 each), subbing (+150), clipping (+20). Level curve `xp_for(level) = 100·(level−1)²·… ` (see code).
- **Weekly streaks** (played at least once per ISO week) with streak flame on the dashboard.
- **Badges** (common → legendary): First Whistle, Hat-trick, Regular, Squad Leader, Hero Sub, Rain Dancer, Verified Playmaker, Fair Play Ace, Night Owl, Early Bird, Highlight Reel, Critic.
- **Leaderboards** (weekly XP, all-time True Skill).
- **Player card** — collectible FIFA-style card that improves as you play.
- **Real-time social proof** everywhere: seats filling live, bench counters, "games forming here" badges.
- **Nudges:** pending ratings, expiring payment windows, weather alerts, recordings ready.

## 8. KPIs to instrument
Lobby fill rate · split-payment completion rate within 30 min · time-to-confirm · SOS fill rate & time-to-fill · weather transfer vs rain-check ratio · ratings submitted per completed match · D7/D30 retention · weekly active players per turf.
