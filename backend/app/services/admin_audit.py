"""Admin actions on accounts, recorded in both audit logs (tracker R16, R17).

Each action is one entry in the web's audit_log (audit.record) and one in the
shared mobile_admin_audit_entries, which the mobile admin console reads, as
review reports already are (reviews.flag_review). Both name the actor, and
the time is each row's created_at. Neither write may undo the action it
records, which has already happened, so a failed write is logged as an error.
"""

import logging

from app.core.supabase import get_supabase_client
from app.services import audit
from app.services.shared_map import stamp_insert, web_role

ENTRIES = "mobile_admin_audit_entries"
STATUS_CHANGED = "user.status_changed"
VERIFICATION_DECIDED = "user.verification_decided"
HISTORY_LIMIT = 20

ROLE_LABELS = {
    "tenant": "tenant",
    "landlord": "landlord",
    "service_provider": "service provider",
    "admin": "admin",
    "officer": "officer",
}

logger = logging.getLogger(__name__)


def record(actor_id: str, action: str, entity_type: str, entity_id: str, summary: str, metadata: dict) -> None:
    """One admin action in both logs. Never raises."""
    audit.record(actor_id, action, entity_type, entity_id, metadata)
    try:
        entry = stamp_insert(ENTRIES, {
            "actor_user_id": actor_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "summary": summary,
            "metadata": {"source": "web", **metadata},
        })
        get_supabase_client().table(ENTRIES).insert(entry).execute()
    except Exception as exc:
        logger.error("admin audit entry write failed for %s: %s", action, exc)


def _verb(old: str, new: str) -> str:
    if new == "SUSPENDED":
        return "Suspended"
    if new == "DEACTIVATED":
        return "Deactivated"
    return "Reactivated" if old in ("SUSPENDED", "DEACTIVATED") else "Activated"


def _target(target: dict) -> tuple[str, str]:
    """(web role, "Name (role)") of the account an action was on."""
    role = web_role(target.get("primary_role"))
    name = (target.get("full_name") or "").strip() or target.get("email") or "an account"
    return role, f"{name} ({ROLE_LABELS.get(role, role)})"


def record_status_change(actor_id: str, target: dict, old: str, new: str, reason: str | None) -> None:
    """An account's status change: who made it, on whom, from and to what, and why."""
    role, named = _target(target)
    summary = f"{_verb(old, new)} {named}"
    record(
        actor_id, STATUS_CHANGED, "user", target["id"],
        f"{summary}: {reason}" if reason else summary,
        {"from_status": old, "to_status": new, "reason": reason, "target_role": role},
    )


def record_verification_decision(actor_id: str, target: dict, old: str | None, new: str, reason: str | None) -> None:
    """An admin's decision on an account's verification, recorded as a status change is (R17).

    from_status and to_status are users.verification_status values.
    """
    role, named = _target(target)
    summary = f"{'Approved' if new == 'APPROVED' else 'Rejected'} the verification of {named}"
    record(
        actor_id, VERIFICATION_DECIDED, "user", target["id"],
        f"{summary}: {reason}" if reason else summary,
        {"from_status": old, "to_status": new, "reason": reason, "target_role": role},
    )


def status_history(user_id: str) -> list[dict]:
    """An account's status changes, newest first, from the shared admin log, with each actor's name."""
    rows = (
        get_supabase_client()
        .table(ENTRIES)
        .select("id, actor_user_id, metadata, created_at, actor:users!actor_user_id(full_name)")
        .eq("entity_type", "user")
        .eq("entity_id", user_id)
        .eq("action", STATUS_CHANGED)
        .order("created_at", desc=True)
        .order("id")
        .limit(HISTORY_LIMIT)
        .execute()
        .data
        or []
    )
    history = []
    for row in rows:
        meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        actor = row.get("actor") if isinstance(row.get("actor"), dict) else {}
        history.append({
            "from_status": meta.get("from_status"),
            "to_status": meta.get("to_status"),
            "reason": meta.get("reason"),
            "actor_id": row.get("actor_user_id"),
            "actor_name": actor.get("full_name"),
            "created_at": row["created_at"],
        })
    return history
