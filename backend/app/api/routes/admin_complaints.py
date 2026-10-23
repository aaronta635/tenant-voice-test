from fastapi import APIRouter, Depends, Query

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.schemas.admin_complaints import (
    AdminComplaintDetailOut,
    AdminComplaintPageOut,
    AssigneeOut,
    ComplaintAssignIn,
    ComplaintStatus,
    ComplaintStatusIn,
    IssueCategoryListOut,
)
from app.schemas.complaints import IssueCategoryActiveIn, IssueCategoryIn, IssueCategoryOut, IssueCategoryUpdate
from app.services import admin_complaints, complaint_categories

# Every route here depends on get_current_admin, as /admin's others do (routes/admin.py).
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/complaints", response_model=AdminComplaintPageOut)
def list_complaints(
    status: ComplaintStatus | None = None,
    category: str | None = Query(default=None, max_length=60),
    assignee: str | None = Query(default=None, max_length=40, description="me, unassigned or an admin's id"),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """Every complaint that is not a repair, newest first."""
    return admin_complaints.list_complaints(current.id, status, category, assignee, q, limit, offset)


@router.get("/complaints/assignees", response_model=list[AssigneeOut])
def complaint_assignees(current: CurrentProfile = Depends(get_current_admin)):
    """The active admins a complaint can be assigned to."""
    return admin_complaints.assignees()


@router.get("/complaints/{complaint_id}", response_model=AdminComplaintDetailOut)
def get_complaint(complaint_id: str, current: CurrentProfile = Depends(get_current_admin)):
    return admin_complaints.detail(complaint_id)


@router.post("/complaints/{complaint_id}/status", response_model=AdminComplaintDetailOut)
def change_complaint_status(
    complaint_id: str, payload: ComplaintStatusIn, current: CurrentProfile = Depends(get_current_admin)
):
    """Move a complaint to another status with a note both parties see; 409 when it changed meanwhile."""
    return admin_complaints.change_status(current.id, complaint_id, payload.status, payload.note, payload.expected_status)


@router.post("/complaints/{complaint_id}/assignment", response_model=AdminComplaintDetailOut)
def assign_complaint(complaint_id: str, payload: ComplaintAssignIn, current: CurrentProfile = Depends(get_current_admin)):
    """Hand a complaint to an active admin, or to nobody."""
    return admin_complaints.assign(current.id, complaint_id, payload.assignee_id, payload.note)


@router.get("/complaint-categories", response_model=IssueCategoryListOut)
def list_categories(current: CurrentProfile = Depends(get_current_admin)):
    """The alert policies (mobile_admin_issue_categories), and the complaint codes a policy can cover."""
    return {"categories": complaint_categories.policies(current.access_token),
            "codes": complaint_categories.code_choices()}


@router.post("/complaint-categories", response_model=IssueCategoryOut, status_code=201)
def create_category(payload: IssueCategoryIn, current: CurrentProfile = Depends(get_current_admin)):
    """A new alert policy, saved by mobile_admin_save_issue_category; its code comes from its name."""
    return complaint_categories.save_policy(current, None, payload.model_dump())


@router.patch("/complaint-categories/{category_id}", response_model=IssueCategoryOut)
def update_category(category_id: str, payload: IssueCategoryUpdate, current: CurrentProfile = Depends(get_current_admin)):
    """Save every field of a policy but its code; 409 when it changed since the admin read it."""
    fields = payload.model_dump(exclude={"expected_updated_at"})
    return complaint_categories.save_policy(current, category_id, fields, payload.expected_updated_at)


@router.post("/complaint-categories/{category_id}/active", response_model=IssueCategoryOut)
def set_category_active(
    category_id: str, payload: IssueCategoryActiveIn, current: CurrentProfile = Depends(get_current_admin)
):
    """Switch a policy on or off: an inactive one raises no new alerts."""
    return complaint_categories.set_active(current, category_id, payload.is_active, payload.reason)
