"""Repairs on the shared database, moved on only through the mobile app's functions.

A repair is two rows, as the mobile app keeps it: a complaints row holding
what was reported (a category code, the description, the priority as its
severity, and metadata.mobile with the title and the photo keys) and the
maintenance_work_orders row hanging off it, holding who does the work and
where it stands. A request's id is the work order's; the functions take the
complaint's.

Each step is a shared function run as the person taking it (user_client), so
both apps keep one set of rules, one case timeline (complaint_events) and
one set of notices, which the functions write:

- the tenant reports a repair (mobile_create_repair), and the owner logs one
  (mobile_owner_create_repair), for a home with an approved application;
- the owner assigns a provider (mobile_assign_repair): an approved, active
  provider whose service_categories hold the repair's category. It opens the
  maintenance thread and the provider's job request (mobile_ai_service_jobs);
- the provider books the visit (mobile_schedule_repair), then marks the job
  done (mobile_complete_repair), which waits for the tenant;
- the tenant confirms it with a rating (mobile_confirm_repair), or rates a
  repair the owner resolved (mobile_rate_repair);
- the owner may resolve it at any time (mobile_resolve_repair).

maintenance_work_orders.status takes only OPEN, ASSIGNED, SCHEDULED,
PENDING_TENANT_CONFIRMATION and RESOLVED (its CHECK); nothing here writes a
status itself. A function's refusal reaches the caller with its message
(maps_provider_core.run_function).
"""

import logging
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile, status

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client
from app.services import complaints as complaints_service
from app.services import gates, uploads
from app.services.maps_messaging import is_uuid, moment
from app.services.maps_provider_core import REPAIR_CATEGORY_LABELS, repair_category, run_function
from app.services.maps_reviews_complaints import EVENT_UPDATED
from app.services.shared_map import MAINT_TO_WEB, address_of, flatten_maintenance, stamp_update

logger = logging.getLogger(__name__)

TABLE = "maintenance_work_orders"
COMPLAINTS = complaints_service.TABLE
# A work order with the complaint fields a repair is read from.
WORK_ORDER_SELECT = "*, complaints(category, description, severity, metadata, against_user_id, property_id)"
PROVIDER_SELECT = WORK_ORDER_SELECT

# maintenance_work_orders.status: the five values its CHECK allows.
MAINT_OPEN = "OPEN"
MAINT_ASSIGNED = "ASSIGNED"
MAINT_SCHEDULED = "SCHEDULED"
MAINT_AWAITING = "PENDING_TENANT_CONFIRMATION"
MAINT_RESOLVED = "RESOLVED"
WORK_ORDER_STATUSES = (MAINT_OPEN, MAINT_ASSIGNED, MAINT_SCHEDULED, MAINT_AWAITING, MAINT_RESOLVED)
# Each as the web names it: open; in_progress once assigned or booked;
# awaiting_confirmation once done and waiting for the tenant; resolved. A row
# from before the CHECK may hold IN_PROGRESS, COMPLETED or CANCELLED, which
# read as in_progress, resolved and cancelled (shared_map.MAINT_TO_WEB).
STATUS_TO_WEB = {**MAINT_TO_WEB, MAINT_AWAITING: "awaiting_confirmation"}
# complaints.severity as the web's priority, the mobile app's four
# (mobile_repair_priority_to_app); the functions take the priority's name.
SEVERITY_TO_PRIORITY = {"LOW": "low", "MEDIUM": "medium", "HIGH": "high", "CRITICAL": "urgent"}
DEFAULT_PRIORITY = "medium"

# The repair photos: the shared private bucket, keyed <users.id>/<file> (the
# mobile_repair_photos_* storage policies, mobile_repair_clean_photos). Its
# limits (5 MB; jpeg, png and webp of the types the uploads sniff) are the
# bucket's; uploads.BUCKETS names every bucket the backend stores into.
REPAIR_PHOTOS_BUCKET = "repair-photos"
uploads.BUCKETS.setdefault(
    REPAIR_PHOTOS_BUCKET,
    uploads.BucketRules(5 * uploads.MB, frozenset({"image/jpeg", "image/png", "image/webp"})),
)
# A web key the mobile app has no field for: how to get in, for the provider once the visit is booked.
ACCESS_NOTES_KEY = "access_notes"

