"""Complaints.

A formal grievance raised by a tenant against a landlord and/or a property.
Distinct from a review: not public, tracked to a resolution, and the basis for
the red-flag alerts the Fair Trading portal will aggregate (SCOPE.md §5).

On the shared database every repair is a complaint too, the one its
maintenance_work_orders row hangs off (services/maintenance.py), so the
complaint pages leave those out. Each step taken on a case is added to its
timeline in complaint_events, which the mobile app reads as well, and both
parties see that timeline with each complaint: who lodged and answered it,
and every status a TenantVoice admin set, with the admin's note. Which
admin handles a case is for staff only.

Two kinds of complaint, one category vocabulary (services/complaint_categories.py):

- **About a tenancy.** A tenant's complaint about a listing goes through
  create_general_complaint, which needs an approved application for that
  listing, checks the category, severity and description, writes the
  complaint (metadata.source tenant_general_complaint), its LODGED step and
  the landlord's notice. The database's trigger then evaluates every active
  red-flag rule for the property, so the web never does. The web adds its
  own keys (subject, evidence_urls) to the metadata afterwards. An admin
  changes its status through review_general_complaint, which records the
  step and tells the tenant.
- **About a member.** A complaint naming a person and no property is written
  here (metadata.source web_member_complaint), with the same categories and
  the same description rule, and so are an admin's status changes to it.

complaints has no updated_at, so every write here that changes a complaint
goes through _write_guarded(): it moves metadata.revision and applies only
while the row still has the revision and status it read. A write that loses
a race (an admin assigning a case while its respondent answers it) reads the
row again and works its changes out anew, so neither loses the other's keys.

Authorization is enforced here, not by RLS — the backend holds the service-role
key and bypasses policies (see app/core/supabase.py).
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client
from app.schemas.complaints import ALLOWED_TRANSITIONS
from app.services import complaint_categories, notifications
from app.services._common import select_in
from app.services.complaint_categories import run_rpc
from app.services.maps_identity import STAFF_ROLES
from app.services.maps_messaging import is_uuid
from app.services.maps_reviews_complaints import (
    EVENT_ASSIGNED,
    EVENT_CREATED,
    EVENT_RESPONDED,
    EVENT_STATUS_CHANGED,
    EVENT_UPDATED,
    complaint_event,
)
from app.services.shared_map import WEB_TO_COMPLAINT, flatten_complaint, stamp_insert, stamp_update

logger = logging.getLogger(__name__)

TABLE = "complaints"
EVENTS_TABLE = "complaint_events"
# A repair's complaint has a work order: the embed tells the two apart.
SELECT = "*, maintenance_work_orders(id)"
# Complaint fields the shared table keeps in metadata rather than in columns.
METADATA_FIELDS = ("subject", "evidence_urls")
# Who handles a case, in complaints.metadata (staff_assign).
ASSIGNMENT_KEYS = ("assigned_admin_id", "assigned_at", "assigned_by")
ADMIN_DECIDES_IN_CONSOLE = "Change a complaint's status from the admin console, where the decision is recorded."

# metadata.source of a complaint: create_general_complaint's, and the web's own.
GENERAL_SOURCE = "tenant_general_complaint"
MEMBER_SOURCE = "web_member_complaint"
# complaint_events.event_type of a lodged complaint, as create_general_complaint writes it.
EVENT_LODGED = "LODGED"
DEFAULT_SEVERITY = "MEDIUM"
# The description rule create_general_complaint applies, applied to every complaint.
DESCRIPTION_RANGE = (10, 3000)
DESCRIPTION_HELP = "Complaint description must be between 10 and 3000 characters"
NO_TENANCY = "A complaint requires an approved tenancy for this property"
# The statuses review_general_complaint sets.
REVIEW_STATUSES = ("IN_REVIEW", "ESCALATED", "RESOLVED", "CLOSED")

# The shared ComplaintStatus an admin may move a complaint to, from each one.
# A finished case can be reopened; a complaint its complainant withdrew cannot.
STAFF_TRANSITIONS = {
    "OPEN": ("IN_REVIEW", "ESCALATED", "RESOLVED", "CLOSED"),
    "IN_REVIEW": ("ESCALATED", "RESOLVED", "CLOSED"),
    "ESCALATED": ("IN_REVIEW", "RESOLVED", "CLOSED"),
    "RESOLVED": ("IN_REVIEW",),
    "CLOSED": ("IN_REVIEW",),
}
FINISHED = ("RESOLVED", "CLOSED")

# The steps the parties' timeline shows, and how it names them. Which admin
# handles a case (ASSIGNED) is for staff only; a step another app recorded
# under a name the web does not know reads as "other", without its note.
STEP_KINDS = {
    EVENT_CREATED: "lodged",
    EVENT_LODGED: "lodged",
    EVENT_UPDATED: "updated",
    EVENT_RESPONDED: "responded",
    EVENT_STATUS_CHANGED: "status",
}
STAFF_ONLY_STEPS = {EVENT_ASSIGNED}
# A status step's to_status as the parties read it. The web records its own
# statuses for the parties' steps and the shared ComplaintStatus for an admin's;
# review_general_complaint records toStatus.
STEP_STATUS = {
    "open": "open",
    "under_review": "under_review",
    "resolved": "resolved",
    "dismissed": "dismissed",
    "OPEN": "open",
    "IN_REVIEW": "under_review",
    "ESCALATED": "escalated",
    "RESOLVED": "resolved",
    "CLOSED": "resolved",
}

# Where each role reads its complaints; notices link there.
COMPLAINTS_PATH = {
    "tenant": "/tenant/complaints",
    "landlord": "/owner/complaints",
    "service_provider": "/dashboard/complaints",
}
NOTICE_KIND = "property"

CHANGED = "This complaint changed while you were looking at it. Reload it and try again."
# A count of the web's writes to a complaint, in its metadata (_write_guarded):
# complaints has no updated_at to tell a row changed since it was read.
REVISION = "revision"
# A write that loses a race starts again from the new row, this many times in all, then 409.
WRITE_ATTEMPTS = 3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_event(complaint_id: str, actor_id: str | None, event_type: str, note: str | None = None,
                 **details) -> None:
    """Add one step to a complaint's or repair's timeline. Never raises.

    The case itself is saved by then, so a failed write loses only this
    entry, and failing the request would invite a duplicate case on retry.
    """
    try:
        row = complaint_event(complaint_id, actor_id, event_type, note, **details)
        get_supabase_client().table(EVENTS_TABLE).insert(stamp_insert(EVENTS_TABLE, row)).execute()
    except Exception as exc:
        logger.error("complaint event %s for %s could not be saved: %s", event_type, complaint_id, exc)


def events_for(complaint_ids: list[str]) -> list[dict]:
    """The complaint_events rows of these complaints, oldest first."""
    return select_in(
        lambda: get_supabase_client().table(EVENTS_TABLE).select("*").order("created_at").order("id"),
        "complaint_id",
        complaint_ids,
    )


def is_repair(row: dict) -> bool:
    """Whether a complaints row selected with SELECT belongs to a repair.

    The embed is a list, or one object or null where PostgREST knows that
    complaint_id is unique, so any of those shapes is read.
    """
    return bool(row.get("maintenance_work_orders"))


def metadata_of(row: dict) -> dict:
    return dict(row["metadata"]) if isinstance(row.get("metadata"), dict) else {}


def is_withdrawn(row: dict) -> bool:
    """A complaint its complainant withdrew: stored CLOSED, marked in its metadata."""
    return row.get("status") == "CLOSED" and bool(metadata_of(row).get("dismissed"))


def is_general(row: dict) -> bool:
    """A complaint create_general_complaint wrote, which review_general_complaint decides."""
    return metadata_of(row).get("source") == GENERAL_SOURCE


def staff_transitions(row: dict) -> tuple[str, ...]:
    """The ComplaintStatus values an admin may move this complaint to."""
    if is_withdrawn(row):
        return ()
    current = row.get("status") or "OPEN"
    if is_general(row):
        # review_general_complaint: any other of its statuses, and nothing once CLOSED.
        return () if current == "CLOSED" else tuple(value for value in REVIEW_STATUSES if value != current)
    return STAFF_TRANSITIONS.get(current, ())


def step_to_status(event: dict) -> str | None:
    """The status a step moved a case to: the web's to_status, or review_general_complaint's toStatus."""
    meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    return meta.get("to_status") or meta.get("toStatus")


def step_from_status(event: dict) -> str | None:
    meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    return meta.get("from_status") or meta.get("fromStatus")


def finishing_note(events: list[dict], staff: set[str]) -> str | None:
    """The note of the last step by an admin that finished a case (RESOLVED or CLOSED), oldest-first events."""
    finishing = [event for event in events if event.get("event_type") == EVENT_STATUS_CHANGED
                 and event.get("actor_user_id") in staff and step_to_status(event) in FINISHED]
    return finishing[-1].get("note") if finishing else None


def outcome_note(row: dict, events: list[dict], staff: set[str]) -> str | None:
    """A finished complaint's outcome: the note kept with it, else the note of the admin's step that finished it.

    review_general_complaint keeps the note in its step only.
    """
    kept = metadata_of(row).get("resolution_note")
    if kept or row.get("status") not in FINISHED or is_withdrawn(row):
        return kept
    return finishing_note(events, staff)


def _flatten(row: dict) -> dict:
    """flatten_complaint(), keeping a withdrawal the shared enum cannot hold.

    The shared status has no dismissed state: set_status() stores it as
    CLOSED, which reads back as resolved, so it also marks the metadata.
    The category stays as stored until _decorate names it.
    """
    complaint = flatten_complaint(row)
    if is_withdrawn(row):
        complaint["status"] = "dismissed"
    complaint["category"] = row.get("category")
    complaint["severity"] = row.get("severity")
    return complaint


def _in_status(complaints: list[dict], status_filter: str | None) -> list[dict]:
    """The flattened complaints the web app shows with status_filter, or all of them.

    Stored values do not map one-to-one: IN_REVIEW and ESCALATED both read as
    under_review, and CLOSED reads as resolved unless it was a withdrawal, so
    filtering on the stored enum would drop or mislabel complaints.
    """
    if not status_filter:
        return complaints
    return [complaint for complaint in complaints if complaint["status"] == status_filter]


def _listed(rows: list[dict], status_filter: str | None, viewer_id: str) -> list[dict]:
    """The complaint page's entries for rows: repairs left out, names and timelines attached."""
    complaints = [_flatten(row) for row in rows if not is_repair(row)]
    return _decorate(_in_status(complaints, status_filter), viewer_id)


