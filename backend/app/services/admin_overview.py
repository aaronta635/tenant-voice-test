"""The admin console's overview (tracker R16): accounts by role and status, and documents waiting for review.

Counts come from the rows themselves, read a page at a time, so they match
the users list and the documents queue. Closed accounts (deleted_at) are
counted apart, never with a role.
"""

from app.core.supabase import get_supabase_client
from app.services import _common, documents
from app.services.shared_map import web_role

ROLE_ORDER = ("tenant", "landlord", "service_provider", "admin", "officer")
STATUS_FIELDS = {
    "ACTIVE": "active",
    "PENDING_VERIFICATION": "pending_verification",
    "SUSPENDED": "suspended",
    "DEACTIVATED": "deactivated",
}


def overview() -> dict:
    """AdminOverviewOut: open accounts per role and status, closed accounts, and pending documents."""
    users = _common.select_all(
        lambda: get_supabase_client().table("users").select("id, primary_role, status, deleted_at").order("id")
    )
    open_users = [user for user in users if not user.get("deleted_at")]
    roles = {role: {"role": role, "total": 0, **{field: 0 for field in STATUS_FIELDS.values()}} for role in ROLE_ORDER}
    for user in open_users:
        role = web_role(user.get("primary_role"))
        counts = roles.setdefault(role, {"role": role, "total": 0, **{field: 0 for field in STATUS_FIELDS.values()}})
        counts["total"] += 1
        field = STATUS_FIELDS.get(user.get("status"))
        if field:
            counts[field] += 1
    pending, people = documents.pending_summary()
    return {
        "users_total": len(open_users),
        "closed_accounts": len(users) - len(open_users),
        "roles": list(roles.values()),
        "pending_documents": pending,
        "pending_document_people": people,
    }
