from typing import Literal

from pydantic import Field

from app.core.schemas import InputSchema, Schema
from app.modules.users.schemas import UserMe

# E.164 (India-first but any country code accepted)
PHONE_PATTERN = r"^\+[1-9]\d{7,14}$"


class OtpRequest(InputSchema):
    phone: str = Field(pattern=PHONE_PATTERN)


class OtpRequestResponse(Schema):
    sent: bool
    expires_in: int
    dev_code: str | None


class OtpVerify(InputSchema):
    phone: str = Field(pattern=PHONE_PATTERN)
    code: str = Field(pattern=r"^\d{6}$")


class RefreshRequest(InputSchema):
    refresh_token: str


class AuthTokens(Schema):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserMe
    is_new_user: bool
