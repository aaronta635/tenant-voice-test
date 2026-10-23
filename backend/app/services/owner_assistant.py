"""The owner AI assistant (tracker R29, R30 and the owner part of R31), on the mobile app's protocol.

A question runs as the owner (user_client: the functions read auth.uid()):

1. mobile_owner_assistant_reserve(p_request) reserves its request id. The
   database allows 10 a minute and 100 a day, and gives an id it already
   answered its saved result back as it is: a retried request asks nothing
   twice.
2. mobile_owner_assistant_context() reads the owner's listings,
   applications (as anonymised applicant labels), repairs and assistant
   records. mobile_owner_provider_search() adds providers when the question
   asks for one.
3. The model answers, behind the paid_ai gate, from a copy of that context
   without tenant names, street addresses or contact details. Without a key,
   for an unverified owner, or when the model fails or answers out of
   bounds, fixed rules answer from the same context, and the reply starts
   with RULES_LABEL.
4. mobile_owner_assistant_finish(p_request, p_question, p_result) saves the
   turn, p_result being {reply, action?}.

The model may propose one action, {operation, payload}, for an operation
mobile_owner_assistant_action supports. It is checked against that
operation's schema and the owner's records (_checked_payload) before the
owner sees it, as a preview: nothing is written. Confirming runs exactly
the saved action, mobile_owner_assistant_action(action request, operation,
payload, true), then mobile_owner_assistant_receipt(chat request, action
request). The action request id is derived from the chat request's, so a
retried confirm gets the first result back instead of acting twice.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.core.config import settings
from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client
from app.services import badges, gates, provider_recommendations, rent_ledger

logger = logging.getLogger(__name__)

SYDNEY = ZoneInfo("Australia/Sydney")
# The first line of every reply the rules write, which the web and the history label by.
RULES_LABEL = "AI unavailable: answered by fixed rules from your records, not by an AI model."
# Derives a confirm's action request id from the chat request it confirms.
ACTION_NAMESPACE = uuid.UUID("6f1c2d4e-8a3b-4c5d-9e6f-7a8b9c0d1e2f")

# mobile_owner_assistant_action also takes schedule_maintenance, but its mobile_schedule_repair calls
# update_maintenance_work_order(..., 'schedule'), which only the assigned provider may run: an owner's
# confirm would always fail (42501), so the assistant never offers it.
OPERATIONS = (
    "create_listing", "update_property", "publish_listing", "application_decision", "create_maintenance",
    "reply_complaint", "resolve_complaint", "assign_maintenance", "create_record",
    "send_proposal", "update_record", "cancel_record", "set_dashboard_preferences",
)
# The functions these run need a LANDLORD (review_rental_application, assign_maintenance_work_order, the
# listing and repair functions): an AGENT's confirm would always be refused, so an agent is never offered them.
LANDLORD_ONLY = ("create_listing", "publish_listing", "application_decision", "create_maintenance",
                 "resolve_complaint", "assign_maintenance")
REPAIR_CATEGORIES = ("PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL")
DASHBOARD_CARDS = ("portfolio", "properties", "applications", "maintenance", "inspections", "accounting",
                   "reviews", "network", "subscription")
WAITING = ("SUBMITTED", "UNDER_REVIEW", "SHORTLISTED")
PUBLISHABLE = ("DRAFT", "PAUSED", "APPLICATIONS_CLOSED")
# The listing statuses review_rental_application approves an application on (else 22023).
APPROVABLE = ("PUBLISHED", "APPLICATIONS_CLOSED")

SYSTEM_PROMPT = """You are the TenantVoice owner assistant. You answer one property owner's question \
from the JSON you are given: their listings, applications, tenants, repairs, assistant records, the rent \
ledger ("rent": charges and receipts of their active tenancies), the rent recorded as assistant records \
("assistantRent") and, when present, provider suggestions. Rules:
1. Answer only from that JSON. When it does not hold the answer, say so. Never invent figures, people, \
dates or records.
2. Applications carry anonymised labels such as "Applicant 1a2b3c". You may explain how applications \
differ on the facts given. Never choose, rank or recommend an applicant: the owner decides.
3. You cannot act. Never say that anything was created, sent, scheduled, saved or changed.
4. Only when the owner asks for a change, you may propose one action from "operations", with ids taken \
from the JSON. The owner reviews it and confirms it; until then nothing happens. Propose \
application_decision only when the question itself names the applicant label and the decision.
5. Reply in plain English, at most 1200 characters, without markdown tables.
Return only JSON: {"reply": "...", "action": null} or \
{"reply": "...", "action": {"operation": "...", "payload": {...}}}."""

OPERATION_GUIDE = {
    "create_listing": "A new listing draft, never published here: title, price (weekly rent in AUD), address, "
                      "suburb; optional state, postcode, propertyType (apartment|house|studio|townhouse|unit|duplex|"
                      "other), bedrooms, bathrooms, parkingSpaces, leaseTermMonths, availableFrom (YYYY-MM-DD), "
                      "petsAllowed, furnished, amenities (list), description.",
    "update_property": "Change a listing's details: listingId, changes (create_listing's fields).",
    "publish_listing": "Publish a draft, paused or closed listing: listingId.",
    "application_decision": "Only when the owner names the applicant and the decision: applicationId, decision "
                            "(approved|rejected|shortlisted|under_review), optional note.",
    "create_maintenance": "Log a repair on a home with a current tenant: listingId, issueTitle, description (5-2000 "
                          "characters), category (" + "|".join(REPAIR_CATEGORIES) + "), priority (low|medium|high|"
                          "urgent).",
    "reply_complaint": "Reply to the tenant on a repair: complaintId, note (1-1200 characters).",
    "resolve_complaint": "Mark a repair resolved: complaintId, optional note.",
    "assign_maintenance": "Assign one of the suggested providers to a repair: complaintId, providerId.",
    "create_record": "A record on a listing: listingId, kind, title (1-160 characters), optional recipientId, data. "
                     "Per kind: lease {text (20+ characters)} and charge {amount, dueDate, optional periodStart, "
                     "periodEnd} and payment {amount, date, chargeId} for an approved tenant; inspection {startsAt, "
                     "durationMinutes, mode (in_person|remote|after_lease), optional meetingUrl (https)}; expense "
                     "{amount, date, optional category, description}; reminder {dueAt, message}; access_request "
                     "{optional message}. Amounts in AUD with at most two decimals, dates YYYY-MM-DD.",
    "send_proposal": "Message a listed tenant or provider: listingId, recipientId, title, data {message}.",
    "update_record": "Edit a record: recordId, data {text} for a lease draft or {report} to complete a scheduled "
                     "inspection.",
    "cancel_record": "Cancel a record that is not a sent message or a delivered reminder: recordId.",
    "set_dashboard_preferences": "Hide dashboard cards: hiddenCards (list of " + "|".join(DASHBOARD_CARDS) + ").",
}


# ---------------------------------------------------------------------------
# Calling the database
# ---------------------------------------------------------------------------
_STATUS_BY_CODE = {"42501": 403, "P0002": 404, "23505": 409, "22023": 422, "23514": 422}
_BAD_VALUES = {"22P02", "22007", "22008", "22003", "23502", "23503"}
# What the functions raise without a code (P0001) that is not a bad detail.
_BUSY = ("already being processed", "already in use", "already used for different details")


def _http_error(exc: Exception) -> HTTPException:
    """A function's error as the HTTP answer, with its own message for the person."""
    code = getattr(exc, "code", None)
    message = (getattr(exc, "message", None) or "").strip()
    if code in _STATUS_BY_CODE and message:
        return HTTPException(_STATUS_BY_CODE[code], message)
    if code == "P0001" and message:
        if message.startswith("AI request limit reached"):
            return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)
        if any(text in message for text in _BUSY):
            return HTTPException(status.HTTP_409_CONFLICT, message)
        return HTTPException(422, message)
    if code in _BAD_VALUES:
        return HTTPException(422, "Some of the details are not valid.")
    logger.warning("Owner assistant database call failed (%s)", code or type(exc).__name__)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The assistant is unavailable right now. Please try again.")


def _rpc(client, name: str, params: dict | None = None):
    try:
        return client.rpc(name, params or {}).execute().data
    except APIError as exc:
        raise _http_error(exc) from exc
    except (httpx.HTTPError, OSError) as exc:
        raise _http_error(exc) from exc


def _mapping(data) -> dict:
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    return {}


