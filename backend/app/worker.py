"""Background worker: runs periodic jobs owned by feature modules.

    python -m app.worker

Each job is `async def job(db: AsyncSession) -> int | None` living in `app/modules/<m>/jobs.py`.
The job commits its own work and returns the number of items processed (for logging).
A Redis `SET NX EX` lock guarantees a job runs at most once per interval across worker replicas.
"""

import asyncio
import importlib
import signal
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import app.db.models  # noqa: F401
from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.core.logging import configure_logging, logger
from app.core.redis import close_redis, get_redis
from app.core.timeutils import utcnow
from app.modules import register_event_handlers


@dataclass(frozen=True)
class JobSpec:
    target: str  # "module.path:function"
    every_seconds: int


JOBS: list[JobSpec] = [
    JobSpec("app.modules.slots.jobs:generate_rolling_slots", 3600),
    JobSpec("app.modules.lobbies.jobs:expire_holds", 15),
    JobSpec("app.modules.lobbies.jobs:complete_finished_matches", 60),
    JobSpec("app.modules.bench.jobs:expire_bench_and_sos", 30),
    JobSpec("app.modules.highlights.jobs:process_recordings", 20),
    JobSpec("app.modules.weather.jobs:scan_upcoming", 900),
    JobSpec("app.modules.channels.jobs:import_ical_feeds", 60),
    JobSpec("app.modules.channels.jobs:deliver_webhooks", 10),
    JobSpec("app.modules.settlements.jobs:auto_generate_drafts", 3600),
    JobSpec("app.modules.users.jobs:lift_lapsed_suspensions", 60),
]


def _resolve(target: str) -> Callable[..., Awaitable[int | None]] | None:
    module_path, _, fn_name = target.partition(":")
    try:
        return getattr(importlib.import_module(module_path), fn_name)
    except (ImportError, AttributeError):
        logger.warning("worker: job %s not found — skipping", target)
        return None


async def _run_job(spec: JobSpec, fn: Callable[..., Awaitable[int | None]]) -> None:
    lock_key = f"pytch:job:{spec.target}"
    if not await get_redis().set(lock_key, "1", nx=True, ex=max(spec.every_seconds - 1, 1)):
        return
    started = time.perf_counter()
    try:
        async with SessionLocal() as db:
            processed = await fn(db)
        # last-run marker per job → admin System health
        await get_redis().set(f"pytch:job-last:{spec.target}", utcnow().isoformat(), ex=7 * 86400)
        if processed:
            logger.info("job %s processed=%s in %.0fms", spec.target, processed,
                        (time.perf_counter() - started) * 1000)
    except Exception:
        logger.exception("job %s failed", spec.target)


async def _loop(spec: JobSpec, stop: asyncio.Event) -> None:
    fn = _resolve(spec.target)
    if fn is None:
        return
    while not stop.is_set():
        await _run_job(spec, fn)
        try:
            await asyncio.wait_for(stop.wait(), timeout=spec.every_seconds)
        except TimeoutError:
            pass


async def _heartbeat(stop: asyncio.Event) -> None:
    """Liveness marker read by GET /admin/system/health."""
    while not stop.is_set():
        await get_redis().set("pytch:worker:heartbeat", utcnow().isoformat(), ex=120)
        try:
            await asyncio.wait_for(stop.wait(), timeout=30)
        except TimeoutError:
            pass


async def main() -> None:
    configure_logging()
    register_event_handlers()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    logger.info("%s worker up — %d jobs", settings.app_name, len(JOBS))
    await asyncio.gather(_heartbeat(stop), *(_loop(spec, stop) for spec in JOBS))
    await close_redis()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
