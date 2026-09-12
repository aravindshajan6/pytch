"""Pure-ASGI middleware: hardening headers on every `/api/v1/admin/*` response (errors included)."""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings

_HEADERS = [
    (b"cache-control", b"no-store"),
    (b"pragma", b"no-cache"),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cross-origin-resource-policy", b"same-origin"),
]


class AdminSecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.prefix = f"{settings.api_prefix}/admin"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.prefix):
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                names = {k.lower() for k, _ in message.get("headers", [])}
                extra = [(k, v) for k, v in _HEADERS if k not in names]
                if settings.admin_cookie_secure:
                    extra.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

        await self.app(scope, receive, send_with_headers)
