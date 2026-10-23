from fastapi import APIRouter, Depends, Query

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.schemas.admin_repairs import AdminRepairOut, AdminRepairPageOut, RepairDecisionIn, RepairPriority, RepairStatus
from app.services import admin_repairs

# Every route here depends on get_current_admin, as /admin's others do (routes/admin.py).
router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/repairs", response_model=AdminRepairPageOut)
def list_repairs(
    repair_status: RepairStatus | None = Query(default=None, alias="status"),
    priority: RepairPriority | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """Every repair, newest first, with its parties and the last admin decision on it."""
    return admin_repairs.repair_queue(repair_status, priority, q, limit, offset)


@router.post("/repairs/{repair_id}/decision", response_model=AdminRepairOut)
def decide_repair(repair_id: str, payload: RepairDecisionIn, current: CurrentProfile = Depends(get_current_admin)):
    """Cancel or close a repair with a reason its tenant, owner and provider are told; 409 when it changed meanwhile."""
    return admin_repairs.decide(current.id, repair_id, payload.action, payload.reason, payload.expected_status)
