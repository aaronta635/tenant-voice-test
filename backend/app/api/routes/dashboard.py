from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.dashboard import (
    ListingAnalyticsOut,
    OwnerBadgesOut,
    OwnerDashboardOut,
    ProviderDashboardOut,
    ProviderFinanceOut,
    TenantDashboardOut,
)
from app.services import dashboard as dashboard_service
from app.services import service_providers as service_providers_service

router = APIRouter(prefix="/me/dashboard", tags=["dashboard"])


@router.get("/provider", response_model=ProviderDashboardOut)
def provider_dashboard(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return dashboard_service.provider_dashboard(current.id, provider)


@router.get("/provider/finance", response_model=ProviderFinanceOut)
def provider_finance(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return dashboard_service.provider_finance(provider["id"])


@router.get("/owner", response_model=OwnerDashboardOut)
def owner_dashboard(current: CurrentProfile = Depends(require_role("landlord"))):
    return dashboard_service.owner_dashboard(current.id)


@router.get("/owner/badges", response_model=OwnerBadgesOut)
def owner_badges(current: CurrentProfile = Depends(require_role("landlord"))):
    """The counts the owner shell shows on every page, without the rest of the dashboard."""
    return dashboard_service.owner_badges(current.id)


@router.get("/owner/properties/{property_id}", response_model=ListingAnalyticsOut)
def listing_analytics(
    property_id: str,
    days: int = Query(30, description="7, 30 or 90"),
    current: CurrentProfile = Depends(require_role("landlord")),
):
    """One listing's views day by day, favourites, applications, inspection bookings, reviews and lease."""
    if days not in dashboard_service.ANALYTICS_DAYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose 7, 30 or 90 days.")
    return dashboard_service.listing_analytics(property_id, current.id, days)


@router.get("/tenant", response_model=TenantDashboardOut)
def tenant_dashboard(current: CurrentProfile = Depends(require_role("tenant"))):
    return dashboard_service.tenant_dashboard(current)
