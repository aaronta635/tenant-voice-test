from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_portfolio import PortfolioItemCreate, PortfolioItemOut, PortfolioItemUpdate
from app.services import provider_portfolio as portfolio_service
from app.services import service_providers as service_providers_service

router = APIRouter(tags=["provider-portfolio"])


@router.get("/me/portfolio", response_model=list[PortfolioItemOut])
def list_my_portfolio(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return portfolio_service.list_my_portfolio(provider["id"])


@router.post("/me/portfolio", response_model=PortfolioItemOut, status_code=status.HTTP_201_CREATED)
def create_my_portfolio_item(
    payload: PortfolioItemCreate, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return portfolio_service.create_portfolio_item(provider["id"], payload.model_dump())


@router.patch("/me/portfolio/{item_id}", response_model=PortfolioItemOut)
def update_my_portfolio_item(
    item_id: str,
    payload: PortfolioItemUpdate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return portfolio_service.update_portfolio_item(item_id, provider["id"], payload.model_dump())


@router.delete("/me/portfolio/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_portfolio_item(item_id: str, current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    portfolio_service.delete_portfolio_item(item_id, provider["id"])


@router.get("/providers/{provider_id}/portfolio", response_model=list[PortfolioItemOut])
def list_provider_portfolio(provider_id: str):
    return portfolio_service.list_public_portfolio(provider_id)
