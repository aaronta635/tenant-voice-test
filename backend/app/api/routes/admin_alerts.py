from fastapi import APIRouter, Depends

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.schemas.admin_alerts import AdminAlertOut, AlertEscalateIn, EscalationOut
from app.services import admin_alerts

# Every route here depends on get_current_admin, as /admin's others do (routes/admin.py).
router = APIRouter(prefix="/admin/alerts", tags=["admin"])


@router.get("", response_model=list[AdminAlertOut])
def list_alerts(current: CurrentProfile = Depends(get_current_admin)):
    """The admin alerts not resolved, refreshed from the complaints and policies first."""
    return admin_alerts.list_alerts(current.access_token)


@router.post("/{alert_id}/escalate", response_model=EscalationOut)
def escalate_alert(alert_id: str, payload: AlertEscalateIn, current: CurrentProfile = Depends(get_current_admin)):
    """Refer a critical alert to the Housing Portal with its evidence package."""
    return admin_alerts.escalate(current, alert_id, payload.note)
