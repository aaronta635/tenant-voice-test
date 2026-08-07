from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import CurrentProfile, get_current_profile, require_role
from app.schemas.service_providers import (
    ServiceProviderCreate,
    ServiceProviderOut,
    ServiceProviderPublicOut,
    ServiceProviderUpdate,
)
from app.services import service_providers as service_providers_service

router = APIRouter(tags=["service-providers"])


@router.get("/me/provider", response_model=ServiceProviderOut)
def read_my_provider(current: CurrentProfile = Depends(get_current_profile)):
    return service_providers_service.require_provider_by_profile_id(current.id)


@router.post("/me/provider", response_model=ServiceProviderOut, status_code=status.HTTP_201_CREATED)
def create_my_provider(
    payload: ServiceProviderCreate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    return service_providers_service.create_provider(current.id, payload.model_dump())


@router.patch("/me/provider", response_model=ServiceProviderOut)
def update_my_provider(
    payload: ServiceProviderUpdate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return service_providers_service.update_provider(provider["id"], payload.model_dump())


@router.get("/providers", response_model=list[ServiceProviderPublicOut])
def list_providers(
    category: str | None = None,
    location: str | None = None,
    min_rating: float | None = None,
    search: str | None = None,
    sort: str = Query("rating", pattern="^(rating|newest|reviews)$"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return service_providers_service.list_public_providers(
        category=category,
        location=location,
        min_rating=min_rating,
        search=search,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/providers/{provider_id}", response_model=ServiceProviderPublicOut)
def get_provider(provider_id: str):
    return service_providers_service.get_public_provider(provider_id)
