"""The admin console's activity log (tracker R40): both audit logs, filtered and paged.

The two logs are read apart. The shared mobile_admin_audit_entries holds
the admin decisions of both apps, each with a summary (admin_audit); a
member's report of a review goes into the review through
mobile_report_review, not here. The web's audit_log holds every change a
web request made (AuditMiddleware) and the events service code names
(audit.record). Every admin decision the web makes is in both, so a merged
list would show it twice.

Dates are calendar days in Sydney, as the console shows times.
"""

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, web_table
from app.services import admin_audit, audit
from app.services.admin_users import MAX_SEARCH, contains_pattern
from app.services.maps_messaging import filter_time, is_uuid
from app.services.shared_map import web_role

LOCAL_TZ = ZoneInfo("Australia/Sydney")
ADMIN_LOG = "admin"
WEB_LOG = "web"
# The people an actor search may match; a wider search is narrowed first.
ACTOR_MATCHES = 50
# The metadata a log entry shows: plain values only, each cut short.
DETAIL_KEYS = 12
DETAIL_LENGTH = 300
# LIKE's own wildcards and its escape: all a one-column ilike's text needs escaped.
_LIKE_SPECIAL = re.compile(r"([\\%_])")


def _start_of(day: date) -> str:
    return filter_time(datetime.combine(day, time.min, tzinfo=LOCAL_TZ))


def _actor_ids(actor: str) -> list[str]:
    """The users an actor filter names: an id, or the people whose name or email contains it."""
    if is_uuid(actor):
        return [actor]
    pattern = contains_pattern(actor)
    if not pattern:
        return []
    rows = (
        get_supabase_client().table("users").select("id").or_(f"full_name.ilike.{pattern},email.ilike.{pattern}")
        .order("id").limit(ACTOR_MATCHES).execute().data or []
    )
    return [row["id"] for row in rows]


def _details(metadata) -> dict:
    if not isinstance(metadata, dict):
        return {}
    details = {}
    for key, value in metadata.items():
        if len(details) == DETAIL_KEYS:
            break
        if isinstance(value, str):
            details[key] = value[:DETAIL_LENGTH]
        elif isinstance(value, (bool, int, float)) or value is None:
            details[key] = value
    return details


def _people(user_ids) -> dict[str, dict]:
    user_ids = [user_id for user_id in set(user_ids) if user_id]
    if not user_ids:
        return {}
    rows = (
        get_supabase_client().table("users").select("id, full_name, email, primary_role").in_("id", user_ids)
        .execute().data or []
    )
    return {row["id"]: row for row in rows}


def _summary(log: str, row: dict) -> str | None:
    if log == ADMIN_LOG:
        return row.get("summary")
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    if meta.get("method") and meta.get("path"):
        return f"{meta['method']} {meta['path']}"
    return None


def _contains(text: str | None) -> str | None:
    """The ilike pattern for "contains text" in one column, as the log shows it: "post:/api/v1/complaints".

    A one-column filter is no or_() list, so a colon or a comma is kept (contains_pattern drops
    them); only %, _ and the backslash are escaped. None when nothing is left to search.
    """
    words = " ".join((text or "").split())[:MAX_SEARCH].strip()
    if not words:
        return None
    escaped = _LIKE_SPECIAL.sub(r"\\\1", words)
    return f"%{escaped}%"


def activity(log: str, actor: str | None = None, action: str | None = None, entity_type: str | None = None,
             since: date | None = None, until: date | None = None, limit: int = 25, offset: int = 0) -> dict:
    """ActivityPageOut: one log's entries, newest first, with the total that match."""
    if since and until and until < since:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end date is before the start date.")
    if log == ADMIN_LOG:
        query = get_supabase_client().table(admin_audit.ENTRIES).select(
            "id, actor_user_id, action, entity_type, entity_id, summary, metadata, created_at", count="exact")
        actor_column = "actor_user_id"
    else:
        query = web_table(audit.TABLE).select("id, actor_id, action, entity_type, entity_id, metadata, created_at",
                                             count="exact")
        actor_column = "actor_id"
    empty = {"log": log, "items": [], "total": 0, "limit": limit, "offset": offset}
    if actor:
        ids = _actor_ids(actor)
        if not ids:
            return empty
        query = query.in_(actor_column, ids)
    pattern = _contains(action)
    if action and not pattern:
        return empty
    if pattern:
        query = query.ilike("action", pattern)
    if entity_type:
        query = query.eq("entity_type", entity_type)
    if since:
        query = query.gte("created_at", _start_of(since))
    if until:
        query = query.lt("created_at", _start_of(until + timedelta(days=1)))
    result = query.order("created_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    rows = result.data or []
    people = _people(row.get(actor_column) for row in rows)
    items = []
    for row in rows:
        actor_id = row.get(actor_column)
        person = people.get(actor_id) or {}
        items.append({
            "id": row["id"],
            "log": log,
            "actor": {
                "id": actor_id,
                "full_name": person.get("full_name") or person.get("email"),
                "role": web_role(person.get("primary_role")) if person else None,
            } if actor_id else None,
            "action": row.get("action"),
            "entity_type": row.get("entity_type"),
            "entity_id": row.get("entity_id"),
            "summary": _summary(log, row),
            "details": _details(row.get("metadata")),
            "created_at": row["created_at"],
        })
    return {**empty, "items": items, "total": result.count if result.count is not None else offset + len(rows)}
