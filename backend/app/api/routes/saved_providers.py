from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.saved_providers import SavedProviderCreate, SavedProviderOut
from app.services import saved_providers as saved_providers_service

router = APIRouter(prefix="/me/saved-providers", tags=["saved-providers"])


@router.get("", response_model=list[SavedProviderOut])
def list_saved_providers(current: CurrentProfile = Depends(get_current_profile)):
    return saved_providers_service.list_saved(current.id)


@router.post("", response_model=SavedProviderOut, status_code=status.HTTP_201_CREATED)
def save_provider(payload: SavedProviderCreate, current: CurrentProfile = Depends(get_current_profile)):
    return saved_providers_service.save_provider(current.id, payload.provider_id)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
def unsave_provider(provider_id: str, current: CurrentProfile = Depends(get_current_profile)):
    saved_providers_service.unsave_provider(current.id, provider_id)
