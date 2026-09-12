"""Seed the demo world.

    python -m app.seed            # idempotent: skips when the demo user already exists
    python -m app.seed --reset    # TRUNCATE every table first, then seed

Demo logins (OTP code is returned by /auth/otp/request in demo mode):
    Arjun Menon  +919999900001   (main demo account)
    Diya Nair    +919999900002
"""

import argparse
import asyncio
import sys

from sqlalchemy import select, text

import app.db.models  # noqa: F401  (register mappers)
from app.core.database import SessionLocal, engine
from app.core.logging import configure_logging, logger
from app.core.redis import close_redis
from app.db.base import Base
from app.modules import register_event_handlers
from app.modules.users.models import User
from app.seed.builder import DEMO_PHONE, Seeder


async def truncate_all() -> None:
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


async def seed(reset: bool = False) -> dict[str, int] | None:
    if reset:
        await truncate_all()
        logger.info("seed: all tables truncated")
    async with SessionLocal() as db:
        if await db.scalar(select(User.id).where(User.phone == DEMO_PHONE)):
            logger.info("seed: demo data already present (%s) — skipping", DEMO_PHONE)
            return None
        summary = await Seeder(db).run()
    logger.info("seed: done %s", summary)
    return summary


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.seed", description="Seed PYTCH demo data")
    parser.add_argument("--reset", action="store_true", help="truncate all tables before seeding")
    args = parser.parse_args(argv)
    configure_logging()
    register_event_handlers()
    try:
        summary = await seed(reset=args.reset)
        if summary:
            print("✓ Seeded:", ", ".join(f"{k}={v}" for k, v in summary.items()))
            print("  Demo logins: Arjun Menon +919999900001 · Diya Nair +919999900002 (OTP shown in demo mode)")
        else:
            print("✓ Demo data already present — nothing to do (use --reset to rebuild)")
    finally:
        await asyncio.sleep(0.2)  # let post-commit realtime publishes flush
        await close_redis()
        await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