def staff_ids(user_ids) -> set[str]:
    """The TenantVoice staff (ADMIN or REGULATOR) among these users."""
    user_ids = [user_id for user_id in set(user_ids) if user_id]
    if not user_ids:
        return set()
    rows = get_supabase_client().table("users").select("id, primary_role").in_("id", user_ids).execute().data or []
    return {row["id"] for row in rows if row.get("primary_role") in STAFF_ROLES}


def _actor(event: dict, complaint: dict, viewer_id: str | None, staff: set[str]) -> str:
    """Who took a step, as its viewer reads it."""
    actor_id = event.get("actor_user_id")
    if actor_id and actor_id == viewer_id:
        return "you"
    if actor_id in staff:
        return "staff"
    if actor_id and actor_id == complaint["complainant_id"]:
        return "complainant"
    # Only the party a complaint is about answers it.
    if actor_id and (actor_id == complaint.get("against_id") or event.get("event_type") == EVENT_RESPONDED):
        return "respondent"
    return "other"


def _timelines(complaints: list[dict], viewer_id: str | None) -> tuple[dict[str, list[dict]], dict[str, list[dict]], set]:
    """(each complaint's steps as its parties see them, oldest first; its events; the staff among the actors).

    A failed read never fails the complaints it decorates: it is logged,
    and they show no steps.
    """
    try:
        events = events_for([complaint["id"] for complaint in complaints])
        staff = staff_ids(event.get("actor_user_id") for event in events)
    except APIError as exc:
        logger.warning("could not read complaint timelines: %s", exc)
        return {}, {}, set()
    by_id = {complaint["id"]: complaint for complaint in complaints}
    timelines: dict[str, list[dict]] = {}
    by_complaint: dict[str, list[dict]] = {}
    for event in events:
        by_complaint.setdefault(event["complaint_id"], []).append(event)
        if event.get("event_type") in STAFF_ONLY_STEPS:
            continue
        complaint = by_id[event["complaint_id"]]
        kind = STEP_KINDS.get(event.get("event_type"), "other")
        by_staff = event.get("actor_user_id") in staff
        timelines.setdefault(complaint["id"], []).append({
            "id": event["id"],
            "kind": kind,
            "status": STEP_STATUS.get(step_to_status(event)) if kind == "status" else None,
            # An admin's note on a status change is written for both parties.
            "note": event.get("note") if kind == "status" and by_staff else None,
            "actor": _actor(event, complaint, viewer_id, staff),
            "created_at": event["created_at"],
        })
    return timelines, by_complaint, staff


