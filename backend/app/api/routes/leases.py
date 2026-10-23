"""Leases (tracker R26): the owner drafts and sends, the tenant confirms and signs, the owner signs and activates.

Every route answers only the lease's two parties (services/leases.py); anyone
else gets 404, and the wrong party for a step 403.
"""

import unicodedata
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Response, UploadFile, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.leases import (
    LeaseCandidateOut,
    LeaseConfirm,
    LeaseDocumentForm,
    LeaseDocumentSend,
    LeaseDraftCreate,
    LeaseOut,
    LeaseOwnerSign,
    LeasePreviewOut,
    LeaseTenantSign,
)
from app.services import leases as leases_service

router = APIRouter(prefix="/leases", tags=["leases"])

party = require_role("tenant", "landlord")
owner = require_role("landlord")
tenant = require_role("tenant")


def inline_disposition(name: str) -> str:
    """Content-Disposition for a stored file name, in any script (RFC 6266 with RFC 5987's filename*).

    The mobile app registers whatever name a PDF had, such as "John’s lease.pdf"
    or one in Vietnamese, but a header must be latin-1 and CR or LF would split
    it. So control characters go, filename is an ASCII stand-in, and filename*
    carries the name itself, percent-encoded as UTF-8.
    """
    clean = "".join(char for char in name if not unicodedata.category(char).startswith("C"))
    folded = "".join(char for char in unicodedata.normalize("NFKD", clean) if not unicodedata.combining(char))
    fallback = "".join(char if " " <= char <= "~" and char not in '"\\' else "_" for char in folded)
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(clean, safe='')}"


@router.get("", response_model=list[LeaseOut])
def list_leases(current: CurrentProfile = Depends(party)):
    return leases_service.list_leases(current)


@router.get("/candidates", response_model=list[LeaseCandidateOut])
def list_candidates(current: CurrentProfile = Depends(owner)):
    """The owner's approved applications that have no lease yet."""
    return leases_service.candidates(current)


@router.post("", response_model=LeaseOut, status_code=status.HTTP_201_CREATED)
def create_draft(payload: LeaseDraftCreate, response: Response, current: CurrentProfile = Depends(owner)):
    """Draft the lease of an approved application; a repeated request answers 200 with the same draft."""
    lease, created = leases_service.create_draft(current, payload.model_dump())
    if not created:
        response.status_code = status.HTTP_200_OK
    return lease


@router.get("/{agreement_id}", response_model=LeaseOut)
def get_lease(agreement_id: str, current: CurrentProfile = Depends(party)):
    return leases_service.get_lease(agreement_id, current)


@router.post("/{agreement_id}/document/preview", response_model=LeasePreviewOut)
def preview_document(agreement_id: str, payload: LeaseDocumentForm, response: Response,
                     current: CurrentProfile = Depends(owner)):
    """The PDF the guided form makes, with its SHA-256; nothing is stored."""
    response.headers["Cache-Control"] = "no-store"
    return leases_service.preview(current, agreement_id, payload.model_dump(mode="json"))


@router.post("/{agreement_id}/document", response_model=LeaseOut)
def send_document(agreement_id: str, payload: LeaseDocumentSend, current: CurrentProfile = Depends(owner)):
    """Send the guided form's PDF to the tenant: it must be the one previewed (preview_sha256)."""
    form = payload.model_dump(mode="json", exclude={"preview_sha256"})
    return leases_service.send_generated(current, agreement_id, form, payload.preview_sha256)


@router.post("/{agreement_id}/document/upload", response_model=LeaseOut)
def upload_document(agreement_id: str, file: UploadFile = File(...), current: CurrentProfile = Depends(owner)):
    """Send a PDF made elsewhere to the tenant."""
    return leases_service.send_uploaded(current, agreement_id, file)


@router.get("/{agreement_id}/documents/{document_id}/file")
def open_document(agreement_id: str, document_id: str, current: CurrentProfile = Depends(party)):
    """The latest lease PDF, for its two parties only; never a Storage link (the bucket is public)."""
    data, filename = leases_service.document_file(current, agreement_id, document_id)
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": inline_disposition(filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })


@router.post("/{agreement_id}/confirm", response_model=LeaseOut)
def confirm_terms(agreement_id: str, payload: LeaseConfirm, current: CurrentProfile = Depends(tenant)):
    return leases_service.confirm(current, agreement_id, payload.document_id)


@router.post("/{agreement_id}/sign", response_model=LeaseOut)
def sign(agreement_id: str, payload: LeaseTenantSign, current: CurrentProfile = Depends(tenant)):
    return leases_service.tenant_sign(current, agreement_id, payload.document_id, payload.signer_name)


@router.post("/{agreement_id}/owner-signature", response_model=LeaseOut)
def owner_sign(agreement_id: str, payload: LeaseOwnerSign, current: CurrentProfile = Depends(owner)):
    return leases_service.owner_sign(current, agreement_id, payload.signer_name)


@router.post("/{agreement_id}/activate", response_model=LeaseOut)
def activate(agreement_id: str, current: CurrentProfile = Depends(owner)):
    return leases_service.activate(current, agreement_id)
