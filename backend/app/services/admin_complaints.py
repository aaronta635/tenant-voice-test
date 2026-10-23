"""Complaints as the admin console handles them (tracker R38, R40).

Every complaint that is not a repair (a repair is handled with its work
order, services/maintenance.py), with filters, its whole timeline, status
changes with a note and assignment to an admin. complaints.py writes the
rows and their complaint_events (a general complaint's status through
review_general_complaint); this module checks what an admin may do, tells
both parties what changed (the note is theirs to read; the function tells
a general complaint's tenant itself), and records each decision, with its
actor and note, in both audit logs (admin_audit). The alert policies are
services/complaint_categories.py's.
"""

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.services import admin_audit, complaint_categories, complaints
from app.services._common import select_all
from app.services.admin_users import contains_pattern
from app.services.maps_messaging import is_uuid
from app.services.maps_reviews_complaints import EVENT_ASSIGNED
from app.services.shared_map import web_role

STATUS_CHANGED = "complaint.status_changed"
ASSIGNED = "complaint.assigned"
ENTITY = "complaint"

STATUS_LABELS = {
    "OPEN": "Open",
    "IN_REVIEW": "In review",
    "ESCALATED": "Escalated",
    "RESOLVED": "Resolved",
    "CLOSED": "Closed",
}
# How each party's notice describes a status an admin set.
STATUS_PHRASES = {
    "IN_REVIEW": "is in review",
    "ESCALATED": "was escalated",
    "RESOLVED": "was resolved",
    "CLOSED": "was closed",
}
REOPENED = "was reopened"

NOT_FOUND = "Complaint not found"
NOT_AN_ADMIN = "Choose an active TenantVoice admin."


def _users(user_ids) -> dict[str, dict]:
    user_ids = [user_id for user_id in set(user_ids) if user_id]
    if not user_ids:
        return {}
    rows = (
        get_supabase_client().table("users").select("id, full_name, email, primary_role").in_("id", user_ids)
        .execute().data or []
    )
    return {row["id"]: row for row in rows}


def _party(user_id: str | None, people: dict[str, dict]) -> dict | None:
    if not user_id:
        return None
    person = people.get(user_id) or {}
    return {
        "id": user_id,
        "full_name": person.get("full_name") or person.get("email"),
        "role": web_role(person.get("primary_role")) if person else None,
    }


def _listings_by_property(property_ids) -> dict[str, dict]:
    property_ids = [property_id for property_id in set(property_ids) if property_id]
    if not property_ids:
        return {}
    rows = (
        get_supabase_client().table("listings").select("id, title, property_id, created_at")
        .in_("property_id", property_ids).order("created_at", desc=True).execute().data or []
    )
    newest: dict[str, dict] = {}
    for row in rows:
        newest.setdefault(row["property_id"], row)
    return newest


def _items(rows: list[dict]) -> list[dict]:
    """AdminComplaintOut for complaints rows, with the people, listing and category behind them."""
    labels = complaint_categories.Labels()
    metas = {row["id"]: complaints.metadata_of(row) for row in rows}
    people = _users(
        [row.get("reporter_user_id") for row in rows]
        + [row.get("against_user_id") for row in rows]
        + [meta.get("assigned_admin_id") for meta in metas.values()]
    )
    listings = _listings_by_property(row.get("property_id") for row in rows)
    items = []
    for row in rows:
        meta = metas[row["id"]]
        category = labels.category(row.get("category"))
        listing = listings.get(row.get("property_id")) or {}
        items.append({
            "id": row["id"],
            "subject": meta.get("subject") or category["label"],
            "description": row.get("description") or "",
            "category": category["code"],
            "category_label": category["label"],
            "category_active": category["active"],
            "severity": row.get("severity"),
            "status": row.get("status") or "OPEN",
            "withdrawn": complaints.is_withdrawn(row),
            "lodged_at": row.get("lodged_at"),
            "resolved_at": row.get("resolved_at"),
            "complainant": _party(row.get("reporter_user_id"), people),
            "against": _party(row.get("against_user_id"), people),
            "property_id": row.get("property_id"),
            "listing_id": listing.get("id"),
            "property_title": listing.get("title"),
            "assignee": _party(meta.get("assigned_admin_id"), people),
            "responded": bool(meta.get("response")),
        })
    return items