def _decorate(complaints: list[dict], viewer_id: str | None = None) -> list[dict]:
    """Attach the category's name, the human names behind complainant_id / against_id / property_id, and the timeline."""
    if not complaints:
        return []

    supabase = get_supabase_client()

    labels = complaint_categories.Labels()
    for complaint in complaints:
        category = labels.category(complaint.get("category"))
        complaint["category"] = category["code"]
        complaint["category_label"] = category["label"]

    profile_ids = {c["complainant_id"] for c in complaints}
    profile_ids |= {c["against_id"] for c in complaints if c.get("against_id")}
    name_by_id: dict[str, str] = {}
    if profile_ids:
        rows = (
            supabase.table("users")
            .select("id, full_name")
            .in_("id", list(profile_ids))
            .execute()
            .data
            or []
        )
        name_by_id = {r["id"]: r["full_name"] for r in rows}

    property_ids = {c["property_id"] for c in complaints if c.get("property_id")}
    title_by_id: dict[str, str] = {}
    if property_ids:
        rows = (
            supabase.table("listings")
            .select("id, title, property_id")
            .in_("property_id", list(property_ids))
            .execute()
            .data
            or []
        )
        title_by_id = {r.get("property_id"): r["title"] for r in rows}

    timelines, events, staff = _timelines(complaints, viewer_id)
    for complaint in complaints:
        complaint["complainant_name"] = name_by_id.get(complaint["complainant_id"])
        complaint["against_name"] = name_by_id.get(complaint.get("against_id"))
        complaint["property_title"] = title_by_id.get(complaint.get("property_id"))
        complaint["timeline"] = timelines.get(complaint["id"], [])
        if complaint["status"] == "resolved" and not complaint.get("resolution_note"):
            complaint["resolution_note"] = finishing_note(events.get(complaint["id"], []), staff)
    return complaints


