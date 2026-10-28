from typing import Optional
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class GameCreate(Input):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class Game(GameCreate):
    id: str


class SourceCreate(Input):
    url: HttpUrl
    title: str = Field(min_length=1, max_length=300)
    text: Optional[str] = Field(default=None, min_length=40, max_length=500_000)
    platform: Optional[str] = Field(default=None, min_length=1, max_length=80)
    version: Optional[str] = Field(default=None, min_length=1, max_length=80)


class Source(BaseModel):
    id: str
    game_id: str
    url: str
    title: str
    platform: Optional[str]
    version: Optional[str]
    updated_at: str
    chunk_count: int


class Question(Input):
    question: str = Field(min_length=3, max_length=2000)
    context: str = Field(default="", max_length=2000)
    platform: Optional[str] = Field(default=None, min_length=1, max_length=80)
    version: Optional[str] = Field(default=None, min_length=1, max_length=80)
    top_k: int = Field(default=5, ge=1, le=10)
    mode: Literal["extractive", "generate"] = "extractive"


class Citation(BaseModel):
    number: int
    source_id: str
    chunk_id: int
    title: str
    url: str
    excerpt: str


class Answer(BaseModel):
    game_id: str
    answer: str
    mode: Literal["extractive", "generate"]
    status: Literal["answered", "insufficient_context"]
    citations: list[Citation]


class GeneratedAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=12000)
    citation_numbers: list[int] = Field(min_length=1, max_length=10)
