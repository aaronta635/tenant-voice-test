from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.onboarding import OnboardingOut, OnboardingUpdate
from app.services import onboarding as onboarding_service

router = APIRouter(prefix="/me/onboarding", tags=["onboarding"])

member = require_role(*onboarding_service.ROLES)


@router.get("", response_model=OnboardingOut)
def read_my_onboarding(current: CurrentProfile = Depends(member)):
    return onboarding_service.get_progress(current.id, current.role)


@router.put("", response_model=OnboardingOut)
def save_my_onboarding(payload: OnboardingUpdate, current: CurrentProfile = Depends(member)):
    """Where to resume, saved as the member moves through the steps; completed on the last one."""
    return onboarding_service.save_progress(current.id, current.role, payload.step, payload.completed)
