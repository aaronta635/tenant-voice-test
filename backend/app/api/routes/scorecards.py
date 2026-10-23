from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile, require_role
from app.schemas.scorecards import (
    ScorecardDecline,
    ScorecardRecipientOut,
    ScorecardRequestCreate,
    ScorecardRequestOut,
    ScorecardSubmit,
    ScorecardVisibility,
)
from app.services import scorecards as scorecards_service

# Tenant scorecards (R43). A request is read only by its tenant and its owner:
# anyone else gets 404 (services/scorecards.py).
router = APIRouter(tags=["scorecards"])

tenant_only = require_role("tenant")
owner_only = require_role("landlord")
either_party = require_role("tenant", "landlord")


@router.get("/me/scorecard-requests", response_model=list[ScorecardRequestOut])
def list_my_scorecard_requests(current: CurrentProfile = Depends(either_party)):
    """A tenant's requests sent, or the requests an owner or agent received; newest first."""
    return scorecards_service.list_mine(current.id, current.role)


@router.get("/me/scorecard-requests/recipients", response_model=list[ScorecardRecipientOut])
def list_scorecard_recipients(current: CurrentProfile = Depends(tenant_only)):
    """The owners and agents of the homes the tenant rents or rented, who may be asked."""
    return scorecards_service.recipients(current.id)


@router.post("/me/scorecard-requests", response_model=ScorecardRequestOut, status_code=status.HTTP_201_CREATED)
def request_scorecard(payload: ScorecardRequestCreate, current: CurrentProfile = Depends(tenant_only)):
    return scorecards_service.request(current.id, str(payload.owner_user_id), str(payload.property_id))


@router.get("/scorecard-requests/{request_id}", response_model=ScorecardRequestOut)
def read_scorecard_request(request_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return scorecards_service.get(request_id, current.id)


@router.post("/scorecard-requests/{request_id}/submit", response_model=ScorecardRequestOut)
def submit_scorecard(request_id: str, payload: ScorecardSubmit, current: CurrentProfile = Depends(owner_only)):
    """The owner's rating for each of the seven items, and an optional comment; final."""
    return scorecards_service.submit(request_id, current.id, payload.answers.model_dump(), payload.comment)


@router.post("/scorecard-requests/{request_id}/decline", response_model=ScorecardRequestOut)
def decline_scorecard(request_id: str, payload: ScorecardDecline, current: CurrentProfile = Depends(owner_only)):
    return scorecards_service.decline(request_id, current.id, payload.reason)


@router.post("/scorecard-requests/{request_id}/cancel", response_model=ScorecardRequestOut)
def cancel_scorecard_request(request_id: str, current: CurrentProfile = Depends(tenant_only)):
    return scorecards_service.cancel(request_id, current.id)


@router.patch("/scorecard-requests/{request_id}", response_model=ScorecardRequestOut)
def set_scorecard_visibility(
    request_id: str, payload: ScorecardVisibility, current: CurrentProfile = Depends(tenant_only)
):
    """Whether a completed scorecard counts on the tenant's public profile."""
    return scorecards_service.set_visibility(request_id, current.id, payload.visible_on_profile)
