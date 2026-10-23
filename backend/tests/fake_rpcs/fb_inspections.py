"""The inspection functions: slots and bookings, and the inspection records.

Written from output/shared-catalog/functions/mobile_inspection_*.sql and
mobile_{create,update}_inspection.sql, mobile_set_inspection_status.sql,
mobile_owner_inspections.sql (snapshot of 2026-10-23). Each runs as one
transaction, so a stand-in checks everything that can fail before it
writes anything.

The tables' unique partial indexes are not in the schema snapshot, so the
stand-ins apply them (output/shared-catalog/indexs.md):

- mobile_inspection_slots_listing_start_active_idx: one open, held or
  booked slot per (listing_id, starts_at);
- mobile_inspection_bookings_active_slot_idx: one pending, accepted or
  reschedule_requested booking per slot_id. A booking the owner asked to
  reschedule keeps its slot in the index although the slot is open again,
  so anyone else booking that slot fails with 23505.

now() is the transaction's time: one value per call.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

SYDNEY = ZoneInfo("Australia/Sydney")
DURATIONS = (15, 30, 45, 60, 90, 120)
ACTIVE_SLOT = ("open", "held", "booked")
ACTIVE_BOOKING = ("pending", "accepted", "reschedule_requested")
LISTED = ("PUBLISHED", "APPLICATIONS_CLOSED")
INSPECTION_TYPES = ("Open home", "Private viewing", "Routine inspection", "Entry condition", "Exit condition")


# -- values -----------------------------------------------------------------
def _at(value) -> datetime | None:
    """A timestamptz as an aware datetime: compared as instants, as Postgres does."""
    if value is None:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _now(ctx) -> datetime:
    return _at(ctx.now())


def _trim(value) -> str:
    """SQL trim()/btrim(): spaces only."""
    return (value or "").strip(" ")


def _concat_ws(*parts) -> str:
    """concat_ws(', ', ...): nulls are skipped, empty strings kept."""
    return ", ".join(str(part) for part in parts if part is not None)


def _when(value) -> str:
    """mobile_inspection_when: to_char(at time zone 'Australia/Sydney', 'Dy DD Mon, HH12:MI AM')."""
    return _at(value).astimezone(SYDNEY).strftime("%a %d %b, %I:%M %p")


# -- rows -------------------------------------------------------------------
def _one(ctx, table: str, **match) -> dict | None:
    for row in ctx.rows(table):
        if all(row.get(column) == value for column, value in match.items()):
            return row
    return None


def _listing_and_property(ctx, listing_id) -> tuple[dict | None, dict | None]:
    listing = _one(ctx, "listings", id=listing_id)
    prop = _one(ctx, "properties", id=listing["property_id"]) if listing else None
    return (listing, prop) if prop else (None, None)


def _address(prop: dict) -> str:
    return _concat_ws(prop.get("address_line_1"), prop.get("suburb"), prop.get("state"), prop.get("postcode"))


def _user(ctx, user_id) -> dict | None:
    return _one(ctx, "users", id=user_id) if user_id else None


def _caller(ctx):
    caller = ctx.caller
    return caller["id"] if caller else None


def _update(ctx, table: str, row_id, changes: dict) -> dict:
    [updated] = ctx.table(table).update(changes).eq("id", row_id).execute().data
    return updated


def _notify(ctx, user_id, title, body, now: datetime) -> None:
    """mobile_inspection_notify: a system notification that opens /inspections."""
    if user_id is None:
        return
    ctx.table("notifications").insert({
        "user_id": user_id,
        "title": (title if title is not None else "Inspection update")[:120],
        "body": (body or "")[:2000],
        "category": "system",
        "link": "/inspections",
        "is_read": False,
        "created_at": _iso(now),
    }).execute()


# -- json -------------------------------------------------------------------
def _slot_json(ctx, slot: dict) -> dict | None:
    listing, prop = _listing_and_property(ctx, slot["listing_id"])
    if listing is None:
        return None
    return {
        "id": slot["id"],
        "listingId": slot["listing_id"],
        "ownerId": slot["owner_id"],
        "startsAt": slot["starts_at"],
        "durationMinutes": slot["duration_minutes"],
        "status": slot["status"],
        "propertyTitle": listing.get("title") if listing.get("title") is not None else "Property",
        "address": _address(prop),
        "createdAt": slot["created_at"],
        "updatedAt": slot["updated_at"],
    }


def _name(user: dict | None, fallback: str) -> str:
    return _trim(user.get("full_name")) if user and _trim(user.get("full_name")) else fallback


def _booking_json(ctx, booking: dict) -> dict | None:
    slot = _one(ctx, "mobile_inspection_slots", id=booking["slot_id"])
    listing, prop = _listing_and_property(ctx, booking["listing_id"])
    if slot is None or listing is None:
        return None
    return {
        "id": booking["id"],
        "slotId": booking["slot_id"],
        "listingId": booking["listing_id"],
        "ownerId": booking["owner_id"],
        "tenantId": booking["tenant_id"],
        "status": booking["status"],
        "note": booking.get("note"),
        "startsAt": slot["starts_at"],
        "durationMinutes": slot["duration_minutes"],
        "slotStatus": slot["status"],
        "propertyTitle": listing.get("title") if listing.get("title") is not None else "Property",
        "address": _address(prop),
        "tenantName": _name(_user(ctx, booking["tenant_id"]), "Tenant"),
        "ownerName": _name(_user(ctx, booking["owner_id"]), "Owner"),
        "createdAt": booking["created_at"],
        "updatedAt": booking["updated_at"],
    }


def _inspection_json(ctx, inspection_id) -> dict | None:
    """mobile_inspection_json(p_inspection_id)."""
    row = _one(ctx, "mobile_inspections", id=inspection_id)
    listing, prop = _listing_and_property(ctx, row["listing_id"]) if row else (None, None)
    if listing is None:
        return None
    attendee = _user(ctx, row.get("attendee_user_id"))
    attendee_name = None
    if row.get("attendee_user_id") is not None:
        attendee_name = _name(attendee, "") or (attendee or {}).get("email") or "Applicant"
    return {
        "id": row["id"],
        "propertyId": row["listing_id"],
        "propertyTitle": _trim(listing.get("title")) or "Property",
        "address": _address(prop) or "Address not provided",
        "type": row["inspection_type"],
        "scheduledAt": row["scheduled_at"],
        "attendeeId": row.get("attendee_user_id"),
        "attendeeName": attendee_name,
        "notes": row.get("notes"),
        "status": row["status"],
        "statusHistory": row.get("status_history"),
    }


def _sorted(rows: list, key) -> list:
    return sorted(rows, key=key)


# -- the caller's listings ----------------------------------------------------
def _assert_owner_listing(ctx, listing_id):
    """mobile_inspection_assert_owner_listing: the caller owns the listing's property."""
    user = _caller(ctx)
    _, prop = _listing_and_property(ctx, listing_id)
    if prop is None or prop["owner_user_id"] != user or user is None:
        raise api_error("42501", "Choose one of your properties.")
    return user


