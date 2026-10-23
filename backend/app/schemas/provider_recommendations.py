from datetime import datetime
from typing import Annotated, Literal
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.schemas.gates import GateRefusalOut

ServiceId = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class RecommendationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    role: Literal["tenant", "landlord"] | None = None
    location: str = Field(default="", max_length=80)
    limit: int = Field(default=12, ge=1, le=12)
    # Focus the match on some of the caller's own active services; empty = all.
    service_ids: list[ServiceId] = Field(default_factory=list, max_length=5)
    # Leave out people the provider already has a pending or accepted connection with.
    new_only: bool = False


class RecommendationLocationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    search: str = Field(default="", max_length=80)
    role: Literal["tenant", "landlord"] | None = None


class RecommendationLocation(BaseModel):
    label: str
    value: str = Field(min_length=1, max_length=80)


class RecommendationLocationsOut(BaseModel):
    items: list[RecommendationLocation] = Field(max_length=8)


class RecommendationItem(BaseModel):
    id: str
    full_name: str
    role: Literal["tenant", "landlord"]
    avatar_url: str | None = None
    location: str | None = None
    state: str | None = None
    connection_status: Literal["pending", "accepted", "declined"] | None = None
    match_level: Literal["strong", "possible", "explore"]
    reasons: list[str]


class ProviderRecommendationsOut(BaseModel):
    items: list[RecommendationItem]
    source: Literal["rules", "deepseek"]
    # verification_required: reranking is the paid AI, which only a verified provider uses (R18).
    ai_status: Literal["not_configured", "ready", "applied", "unavailable", "cooldown", "verification_required"]
    message: str | None = None
    # Why the model was not asked, with ai_status verification_required; None otherwise.
    verification: GateRefusalOut | None = None
    generated_at: datetime
    cached: bool = False


class WorkOpportunitiesQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=12, ge=1, le=24)


class WorkOpportunity(BaseModel):
    """An owner or landlord in the provider's areas, with the public facts that place and rank them."""

    id: str
    display_name: str
    role_label: Literal["Landlord", "Agent"]
    location: str | None = None
    state: str | None = None
    verified: bool
    rating_avg: float | None = None
    review_count: int
    listing_count: int
    match: Literal["listing_in_area", "based_in_area", "state_in_area", "same_state"]
    reasons: list[str] = Field(min_length=1, max_length=4)


class WorkOpportunitiesOut(BaseModel):
    items: list[WorkOpportunity]
    # The provider's own suburb and service areas the ranking used, as written.
    areas: list[str]
    generated_at: datetime


class AiSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(min_length=1, max_length=40)
    reason_codes: list[str] = Field(min_length=1, max_length=3)


class AiRanking(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendations: list[AiSelection] = Field(min_length=1, max_length=12)


# ---------------------------------------------------------------------------
# Recommendation chat: the assistant collects search criteria, the provider
# confirms them, and only then does the ordinary matching above run.
# ---------------------------------------------------------------------------
CriteriaRole = Literal["tenant", "landlord", "any"]
QuickReply = Annotated[str, StringConstraints(min_length=1, max_length=40)]


class RecommendationCriteria(BaseModel):
    """What the provider wants to search for.

    None means "not decided yet": role None is unknown while "any" means
    landlords and tenants; location None is unknown while "" means anywhere.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    role: CriteriaRole | None = None
    location: str | None = Field(default=None, max_length=80)
    service_ids: list[ServiceId] = Field(default_factory=list, max_length=5)
    new_only: bool = False


class RecommendationChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=600)

    @field_validator("content", mode="before")
    @classmethod
    def composed_unicode(cls, value):
        # Vietnamese typed with combining marks (NFD) must read the same as precomposed text.
        return unicodedata.normalize("NFC", value) if isinstance(value, str) else value


class RecommendationChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[RecommendationChatMessage] = Field(min_length=1, max_length=20)
    criteria: RecommendationCriteria = Field(default_factory=RecommendationCriteria)

    @model_validator(mode="after")
    def latest_message_is_from_the_provider(self):
        if self.messages[-1].role != "user":
            raise ValueError("The latest message must be yours")
        if not self.messages[-1].content.strip():
            raise ValueError("Type a message first")
        return self


class RecommendationChatService(BaseModel):
    id: str
    title: str


class RecommendationChatOut(BaseModel):
    reply: str
    state: Literal["ask", "confirm"]
    criteria: RecommendationCriteria
    missing: list[Literal["role", "location"]]
    quick_replies: list[str] = Field(default_factory=list, max_length=4)
    services: list[RecommendationChatService]
    source: Literal["rules", "deepseek"]
    # verification_required: a model turn is the paid AI, so the guided questions answered (R18).
    ai_status: Literal["not_configured", "applied", "unavailable", "cooldown", "verification_required"]
    # Why the model was not asked, with ai_status verification_required; None otherwise.
    verification: GateRefusalOut | None = None


class AiChatCriteria(BaseModel):
    """Criteria as the model must return them (service ids are request-local aliases).

    Every key is required: a partial answer is unusable, so the guided parser
    (which merges onto the current criteria) answers instead.
    """

    model_config = ConfigDict(extra="forbid")

    role: CriteriaRole | None
    location: str | None = Field(max_length=80)
    service_ids: list[ServiceId] = Field(max_length=5)
    new_only: bool


class AiChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["ask", "confirm"]
    reply: str = Field(min_length=1, max_length=400)
    criteria: AiChatCriteria
    quick_replies: list[QuickReply] = Field(default_factory=list, max_length=4)
