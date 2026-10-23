"""The Housing Portal's requests and answers (tracker R41): services/housing_portal.py fills them."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# mobile_housing_update_referral's actions (housing_portal.REFERRAL_ACTIONS).
ReferralAction = Literal["START_REVIEW", "PREPARE_PACKAGE", "CLOSE"]
# regulatory_red_flags.status (its CHECK).
FlagStatus = Literal["New", "Under review", "Escalated", "Closed"]
# regulatory_surveys.status (its CHECK).
SurveyStatus = Literal["Draft", "Live", "Closed"]
# web.datapoint_requests (supabase/shared/0006_housing_portal.sql).
Datapoint = Literal["complaint_categories", "maintenance_categories", "red_flag_rules", "review_questions", "other"]
RequestStatus = Literal["pending", "accepted", "declined", "completed"]
# What an admin answers: every status but the one a request starts with.
RequestDecision = Literal["accepted", "declined", "completed"]


def _required_text(value: str) -> str:
    text = (value or "").strip()
    if not text:
        raise ValueError("Write something here.")
    return text


def _optional_text(value: str | None) -> str | None:
    return (value or "").strip() or None


class OfficerMeOut(BaseModel):
    id: str
    full_name: str
    email: str | None = None


class CountOut(BaseModel):
    """One count of a breakdown: a stored value, how it reads, and how many."""

    key: str
    label: str
    count: int


# ---------------------------------------------------------------------------
# Complaints, reviews, red flags, referrals: the overview's figures
# ---------------------------------------------------------------------------
class CategoryStatusesOut(BaseModel):
    code: str
    label: str
    total: int
    # One count per complaints.status, in COMPLAINT_STATUSES order.
    statuses: list[CountOut]
    # Lodged to resolved or closed, in days, over those with both dates.
    median_days_to_resolve: float | None = None


class ComplaintSummaryOut(BaseModel):
    total: int
    # Open, in review or escalated.
    open: int
    statuses: list[CountOut]
    severities: list[CountOut]
    categories: list[CategoryStatusesOut]
    median_days_to_resolve: float | None = None


class ReviewFiguresOut(BaseModel):
    total: int
    statuses: list[CountOut]
    # PUBLISHED or FLAGGED: the reviews profiles and listings show.
    visible: int
    property_reviews: int
    verified: int
    average_rating: float | None = None
    average_landlord_rating: float | None = None
    # Visible reviews by star rating, 1 to 5.
    distribution: list[CountOut]


class RedFlagFiguresOut(BaseModel):
    events: list[CountOut]
    open_events: int
    alerts: list[CountOut]
    open_alerts: int


class ReferralFiguresOut(BaseModel):
    total: int
    open: int
    statuses: list[CountOut]


class HousingOverviewOut(BaseModel):
    complaints: ComplaintSummaryOut
    reviews: ReviewFiguresOut
    red_flags: RedFlagFiguresOut
    referrals: ReferralFiguresOut


# ---------------------------------------------------------------------------
# Referrals
# ---------------------------------------------------------------------------
class ReferralComplaintOut(BaseModel):
    description: str | None = None
    category: str | None = None
    severity: str | None = None
    status: str | None = None
    lodged_at: datetime | None = None


class ReferralPartiesOut(BaseModel):
    tenant_name: str | None = None
    owner_name: str | None = None


class ReferralEventOut(BaseModel):
    type: str | None = None
    note: str | None = None
    created_at: datetime | None = None


class ReferralEvidenceOut(BaseModel):
    trigger_reason: str | None = None
    days_open: int | None = None
    property_open_complaints: int | None = None
    owner_open_complaints: int | None = None
    photo_count: int = 0
    documents_verified: bool | None = None
    work_order_status: str | None = None
    events: list[ReferralEventOut] = []


class ReferralOut(BaseModel):
    id: str
    alert_id: str | None = None
    complaint_id: str | None = None
    case_reference: str | None = None
    # critical or high, as the function lowers mobile_admin_alerts.severity.
    severity: str | None = None
    # How the portal names the status: New, Under review, Package ready, Closed.
    status: str
    # mobile_admin_referral_packages.status: REFERRED, UNDER_REVIEW, PACKAGE_READY, CLOSED.
    package_status: str
    title: str | None = None
    reason: str | None = None
    category: str | None = None
    area: str | None = None
    address: str | None = None
    assigned_team: str | None = None
    admin_note: str | None = None
    regulator_note: str | None = None
    referred_at: datetime | None = None
    updated_at: datetime | None = None
    complaint: ReferralComplaintOut
    parties: ReferralPartiesOut
    evidence: ReferralEvidenceOut


class ReferralActionIn(BaseModel):
    action: ReferralAction
    # mobile_housing_update_referral keeps the first 500 characters; a blank note keeps the last one.
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def _tidy(cls, value: str | None) -> str | None:
        return _optional_text(value)


class ReferralUpdateOut(BaseModel):
    id: str
    status: str
    package_status: str
    regulator_note: str | None = None
    updated_at: datetime | None = None


# ---------------------------------------------------------------------------
# Red-flag alerts
# ---------------------------------------------------------------------------
class RedFlagEventOut(BaseModel):
    id: str
    rule: str | None = None
    # red_flag_rules.severity: LOW, MEDIUM, HIGH or CRITICAL.
    severity: str | None = None
    summary: str
    # RedFlagStatus: OPEN, ACKNOWLEDGED, RESOLVED or DISMISSED.
    status: str
    # The property's suburb and state; never its street.
    area: str | None = None
    complaint_count: int | None = None
    threshold: int | None = None
    window_days: int | None = None
    details: str | None = None
    triggered_at: datetime | None = None
    resolved_at: datetime | None = None


class RegulatoryFlagOut(BaseModel):
    id: str
    severity: str
    title: str
    area: str
    category: str
    reports: int
    threshold: int
    status: FlagStatus
    raised_at: datetime | None = None


class RedFlagsOut(BaseModel):
    events: list[RedFlagEventOut]
    alerts: list[RegulatoryFlagOut]


class FlagStatusIn(BaseModel):
    status: FlagStatus
    # The status the officer saw: a change made meanwhile is 409, not overwritten.
    from_status: FlagStatus


# ---------------------------------------------------------------------------
# Data category requests
# ---------------------------------------------------------------------------
class DatapointRequestIn(BaseModel):
    datapoint: Datapoint
    requested_change: str = Field(min_length=1, max_length=1000)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("requested_change", "reason")
    @classmethod
    def _texts(cls, value: str) -> str:
        return _required_text(value)


class DatapointRequestOut(BaseModel):
    id: str
    officer_id: str | None = None
    officer_name: str | None = None
    datapoint: str
    datapoint_label: str
    requested_change: str
    reason: str
    status: RequestStatus
    admin_response: str | None = None
    responded_by_name: str | None = None
    responded_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class DatapointResponseIn(BaseModel):
    status: RequestDecision
    response: str = Field(min_length=1, max_length=1000)
    # The status the admin saw: a change made meanwhile is 409, not overwritten.
    from_status: RequestStatus

    @field_validator("response")
    @classmethod
    def _tidy(cls, value: str) -> str:
        return _required_text(value)


# ---------------------------------------------------------------------------
# Housing surveys (prototypes: nothing sends them or collects answers)
# ---------------------------------------------------------------------------
class SurveyQuestionOut(BaseModel):
    id: int
    sort_order: int
    text: str


class SurveyOut(BaseModel):
    id: str
    title: str
    audience: str
    status: SurveyStatus
    responses: int
    target_responses: int
    # regulatory_surveys.closes_at is text: an ISO date the web saved, or another app's words ("Not scheduled").
    closes_at: str
    created_at: datetime | None = None
    questions: list[SurveyQuestionOut]
    # The status an officer may move it to next, or None once it is closed.
    next_status: SurveyStatus | None = None


class SurveyIn(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    audience: str = Field(min_length=1, max_length=80)
    target_responses: int = Field(default=1000, ge=1, le=1_000_000)
    closes_on: date | None = None
    questions: list[str] = Field(min_length=1, max_length=20)

    @field_validator("title", "audience")
    @classmethod
    def _texts(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("questions")
    @classmethod
    def _questions(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("Write each question, or remove the empty one.")
        if any(len(value) > 300 for value in cleaned):
            raise ValueError("Keep each question to 300 characters.")
        return cleaned


class SurveyStatusIn(BaseModel):
    status: SurveyStatus
    # The status the officer saw: a change made meanwhile is 409, not overwritten.
    from_status: SurveyStatus


# ---------------------------------------------------------------------------
# De-identified aggregates
# ---------------------------------------------------------------------------
class AggregateCellOut(BaseModel):
    area: str
    state: str
    category: str
    category_code: str
    # None when suppressed: under the threshold, or hidden with one that is.
    count: int | None = None
    suppressed: bool


class AggregatesOut(BaseModel):
    threshold: int
    areas: int
    suppressed_cells: int
    cells: list[AggregateCellOut]