def get_row(complaint_id: str) -> dict:
    """The complaint's row; a repair's complaint is 404 here, as /maintenance handles it."""
    supabase = get_supabase_client()
    result = supabase.table(TABLE).select(SELECT).eq("id", complaint_id).limit(1).execute()
    if not result.data or is_repair(result.data[0]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Complaint not found")
    return result.data[0]


def _get(complaint_id: str) -> dict:
    return _flatten(get_row(complaint_id))


def _next_revision(row: dict) -> int:
    value = metadata_of(row).get(REVISION)
    return (value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0) + 1


def _as_read(query, row: dict):
    """query, narrowed to the complaint while it still has the revision and status row was read with.

    The revision is compared as the text ->> gives; a row no web write has
    moved yet has none.
    """
    query = query.eq("status", row.get("status"))
    value = metadata_of(row).get(REVISION)
    if value is None:
        return query.is_(f"metadata->>{REVISION}", "null")
    return query.eq(f"metadata->>{REVISION}", value if isinstance(value, str) else json.dumps(value))


def _write_guarded(complaint_id: str, changes_for) -> tuple[dict, dict]:
    """Write changes_for(row) to the complaint unless it changed since it was read; (row before, row after).

    changes_for gets the complaint as read now (get_row) and answers the
    columns to write, with any metadata merged in full from that row, or
    None to write nothing (then (row, row)); it raises to refuse that row.
    The write moves metadata.revision and applies only while the row still
    has the revision and status it was read with (_as_read). When another
    write landed in between, the row is read again and changes_for asked
    anew, WRITE_ATTEMPTS times in all, then 409.
    """
    for _ in range(WRITE_ATTEMPTS):
        row = get_row(complaint_id)
        changes = changes_for(row)
        if changes is None:
            return row, row
        changes["metadata"] = {**changes.get("metadata", metadata_of(row)), REVISION: _next_revision(row)}
        query = get_supabase_client().table(TABLE).update(stamp_update(TABLE, changes)).eq("id", complaint_id)
        updated = _as_read(query, row).execute().data
        if updated:
            return row, updated[0]
    raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)


