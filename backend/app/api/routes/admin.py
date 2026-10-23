from fastapi import APIRouter, Depends, Query, Response

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.schemas.admin import (
    AccountStatus,
    AdminMeOut,
    AdminOverviewOut,
    AdminUserDetailOut,
    AdminUserPageOut,
    RoleFilter,
    StatusChangeIn,
)
from app.schemas.documents import DocumentLinkOut
from app.schemas.verification import (
    AccountDecisionIn,
    DocumentDecisionIn,
    DocumentDecisionOut,
    QueueRole,
    ReviewStatus,
    VerificationItemOut,
    VerificationQueueOut,
)
from app.services import admin_overview, admin_users, admin_verification
from app.services import documents as documents_service

# Every route here depends on get_current_admin: the check is on the server,
# on each request, whatever the browser shows.
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/me", response_model=AdminMeOut)
def admin_me(current: CurrentProfile = Depends(get_current_admin)):
    """The signed-in admin, for the console's header; 403 for anyone else."""
    return {"id": current.id, "full_name": current.full_name, "email": current.raw.get("email")}


@router.get("/overview", response_model=AdminOverviewOut)
def overview(current: CurrentProfile = Depends(get_current_admin)):
    return admin_overview.overview()


@router.get("/users", response_model=AdminUserPageOut)
def list_users(
    role: RoleFilter | None = None,
    status: AccountStatus | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    return admin_users.list_users(role=role, account_status=status, q=q, limit=limit, offset=offset)


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
def get_user(user_id: str, current: CurrentProfile = Depends(get_current_admin)):
    return admin_users.get_user(user_id, current.id)


@router.post("/users/{user_id}/status", response_model=AdminUserDetailOut)
def change_status(user_id: str, payload: StatusChangeIn, current: CurrentProfile = Depends(get_current_admin)):
    """Suspend, deactivate or reactivate a member's account; a reason is required unless it becomes active."""
    return admin_users.change_status(current.id, user_id, payload.status, payload.reason)


@router.get("/documents/{document_id}/link", response_model=DocumentLinkOut)
def open_document(document_id: str, response: Response, current: CurrentProfile = Depends(get_current_admin)):
    """A link to anyone's document that works for a few minutes; each opening is audited."""
    response.headers["Cache-Control"] = "no-store"
    return documents_service.admin_link(document_id, current.id)


@router.get("/verification", response_model=VerificationQueueOut)
def verification_queue(
    response: Response,
    role: QueueRole = "tenant",
    status: ReviewStatus = "PENDING",
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """A role tab's accounts with documents in one review status, each document with a link for a few minutes."""
    response.headers["Cache-Control"] = "no-store"
    return admin_verification.queue(role, status, limit, offset, current.id, current.access_token)


@router.get("/verification/{user_id}", response_model=VerificationItemOut)
def verification_item(
    user_id: str,
    response: Response,
    status: ReviewStatus = "PENDING",
    current: CurrentProfile = Depends(get_current_admin),
):
    """One account as the queue shows it, read again, as after a decision someone else made first."""
    response.headers["Cache-Control"] = "no-store"
    return admin_verification.item(user_id, status, current.id, current.access_token)


@router.post("/documents/{document_id}/decision", response_model=DocumentDecisionOut)
def decide_document(
    document_id: str, payload: DocumentDecisionIn, current: CurrentProfile = Depends(get_current_admin)
):
    """Approve or reject a document waiting for review; 409 when it changed since the admin saw it."""
    return admin_verification.decide_document(
        current.id, document_id, payload.decision, payload.reason, payload.expected_updated_at
    )


@router.post("/users/{user_id}/verification", response_model=AdminUserDetailOut)
def decide_verification(user_id: str, payload: AccountDecisionIn, current: CurrentProfile = Depends(get_current_admin)):
    """Approve or reject a PENDING account (review_user_verification); a rejection needs a reason."""
    return admin_verification.decide_account(current.id, user_id, payload.decision, payload.reason)
