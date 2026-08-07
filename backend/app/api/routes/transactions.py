from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.transactions import TransactionOut
from app.services import service_providers as service_providers_service
from app.services import transactions as transactions_service

router = APIRouter(prefix="/me/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionOut])
def list_my_transactions(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return transactions_service.list_my_transactions(provider["id"])
