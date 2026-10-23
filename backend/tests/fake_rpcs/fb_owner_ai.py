"""Stand-ins for the owner assistant's functions (area owner-ai, tracker R29-R31).

Written from output/shared-catalog/functions/ (snapshot of 2026-10-23):
mobile_owner_assistant_reserve, _context, _finish, _history, _receipt and
_action, and mobile_owner_provider_search. The helpers they call,
mobile_assistant_owner() and mobile_owner_workspace(), are private here, so
no other area's stand-in for them clashes with these.

Two things Postgres does that the fake does not are done here:

- a function that raises undoes every write it made (_atomic);
- now() is the statement's time: the rows these functions insert carry it
  (ctx.now()), so the request limits and the 30-day history count from it.

mobile_owner_assistant_action calls other functions (mobile_create_property,
mobile_review_application, mobile_assign_repair, ...). _call answers each
with the test's fixed answer (fake_db.rpc_results), another area's stand-in,
or this module's own (_NESTED: mobile_create_property, mobile_repair_event,
mobile_assistant_notify), and fails loudly for one with none, so no test
passes on a call nothing answered.
"""

import copy
import json
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from tests import fake_rpcs
from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

SYDNEY = ZoneInfo("Australia/Sydney")
RECORD_KINDS = ("lease", "inspection", "charge", "payment", "expense", "proposal", "reminder", "access_request")
DASHBOARD_CARDS = ("portfolio", "properties", "applications", "maintenance", "inspections", "accounting",
                   "reviews", "network", "subscription")
DATE_KEYS = ("dueDate", "date", "periodStart", "periodEnd")
LISTING_OPERATIONS = ("create_record", "update_record", "cancel_record", "send_proposal", "update_property",
                      "publish_listing", "create_maintenance")
REPAIR_OPERATIONS = ("reply_complaint", "resolve_complaint", "assign_maintenance", "schedule_maintenance")
RECORD_STATUS = {"inspection": "scheduled", "reminder": "pending", "proposal": "sent", "charge": "recorded",
                 "payment": "recorded", "expense": "recorded", "access_request": "not_connected"}
RECORD_MESSAGE = {
    "payment": "Payment recorded from your supplied information; no online payment was collected.",
    "lease": "Agreement draft saved. It is not signed or legally verified.",
    "access_request": "Door access is not connected; no door was unlocked.",
}


# ---------------------------------------------------------------------------
# What plpgsql does with values
# ---------------------------------------------------------------------------
def _fail(message: str):
    """`raise exception '<message>'`, which Postgres raises as P0001."""
    return api_error("P0001", message)


def _text(value):
    """jsonb ->> key: a string as it is, any other value as its JSON text, JSON null as SQL NULL."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value)


def _get(value, key):
    """jsonb -> key, which is NULL on a scalar or a missing key."""
    return value.get(key) if isinstance(value, dict) else None


def _jsonb_text(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _trim(text):
    """SQL trim(text), which takes off spaces only: a tab or a line break stays."""
    return None if text is None else text.strip(" ")


def _coalesce(*values):
    """SQL coalesce(): the first value that is not NULL, so an empty string is kept."""
    return next((value for value in values if value is not None), None)


def _uuid(text):
    if text is None:
        return None
    try:
        return str(uuid.UUID(str(text)))
    except ValueError:
        raise api_error("22P02", f'invalid input syntax for type uuid: "{text}"') from None


def _numeric(text):
    if text is None:
        return None
    try:
        return Decimal(str(text).strip())
    except InvalidOperation:
        raise api_error("22P02", f'invalid input syntax for type numeric: "{text}"') from None


def _integer(text):
    """text::integer, which takes digits only."""
    if text is None:
        return None
    if not re.fullmatch(r"\s*[+-]?\d+\s*", str(text)):
        raise api_error("22P02", f'invalid input syntax for type integer: "{text}"')
    return int(text)


def _numeric_integer(text):
    """text::numeric::integer, which rounds half away from zero."""
    number = _numeric(text)
    return None if number is None else int(number.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _boolean(text):
    if text is None:
        return None
    lowered = str(text).strip().lower()
    if lowered in ("true", "t", "yes", "y", "on", "1"):
        return True
    if lowered in ("false", "f", "no", "n", "off", "0"):
        return False
    raise api_error("22P02", f'invalid input syntax for type boolean: "{text}"')


def _date(text):
    if text is None:
        return None
    try:
        return date.fromisoformat(str(text).strip())
    except ValueError:
        raise api_error("22008", f'date/time field value out of range: "{text}"') from None


def _timestamptz(text):
    """text::timestamptz; a time with no offset is UTC, the project's time zone."""
    if text is None:
        return None
    try:
        moment = datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    except ValueError:
        raise api_error("22007", f'invalid input syntax for type timestamp with time zone: "{text}"') from None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _number(value: Decimal):
    """A numeric as jsonb holds it."""
    return int(value) if value == value.to_integral_value() else float(value)


def _initcap(text: str) -> str:
    return re.sub(r"[A-Za-z0-9]+", lambda word: word.group(0)[0].upper() + word.group(0)[1:].lower(), text)


def _ilike(value, pattern: str) -> bool:
    """value ILIKE pattern: % is any run, _ any one character."""
    if value is None:
        return False
    expression = "".join(".*" if c == "%" else "." if c == "_" else re.escape(c) for c in pattern)
    return re.fullmatch(expression, str(value), re.IGNORECASE | re.DOTALL) is not None