def _assert_tenant_listing(ctx, listing_id):
    """mobile_inspection_assert_tenant_listing: a signed-in viewer, not the owner, of a listed home."""
    user = _caller(ctx)
    if user is None:
        raise api_error("42501", "Sign in to book an inspection.")
    listing, prop = _listing_and_property(ctx, listing_id)
    if listing is None:
        raise api_error("22023", "Property not found.")
    if prop["owner_user_id"] == user:
        raise api_error("42501", "Owners publish times on Inspections; booking is for viewers.")
    if listing["status"] not in LISTED:
        raise api_error("22023", "Inspections are only available while this property is listed for viewing.")
    return user


# -- slots and bookings -------------------------------------------------------
@rpc("mobile_inspection_create_slots")
def create_slots(ctx, params):
    listing_id = params["p_listing_id"]
    duration = params.get("p_duration_minutes")
    duration = 30 if duration is None else duration
    starts = params.get("p_starts")
    user = _assert_owner_listing(ctx, listing_id)
    if duration not in DURATIONS:
        raise api_error("22023", "Choose a duration of 15, 30, 45, 60, 90 or 120 minutes.")
    if not starts:
        raise api_error("22023", "Add at least one inspection time.")
    if len(starts) > 20:
        raise api_error("22023", "You can create up to 20 slots at once.")
    now = _now(ctx)
    if any(start is None or _at(start) <= now for start in starts):
        raise api_error("22023", "Inspection times must be in the future.")

    taken = {_at(slot["starts_at"]) for slot in ctx.rows("mobile_inspection_slots")
             if slot["listing_id"] == listing_id and slot["status"] in ACTIVE_SLOT}
    fresh = []
    for start in map(_at, starts):
        if start in taken:
            continue  # the function skips a time the listing already has
        taken.add(start)
        fresh.append(start)
    if not fresh:
        raise api_error("22023", "Those times already have open or booked slots.")

    created = []
    for start in fresh:
        [slot] = ctx.table("mobile_inspection_slots").insert({
            "owner_id": user, "listing_id": listing_id, "starts_at": _iso(start), "duration_minutes": duration,
            "status": "open", "created_at": _iso(now), "updated_at": _iso(now),
        }).execute().data
        created.append(_slot_json(ctx, slot))
    return created