def _owned_property_ids(owner_id: str) -> list[str]:
    supabase = get_supabase_client()
    rows = (
        supabase.table("properties").select("id").eq("owner_user_id", owner_id).execute().data or []
    )
    return [r["id"] for r in rows]


def _is_respondent(complaint: dict, profile_id: str) -> bool:
    """True if this profile is the party the complaint is aimed at."""
    if complaint.get("against_id") == profile_id:
        return True
    property_id = complaint.get("property_id")
    return bool(property_id) and property_id in _owned_property_ids(profile_id)


def _tenancy_listing(tenant_id: str, named: str) -> str:
    """The listing a tenant's complaint is about: the listing named (the web's property id), or, for a
    properties id, the listing of the tenant's approved application there."""
    supabase = get_supabase_client()
    if not is_uuid(named):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    if supabase.table("listings").select("id").eq("id", named).limit(1).execute().data:
        return named
    if not supabase.table("properties").select("id").eq("id", named).limit(1).execute().data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    listing_ids = [row["id"] for row in supabase.table("listings").select("id").eq("property_id", named)
                   .order("created_at", desc=True).order("id").execute().data or []]
    if not listing_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NO_TENANCY)
    approved = (
        supabase.table("rental_applications").select("listing_id").eq("applicant_user_id", tenant_id)
        .eq("status", "APPROVED").in_("listing_id", listing_ids).limit(1).execute().data
    )
    # Without one, create_general_complaint refuses the newest listing, in its own words.
    return approved[0]["listing_id"] if approved else listing_ids[0]


def tenancies(tenant_id: str) -> list[dict]:
    """TenancyOut: the listings a tenant may lodge a complaint about, those of their approved applications."""
    rows = (
        get_supabase_client().table("rental_applications")
        .select("listing_id, updated_at, listings(id, title, properties(address_line_1, suburb, state, postcode))")
        .eq("applicant_user_id", tenant_id).eq("status", "APPROVED").order("updated_at", desc=True).order("id")
        .execute().data or []
    )
    found: dict[str, dict] = {}
    for row in rows:
        listing = row.get("listings") if isinstance(row.get("listings"), dict) else {}
        place = listing.get("properties") if isinstance(listing.get("properties"), dict) else {}
        address = ", ".join(str(place[part]) for part in ("address_line_1", "suburb", "state", "postcode")
                            if place.get(part))
        found.setdefault(row["listing_id"], {
            "listing_id": row["listing_id"], "title": listing.get("title") or "Your rental", "address": address or None,
        })
    return list(found.values())


def _description(value: str) -> str:
    """The description as create_general_complaint keeps it (spaces trimmed), 10 to 3000 characters, or 422."""
    text = (value or "").strip(" ")
    if not DESCRIPTION_RANGE[0] <= len(text) <= DESCRIPTION_RANGE[1]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, DESCRIPTION_HELP)
    return text


def _web_metadata(data: dict) -> dict:
    return {field: data[field] for field in METADATA_FIELDS if data.get(field)}


