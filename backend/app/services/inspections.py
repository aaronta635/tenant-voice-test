"""Inspection times, bookings and records (tracker R13), on the mobile app's functions.

Both apps keep one set of rules: every write is a mobile_inspection_* or
mobile_*_inspection function, called on the caller's JWT because each takes
the caller from current_app_user_id() (docs/shared-db.md, "Inspections").

- **Slots** (mobile_inspection_slots): an owner publishes up to 20 future
  times at once, of 15, 30, 45, 60, 90 or 120 minutes. A slot is open, held
  (a tenant asked for it), booked (the owner accepted) or cancelled.
- **Bookings** (mobile_inspection_bookings): a signed-in viewer who does not
  own the home asks for an open slot of a PUBLISHED or APPLICATIONS_CLOSED
  listing, with a note of up to 500 characters; no application is needed.
  One pending or accepted booking per home. The owner accepts, rejects or
  asks to reschedule; rejecting or rescheduling opens the slot again.
- **Records** (mobile_inspections): an inspection the owner schedules, such
  as a remote or routine one; the meeting link and the findings go in its
  notes. Scheduled, then Completed or Cancelled.

The functions write the notifications. Times are instants; a time sent
without an offset is Sydney wall-clock time (sydney_instant).
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client, user_client
from app.services.maps_messaging import filter_time

SYDNEY = ZoneInfo("Australia/Sydney")
# listings.status values whose open slots can be booked (mobile_inspection_assert_tenant_listing).
LISTED = ("PUBLISHED", "APPLICATIONS_CLOSED")
OPEN_SLOT = "open"

# A function's error -> the HTTP status the web answers with; its message is passed through.
_HTTP_STATUS = {
    "42501": status.HTTP_403_FORBIDDEN,
    "P0002": status.HTTP_404_NOT_FOUND,
    "23505": status.HTTP_409_CONFLICT,
    "22023": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "23514": status.HTTP_422_UNPROCESSABLE_ENTITY,
}
# A unique index's message names the index, not the problem.
TAKEN_SLOT = "That inspection time is no longer available."
TAKEN_TIME = "Those times already have open or booked slots."


def _call(access_token: str | None, name: str, params: dict | None = None, taken: str = "That already exists."):
    """The function's answer, run as the caller; its refusal as an HTTPException."""
    try:
        return user_client(access_token).rpc(name, params or {}).execute().data
    except APIError as exc:
        code = getattr(exc, "code", None)
        if code not in _HTTP_STATUS:
            raise
        detail = taken if code == "23505" else (exc.message or "That could not be done.")
        raise HTTPException(_HTTP_STATUS[code], detail) from exc


# ---------------------------------------------------------------------------
# Sydney time
# ---------------------------------------------------------------------------
def _wall(value: datetime) -> str:
    return value.strftime("%a %d %b %Y, %I:%M %p").replace(" 0", " ")


def sydney_instant(value: datetime) -> datetime:
    """The instant of a time the web sent: one without an offset is read as Sydney time.

    A repeated hour when daylight saving ends reads as its first (daylight)
    occurrence. An hour that does not exist when it starts is refused.
    """
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc)
    local = value.replace(tzinfo=SYDNEY)
    instant = local.astimezone(timezone.utc)
    if instant.astimezone(SYDNEY).replace(tzinfo=None) != value:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{_wall(value)} does not exist in Sydney: clocks go forward an hour that night. Choose another time.",
        )
    return instant


def _iso(value: datetime) -> str:
    return sydney_instant(value).isoformat()


# ---------------------------------------------------------------------------
# The functions' JSON, as the web's fields
# ---------------------------------------------------------------------------
def _slot(item: dict) -> dict:
    return {
        "id": item["id"],
        "property_id": item.get("listingId"),
        "owner_id": item.get("ownerId"),
        "starts_at": item.get("startsAt"),
        "duration_minutes": item.get("durationMinutes"),
        "status": item.get("status"),
        "property_title": item.get("propertyTitle"),
        "address": item.get("address"),
        "created_at": item.get("createdAt"),
        "updated_at": item.get("updatedAt"),
    }


def _booking(item: dict) -> dict:
    return {
        "id": item["id"],
        "slot_id": item.get("slotId"),
        "property_id": item.get("listingId"),
        "owner_id": item.get("ownerId"),
        "tenant_id": item.get("tenantId"),
        "status": item.get("status"),
        "note": item.get("note"),
        "starts_at": item.get("startsAt"),
        "duration_minutes": item.get("durationMinutes"),
        "slot_status": item.get("slotStatus"),
        "property_title": item.get("propertyTitle"),
        "address": item.get("address"),
        "tenant_name": item.get("tenantName"),
        "owner_name": item.get("ownerName"),
        "created_at": item.get("createdAt"),
        "updated_at": item.get("updatedAt"),
    }