@rpc("mobile_inspection_cancel_slot")
def cancel_slot(ctx, params):
    user = _caller(ctx)
    slot = _one(ctx, "mobile_inspection_slots", id=params["p_slot_id"])
    # "not found or owner_id <> v_user": with no app user (an account that is not
    # ACTIVE) the comparison is null, so the function goes on for any slot.
    if slot is None or (user is not None and slot["owner_id"] != user):
        raise api_error("42501", "Slot not found.")
    if slot["status"] == "cancelled":
        return _slot_json(ctx, slot)
    if slot["status"] == "booked":
        raise api_error("22023", "Cancel the accepted booking before removing this slot.")

    now = _now(ctx)
    slot = _update(ctx, "mobile_inspection_slots", slot["id"], {"status": "cancelled", "updated_at": _iso(now)})
    waiting = [booking for booking in ctx.rows("mobile_inspection_bookings")
               if booking["slot_id"] == slot["id"] and booking["status"] in ("pending", "reschedule_requested")]
    for booking in waiting:
        _update(ctx, "mobile_inspection_bookings", booking["id"], {"status": "cancelled", "updated_at": _iso(now)})
        _notify(ctx, booking["tenant_id"], "Inspection slot cancelled",
                "The owner cancelled an inspection time. Please pick another open slot if you still need one.", now)
    return _slot_json(ctx, slot)


@rpc("mobile_inspection_owner_list")
def owner_list(ctx, params):
    user = _caller(ctx)
    listing_id = params.get("p_listing_id")
    if listing_id is not None:
        _assert_owner_listing(ctx, listing_id)
    now = _now(ctx)
    slots = [slot for slot in ctx.rows("mobile_inspection_slots")
             if user is not None and slot["owner_id"] == user and slot["status"] != "cancelled"
             and (listing_id is None or slot["listing_id"] == listing_id)
             and _at(slot["starts_at"]) > now - timedelta(days=14)]
    slot_by_id = {slot["id"]: slot for slot in ctx.rows("mobile_inspection_slots")}
    bookings = [booking for booking in ctx.rows("mobile_inspection_bookings")
                if user is not None and booking["owner_id"] == user and booking["slot_id"] in slot_by_id
                and (listing_id is None or booking["listing_id"] == listing_id)
                and booking["status"] in ("pending", "accepted", "reschedule_requested", "rejected")
                and _at(slot_by_id[booking["slot_id"]]["starts_at"]) > now - timedelta(days=30)]
    return {
        "slots": [_slot_json(ctx, slot) for slot in _sorted(slots, lambda s: _at(s["starts_at"]))],
        "bookings": [_booking_json(ctx, booking) for booking in
                     _sorted(bookings, lambda b: _at(slot_by_id[b["slot_id"]]["starts_at"]))],
    }