def _now(ctx) -> datetime:
    return datetime.fromisoformat(ctx.now())


def _at(value) -> datetime:
    """A stored timestamp, for ordering and comparing."""
    return _timestamptz(value) or datetime.min.replace(tzinfo=timezone.utc)


@contextmanager
def _atomic(ctx):
    """Undo every write if the body raises, as Postgres undoes a failed function call."""
    saved = {schema: {name: copy.deepcopy(rows) for name, rows in tables.items()}
             for schema, tables in ctx.db.schema_tables.items()}
    try:
        yield
    except BaseException:
        for schema, tables in ctx.db.schema_tables.items():
            for name, rows in tables.items():
                rows[:] = saved.get(schema, {}).get(name, [])
        raise


def _call(ctx, name: str, **params):
    """A function the body calls: the test's fixed answer, another area's stand-in, or this module's own."""
    if name in ctx.db.rpc_results:
        return copy.deepcopy(ctx.db.rpc_results[name])
    stand_in = fake_rpcs.handler(name) or _NESTED.get(name)
    if stand_in is None:
        raise NotImplementedError(f"{name} has no stand-in: set fake_db.rpc_results[{name!r}]")
    return stand_in(ctx, params)


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------
def _owner(ctx) -> str:
    """public.mobile_assistant_owner(): the caller, an active and open LANDLORD or AGENT account."""
    caller = ctx.caller
    if caller is None or caller.get("primary_role") not in ("LANDLORD", "AGENT"):
        raise api_error("42501", "Active owner access is required.")
    return caller["id"]


def _find(ctx, table: str, **match) -> dict | None:
    return next((row for row in ctx.rows(table) if all(row.get(k) == v for k, v in match.items())), None)


def _user(ctx, user_id) -> dict | None:
    return _find(ctx, "users", id=user_id) if user_id else None


def _owned_listings(ctx, owner: str) -> list[tuple[dict, dict]]:
    """listings l join properties p on p.id = l.property_id where p.owner_user_id = owner."""
    properties = {row["id"]: row for row in ctx.rows("properties")}
    return [(listing, properties[listing["property_id"]]) for listing in ctx.rows("listings")
            if listing.get("property_id") in properties
            and properties[listing["property_id"]].get("owner_user_id") == owner]


def _owns_listing(ctx, listing_id, owner: str) -> bool:
    return any(listing["id"] == listing_id for listing, _ in _owned_listings(ctx, owner))


def _request(ctx, owner: str, request_id) -> dict | None:
    return _find(ctx, "owner_assistant_requests", owner_user_id=owner, request_id=request_id)


def _set_request(ctx, owner: str, request_id, **values) -> None:
    (ctx.table("owner_assistant_requests").update(values)
     .eq("owner_user_id", owner).eq("request_id", request_id).execute())


def _approved_tenant(ctx, listing_id, user_id) -> bool:
    return any(a["listing_id"] == listing_id and a["applicant_user_id"] == user_id and a.get("status") == "APPROVED"
               for a in ctx.rows("rental_applications"))


def _active(user: dict | None) -> bool:
    return bool(user) and user.get("status") == "ACTIVE" and user.get("deleted_at") is None


def _check_turn(question, reply) -> None:
    """owner_assistant_turns' CHECK constraints, which the fake does not hold."""
    for column, value, limit in (("question", question, 4000), ("reply", reply, 16000)):
        if value is not None and len(value) > limit:
            raise api_error("23514", 'new row for relation "owner_assistant_turns" violates check constraint '
                                     f'"owner_assistant_turns_{column}_check"')


# ---------------------------------------------------------------------------
# The chat: reserve, context, finish, history, receipt
# ---------------------------------------------------------------------------
@rpc("mobile_owner_assistant_reserve")
def mobile_owner_assistant_reserve(ctx, params):
    owner = _owner(ctx)
    request_id = params["p_request"]
    row = _request(ctx, owner, request_id)
    if row is not None:
        if row["operation"] != "ai_chat":
            raise _fail("Request ID is already in use")
        if row.get("result") is not None:
            return {"cached": True, "result": row["result"]}
        raise _fail("This AI request is already being processed. Try a new request after waiting.")
    now = _now(ctx)
    chats = [_at(r["created_at"]) for r in ctx.rows("owner_assistant_requests")
             if r["owner_user_id"] == owner and r["operation"] == "ai_chat"]
    if (sum(at > now - timedelta(minutes=1) for at in chats) >= 10
            or sum(at > now - timedelta(days=1) for at in chats) >= 100):
        raise _fail("AI request limit reached. Please wait before asking again.")
    ctx.table("owner_assistant_requests").insert({
        "owner_user_id": owner, "request_id": request_id, "operation": "ai_chat", "payload": {},
        "created_at": now.isoformat(),
    }).execute()
    return {"cached": False}


def _owner_workspace(ctx, owner: str) -> dict:
    """public.mobile_owner_workspace(): the owner's assistant records on listings they still own."""
    owned = {listing["id"] for listing, _ in _owned_listings(ctx, owner)}
    records = sorted((copy.deepcopy(r) for r in ctx.rows("owner_assistant_records")
                      if r["owner_user_id"] == owner and r["listing_id"] in owned),
                     key=lambda r: _at(r["created_at"]))
    return {"asOf": ctx.now(), "records": records,
            "integrations": {"onlinePayments": False, "digitalSigning": False, "doorAccess": False}}


