.PHONY: help up down logs ps build reseed infra api worker web seed test lint typecheck migrate migration

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ── Full stack (Docker) ─────────────────────────────────────────
up: ## Build and start the whole stack → http://localhost:8080
	docker compose up -d --build
	@echo "\n  PYTCH is starting → http://localhost:8080  (API docs: http://localhost:8000/api/v1/docs)\n"

down: ## Stop the stack (keeps data)
	docker compose down

logs: ## Tail logs
	docker compose logs -f --tail=100

ps: ## Service status
	docker compose ps

build: ## Rebuild images
	docker compose build

reseed: ## Wipe and re-create demo data
	docker compose exec api python -m app.seed --reset

# ── Local development ───────────────────────────────────────────
infra: ## Start only Postgres + Redis for local dev
	docker compose up -d db redis

api: ## Run the API with hot reload (needs `make infra`)
	cd backend && .venv/bin/alembic upgrade head && DEMO_MODE=true .venv/bin/uvicorn app.main:app --reload --port 8000

worker: ## Run the background worker locally
	cd backend && DEMO_MODE=true .venv/bin/python -m app.worker

seed: ## Seed demo data locally (demo mode only)
	cd backend && DEMO_MODE=true .venv/bin/python -m app.seed

web: ## Run the Vite dev server (proxies /api, /ws, /media → :8000)
	cd frontend && npm run dev

migrate: ## Apply migrations locally
	cd backend && .venv/bin/alembic upgrade head

migration: ## Autogenerate a migration: make migration m="message"
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(m)"

# ── Quality ─────────────────────────────────────────────────────
test: ## Backend test suite
	cd backend && .venv/bin/pytest -q

lint: ## Lint backend + frontend
	cd backend && .venv/bin/ruff check app tests
	cd frontend && npx eslint src

typecheck: ## Frontend typecheck
	cd frontend && npx tsc -b --noEmit
