from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.property_applications import ApplicationCreate, ApplicationOut, ApplicationUpdate
from app.services import property_applications as applications_service

router = APIRouter(tags=["property-applications"])


@router.post("/applications", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, current: CurrentProfile = Depends(require_role("tenant"))):
    return applications_service.create_application(current.id, payload.model_dump(mode="json"))


@router.get("/applications", response_model=list[ApplicationOut])
def list_my_applications(current: CurrentProfile = Depends(require_role("tenant"))):
    return applications_service.list_my_applications(current.id)


@router.delete("/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_application(application_id: str, current: CurrentProfile = Depends(require_role("tenant"))):
    applications_service.withdraw_application(application_id, current.id)


@router.get("/properties/{property_id}/applications", response_model=list[ApplicationOut])
def list_property_applications(
    property_id: str,
    status: str | None = None,
    current: CurrentProfile = Depends(require_role("landlord")),
):
    return applications_service.list_property_applications(property_id, current.id, status)


@router.patch("/applications/{application_id}", response_model=ApplicationOut)
def update_application(
    application_id: str,
    payload: ApplicationUpdate,
    current: CurrentProfile = Depends(require_role("landlord")),
):
    return applications_service.update_application(application_id, current.id, payload.model_dump())