# Who takes each step.
CREATE_FUNCTION = {"tenant": "mobile_create_repair", "landlord": "mobile_owner_create_repair"}
HOMES_FUNCTION = {"tenant": "mobile_my_repair_properties", "landlord": "mobile_owner_repair_properties"}
PROVIDER_COMPLETES_FROM_REPAIRS = "Mark the repair done from your Assigned repairs page, once its visit has started."
ADMIN_MOVES_NO_REPAIR = "A repair is moved by its tenant, owner and assigned provider, not from an admin account."
TENANT_CONFIRMS = "Confirm the repair with a rating once the provider has marked it done."
STATUS_MOVES_ITSELF = (
    "A repair moves on when the owner assigns a provider and the provider books the visit; "
    "only the owner marks it resolved here."
)
NO_WITHDRAWAL = "A repair cannot be withdrawn. Ask the owner to mark it resolved."
NOT_ASSIGNABLE = "This repair can no longer be assigned: a visit is already booked or the job is done."
# mobile_owner_create_repair, assign_maintenance_work_order and mobile_resolve_repair take an active LANDLORD
# account only, so an agent who owns a home (web role landlord too) sees its repairs but takes no step.
OWNER_STEP_ROLE = "LANDLORD"
LANDLORD_STEPS_ONLY = (
    "Only a landlord account logs, assigns and resolves repairs. An agent account can follow its homes' repairs."
)
LOCAL_TZ = ZoneInfo("Australia/Sydney")
REPAIR_NOT_FOUND = "Repair not found"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sb():
    return get_supabase_client()


def _as(current: CurrentProfile):
    """A client whose function calls run as the caller."""
    return user_client(current.access_token)


# ---------------------------------------------------------------------------
# Reading a repair
# ---------------------------------------------------------------------------
def _meta(complaint: dict) -> dict:
    return complaint["metadata"] if isinstance(complaint.get("metadata"), dict) else {}


def _mobile(complaint: dict) -> dict:
    mobile = _meta(complaint).get("mobile")
    return mobile if isinstance(mobile, dict) else {}


def _photo_keys(complaint: dict) -> list[str]:
    photos = _mobile(complaint).get("photos")
    return [key for key in photos if isinstance(key, str) and key] if isinstance(photos, list) else []


def _work_status(row: dict) -> str:
    return str(row.get("status") or MAINT_OPEN).upper()


def flatten(row: dict, viewer_id: str | None = None) -> dict:
    """A work order with its complaint embedded as MaintenanceOut, for viewer_id.

    The title, category, priority and photos are read as mobile_repair_json
    reads them; the can_* flags are what viewer_id may do next.
    """
    request = flatten_maintenance(row)
    complaint = row.get("complaints") if isinstance(row.get("complaints"), dict) else {}
    meta, mobile = _meta(complaint), _mobile(complaint)
    category = repair_category(complaint.get("category"))
    description = complaint.get("description") or ""
    work_status = _work_status(row)
    title = (mobile.get("issueTitle") if isinstance(mobile.get("issueTitle"), str) else "") or meta.get("subject") \
        or description.split("\n", 1)[0] or f"{REPAIR_CATEGORY_LABELS[category]} issue"
    legacy_photos = meta.get("photo_urls") if isinstance(meta.get("photo_urls"), list) else []
    tenant, owner = row.get("tenant_user_id"), row.get("landlord_user_id")
    request.update({
        "category": category,
        "category_label": REPAIR_CATEGORY_LABELS[category],
        "priority": SEVERITY_TO_PRIORITY.get(complaint.get("severity"), DEFAULT_PRIORITY),
        "status": STATUS_TO_WEB.get(work_status, "open"),
        "title": title,
        "photo_keys": _photo_keys(complaint),
        "photo_urls": [url for url in legacy_photos if isinstance(url, str)],
        "access_notes": meta.get(ACCESS_NOTES_KEY) if isinstance(meta.get(ACCESS_NOTES_KEY), str) else None,
        "appointment_at": row.get("appointment_at"),
        "estimated_duration_minutes": row.get("estimated_duration_minutes"),
        "appointment_note": row.get("appointment_note") or None,
        "completed_at": row.get("completed_at"),
        "tenant_rating": row.get("tenant_rating"),
        "conversation_id": row.get("conversation_id"),
        "logged_by_owner": meta.get("createdByRole") == "LANDLORD",
        # As mobile_repair_json works them out for the viewer.
        "can_confirm": work_status == MAINT_AWAITING and tenant == viewer_id,
        "can_rate": work_status == MAINT_RESOLVED and row.get("tenant_rating") is None and tenant == viewer_id,
        "can_assign": work_status in (MAINT_OPEN, MAINT_ASSIGNED) and owner == viewer_id,
        "can_resolve": work_status != MAINT_RESOLVED and owner == viewer_id,
    })
    return request


