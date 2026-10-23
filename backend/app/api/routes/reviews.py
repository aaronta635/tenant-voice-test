from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.core.deps import CurrentProfile, get_current_profile, get_optional_profile, require_role
from app.schemas.reviews import (
    PropertyReviewIn,
    PropertyReviewOut,
    PublicReviewOut,
    ReviewableHomeOut,
    ReviewCreate,
    ReviewOut,
    ReviewReply,
    ReviewReportIn,
    ReviewReportOut,
)
from app.services import reviews as reviews_service
from app.services import service_providers as service_providers_service

router = APIRouter(tags=["reviews"])


@router.post("/reviews", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def create_review(payload: ReviewCreate, current: CurrentProfile = Depends(get_current_profile)):
    """A client's review of their completed booking; a property is reviewed with POST /properties/{id}/reviews."""
    return reviews_service.create_review(current.id, payload.model_dump())


@router.get("/me/reviews", response_model=list[ReviewOut])
def list_my_reviews(current: CurrentProfile = Depends(get_current_profile)):
    # Reviews name the reviewed user: a provider's id is its users.id.
    if current.role in ("service_provider", "landlord"):
        return reviews_service.list_provider_reviews(current.id)
    return reviews_service.list_my_submitted_reviews(current.id)


@router.get("/me/reviewable-homes", response_model=list[ReviewableHomeOut])
def list_reviewable_homes(current: CurrentProfile = Depends(require_role("tenant"))):
    """The homes the tenant may review: an approved application, and no review of theirs yet."""
    return reviews_service.reviewable_homes(current)


@router.get("/properties/{property_id}/reviews", response_model=list[PropertyReviewOut])
def list_property_reviews(property_id: str, viewer: CurrentProfile | None = Depends(get_optional_profile)):
    """A property's published reviews, by a listing's id or the property's: photos for signed-in members only."""
    return reviews_service.list_property_reviews(property_id, viewer)


@router.post("/properties/{property_id}/reviews", response_model=PropertyReviewOut,
             status_code=status.HTTP_201_CREATED)
def submit_property_review(
    property_id: str,
    review: str = Form(..., max_length=100_000, description="PropertyReviewIn as JSON"),
    photos: list[UploadFile] | None = File(default=None, description="Up to 4 photos: JPEG, PNG or WebP, 5 MB each"),
    current: CurrentProfile = Depends(get_current_profile),
):
    """A tenant's structured review of a home they rented, by a listing's id or the property's (tracker R12)."""
    try:
        payload = PropertyReviewIn.model_validate_json(review)
    except ValidationError as exc:
        errors = exc.errors(include_url=False, include_context=False, include_input=False)
        raise RequestValidationError([{**error, "loc": ("body", *error["loc"])} for error in errors]) from exc
    return reviews_service.submit_property_review(current, property_id, payload.model_dump(), photos or [])


@router.get("/providers/{provider_id}/reviews", response_model=list[PublicReviewOut])
def list_provider_reviews(provider_id: str):
    # Public profile URLs may use the slug; reviews are keyed by the canonical id.
    resolved_id = service_providers_service.require_published(provider_id)
    # Anyone may read them: no reviewer's name, face or suburb, and no reports read.
    return reviews_service.list_public_provider_reviews(resolved_id)


@router.patch("/reviews/{review_id}/reply", response_model=ReviewOut)
def reply_to_review(
    review_id: str,
    payload: ReviewReply,
    current: CurrentProfile = Depends(require_role("service_provider", "landlord")),
):
    return reviews_service.reply_to_review(review_id, current.id, payload.provider_reply, current.role)


@router.patch("/reviews/{review_id}/flag", response_model=ReviewOut)
def flag_review(review_id: str, current: CurrentProfile = Depends(get_current_profile)):
    """The reviewed party (or staff) reporting a review about them, from their reviews page."""
    return reviews_service.flag_review(review_id, current.id, current.role, current.access_token)


@router.post("/reviews/{review_id}/reports", response_model=ReviewReportOut, status_code=status.HTTP_201_CREATED)
def report_review(review_id: str, payload: ReviewReportIn, current: CurrentProfile = Depends(get_current_profile)):
    """Any member reporting a published review for moderation, with a reason; once each."""
    return reviews_service.report_review(review_id, current, payload.reason, payload.details)