def _steps(history) -> list[dict]:
    """status_history without the ids of who made each step."""
    return [
        {"status": step.get("status"), "note": step.get("note"), "at": step.get("at")}
        for step in (history if isinstance(history, list) else [])
        if isinstance(step, dict)
    ]


def _record(item: dict) -> dict:
    return {
        "id": item["id"],
        "property_id": item.get("propertyId"),
        "property_title": item.get("propertyTitle"),
        "address": item.get("address"),
        "type": item.get("type"),
        "scheduled_at": item.get("scheduledAt"),
        "attendee_id": item.get("attendeeId"),
        "attendee_name": item.get("attendeeName"),
        "notes": item.get("notes") or None,
        "status": item.get("status"),
        "history": _steps(item.get("statusHistory")),
    }


def _items(data) -> list:
    return [item for item in (data if isinstance(data, list) else []) if isinstance(item, dict)]


def _owned_by(table: str, row_id: str, owner_id: str, missing: str) -> None:
    """404 or 403 unless the caller owns the row.

    mobile_inspection_cancel_slot and mobile_inspection_decide compare the row's
    owner_id with current_app_user_id() using <>, which is null, not true, when
    the account is not ACTIVE: they would then act on anyone's row. So the web
    checks first.
    """
    rows = get_supabase_client().table(table).select("id, owner_id").eq("id", row_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, missing)
    if rows[0]["owner_id"] != owner_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, missing)


