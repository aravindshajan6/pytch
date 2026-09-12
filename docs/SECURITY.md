# PYTCH — Security Model

Scope: player app, partner (venue) portal, admin console, Channel API. Research basis: `docs/research/PORTALS_RESEARCH.md` §3 (OWASP ASVS-aligned).

## 1. Identities & isolation
| | Players | Partners (venue staff) | Admins |
|---|---|---|---|
| Identity | `users` (phone OTP) | same `users` row + `provider_members` role | **separate** `admin_users` table |
| Factors | OTP (SMS in prod) | OTP | password (argon2id, 64 MiB, t=3) **+ mandatory TOTP** |
| Token audience / key | `app` / `JWT_SECRET` | `partner` / `JWT_SECRET` | `admin` / **`ADMIN_JWT_SECRET`** |
| Token storage (web) | localStorage `pytch-auth` | localStorage `pytch-partner-auth` | access token **in memory**; refresh in **httpOnly, SameSite=Strict** cookie + CSRF double-submit |
| Session | 60 min access / 30 d refresh | 30 min / 14 d | 15 min access · **15 min idle** · 12 h absolute |
| Origin | `:8080` `/app` | `:8080` `/partner` | **separate origin `:8090`**, loopback-bound, own CSP |

* Cross-audience tokens are rejected (JWT `aud` + `iss` verified; admin tokens signed with a different key).
* All sessions are server-side rows (`auth_sessions`): refresh tokens rotate on every use; **presenting a used refresh token revokes the session** (theft signal); revocation is immediate for access tokens (Redis marker).
* Suspended/banned players are rejected on every authenticated request.
* Every accepted access token must carry a session id (`sid`); session-less tokens are refused, so every token is revocable.
* OTP: per-phone (5 / 10 min), **per-IP** (20 / h — CGNAT-friendly) and **global** (300 / min) send limits — SMS-bombing and cost protection;
  per-IP verify limit (30 / 10 min) against code-spraying across phones; per-phone attempt counter.
* Player & partner web clients refresh under a **cross-tab Web Lock** and re-read storage first, so tabs sharing a
  rotating refresh token never trip reuse detection; logout/rotation propagates across tabs (`storage` event).
* `?next=` / `state.from` / notification links go through one open-redirect guard (`lib/safePath.ts`).

## 2. Admin console controls
- No self-signup; admins created via CLI (`python -m app.cli create-admin`) or by a super admin (temporary password, forced change + MFA enrollment on first login). A forgotten password is reset by another super admin (step-up, audited): a new temporary password shown once, forced change, all sessions revoked — the enrolled authenticator is kept (MFA has its own reset).
- Login: per-IP and per-email rate limits, lockout after 5 failures (15 min), generic errors, timing-equalised for unknown emails.
- TOTP (RFC 6238, ±1 step, **replay-blocked**), 10 single-use recovery codes (keyed hashes). TOTP seeds encrypted at rest (Fernet, `DATA_ENCRYPTION_KEY`).
- **RBAC** (least privilege): super_admin · ops · finance · support · marketing · read_only (`admin/permissions.py`).
- **Step-up re-authentication** (fresh TOTP ≤ 5 min) for refunds, payouts, wallet adjustments, settings, user/provider moderation, admin management, approvals, exports.
- **Maker–checker**: refunds above `REFUND_DUAL_APPROVAL_PAISE` (cumulative per seat), wallet credits that take a player's manual
  credits today above that threshold (or an admin's own unapproved grants today above 4× it — no splitting one big credit into
  small ones), provider bank-detail changes and settlement approvals require a *different* admin. Support additionally has
  daily caps (₹1,000 per player, ₹5,000 per support admin).
- **Tamper-evident audit log**: every admin/partner mutation is written in the same DB transaction to `audit_logs`, which is hash-chained (`hash = sha256(prev_hash ‖ row)`) and **append-only at the database level** (trigger blocks UPDATE/DELETE). `GET /admin/audit/verify` recomputes the chain.
- Network: nginx admin server allowlist (`ADMIN_ALLOW_CIDR`) + API allowlist (`ADMIN_IP_ALLOWLIST`); public origin returns 404 for `/api/v1/admin/*`; admin routes excluded from the public OpenAPI; docs disabled in production.
- Headers: strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `noindex`.

## 3. Partner portal controls
- Every query is scoped by the acting provider (`X-Provider-Id` → verified membership), never by client-supplied ids; staff can be scoped to specific venues; owner/manager/staff role checks.
- Pending/suspended providers can't operate. Bank-detail changes put payouts on hold until an admin approves.
- Player phone numbers are masked in partner views of Pytch bookings.

