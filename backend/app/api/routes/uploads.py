from fastapi import APIRouter, Depends, File, UploadFile, status

from app.core.deps import CurrentProfile, get_current_profile, require_role
from app.schemas.uploads import UploadOut
from app.services import properties as properties_service
from app.services import service_providers as service_providers_service
from app.services import uploads as uploads_service

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/message-attachment", response_model=UploadOut)
def upload_message_attachment(
    file: UploadFile = File(...),
    current: CurrentProfile = Depends(get_current_profile),
):
    return uploads_service.store_message_attachment(file, current.id)


@router.post("/verification-document", response_model=UploadOut)
def upload_verification_document(
    file: UploadFile = File(...),
    current: CurrentProfile = Depends(require_role("service_provider", "tenant", "landlord")),
):
    if current.role == "service_provider":
        # A provider's credentials are saved against their provider profile;
        # without one the file could never be attached, so it isn't stored.
        service_providers_service.require_provider_by_profile_id(current.id)
    return uploads_service.store_verification_document(file, current.id)


@router.post("/property-image", response_model=UploadOut)
def upload_property_image(
    file: UploadFile = File(...),
    current: CurrentProfile = Depends(require_role("landlord")),
):
    """A listing photo for the create-listing wizard: url is public and goes in photo_urls."""
    return uploads_service.store_property_image(file, current.id)


@router.delete("/property-image", status_code=status.HTTP_204_NO_CONTENT)
def discard_property_image(url: str, current: CurrentProfile = Depends(require_role("landlord"))):
    """Delete a photo the caller uploaded that no listing shows, such as one removed in the wizard."""
    properties_service.discard_uploaded_photo(url, current.id)
