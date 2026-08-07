from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.profiles import ProfileOut, ProfileUpdate
from app.services import profiles as profiles_service

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("/me", response_model=ProfileOut)
def read_my_profile(current: CurrentProfile = Depends(get_current_profile)):
    return profiles_service.get_profile(current.id)


@router.patch("/me", response_model=ProfileOut)
def update_my_profile(payload: ProfileUpdate, current: CurrentProfile = Depends(get_current_profile)):
    return profiles_service.update_profile(current.id, payload.model_dump())
