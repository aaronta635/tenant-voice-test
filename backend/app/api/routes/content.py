from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.content import (
    FaqOut,
    NotificationOut,
    PlatformStatsOut,
    SupportContactOut,
)
from app.services import content as content_service

router = APIRouter(tags=["content"])


# --------------------------------------------------------------------------- FAQs
@router.get("/faqs", response_model=list[FaqOut])
def list_faqs(audience: str | None = None):
    return content_service.list_faqs(audience)


# --------------------------------------------------------------------------- Support
@router.get("/support-contact", response_model=SupportContactOut)
def get_support_contact():
    return content_service.get_support_contact()


# --------------------------------------------------------------------------- Stats
@router.get("/stats/platform", response_model=PlatformStatsOut)
def get_platform_stats():
    return content_service.get_platform_stats()


# --------------------------------------------------------------------------- Notifications
@router.get("/me/notifications", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    current: CurrentProfile = Depends(get_current_profile),
):
    return content_service.list_notifications(current.id, unread_only, limit)


@router.patch("/me/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return content_service.mark_notification_read(notification_id, current.id)


@router.post("/me/notifications/read-all", response_model=list[NotificationOut])
def mark_all_read(current: CurrentProfile = Depends(get_current_profile)):
    return content_service.mark_all_notifications_read(current.id)