@rpc("mobile_inspection_decide")
def decide(ctx, params):
    user = _caller(ctx)
    decision = _trim(params.get("p_decision")).lower()
    if decision not in ("accept", "reject", "reschedule"):
        raise api_error("22023", "Choose accept, reject or reschedule.")
    booking = _one(ctx, "mobile_inspection_bookings", id=params["p_booking_id"])
    # As in mobile_inspection_cancel_slot, a null app user passes this check.
    if booking is None or (user is not None and booking["owner_id"] != user):
        raise api_error("42501", "Booking not found.")
    if booking["status"] != "pending":
        raise api_error("22023", "This booking has already been decided.")

    now = _now(ctx)
    status, slot_status, title, body = {
        "accept": ("accepted", "booked", "Inspection viewing approved",
                   "Your inspection viewing was approved. This is not a rental application decision. "
                   "See Inspections for the time."),
        "reject": ("rejected", "open", "Inspection viewing declined",
                   "Your inspection viewing request was declined. You can book another open slot."),
        "reschedule": ("reschedule_requested", "open", "Please reschedule inspection",
                       "The owner asked you to pick a different inspection viewing time."),
    }[decision]
    booking = _update(ctx, "mobile_inspection_bookings", booking["id"], {"status": status, "updated_at": _iso(now)})
    _update(ctx, "mobile_inspection_slots", booking["slot_id"], {"status": slot_status, "updated_at": _iso(now)})
    _notify(ctx, booking["tenant_id"], title, body, now)
    return _booking_json(ctx, booking)


@rpc("mobile_inspection_open_slots")
def open_slots(ctx, params):
    listing_id = params["p_listing_id"]
    _assert_tenant_listing(ctx, listing_id)
    now = _now(ctx)
    slots = [slot for slot in ctx.rows("mobile_inspection_slots")
             if slot["listing_id"] == listing_id and slot["status"] == "open" and _at(slot["starts_at"]) > now]
    return [_slot_json(ctx, slot) for slot in _sorted(slots, lambda s: _at(s["starts_at"]))]


@rpc("mobile_inspection_book")
def book(ctx, params):
    user = _caller(ctx)
    note = _trim(params.get("p_note"))[:500] or None
    slot = _one(ctx, "mobile_inspection_slots", id=params["p_slot_id"])
    now = _now(ctx)
    if slot is None or slot["status"] != "open" or _at(slot["starts_at"]) <= now:
        raise api_error("22023", "That inspection time is no longer available.")
    _assert_tenant_listing(ctx, slot["listing_id"])
    bookings = ctx.rows("mobile_inspection_bookings")
    if any(b["tenant_id"] == user and b["listing_id"] == slot["listing_id"] and b["status"] in ("pending", "accepted")
           for b in bookings):
        raise api_error("22023", "You already have an active inspection for this home.")

    # The caller's reschedule requests for this home are cancelled before the insert,
    # so only someone else's booking can still hold the slot in the unique index.
    closing = [b for b in bookings if b["tenant_id"] == user and b["listing_id"] == slot["listing_id"]
               and b["status"] == "reschedule_requested"]
    holding = [b for b in bookings if b["slot_id"] == slot["id"] and b["status"] in ACTIVE_BOOKING
               and b not in closing]
    if holding:
        raise api_error("23505", 'duplicate key value violates unique constraint "mobile_inspection_bookings_active_slot_idx"',
                        f"Key (slot_id)=({slot['id']}) already exists.")

    for previous in closing:
        _update(ctx, "mobile_inspection_bookings", previous["id"], {"status": "cancelled", "updated_at": _iso(now)})
    slot = _update(ctx, "mobile_inspection_slots", slot["id"], {"status": "held", "updated_at": _iso(now)})
    [booking] = ctx.table("mobile_inspection_bookings").insert({
        "slot_id": slot["id"], "owner_id": slot["owner_id"], "tenant_id": user, "listing_id": slot["listing_id"],
        "status": "pending", "note": note, "created_at": _iso(now), "updated_at": _iso(now),
    }).execute().data
    name = _name(_user(ctx, user), "a tenant")
    _notify(ctx, slot["owner_id"], "New inspection request",
            f"{name} requested an inspection. Open Inspections to accept, decline or ask to reschedule.", now)
    return _booking_json(ctx, booking)


@rpc("mobile_inspection_my_bookings")
def my_bookings(ctx, params):
    user = _caller(ctx)
    slot_by_id = {slot["id"]: slot for slot in ctx.rows("mobile_inspection_slots")}
    mine = [booking for booking in ctx.rows("mobile_inspection_bookings")
            if user is not None and booking["tenant_id"] == user and booking["status"] != "cancelled"
            and booking["slot_id"] in slot_by_id]
    mine = _sorted(mine, lambda b: _at(slot_by_id[b["slot_id"]]["starts_at"]))[::-1]
    return [_booking_json(ctx, booking) for booking in mine]