@rpc("mobile_owner_assistant_context")
def mobile_owner_assistant_context(ctx, params):
    owner = _owner(ctx)
    owned = _owned_listings(ctx, owner)
    listing_ids = {listing["id"] for listing, _ in owned}
    favorites = ctx.rows("listing_favorites")
    applications = [a for a in ctx.rows("rental_applications") if a["listing_id"] in listing_ids]
    properties = {row["id"]: row for row in ctx.rows("properties")}
    orders = {w["complaint_id"]: w for w in ctx.rows("maintenance_work_orders")}
    complaints = []
    for complaint in ctx.rows("complaints"):
        order, home = orders.get(complaint["id"]), properties.get(complaint.get("property_id"))
        if not order or order.get("landlord_user_id") != owner or not home or home.get("owner_user_id") != owner:
            continue
        title = _text(_get(_get(complaint.get("metadata"), "mobile"), "issueTitle")) or complaint["category"]
        complaints.append({
            "id": complaint["id"], "listingId": order.get("listing_id"), "title": title[:160],
            "description": (complaint.get("description") or "")[:800], "category": complaint["category"],
            "severity": complaint.get("severity"), "status": order.get("status"),
            "lodgedAt": complaint.get("lodged_at"), "appointmentAt": order.get("appointment_at"),
        })
    recipients = []
    for application in applications:
        applicant = _user(ctx, application["applicant_user_id"])
        if applicant is None or application.get("status") == "WITHDRAWN":
            continue
        recipients.append({
            "id": application["applicant_user_id"], "displayName": applicant.get("full_name"),
            "listingId": application["listing_id"], "applicationId": application["id"],
            "approved": application.get("status") == "APPROVED",
        })
    return {
        "ownerId": owner, "asOf": ctx.now(), "timezone": "Australia/Sydney",
        "properties": [{
            "id": listing["id"], "propertyId": home["id"], "title": listing["title"],
            "address": home["address_line_1"], "suburb": home["suburb"], "state": home["state"],
            "postcode": home["postcode"], "rent": listing["weekly_rent"], "status": listing.get("status"),
            "createdAt": listing.get("created_at"), "updatedAt": listing.get("updated_at"),
            "publishedAt": listing.get("published_at"),
            "favorites": sum(f["listing_id"] == listing["id"] for f in favorites),
            "applicationCount": sum(a["listing_id"] == listing["id"] for a in applications),
        } for listing, home in owned],
        "applications": [{
            "id": a["id"], "listingId": a["listing_id"], "applicantLabel": "Applicant " + a["id"][-6:],
            "status": a.get("status"), "submittedAt": a.get("submitted_at"),
        } for a in applications],
        "recipients": recipients,
        "complaints": complaints,
        "workspace": _owner_workspace(ctx, owner),
    }


@rpc("mobile_owner_assistant_finish")
def mobile_owner_assistant_finish(ctx, params):
    with _atomic(ctx):
        owner = _owner(ctx)
        request_id, question, result = params["p_request"], params["p_question"], params["p_result"]
        row = _request(ctx, owner, request_id)
        if row is None or row["operation"] != "ai_chat" or row.get("result") is not None:
            return None
        _set_request(ctx, owner, request_id, result=result)
        now = _now(ctx)
        reply = _text(_get(result, "reply"))
        _check_turn(question, reply)
        ctx.table("owner_assistant_turns").insert({
            "owner_user_id": owner, "chat_request_id": request_id, "question": question, "reply": reply,
            "created_at": now.isoformat(),
        }).execute()
        stale = [t["id"] for t in ctx.rows("owner_assistant_turns")
                 if t["owner_user_id"] == owner and _at(t["created_at"]) < now - timedelta(days=30)]
        if stale:
            ctx.table("owner_assistant_turns").delete().in_("id", stale).execute()
        return None


@rpc("mobile_owner_assistant_history")
def mobile_owner_assistant_history(ctx, params):
    owner = _owner(ctx)
    turns = sorted((t for t in ctx.rows("owner_assistant_turns") if t["owner_user_id"] == owner),
                   key=lambda t: _at(t["created_at"]), reverse=True)[:40]
    return [{"id": t["id"], "question": t["question"], "reply": t["reply"], "created_at": t["created_at"]}
            for t in reversed(turns)]


@rpc("mobile_owner_assistant_receipt")
def mobile_owner_assistant_receipt(ctx, params):
    with _atomic(ctx):
        owner = _owner(ctx)
        chat_id, action_id = params["p_chat_request"], params["p_action_request"]
        action = _request(ctx, owner, action_id)
        if action is None or action["operation"] == "ai_chat" or action.get("result") is None:
            raise _fail("An executed action receipt is required")
        chat = _request(ctx, owner, chat_id)
        proposed = _get(chat.get("result"), "action") if chat and chat["operation"] == "ai_chat" else None
        if (chat is None or chat["operation"] != "ai_chat"
                or _text(_get(proposed, "operation")) != action["operation"]
                or _get(proposed, "payload") != action["payload"]):
            raise _fail("Receipt does not match the assistant action")
        message = _text(_get(action["result"], "message"))
        reply = (message if message is not None else "Action completed.") + " Receipt: " + action_id
        (ctx.table("owner_assistant_turns").update({"reply": reply})
         .eq("owner_user_id", owner).eq("chat_request_id", chat_id).execute())
        _set_request(ctx, owner, chat_id, result={**chat["result"], "reply": reply})
        return None


