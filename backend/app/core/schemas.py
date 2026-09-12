from pydantic import BaseModel, ConfigDict


class Schema(BaseModel):
    """Base for all API schemas: ORM-friendly, strict about unknown input fields."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class InputSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