def _requests(owner_id: str, *request_ids: str) -> dict[str, dict]:
    """The owner's saved assistant requests by id; the owner's id scopes the service-role read."""
    rows = (get_supabase_client().table("owner_assistant_requests").select("request_id, operation, result")
            .eq("owner_user_id", owner_id).in_("request_id", list(request_ids)).execute().data) or []
    return {row["request_id"]: row for row in rows}


def action_request_id(owner_id: str, chat_request_id: str) -> str:
    """The one action request a chat answer can run: retries reuse it, so nothing runs twice."""
    return str(uuid.uuid5(ACTION_NAMESPACE, f"{owner_id}:{chat_request_id}"))


def call_model(payload: dict) -> dict:
    """One assistant answer (see SYSTEM_PROMPT), through the provider assistant's DeepSeek client."""
    return provider_recommendations._post_deepseek(SYSTEM_PROMPT, payload, max_tokens=900)


def is_agent(current: CurrentProfile) -> bool:
    """An AGENT account, which the web counts as an owner (role landlord) but the LANDLORD-only functions refuse."""
    return str((current.raw or {}).get("primary_role") or "").upper() == "AGENT"


def _ai_state(current: CurrentProfile) -> tuple[str, dict | None]:
    """ready, not_configured or verification_required, and the paid_ai refusal (R18)."""
    if not settings.deepseek_api_key.get_secret_value().strip():
        return "not_configured", None
    refused = gates.refusal(current, "paid_ai")
    return ("verification_required", refused) if refused else ("ready", None)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------
def _parse_time(value) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _when(value) -> str:
    """A moment in Sydney time: "Sat 2 Nov 2030, 9:30 am"."""
    moment = _parse_time(value)
    if moment is None:
        return "an unknown time"
    local = moment.astimezone(SYDNEY)
    hour = local.hour % 12 or 12
    return f"{local:%a} {local.day} {local:%b %Y}, {hour}:{local.minute:02d} {'am' if local.hour < 12 else 'pm'}"


def _day(value) -> str:
    """A date as "2 Nov 2030"; a timestamp counts in Sydney."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return f"{value.day} {value:%b %Y}"
    text = str(value or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        try:
            parsed = date.fromisoformat(text)
        except ValueError:
            return text
        return f"{parsed.day} {parsed:%b %Y}"
    moment = _parse_time(text)
    return _day(moment.astimezone(SYDNEY).date()) if moment else "an unknown date"


def _money(value) -> str:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return "an unknown amount"
    return f"${amount:,.0f}" if round(amount, 2).is_integer() else f"${amount:,.2f}"


def _plain(value, limit: int = 200) -> str:
    return " ".join(str(value or "").split())[:limit]


def _status_word(value) -> str:
    return str(value or "unknown").replace("_", " ").lower()


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\w$])(?:\+?61|\(?0)[\d\s().-]{7,}\d")


# A street address in free text: "12 Smith Street", "Unit 4/12 Smith St", "3A Harbour Rd".
_STREET = re.compile(
    r"\b(?:(?:unit|apartment|apt|flat|shop|suite|level)\s*)?\d+[a-z]?(?:\s*/\s*\d+[a-z]?)?\s+(?:[a-z][\w'-]*\s+){1,3}"
    r"(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|place|pl|parade|pde|crescent|cres|close|cl|way|"
    r"terrace|tce|highway|hwy|boulevard|blvd|circuit|cct|grove|square|sq)\b\.?", re.I)


def _redacted(value, limit: int, names: re.Pattern | None = None, places: re.Pattern | None = None) -> str:
    """Free text for the model, without email addresses, phone numbers, street addresses or the names in `names`.

    places: the owner's own homes' street lines, known exactly; _STREET finds the rest.
    """
    text = _PHONE.sub("[phone]", _EMAIL.sub("[email]", _plain(value, limit)))
    if places:
        text = places.sub("[address]", text)
    text = _STREET.sub("[address]", text)
    return names.sub("[tenant]", text) if names else text


def _home_addresses(context: dict) -> re.Pattern | None:
    """The street lines of the owner's homes, as whole phrases."""
    lines = {_plain(row.get("address"), 200) for row in _listings(context).values() if row.get("address")}
    lines.discard("")
    if not lines:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(line) for line in sorted(lines, key=len, reverse=True)) + r")\b", re.I)


def _tenant_names(context: dict) -> re.Pattern | None:
    """The applicants' names, and each part of three letters or more, as whole words."""
    parts = set()
    for row in context.get("recipients") or []:
        name = _plain(row.get("displayName"), 120) if isinstance(row, dict) else ""
        parts |= {name, *(part for part in re.split(r"[\s,.]+", name) if len(part) >= 3)} if name else set()
    parts.discard("")
    if not parts:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(part) for part in sorted(parts, key=len, reverse=True)) + r")\b", re.I)


def _today() -> date:
    return datetime.now(SYDNEY).date()


# ---------------------------------------------------------------------------
# The context, read
# ---------------------------------------------------------------------------
def _listings(context: dict) -> dict[str, dict]:
    return {row["id"]: row for row in context.get("properties") or [] if isinstance(row, dict) and row.get("id")}


def _records(context: dict) -> list[dict]:
    workspace = context.get("workspace") if isinstance(context.get("workspace"), dict) else {}
    return [row for row in workspace.get("records") or [] if isinstance(row, dict)]


def _labels(context: dict) -> dict[str, str]:
    """applicationId -> its anonymised label."""
    return {row["id"]: row.get("applicantLabel") or "An applicant"
            for row in context.get("applications") or [] if isinstance(row, dict) and row.get("id")}


def _recipient_label(context: dict, recipient_id, listing_id=None) -> str:
    labels = _labels(context)
    for row in context.get("recipients") or []:
        if row.get("id") == recipient_id and (listing_id is None or row.get("listingId") == listing_id):
            return labels.get(row.get("applicationId"), "a tenant")
    return "you" if recipient_id == context.get("ownerId") else "this person"


def _listing_title(context: dict, listing_id) -> str:
    listing = _listings(context).get(listing_id)
    return _plain(listing.get("title"), 120) if listing else "a listing"


def _complaint(context: dict, complaint_id) -> dict | None:
    return next((row for row in context.get("complaints") or [] if row.get("id") == complaint_id), None)


def _charges(context: dict) -> list[dict]:
    """Each rent charge recorded through the assistant, with what its payments cover."""
    records = [row for row in _records(context) if row.get("status") != "cancelled"]
    payments = [row for row in records if row.get("kind") == "payment"]
    charges = []
    for charge in (row for row in records if row.get("kind") == "charge"):
        details = charge.get("payload") or {}
        amount = float(details.get("amount") or 0)
        paid = sum(float((p.get("payload") or {}).get("amount") or 0) for p in payments
                   if (p.get("payload") or {}).get("chargeId") == charge.get("id"))
        charges.append({"record": charge, "amount": amount, "paid": paid, "outstanding": max(amount - paid, 0.0),
                        "due": details.get("dueDate")})
    return charges


def ledger_rent(owner_id: str) -> dict | None:
    """The owner's rent ledger (R27, rent_ledger.ledger), without tenant names; None when it cannot be read.

    The same charges and balances the owner's /owner/rent page shows: the
    ISSUED rent_charges of their ACTIVE agreements and the receipts counted
    against them, OVERDUE by Sydney's day.
    """
    try:
        data = rent_ledger.ledger(owner_id)
    except (HTTPException, APIError, httpx.HTTPError, OSError) as exc:
        logger.warning("Owner assistant could not read the rent ledger (%s)", type(exc).__name__)
        return None
    totals = data["totals"]
    overdue = [row for row in data["charges"] if row["payment_status"] == "OVERDUE"]
    return {
        "charges": totals["charges"], "due": totals["rent_due"], "received": totals["received"],
        "outstanding": totals["outstanding"], "overdue": totals["overdue"],
        "overdueCharges": [{"chargeId": row["id"], "listingId": row["listing_id"], "listingTitle": row["listing_title"],
                            "dueDate": row["due_date"].isoformat(), "outstanding": row["amount_outstanding"]}
                           for row in overdue[:10]],
        "source": "the rent ledger: issued charges of active tenancies and the receipts counted against them",
    }


def _rent_summary(context: dict, today: date) -> dict:
    charges = _charges(context)
    overdue = [c for c in charges if c["outstanding"] > 0 and c["due"] and str(c["due"]) < today.isoformat()]
    return {
        "charges": len(charges), "charged": round(sum(c["amount"] for c in charges), 2),
        "paid": round(sum(c["paid"] for c in charges), 2),
        "outstanding": round(sum(c["outstanding"] for c in charges), 2),
        "overdue": round(sum(c["outstanding"] for c in overdue), 2),
        "overdueCharges": [{"recordId": c["record"].get("id"), "listingId": c["record"].get("listing_id"),
                            "dueDate": c["due"], "outstanding": round(c["outstanding"], 2)} for c in overdue[:10]],
        "source": "rent charges and payments recorded through the assistant",
    }


