from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.complaints import CodeChoiceOut, IssueCategoryOut

# complaints.status (ComplaintStatus).
ComplaintStatus = Literal["OPEN", "IN_REVIEW", "ESCALATED", "RESOLVED", "CLOSED"]


def _note(value: str | None) -> str | None:
    return " ".join((value or "").split()) or None


class PartyOut(BaseModel):
    id: str
    full_name: str | None = None
    # The web role; None for someone without a users row.
    role: str | None = None


class AdminComplaintOut(BaseModel):
    id: str
    subject: str
    description: str
    category: str
    category_label: str
    # False for a category no longer offered, or one not on the list.
    category_active: bool
    severity: str | None = None
    status: ComplaintStatus
    # Stored CLOSED, by the complainant.
    withdrawn: bool
    lodged_at: datetime
    resolved_at: datetime | None = None
    complainant: PartyOut
    against: PartyOut | None = None
    # The properties row, and its newest listing (the web's property id).
    property_id: str | None = None
    listing_id: str | None = None
    property_title: str | None = None
    assignee: PartyOut | None = None
    responded: bool


class AdminComplaintPageOut(BaseModel):
    items: list[AdminComplaintOut]
    total: int
    limit: int
    offset: int


class AdminComplaintStepOut(BaseModel):
    id: str
    event_type: str | None = None
    note: str | None = None
    # Web statuses on the parties' steps, ComplaintStatus on an admin's.
    from_status: str | None = None
    to_status: str | None = None
    actor: PartyOut | None = None
    assignee: PartyOut | None = None
    # "web" for a step the web recorded.
    source: str
    created_at: datetime


class AdminComplaintDetailOut(AdminComplaintOut):
    response: str | None = None
    responded_at: datetime | None = None
    resolution_note: str | None = None
    evidence_urls: list[str] = []
    # Oldest first, staff-only steps too.
    timeline: list[AdminComplaintStepOut]
    # The statuses an admin may move it to now.
    transitions: list[ComplaintStatus]
    # metadata.source: tenant_general_complaint (lodged through create_general_complaint), the web's
    # web_member_complaint, or another app's; None for older rows.
    source: str | None = None


class ComplaintStatusIn(BaseModel):
    status: ComplaintStatus
    # Required: both parties see it in the complaint's timeline. review_general_complaint takes up to 1200.
    note: str = Field(default="", max_length=1200)
    # The status the admin saw; the change applies only while it still has it.
    expected_status: ComplaintStatus | None = None

    @model_validator(mode="after")
    def note_required(self) -> "ComplaintStatusIn":
        self.note = _note(self.note) or ""
        if not self.note:
            raise PydanticCustomError("note_required", "Write a note. Both parties see it with the new status.")
        return self


class ComplaintAssignIn(BaseModel):
    # An active admin, or null to unassign.
    assignee_id: str | None = None
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def _tidy(cls, value: str | None) -> str | None:
        return _note(value)


class AssigneeOut(BaseModel):
    id: str
    full_name: str
    email: str | None = None


class IssueCategoryListOut(BaseModel):
    """The alert policies, and the complaint category codes a policy can cover."""

    categories: list[IssueCategoryOut]
    codes: list[CodeChoiceOut]