def _decorate(requests: list[dict]) -> list[dict]:
    """Add the listing, the people's names and short-lived links to the photos."""
    if not requests:
        return []
    listing_ids = list({r["property_id"] for r in requests if r.get("property_id")})
    listings = (
        _sb().table("listings").select("id, title, properties(address_line_1, suburb)")
        .in_("id", listing_ids).execute().data or []
        if listing_ids
        else []
    )
    listing_by_id = {r["id"]: r for r in listings}

    # landlord_user_id is nullable, and in_() must never send a null.
    profile_ids = list({r[key] for r in requests for key in ("tenant_id", "owner_id", "provider_id") if r.get(key)})
    names, businesses, roles = {}, {}, {}
    if profile_ids:
        rows = _sb().table("users").select("id, full_name, primary_role").in_("id", profile_ids).execute().data or []
        names = {r["id"]: r["full_name"] for r in rows}
        roles = {r["id"]: r.get("primary_role") for r in rows}
        providers = [r["provider_id"] for r in requests if r.get("provider_id")]
        if providers:
            profiles = (
                _sb().table("service_provider_profiles").select("user_id, company_name")
                .in_("user_id", list(set(providers))).execute().data or []
            )
            businesses = {p["user_id"]: (p.get("company_name") or "").strip() for p in profiles}
    signed = uploads.signed_urls(REPAIR_PHOTOS_BUCKET, [key for r in requests for key in r.get("photo_keys", [])])

    for request in requests:
        listing = listing_by_id.get(request.get("property_id")) or {}
        prop = listing.get("properties") or {}
        request["property_title"] = listing.get("title")
        request["property_address"] = prop.get("address_line_1") or prop.get("suburb")
        request["tenant_name"] = names.get(request.get("tenant_id"))
        request["owner_name"] = names.get(request.get("owner_id"))
        request["provider_name"] = businesses.get(request.get("provider_id")) or names.get(request.get("provider_id"))
        keys = request.pop("photo_keys", [])
        request["photo_urls"] = [signed[key] for key in keys if key in signed] + request.get("photo_urls", [])
        if roles.get(request.get("owner_id")) != OWNER_STEP_ROLE:
            # The functions refuse an owner who is not a landlord (OWNER_STEP_ROLE).
            request["can_assign"] = request["can_resolve"] = False
    return requests


