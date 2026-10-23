from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_repairs import ProviderRepairOut, RepairCompleteIn, RepairScheduleIn
from app.services import maintenance as maintenance_service

router = APIRouter(prefix="/me/repairs", tags=["maintenance"])

provider_only = require_role("service_provider")


@router.get("", response_model=list[ProviderRepairOut])
def list_my_repairs(current: CurrentProfile = Depends(provider_only)):
    """The repairs owners assigned to the caller, open ones first."""
    return maintenance_service.list_assigned(current.id)


@router.get("/{repair_id}", response_model=ProviderRepairOut)
def get_my_repair(repair_id: str, current: CurrentProfile = Depends(provider_only)):
    return maintenance_service.get_assigned(repair_id, current.id)


@router.post("/{repair_id}/schedule", response_model=ProviderRepairOut)
def schedule_my_repair(repair_id: str, payload: RepairScheduleIn, current: CurrentProfile = Depends(provider_only)):
    """Book or move the visit (mobile_schedule_repair); the tenant and the owner are told."""
    return maintenance_service.schedule_assigned(repair_id, current, payload.model_dump())


@router.post("/{repair_id}/complete", response_model=ProviderRepairOut)
def complete_my_repair(repair_id: str, payload: RepairCompleteIn, current: CurrentProfile = Depends(provider_only)):
    """Mark the job done after its visit (mobile_complete_repair); it waits for the tenant to confirm."""
    return maintenance_service.complete_assigned(repair_id, current, payload.model_dump())