# ---------------------------------------------------------------------------
# The action
# ---------------------------------------------------------------------------
@rpc("mobile_owner_assistant_action")
def mobile_owner_assistant_action(ctx, params):
    with _atomic(ctx):
        return _action(ctx, params["p_request"], params["p_operation"], params["p_payload"],
                       params.get("p_confirmed", False))


def _action(ctx, request_id, operation, payload, confirmed):
    owner = _owner(ctx)
    # `not p_confirmed` is NULL for a NULL p_confirmed, which fails no check.
    unconfirmed = confirmed is False
    if request_id is None or not isinstance(payload, dict) or len(_jsonb_text(payload)) > 50000:
        raise _fail("Invalid action request")
    now = _now(ctx)
    if _request(ctx, owner, request_id) is None:  # on conflict do nothing
        ctx.table("owner_assistant_requests").insert({
            "owner_user_id": owner, "request_id": request_id, "operation": operation, "payload": payload,
            "created_at": now.isoformat(),
        }).execute()
    previous = _request(ctx, owner, request_id)
    if previous["operation"] != operation or previous["payload"] != payload:
        raise _fail("This request ID was already used for different details.")
    if previous.get("result") is not None:
        return previous["result"]

    listing = _uuid(_text(payload.get("listingId")) or None) if operation in LISTING_OPERATIONS else None
    if listing is not None and not _owns_listing(ctx, listing, owner):
        raise api_error("42501", "You can only change records for your own property.")

    if operation == "create_listing":
        publish = _boolean(_text(payload.get("publish")))
        if publish and unconfirmed:
            raise _fail("Review publication before confirming.")
        result = _call(ctx, "mobile_create_property", p_property={**payload, "publish": bool(publish)})
    elif operation in ("update_property", "publish_listing"):
        if listing is None:
            raise _fail("Choose a listing")
        if operation == "publish_listing":
            if unconfirmed:
                raise _fail("Review publication before confirming.")
            result = _call(ctx, "mobile_update_property", p_listing_id=listing, p_changes={"status": "available"})
        else:
            result = _call(ctx, "mobile_update_property", p_listing_id=listing, p_changes=payload.get("changes"))
    elif operation == "application_decision":
        if unconfirmed:
            raise _fail("Owner selection and confirmation are required.")
        application = _uuid(_text(payload.get("applicationId")))
        listings = {listing["id"] for listing, _ in _owned_listings(ctx, owner)}
        if not any(a["id"] == application and a["listing_id"] in listings for a in ctx.rows("rental_applications")):
            raise api_error("42501", "Application is not yours.")
        result = _call(ctx, "mobile_review_application", p_application_id=application,
                       p_decision=_text(payload.get("decision")), p_note=_text(payload.get("note")))
    elif operation == "create_maintenance":
        if listing is None:
            raise _fail("Choose your listing")
        result = _call(ctx, "mobile_owner_create_repair", p_listing_id=listing,
                       p_issue_title=_text(payload.get("issueTitle")), p_description=_text(payload.get("description")),
                       p_category=_text(payload.get("category")), p_priority=_text(payload.get("priority")),
                       p_photos=[])
    elif operation in REPAIR_OPERATIONS:
        result = _repair_action(ctx, owner, operation, payload, unconfirmed)
    elif operation == "set_dashboard_preferences":
        cards = payload.get("hiddenCards")
        if not isinstance(cards, list) or any(card is not None and _text(card) not in DASHBOARD_CARDS for card in cards):
            raise _fail("Unknown dashboard card")
        user = _user(ctx, owner)
        metadata = user.get("metadata") if isinstance(user.get("metadata"), dict) else {}
        mobile = metadata.get("mobile") if isinstance(metadata.get("mobile"), dict) else {}
        (ctx.table("users").update({
            "metadata": {**metadata, "mobile": {**mobile, "ownerDashboardHiddenCards": cards}},
            "updated_at": now.isoformat(),
        }).eq("id", owner).execute())
        result = {"message": "Dashboard preferences updated."}
    elif operation in ("create_record", "send_proposal"):
        result = _create_record(ctx, owner, operation, listing, payload, unconfirmed, now)
    elif operation in ("update_record", "cancel_record"):
        result = _change_record(ctx, owner, operation, payload, unconfirmed, now)
    else:
        raise _fail("Unsupported assistant operation")
    _set_request(ctx, owner, request_id, result=result)
    return result


