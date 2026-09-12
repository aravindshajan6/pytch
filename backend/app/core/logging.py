import logging
import re
import sys

from app.core.config import settings

_SECRET_QUERY = re.compile(r"([?&](?:token|access_token|refresh_token|code)=)[^&\s\"']+", re.IGNORECASE)


class RedactSecrets(logging.Filter):
    """Strip credentials from logged URLs (e.g. a stale client still sending `/ws?token=…`)."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "=" in message and _SECRET_QUERY.search(message):
            record.msg, record.args = _SECRET_QUERY.sub(r"\1[redacted]", message), ()
        return True


def configure_logging() -> None:
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
        stream=sys.stdout,
    )
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    for name in ("uvicorn.error", "uvicorn.access"):  # WebSocket handshakes are logged on uvicorn.error
        logging.getLogger(name).addFilter(RedactSecrets())


logger = logging.getLogger("pytch")
