"""The support chat (services/support_chat.py, tracker R37): a question, the conversation before it, and the answer."""

from datetime import datetime
from typing import Annotated, Literal
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.gates import GateRefusalOut

# A request's bounds: the question, and each turn of the conversation before it.
MESSAGE_LIMIT = 1000
TURN_LIMIT = 2000
# The turns the service keeps, the newest; older ones are dropped, not refused.
HISTORY_TURNS = 10
# The most turns a request may carry at all, so a body stays small.
HISTORY_ITEMS_LIMIT = 50


def _composed(value):
    # Text typed with combining marks (NFD) counts and reads the same as precomposed text.
    return unicodedata.normalize("NFC", value) if isinstance(value, str) else value


class SupportChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=TURN_LIMIT)

    @field_validator("content", mode="before")
    @classmethod
    def composed_unicode(cls, value):
        return _composed(value)


class SupportChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=MESSAGE_LIMIT)
    # Oldest first, as the panel shows it.
    history: list[SupportChatTurn] = Field(default_factory=list, max_length=HISTORY_ITEMS_LIMIT)

    @field_validator("message", mode="before")
    @classmethod
    def composed_unicode(cls, value):
        return _composed(value)


class SupportSourceOut(BaseModel):
    """A help passage an answer comes from: its title, the page it is about and its text, shortened."""

    title: str
    href: str
    excerpt: str


class SupportUsageOut(BaseModel):
    """The caller's support chat messages today (a UTC day), counted with the mobile app's AI chat."""

    used: int
    limit: int
    remaining: int
    # The next UTC midnight, when the count starts again.
    resets_at: datetime


class SupportChatOut(BaseModel):
    # Plain text. A link is written [label](/path), to a page of the sources or to the help or contact page.
    answer: str
    sources: list[SupportSourceOut]
    # ai: the model wrote the answer from the sources. help: the server did, and the sources are the answer.
    source: Literal["ai", "help"]
    # applied: the model answered. not_configured, unavailable, verification_required: why it did not
    # (no key; a failure, an unusable answer or no count of today's messages; the paid_ai gate).
    # no_match: no help passage fits the question, so the model was not asked.
    ai_status: Literal["applied", "not_configured", "unavailable", "verification_required", "no_match"]
    # Why the model was not asked, with ai_status verification_required; None otherwise.
    verification: GateRefusalOut | None = None
    # None when today's messages could not be counted.
    usage: SupportUsageOut | None = None


PassageAlias = Annotated[str, StringConstraints(min_length=1, max_length=8)]


class ModelAnswer(BaseModel):
    """The model's JSON, as the system prompt asks for it: every key, and nothing else."""

    model_config = ConfigDict(extra="forbid")

    answer: str = Field(min_length=1, max_length=TURN_LIMIT)
    passage_ids: list[PassageAlias] = Field(max_length=8)
    known: bool