# ---------------------------------------------------------------------------
# Provider suggestions (R31)
# ---------------------------------------------------------------------------
_PROVIDER_WORDS = re.compile(
    r"\b(provider|tradie|tradesperson|trades(?:man|men|people)?|handyman|contractor|plumber|electrician|"
    r"locksmith|technician|repairer|assign)", re.I)
# In order: a leaking tap is plumbing work.
_CATEGORY_WORDS = {
    "PLUMBING": r"\b(plumb|tap|drain|toilet|pipe|hot water|sink|shower)",
    "LEAK": r"\b(leak|water damage|damp|mou?ld)",
    "ELECTRICAL": r"\b(electric|power|light|switch|socket|wiring)",
    "HVAC": r"\b(hvac|air ?con|air-con|heating|heater|cooling)",
    "APPLIANCE": r"\b(appliance|oven|stove|fridge|dishwasher|washing machine|dryer)",
    "LOCKS_SECURITY": r"\b(lock|keys?\b|security)",
    "SAFETY": r"\b(smoke alarm|safety|gas\b|fire)",
}
_CHEAP = re.compile(r"\b(cheap|cheapest|price|prices|cost|costs|affordable|budget)\b", re.I)


def _category(question: str) -> str | None:
    return next((code for code, words in _CATEGORY_WORDS.items() if re.search(words, question, re.I)), None)


def _hidden(provider_ids: list[str]) -> set[str]:
    """The providers the web does not offer: not published (R31), or not verified on their profile (R18).

    mobile_owner_provider_search filters on the account's verification and
    the mobile profile's public flag only. A repair goes only to a provider
    whose profile verification is approved too (gates.require_verified_party,
    receive_repairs, as POST /maintenance/{id}/assign checks), so no other is
    suggested. A profile the web creates starts with metadata.is_published
    false until the provider goes live; one from the mobile app has no flag
    and is listed, as in service_providers.published_providers.
    """
    if not provider_ids:
        return set()
    try:
        rows = (get_supabase_client().table("service_provider_profiles")
                .select("user_id, metadata, verification_status").in_("user_id", provider_ids).execute().data) or []
    except (APIError, httpx.HTTPError, OSError) as exc:
        raise _http_error(exc) from exc  # the search then counts as failed: no suggestion
    offered = {row["user_id"] for row in rows if bool((row.get("metadata") or {}).get("is_published", True))
               and badges.is_verified(row.get("verification_status"))}
    return set(provider_ids) - offered


def _providers(client, question: str, context: dict) -> list[dict]:
    """Verified, public, published providers for the question, best rated first, with the facts behind each."""
    if not _PROVIDER_WORDS.search(question):
        return []
    category = _category(question)
    lowered = question.lower()
    location = next((home.get("suburb") for home in _listings(context).values()
                     if home.get("suburb") and home["suburb"].lower() in lowered), None)
    filters = {key: value for key, value in (("category", category), ("location", location)) if value}
    if _CHEAP.search(question):
        filters["sortBy"] = "price"
    rows = [row for row in _rpc(client, "mobile_owner_provider_search", {"p_filters": filters}) or []
            if isinstance(row, dict) and row.get("id")]
    hidden = _hidden([str(row["id"]) for row in rows])
    suggestions = []
    for row in [row for row in rows if str(row["id"]) not in hidden][:5]:
        categories = [str(c) for c in row.get("categories") or [] if c] if isinstance(row.get("categories"), list) else []
        reasons = [f"Rated {row['rating']} from published reviews" if row.get("rating") is not None
                   else "No published reviews yet"]
        if row.get("location"):
            reasons.append(f"Works in {_plain(row['location'], 80)}" + (f", which covers {location}" if location else ""))
        if category:
            reasons.append(f"Offers {_status_word(category)} work")
        if row.get("hourlyRate") is not None:
            reasons.append(f"{_money(row['hourlyRate'])} an hour")
        elif row.get("pricing"):
            reasons.append(f"Pricing: {_plain(row['pricing'], 80)}")
        suggestions.append({
            "id": row["id"], "name": _plain(row.get("name"), 120) or "Service provider", "categories": categories,
            "location": row.get("location"), "pricing": row.get("pricing"), "rating": row.get("rating"),
            "hourly_rate": row.get("hourlyRate"), "reasons": reasons,
        })
    return suggestions


# ---------------------------------------------------------------------------
# What the model sees
# ---------------------------------------------------------------------------
_RECORD_FACTS = ("amount", "dueDate", "date", "chargeId", "periodStart", "periodEnd", "startsAt", "durationMinutes",
                 "mode", "dueAt")


def _size(payload: dict) -> int:
    """The bytes the model client sends for payload (provider_recommendations._post_deepseek)."""
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


SHORTENED = "Some lists were cut to fit: say so when the answer may depend on what was left out."


def _fitted(payload: dict) -> dict:
    """payload within the model client's MAX_INPUT_BYTES, which refuses anything larger.

    Repair descriptions are cut first; then the oldest records, then
    applications, repairs, tenants and listings are left out, a row at a
    time, and "shortened" tells the model.
    """
    limit = provider_recommendations.MAX_INPUT_BYTES
    if _size(payload) <= limit:
        return payload
    payload = {**payload, "shortened": SHORTENED}
    for repair in payload["repairs"]:
        repair["description"] = repair["description"][:120]
    for key, oldest_first in (("records", True), ("applications", False), ("repairs", False), ("tenants", False),
                              ("listings", False)):
        rows = payload[key]
        while rows and _size(payload) > limit:
            rows.pop(0 if oldest_first else -1)
    return payload


def model_input(question: str, context: dict, providers: list[dict], today: date, ledger: dict | None = None,
                search_failed: bool = False, agent: bool = False) -> dict:
    """The question and the owner's records, without tenant names, street addresses or contact details.

    It fits the model client's input limit (_fitted). search_failed: the
    provider search failed, which is not the same as no provider matching.
    """
    labels = _labels(context)
    names = _tenant_names(context)
    places = _home_addresses(context)
    return _fitted({
        "question": _redacted(question, 2000, None, places),
        "today": today.isoformat(),
        "timezone": "Australia/Sydney",
        "listings": [{
            "listingId": row["id"], "title": _plain(row.get("title"), 120), "suburb": row.get("suburb"),
            "state": row.get("state"), "weeklyRent": row.get("rent"), "status": row.get("status"),
            "createdAt": row.get("createdAt"), "publishedAt": row.get("publishedAt"),
            "favourites": row.get("favorites"), "applications": row.get("applicationCount"),
        } for row in list(_listings(context).values())[:40]],
        "applications": [{
            "applicationId": row.get("id"), "listingId": row.get("listingId"), "applicant": row.get("applicantLabel"),
            "status": row.get("status"), "submittedAt": row.get("submittedAt"),
        } for row in (context.get("applications") or [])[:60]],
        "tenants": [{
            "recipientId": row.get("id"), "applicant": labels.get(row.get("applicationId"), "An applicant"),
            "listingId": row.get("listingId"), "approved": bool(row.get("approved")),
        } for row in (context.get("recipients") or [])[:60]],
        "repairs": [{
            "complaintId": row.get("id"), "listingId": row.get("listingId"),
            "title": _redacted(row.get("title"), 160, names, places),
            "description": _redacted(row.get("description"), 400, names, places), "category": row.get("category"),
            "severity": row.get("severity"), "status": row.get("status"), "lodgedAt": row.get("lodgedAt"),
            "appointmentAt": row.get("appointmentAt"),
        } for row in (context.get("complaints") or [])[:40]],
        "records": [{
            "recordId": row.get("id"), "listingId": row.get("listing_id"), "recipientId": row.get("recipient_user_id"),
            "kind": row.get("kind"), "title": _redacted(row.get("title"), 160, names, places), "status": row.get("status"),
            "createdAt": row.get("created_at"),
            **{key: value for key, value in (row.get("payload") or {}).items() if key in _RECORD_FACTS},
        } for row in _records(context)[-60:]],
        "rent": ledger if ledger is not None else {"unavailable": "The rent ledger could not be read just now."},
        "assistantRent": _rent_summary(context, today),
        "providers": [{
            "providerId": p["id"], "name": p["name"], "categories": p["categories"], "area": p["location"],
            "rating": p["rating"], "hourlyRate": p["hourly_rate"], "pricing": p["pricing"],
        } for p in providers],
        **({"providerSearch": "unavailable right now: say so, rather than that no provider matches"}
           if search_failed else {}),
        "operations": {name: guide for name, guide in OPERATION_GUIDE.items() if not (agent and name in LANDLORD_ONLY)},
    })


