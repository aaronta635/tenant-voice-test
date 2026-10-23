from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# ready: the model answers; applied: it answered this one. The rest are why
# the rules answered instead: no model key, an unverified owner (the paid_ai
# gate, with the refusal in `verification`), or a model failure or an answer
# out of bounds.
AiStatus = Literal["ready", "applied", "not_configured", "verification_required", "unavailable"]


class OwnerAssistantAsk(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # The client's id for this question: sent again, the saved answer comes back and nothing is asked twice.
    request_id: UUID | None = None


class ActionChange(BaseModel):
    label: str
    value: str


class ActionPreview(BaseModel):
    title: str
    # Every value the action writes, in words.
    changes: list[ActionChange]
    notes: list[str] = []
    # What stays a demo about it (docs/demo-features.md), or None.
    demo: str | None = None


class OwnerAssistantAction(BaseModel):
    operation: str
    payload: dict
    preview: ActionPreview


class ProviderSuggestion(BaseModel):
    id: str
    name: str
    categories: list[str] = []
    location: str | None = None
    pricing: str | None = None
    rating: float | None = None
    hourly_rate: float | None = None
    reasons: list[str] = []


class OwnerAssistantMessageOut(BaseModel):
    request_id: str
    question: str
    reply: str
    source: Literal["ai", "rules"]
    ai_status: AiStatus
    ai_labelled: bool = True
    cached: bool = False
    # A proposal only: nothing is written until the owner confirms it.
    action: OwnerAssistantAction | None = None
    providers: list[ProviderSuggestion] = []
    verification: dict | None = None


class OwnerAssistantConfirmOut(BaseModel):
    request_id: str
    action_request_id: str
    operation: str
    message: str
    record: dict | None = None
    saved: list[ActionChange] = []
    # The action request id once the turn carries the receipt, else None.
    receipt: str | None = None
    reply: str


class OwnerAssistantWorkspaceOut(BaseModel):
    context: object | None = None
    history: list = []
    workspace: object | None = None
    ai_status: AiStatus
    verification: dict | None = None
    ai_labelled: bool = True