def _create_general(tenant_id: str, data: dict) -> dict:
    """A tenant's complaint about a listing they rent, through create_general_complaint."""
    listing_id = _tenancy_listing(tenant_id, data["property_id"])
    category = complaint_categories.for_new_complaint(data.get("category"))
    complaint_id = str(uuid.uuid4())
    run_rpc(get_supabase_client().rpc("create_general_complaint", {
        "p_complaint_id": complaint_id,
        "p_reporter_user_id": tenant_id,
        "p_listing_id": listing_id,
        "p_category": category,
        "p_description": data["description"],
        "p_severity": data.get("severity") or DEFAULT_SEVERITY,
        "p_now": _now(),
    }))
    row = get_row(complaint_id)
    extra = _web_metadata(data)
    if extra:
        try:
            updated = (
                get_supabase_client().table(TABLE).update(stamp_update(TABLE, {"metadata": metadata_of(row) | extra}))
                .eq("id", complaint_id).execute().data
            )
            row = {**row, **updated[0]} if updated else row
        except APIError as exc:
            # The complaint is lodged; only the web's subject and links are missing.
            logger.error("the web metadata of complaint %s could not be saved: %s", complaint_id, exc)
    return _decorate([_flatten(row)], tenant_id)[0]


def _create_about_member(complainant_id: str, data: dict) -> dict:
    """A complaint about a person, with no property: written here, with the general categories."""
    against_id = data["against_id"]
    if against_id == complainant_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot complain about yourself")
    supabase = get_supabase_client()
    if not is_uuid(against_id) or not supabase.table("users").select("id").eq("id", against_id).limit(1).execute().data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    category = complaint_categories.for_new_complaint(data.get("category"))
    row = stamp_insert(TABLE, {
        "reporter_user_id": complainant_id,
        "against_user_id": against_id,
        "property_id": None,
        "category": category,
        "description": _description(data["description"]),
        "severity": data.get("severity") or DEFAULT_SEVERITY,
        "status": WEB_TO_COMPLAINT["open"],
        "lodged_at": _now(),
        "metadata": {"source": MEMBER_SOURCE, **_web_metadata(data)},
    })
    created = supabase.table(TABLE).insert(row).execute().data[0]
    record_event(created["id"], complainant_id, EVENT_LODGED, status="OPEN")
    complaint = _decorate([_flatten(created)], complainant_id)[0]
    tell(
        against_id, "A complaint was lodged about you",
        f"{complaint['category_label']}: {complaint['subject']}. Read it and respond on your Complaints page.",
    )
    return complaint


def complaints_href(user_id: str | None) -> tuple[str | None, str | None]:
    """(web role, the page where they read their complaints) of a person; (None, None) without one."""
    person = notifications.profile_summary(user_id)
    role = person.get("role")
    return role, COMPLAINTS_PATH.get(role or "")


def tell(user_id: str | None, title: str, body: str | None) -> None:
    """A notice about a complaint, linking to the person's complaints. Never raises."""
    if not user_id:
        return
    _, link = complaints_href(user_id)
    notifications.notify(user_id, NOTICE_KIND, title, body, link)


def create_complaint(complainant_id: str, payload: dict) -> dict:
    """A complaint about a property (a tenant's tenancy) or, naming no property, about a person."""
    data = {k: v for k, v in payload.items() if v is not None}
    if data.get("property_id"):
        return _create_general(complainant_id, data)
    if data.get("against_id"):
        return _create_about_member(complainant_id, data)
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "A complaint must name a property or a person")


def list_my_complaints(complainant_id: str, status_filter: str | None = None) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table(TABLE).select(SELECT).eq("reporter_user_id", complainant_id)
    return _listed(query.order("lodged_at", desc=True).execute().data or [], status_filter, complainant_id)


def list_complaints_against_me(profile_id: str, status_filter: str | None = None) -> list[dict]:
    """Everything aimed at this user directly, or at any property they own, newest first."""
    supabase = get_supabase_client()
    rows = {row["id"]: row for row in supabase.table(TABLE).select(SELECT).eq("against_user_id", profile_id)
            .execute().data or []}
    property_ids = _owned_property_ids(profile_id)
    if property_ids:
        on_mine = supabase.table(TABLE).select(SELECT).in_("property_id", property_ids).execute().data or []
        rows.update((row["id"], row) for row in on_mine)
    newest = sorted(rows.values(), key=lambda row: row["lodged_at"], reverse=True)
    return _listed(newest, status_filter, profile_id)


