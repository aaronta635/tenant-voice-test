from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile, require_role
from app.schemas.reviews import ReviewCreate, ReviewOut, ReviewReply
from app.services import reviews as reviews_service
from app.services import service_providers as service_providers_service

router = APIRouter(tags=["reviews"])


@router.post("/reviews", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def create_review(payload: ReviewCreate, current: CurrentProfile = Depends(get_current_profile)):
    return reviews_service.create_review(current.id, payload.model_dump())


@router.get("/me/reviews", response_model=list[ReviewOut])
def list_my_reviews(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return reviews_service.list_provider_reviews(provider["id"])


@router.get("/providers/{provider_id}/reviews", response_model=list[ReviewOut])
def list_provider_reviews(provider_id: str):
    return reviews_service.list_provider_reviews(provider_id)


@router.patch("/reviews/{review_id}/reply", response_model=ReviewOut)
def reply_to_review(
    review_id: str, payload: ReviewReply, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return reviews_service.reply_to_review(review_id, provider["id"], payload.provider_reply)


@router.patch("/reviews/{review_id}/flag", response_model=ReviewOut)
def flag_review(review_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return reviews_service.flag_review(review_id)
