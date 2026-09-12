#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "▶ running migrations"
  alembic upgrade head
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "▶ seeding demo data (idempotent)"
  python -m app.seed
fi

exec "$@"