def get_complaint(complaint_id: str, profile_id: str, role: str) -> dict:
    """A complaint as one of its parties sees it. Staff read it in the admin console
    (admin_complaints.detail), which checks the admin is active."""
    complaint = _get(complaint_id)
    if complaint["complainant_id"] != profile_id and not _is_respondent(complaint, profile_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this complaint")
    return _decorate([complaint], profile_id)[0]


def update_complaint(complaint_id: str, complainant_id: str, payload: dict) -> dict:
    """The complainant correcting their own submission."""
    sent = {k: v for k, v in payload.items() if v is not None}
    edited: list[str] = []

    def changes_for(row: dict) -> dict | None:
        complaint = _flatten(row)
        if complaint["complainant_id"] != complainant_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own complaint")
        if complaint["status"] != "open":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "This complaint is already being handled and can no longer be edited",
            )
        changes = dict(sent)
        if "category" in changes:
            # Keeping the category it has is always allowed, even one no longer offered.
            current = complaint_categories.Labels().category(row.get("category"))["code"]
            if complaint_categories.key(changes["category"]) == complaint_categories.key(current):
                del changes["category"]
        if not changes:
            return None
        edited[:] = sorted(changes)
        # Shared-schema shape: subject and evidence live in metadata, as create_complaint() writes them.
        data = {k: v for k, v in changes.items() if k not in METADATA_FIELDS}
        if "category" in data:
            data["category"] = complaint_categories.for_new_complaint(data["category"])
        if "description" in data:
            data["description"] = _description(data["description"])
        meta_changes = {k: v for k, v in changes.items() if k in METADATA_FIELDS}
        if meta_changes:
            data["metadata"] = metadata_of(row) | meta_changes
        return data

    before, updated = _write_guarded(complaint_id, changes_for)
    if updated is not before:
        record_event(complaint_id, complainant_id, EVENT_UPDATED, fields=edited)
    return _decorate([_flatten(updated)], complainant_id)[0]


def respond_to_complaint(complaint_id: str, profile_id: str, response: str) -> dict:
    """The accused party replying. Also moves an open case to under_review."""
    def changes_for(row: dict) -> dict:
        complaint = _flatten(row)
        if not _is_respondent(complaint, profile_id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only the party a complaint is about can respond to it"
            )
        # The shared table keeps the reply in metadata, where flatten_complaint() reads it.
        data = {
            "metadata": metadata_of(row) | {
                "response": response,
                "responded_at": _now(),
            },
        }
        if complaint["status"] == "open":
            data["status"] = WEB_TO_COMPLAINT["under_review"]
        return data

    before, updated = _write_guarded(complaint_id, changes_for)
    moved = updated.get("status") != before.get("status")
    details = {"from_status": "open", "to_status": "under_review"} if moved else {}
    record_event(complaint_id, profile_id, EVENT_RESPONDED, response, **details)
    answered = _decorate([_flatten(updated)], profile_id)[0]
    tell(answered["complainant_id"], f"Your complaint was answered: {answered['subject']}", response)
    return answered


def set_status(complaint_id: str, profile_id: str, role: str, payload: dict) -> dict:
    """The complainant withdrawing their own complaint (dismissed); they cannot mark it resolved.

    An admin decides a complaint in the admin console (admin_complaints.change_status),
    which checks the admin is active, needs a note, keeps the decision in both
    audit logs and tells both parties: this route is no way round that.
    """
    if role == "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, ADMIN_DECIDES_IN_CONSOLE)
    new_status = payload["status"]

    def changes_for(row: dict) -> dict:
        complaint = _flatten(row)
        allowed = ALLOWED_TRANSITIONS.get(complaint["status"], set())
        if new_status not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot move a complaint from {complaint['status']} to {new_status}",
            )
        if complaint["complainant_id"] != profile_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot change this complaint")
        if new_status != "dismissed":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You can withdraw your complaint, but only a moderator can resolve it",
            )
        # Shared-schema shape: the enum status, with the note in metadata.
        meta = metadata_of(row)
        if payload.get("resolution_note"):
            meta["resolution_note"] = payload["resolution_note"]
        if new_status == "dismissed":
            meta["dismissed"] = True
        data = {"status": WEB_TO_COMPLAINT[new_status], "metadata": meta}
        if new_status in ("resolved", "dismissed"):
            data["resolved_at"] = _now()
        return data

    before, updated = _write_guarded(complaint_id, changes_for)
    record_event(
        complaint_id, profile_id, EVENT_STATUS_CHANGED, payload.get("resolution_note"),
        from_status=_flatten(before)["status"], to_status=new_status,
    )
    return _decorate([_flatten(updated)], profile_id)[0]