def _get_row(request_id: str) -> dict:
    rows = (
        _sb().table(TABLE).select(WORK_ORDER_SELECT).eq("id", request_id).limit(1).execute().data
        if is_uuid(request_id) else []
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Maintenance request not found")
    return rows[0]


def _listed(rows: list[dict], viewer_id: str, status_filter: str | None) -> list[dict]:
    mapped = [flatten(row, viewer_id) for row in rows]
    if status_filter:
        mapped = [row for row in mapped if row["status"] == status_filter]
    return _decorate(mapped)


def assert_participant(request: dict, profile_id: str) -> None:
    """403 unless profile_id is the repair's tenant, owner or assigned provider.

    Staff are no exception, active or not: these routes keep no admin note,
    audit entry or notice, as the complaints routes refuse an admin too.
    """
    if profile_id in (request.get("tenant_id"), request.get("owner_id"), request.get("provider_id")):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this request")


def _view(row: dict, viewer_id: str) -> dict:
    return _shown_to(viewer_id, _decorate([flatten(row, viewer_id)])[0], _visit_booked(row))


def _reread(row: dict, viewer_id: str) -> dict:
    """The repair as it is now, after a function moved it."""
    return _view(_get_row(row["id"]), viewer_id)


def list_for_tenant(tenant_id: str, status_filter: str | None = None) -> list[dict]:
    query = _sb().table(TABLE).select(WORK_ORDER_SELECT).eq("tenant_user_id", tenant_id)
    return _listed(query.order("created_at", desc=True).execute().data or [], tenant_id, status_filter)


def list_for_owner(owner_id: str, status_filter: str | None = None) -> list[dict]:
    query = _sb().table(TABLE).select(WORK_ORDER_SELECT).eq("landlord_user_id", owner_id)
    return _listed(query.order("created_at", desc=True).execute().data or [], owner_id, status_filter)


def list_for_provider(profile_id: str, status_filter: str | None = None) -> list[dict]:
    query = _sb().table(TABLE).select(WORK_ORDER_SELECT).eq("assigned_worker_id", profile_id)
    rows = query.order("created_at", desc=True).execute().data or []
    booked = {row["id"]: _visit_booked(row) for row in rows}
    return [_shown_to(profile_id, request, booked[request["id"]]) for request in _listed(rows, profile_id, status_filter)]


def get_request(request_id: str, profile_id: str) -> dict:
    row = _get_row(request_id)
    assert_participant(flatten(row, profile_id), profile_id)
    return _view(row, profile_id)


# ---------------------------------------------------------------------------
# Reporting, editing and photos
# ---------------------------------------------------------------------------
def _takes_owner_steps(user_id: str) -> bool:
    """Whether the functions let this owner log, assign and resolve repairs: a LANDLORD account (OWNER_STEP_ROLE)."""
    rows = _sb().table("users").select("primary_role").eq("id", user_id).limit(1).execute().data or []
    return bool(rows) and rows[0].get("primary_role") == OWNER_STEP_ROLE


def _require_owner_steps(current: CurrentProfile) -> None:
    if not _takes_owner_steps(current.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, LANDLORD_STEPS_ONLY)


def repair_homes(current: CurrentProfile) -> list[dict]:
    """The homes the caller can report a repair for: a tenant's rented ones, an owner's with a tenant."""
    if current.role == "landlord" and not _takes_owner_steps(current.id):
        return []
    rows = run_function(_as(current).rpc(HOMES_FUNCTION[current.role], {})) or []
    homes: dict[str, dict] = {}
    for row in rows:
        homes.setdefault(row["listingId"], {
            "listing_id": row["listingId"],
            "property_id": row.get("propertyId"),
            "title": row.get("title") or "Property",
            "address": row.get("address") or None,
            "owner_name": row.get("ownerName"),
            "tenant_name": row.get("tenantName"),
        })
    return list(homes.values())


def store_photo(upload: UploadFile, profile_id: str) -> dict:
    """One repair photo in the caller's folder, which mobile_repair_clean_photos accepts: {path, url}."""
    stored = uploads.store(upload, REPAIR_PHOTOS_BUCKET, prefix=profile_id)
    return {"path": stored["path"], "url": stored["url"], "content_type": stored["content_type"],
            "size": stored["size"], "virus_scan": stored["virus_scan"]}


def _row_of_complaint(complaint_id: str) -> dict:
    rows = _sb().table(TABLE).select(WORK_ORDER_SELECT).eq("complaint_id", complaint_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The repair was saved but could not be read back. Reload.")
    return rows[0]


def _save_access_notes(complaint_id: str, metadata: dict, notes: str | None) -> None:
    """Keep the access notes in the complaint's metadata, beside the mobile app's keys. Never raises."""
    changes = {key: value for key, value in metadata.items() if key != ACCESS_NOTES_KEY}
    if notes:
        changes[ACCESS_NOTES_KEY] = notes
    try:
        _sb().table(COMPLAINTS).update(stamp_update(COMPLAINTS, {"metadata": changes})).eq("id", complaint_id).execute()
    except Exception as exc:
        logger.error("access notes of repair %s could not be saved: %s", complaint_id, exc)


def create_request(current: CurrentProfile, payload: dict) -> dict:
    """Report (a tenant) or log (an owner) a repair, for a home of the caller's (repair_homes)."""
    if current.role == "landlord":
        _require_owner_steps(current)
    if not is_uuid(payload["property_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    created = run_function(_as(current).rpc(CREATE_FUNCTION[current.role], {
        "p_listing_id": payload["property_id"],
        "p_issue_title": payload["title"],
        "p_description": payload["description"],
        "p_category": payload["category"],
        "p_priority": payload["priority"],
        "p_photos": payload.get("photos") or [],
    }))
    row = _row_of_complaint(created["id"])
    if payload.get("access_notes"):
        complaint = row.get("complaints") or {}
        _save_access_notes(created["id"], _meta(complaint), payload["access_notes"])
        row = _row_of_complaint(created["id"])
    return _view(row, current.id)


def update_request(request_id: str, tenant_id: str, payload: dict) -> dict:
    """The tenant correcting what they reported, while it is open: the complaint changes, not the work order.

    No shared function edits a report, so this writes the complaint's columns
    and its metadata, keeping the mobile app's keys.
    """
    row = _get_row(request_id)
    request = flatten(row, tenant_id)
    if request["tenant_id"] != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own request")
    # An owner logs a repair for their tenant (mobile_owner_create_repair): it is the tenant's, but not their report.
    reporter = _mobile(row.get("complaints") or {}).get("createdBy")
    if request["logged_by_owner"] or reporter not in (None, tenant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who reported this repair can edit it")
    if _work_status(row) != MAINT_OPEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Work has already started on this request, so it can no longer be edited",
        )
    changes = {k: v for k, v in payload.items() if v is not None}
    if not changes:
        return _view(row, tenant_id)
    complaint = row.get("complaints") or {}
    columns: dict = {name: changes[name] for name in ("description", "category") if name in changes}
    if "priority" in changes:
        columns["severity"] = {priority: severity for severity, priority in SEVERITY_TO_PRIORITY.items()}[
            changes["priority"]
        ]
    metadata = dict(_meta(complaint))
    if "title" in changes:
        metadata["mobile"] = {**_mobile(complaint), "issueTitle": changes["title"]}
    if "access_notes" in changes:
        metadata[ACCESS_NOTES_KEY] = changes["access_notes"]
    if metadata != _meta(complaint):
        columns["metadata"] = metadata
    now = _now()
    _sb().table(COMPLAINTS).update(stamp_update(COMPLAINTS, columns, now)).eq("id", row["complaint_id"]).execute()
    # The request's updated_at is the work order's.
    _sb().table(TABLE).update(stamp_update(TABLE, {}, now)).eq("id", request_id).execute()
    complaints_service.record_event(row["complaint_id"], tenant_id, EVENT_UPDATED, fields=sorted(changes))
    return _reread(row, tenant_id)


# ---------------------------------------------------------------------------
# The owner's steps
# ---------------------------------------------------------------------------
def _owned_row(request_id: str, owner_id: str, refusal: str) -> dict:
    row = _get_row(request_id)
    if flatten(row, owner_id)["owner_id"] != owner_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, refusal)
    return row


