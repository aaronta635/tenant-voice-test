"""Admin alerts: complaints past their alert policy's limits (tracker R39, R41).

mobile_admin_alerts lists them, run as the admin (user_client): it first
runs mobile_admin_refresh_alerts, which raises or updates one
mobile_admin_alerts row per unresolved complaint an active policy covers
(services/complaint_categories.py) once it passes the policy's response time
(sla_hours), or repeats at its property (2 or more open in 30 days) or across
its owner's properties (3 or more in 90 days), and resolves the alerts of
complaints since resolved. An alert is CRITICAL when the complaint or the
policy is, when it is open twice its response time (48 hours at least), or
on 3 at a property or 4 for an owner; otherwise HIGH.

A critical alert can be referred to the Housing Portal through
mobile_admin_escalate_alert, which marks it ESCALATED, prepares the referral
package (mobile_admin_referral_packages: the complaint, property, parties
and evidence, with a TV- case reference), tells the housing officers the
first time, and records the action in mobile_admin_audit_entries; the web's
audit_log gets it too.
"""

from app.core.supabase import user_client
from app.services import audit
from app.services.complaint_categories import run_rpc

ESCALATED = "admin_alert.escalated"
ENTITY = "admin_alert"


def alert_out(item: dict) -> dict:
    """AdminAlertOut from an alert as mobile_admin_alerts returns it."""
    return {
        "id": item["id"],
        "complaint_id": item.get("complaintId"),
        "category_id": item.get("categoryId"),
        "category_name": item.get("categoryName"),
        "routing_team": item.get("routingTeam"),
        "severity": item.get("severity"),
        "status": item.get("status"),
        "title": item.get("title") or "Complaint",
        "reason": item.get("reason") or "",
        "address": item.get("address"),
        "area": item.get("area"),
        "days_open": item.get("daysOpen") or 0,
        "property_open_complaints": item.get("propertyOpenComplaints") or 0,
        "owner_open_complaints": item.get("ownerOpenComplaints") or 0,
        "photo_count": item.get("photoCount") or 0,
        "documents_verified": bool(item.get("documentsVerified")),
        "created_at": item.get("createdAt"),
        "updated_at": item.get("updatedAt"),
        "escalated_at": item.get("escalatedAt"),
        "escalation_note": item.get("escalationNote"),
    }


def list_alerts(access_token: str) -> list[dict]:
    """The alerts not resolved, open ones first, critical first, newest first; refreshed by the call."""
    found = run_rpc(user_client(access_token).rpc("mobile_admin_alerts", {}))
    return [alert_out(item) for item in (found if isinstance(found, list) else [])]


def escalate(current, alert_id: str, note: str | None) -> dict:
    """Refer a critical alert to the Housing Portal; EscalationOut. Again for an escalated one updates its package."""
    note = " ".join((note or "").split()) or None
    result = run_rpc(user_client(current.access_token).rpc(
        "mobile_admin_escalate_alert", {"p_alert_id": alert_id, "p_note": note},
    ))
    result = result if isinstance(result, dict) else {}
    audit.record(current.id, ESCALATED, ENTITY, alert_id, {
        "note": note, "case_reference": result.get("caseReference"),
        "housing_portal_status": result.get("housingPortalStatus"),
    })
    return {
        "id": result.get("id") or alert_id,
        "status": result.get("status"),
        "escalated_at": result.get("escalatedAt"),
        "escalation_note": result.get("escalationNote"),
        "housing_portal_status": result.get("housingPortalStatus"),
        "case_reference": result.get("caseReference"),
    }