# ---------------------------------------------------------------------------
# Admin writes (admin_complaints checks who may, and records them)
# ---------------------------------------------------------------------------
def staff_set_status(complaint_id: str, admin_id: str, new_status: str, note: str,
                     seen_status: str | None) -> tuple[dict, dict]:
    """An admin moving a complaint to another ComplaintStatus with a note; (row before, row after).

    It applies only while the complaint still has the status the admin saw,
    or the one first read when the admin gave none (409 otherwise). A general
    complaint moves through review_general_complaint, which keeps the note in
    its step. Any other is written here (_write_guarded: another write that
    moved only its metadata meanwhile is kept): finishing it (RESOLVED,
    CLOSED) sets resolved_at and keeps the note as its outcome, and reopening
    one clears both.
    """
    row = get_row(complaint_id)
    if is_general(row):
        current = row.get("status") or "OPEN"
        if seen_status is not None and seen_status != current:
            raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
        if new_status not in staff_transitions(row):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot move a complaint from {current} to {new_status}")
        # The function checks the admin and the move again, records the step and tells the tenant.
        run_rpc(get_supabase_client().rpc("review_general_complaint", {
            "p_complaint_id": complaint_id, "p_admin_user_id": admin_id, "p_status": new_status,
            "p_note": note, "p_now": _now(),
        }))
        return row, get_row(complaint_id)
    decided_on = seen_status

    def changes_for(row: dict) -> dict:
        nonlocal decided_on
        current = row.get("status") or "OPEN"
        decided_on = decided_on or current
        if current != decided_on:
            raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
        if new_status not in staff_transitions(row):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot move a complaint from {current} to {new_status}")
        meta = metadata_of(row)
        changes: dict = {"status": new_status}
        if new_status in FINISHED:
            changes["resolved_at"] = _now()
            meta["resolution_note"] = note
        elif current in FINISHED:
            changes["resolved_at"] = None
            meta.pop("resolution_note", None)
        changes["metadata"] = meta
        return changes

    before, after = _write_guarded(complaint_id, changes_for)
    record_event(complaint_id, admin_id, EVENT_STATUS_CHANGED, note, from_status=decided_on, to_status=new_status)
    return before, after


def staff_assign(complaint_id: str, admin_id: str, assignee_id: str | None, note: str | None) -> tuple[dict, dict]:
    """Hand a complaint to an admin, or to nobody; (row before, row after). Assigning the same admin changes nothing.

    Who handles a case does not depend on where it stands, so a change
    another write made meanwhile (its respondent answered, an admin moved it)
    is kept and the assignment applied to the new row (_write_guarded).
    """
    def changes_for(row: dict) -> dict | None:
        meta = metadata_of(row)
        if meta.get("assigned_admin_id") == assignee_id:
            return None
        if assignee_id:
            meta.update({"assigned_admin_id": assignee_id, "assigned_at": _now(), "assigned_by": admin_id})
        else:
            for assignment_key in ASSIGNMENT_KEYS:
                meta.pop(assignment_key, None)
        return {"metadata": meta}

    before, after = _write_guarded(complaint_id, changes_for)
    if after is not before:
        previous = metadata_of(before).get("assigned_admin_id")
        record_event(complaint_id, admin_id, EVENT_ASSIGNED, note, assignee_id=assignee_id, previous_assignee_id=previous)
    return before, after
