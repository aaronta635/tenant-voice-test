from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.documents import DocumentKind, DocumentLinkOut, DocumentOut, DocumentsOut, DocumentUpdate, Visibility
from app.services import documents as documents_service

router = APIRouter(prefix="/me/documents", tags=["documents"])

# Every role that keeps documents (verification_rules.ROLE_DOCUMENT_TYPES).
document_owner = require_role("tenant", "landlord", "service_provider")


@router.get("", response_model=DocumentsOut)
def list_my_documents(current: CurrentProfile = Depends(document_owner)):
    return documents_service.list_documents(current.id, current.role)


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form(..., max_length=40),
    label: str | None = Form(default=None, max_length=120),
    visibility: Visibility = Form(default="private"),
    kind: DocumentKind | None = Form(default=None),
    current: CurrentProfile = Depends(document_owner),
):
    """The file and its document in one request: stored first, then saved, or neither."""
    return documents_service.upload(
        current.id, current.role, document_type, file, label=label, visibility=visibility, kind=kind
    )


@router.put("/{document_id}/file", response_model=DocumentOut)
def replace_document_file(
    document_id: str,
    file: UploadFile = File(...),
    current: CurrentProfile = Depends(document_owner),
):
    """A new file for a document, which goes back to review."""
    return documents_service.replace_file(document_id, current.id, current.role, file)


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: str,
    payload: DocumentUpdate,
    current: CurrentProfile = Depends(document_owner),
):
    return documents_service.update_details(
        document_id, current.id, current.role, payload.model_dump(exclude_unset=True)
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, current: CurrentProfile = Depends(document_owner)):
    documents_service.delete(document_id, current.id, current.role)


@router.get("/{document_id}/link", response_model=DocumentLinkOut)
def open_document(document_id: str, response: Response, current: CurrentProfile = Depends(document_owner)):
    """A link to the file that works for a few minutes; ask again to open it later."""
    response.headers["Cache-Control"] = "no-store"
    return documents_service.owner_link(document_id, current.id, current.role)