# ---------------------------------------------------------------------------
# Anyone: a listed home's open times
# ---------------------------------------------------------------------------
def public_open_slots(listing_id: str) -> list[dict]:
    """The open, future times of a listed home, soonest first, for any visitor.

    The read mobile_inspection_open_slots makes, without its sign-in: the
    slots' policy shows open slots to everyone. The street address is left
    out, as on the signed-out listing page.
    """
    supabase = get_supabase_client()
    listing = supabase.table("listings").select("id, title, status").eq("id", listing_id).limit(1).execute().data
    if not listing or listing[0].get("status") not in LISTED:
        return []
    rows = (
        supabase.table("mobile_inspection_slots")
        .select("*")
        .eq("listing_id", listing_id)
        .eq("status", OPEN_SLOT)
        .gt("starts_at", filter_time(datetime.now(timezone.utc)))
        .order("starts_at")
        .execute()
        .data
        or []
    )
    title = listing[0].get("title") or "Property"
    return [
        {
            "id": row["id"], "property_id": row["listing_id"], "owner_id": row["owner_id"],
            "starts_at": row["starts_at"], "duration_minutes": row["duration_minutes"], "status": row["status"],
            "property_title": title, "address": None, "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------
def open_slots(access_token: str, listing_id: str) -> list[dict]:
    """mobile_inspection_open_slots: the times the caller can book at this home."""
    return [_slot(item) for item in _items(_call(access_token, "mobile_inspection_open_slots",
                                                 {"p_listing_id": listing_id}))]


def book(access_token: str, slot_id: str, note: str | None) -> dict:
    """mobile_inspection_book: ask for a slot, which is held until the owner decides."""
    return _booking(_call(access_token, "mobile_inspection_book", {"p_slot_id": slot_id, "p_note": note},
                          taken=TAKEN_SLOT))


def my_bookings(access_token: str) -> list[dict]:
    """mobile_inspection_my_bookings: the caller's bookings, latest time first; cancelled ones are left out."""
    return [_booking(item) for item in _items(_call(access_token, "mobile_inspection_my_bookings"))]


def tenant_homes(access_token: str) -> list[dict]:
    """mobile_inspection_tenant_homes: listed homes of other owners with open times, most times first."""
    return [
        {
            "property_id": item.get("listingId"),
            "title": item.get("title"),
            "address": item.get("address"),
            "owner_id": item.get("ownerId"),
            "owner_name": item.get("ownerName"),
            "open_slot_count": item.get("openSlotCount") or 0,
        }
        for item in _items(_call(access_token, "mobile_inspection_tenant_homes"))
    ]


def attendee_records(user_id: str) -> list[dict]:
    """The inspections an owner scheduled with this person as the attendee, soonest first.

    No function lists them for the attendee, so this reads the rows, in the
    shape mobile_inspection_json gives the owner: a remote inspection's
    meeting link is in its notes. The history's notes are the owner's own
    (findings, a reason to cancel), so the attendee gets its steps without
    them; on the mobile app an attendee sees no notes at all.
    """
    rows = (
        get_supabase_client()
        .table("mobile_inspections")
        .select("*, listings(title, status, properties(address_line_1, suburb, state, postcode))")
        .eq("attendee_user_id", user_id)
        .order("scheduled_at")
        .execute()
        .data
        or []
    )
    records = []
    for row in rows:
        listing = row.get("listings") or {}
        prop = listing.get("properties") or {}
        address = ", ".join(str(prop[key]) for key in ("address_line_1", "suburb", "state", "postcode")
                            if prop.get(key) is not None)
        record = _record({
            "id": row["id"], "propertyId": row["listing_id"],
            "propertyTitle": (listing.get("title") or "").strip() or "Property",
            "address": address or "Address not provided", "type": row["inspection_type"],
            "scheduledAt": row["scheduled_at"], "attendeeId": row["attendee_user_id"], "attendeeName": None,
            "notes": row.get("notes"), "status": row["status"], "statusHistory": row.get("status_history"),
        })
        record["history"] = [{**step, "note": None} for step in record["history"]]
        # A routine or condition inspection is of a leased home, whose listing page is not public.
        record["listed"] = listing.get("status") in LISTED
        records.append(record)
    return records


# ---------------------------------------------------------------------------
# Owners: slots and bookings
# ---------------------------------------------------------------------------
def owner_overview(access_token: str, listing_id: str | None = None) -> dict:
    """mobile_inspection_owner_list: the caller's slots (14 days back) and bookings (30 days back)."""
    params = {"p_listing_id": listing_id} if listing_id else {}
    data = _call(access_token, "mobile_inspection_owner_list", params)
    data = data if isinstance(data, dict) else {}
    return {
        "slots": [_slot(item) for item in _items(data.get("slots"))],
        "bookings": [_booking(item) for item in _items(data.get("bookings"))],
    }


def create_slots(access_token: str, listing_id: str, starts: list[datetime], duration_minutes: int | None) -> list[dict]:
    """mobile_inspection_create_slots: the new slots; a time the listing already has is skipped."""
    params = {"p_listing_id": listing_id, "p_starts": [_iso(start) for start in starts],
              "p_duration_minutes": duration_minutes}
    return [_slot(item) for item in _items(_call(access_token, "mobile_inspection_create_slots", params,
                                                 taken=TAKEN_TIME))]


def cancel_slot(access_token: str, owner_id: str, slot_id: str) -> dict:
    """mobile_inspection_cancel_slot: the slot, cancelled with the requests waiting on it."""
    _owned_by("mobile_inspection_slots", slot_id, owner_id, "Inspection time not found.")
    return _slot(_call(access_token, "mobile_inspection_cancel_slot", {"p_slot_id": slot_id}))


def decide(access_token: str, owner_id: str, booking_id: str, decision: str) -> dict:
    """mobile_inspection_decide: accept, reject or reschedule a pending booking."""
    _owned_by("mobile_inspection_bookings", booking_id, owner_id, "Inspection request not found.")
    return _booking(_call(access_token, "mobile_inspection_decide",
                          {"p_booking_id": booking_id, "p_decision": decision}))


# ---------------------------------------------------------------------------
# Owners: inspection records
# ---------------------------------------------------------------------------
def owner_records(access_token: str, listing_id: str | None = None) -> list[dict]:
    """mobile_owner_inspections: the caller's records, soonest first, of one listing if given."""
    records = [_record(item) for item in _items(_call(access_token, "mobile_owner_inspections"))]
    return [record for record in records if listing_id is None or record["property_id"] == listing_id]


def _record_json(access_token: str, inspection_id) -> dict:
    data = _call(access_token, "mobile_inspection_json", {"p_inspection_id": inspection_id})
    if not isinstance(data, dict):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Inspection not found.")
    return _record(data)


def create_record(access_token: str, listing_id: str, payload: dict) -> dict:
    """mobile_create_inspection, then the record it made."""
    inspection_id = _call(access_token, "mobile_create_inspection", {
        "p_listing_id": listing_id,
        "p_type": payload["type"],
        "p_scheduled_at": _iso(payload["scheduled_at"]),
        "p_attendee_id": payload.get("attendee_id"),
        "p_notes": payload.get("notes"),
    })
    return _record_json(access_token, inspection_id)


def update_record(access_token: str, inspection_id: str, payload: dict) -> dict:
    """mobile_update_inspection: a Scheduled record's type, time, attendee and notes."""
    return _record(_call(access_token, "mobile_update_inspection", {
        "p_inspection_id": inspection_id,
        "p_type": payload["type"],
        "p_scheduled_at": _iso(payload["scheduled_at"]),
        "p_attendee_id": payload.get("attendee_id"),
        "p_notes": payload.get("notes"),
    }))


def set_record_status(access_token: str, inspection_id: str, new_status: str, note: str | None) -> dict:
    """mobile_set_inspection_status: Completed or Cancelled, with a note for the history."""
    return _record(_call(access_token, "mobile_set_inspection_status",
                         {"p_inspection_id": inspection_id, "p_status": new_status, "p_note": note}))


def attendees(access_token: str, listing_id: str) -> list[dict]:
    """mobile_inspection_applicants: who may attend a record, everyone who applied and did not withdraw."""
    return [{"user_id": item.get("userId"), "name": item.get("name")}
            for item in _items(_call(access_token, "mobile_inspection_applicants", {"p_listing_id": listing_id}))]
