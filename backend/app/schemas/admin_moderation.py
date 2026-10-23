from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.admin_complaints import PartyOut

# The review queue's views (admin_moderation.REPORTED_VIEW, HIDDEN_VIEW).
ReviewView = Literal["reported", "hidden"]
# reviews.status (ReviewStatus) and listings.status (ListingStatus).
ReviewStatus = Literal["PUBLISHED", "HIDDEN", "FLAGGED", "ARCHIVED"]
ListingStatus = Literal["DRAFT", "PUBLISHED", "PAUSED", "APPLICATIONS_CLOSED", "LEASED", "ARCHIVED"]


class ReviewReportOut(BaseModel):
    """A report mobile_report_review kept (media_urls.reports), from either app."""

    id: str
    reporter: PartyOut | None = None
    # spam, misleading, offensive, hate, privacy or other.
    reason: str | None = None
    details: str | None = None
    # Waiting for a decision; false once one closed it.
    open: bool
    created_at: datetime | None = None


class ModeratedReviewDetailsOut(BaseModel):
    """What mobile_submit_review kept of a property review, for admins: the private answer included."""

    pros: str | None = None
    cons: str | None = None
    advice_to_owner: str | None = None
    would_recommend: bool | None = None
    issues_disclosed: bool | None = None
    maintenance_or_eviction_issue: bool | None = None
    reported_issues: list[str] = Field(default_factory=list)


class ReviewPhotoLinkOut(BaseModel):
    # Signed for expires_in seconds; the queue signs new ones on each read.
    url: str
    expires_in: int


class ModerationDecisionOut(BaseModel):
    id: str
    # hidden, restored or kept (a review); paused or archived (a listing).
    decision: str | None = None
    from_status: str | None = None
    to_status: str | None = None
    reason: str | None = None
    actor: PartyOut | None = None
    created_at: datetime


class ModeratedReviewOut(BaseModel):
    id: str
    status: ReviewStatus
    rating: int
    title: str | None = None
    body: str | None = None
    # The reviewed party's reply.
    reply: str | None = None
    is_verified_interaction: bool
    created_at: datetime | None = None
    reviewer: PartyOut | None = None
    reviewed: PartyOut | None = None
    property_id: str | None = None
    listing_id: str | None = None
    property_title: str | None = None
    # Reports made since the last decision.
    open_reports: int
    # Newest first: the evidence, kept after every decision.
    reports: list[ReviewReportOut]
    decisions: list[ModerationDecisionOut]
    # A property review's category scores (reviews.CATEGORIES), details and photos.
    ratings: dict[str, int] = Field(default_factory=dict)
    details: ModeratedReviewDetailsOut | None = None
    photo_count: int = 0
    photos: list[ReviewPhotoLinkOut] = Field(default_factory=list)


class ReviewQueueOut(BaseModel):
    view: ReviewView
    items: list[ModeratedReviewOut]
    total: int
    limit: int
    offset: int
    counts: dict[ReviewView, int]


def _reason(value: str | None) -> str:
    return " ".join((value or "").split())


class _Decision(BaseModel):
    # Required: kept with the decision, and sent to the person it affects.
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def reason_required(self):
        self.reason = _reason(self.reason)
        if not self.reason:
            raise PydanticCustomError("reason_required", "Give a reason. It is kept with the decision.")
        return self


class ReviewModerationIn(_Decision):
    # hide: HIDDEN (HIDE). restore: PUBLISHED, keeping a reported review up (DISMISS) or
    # restoring a hidden one (APPROVE), as mobile_admin_moderate_review calls them.
    action: Literal["hide", "restore"]
    # The status the admin saw; the decision applies only while the review still has it.
    expected_status: ReviewStatus | None = None


class ListingDecisionOut(BaseModel):
    decision: str | None = None
    reason: str | None = None
    actor: PartyOut | None = None
    created_at: datetime


class ModeratedListingOut(BaseModel):
    id: str
    title: str
    status: ListingStatus
    weekly_rent: float
    address: str
    suburb: str | None = None
    created_at: datetime | None = None
    published_at: datetime | None = None
    owner: PartyOut | None = None
    manager: PartyOut | None = None
    # What an admin may do to it now: pause, archive.
    actions: list[Literal["pause", "archive"]]
    last_decision: ListingDecisionOut | None = None


class ListingPageOut(BaseModel):
    items: list[ModeratedListingOut]
    total: int
    limit: int
    offset: int


class ListingModerationIn(_Decision):
    action: Literal["pause", "archive"]
    expected_status: ListingStatus | None = None
