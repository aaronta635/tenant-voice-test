from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_availability import AvailabilityCreate, AvailabilityOut, AvailabilityUpdate
from app.services import provider_availability as availability_service
from app.services import service_providers as service_providers_service

router = APIRouter(tags=["provider-availability"])


@router.get("/me/availability", response_model=list[AvailabilityOut])
def list_my_availability(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return availability_service.list_my_availability(provider["id"])


@router.post("/me/availability", response_model=AvailabilityOut, status_code=status.HTTP_201_CREATED)
def create_my_availability(
    payload: AvailabilityCreate, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return availability_service.create_availability(provider["id"], payload.model_dump())


@router.patch("/me/availability/{availability_id}", response_model=AvailabilityOut)
def update_my_availability(
    availability_id: str,
    payload: AvailabilityUpdate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return availability_service.update_availability(
        availability_id, provider["id"], payload.model_dump(exclude_unset=True)
    )


@router.delete("/me/availability/{availability_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_availability(
    availability_id: str, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    availability_service.delete_availability(availability_id, provider["id"])


@router.get("/providers/{provider_id}/availability", response_model=list[AvailabilityOut])
def list_provider_availability(provider_id: str):
    resolved_id = service_providers_service.require_published(provider_id)
    return availability_service.list_public_availability(resolved_id)


@router.get("/providers/{provider_id}/busy-times", response_model=list[dict[str, str]])
def provider_busy_times(provider_id: str):
    from app.services.bookings import public_busy_times
    resolved_id = service_providers_service.require_published(provider_id)
    return public_busy_times(resolved_id)
