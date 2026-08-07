from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.dashboard import OwnerDashboardOut, ProviderDashboardOut, ProviderFinanceOut
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
