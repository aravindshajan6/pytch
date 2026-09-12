"""Platform (runtime settings, sports catalog, broadcasts) schemas — mirror `frontend/src/types/admin.ts`."""

import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field, field_validator

from app.core.schemas import InputSchema, Schema

SettingType = Literal["bool", "int", "money", "string"]
SettingValue = bool | int | str | None


class SettingOut(Schema):
    key: str
    value: SettingValue
    default: SettingValue
    type: SettingType
    label: str
    description: str
    updated_by: str | None
    updated_at: datetime | None


class SettingUpdate(InputSchema):
    value: Any = None  # type-checked against the registry in the service


class SportCatalogOut(Schema):
    key: str
    label: str
    emoji: str
    formats: list[str]
    is_active: bool
    sort_order: int


class SportCatalogInput(InputSchema):
    key: str | None = Field(None, exclude=True)  # the path parameter wins; echoing it back is allowed
    label: str = Field(min_length=1, max_length=40)
    emoji: str = Field(min_length=1, max_length=8)
    formats: list[str] = Field(default_factory=list, max_length=12)
    is_active: bool = True
    sort_order: int | None = Field(None, ge=0, le=1000)  # omitted → keep the current position (new: last)


class BroadcastSegment(InputSchema):
    areas: list[str] | None = Field(None, max_length=50)
    sports: list[str] | None = Field(None, max_length=20)
    active_days: int | None = Field(None, ge=1, le=365)


# in-app paths only: /app or /partner, then plain path segments and an optional query string — never a
# protocol-relative `//host`, a `..` traversal or a backslash (open redirect via the notification link).
# Mirrored by BROADCAST_URL_RE in frontend/src/admin/pages/Broadcasts.tsx.
BROADCAST_URL_RE = re.compile(r"^/(app|partner)(/[A-Za-z0-9_\-]+)*/?(\?[^\s#]*)?$")


def broadcast_url_problem(url: str) -> str | None:
    if "//" in url or ".." in url or "\\" in url:
        return "The link can't contain '//', '..' or backslashes"
    if not BROADCAST_URL_RE.fullmatch(url):
        return "Use an in-app path like /app/discover or /partner/bookings (letters, digits, - and _ only)"
    return None


class BroadcastInput(InputSchema):
    title: str = Field(min_length=2, max_length=120)
    body: str = Field(min_length=2, max_length=300)
    url: str | None = Field(None, max_length=200)
    segment: BroadcastSegment = Field(default_factory=BroadcastSegment)

    @field_validator("url", mode="before")
    @classmethod
    def _blank_url(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("url")
    @classmethod
    def _in_app_url(cls, v: str | None) -> str | None:
        if v is not None and (problem := broadcast_url_problem(v)):
            raise ValueError(problem)
        return v


class BroadcastPreviewRequest(InputSchema):
    """POST /admin/broadcasts/preview — the draft broadcast (only its segment matters) or a bare segment."""

    title: str | None = None
    body: str | None = None
    url: str | None = None
    segment: BroadcastSegment | None = None
    areas: list[str] | None = Field(None, max_length=50)
    sports: list[str] | None = Field(None, max_length=20)
    active_days: int | None = Field(None, ge=1, le=365)

    def target(self) -> BroadcastSegment:
        return self.segment or BroadcastSegment(areas=self.areas, sports=self.sports, active_days=self.active_days)


class BroadcastSegmentOut(Schema):
    areas: list[str] | None = None
    sports: list[str] | None = None
    active_days: int | None = None


class BroadcastOut(Schema):
    id: uuid.UUID
    title: str
    body: str
    url: str | None
    segment: BroadcastSegmentOut
    recipient_count: int
    created_by: str | None
    created_at: datetime


class BroadcastPreview(Schema):
    recipients: int
