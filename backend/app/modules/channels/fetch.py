"""SSRF-safe outbound HTTP for iCal imports and webhook deliveries.

Rules for every URL we fetch or post to on behalf of a venue:
  * https only (``webcal://`` is rewritten to https), no userinfo, ports 443/8443 only;
  * the host must resolve exclusively to public unicast addresses — loopback, private (RFC 1918 / ULA),
    link-local (incl. the 169.254.169.254 metadata service), CGNAT, multicast and reserved ranges are rejected;
  * the connection is pinned to the validated IP (custom network backend re-checks at connect time, so a DNS
    rebind between validation and connect doesn't help an attacker); TLS still verifies the original hostname;
  * redirects are followed manually (max 3) and every hop is re-validated;
  * 10 s overall timeout, 2 MB body cap (after decompression), no environment proxies.

Tests can install a fake resolver/transport via `install_test_hooks` (only when ENVIRONMENT=test).
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpcore
import httpx

from app.core.config import settings
from app.core.errors import AppError

MAX_BYTES = 2 * 1024 * 1024
TIMEOUT_SECONDS = 10.0
ALLOWED_PORTS = frozenset({443, 8443})
MAX_REDIRECTS = 3
USER_AGENT = "PytchChannelSync/1.0 (+https://pytch.in/partners)"
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa", ".lan")


class UnsafeUrl(AppError):
    code, status_code, message = "VALIDATION_ERROR", 400, "That URL isn't allowed"


class FetchError(Exception):
    """Upstream problem (HTTP error, timeout, too large…). `str(exc)` is safe to show to the venue."""


Resolver = Callable[[str, int], Awaitable[list[str]]]


async def _system_resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


_resolver: Resolver = _system_resolve
_test_transport: httpx.AsyncBaseTransport | None = None


def install_test_hooks(*, resolver: Resolver | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
    """Replace DNS resolution / the HTTP transport. Refuses to run outside the test environment."""
    global _resolver, _test_transport
    if not settings.is_test:
        raise RuntimeError("fetch test hooks are only available when ENVIRONMENT=test")
    if resolver is not None:
        _resolver = resolver
    _test_transport = transport


def reset_test_hooks() -> None:
    global _resolver, _test_transport
    _resolver, _test_transport = _system_resolve, None


# ─────────────────────────── validation ───────────────────────────


def is_public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        mapped = ip.ipv4_mapped or ip.sixtofour or (ip.teredo[1] if ip.teredo else None)
        if mapped is not None:
            ip = mapped
    return bool(
        ip.is_global
        and not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
                 or ip.is_unspecified)
    )


@dataclass(frozen=True)
class SafeUrl:
    url: str
    host: str
    port: int


def parse_https_url(raw: str) -> SafeUrl:
    """Syntactic checks only (scheme, credentials, port, obviously-internal host names)."""
    url = (raw or "").strip()
    if not url or len(url) > 2000:
        raise UnsafeUrl("Enter a valid https:// URL")
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    try:
        parts = urlsplit(url)
        port = parts.port or 443
    except ValueError as exc:
        raise UnsafeUrl("Enter a valid https:// URL") from exc
    if parts.scheme.lower() != "https":
        raise UnsafeUrl("Only https:// URLs are allowed")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise UnsafeUrl("URLs with embedded credentials aren't allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeUrl("Enter a valid https:// URL")
    if port not in ALLOWED_PORTS:
        raise UnsafeUrl("Only the standard https port is allowed")
    if host == "localhost" or host.endswith(_BLOCKED_SUFFIXES) or "." not in host and ":" not in host:
        raise UnsafeUrl("URL must point to a public internet address")
    normalized = urlunsplit(("https", parts.netloc.lower(), parts.path or "/", parts.query, ""))
    return SafeUrl(url=normalized, host=host, port=port)


async def resolve_public(host: str, port: int) -> list[str]:
    """Resolve `host` and require every address to be public. Returns the addresses."""
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not is_public_ip(str(literal)):
            raise UnsafeUrl("URL must point to a public internet address")
        return [str(literal)]
    try:
        ips = await asyncio.wait_for(_resolver(host, port), timeout=5)
    except (OSError, TimeoutError, UnicodeError) as exc:
        raise UnsafeUrl("Couldn't resolve that host name") from exc
    if not ips or not all(is_public_ip(ip) for ip in ips):
        raise UnsafeUrl("URL must point to a public internet address")
    return ips


async def validate_public_url(raw: str) -> str:
    """Full SSRF check (syntax + DNS). Returns the normalised URL."""
    safe = parse_https_url(raw)
    await resolve_public(safe.host, safe.port)
    return safe.url


def url_hint(url: str) -> str:
    """Non-secret display form: host + last path segment (feed URLs embed secret tokens)."""
    parts = urlsplit(url)
    last = (parts.path.rstrip("/").rsplit("/", 1)[-1] or "")[:24]
    return f"{parts.hostname or ''}/…/{last}"[:80]


# ─────────────────────────── transport ───────────────────────────


class _PinnedBackend(httpcore.AsyncNetworkBackend):
    """Resolves + validates at connect time and connects to the vetted IP (defeats DNS rebinding)."""

    def __init__(self) -> None:
        self._inner = httpcore.AnyIOBackend()

    async def connect_tcp(self, host: str, port: int, timeout: float | None = None,  # noqa: ASYNC109
                          local_address: str | None = None, socket_options: Any = None) -> httpcore.AsyncNetworkStream:
        try:
            ips = await resolve_public(host, port)
        except UnsafeUrl as exc:
            raise httpcore.ConnectError(f"blocked destination: {exc.message}") from exc
        last: Exception | None = None
        for ip in ips[:4]:
            try:
                return await self._inner.connect_tcp(ip, port, timeout=timeout, local_address=local_address,
                                                     socket_options=socket_options)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last = exc
        raise last or httpcore.ConnectError("connection failed")

    async def connect_unix_socket(self, path: str, timeout: float | None = None,  # noqa: ASYNC109
                                  socket_options: Any = None) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def _client() -> httpx.AsyncClient:
    if _test_transport is not None:
        transport: httpx.AsyncBaseTransport = _test_transport
    else:
        http_transport = httpx.AsyncHTTPTransport(retries=0)
        # httpx 0.28 doesn't expose the network backend; swap the (private) pool for a pinned one.
        http_transport._pool = httpcore.AsyncConnectionPool(  # noqa: SLF001
            ssl_context=httpx.create_ssl_context(),
            max_connections=10,
            network_backend=_PinnedBackend(),
        )
        transport = http_transport
    return httpx.AsyncClient(
        transport=transport,
        timeout=httpx.Timeout(TIMEOUT_SECONDS),
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": USER_AGENT},
    )


@dataclass
class FetchResult:
    status: int
    body: bytes
    etag: str | None
    not_modified: bool = False


async def safe_get(url: str, *, etag: str | None = None, max_bytes: int = MAX_BYTES) -> FetchResult:
    """GET with SSRF protection, manual redirect validation, size cap and conditional request."""
    current = url
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS), _client() as client:
            for _ in range(MAX_REDIRECTS + 1):
                safe = parse_https_url(current)
                await resolve_public(safe.host, safe.port)  # early, friendly error (backend re-checks)
                headers = {"Accept": "text/calendar, text/plain;q=0.8, */*;q=0.5"}
                if etag:
                    headers["If-None-Match"] = etag
                async with client.stream("GET", safe.url, headers=headers) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            raise FetchError("Redirect without a location")
                        current = urljoin(safe.url, location)
                        continue
                    if resp.status_code == 304:
                        return FetchResult(304, b"", etag, not_modified=True)
                    if resp.status_code != 200:
                        raise FetchError(f"The calendar server answered HTTP {resp.status_code}")
                    declared = resp.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > max_bytes:
                        raise FetchError("Calendar is larger than 2 MB")
                    buf = bytearray()
                    async for chunk in resp.aiter_bytes():
                        buf += chunk
                        if len(buf) > max_bytes:
                            raise FetchError("Calendar is larger than 2 MB")
                    return FetchResult(200, bytes(buf), resp.headers.get("etag"))
            raise FetchError("Too many redirects")
    except TimeoutError as exc:
        raise FetchError("The calendar server took too long to answer") from exc
    except httpx.HTTPError as exc:
        raise FetchError(f"Couldn't reach the calendar server ({type(exc).__name__})") from exc


async def safe_post(url: str, body: bytes, headers: dict[str, str]) -> int:
    """POST (webhooks). Redirects are not followed. Returns the status code; raises FetchError/UnsafeUrl."""
    safe = parse_https_url(url)
    await resolve_public(safe.host, safe.port)
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS), _client() as client:
            resp = await client.post(safe.url, content=body, headers=headers)
            return resp.status_code
    except TimeoutError as exc:
        raise FetchError("Timed out") from exc
    except httpx.HTTPError as exc:
        raise FetchError(f"Connection failed ({type(exc).__name__})") from exc