def _repair_action(ctx, owner, operation, payload, unconfirmed):
    complaint = _uuid(_text(payload.get("complaintId")))
    order = _find(ctx, "maintenance_work_orders", complaint_id=complaint) if complaint else None
    row = _find(ctx, "complaints", id=complaint) if complaint else None
    home = _find(ctx, "properties", id=row.get("property_id")) if row else None
    if not order or order.get("landlord_user_id") != owner or not home or home.get("owner_user_id") != owner:
        raise api_error("42501", "Complaint is not yours.")
    note = _text(payload.get("note"))
    if operation == "reply_complaint":
        if unconfirmed:
            raise _fail("Review the reply before sending.")
        if not _trim(note) or len(note) > 1200:
            raise _fail("A reply of 1–1200 characters is required.")
        _call(ctx, "mobile_repair_event", p_complaint_id=complaint, p_actor=owner, p_event="OWNER_REPLY",
              p_note=note, p_status="")
        _call(ctx, "mobile_assistant_notify", p_user=order.get("tenant_user_id"), p_title="Owner replied to repair",
              p_body=note, p_link="/admin/maintenance")
        return {"message": "Reply saved in repair history."}
    if operation == "resolve_complaint":
        return _call(ctx, "mobile_resolve_repair", p_complaint_id=complaint, p_note=note)
    if operation == "assign_maintenance":
        return _call(ctx, "mobile_assign_repair", p_complaint_id=complaint,
                     p_provider_id=_uuid(_text(payload.get("providerId"))))
    return _call(ctx, "mobile_schedule_repair", p_complaint_id=complaint,
                 p_appointment_at=_text(payload.get("startsAt")),
                 p_duration_minutes=_integer(_text(payload.get("durationMinutes"))), p_note=note)


def _create_record(ctx, owner, operation, listing, payload, unconfirmed, now):
    if listing is None:
        raise _fail("Choose one of your listings first.")
    kind = "proposal" if operation == "send_proposal" else _text(payload.get("kind"))
    if kind is not None and kind not in RECORD_KINDS:
        raise _fail("Unknown management record")
    title = _trim(_coalesce(_text(payload.get("title")), ""))
    data = payload["data"] if "data" in payload else {}
    recipient = _uuid(_text(payload.get("recipientId")) or None)
    if not 1 <= len(title) <= 160 or not isinstance(data, dict) or len(_jsonb_text(data)) > 30000:
        raise _fail("Invalid record details")
    # Tenancy/financial records must use a tenant approved for this listing.
    if kind in ("lease", "charge", "payment") and (recipient is None or not _approved_tenant(ctx, listing, recipient)):
        raise _fail("Choose a tenant with an approved application for this listing.")
    if recipient is not None and not _active(_user(ctx, recipient)):
        raise _fail("Recipient is not available.")
    if kind == "inspection":
        starts = _timestamptz(_text(data.get("startsAt")))
        duration = _integer(_text(data.get("durationMinutes")))
        if starts is None or starts <= now or duration is None or not 15 <= duration <= 1440:
            raise _fail("Choose a future inspection and duration from 15 to 1440 minutes.")
        if _text(data.get("mode")) not in ("in_person", "remote", "after_lease"):
            raise _fail("Choose inspection mode")
        url = _text(data.get("meetingUrl"))
        if url and not re.fullmatch(r"https://\S+", url):
            raise _fail("Remote meeting links must use HTTPS")
    elif kind == "lease":
        if not 20 <= len(_trim(_coalesce(_text(data.get("text")), ""))) <= 24000:
            raise _fail("Provide the agreement text for the draft.")
    elif kind in ("charge", "payment", "expense"):
        if unconfirmed:
            raise _fail("Review financial records before confirming.")
        if any(key in DATE_KEYS and value is not None and not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", _text(value))
               for key, value in data.items()):
            raise _fail("Use YYYY-MM-DD dates")
        amount = _numeric(_text(data.get("amount")))
        if amount is None or amount <= 0 or amount > Decimal("99999999.99") or amount != round(amount, 2):
            raise _fail("Amount must be positive AUD with at most two decimal places.")
        data = {**data, "currency": "AUD", "amount": _number(amount)}
        if kind == "charge" and not _text(data.get("dueDate")):
            raise _fail("A due date is required")
        if kind == "charge":
            _date(_text(data.get("dueDate")))
            start, end = _date(_text(data.get("periodStart")) or None), _date(_text(data.get("periodEnd")) or None)
            if start is not None and end is not None and end < start:
                raise _fail("Rent period end cannot precede its start")
        if kind in ("payment", "expense"):
            day = _date(_text(data.get("date")) or None)
            if day is None or day > _now(ctx).astimezone(SYDNEY).date():
                raise _fail("Recorded payment/expense date must not be in the future")
        if kind == "payment":
            charge = _uuid(_text(data.get("chargeId")))
            parent = _find(ctx, "owner_assistant_records", id=charge, owner_user_id=owner, kind="charge",
                           listing_id=listing, recipient_user_id=recipient) if charge else None
            if parent is None or parent["status"] == "cancelled":
                raise _fail("Choose an active rent charge for the same listing and tenant")
            paid = sum((_numeric(_text(r["payload"].get("amount"))) or Decimal(0))
                       for r in ctx.rows("owner_assistant_records")
                       if r["owner_user_id"] == owner and r["kind"] == "payment" and r["status"] != "cancelled"
                       and _text(_get(r["payload"], "chargeId")) == parent["id"])
            charged = _numeric(_text(_get(parent["payload"], "amount")))
            if charged is not None and amount > charged - paid:
                raise _fail("Payment exceeds the remaining rent charge")
            data = {**data, "source": "owner_recorded"}
    elif kind == "reminder":
        due = _timestamptz(_text(data.get("dueAt")))
        if due is None or due < now - timedelta(minutes=1):
            raise _fail("Choose a reminder time")
        if recipient is not None and recipient != owner and not _approved_tenant(ctx, listing, recipient):
            raise _fail("Reminders may only target you or this listing’s approved tenant")
        recipient = recipient or owner
    elif kind == "access_request":
        data = {**data, "integrationStatus": "not_connected"}
    if kind == "proposal":
        if unconfirmed:
            raise _fail("Review the recipient and proposal before sending.")
        peer = _user(ctx, recipient)
        if recipient is None or not peer or peer.get("primary_role") not in ("TENANT", "SERVICE_PROVIDER"):
            raise _fail("Choose a tenant or service provider")
        if not 1 <= len(_trim(_coalesce(_text(data.get("message")), ""))) <= 2000:
            raise _fail("Proposal message must be 1–2000 characters")
        conversation = _call(ctx, "mobile_start_conversation", p_peer_id=recipient,
                             p_listing_id=listing if peer.get("primary_role") == "TENANT" else None)
        _call(ctx, "mobile_send_message", p_conversation_id=_text(_get(conversation, "id")),
              p_content=_text(data.get("message")))
        data = {**data, "conversationId": _text(_get(conversation, "id"))}
    stamp = now.isoformat()
    record = _insert_record(ctx, owner, listing, recipient, kind, title, RECORD_STATUS.get(kind, "draft"), data, stamp)
    if kind == "inspection":
        due = max(now, _timestamptz(_text(data.get("startsAt"))) - timedelta(hours=1))
        _insert_record(ctx, owner, listing, owner, "reminder", "Inspection reminder", "pending",
                       {"dueAt": due.astimezone(timezone.utc).isoformat(), "message": title, "inspectionId": record["id"]},
                       stamp)
    message = RECORD_MESSAGE.get(kind) or _initcap(kind) + " saved."
    return {"message": message, "record": record}


