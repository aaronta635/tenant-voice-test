"""Accounts as the admin console lists and manages them (tracker R16).

Accounts are public.users rows; a closed one (deleted_at) is not listed. An
admin may suspend, deactivate or reactivate a member's account, but never
their own and never another staff account (ADMIN or REGULATOR, as the
primary role or any role assignment), which the TenantVoice team manages.

A change is a stamped update of users.status that applies only while the
status is still the one the admin saw, so two admins cannot overwrite each
other unseen. It is recorded, with its actor, reason and from/to, in both
audit logs (admin_audit), and the person is refused from their next request
on (profiles.get_account_by_auth_id). A suspended provider is the exception:
they keep a limited account, and the clients of their confirmed upcoming
bookings are told (admin_providers, tracker assumption #14).
"""

import re

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.services import account_verification, admin_audit, admin_providers, documents
from app.services.maps_identity import STAFF_ROLES
from app.services.shared_map import stamp_update, web_role

# Role filter (a web role) -> the users.primary_role values it lists; agents are landlords.
ROLE_FILTERS = {
    "tenant": ("TENANT",),
    "landlord": ("LANDLORD", "AGENT"),
    "service_provider": ("SERVICE_PROVIDER",),
    "admin": ("ADMIN",),
    "officer": ("REGULATOR",),
}
# The statuses an admin sets; PENDING_VERIFICATION is the database's own.
SETTABLE_STATUSES = ("ACTIVE", "SUSPENDED", "DEACTIVATED")
LIST_COLUMNS = "id, email, full_name, primary_role, status, verification_status, created_at"
MAX_SEARCH = 80

# What PostgREST reads as syntax in an or_() filter (",", "(", ")", quotes,
# ":"), the "*" it reads as a wildcard and has no escape for, and the
# backslash, which would escape what follows it.
_FILTER_SYNTAX = re.compile(r"[,()\"'*:\\]")
_LIKE_WILDCARDS = re.compile(r"([%_])")

SELF = "You can't change the status of your own account."
STAFF = "Staff accounts are managed by the TenantVoice team, not from the admin console."
CLOSED = "This account has been closed."
CHANGED = "This account changed while you were looking at it. Reload it and try again."


def _users():
    return get_supabase_client().table("users")


def contains_pattern(text: str | None) -> str | None:
    """The ilike pattern for "contains text", with its own % and _ escaped; None when nothing is left to search."""
    words = " ".join(_FILTER_SYNTAX.sub(" ", text or "").split())[:MAX_SEARCH].strip()
    if not words:
        return None
    escaped = _LIKE_WILDCARDS.sub(r"\\\1", words)
    return f"%{escaped}%"


def _summary(row: dict, pending: dict[str, int]) -> dict:
    return {
        "id": row["id"],
        "full_name": row.get("full_name") or "",
        "email": row.get("email"),
        "role": web_role(row.get("primary_role")),
        "primary_role": row.get("primary_role"),
        "status": row.get("status"),
        "verification_status": row.get("verification_status"),
        "created_at": row.get("created_at"),
        "pending_documents": pending.get(row["id"], 0),
    }


def list_users(role: str | None = None, account_status: str | None = None, q: str | None = None,
               limit: int = 25, offset: int = 0) -> dict:
    """One page of open accounts, newest first, with the total that match."""
    query = _users().select(LIST_COLUMNS, count="exact").is_("deleted_at", "null")
    if role:
        query = query.in_("primary_role", list(ROLE_FILTERS[role]))
    if account_status:
        query = query.eq("status", account_status)
    pattern = contains_pattern(q)
    if pattern:
        query = query.or_(f"full_name.ilike.{pattern},email.ilike.{pattern}")
    result = query.order("created_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    rows = result.data or []
    pending = documents.pending_by_user([row["id"] for row in rows])
    return {
        "items": [_summary(row, pending) for row in rows],
        "total": result.count if result.count is not None else offset + len(rows),
        "limit": limit,
        "offset": offset,
    }


def _account(user_id: str) -> dict:
    rows = _users().select("*").eq("id", user_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return rows[0]


def _assignments(user_id: str) -> list[dict]:
    return (
        get_supabase_client()
        .table("user_role_assignments")
        .select("role, is_primary")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
        .data
        or []
    )


def _status_lock(user: dict, assignments: list[dict], admin_id: str) -> tuple[int, str] | None:
    """Why this admin may not change the account's status, as (HTTP status, message); None when they may."""
    if user["id"] == admin_id:
        return status.HTTP_403_FORBIDDEN, SELF
    if user.get("primary_role") in STAFF_ROLES or any(row.get("role") in STAFF_ROLES for row in assignments):
        return status.HTTP_403_FORBIDDEN, STAFF
    if user.get("deleted_at"):
        return status.HTTP_409_CONFLICT, CLOSED
    return None


def management_lock(user: dict, admin_id: str) -> tuple[int, str] | None:
    """Why this admin may not decide this account's status or verification; None when they may."""
    return _status_lock(user, _assignments(user["id"]), admin_id)


def get_user(user_id: str, admin_id: str) -> dict:
    """One account, with its roles, documents, verification and status changes, as AdminUserDetailOut."""
    user = _account(user_id)
    assignments = _assignments(user_id)
    lock = _status_lock(user, assignments, admin_id)
    return {
        **_summary(user, documents.pending_by_user([user_id])),
        "phone": user.get("phone"),
        "updated_at": user.get("updated_at"),
        "closed_at": user.get("deleted_at"),
        "roles": [{"role": web_role(row.get("role")), "is_primary": bool(row.get("is_primary"))} for row in assignments],
        "documents": documents.documents_for_admin(user_id),
        "verification": account_verification.account_out(user),
        "status_history": admin_audit.status_history(user_id),
        "status_locked": lock[1] if lock else None,
        "provider": admin_providers.provider_out(user),
    }


def change_status(admin_id: str, user_id: str, new_status: str, reason: str | None) -> dict:
    """Set a member's account status, recorded with who, why and from what; the account as get_user()."""
    if new_status not in SETTABLE_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose active, suspended or deactivated")
    reason = " ".join((reason or "").split()) or None
    if new_status != "ACTIVE" and not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give a reason for suspending or deactivating")
    user = _account(user_id)
    lock = _status_lock(user, _assignments(user_id), admin_id)
    if lock:
        raise HTTPException(*lock)
    old_status = user.get("status")
    notified = 0
    if old_status != new_status:
        refused = admin_providers.enable_lock(user, new_status)
        if refused:
            raise HTTPException(status.HTTP_409_CONFLICT, refused)
        changed = (
            _users()
            .update(stamp_update("users", {"status": new_status}))
            .eq("id", user_id)
            .eq("status", old_status)
            .is_("deleted_at", "null")
            .execute()
            .data
        )
        if not changed:
            raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
        admin_audit.record_status_change(admin_id, changed[0], old_status, new_status, reason)
        notified = admin_providers.after_status_change(changed[0], old_status, new_status)
    return {**get_user(user_id, admin_id), "notified": notified}
