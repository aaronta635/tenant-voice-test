from datetime import datetime

from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    booking_id: str | None = None
    property_id: str | None = None
    listing_id: str | None = None
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ReviewReply(BaseModel):
    provider_reply: str = Field(min_length=1, max_length=2000)


class ReviewOut(BaseModel):
    id: str
    booking_id: str | None = None
    provider_id: str
    client_id: str
    rating: int
    comment: str | None = None
    provider_reply: str | None = None
    replied_at: datetime | None = None
    is_flagged: bool
    created_at: datetime
    # Resolved by the service layer for the reviews management screen.
    client_name: str | None = None
    client_avatar_url: str | None = None
    service_title: str | None = None
    location: str | None = None


class PublicReviewOut(BaseModel):
    """A review as anyone may see it: no booking or client identifiers, which
    would let a stranger target that client's booking elsewhere in the API."""

    id: str
    provider_id: str
    rating: int
    comment: str | None = None
    provider_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime
    client_name: str | None = None
    client_avatar_url: str | None = None
    service_title: str | None = None
    location: str | None = None


# ---------------------------------------------------------------------------
# Property reviews (mobile_submit_review, tracker R12)
# ---------------------------------------------------------------------------
class PropertyReviewDetailsIn(BaseModel):
    """The answers besides the ratings. mobile_submit_review checks the limits and says what is wrong."""

    pros: str | None = Field(default=None, max_length=5000)
    cons: str | None = Field(default=None, max_length=5000)
    advice_to_owner: str | None = Field(default=None, max_length=5000)
    would_recommend: bool | None = None
    issues_disclosed: bool | None = None
    # Private: only the reviewer and the admins read it.
    maintenance_or_eviction_issue: bool | None = None
    # Each kept to 80 characters, such as "Plumbing: fixed within 1-3 days".
    reported_issues: list[str] = Field(default_factory=list, max_length=20)


class PropertyReviewIn(BaseModel):
    """POST /properties/{id}/reviews's "review" form field, as JSON; the photos are the "photos" files."""

    # One score from 1 to 5 for each of reviews.CATEGORIES, by its code.
    ratings: dict[str, int] = Field(max_length=20)
    title: str | None = Field(default=None, max_length=1000)
    body: str = Field(default="", max_length=20000)
    details: PropertyReviewDetailsIn = Field(default_factory=PropertyReviewDetailsIn)


class ReviewPhotoOut(BaseModel):
    # A link signed for expires_in seconds; it is signed again on each read.
    url: str
    expires_in: int


class PropertyReviewOut(PublicReviewOut):
    """A published property review as its reader may see it (PublicReviewOut's fields, then the review's own)."""

    property_id: str | None = None
    title: str | None = None
    landlord_rating: int | None = None
    # reviews.CATEGORIES scored 1 to 5; empty for a review saved without them.
    ratings: dict[str, int] = Field(default_factory=dict)
    pros: str | None = None
    cons: str | None = None
    advice_to_owner: str | None = None
    would_recommend: bool | None = None
    issues_disclosed: bool | None = None
    reported_issues: list[str] = Field(default_factory=list)
    # The private eviction answer: null for anyone but its author and the admins.
    maintenance_or_eviction_issue: bool | None = None
    photo_count: int = 0
    # Only for a signed-in member; photo_count says how many there are.
    photos: list[ReviewPhotoOut] = Field(default_factory=list)
    verified: bool = False
    status: str
    mine: bool = False
    reported_by_me: bool = False


class ReviewableHomeOut(BaseModel):
    """A home the tenant may review: an approved application, and no review of theirs yet."""

    property_id: str
    listing_id: str | None = None
    name: str
    address: str | None = None
    property_type: str | None = None
    image_url: str | None = None
    rating: float
    review_count: int


class ReviewReportIn(BaseModel):
    # spam, misleading, offensive, hate, privacy or other: mobile_report_review checks it.
    reason: str = Field(max_length=40)
    # Up to 500 characters, which the function checks.
    details: str | None = Field(default=None, max_length=5000)


class ReviewReportOut(BaseModel):
    review_id: str
    reason: str
    reported_by_me: bool