def assignable_providers(request_id: str, current: CurrentProfile) -> list[dict]:
    """The providers the owner may assign the repair to (mobile_repair_providers)."""
    row = _owned_row(request_id, current.id, "Only the property owner can assign a provider")
    _require_owner_steps(current)
    rows = run_function(_as(current).rpc("mobile_repair_providers", {"p_complaint_id": row["complaint_id"]})) or []
    return [{
        "id": provider["id"],
        "name": provider.get("name") or "Service provider",
        "service_area": provider.get("serviceArea") or None,
        "pricing_summary": provider.get("pricing") or None,
    } for provider in rows]


def assign_provider(request_id: str, current: CurrentProfile, provider_id: str) -> dict:
    """Give the repair to a provider whose categories hold its category (mobile_assign_repair)."""
    row = _owned_row(request_id, current.id, "Only the property owner can assign a provider")
    _require_owner_steps(current)
    if _work_status(row) not in (MAINT_OPEN, MAINT_ASSIGNED):
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_ASSIGNABLE)
    if not is_uuid(provider_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
    # Repairs go to a verified provider with an active account only (R18).
    gates.require_verified_party(provider_id, "receive_repairs")
    run_function(_as(current).rpc("mobile_assign_repair", {
        "p_complaint_id": row["complaint_id"], "p_provider_id": provider_id,
    }))
    return _reread(row, current.id)


def resolve(request_id: str, current: CurrentProfile, note: str | None) -> dict:
    """The owner closing the repair, at any stage (mobile_resolve_repair)."""
    row = _owned_row(request_id, current.id, "Only the property owner can mark a repair resolved")
    _require_owner_steps(current)
    run_function(_as(current).rpc("mobile_resolve_repair", {"p_complaint_id": row["complaint_id"], "p_note": note}))
    return _reread(row, current.id)


# ---------------------------------------------------------------------------
# The tenant's steps
# ---------------------------------------------------------------------------
def _tenants_row(request_id: str, tenant_id: str) -> dict:
    row = _get_row(request_id)
    if row.get("tenant_user_id") != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the tenant of this repair can confirm or rate it")
    return row


def confirm(request_id: str, current: CurrentProfile, rating: int) -> dict:
    """The tenant confirming the work the provider marked done, with a rating (mobile_confirm_repair)."""
    row = _tenants_row(request_id, current.id)
    run_function(_as(current).rpc("mobile_confirm_repair", {"p_complaint_id": row["complaint_id"], "p_rating": rating}))
    return _reread(row, current.id)


def rate(request_id: str, current: CurrentProfile, rating: int) -> dict:
    """The tenant rating a repair the owner resolved without their confirmation (mobile_rate_repair)."""
    row = _tenants_row(request_id, current.id)
    run_function(_as(current).rpc("mobile_rate_repair", {"p_complaint_id": row["complaint_id"], "p_rating": rating}))
    return _reread(row, current.id)


def set_status(request_id: str, current: CurrentProfile, payload: dict) -> dict:
    """The older status route: only the owner's resolved maps onto a shared step (resolve()).

    in_progress is what assigning and booking the visit write; a repair has
    no cancelled state on the shared database; the tenant confirms and the
    provider completes through their own steps.
    """
    if current.role == "admin":
        # Cancelling or closing a repair here would keep no note, audit entry or notice.
        raise HTTPException(status.HTTP_403_FORBIDDEN, ADMIN_MOVES_NO_REPAIR)
    row = _get_row(request_id)
    request = flatten(row, current.id)
    assert_participant(request, current.id)
    new_status = payload["status"]
    if new_status == "resolved":
        if request["owner_id"] == current.id:
            return resolve(request_id, current, payload.get("resolution_note"))
        if request["tenant_id"] == current.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, TENANT_CONFIRMS)
        raise HTTPException(status.HTTP_403_FORBIDDEN, PROVIDER_COMPLETES_FROM_REPAIRS)
    if new_status == "cancelled":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NO_WITHDRAWAL)
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, STATUS_MOVES_ITSELF)


