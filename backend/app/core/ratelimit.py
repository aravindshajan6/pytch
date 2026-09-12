"""Redis fixed-window rate limiting + client identification."""

import ipaddress
from functools import lru_cache

from fastapi import Request

from app.core.config import settings
from app.core.errors import RateLimited
from app.core.redis import get_redis


async def hit(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Count one hit. Returns (allowed, retry_after_seconds)."""
    redis = get_redis()
    full = f"pytch:rl:{key}"
    count = await redis.incr(full)
    if count == 1:
        await redis.expire(full, window_seconds)
    if count > limit:
        ttl = await redis.ttl(full)
        return False, max(int(ttl), 1)
    return True, 0


async def enforce(key: str, limit: int, window_seconds: int, message: str | None = None) -> None:
    allowed, retry_after = await hit(key, limit, window_seconds)
    if not allowed:
        raise RateLimited(message or f"Too many attempts — try again in {retry_after}s",
                          details={"retry_after": retry_after})


async def reset(key: str) -> None:
    await get_redis().delete(f"pytch:rl:{key}")


@lru_cache
def _trusted_networks() -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    return tuple(ipaddress.ip_network(c, strict=False) for c in settings.trusted_proxy_cidrs)


def _is_trusted_proxy(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _trusted_networks())


def client_ip(request: Request) -> str:
    """Client IP for rate limits, lockouts, audit and the admin allowlist. Forwarding headers are honoured
    only from a trusted proxy (nginx overwrites X-Real-IP with the real peer); anyone else is identified by
    the TCP peer address, so a spoofed header can't dodge limits or satisfy the allowlist."""
    peer = request.client.host if request.client else ""
    if peer and not _is_trusted_proxy(peer):
        return peer
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()[:64]
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return peer or "unknown"


def user_agent(request: Request) -> str:
    return (request.headers.get("user-agent") or "")[:300]
