from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

# The web's statuses (shared_map.COMPLAINT_TO_WEB); an admin sets the shared
# ComplaintStatus itself (admin_complaints).
STATUSES = ["open", "under_review", "resolved", "dismissed"]
# complaints.severity (ComplaintSeverity), which the person lodging a complaint chooses.
Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
# mobile_admin_issue_categories.severity: an alert policy's, as mobile_admin_save_issue_category takes it.
PolicySeverity = Literal["NORMAL", "HIGH", "URGENT", "CRITICAL"]

# Who may move a complaint into which state. The complainant can withdraw
# (dismissed); the accused can only acknowledge (under_review); closing a case
# as resolved is a moderator action.
ALLOWED_TRANSITIONS = {
    "open": {"under_review", "resolved", "dismissed"},
    "under_review": {"resolved", "dismissed"},
    "resolved": set(),
    "dismissed": set(),
}


class ComplaintCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    # create_general_complaint's rule: 10 to 3000 characters once spaces are trimmed.
    description: str = Field(min_length=10, max_length=3000)
    # A general code from GET /complaint-categories, in any case.
    category: str = Field(default="OTHER", max_length=60)
    severity: Severity = "MEDIUM"
    # A person, for a complaint about a member; ignored when a property is named.
    against_id: str | None = None
    # A listing the tenant has an approved application for (or its properties id).
    property_id: str | None = None
    evidence_urls: list[str] | None = None


class ComplaintUpdate(BaseModel):
    """Complainant edits, while the complaint is still open."""

    subject: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, min_length=10, max_length=3000)
    category: str | None = Field(default=None, max_length=60)
    severity: Severity | None = None
    evidence_urls: list[str] | None = None


class TenancyOut(BaseModel):
    """A listing a tenant may lodge a complaint about: one of their approved applications'."""

    listing_id: str
    title: str
    address: str | None = None


class ComplaintRespond(BaseModel):
    """The accused party's reply."""

    response: str = Field(min_length=1)


class ComplaintResolve(BaseModel):
    """Moderator action closing the case."""

    status: str
    resolution_note: str | None = None


class ComplaintStepOut(BaseModel):
    """One step of a complaint's timeline as its parties see it (complaint_events)."""

    id: str
    # lodged, updated, responded, status, or other (a step another app recorded).
    kind: str
    # The status the step moved the case to: open, under_review, escalated,
    # resolved or dismissed.
    status: str | None = None
    # A TenantVoice admin's note on a status change; the parties see it.
    note: str | None = None
    # you, complainant, respondent, staff (TenantVoice), or other.
    actor: str
    created_at: datetime


class ComplaintOut(BaseModel):
    id: str
    complainant_id: str
    against_id: str | None = None
    property_id: str | None = None
    # The category's code and its name; a value from before the codes keeps its text.
    category: str
    category_label: str | None = None
    severity: str | None = None
    subject: str
    description: str
    status: str
    response: str | None = None
    responded_at: datetime | None = None
    resolution_note: str | None = None
    resolved_at: datetime | None = None
    is_escalated: bool
    evidence_urls: list[str] | None = None
    created_at: datetime
    updated_at: datetime
    # Resolved by the service layer so the UI never has to join.
    complainant_name: str | None = None
    against_name: str | None = None
    property_title: str | None = None
    # Oldest first.
    timeline: list[ComplaintStepOut] = []


class ComplaintCategoryOut(BaseModel):
    """A category a complaint form offers."""

    code: str
    name: str
    description: str = ""


class IssueCategoryOut(BaseModel):
    """An alert policy (mobile_admin_issue_categories), as the admin console manages it."""

    id: str
    # Derived from the name when it was created; it never changes.
    code: str
    name: str
    description: str = ""
    severity: str | None = None
    severity_label: str | None = None
    sla_hours: int | None = None
    routing_team: str | None = None
    # The complaint category codes it covers.
    source_categories: list[str] = []
    # Words in a complaint's description that it covers.
    keywords: list[str] = []
    is_active: bool
    # The version an edit names.
    updated_at: datetime | None = None
    # The complaints and repairs it covers; only the list counts them.
    complaint_count: int | None = None


Words = list[Annotated[str, Field(max_length=60)]]


class IssueCategoryIn(BaseModel):
    """A new alert policy; mobile_admin_save_issue_category checks it (and derives the code from the name)."""

    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=240)
    severity: PolicySeverity = "NORMAL"
    sla_hours: int = Field(default=72, ge=1, le=2160)
    routing_team: str = Field(default="Complaint Resolution Team", max_length=80)
    # Codes from GET /admin/complaint-categories (codes).
    source_categories: list[str] = Field(default_factory=list, max_length=20)
    # Empty: the function takes the name's words of 4 letters or more.
    keywords: Words = Field(default_factory=list, max_length=30)


class IssueCategoryUpdate(BaseModel):
    """A policy's fields but its code; null keeps a field (the function is sent every field)."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)
    severity: PolicySeverity | None = None
    sla_hours: int | None = Field(default=None, ge=1, le=2160)
    routing_team: str | None = Field(default=None, max_length=80)
    source_categories: list[str] | None = Field(default=None, max_length=20)
    keywords: Words | None = Field(default=None, max_length=30)
    # The version the admin edited (IssueCategoryOut.updated_at).
    expected_updated_at: datetime


class IssueCategoryActiveIn(BaseModel):
    is_active: bool
    reason: str | None = Field(default=None, max_length=500)


class CodeChoiceOut(BaseModel):
    """A complaint category code a policy can cover: general (complaints), repair, or both."""

    code: str
    label: str
    kind: Literal["general", "repair", "both"]
