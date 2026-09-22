from __future__ import annotations

from typing import Literal, TypeAlias
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


AttributeValue: TypeAlias = str | int | float | bool


class Attribute(BaseModel):
    """A flexible engineering property shared by all model elements."""

    id: str = Field(default_factory=lambda: new_id("attr"))
    name: str = Field(min_length=1)
    value: AttributeValue
    datatype: str | None = None
    unit: str | None = None

    @field_validator("name")
    @classmethod
    def name_is_trimmed(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Attribute name cannot be blank")
        return value

    @field_validator("datatype", "unit")
    @classmethod
    def optional_text_is_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class Element(BaseModel):
    """Generic modeling-kernel element; PPR adds type and semantic relations."""

    id: str = Field(default_factory=lambda: new_id("el"))
    name: str = Field(min_length=1)
    description: str = ""
    attributes: list[Attribute] = Field(default_factory=list)
    x: float = 0
    y: float = 0

    @field_validator("name")
    @classmethod
    def name_is_trimmed(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Element name cannot be blank")
        return value


class Definition(Element):
    kind: Literal["definition"] = "definition"


class Usage(Element):
    kind: Literal["usage"] = "usage"
    definition_id: str