def list_complaints(admin_id: str, complaint_status: str | None = None, category: str | None = None,
                    assignee: str | None = None, q: str | None = None, limit: int = 20, offset: int = 0) -> dict:
    """One page of complaints, newest first, with the total that match.

    Status, assignee and the search are filters of the query. Repairs and
    the category are told apart from the rows (a category may be stored
    under its code or a source category, in any case), so the page is cut
    from every complaint the query matched.
    """
    def build():
        query = get_supabase_client().table(complaints.TABLE).select(complaints.SELECT)
        if complaint_status:
            query = query.eq("status", complaint_status)
        if assignee == "unassigned":
            query = query.is_("metadata->>assigned_admin_id", "null")
        elif assignee:
            query = query.eq("metadata->>assigned_admin_id", admin_id if assignee == "me" else assignee)
        pattern = contains_pattern(q)
        if pattern:
            query = query.or_(f"description.ilike.{pattern},metadata->>subject.ilike.{pattern}")
        return query.order("lodged_at", desc=True).order("id")

    if assignee not in (None, "me", "unassigned") and not is_uuid(assignee):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose me, unassigned or an admin's id")
    rows = [row for row in select_all(build) if not complaints.is_repair(row)]
    if category:
        labels = complaint_categories.Labels()
        wanted = complaint_categories.key(category)
        rows = [row for row in rows if complaint_categories.key(labels.category(row.get("category"))["code"]) == wanted]
    page = rows[offset:offset + limit]
    return {"items": _items(page), "total": len(rows), "limit": limit, "offset": offset}


