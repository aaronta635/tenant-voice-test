from datetime import datetime

from pydantic import BaseModel, Field


class AdminAlertOut(BaseModel):
    """An alert as mobile_admin_alerts lists it."""

    id: str
    complaint_id: str | None = None
    # The alert policy (mobile_admin_issue_categories) that covered the complaint.
    category_id: str | None = None
    category_name: str | None = None
    routing_team: str | None = None
    # HIGH or CRITICAL.
    severity: str
    # OPEN, UNDER_REVIEW or ESCALATED (resolved ones are not listed).
    status: str
    title: str
    reason: str
    address: str | None = None
    area: str | None = None
    days_open: int = 0
    property_open_complaints: int = 0
    owner_open_complaints: int = 0
    photo_count: int = 0
    documents_verified: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    escalated_at: datetime | None = None
    escalation_note: str | None = None


class AlertEscalateIn(BaseModel):
    # Kept with the referral package (the function keeps 500 characters).
    note: str | None = Field(default=None, max_length=500)


class EscalationOut(BaseModel):
    id: str
    status: str | None = None
    escalated_at: datetime | None = None
    escalation_note: str | None = None
    # The referral package's status (REFERRED at first) and its case reference (TV-...).
    housing_portal_status: str | None = None
    case_reference: str | None = None