@rpc("mobile_inspection_tenant_homes")
def tenant_homes(ctx, params):
    user = _caller(ctx)
    now = _now(ctx)
    homes = []
    for listing in ctx.rows("listings"):
        prop = _one(ctx, "properties", id=listing["property_id"])
        if prop is None or listing["status"] not in LISTED or (user is not None and prop["owner_user_id"] == user):
            continue
        count = sum(1 for slot in ctx.rows("mobile_inspection_slots")
                    if slot["listing_id"] == listing["id"] and slot["status"] == "open" and _at(slot["starts_at"]) > now)
        if count == 0:
            continue
        owner = _user(ctx, prop["owner_user_id"])
        homes.append({
            "listingId": listing["id"],
            "propertyId": prop["id"],
            "title": listing["title"],
            "address": _address(prop),
            "ownerId": prop["owner_user_id"],
            "ownerName": _name(owner, "Property Owner"),
            "openSlotCount": count,
        })
    return sorted(homes, key=lambda home: (-home["openSlotCount"], home["title"]))


# -- inspection records ----------------------------------------------------------
def _signed_in(ctx):
    user = _caller(ctx)
    if user is None:
        raise api_error("42501", "Please sign in first.")
    return user


def _check_record(scheduled_at, inspection_type, notes, now: datetime) -> None:
    if inspection_type not in INSPECTION_TYPES:
        raise api_error("22023", "Choose a valid inspection type.")
    if scheduled_at is None or _at(scheduled_at) <= now:
        raise api_error("22023", "Choose a date and time in the future.")
    if len(notes or "") > 1000:
        raise api_error("22023", "Notes can be up to 1000 characters.")


def _has_applied(ctx, listing_id, user_id) -> bool:
    return any(application["listing_id"] == listing_id and application["applicant_user_id"] == user_id
               for application in ctx.rows("rental_applications"))


def _history_entry(status: str, note: str, user, now: datetime) -> dict:
    return {"status": status, "note": note, "byUserId": user, "at": _iso(now)}


def _listing_title(ctx, listing_id) -> str:
    listing = _one(ctx, "listings", id=listing_id)
    return _trim((listing or {}).get("title")) or "the property"


@rpc("mobile_create_inspection")
def create_inspection(ctx, params):
    user = _signed_in(ctx)
    listing_id = params["p_listing_id"]
    _, prop = _listing_and_property(ctx, listing_id)
    if prop is None or prop["owner_user_id"] != user:
        raise api_error("42501", "You can only schedule inspections for your own properties.")
    title = _listing_title(ctx, listing_id)
    inspection_type, scheduled_at = params["p_type"], params["p_scheduled_at"]
    attendee, notes = params.get("p_attendee_id"), params.get("p_notes")
    now = _now(ctx)
    _check_record(scheduled_at, inspection_type, notes, now)
    if attendee is not None and not _has_applied(ctx, listing_id, attendee):
        raise api_error("22023", "That person has not applied for this property.")

    [row] = ctx.table("mobile_inspections").insert({
        "owner_user_id": user, "listing_id": listing_id, "inspection_type": inspection_type,
        "scheduled_at": _iso(_at(scheduled_at)), "attendee_user_id": attendee, "notes": _trim(notes),
        "status": "Scheduled",
        "status_history": [_history_entry("Scheduled", "Inspection scheduled by owner", user, now)],
        "created_at": _iso(now), "updated_at": _iso(now),
    }).execute().data
    if attendee is not None:
        _notify(ctx, attendee, "Inspection scheduled",
                f"{inspection_type} at {title} on {_when(scheduled_at)}.", now)
    return row["id"]


