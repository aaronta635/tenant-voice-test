from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.schemas.admin_activity import ActivityLog, ActivityPageOut
from app.schemas.admin_analytics import AnalyticsOut
from app.schemas.admin_moderation import (
    ListingModerationIn,
    ListingPageOut,
    ListingStatus,
    ModeratedListingOut,
    ModeratedReviewOut,
    ReviewModerationIn,
    ReviewQueueOut,
    ReviewView,
)
from app.services import admin_activity, admin_analytics, admin_moderation

# Every route here depends on get_current_admin, as /admin's others do (routes/admin.py).
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/reviews", response_model=ReviewQueueOut)
def review_queue(
    view: ReviewView = "reported",
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """Reported reviews waiting for a decision, or the hidden ones, with their reports and decisions."""
    return admin_moderation.review_queue(view, limit, offset)


@router.post("/reviews/{review_id}/moderation", response_model=ModeratedReviewOut)
def moderate_review(review_id: str, payload: ReviewModerationIn, current: CurrentProfile = Depends(get_current_admin)):
    """Hide a review, or keep or restore it published, with a reason; 409 when it changed meanwhile.

    The decision goes through mobile_admin_moderate_review, run as the admin.
    """
    return admin_moderation.moderate_review(current, review_id, payload.action, payload.reason,
                                            payload.expected_status)


@router.get("/listings", response_model=ListingPageOut)
def list_listings(
    listing_status: ListingStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """Every listing, newest first, with its owner and the last moderation decision on it."""
    return admin_moderation.listing_queue(listing_status, q, limit, offset)


@router.post("/listings/{listing_id}/moderation", response_model=ModeratedListingOut)
def moderate_listing(listing_id: str, payload: ListingModerationIn, current: CurrentProfile = Depends(get_current_admin)):
    """Pause or archive a listing with a reason its owner is told; 409 when it changed meanwhile."""
    return admin_moderation.moderate_listing(current.id, listing_id, payload.action, payload.reason,
                                             payload.expected_status)


@router.get("/activity", response_model=ActivityPageOut)
def activity(
    log: ActivityLog = "admin",
    actor: str | None = Query(default=None, max_length=100),
    action: str | None = Query(default=None, max_length=80),
    entity_type: str | None = Query(default=None, max_length=40),
    since: date | None = Query(default=None, alias="from"),
    until: date | None = Query(default=None, alias="to"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """One audit log, newest first: admin decisions (admin) or the web's requests and events (web)."""
    return admin_activity.activity(log, actor, action, entity_type, since, until, limit, offset)


@router.get("/analytics", response_model=AnalyticsOut)
def analytics(
    days: int = Query(30, description="30, 90 or 365"), current: CurrentProfile = Depends(get_current_admin)
):
    """Counts over the last 30 days, 90 days or 12 months, and of all time."""
    if days not in admin_analytics.RANGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose 30, 90 or 365 days.")
    return admin_analytics.analytics(days)