def _insert_record(ctx, owner, listing, recipient, kind, title, status, data, stamp) -> dict:
    if kind is not None and kind not in RECORD_KINDS:
        raise api_error("23514", 'new row for relation "owner_assistant_records" violates check constraint '
                                 '"owner_assistant_records_kind_check"')
    return ctx.table("owner_assistant_records").insert({
        "owner_user_id": owner, "listing_id": listing, "recipient_user_id": recipient, "kind": kind,
        "title": title, "status": status, "payload": data, "created_at": stamp, "updated_at": stamp,
    }).execute().data[0]


def _change_record(ctx, owner, operation, payload, unconfirmed, now):
    record_id = _uuid(_text(payload.get("recordId")))
    record = _find(ctx, "owner_assistant_records", id=record_id, owner_user_id=owner) if record_id else None
    if record is None or not _owns_listing(ctx, record["listing_id"], owner):
        raise api_error("42501", "Record is not yours")
    stamp = now.isoformat()
    update = ctx.table("owner_assistant_records")
    if operation == "cancel_record":
        if record["kind"] == "proposal" or (record["kind"] == "reminder"
                                            and record["status"] in ("delivered", "skipped_preferences")):
            raise _fail("A sent message or delivered reminder cannot be recalled.")
        if record["kind"] in ("payment", "expense", "charge") and unconfirmed:
            raise _fail("Confirm the financial correction")
        if record["kind"] == "charge" and any(
                r["kind"] == "payment" and r["status"] != "cancelled" and _text(_get(r["payload"], "chargeId")) == record["id"]
                for r in ctx.rows("owner_assistant_records")):
            raise _fail("Correct linked payment records before cancelling this charge")
        update.update({"status": "cancelled", "updated_at": stamp}).eq("id", record["id"]).execute()
    else:
        data = payload["data"] if "data" in payload else {}
        if record["kind"] == "lease" and record["status"] == "draft":
            text = _text(_get(data, "text"))
            if not 20 <= len(_trim(_coalesce(text, ""))) <= 24000:
                raise _fail("Provide agreement draft text")
            update.update({"payload": {**record["payload"], "text": text}, "updated_at": stamp}).eq("id", record["id"]).execute()
        elif record["kind"] == "inspection" and record["status"] == "scheduled":
            report = _trim(_coalesce(_text(_get(data, "report")), ""))
            if not 10 <= len(report) <= 24000:
                raise _fail("An inspection report is required to complete the inspection")
            update.update({"payload": {**record["payload"], "report": report, "reportedAt": stamp},
                           "status": "completed", "updated_at": stamp}).eq("id", record["id"]).execute()
        else:
            raise _fail("This record cannot be edited in that state; use a correction or new record")
    return {"message": "Record updated.", "record": copy.deepcopy(_find(ctx, "owner_assistant_records", id=record["id"]))}


# ---------------------------------------------------------------------------
# Provider suggestions
# ---------------------------------------------------------------------------
_RATE = re.compile(r"[0-9]+(\.[0-9]+)?")