# ---------------------------------------------------------------------------
# The assigned provider's side (tracker R33): the work orders whose
# assigned_worker_id is the provider's users.id. Until a visit is booked the
# provider sees the job's suburb, not the street, the access notes or the
# tenant. Booking the visit and completing the job are the shared functions,
# which add the timeline steps and tell the tenant and the owner.
# ---------------------------------------------------------------------------
# What the assigned provider is shown, from the work order's web status and
# whether a visit is booked.
STAGE_OF_STATUS = {"resolved": "completed", "awaiting_confirmation": "completed", "cancelled": "cancelled"}
STAGE_ORDER = ("assigned", "scheduled", "completed", "cancelled")
PLACE_FIELDS = "id, address_line_1, address_line_2, suburb, state, postcode"
# Stored statuses no visit of the current assignee's is booked in: assigning
# (assign_maintenance_work_order) writes ASSIGNED and keeps appointment_at,
# so a time left from an earlier assignee is not this provider's visit.
UNBOOKED_STATUSES = ("OPEN", "PENDING", "ASSIGNED")


def _visit_booked(row: dict) -> bool:
    """Whether the current assignee booked the visit: a time, in a status past ASSIGNED."""
    return bool(row.get("appointment_at")) and _work_status(row) not in UNBOOKED_STATUSES