## 4. Channel sync / integrations
- API keys: shown once, stored as keyed HMAC (`API_KEY_PEPPER`), scoped, rate-limited, revocable, idempotency keys on writes.
- Webhooks: HMAC-SHA256 signatures with timestamp (`X-Pytch-Signature: t=…,v1=…`), secrets encrypted at rest, https-only public targets.
- iCal import: **SSRF-safe fetcher** (https only, DNS resolved and private/loopback/link-local/metadata ranges rejected, no unsafe redirects, 10 s timeout, 2 MB cap); feed URLs encrypted at rest. iCal export uses unguessable rotatable tokens and contains **no PII**.
- Consistency: every channel occupies inventory through the same `SELECT … FOR UPDATE NOWAIT` slot lock; external events never override Pytch bookings — they raise `sync_conflicts` (first confirmed wins).

## 5. Realtime (WebSocket `/ws`)
- The access token is sent as the second **subprotocol** (`Sec-WebSocket-Protocol: pytch.v1, <jwt>`) or an
  `Authorization` header — never in the URL, so it can't land in proxy/access logs.
- Each socket joins an internal `session:<sid>` channel: revoking a session (logout, reuse detection, suspension)
  **closes its sockets on every API instance immediately**; a 30 s watchdog re-checks revocation/suspension as a fallback,
  and every inbound op re-checks the revocation marker.
- Limits: 10 sockets per user, 50 channels per socket, 20 inbound messages / 10 s. Channel ACLs: `user:` own only,
  `lobby:` members only, `pitch:` active pitches only (partners: their own venues, staff venue-scoped).

## 6. Platform
- Production refuses to start with default/missing secrets (`JWT_SECRET`, `ADMIN_JWT_SECRET` (≠ JWT), `API_KEY_PEPPER`, `DATA_ENCRYPTION_KEY`),
  `DEMO_MODE=true`, `ADMIN_COOKIE_SECURE=false`, or non-https / localhost / `*` `CORS_ORIGINS`.
- Client IP (rate limits, lockouts, audit, admin allowlist) honours `X-Real-IP`/`X-Forwarded-For` **only from
  `TRUSTED_PROXY_CIDRS`**; uvicorn runs with `--no-proxy-headers`, so a direct caller can't spoof its address.
- Public weather proxy: service-area bounding box, yesterday…+7 days, coordinates snapped to a 0.05° grid (bounded
  cache keys) and per-IP rate limit.
- Media: gzip is skipped for `/media` and nginx forwards only single byte ranges (multi-range amplification blocked).
- Money is integer paise; payment capture is idempotent (one code path; webhook event de-duplication).
- Public CSP allows only the required third parties (OSM tiles, Unsplash images, Razorpay checkout).

## 7. Accepted risks & design decisions
- **Player/partner tokens in `localStorage`** (not httpOnly cookies). Mitigations: strict CSP with no inline scripts and
  no third-party script origins beyond Razorpay, React output escaping, URL-scheme validation on user-supplied links,
  short access-token lifetimes, rotating refresh tokens with reuse detection, instant revocation. Recommended at scale:
  move the refresh token to an httpOnly cookie (as the admin console does) and serve `/partner` from its own subdomain.
- **Admin login counts as a fresh step-up for 5 minutes**: the login itself required a TOTP code, so an immediate
  sensitive action doesn't prompt again. Every later sensitive action inside the session needs a new code.

## 8. Operational checklist before go-live
- [ ] HTTPS everywhere; `ADMIN_COOKIE_SECURE=true`; enable HSTS in `nginx/security-admin.conf`.
- [ ] Admin origin on its own subdomain behind VPN/IP allowlist; don't publish the API port (`:8000`).
- [ ] Rotate all secrets; store in a secret manager; back up `DATA_ENCRYPTION_KEY` (losing it = losing TOTP seeds / feed URLs).
- [ ] Real SMS OTP provider; `DEMO_MODE=false` (removes dev OTP codes and `/dev/*`).
- [ ] Daily off-site copy of the audit chain head (write-once storage); DB backups + restore drill.
- [ ] Error tracking (Sentry) and alerting on: login lockouts, refresh-reuse revocations, audit-chain verification failures, webhook/feed failures.
- [ ] Legal/tax review: TCS/TDS rates, wallet credits (keep promotional & non-withdrawable), GST on commission.