@rpc("mobile_owner_provider_search")
def mobile_owner_provider_search(ctx, params):
    _owner(ctx)
    filters = params.get("p_filters", {})
    filters = filters if isinstance(filters, dict) else {}
    category, location = _text(filters.get("category")) or "", _text(filters.get("location")) or ""
    min_rating, max_rate = _text(filters.get("minRating")) or None, _text(filters.get("maxHourlyRate")) or None
    profiles = {row["user_id"]: row for row in ctx.rows("service_provider_profiles")}
    found = []
    for user in ctx.rows("users"):
        profile = profiles.get(user["id"])
        privacy = _get(_get(_get(user.get("metadata"), "mobile"), "privacySettings"), "publicProfile")
        if (profile is None or user.get("primary_role") != "SERVICE_PROVIDER" or user.get("status") != "ACTIVE"
                or user.get("verification_status") != "APPROVED" or user.get("deleted_at") is not None
                or (_text(privacy) if privacy is not None else "true") == "false"):
            continue
        if category and not _ilike(_jsonb_text(profile.get("service_categories")) if profile.get("service_categories") is not None else None,
                                   f"%{category}%"):
            continue
        if location and not _ilike(profile.get("service_area"), f"%{location}%"):
            continue
        ratings = [Decimal(r["rating"]) for r in ctx.rows("reviews")
                   if r["reviewed_user_id"] == user["id"] and r.get("status") == "PUBLISHED"]
        average = sum(ratings) / len(ratings) if ratings else None
        rate_text = _text(_get(profile.get("metadata"), "hourlyRate"))
        rate = Decimal(rate_text) if rate_text is not None and _RATE.fullmatch(rate_text) else None
        if min_rating is not None and (average is None or average < _numeric(min_rating)):
            continue
        if max_rate is not None and (rate is None or rate > _numeric(max_rate)):
            continue
        found.append((user, profile, average, rate))
    by_price = _text(filters.get("sortBy")) == "price"
    found.sort(key=lambda item: (
        (item[3] is None, item[3] or 0) if by_price else (False, 0),
        (item[2] is None, -(item[2] or 0)),
        item[0]["id"],
    ))
    return [{
        "id": user["id"],
        "name": _coalesce(profile.get("company_name"), user.get("full_name"), "Service provider"),
        "categories": profile.get("service_categories"), "location": profile.get("service_area"),
        "pricing": profile.get("pricing_summary"),
        "rating": None if average is None else _number(average.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
        "hourlyRate": None if rate is None else _number(rate),
    } for user, profile, average, rate in found[:30]]


# ---------------------------------------------------------------------------
# Functions the action calls, where no test or area answers them
# ---------------------------------------------------------------------------
def _property_type(text) -> str:
    """public.mobile_property_type_from_app()."""
    value = _trim(_coalesce(text, ""))
    if value.upper() in ("APARTMENT", "HOUSE", "STUDIO", "TOWNHOUSE", "UNIT", "DUPLEX"):
        return value.upper()
    if value.lower() in ("flat", "condo"):
        return "APARTMENT"
    if value.lower() in ("villa", "cottage"):
        return "HOUSE"
    return "OTHER"


def _listing_status_to_app(status) -> str:
    return {"PUBLISHED": "available", "LEASED": "rented", "DRAFT": "draft"}.get(status, "unavailable")


def _mobile_create_property(ctx, params):
    """public.mobile_create_property(), with create_property_with_listing_v3() and transition_listing_status()."""
    owner = ctx.caller["id"] if ctx.caller else None
    if owner is None:
        raise api_error("42501", "Please sign in first.")
    home = params["p_property"]
    title = _trim(_text(home.get("title"))) or None
    rent = _numeric(_text(home.get("price")) or None)
    if title is None:
        raise api_error("22023", "Property title is required.")
    if rent is None or rent <= 0:
        raise api_error("22023", "Weekly rent must be more than 0.")
    suburb = _text(home.get("suburb")) if home.get("suburb") is not None else _text(home.get("city"))
    if not _trim(_coalesce(_text(home.get("address")), "")) or not _trim(_coalesce(suburb, "")):
        raise api_error("22023", "Address and suburb are required.")
    user = _user(ctx, owner)
    if not _active(user) or user.get("primary_role") != "LANDLORD":
        raise api_error("42501", "Active landlord access is required")
    parking = _numeric_integer(_text(home.get("parkingSpaces")) or None)
    parking = 0 if parking is None else parking
    lease_term = _integer(_text(home.get("leaseTermMonths")) or None)
    if not 0 <= parking <= 20:
        raise api_error("22023", "Parking spaces must be between 0 and 20")
    if lease_term is not None and not 1 <= lease_term <= 120:
        raise api_error("22023", "Lease term must be between 1 and 120 months")
    available = _date(_text(home.get("availableFrom")) or None)
    stamp = ctx.now()
    property_id, listing_id = str(uuid.uuid4()), str(uuid.uuid4())
    sqft = _numeric(_text(home.get("sqft")) or None)
    extra = {
        "amenities": home["amenities"] if home.get("amenities") is not None else [],
        "furnished": bool(_boolean(_text(home.get("furnished")))),
        "sqft": None if sqft is None else _number(sqft),
        "availability": _trim(_coalesce(_text(home.get("availability")), "")) or None,
    }
    ctx.table("properties").insert({
        "id": property_id, "owner_user_id": owner, "manager_user_id": None,
        "property_type": _property_type(_text(home.get("propertyType"))), "nickname": title,
        "address_line_1": _trim(_text(home["address"])), "address_line_2": None, "suburb": _trim(suburb),
        "state": _trim(_coalesce(_text(home.get("state")), "NSW")).upper(),
        "postcode": _trim(_coalesce(_text(home.get("postcode")), "")), "country": "AU",
        "bedrooms": _numeric_integer(_text(home.get("bedrooms")) or None),
        "bathrooms": _numeric_integer(_text(home.get("bathrooms")) or None), "parking_spaces": parking,
        "pet_friendly": bool(_boolean(_text(home.get("petsAllowed")))),
        "metadata": {"mobile": {key: value for key, value in extra.items() if value is not None}},
        "created_at": stamp, "updated_at": stamp,
    }).execute()
    ctx.table("listings").insert({
        "id": listing_id, "property_id": property_id, "created_by_user_id": owner, "title": title,
        "description": _trim(_coalesce(_text(home.get("description")), "")) or None, "weekly_rent": _number(rent),
        "bond_amount": None, "available_from": available.isoformat() if available else None,
        "lease_term_months": lease_term, "status": "DRAFT", "inspection_details": None, "published_at": None,
        "created_at": stamp, "updated_at": stamp,
    }).execute()
    publish = _boolean(_text(home.get("publish")))
    publish = True if publish is None else publish
    published = publish and user.get("verification_status") == "APPROVED"
    if published:
        ctx.table("listings").update({"status": "PUBLISHED", "published_at": stamp, "updated_at": stamp}).eq(
            "id", listing_id).execute()
    return {**_listing_json(ctx, listing_id, owner), "awaitingVerification": not published and publish}


def _listing_json(ctx, listing_id, viewer) -> dict:
    """public.mobile_listing_json()."""
    listing = _find(ctx, "listings", id=listing_id)
    home = _find(ctx, "properties", id=listing["property_id"])
    owner = _user(ctx, home["owner_user_id"]) or {}
    viewer_row = _user(ctx, viewer)
    see_address = viewer is not None and (home["owner_user_id"] == viewer
                                          or bool(viewer_row and viewer_row.get("primary_role") == "ADMIN"))
    media = sorted((m for m in ctx.rows("property_media") if m["property_id"] == home["id"]),
                   key=lambda m: (not m.get("is_cover"), m.get("sort_order") or 0, _at(m.get("created_at"))))
    urls = [m["media_url"] for m in media]
    ratings = [Decimal(r["rating"]) for r in ctx.rows("reviews")
               if r.get("property_id") == home["id"] and r.get("status") == "PUBLISHED"]
    extra = _get(home.get("metadata"), "mobile") or {}
    available = listing.get("available_from")
    today = _now(ctx).date()
    availability = _coalesce(_text(extra.get("availability")), (
        "Available immediately" if not available or date.fromisoformat(available) <= today
        else "Available from " + date.fromisoformat(available).strftime("%d %b %Y")))
    favorites = [f for f in ctx.rows("listing_favorites") if f["listing_id"] == listing_id]
    return {
        "id": listing_id, "listingId": listing_id, "propertyId": home["id"], "title": listing["title"],
        "description": listing.get("description") or "", "address": home["address_line_1"] if see_address else "",
        "city": home["suburb"], "suburb": home["suburb"], "state": home["state"], "postcode": home["postcode"],
        "country": "Australia",
        "propertyType": home["property_type"].lower() if home.get("property_type") is not None else None,
        "bedrooms": home.get("bedrooms"), "bathrooms": home.get("bathrooms"),
        "parkingSpaces": home.get("parking_spaces") or 0, "sqft": extra.get("sqft"), "squareFeet": extra.get("sqft"),
        "price": listing["weekly_rent"], "rent": listing["weekly_rent"], "currency": "AUD", "images": urls,
        "image": urls[0] if urls else None, "amenities": extra.get("amenities", []),
        "furnished": bool(extra.get("furnished", False)), "petsAllowed": home.get("pet_friendly"),
        "availability": availability, "availableFrom": available, "leaseTermMonths": listing.get("lease_term_months"),
        "status": _listing_status_to_app(listing.get("status")), "listingStatus": listing.get("status"),
        "ownerId": home["owner_user_id"], "ownerName": _trim(owner.get("full_name")) or "Property Owner",
        "rating": _number((sum(ratings) / len(ratings)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) if ratings else 0,
        "reviewCount": len(ratings), "reviews": len(ratings), "favoriteCount": len(favorites),
        "isFavorite": viewer is not None and any(f["user_id"] == viewer for f in favorites),
        "createdAt": listing.get("created_at"), "updatedAt": listing.get("updated_at"),
        "publishedAt": listing.get("published_at"),
    }


def _mobile_repair_event(ctx, params):
    """public.mobile_repair_event()."""
    ctx.table("complaint_events").insert({
        "id": str(uuid.uuid4()), "complaint_id": params["p_complaint_id"], "actor_user_id": params["p_actor"],
        "event_type": params["p_event"], "note": params["p_note"],
        "metadata": {"source": "mobile", "status": params["p_status"]}, "created_at": ctx.now(),
    }).execute()


def _mobile_assistant_notify(ctx, params):
    """public.mobile_assistant_notify(): an in-app notification, unless the person turned that kind off."""
    user = _user(ctx, params["p_user"])
    link = params["p_link"] or ""
    kind = "repairs" if "maintenance" in link else "applications" if "applications" in link else "profileUpdates"
    preferences = _get(_get(user.get("metadata") if user else None, "mobile"), "notificationPreferences")
    if not _active(user) or _text(_get(preferences, "pushEnabled")) == "false" or _text(_get(preferences, kind)) == "false":
        return False
    ctx.table("notifications").insert({
        "id": str(uuid.uuid4()), "user_id": user["id"], "title": (params["p_title"] or "")[:120],
        "body": (params["p_body"] or "")[:500], "category": "system", "link": params["p_link"], "is_read": False,
        "created_at": ctx.now(),
    }).execute()
    return True


_NESTED = {
    "mobile_create_property": _mobile_create_property,
    "mobile_repair_event": _mobile_repair_event,
    "mobile_assistant_notify": _mobile_assistant_notify,
}