def _shown_to(viewer_id: str, request: dict, visit_booked: bool) -> dict:
    """A MaintenanceOut as viewer_id may see it: the assigned provider gets no street, access
    notes, tenant or visit time before they book the visit (_visit_booked)."""
    is_party = viewer_id in (request.get("tenant_id"), request.get("owner_id"))
    if request.get("provider_id") != viewer_id or is_party or visit_booked:
        return request
    return {
        **request, "property_address": None, "access_notes": None, "tenant_name": None, "assigned_at": None,
        "appointment_at": None, "estimated_duration_minutes": None, "appointment_note": None,
    }


def _stage(row: dict) -> str:
    status_name = STATUS_TO_WEB.get(_work_status(row), "open")
    if status_name in STAGE_OF_STATUS:
        return STAGE_OF_STATUS[status_name]
    return "scheduled" if _visit_booked(row) else "assigned"


def _assigned_rows(provider_id: str, request_id: str | None = None) -> list[dict]:
    query = _sb().table(TABLE).select(PROVIDER_SELECT).eq("assigned_worker_id", provider_id)
    if request_id is not None:
        query = query.eq("id", request_id)
    return query.order("created_at", desc=True).order("id").execute().data or []


def _assigned_row(request_id: str, provider_id: str) -> dict:
    """The work order if it is assigned to this provider; 404 for any other, so a job that is
    not theirs is never confirmed to exist."""
    rows = _assigned_rows(provider_id, request_id) if is_uuid(request_id) else []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, REPAIR_NOT_FOUND)
    return rows[0]


def _places(rows: list[dict]) -> dict[str, tuple[str | None, dict]]:
    """Each work order's listing title and property row, by work order id."""
    listing_ids = list({row["listing_id"] for row in rows if row.get("listing_id")})
    listings = (
        _sb().table("listings").select("id, title, property_id").in_("id", listing_ids).execute().data or []
        if listing_ids
        else []
    )
    listing_by_id = {listing["id"]: listing for listing in listings}

    def property_id(row: dict) -> str | None:
        complaint = row.get("complaints") or {}
        return (listing_by_id.get(row.get("listing_id")) or {}).get("property_id") or complaint.get("property_id")

    property_ids = list({pid for row in rows if (pid := property_id(row))})
    properties = (
        _sb().table("properties").select(PLACE_FIELDS).in_("id", property_ids).execute().data or []
        if property_ids
        else []
    )
    property_by_id = {prop["id"]: prop for prop in properties}
    places = {}
    for row in rows:
        title = (listing_by_id.get(row.get("listing_id")) or {}).get("title")
        places[row["id"]] = (title, property_by_id.get(property_id(row)) or {})
    return places