# ---------------------------------------------------------------------------
# Checking what the model proposes
# ---------------------------------------------------------------------------
class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Amount = Annotated[float, Field(gt=0, le=99_999_999.99)]


class _ListingFields(_Strict):
    title: str | None = Field(None, min_length=1, max_length=160)
    description: str | None = Field(None, max_length=4000)
    price: float | None = Field(None, gt=0, le=100_000)
    address: str | None = Field(None, min_length=1, max_length=200)
    suburb: str | None = Field(None, min_length=1, max_length=80)
    state: Literal["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] | None = None
    postcode: str | None = Field(None, pattern=r"^\d{4}$")
    propertyType: Literal["apartment", "house", "studio", "townhouse", "unit", "duplex", "other"] | None = None
    bedrooms: int | None = Field(None, ge=0, le=20)
    bathrooms: int | None = Field(None, ge=0, le=20)
    parkingSpaces: int | None = Field(None, ge=0, le=20)
    leaseTermMonths: int | None = Field(None, ge=1, le=120)
    availableFrom: date | None = None
    petsAllowed: bool | None = None
    furnished: bool | None = None
    amenities: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = Field(None, max_length=30)


class _CreateListing(_ListingFields):
    title: str = Field(min_length=1, max_length=160)
    price: float = Field(gt=0, le=100_000)
    address: str = Field(min_length=1, max_length=200)
    suburb: str = Field(min_length=1, max_length=80)
    # A listing the assistant creates is a draft; publishing is its own action.
    publish: Literal[False] | None = None


class _UpdateProperty(_Strict):
    listingId: uuid.UUID
    changes: _ListingFields

    @model_validator(mode="after")
    def _something(self):
        if not self.changes.model_dump(exclude_none=True):
            raise ValueError("No change")
        return self


class _ListingOnly(_Strict):
    listingId: uuid.UUID


class _ApplicationDecision(_Strict):
    applicationId: uuid.UUID
    decision: Literal["approved", "rejected", "shortlisted", "under_review"]
    note: str | None = Field(None, max_length=500)


class _CreateMaintenance(_Strict):
    listingId: uuid.UUID
    issueTitle: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=5, max_length=2000)
    category: Literal[REPAIR_CATEGORIES]
    priority: Literal["low", "medium", "high", "urgent"]


class _ReplyComplaint(_Strict):
    complaintId: uuid.UUID
    note: str = Field(min_length=1, max_length=1200)


class _ResolveComplaint(_Strict):
    complaintId: uuid.UUID
    note: str | None = Field(None, max_length=1200)


class _AssignMaintenance(_Strict):
    complaintId: uuid.UUID
    providerId: uuid.UUID


class _LeaseData(_Strict):
    text: str = Field(min_length=20, max_length=24000)


class _InspectionData(_Strict):
    startsAt: AwareDatetime
    durationMinutes: int = Field(ge=15, le=1440)
    mode: Literal["in_person", "remote", "after_lease"]
    meetingUrl: str | None = Field(None, pattern=r"^https://\S+$", max_length=500)


class _ChargeData(_Strict):
    amount: Amount
    dueDate: date
    periodStart: date | None = None
    periodEnd: date | None = None


class _PaymentData(_Strict):
    amount: Amount
    date: date
    chargeId: uuid.UUID


class _ExpenseData(_Strict):
    amount: Amount
    date: date
    category: str | None = Field(None, max_length=60)
    description: str | None = Field(None, max_length=500)


class _ReminderData(_Strict):
    dueAt: AwareDatetime
    message: str = Field(min_length=1, max_length=500)


class _AccessData(_Strict):
    message: str | None = Field(None, max_length=500)


RECORD_DATA = {"lease": _LeaseData, "inspection": _InspectionData, "charge": _ChargeData, "payment": _PaymentData,
               "expense": _ExpenseData, "reminder": _ReminderData, "access_request": _AccessData}


class _CreateRecord(_Strict):
    listingId: uuid.UUID
    kind: Literal["lease", "inspection", "charge", "payment", "expense", "reminder", "access_request"]
    title: str = Field(min_length=1, max_length=160)
    recipientId: uuid.UUID | None = None
    data: dict


class _ProposalData(_Strict):
    message: str = Field(min_length=1, max_length=2000)


class _SendProposal(_Strict):
    listingId: uuid.UUID
    recipientId: uuid.UUID
    title: str = Field(min_length=1, max_length=160)
    data: _ProposalData


class _RecordChange(_Strict):
    text: str | None = Field(None, min_length=20, max_length=24000)
    report: str | None = Field(None, min_length=10, max_length=24000)


class _UpdateRecord(_Strict):
    recordId: uuid.UUID
    listingId: uuid.UUID | None = None
    data: _RecordChange


class _CancelRecord(_Strict):
    recordId: uuid.UUID
    listingId: uuid.UUID | None = None


class _DashboardPreferences(_Strict):
    hiddenCards: list[Literal[DASHBOARD_CARDS]] = Field(max_length=len(DASHBOARD_CARDS))


SCHEMAS: dict[str, type[_Strict]] = {
    "create_listing": _CreateListing, "update_property": _UpdateProperty, "publish_listing": _ListingOnly,
    "application_decision": _ApplicationDecision, "create_maintenance": _CreateMaintenance,
    "reply_complaint": _ReplyComplaint, "resolve_complaint": _ResolveComplaint,
    "assign_maintenance": _AssignMaintenance,
    "create_record": _CreateRecord, "send_proposal": _SendProposal, "update_record": _UpdateRecord,
    "cancel_record": _CancelRecord, "set_dashboard_preferences": _DashboardPreferences,
}
_DECISION_WORDS = {"approved": r"\b(approve|accept)", "rejected": r"\b(reject|decline)",
                   "shortlisted": r"\bshortlist", "under_review": r"\breview"}


class OutOfBounds(ValueError):
    """What the model proposed is not something this owner can do now."""


