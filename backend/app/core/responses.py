"""orjson-backed JSON response (fast, and serialises datetimes / UUIDs in error details natively).

Our own class rather than `fastapi.responses.ORJSONResponse`, which FastAPI deprecated.
"""

from typing import Any

import orjson
from fastapi.responses import JSONResponse


class ORJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_NON_STR_KEYS)
