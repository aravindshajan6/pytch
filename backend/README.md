# PYTCH API (backend)

FastAPI · SQLAlchemy 2 (async, asyncpg) · PostgreSQL 16 · Redis 7 · Alembic · Pydantic v2.
Stateless API + a background worker. Designed to run behind the `web` nginx (same origin), but works standalone.

## Run
```bash
# infra (from repo root): docker compose up -d db redis   → Postgres :5433, Redis :6380
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed            # idempotent demo data (--reset to rebuild)
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m app.worker          # periodic jobs
```
Swagger: http://localhost:8000/api/v1/docs · Health: `/health`

Docker: `docker build -t pytch-api .` — the entrypoint runs migrations when `RUN_MIGRATIONS=true` and seeds when `SEED_ON_START=true`; the same image runs the worker with `python -m app.worker`.

## Layout
```
app/
  core/        config (env vars), database, redis, security (JWT), errors, deps, events (domain bus),
               geo (haversine), timeutils (IST), codes, pagination, constants
  db/          declarative Base + model registry for Alembic
  realtime/    /ws endpoint, Redis PSUBSCRIBE fan-out, publish_on_commit
  modules/     one package per feature: models · schemas · service · router · handlers · jobs
    auth users turfs slots bookings lobbies payments wallet
    ratings bench highlights weather notifications gamification dev meta
  seed/        demo data builder
  worker.py    job scheduler (Redis-locked, replica-safe)
media/         demo footage (CC BY-SA — see media/README.md) + thumbnails, served at /media
tests/         pytest suites against real Postgres/Redis
```
Design rules, state machines and cross-module interfaces: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Key mechanisms
- **Double-booking prevention** — `slots.service.lock_slot`: `SELECT … FOR UPDATE NOWAIT` → `409 SLOT_LOCKED` when another checkout holds the row.
- **Split payments** — all-or-nothing within 30 min; one idempotent `payments.service.capture` path for mock, Razorpay verify and Razorpay webhooks (HMAC + `webhook_events` dedupe). Refunds are instant Pytch Credits.
- **Realtime** — services queue events with `publish_on_commit`; each API instance fans Redis messages out to its WebSockets.
- **Domain events** — `lobby.confirmed`, `match.completed`, `member.dropped`, `sub.paid`, … decouple ratings / bench / highlights / weather / gamification from lobbies.
- **Worker jobs** — rolling slot generation, hold/seat expiry, match completion, SOS/bench expiry, recording pipeline, weather scans (Open-Meteo, Redis-cached).

## Configuration (env)
| Var | Default | |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://pytch:pytch@localhost:5433/pytch` | |
| `REDIS_URL` | `redis://localhost:6380/0` | |
| `JWT_SECRET` | dev value | **change in production** |
| `DEMO_MODE` | `true` | dev OTP codes, `/dev/*` demo controls |
| `PAYMENT_PROVIDER` | `mock` | or `razorpay` + `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` |
| `PUBLIC_WEB_URL` | `http://localhost:8080` | used for invite links |
| business rules | see `app/core/config.py` | split window, sub discount, SOS window, rain cover… |

## Tests
```bash
.venv/bin/pytest -q                 # uses pytch_test DB + Redis db 15 (created by the compose init script)
.venv/bin/ruff check app tests
```
Coverage includes concurrent double-booking, split/full payment lifecycles, expiry refunds, dropout credits, Razorpay signatures/webhooks, rating aggregation maths, SOS dispatch/accept, weather classification & transfers, highlights rules, leaderboards.

## Migrations
`alembic revision --autogenerate -m "..."` then `alembic upgrade head` (or `make migration m="..."` from the root).
