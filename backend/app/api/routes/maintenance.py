from fastapi import APIRouter, Depends, File, UploadFile, status

from app.core.deps import CurrentProfile, get_current_profile, require_role
from app.schemas.maintenance import (
    MaintenanceAssign,
    MaintenanceCreate,
    MaintenanceOut,
    MaintenanceStatusUpdate,
    MaintenanceUpdate,
    RepairHomeOut,
    RepairPhotoOut,
    RepairProviderOut,
    RepairRatingIn,
    RepairResolveIn,
)
from app.services import maintenance as maintenance_service

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

# A repair is reported by its tenant or logged by its owner. An agent who owns
# a home sees its repairs but takes no owner step: the shared functions take a
# LANDLORD account only (maintenance.OWNER_STEP_ROLE).
reporters = require_role("tenant", "landlord")


@router.post("", response_model=MaintenanceOut, status_code=status.HTTP_201_CREATED)
def create_request(payload: MaintenanceCreate, current: CurrentProfile = Depends(reporters)):
    """A tenant's report (mobile_create_repair) or an owner's log (mobile_owner_create_repair)."""
    return maintenance_service.create_request(current, payload.model_dump())


@router.get("/homes", response_model=list[RepairHomeOut])
def list_repair_homes(current: CurrentProfile = Depends(reporters)):
    """The homes the caller can report a repair for."""
    return maintenance_service.repair_homes(current)


@router.post("/photos", response_model=RepairPhotoOut, status_code=status.HTTP_201_CREATED)
def upload_repair_photo(file: UploadFile = File(...), current: CurrentProfile = Depends(reporters)):
    """One photo for a new repair, in the caller's repair-photos folder; its path goes in photos."""
    return maintenance_service.store_photo(file, current.id)


@router.get("", response_model=list[MaintenanceOut])
def list_my_requests(
    status: str | None = None, current: CurrentProfile = Depends(get_current_profile)
):
    """The caller's requests, from whichever side of the job they are on."""
    if current.role == "landlord":
        return maintenance_service.list_for_owner(current.id, status)
    if current.role == "service_provider":
        return maintenance_service.list_for_provider(current.id, status)
    return maintenance_service.list_for_tenant(current.id, status)


@router.get("/{request_id}", response_model=MaintenanceOut)
def get_request(request_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return maintenance_service.get_request(request_id, current.id)


@router.patch("/{request_id}", response_model=MaintenanceOut)
def update_request(
    request_id: str,
    payload: MaintenanceUpdate,
    current: CurrentProfile = Depends(require_role("tenant")),
):
    return maintenance_service.update_request(request_id, current.id, payload.model_dump())


@router.get("/{request_id}/providers", response_model=list[RepairProviderOut])
def list_assignable_providers(request_id: str, current: CurrentProfile = Depends(require_role("landlord"))):
    """The approved, active providers whose categories hold the repair's (mobile_repair_providers)."""
    return maintenance_service.assignable_providers(request_id, current)


@router.post("/{request_id}/assign", response_model=MaintenanceOut)
def assign_provider(
    request_id: str,
    payload: MaintenanceAssign,
    current: CurrentProfile = Depends(require_role("landlord")),
):
    return maintenance_service.assign_provider(request_id, current, payload.provider_id)


@router.post("/{request_id}/resolve", response_model=MaintenanceOut)
def resolve_request(
    request_id: str, payload: RepairResolveIn, current: CurrentProfile = Depends(require_role("landlord")),
):
    """The owner marking the repair resolved (mobile_resolve_repair); the tenant may rate it then."""
    return maintenance_service.resolve(request_id, current, payload.note)


@router.post("/{request_id}/confirm", response_model=MaintenanceOut)
def confirm_request(
    request_id: str, payload: RepairRatingIn, current: CurrentProfile = Depends(require_role("tenant")),
):
    """The tenant confirming the work the provider marked done, with a rating of 1 to 5."""
    return maintenance_service.confirm(request_id, current, payload.rating)


@router.post("/{request_id}/rate", response_model=MaintenanceOut)
def rate_request(
    request_id: str, payload: RepairRatingIn, current: CurrentProfile = Depends(require_role("tenant")),
):
    """The tenant rating a repair the owner resolved."""
    return maintenance_service.rate(request_id, current, payload.rating)


@router.patch("/{request_id}/status", response_model=MaintenanceOut)
def set_status(
    request_id: str,
    payload: MaintenanceStatusUpdate,
    current: CurrentProfile = Depends(get_current_profile),
):
    return maintenance_service.set_status(request_id, current, payload.model_dump())