def _row(complaint_id: str) -> dict:
    if not is_uuid(complaint_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return complaints.get_row(complaint_id)


def _timeline(complaint_id: str, events: list[dict] | None = None) -> list[dict]:
    """Every step of a complaint, staff-only ones too, oldest first, with who took it."""
    events = complaints.events_for([complaint_id]) if events is None else events
    people = _users(
        [event.get("actor_user_id") for event in events]
        + [(event.get("metadata") or {}).get("assignee_id") for event in events if isinstance(event.get("metadata"), dict)]
    )
    steps = []
    for event in events:
        meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        steps.append({
            "id": event["id"],
            "event_type": event.get("event_type"),
            "note": event.get("note"),
            "from_status": complaints.step_from_status(event),
            "to_status": complaints.step_to_status(event),
            "actor": _party(event.get("actor_user_id"), people),
            "assignee": _party(meta.get("assignee_id"), people) if event.get("event_type") == EVENT_ASSIGNED else None,
            "source": meta.get("source") or "other",
            "created_at": event["created_at"],
        })
    return steps


def detail(complaint_id: str, row: dict | None = None) -> dict:
    """AdminComplaintDetailOut: the complaint, what each party wrote, and its whole timeline."""
    row = row or _row(complaint_id)
    meta = complaints.metadata_of(row)
    evidence = meta.get("evidence_urls") if isinstance(meta.get("evidence_urls"), list) else []
    events = complaints.events_for([row["id"]])
    staff = complaints.staff_ids(event.get("actor_user_id") for event in events)
    return {
        **_items([row])[0],
        "response": meta.get("response"),
        "responded_at": meta.get("responded_at"),
        "resolution_note": complaints.outcome_note(row, events, staff),
        "evidence_urls": [url for url in evidence if isinstance(url, str) and url.startswith(("https://", "http://"))],
        "timeline": _timeline(row["id"], events),
        "transitions": list(complaints.staff_transitions(row)),
        "source": meta.get("source"),
    }


def _respondent(row: dict) -> str | None:
    """The party a complaint is about: whom it names, else the owner of its property."""
    if row.get("against_user_id"):
        return row["against_user_id"]
    if not row.get("property_id"):
        return None
    found = (
        get_supabase_client().table("properties").select("owner_user_id").eq("id", row["property_id"]).limit(1)
        .execute().data
    )
    return found[0]["owner_user_id"] if found else None


def _subject(row: dict) -> str:
    return complaints.metadata_of(row).get("subject") or "a complaint"


def change_status(admin_id: str, complaint_id: str, new_status: str, note: str, seen_status: str | None) -> dict:
    """Move a complaint to another status with a note both parties are told; the complaint as detail()."""
    _row(complaint_id)
    before, after = complaints.staff_set_status(complaint_id, admin_id, new_status, note, seen_status)
    old_status = before.get("status") or "OPEN"
    subject = _subject(after)
    phrase = REOPENED if old_status in complaints.FINISHED else STATUS_PHRASES.get(new_status, "was updated")
    if not complaints.is_general(after):
        # review_general_complaint has told a general complaint's tenant already.
        complaints.tell(after.get("reporter_user_id"), f"Your complaint {phrase}: {subject}", note)
    respondent = _respondent(after)
    if respondent != after.get("reporter_user_id"):
        complaints.tell(respondent, f"A complaint about you {phrase}: {subject}", note)
    admin_audit.record(
        admin_id, STATUS_CHANGED, ENTITY, complaint_id,
        f"Moved the complaint “{subject}” from {STATUS_LABELS.get(old_status, old_status)} to "
        f"{STATUS_LABELS.get(new_status, new_status)}: {note}",
        {"from_status": old_status, "to_status": new_status, "reason": note,
         "category": after.get("category"), "complainant_id": after.get("reporter_user_id"),
         "against_id": respondent},
    )
    return detail(complaint_id, after)


def _active_admin(user_id: str) -> dict:
    found = (
        get_supabase_client().table("users").select("id, full_name, email, primary_role, status, deleted_at")
        .eq("id", user_id).limit(1).execute().data
        if is_uuid(user_id) else []
    )
    if not found or found[0].get("primary_role") != "ADMIN" or found[0].get("status") != "ACTIVE" \
            or found[0].get("deleted_at"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NOT_AN_ADMIN)
    return found[0]


def assign(admin_id: str, complaint_id: str, assignee_id: str | None, note: str | None) -> dict:
    """Hand a complaint to an active admin, or to nobody; the complaint as detail()."""
    _row(complaint_id)
    assignee = _active_admin(assignee_id) if assignee_id else None
    before, after = complaints.staff_assign(complaint_id, admin_id, assignee_id, note)
    if after is not before:
        previous = complaints.metadata_of(before).get("assigned_admin_id")
        subject = _subject(after)
        name = (assignee or {}).get("full_name") or (assignee or {}).get("email") or "an admin"
        summary = f"Assigned the complaint “{subject}” to {name}" if assignee else f"Unassigned the complaint “{subject}”"
        admin_audit.record(
            admin_id, ASSIGNED, ENTITY, complaint_id, f"{summary}: {note}" if note else summary,
            {"assignee_id": assignee_id, "previous_assignee_id": previous, "reason": note},
        )
    return detail(complaint_id, after)


def assignees() -> list[dict]:
    """The active admins a complaint can be handed to, by name."""
    rows = (
        get_supabase_client().table("users").select("id, full_name, email").eq("primary_role", "ADMIN")
        .eq("status", "ACTIVE").is_("deleted_at", "null").order("full_name").order("id").execute().data or []
    )
    return [{"id": row["id"], "full_name": row.get("full_name") or row.get("email") or "Admin", "email": row.get("email")}
            for row in rows]