def _tidy(value):
    """Whole-number floats as integers, so a payload says 650, not 650.0."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _tidy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_tidy(item) for item in value]
    return value


def _cents(amount: float) -> None:
    if round(amount, 2) != amount:
        raise OutOfBounds("Amounts take at most two decimal places")


def _future(moment: datetime, what: str) -> None:
    if moment <= datetime.now(timezone.utc):
        raise OutOfBounds(f"{what} is not in the future")


def _checked_payload(operation: str, payload, context: dict, providers: list[dict] | None,
                     question: str | None, agent: bool = False) -> dict:
    """payload as the action takes it, or OutOfBounds; ids must be the owner's own, in the context.

    providers None skips the provider check (a confirm, which does not search
    again); question None skips the owner-selection check (it held at preview).
    """
    if operation not in SCHEMAS:
        raise OutOfBounds("Unknown operation")
    if agent and operation in LANDLORD_ONLY:
        raise OutOfBounds("Only the property's landlord can do that")
    if not isinstance(payload, dict):
        raise OutOfBounds("The payload is not an object")
    try:
        checked = SCHEMAS[operation].model_validate(payload)
    except ValidationError as exc:
        raise OutOfBounds("The payload does not match the operation") from exc
    normal = _tidy(checked.model_dump(mode="json", exclude_none=True))
    normal.pop("publish", None)
    listings = _listings(context)
    listing_id = normal.get("listingId")
    if listing_id is not None and listing_id not in listings:
        raise OutOfBounds("Not one of the owner's listings")
    recipients = [row for row in context.get("recipients") or [] if isinstance(row, dict)]
    records = {row.get("id"): row for row in _records(context)}

    if operation == "publish_listing" and listings[listing_id].get("status") not in PUBLISHABLE:
        raise OutOfBounds("The listing cannot be published from its status")
    if operation == "application_decision":
        application = next((row for row in context.get("applications") or [] if row.get("id") == normal["applicationId"]), None)
        if application is None:
            raise OutOfBounds("Not one of the owner's applications")
        if application.get("status") not in WAITING:
            raise OutOfBounds("The application is already decided")
        if normal["decision"].upper() == application.get("status"):
            raise OutOfBounds("The application already has that status")
        if normal["decision"] == "approved" and (
                listings.get(application.get("listingId")) or {}).get("status") not in APPROVABLE:
            raise OutOfBounds("The listing is not open for an approval")
        label = str(application.get("applicantLabel") or "")
        if question is not None and (not label or label.split()[-1].lower() not in question.lower()
                                     or not re.search(_DECISION_WORDS[normal["decision"]], question, re.I)):
            raise OutOfBounds("The owner did not name this applicant and decision")
    if operation == "create_maintenance" and not any(
            row.get("listingId") == listing_id and row.get("approved") for row in recipients):
        raise OutOfBounds("Repairs are logged for a home with a current tenant")
    if operation in ("reply_complaint", "resolve_complaint", "assign_maintenance"):
        complaint = _complaint(context, normal["complaintId"])
        if complaint is None:
            raise OutOfBounds("Not one of the owner's repairs")
        if operation != "reply_complaint" and complaint.get("status") == "RESOLVED":
            raise OutOfBounds("The repair is resolved")
        if operation == "assign_maintenance":
            # assign_maintenance_work_order: an OPEN or ASSIGNED order, a provider qualified for its category.
            if complaint.get("status") not in ("OPEN", "ASSIGNED"):
                raise OutOfBounds("The repair cannot be assigned from its status")
            if providers is not None:
                provider = next((p for p in providers if p["id"] == normal["providerId"]), None)
                if provider is None:
                    raise OutOfBounds("Not one of the suggested providers")
                if str(complaint.get("category") or "").upper() not in {str(c).upper() for c in provider["categories"]}:
                    raise OutOfBounds("The provider does not offer this repair's category")
    if operation == "create_record":
        normal["data"] = _checked_record(normal, context, recipients, records)
    if operation == "send_proposal":
        tenants = {row.get("id") for row in recipients if row.get("listingId") == listing_id}
        suggested = {p["id"] for p in providers} if providers is not None else None
        if normal["recipientId"] not in tenants and suggested is not None and normal["recipientId"] not in suggested:
            raise OutOfBounds("Not a tenant of this listing or a suggested provider")
    if operation in ("update_record", "cancel_record"):
        record = records.get(normal["recordId"])
        if record is None or record.get("listing_id") not in listings:
            raise OutOfBounds("Not one of the owner's records")
        if listing_id is not None and record.get("listing_id") != listing_id:
            raise OutOfBounds("The record is on another listing")
        _checked_change(operation, normal, record, records)
    return normal


def _checked_record(normal: dict, context: dict, recipients: list[dict], records: dict) -> dict:
    kind, listing_id, recipient = normal["kind"], normal["listingId"], normal.get("recipientId")
    try:
        data = RECORD_DATA[kind].model_validate(normal["data"])
    except ValidationError as exc:
        raise OutOfBounds("The record details do not match its kind") from exc
    approved = {row.get("id") for row in recipients if row.get("listingId") == listing_id and row.get("approved")}
    known = {row.get("id") for row in recipients if row.get("listingId") == listing_id}
    if kind in ("lease", "charge", "payment") and recipient not in approved:
        raise OutOfBounds("This record needs a tenant approved for the listing")
    if kind == "reminder" and recipient is not None and recipient != context.get("ownerId") and recipient not in approved:
        raise OutOfBounds("A reminder goes to the owner or the listing's approved tenant")
    if kind in ("inspection", "expense", "access_request") and recipient is not None and recipient not in known:
        raise OutOfBounds("Not a tenant or applicant of this listing")
    today = _today()
    if kind == "inspection":
        _future(data.startsAt, "The inspection")
    if kind == "reminder":
        _future(data.dueAt, "The reminder")
    if kind in ("charge", "payment", "expense"):
        _cents(data.amount)
    if kind == "charge" and data.periodStart and data.periodEnd and data.periodEnd < data.periodStart:
        raise OutOfBounds("The rent period ends before it starts")
    if kind in ("payment", "expense") and data.date > today:
        raise OutOfBounds("The date is in the future")
    if kind == "payment":
        charge = next((c for c in _charges(context) if c["record"].get("id") == str(data.chargeId)), None)
        if (charge is None or charge["record"].get("listing_id") != listing_id
                or charge["record"].get("recipient_user_id") != recipient):
            raise OutOfBounds("Not an active charge for this listing and tenant")
        if data.amount > round(charge["outstanding"], 2):
            raise OutOfBounds("The payment is more than the charge has outstanding")
    return _tidy(data.model_dump(mode="json", exclude_none=True))


def _checked_change(operation: str, normal: dict, record: dict, records: dict) -> None:
    kind, state = record.get("kind"), record.get("status")
    if state == "cancelled":
        raise OutOfBounds("The record is cancelled")
    if operation == "cancel_record":
        if kind == "proposal" or (kind == "reminder" and state in ("delivered", "skipped_preferences")):
            raise OutOfBounds("A sent message or delivered reminder cannot be recalled")
        if kind == "charge" and any(r.get("kind") == "payment" and r.get("status") != "cancelled"
                                    and (r.get("payload") or {}).get("chargeId") == record.get("id")
                                    for r in records.values()):
            raise OutOfBounds("The charge has payments recorded against it")
        return
    data = normal["data"]
    if kind == "lease" and state == "draft" and set(data) == {"text"}:
        return
    if kind == "inspection" and state == "scheduled" and set(data) == {"report"}:
        return
    raise OutOfBounds("The record cannot be edited that way")


_DONE_WORDS = (r"(?:created|sent|scheduled|saved|published|approved|rejected|declined|updated|cancell?ed|assigned|"
               r"recorded|booked|resolved|changed|deleted|added|logged|notified|messaged|emailed|texted|set)")
# "I have created ...", and the passive and short forms: "... has been set", "... is now published", "Done: ...".
_CLAIMS = re.compile(
    r"\b(?:I(?:'ve| have| just)?|we(?:'ve| have)?)\s+(?:now\s+|already\s+)?" + _DONE_WORDS + r"\b"
    r"|\b(?:has|have|had)\s+(?:now\s+|already\s+|just\s+)?been\s+" + _DONE_WORDS + r"\b"
    r"|\b(?:is|are)\s+now\s+" + _DONE_WORDS + r"\b"
    r"|\b(?:was|were)\s+just\s+" + _DONE_WORDS + r"\b"
    r"|^\s*(?:all\s+)?done\b", re.I)
_CHOOSES = re.compile(
    r"\b(?:recommend|best (?:choice|candidate|applicant|fit|option)|strongest|top choice|go with|"
    r"should (?:approve|accept|choose|pick|select))\b", re.I)
_APPLICANT = re.compile(r"\bApplicant [0-9a-f]{6}\b", re.I)


def basis(operation: str, payload: dict, context: dict) -> dict:
    """What the preview showed of the rows the action changes, which a confirm needs unchanged (R30's version check).

    A listing by its updatedAt and status; an application by its status and
    its listing's, and for an approval the applications it would reject; a
    repair by its status and visit; a record by its updated_at and status; a
    payment by what its charge still has outstanding. {} when the action
    changes no row the preview described.
    """
    listings = _listings(context)
    if operation in ("update_property", "publish_listing"):
        listing = listings.get(payload.get("listingId")) or {}
        return {"listing": [listing.get("updatedAt"), listing.get("status")]}
    if operation == "application_decision":
        applications = [row for row in context.get("applications") or [] if isinstance(row, dict)]
        application = next((row for row in applications if row.get("id") == payload.get("applicationId")), {})
        home = listings.get(application.get("listingId")) or {}
        waiting = sorted(row.get("id") for row in applications if row.get("listingId") == application.get("listingId")
                         and row.get("id") != application.get("id") and row.get("status") in WAITING)
        return {"application": [application.get("status"), home.get("status"), home.get("updatedAt"), waiting]}
    if operation in ("reply_complaint", "resolve_complaint", "assign_maintenance"):
        complaint = _complaint(context, payload.get("complaintId")) or {}
        return {"repair": [complaint.get("status"), complaint.get("appointmentAt")]}
    if operation in ("update_record", "cancel_record"):
        record = next((row for row in _records(context) if row.get("id") == payload.get("recordId")), {})
        return {"record": [record.get("updated_at"), record.get("status")]}
    if operation == "create_record" and payload.get("kind") == "payment":
        charge_id = (payload.get("data") or {}).get("chargeId")
        charge = next((c for c in _charges(context) if c["record"].get("id") == charge_id), None)
        return {"charge": [round(charge["outstanding"], 2) if charge else None]}
    return {}


class _Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: str
    payload: dict


class _Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reply: str = Field(min_length=1, max_length=2000)
    action: _Proposal | None = None


def checked_answer(raw, question: str, context: dict, providers: list[dict], agent: bool = False) -> dict:
    """The model's answer as the turn's result, {reply, action?}; anything out of bounds is OutOfBounds."""
    try:
        answer = _Answer.model_validate(raw)
    except ValidationError as exc:
        raise OutOfBounds("The answer is not in the expected shape") from exc
    reply = answer.reply.strip()
    if not reply:
        raise OutOfBounds("Empty reply")
    if _CLAIMS.search(reply):
        raise OutOfBounds("The reply claims an action happened")
    if any(_APPLICANT.search(sentence) and _CHOOSES.search(sentence) for sentence in re.split(r"[.!?\n]+", reply)):
        raise OutOfBounds("The reply chooses an applicant")
    result = {"reply": reply}
    if answer.action is not None:
        operation = answer.action.operation
        payload = _checked_payload(operation, answer.action.payload, context, providers, question, agent)
        seen = basis(operation, payload, context)
        result["action"] = {"operation": operation, "payload": payload, **({"basis": seen} if seen else {})}
    return result


# ---------------------------------------------------------------------------
# The preview: exactly what the action will change
# ---------------------------------------------------------------------------
_FIELD_LABELS = {
    "title": "Title", "price": "Weekly rent", "address": "Street address", "suburb": "Suburb", "state": "State",
    "postcode": "Postcode", "propertyType": "Property type", "bedrooms": "Bedrooms", "bathrooms": "Bathrooms",
    "parkingSpaces": "Parking spaces", "leaseTermMonths": "Lease term", "availableFrom": "Available from",
    "petsAllowed": "Pets allowed", "furnished": "Furnished", "amenities": "Amenities", "description": "Description",
}
_CURRENT = {"title": "title", "price": "rent", "address": "address", "suburb": "suburb", "state": "state",
            "postcode": "postcode"}
_KIND_TITLES = {"lease": "Save a lease agreement draft", "inspection": "Schedule an inspection",
                "charge": "Record a rent charge", "payment": "Record a rent payment", "expense": "Record an expense",
                "reminder": "Create a reminder", "access_request": "Note a door access request"}
_KIND_DEMO = {
    "reminder": "in-app reminder only; no email or SMS is sent",
    "charge": "recorded by you; TenantVoice does not collect rent",
    "payment": "recorded by you; TenantVoice does not collect rent",
    "access_request": "door access is not connected; no door is unlocked",
}


def _field_value(key: str, value) -> str:
    if key == "price":
        return f"{_money(value)} a week"
    if key == "leaseTermMonths":
        return f"{value} months"
    if key == "availableFrom":
        return _day(value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or "None"
    return _plain(value, 400)


def _change(label: str, value) -> dict:
    return {"label": label, "value": value if isinstance(value, str) else str(value)}


def preview(operation: str, payload: dict, context: dict, providers: list[dict] | None = None) -> dict:
    """A title, every value the action writes, notes and, for a demo part, its label."""
    listing_id = payload.get("listingId")
    place = _listing_title(context, listing_id) if listing_id else None
    changes, notes, demo = [], [], None
    if operation == "create_listing":
        title = "Create a listing draft"
        changes = [_change(_FIELD_LABELS[key], _field_value(key, value)) for key, value in payload.items()]
        notes.append("It is saved as a draft: nobody else sees it until you publish it.")
    elif operation == "update_property":
        title = f"Update {place}"
        current = _listings(context).get(listing_id) or {}
        for key, value in payload["changes"].items():
            text = _field_value(key, value)
            before = current.get(_CURRENT.get(key, "")) if key in _CURRENT else None
            if before not in (None, ""):
                text += f" (now {_field_value(key, before)})"
            changes.append(_change(_FIELD_LABELS[key], text))
    elif operation == "publish_listing":
        title = f"Publish {place}"
        changes = [_change("Status", f"Published (now {_status_word((_listings(context).get(listing_id) or {}).get('status'))})")]
        notes.append("Tenants can see it and apply once it is published.")
    elif operation == "application_decision":
        labels = _labels(context)
        application = next((row for row in context.get("applications") or [] if row.get("id") == payload["applicationId"]), {})
        title = f"Mark {labels.get(payload['applicationId'], 'the application')} as {_status_word(payload['decision'])}"
        changes = [_change("Application", f"{labels.get(payload['applicationId'], 'An applicant')} for "
                                          f"{_listing_title(context, application.get('listingId'))}"),
                   _change("Decision", _status_word(payload["decision"]).capitalize())]
        if payload.get("note"):
            changes.append(_change("Note", _plain(payload["note"], 500)))
        if payload["decision"] == "approved":
            # review_rental_application leases the home and rejects every other waiting application on it.
            home = _listings(context).get(application.get("listingId")) or {}
            others = [row for row in context.get("applications") or [] if row.get("listingId") == application.get("listingId")
                      and row.get("id") != payload["applicationId"] and row.get("status") in WAITING]
            changes.append(_change("Listing status", f"Leased (now {_status_word(home.get('status'))})"))
            if others:
                changes.append(_change("Other applications", (
                    f"{len(others)} waiting application{'s' if len(others) != 1 else ''} on this listing: rejected, "
                    f"and {'each applicant' if len(others) != 1 else 'its applicant'} told the home is no longer available")))
            notes.append("Approving leases the home: it stops taking applications.")
        notes.append("This is your decision: the assistant does not choose applicants.")
    elif operation == "create_maintenance":
        title = f"Log a repair at {place}"
        changes = [_change("Issue", _plain(payload["issueTitle"], 120)), _change("Description", _plain(payload["description"], 400)),
                   _change("Category", _status_word(payload["category"]).capitalize()),
                   _change("Priority", payload["priority"].capitalize())]
        notes.append("Your tenant is told about it in the app.")
    elif operation in ("reply_complaint", "resolve_complaint", "assign_maintenance"):
        complaint = _complaint(context, payload["complaintId"]) or {}
        issue = f"'{_plain(complaint.get('title'), 120)}' at {_listing_title(context, complaint.get('listingId'))}"
        if operation == "reply_complaint":
            title = "Reply on a repair"
            changes = [_change("Repair", issue), _change("Reply", _plain(payload["note"], 1200))]
            notes.append("Your tenant is told about the reply in the app.")
        elif operation == "resolve_complaint":
            title = "Mark a repair resolved"
            changes = [_change("Repair", issue), _change("Status", f"Resolved (now {_status_word(complaint.get('status'))})")]
            if payload.get("note"):
                changes.append(_change("Note", _plain(payload["note"], 1200)))
        else:
            provider = next((p for p in providers or [] if p["id"] == payload["providerId"]), None)
            title = "Assign a provider to a repair"
            changes = [_change("Repair", issue), _change("Provider", provider["name"] if provider else "The provider you chose")]
            if provider:
                changes.append(_change("Why suggested", "; ".join(provider["reasons"])))
    elif operation == "create_record":
        kind, data = payload["kind"], payload["data"]
        title = f"{_KIND_TITLES[kind]} for {place}"
        demo = _KIND_DEMO.get(kind)
        changes = [_change("Title", _plain(payload["title"], 160))]
        if payload.get("recipientId") or kind == "reminder":
            changes.append(_change("For", _recipient_label(context, payload.get("recipientId") or context.get("ownerId"), listing_id)))
        changes += _record_changes(kind, data, context)
        notes += {"lease": ["A draft only: it is not signed or legally verified."],
                  "inspection": ["A reminder for you is added an hour before it starts.",
                                 "It stays in the assistant's records: the inspections pages do not show it."],
                  "charge": ["It stays in the assistant's records: the rent ledger does not show it."],
                  "payment": ["It stays in the assistant's records: the rent ledger does not show it."],
                  "access_request": ["It is noted only."]}.get(kind, [])
    elif operation == "send_proposal":
        provider = next((p for p in providers or [] if p["id"] == payload["recipientId"]), None)
        title = "Send a message"
        changes = [_change("To", provider["name"] if provider else _recipient_label(context, payload["recipientId"], listing_id)),
                   _change("About", place), _change("Title", _plain(payload["title"], 160)),
                   _change("Message", _plain(payload["data"]["message"], 2000))]
        notes.append("It is sent in the app's messages and cannot be recalled.")
    elif operation in ("update_record", "cancel_record"):
        record = next((r for r in _records(context) if r.get("id") == payload["recordId"]), {})
        name = f"{_status_word(record.get('kind'))} '{_plain(record.get('title'), 120)}'"
        if operation == "cancel_record":
            title = f"Cancel the {name}"
            changes = [_change("Status", f"Cancelled (now {_status_word(record.get('status'))})")]
        else:
            title = f"Update the {name}"
            data = payload["data"]
            changes = ([_change("Agreement text", _plain(data["text"], 600))] if "text" in data
                       else [_change("Inspection report", _plain(data["report"], 600)), _change("Status", "Completed")])
    else:
        title = "Change your dashboard"
        hidden = payload["hiddenCards"]
        changes = [_change("Hidden cards", ", ".join(hidden) if hidden else "None: every card shows")]
    return {"title": title, "changes": changes, "notes": notes, "demo": demo}


def _record_changes(kind: str, data: dict, context: dict) -> list[dict]:
    if kind == "lease":
        return [_change("Agreement text", _plain(data["text"], 600))]
    if kind == "inspection":
        rows = [_change("Starts", f"{_when(data['startsAt'])} (Sydney time)"),
                _change("Length", f"{data['durationMinutes']} minutes"), _change("Mode", _status_word(data["mode"]).capitalize())]
        return rows + ([_change("Meeting link", data["meetingUrl"])] if data.get("meetingUrl") else [])
    if kind == "charge":
        rows = [_change("Amount", _money(data["amount"])), _change("Due", _day(data["dueDate"]))]
        if data.get("periodStart") or data.get("periodEnd"):
            rows.append(_change("Rent period", f"{_day(data.get('periodStart')) if data.get('periodStart') else '…'} to "
                                               f"{_day(data.get('periodEnd')) if data.get('periodEnd') else '…'}"))
        return rows
    if kind == "payment":
        charge = next((c for c in _charges(context) if c["record"].get("id") == data["chargeId"]), None)
        rows = [_change("Amount", _money(data["amount"])), _change("Paid on", _day(data["date"]))]
        if charge:
            rows.append(_change("Against", f"'{_plain(charge['record'].get('title'), 120)}', "
                                           f"{_money(charge['outstanding'])} outstanding"))
        return rows
    if kind == "expense":
        rows = [_change("Amount", _money(data["amount"])), _change("Date", _day(data["date"]))]
        rows += [_change(label, _plain(data[key], 500)) for key, label in (("category", "Category"), ("description", "Description")) if data.get(key)]
        return rows
    if kind == "reminder":
        return [_change("Due", f"{_when(data['dueAt'])} (Sydney time)"), _change("Message", _plain(data["message"], 500))]
    return [_change("Message", _plain(data["message"], 500))] if data.get("message") else []


# ---------------------------------------------------------------------------
# The rules, when the model does not answer
# ---------------------------------------------------------------------------
_TOPICS = {
    "rent": r"\b(rent|rents|paid|pay|payment|payments|overdue|arrears|owe|owes|owing|late)\b",
    "repairs": r"\b(repair|repairs|complaint|complaints|maintenance|issue|issues|fix|broken|leak|leaks|problem)",
    "applications": r"\b(application|applications|applicant|applicants|apply|applied|compare)\b",
    "performance": r"\b(favou?rite|favou?rites|saved|views?|performance|perform|performing|popular|interest|trend|trends)\b",
    "counts": r"\b(how many|count|number of|propert(?:y|ies)|listings?|portfolio|summary|overview)\b",
}


def _section_counts(context: dict) -> str:
    listings = list(_listings(context).values())
    if not listings:
        return "You have no listings yet."
    counts: dict[str, int] = {}
    for row in listings:
        counts[_status_word(row.get("status"))] = counts.get(_status_word(row.get("status")), 0) + 1
    parts = ", ".join(f"{count} {word}" for word, count in sorted(counts.items()))
    return f"You have {len(listings)} listing{'s' if len(listings) != 1 else ''}: {parts}."


def _section_ledger(ledger: dict | None) -> str:
    if ledger is None:
        return "The rent ledger could not be read just now."
    if not ledger["charges"]:
        return "The rent ledger has no charges for your active tenancies yet."
    text = (f"Rent ledger (your active tenancies): {ledger['charges']} charge{'s' if ledger['charges'] != 1 else ''}, "
            f"{_money(ledger['due'])} due, {_money(ledger['received'])} received and "
            f"{_money(ledger['outstanding'])} outstanding")
    if ledger["overdueCharges"]:
        text += ". Overdue: " + "; ".join(f"{_plain(row['listingTitle'], 80)}, {_money(row['outstanding'])} due "
                                          f"{_day(row['dueDate'])}" for row in ledger["overdueCharges"][:5])
    return text + "."


def _section_rent(context: dict, today: date, ledger: dict | None = None) -> str:
    charges = _charges(context)
    if not charges:
        return _section_ledger(ledger)
    rent = _rent_summary(context, today)
    text = (f"Rent recorded in the assistant: {rent['charges']} charge{'s' if rent['charges'] != 1 else ''}, "
            f"{_money(rent['charged'])} charged, {_money(rent['paid'])} paid and {_money(rent['outstanding'])} outstanding")
    late = [c for c in charges if c["outstanding"] > 0 and c["due"] and str(c["due"]) < today.isoformat()]
    if late:
        listed = "; ".join(f"'{_plain(c['record'].get('title'), 80)}' at {_listing_title(context, c['record'].get('listing_id'))}, "
                           f"{_money(c['outstanding'])} due {_day(c['due'])}" for c in late[:5])
        text += f". Overdue: {listed}"
    return _section_ledger(ledger) + "\n\n" + text + "."


def _section_repairs(context: dict) -> str:
    complaints = [row for row in context.get("complaints") or [] if isinstance(row, dict)]
    if not complaints:
        return "No repairs or complaints are recorded for your homes."
    open_ = [row for row in complaints if row.get("status") != "RESOLVED"]
    resolved = len(complaints) - len(open_)
    if not open_:
        return f"No repair is open; {resolved} resolved."
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    open_.sort(key=lambda row: (order.get(row.get("severity"), 4), str(row.get("lodgedAt") or "")))
    listed = "; ".join(
        f"'{_plain(row.get('title'), 80)}' at {_listing_title(context, row.get('listingId'))} "
        f"({_status_word(row.get('status'))}, {_status_word(row.get('severity') or 'no')} priority, lodged {_day(row.get('lodgedAt'))})"
        for row in open_[:5])
    return (f"{len(open_)} repair{'s are' if len(open_) != 1 else ' is'} open: {listed}"
            + (f"; and {resolved} resolved." if resolved else "."))


def _section_applications(context: dict) -> str:
    applications = [row for row in context.get("applications") or [] if isinstance(row, dict)]
    if not applications:
        return "You have no applications yet."
    counts: dict[str, int] = {}
    for row in applications:
        counts[_status_word(row.get("status"))] = counts.get(_status_word(row.get("status")), 0) + 1
    waiting = sorted((row for row in applications if row.get("status") in WAITING),
                     key=lambda row: str(row.get("submittedAt") or ""))
    text = (f"{len(applications)} application{'s' if len(applications) != 1 else ''}: "
            + ", ".join(f"{count} {word}" for word, count in sorted(counts.items())) + ".")
    if waiting:
        per_listing: dict[str, int] = {}
        for row in waiting:
            per_listing[_listing_title(context, row.get("listingId"))] = per_listing.get(_listing_title(context, row.get("listingId")), 0) + 1
        text += (f" Waiting for your decision: " + ", ".join(f"{count} on {title}" for title, count in per_listing.items())
                 + f". The longest waiting is {waiting[0].get('applicantLabel')}, submitted {_day(waiting[0].get('submittedAt'))}.")
    return text + " The assistant sets out the facts but never chooses an applicant: the decision is yours."


def _section_performance(context: dict) -> str:
    listings = sorted(_listings(context).values(),
                      key=lambda row: -((row.get("favorites") or 0) + (row.get("applicationCount") or 0)))
    if not listings:
        return "You have no listings to compare yet."
    return "Listing interest: " + "; ".join(
        f"{_plain(row.get('title'), 80)} ({_status_word(row.get('status'))}): {row.get('favorites') or 0} "
        f"favourite{'s' if (row.get('favorites') or 0) != 1 else ''}, {row.get('applicationCount') or 0} "
        f"application{'s' if (row.get('applicationCount') or 0) != 1 else ''}" for row in listings[:5]) + "."


def _section_providers(providers: list[dict], search_failed: bool = False) -> str:
    if search_failed:
        return "The provider search is unavailable right now, so no provider can be suggested. Please ask again later."
    if not providers:
        return "No verified provider with a public profile matches that yet."
    return "Providers who match (verified, public profiles, best rated first): " + "; ".join(
        f"{index}. {p['name']}: {'; '.join(p['reasons'])}" for index, p in enumerate(providers, 1)) + "."


def rules_reply(question: str, context: dict, providers: list[dict], asked_providers: bool, today: date,
                ledger: dict | None = None, search_failed: bool = False) -> str:
    """An answer from fixed rules over the same context and rent ledger, starting with RULES_LABEL."""
    topics = [name for name, words in _TOPICS.items() if re.search(words, question, re.I)]
    sections = []
    for topic in topics or ["counts", "repairs", "applications", "rent"]:
        sections.append({"rent": lambda: _section_rent(context, today, ledger), "repairs": lambda: _section_repairs(context),
                         "applications": lambda: _section_applications(context),
                         "performance": lambda: _section_performance(context),
                         "counts": lambda: _section_counts(context)}[topic]())
    if asked_providers:
        sections.append(_section_providers(providers, search_failed))
    return RULES_LABEL + "\n\n" + "\n\n".join(sections)


# ---------------------------------------------------------------------------
# The routes' work
# ---------------------------------------------------------------------------
def workspace(current: CurrentProfile) -> dict:
    client = user_client(current.access_token)
    context = _mapping(_rpc(client, "mobile_owner_assistant_context"))
    history = _rpc(client, "mobile_owner_assistant_history")
    ai_status, refused = _ai_state(current)
    return {
        "context": context, "history": history if isinstance(history, list) else [],
        "workspace": context.get("workspace"), "ai_status": ai_status, "verification": refused, "ai_labelled": True,
    }


def _answer(request_id: str, question: str, result: dict, context: dict, providers: list[dict],
            ai_status: str, refused: dict | None, cached: bool) -> dict:
    reply = str(result.get("reply") or "")
    action = result.get("action") if isinstance(result.get("action"), dict) else None
    shown = None
    if action and action.get("operation") in SCHEMAS and isinstance(action.get("payload"), dict):
        try:
            shown = {"operation": action["operation"], "payload": action["payload"],
                     "preview": preview(action["operation"], action["payload"], context, providers)}
        except (KeyError, TypeError, ValueError):
            logger.warning("Owner assistant could not preview a saved %s action", action.get("operation"))
    source = "rules" if reply.startswith(RULES_LABEL) else "ai"
    return {
        "request_id": request_id, "question": question, "reply": reply, "source": source,
        "ai_status": "applied" if source == "ai" else ai_status, "ai_labelled": True, "cached": cached,
        "action": shown, "providers": providers, "verification": refused,
    }


def _saved_question(owner_id: str, request_id: str) -> str | None:
    """The question a chat request answered (owner_assistant_turns), scoped to the owner by the service-role read."""
    try:
        rows = (get_supabase_client().table("owner_assistant_turns").select("question").eq("owner_user_id", owner_id)
                .eq("chat_request_id", request_id).limit(1).execute().data) or []
    except (APIError, httpx.HTTPError, OSError):
        return None
    return rows[0].get("question") if rows else None


def ask(current: CurrentProfile, question: str, request_id: str | None = None) -> dict:
    question = (question or "").strip()
    if not question:
        raise HTTPException(422, "Question is required")
    request_id = request_id or str(uuid.uuid4())
    client = user_client(current.access_token)
    reserved = _mapping(_rpc(client, "mobile_owner_assistant_reserve", {"p_request": request_id}))
    ai_status, refused = _ai_state(current)
    if reserved.get("cached"):
        # Answered before: its saved result, as it is, with the question it answered.
        result = reserved.get("result") if isinstance(reserved.get("result"), dict) else {}
        asked = _saved_question(current.id, request_id) or question
        context, providers = {}, []
        if result.get("action"):
            context = _mapping(_rpc(client, "mobile_owner_assistant_context"))
            try:
                # The same search again, so the preview still names a suggested provider.
                providers = _providers(client, asked, context)
            except HTTPException:
                providers = []
        return _answer(request_id, asked, result, context, providers,
                       "unavailable" if ai_status == "ready" else ai_status, refused, cached=True)

    context = _mapping(_rpc(client, "mobile_owner_assistant_context"))
    search_failed = False
    try:
        providers = _providers(client, question, context)
    except HTTPException:
        logger.warning("Owner assistant provider search failed; answering without providers")
        # [] still checks a proposed provider (None would skip it): only the wording says the search failed.
        providers, search_failed = [], True
    ledger = ledger_rent(current.id)
    agent = is_agent(current)
    result = None
    if ai_status == "ready":
        try:
            result = checked_answer(call_model(model_input(question, context, providers, _today(), ledger, search_failed,
                                                           agent)),
                                    question, context, providers, agent)
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, AttributeError, json.JSONDecodeError) as exc:
            # The reason, never the question, the context or the model's text.
            logger.warning("Owner assistant model answer unusable (%s); answering by rules", type(exc).__name__)
            ai_status = "unavailable"
    if result is None:
        result = {"reply": rules_reply(question, context, providers, bool(_PROVIDER_WORDS.search(question)), _today(),
                                       ledger, search_failed)}
    _rpc(client, "mobile_owner_assistant_finish", {"p_request": request_id, "p_question": question, "p_result": result})
    return _answer(request_id, question, result, context, providers, ai_status, refused, cached=False)


def _saved_fields(result: dict) -> tuple[dict | None, list[dict]]:
    """The record the action returned, and the facts the page shows about it."""
    record = result.get("record") if isinstance(result.get("record"), dict) else None
    if record is None and result.get("id"):
        record = result
    if record is None:
        return None, []
    fields = []
    for key, label in (("kind", "Kind"), ("title", "Title"), ("status", "Status"), ("listingStatus", "Listing status")):
        if record.get(key):
            fields.append(_change(label, _status_word(record[key]).capitalize() if key != "title" else _plain(record[key], 160)))
    stamp = record.get("created_at") or record.get("createdAt")
    if stamp:
        fields.append(_change("Saved", f"{_when(stamp)} (Sydney time)"))
    if record.get("id"):
        fields.append(_change("Record id", str(record["id"])))
    return record, fields


def confirm(current: CurrentProfile, request_id: str) -> dict:
    """Run the action a chat answer proposed, exactly as saved, then attach its receipt to the turn."""
    gates.require_verified(current, "paid_ai")
    action_id = action_request_id(current.id, request_id)
    saved = _requests(current.id, request_id, action_id)
    chat = saved.get(request_id)
    if chat is None or chat.get("operation") != "ai_chat":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No assistant answer has that id.")
    result = chat.get("result") if isinstance(chat.get("result"), dict) else {}
    proposal = result.get("action") if isinstance(result.get("action"), dict) else None
    if not proposal or proposal.get("operation") not in SCHEMAS or not isinstance(proposal.get("payload"), dict):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That answer has no action to confirm.")
    operation, payload = proposal["operation"], proposal["payload"]
    client = user_client(current.access_token)
    if (saved.get(action_id) or {}).get("result") is None:
        # Not run yet: it must still fit the owner's records as they are now.
        context = _mapping(_rpc(client, "mobile_owner_assistant_context"))
        try:
            _checked_payload(operation, payload, context, None, None, is_agent(current))
        except OutOfBounds as exc:
            reason = str(exc)
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"This suggestion is out of date: {reason[:1].lower()}{reason[1:]}.") from exc
        # An answer saved before the basis was kept has none; its payload check above still applies.
        if "basis" in proposal and basis(operation, payload, context) != proposal["basis"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "This suggestion is out of date: what it changes was edited "
                                                          "after it was suggested. Ask again for a new one.")
        if operation == "assign_maintenance":
            # The R18 gate of POST /maintenance/{id}/assign, read now: assign_maintenance_work_order checks
            # only the provider's users row, not their profile's verification.
            gates.require_verified_party(str(payload["providerId"]), "receive_repairs")
    # A retry reuses action_id, so the database returns the first result instead of acting again.
    outcome = _mapping(_rpc(client, "mobile_owner_assistant_action", {
        "p_request": action_id, "p_operation": operation, "p_payload": payload, "p_confirmed": True,
    }))
    receipt = None
    try:
        _rpc(client, "mobile_owner_assistant_receipt", {"p_chat_request": request_id, "p_action_request": action_id})
        receipt = action_id
    except HTTPException:
        logger.warning("Owner assistant receipt not saved for a %s action", operation)
    message = outcome.get("message") if isinstance(outcome.get("message"), str) else "Action completed."
    record, fields = _saved_fields(outcome)
    return {
        "request_id": request_id, "action_request_id": action_id, "operation": operation, "message": message,
        "record": record, "saved": fields, "receipt": receipt,
        "reply": f"{message} Receipt: {action_id}" if receipt else message,
    }
