from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.complaints import (
    ComplaintCreate,
    ComplaintOut,
    ComplaintRespond,
    ComplaintResolve,
    ComplaintUpdate,
    TenancyOut,
)
from app.services import complaints as complaints_service

router = APIRouter(prefix="/complaints", tags=["complaints"])


@router.post("", response_model=ComplaintOut, status_code=status.HTTP_201_CREATED)
def create_complaint(payload: ComplaintCreate, current: CurrentProfile = Depends(get_current_profile)):
    return complaints_service.create_complaint(current.id, payload.model_dump())


@router.get("", response_model=list[ComplaintOut])
def list_my_complaints(
    status: str | None = None, current: CurrentProfile = Depends(get_current_profile)
):
    """Complaints this user has raised."""
    return complaints_service.list_my_complaints(current.id, status)


@router.get("/tenancies", response_model=list[TenancyOut])
def list_complaint_tenancies(current: CurrentProfile = Depends(get_current_profile)):
    """The listings this user may lodge a complaint about: those of their approved applications."""
    return complaints_service.tenancies(current.id)


@router.get("/against-me", response_model=list[ComplaintOut])
def list_complaints_against_me(
    status: str | None = None, current: CurrentProfile = Depends(get_current_profile)
):
    """Complaints raised about this user or any property they own."""
    return complaints_service.list_complaints_against_me(current.id, status)


@router.get("/{complaint_id}", response_model=ComplaintOut)
def get_complaint(complaint_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return complaints_service.get_complaint(complaint_id, current.id, current.role)


@router.patch("/{complaint_id}", response_model=ComplaintOut)
def update_complaint(
    complaint_id: str,
    payload: ComplaintUpdate,
    current: CurrentProfile = Depends(get_current_profile),
):
    return complaints_service.update_complaint(complaint_id, current.id, payload.model_dump())


@router.post("/{complaint_id}/respond", response_model=ComplaintOut)
def respond_to_complaint(
    complaint_id: str,
    payload: ComplaintRespond,
    current: CurrentProfile = Depends(get_current_profile),
):
    return complaints_service.respond_to_complaint(complaint_id, current.id, payload.response)


@router.patch("/{complaint_id}/status", response_model=ComplaintOut)
def set_complaint_status(
    complaint_id: str,
    payload: ComplaintResolve,
    current: CurrentProfile = Depends(get_current_profile),
):
    return complaints_service.set_status(
        complaint_id, current.id, current.role, payload.model_dump()
    )
