from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentProfile, require_role
from app.schemas.audit import AuditEntryOut
from app.services import audit as audit_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditEntryOut])
def list_audit_entries(
    actor_id: str | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    # Admin-only: the trail records who did what across every account.
    current: CurrentProfile = Depends(require_role("admin")),
):
    return audit_service.list_entries(
        limit=limit, offset=offset, actor_id=actor_id, entity_type=entity_type, action=action
    )
