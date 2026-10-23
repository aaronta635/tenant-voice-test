from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_services import ProviderServiceCreate, ProviderServiceOut, ProviderServiceUpdate
from app.services import provider_services as provider_services_service
from app.services import service_providers as service_providers_service

router = APIRouter(tags=["provider-services"])


@router.get("/me/services", response_model=list[ProviderServiceOut])
def list_my_services(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return provider_services_service.list_my_services(provider["id"])


@router.post("/me/services", response_model=ProviderServiceOut, status_code=status.HTTP_201_CREATED)
def create_my_service(
    payload: ProviderServiceCreate, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return provider_services_service.create_service(provider["id"], payload.model_dump(), current.access_token)


@router.patch("/me/services/{service_id}", response_model=ProviderServiceOut)
def update_my_service(
    service_id: str,
    payload: ProviderServiceUpdate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    # Only the fields sent change; a null clears an optional one.
    return provider_services_service.update_service(
        service_id, provider["id"], payload.model_dump(exclude_unset=True), current.access_token
    )


@router.delete("/me/services/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_service(service_id: str, current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    # Archived, not deleted: its bookings keep the service they name.
    provider_services_service.delete_service(service_id, provider["id"], current.access_token)


@router.get("/providers/{provider_id}/services", response_model=list[ProviderServiceOut])
def list_provider_services(provider_id: str):
    resolved_id = service_providers_service.require_published(provider_id)
    return provider_services_service.list_public_services(resolved_id)