@rpc("mobile_update_inspection")
def update_inspection(ctx, params):
    user = _signed_in(ctx)
    row = _one(ctx, "mobile_inspections", id=params["p_inspection_id"])
    if row is None or row["owner_user_id"] != user:
        raise api_error("42501", "Inspection not found.")
    if row["status"] != "Scheduled":
        raise api_error("22023", "Only scheduled inspections can be edited.")
    inspection_type, scheduled_at = params["p_type"], params["p_scheduled_at"]
    attendee, notes = params.get("p_attendee_id"), params.get("p_notes")
    now = _now(ctx)
    _check_record(scheduled_at, inspection_type, notes, now)
    new_invitee = attendee is not None and attendee != row.get("attendee_user_id")
    if new_invitee and not _has_applied(ctx, row["listing_id"], attendee):
        raise api_error("22023", "That person has not applied for this property.")

    rescheduled = _at(row["scheduled_at"]) != _at(scheduled_at)
    history = list(row.get("status_history") or [])
    if rescheduled:
        history.append(_history_entry("Scheduled", f"Rescheduled to {_when(scheduled_at)}", user, now))
    _update(ctx, "mobile_inspections", row["id"], {
        "inspection_type": inspection_type, "scheduled_at": _iso(_at(scheduled_at)), "attendee_user_id": attendee,
        "notes": _trim(notes), "updated_at": _iso(now), "status_history": history,
    })
    if attendee is not None and (rescheduled or new_invitee):
        _notify(ctx, attendee, "Inspection scheduled" if new_invitee else "Inspection rescheduled",
                f"{inspection_type} at {_listing_title(ctx, row['listing_id'])} is {_when(scheduled_at)}.", now)
    return _inspection_json(ctx, row["id"])


@rpc("mobile_set_inspection_status")
def set_inspection_status(ctx, params):
    user = _signed_in(ctx)
    status = params["p_status"]
    if status not in ("Completed", "Cancelled"):
        raise api_error("22023", "Status must be Completed or Cancelled.")
    row = _one(ctx, "mobile_inspections", id=params["p_inspection_id"])
    if row is None or row["owner_user_id"] != user:
        raise api_error("42501", "Inspection not found.")
    if row["status"] != "Scheduled":
        raise api_error("22023", f"This inspection is already {row['status'].lower()}.")

    now = _now(ctx)
    note = _trim(params.get("p_note")) or f"Status updated to {status}"
    _update(ctx, "mobile_inspections", row["id"], {
        "status": status, "updated_at": _iso(now),
        "status_history": list(row.get("status_history") or []) + [_history_entry(status, note, user, now)],
    })
    if status == "Cancelled":
        for request in ctx.rows("mobile_inspection_requests"):
            if request.get("inspection_id") == row["id"] and request["status"] == "Approved":
                _update(ctx, "mobile_inspection_requests", request["id"], {"status": "Cancelled", "decided_at": _iso(now)})
        if row.get("attendee_user_id") is not None:
            _notify(ctx, row["attendee_user_id"], "Inspection cancelled",
                    f"The inspection at {_listing_title(ctx, row['listing_id'])} has been cancelled.", now)
    return _inspection_json(ctx, row["id"])


@rpc("mobile_inspection_json")
def inspection_json(ctx, params):
    return _inspection_json(ctx, params["p_inspection_id"])


@rpc("mobile_owner_inspections")
def owner_inspections(ctx, params):
    user = _signed_in(ctx)
    rows = [row for row in ctx.rows("mobile_inspections") if row["owner_user_id"] == user]
    return [_inspection_json(ctx, row["id"]) for row in _sorted(rows, lambda r: _at(r["scheduled_at"]))]


@rpc("mobile_inspection_applicants")
def inspection_applicants(ctx, params):
    user = _signed_in(ctx)
    listing_id = params["p_listing_id"]
    _, prop = _listing_and_property(ctx, listing_id)
    if prop is None or prop["owner_user_id"] != user:
        raise api_error("42501", "You can only view applicants for your own properties.")
    people = {}
    for application in ctx.rows("rental_applications"):
        if application["listing_id"] != listing_id or application["status"] == "WITHDRAWN":
            continue
        applicant = _user(ctx, application["applicant_user_id"])
        name = _name(applicant, "") or (applicant or {}).get("email") or "Applicant"
        people[application["applicant_user_id"]] = {"userId": application["applicant_user_id"], "name": name}
    return sorted(people.values(), key=lambda item: item["name"])