def _provider_view(rows: list[dict]) -> list[dict]:
    """Work orders as ProviderRepairOut, open jobs first and booked visits soonest first."""
    if not rows:
        return []
    places = _places(rows)
    people = {
        person
        for row in rows
        for person in (
            row.get("tenant_user_id"), row.get("landlord_user_id"), (row.get("complaints") or {}).get("against_user_id"),
        )
        if person
    }
    names = {}
    if people:
        users = _sb().table("users").select("id, full_name").in_("id", list(people)).execute().data or []
        names = {user["id"]: user.get("full_name") for user in users}
    signed = uploads.signed_urls(
        REPAIR_PHOTOS_BUCKET, [key for row in rows for key in _photo_keys(row.get("complaints") or {})],
    )

    repairs = []
    for row in rows:
        request = flatten(row, row.get("assigned_worker_id"))
        stage = _stage(row)
        title, prop = places[row["id"]]
        # The street, access notes and tenant are for a booked visit only.
        visit = bool(row.get("appointment_at")) and stage in ("scheduled", "completed")
        # A visit time kept from an earlier assignee is not this provider's to see.
        booked = stage != "assigned"
        repairs.append({
            "id": row["id"],
            "status": request["status"],
            "stage": stage,
            "category": request["category"],
            "category_label": request["category_label"],
            "priority": request["priority"],
            "title": request["title"],
            "description": request["description"],
            "photo_urls": [signed[key] for key in _photo_keys(row.get("complaints") or {}) if key in signed],
            "property_title": title,
            "suburb": prop.get("suburb"),
            "state": prop.get("state"),
            "address": (address_of(prop) or None) if visit else None,
            "access_notes": request["access_notes"] if visit else None,
            "tenant_name": names.get(row.get("tenant_user_id")) if visit else None,
            "owner_id": request["owner_id"] or None,
            "owner_name": names.get(request["owner_id"]),
            "appointment_at": row.get("appointment_at") if booked else None,
            "estimated_duration_minutes": row.get("estimated_duration_minutes") if booked else None,
            "appointment_note": (row.get("appointment_note") or None) if booked else None,
            "completed_at": row.get("completed_at"),
            "completion_note": row.get("completion_note"),
            "tenant_rating": row.get("tenant_rating"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        })

    def order(repair: dict) -> tuple:
        rank = STAGE_ORDER.index(repair["stage"])
        when = moment(repair["appointment_at"]) if repair["stage"] == "scheduled" else None
        return rank, when.timestamp() if when else 0.0

    # Stable: the database's newest-first order stays within each group.
    return sorted(repairs, key=order)


def list_assigned(provider_id: str) -> list[dict]:
    return _provider_view(_assigned_rows(provider_id))


def get_assigned(request_id: str, provider_id: str) -> dict:
    return _provider_view([_assigned_row(request_id, provider_id)])[0]


def schedule_assigned(request_id: str, current: CurrentProfile, payload: dict, now: datetime | None = None) -> dict:
    """Book (or move) the visit: its Sydney date and time, how long it takes, and a note (mobile_schedule_repair)."""
    row = _assigned_row(request_id, current.id)
    if _stage(row) in ("completed", "cancelled"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This repair is closed, so no visit can be booked for it")
    # The shared function takes a visit from an approved, active provider only,
    # first or moved: the gate says why not, with a link to the documents (R18).
    gates.require_verified(current.id, "receive_repairs")
    now = now or _now()
    visit_date: date = payload["date"]
    visit_time: time = payload["time"]
    at = datetime.combine(visit_date, visit_time.replace(tzinfo=None), tzinfo=LOCAL_TZ)
    if at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a visit time that has not passed yet")
    run_function(_as(current).rpc("mobile_schedule_repair", {
        "p_complaint_id": row["complaint_id"],
        "p_appointment_at": at.isoformat(),
        "p_duration_minutes": payload["duration_minutes"],
        "p_note": payload.get("note") or None,
    }))
    return get_assigned(request_id, current.id)


def complete_assigned(request_id: str, current: CurrentProfile, payload: dict, now: datetime | None = None) -> dict:
    """Mark the job done after its visit started, with what was done; it then waits for the tenant
    (mobile_complete_repair)."""
    row = _assigned_row(request_id, current.id)
    if _stage(row) in ("completed", "cancelled"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This repair is already done")
    visit = moment(row.get("appointment_at")) if _stage(row) == "scheduled" else None
    if visit is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Book the visit before marking the repair done")
    if visit > (now or _now()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This repair cannot be marked done before its visit")
    gates.require_verified(current.id, "receive_repairs")
    run_function(_as(current).rpc("mobile_complete_repair", {"p_complaint_id": row["complaint_id"],
                                                             "p_note": payload["note"]}))
    return get_assigned(request_id, current.id)
