# ⚽ PYTCH — Play more. Chase less.

Turf discovery, real-time booking and matchmaking for Kochi — with **split payments that nobody has to chase**, a **live bench of subs**, **peer-verified skill ratings**, **turf-camera highlight reels** and **weather-smart rescheduling**.

| | |
|---|---|
| **Frontend** | React 19 · TypeScript · Vite 7 · Tailwind 4 · Motion · Three.js / React-Three-Fiber · anime.js · Leaflet · TanStack Query · Zustand |
| **Backend** | FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 · Redis 7 (pub/sub, cache, locks) · Alembic · Pydantic v2 |
| **Realtime** | WebSockets fanned out across API instances through Redis pub/sub |
| **Payments** | Provider abstraction — built-in mock checkout (default) or Razorpay (orders, checkout.js, HMAC-verified webhooks) |
| **Weather** | Open-Meteo hourly forecasts (free, no key) |
| **Ops** | Docker Compose: `web` (nginx) · `api` · `worker` · `db` · `redis` |

---

## 🚀 Quick start

```bash
cp .env.example .env        # defaults work out of the box
docker compose up -d --build   # or: make up
```

Open **http://localhost:8080**. The API runs migrations and seeds demo data on first start (≈20–40 s).

- API docs (Swagger): http://localhost:8000/api/v1/docs
- Health: http://localhost:8000/health

### Demo accounts
| Who | Phone | OTP |
|---|---|---|
| Arjun Menon (main demo player) | `+91 99999 00001` | `123456` |
| Diya Nair | `+91 99999 00002` | `123456` |

Any other phone number works too — in demo mode the OTP is shown on screen.

### 5-minute demo tour
1. **Log in** with *Try the demo account*.
2. **Discover** → open a turf → pick a slot → **Book → Split** with 10 players. You land in the waiting room with a 30:00 countdown.
3. Pay your share (Pytch Pay mock checkout), then open **Demo controls → Fill with bots** and watch seats fill and pay live. The match confirms with confetti once everyone has paid.
4. **Demo controls → Simulate dropout** → an SOS goes out to the **Bench**. Log in as Diya in another browser, go on the bench, and accept the 20%-off seat.
5. **Demo controls → Simulate storm** → weather alert → **Move indoors** (one click, atomic slot transfer) or **Rain-check** (100% credits + bonus).
6. **Demo controls → Fast-forward to full time** → **Rate teammates** (anonymous, Bayesian True Skill) → recording appears in **Highlights** → clip your moment and pin it to your player card.

---

## 🧠 Docs
- [`docs/FEATURE_ANALYSIS.md`](docs/FEATURE_ANALYSIS.md) — product deep-dive: mechanics, edge cases, abuse vectors and KPIs for every feature
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, state machines, module boundaries, domain events
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — every REST endpoint and the WebSocket protocol
- [`frontend/src/types/api.ts`](frontend/src/types/api.ts) — canonical JSON contract

## 🗂️ Repository layout
```
pytch/
├── docker-compose.yml     full stack
├── Makefile               dev shortcuts (make help)
├── docs/                  analysis · architecture · API contract
├── backend/               FastAPI service (own Dockerfile, README)
│   ├── app/core           config, db, redis, security, errors, event bus, geo, time
│   ├── app/realtime       WebSocket endpoint + Redis fan-out
│   ├── app/modules/<m>    auth · users · turfs · slots · bookings · lobbies · payments · wallet
│   │                      ratings · bench · highlights · weather · notifications · gamification · dev
│   ├── app/seed           idempotent demo data
│   ├── app/worker.py      background jobs
│   ├── alembic/           migrations
│   └── tests/
└── frontend/              React SPA (own Dockerfile + nginx, README)
    └── src/{app,components,features,lib,stores,hooks,types}
```
`backend/` and `frontend/` are independent projects (each with its own Dockerfile, dependencies and README), so they can live in separate repositories. The root compose file wires them together.

## 🛠️ Local development (hot reload)
```bash
make infra                                   # Postgres :5433 + Redis :6380
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
make api                                     # FastAPI on :8000 (migrates first)
make worker                                  # background jobs
cd backend && .venv/bin/python -m app.seed   # demo data
cd frontend && npm install && npm run dev    # Vite on :5173 (proxies /api, /ws, /media)
```

## ✅ Quality
```bash
make test        # pytest against real Postgres/Redis
make lint        # ruff + eslint
make typecheck   # tsc
```

## 💳 Going live with Razorpay
Set in `.env`: `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and point a Razorpay webhook (`payment.captured`) at `https://<your-host>/api/v1/payments/webhooks/razorpay`. Also set `DEMO_MODE=false` and a strong `JWT_SECRET`.
