"""Audit trail.

SCOPE.md cross-cutting Base: "Every user action has an audit trail entry
(who, what, when)."

Coverage comes from two places:

  * the AuditMiddleware in app/main.py records every mutating HTTP request, so
    nothing is missed when a new route is added and the author forgets;
  * record() is called directly from service code for events worth naming, so
    the trail reads as business events rather than as an HTTP access log.

Entries live in the web schema's audit_log (supabase/shared/0001_web_schema.sql),
which only the web reads, through GET /audit. The shared
mobile_admin_audit_entries is the mobile admin console's log: the web writes
only review reports there (reviews.flag_review, migration plan §3 b3), and
nothing else until the mobile team agrees what it should hold (§4, decision 6).

Writing the trail must never break the request that produced it — every failure
here is swallowed and logged.
"""

import logging
from typing import Any

from app.core.supabase import get_supabase_client, web_table

logger = logging.getLogger(__name__)

# In the web schema: query it with web_table(TABLE).
TABLE = "audit_log"

# Request paths that would only ever add noise.
IGNORED_PATH_PARTS = ("/health", "/docs", "/openapi", "/redoc")


def record(
    actor_id: str | None,
    action: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Append one entry. Never raises."""
    try:
        web_table(TABLE).insert(
            {
                # A users.id: the column is a foreign key to public.users.
                "actor_id": actor_id,
                "action": action,
                "entity_type": entity_type,
                # The column is uuid; anything non-uuid belongs in metadata.
                "entity_id": entity_id,
                "metadata": metadata or {},
            }
        ).execute()
    except Exception as exc:
        logger.error("audit trail write failed for %s: %s", action, exc)


def list_entries(
    limit: int = 100,
    offset: int = 0,
    actor_id: str | None = None,
    entity_type: str | None = None,
    action: str | None = None,
) -> list[dict]:
    """Admin-only read (see the route). Newest first."""
    query = web_table(TABLE).select("*")
    if actor_id:
        query = query.eq("actor_id", actor_id)
    if entity_type:
        query = query.eq("entity_type", entity_type)
    if action:
        query = query.eq("action", action)

    rows = (
        query.order("created_at", desc=True).range(offset, offset + limit - 1).execute().data or []
    )
    if not rows:
        return []

    actor_ids = list({r["actor_id"] for r in rows if r.get("actor_id")})
    name_by_id: dict[str, str] = {}
    if actor_ids:
        people = (
            get_supabase_client()
            .table("users")
            .select("id, full_name")
            .in_("id", actor_ids)
            .execute()
            .data
            or []
        )
        name_by_id = {p["id"]: p["full_name"] for p in people}

    for row in rows:
        row["actor_name"] = name_by_id.get(row.get("actor_id"))
    return rows
