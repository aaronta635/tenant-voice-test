from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.verification_documents import (
    VerificationDocumentCreate,
    VerificationDocumentOut,
    VerificationDocumentUpdate,
)
from app.services import service_providers as service_providers_service
from app.services import verification_documents as verification_documents_service

router = APIRouter(prefix="/me/verification-documents", tags=["verification-documents"])


@router.get("", response_model=list[VerificationDocumentOut])
def list_my_documents(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return verification_documents_service.list_my_documents(provider["id"])


@router.post("", response_model=VerificationDocumentOut, status_code=status.HTTP_201_CREATED)
def create_my_document(
    payload: VerificationDocumentCreate, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return verification_documents_service.create_document(provider["id"], payload.model_dump())


@router.patch("/{document_id}", response_model=VerificationDocumentOut)
def update_my_document(
    document_id: str,
    payload: VerificationDocumentUpdate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return verification_documents_service.update_document(document_id, provider["id"], payload.model_dump())


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_document(document_id: str, current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    verification_documents_service.delete_document(document_id, provider["id"])
