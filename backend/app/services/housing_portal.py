"""The Housing Portal (tracker R41): what authorised housing officers monitor, and what they ask for.

Every officer function here runs for a caller core/officer.py let in (an
ACTIVE REGULATOR); the admins' side of the data category requests runs behind
core/admin.py. Officers see:

- **Referrals**: the case packages admins referred from a critical alert
  (mobile_admin_escalate_alert), read and moved through the officer's JWT
  (mobile_housing_red_flag_referrals, mobile_housing_update_referral), so the
  database checks the officer again and logs each action. A package is one
  row per alert: a retried action changes that row again and never opens a
  second case.
- **Red-flag alerts**: red_flag_events, read only (the database raises them
  when a complaint is lodged, evaluate_complaint_red_flags), and
  regulatory_red_flags, whose status officers move.
- **Figures**: complaints by category and status, reviews and ratings,
  counted from the rows.
- **Housing surveys**: regulatory_surveys and their questions. Nothing sends a
  survey or collects answers (there is no response table), so the portal
  shows them as prototypes.
- **De-identified aggregates**: complaints by suburb and category, each count
  under SUPPRESS_BELOW hidden, and never a name, email or street address.

Officers also ask the admins to change a datapoint, such as the maintenance
categories (web.datapoint_requests, supabase/shared/0006_housing_portal.sql),
and the admins answer in their console.
"""

from __future__ import annotations

import logging
import secrets
from collections import Counter
from datetime import datetime, timezone
from statistics import median

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client, web_table
from app.services import admin_audit, audit, complaint_categories, notifications
from app.services._common import select_all, select_in
from app.services.maps_messaging import is_uuid, moment
from app.services.maps_reviews_complaints import VISIBLE_REVIEW_STATUSES
from app.services.shared_map import stamp_insert, stamp_update

logger = logging.getLogger(__name__)

# A function's error code, as the answer the web gives; its message is the database's.
RPC_STATUS = {
    "42501": status.HTTP_403_FORBIDDEN,
    "P0002": status.HTTP_404_NOT_FOUND,
    "23505": status.HTTP_409_CONFLICT,
    "22023": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "23514": status.HTTP_422_UNPROCESSABLE_ENTITY,
}

REFERRALS_RPC = "mobile_housing_red_flag_referrals"
UPDATE_REFERRAL_RPC = "mobile_housing_update_referral"
REFERRAL_ACTIONS = ("START_REVIEW", "PREPARE_PACKAGE", "CLOSE")
# mobile_admin_referral_packages.status, and the names the referral functions give them.
PACKAGE_STATUSES = {"REFERRED": "New", "UNDER_REVIEW": "Under review", "PACKAGE_READY": "Package ready",
                    "CLOSED": "Closed"}

COMPLAINTS = "complaints"
COMPLAINT_STATUSES = {"OPEN": "Open", "IN_REVIEW": "In review", "ESCALATED": "Escalated", "RESOLVED": "Resolved",
                      "CLOSED": "Closed"}
OPEN_COMPLAINT_STATUSES = ("OPEN", "IN_REVIEW", "ESCALATED")
SEVERITIES = {"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High", "CRITICAL": "Critical"}

REVIEWS = "reviews"
REVIEW_STATUSES = {"PUBLISHED": "Published", "FLAGGED": "Reported", "HIDDEN": "Hidden", "ARCHIVED": "Archived"}

EVENTS = "red_flag_events"
EVENT_STATUSES = {"OPEN": "Open", "ACKNOWLEDGED": "Acknowledged", "RESOLVED": "Resolved", "DISMISSED": "Dismissed"}
OPEN_EVENT_STATUSES = ("OPEN", "ACKNOWLEDGED")
FLAGS = "regulatory_red_flags"
FLAG_STATUSES = ("New", "Under review", "Escalated", "Closed")
OPEN_FLAG_STATUSES = ("New", "Under review", "Escalated")

SURVEYS = "regulatory_surveys"
QUESTIONS = "regulatory_survey_questions"
SURVEY_STATUSES = ("Draft", "Live", "Closed")
# A survey goes live once, and closes once.
SURVEY_NEXT = {"Draft": "Live", "Live": "Closed"}

# In the web schema: query it with web_table(REQUESTS).
REQUESTS = "datapoint_requests"
DATAPOINTS = {
    "complaint_categories": "Complaint categories",
    "maintenance_categories": "Maintenance categories",
    "red_flag_rules": "Red-flag rules",
    "review_questions": "Review questions",
    "other": "Other",
}
REQUEST_STATUSES = ("pending", "accepted", "declined", "completed")
# What an admin may answer from each status; declined and completed are final.
REQUEST_NEXT = {"pending": ("accepted", "declined", "completed"), "accepted": ("completed", "declined")}
REQUESTS_PATH_OFFICER = "/housing/data-requests"
REQUESTS_PATH_ADMIN = "/admin/data-requests"

# A count under this is hidden in the aggregates.
SUPPRESS_BELOW = 5

FLAG_NOT_FOUND = "Red-flag alert not found"
SURVEY_NOT_FOUND = "Survey not found"
REQUEST_NOT_FOUND = "Data category request not found"
REFERRAL_NOT_FOUND = "Referral package not found."


def _db():
    return get_supabase_client()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rpc(client, name: str, params: dict | None = None):
    """A function's value, or its refusal as the web's answer with the function's own message."""
    try:
        return client.rpc(name, params or {}).execute().data
    except APIError as exc:
        answer = RPC_STATUS.get(getattr(exc, "code", None))
        if answer is None:
            raise  # main.py turns any other database error into a 4xx or 500
        raise HTTPException(answer, exc.message or "The request was refused.") from exc


def _counts(counter: Counter, labels: dict[str, str]) -> list[dict]:
    """CountOut rows: every known value in its order, then any other value the rows hold."""
    known = [{"key": key, "label": label, "count": counter.get(key, 0)} for key, label in labels.items()]
    others = [{"key": str(key), "label": str(key).replace("_", " ").capitalize(), "count": count}
              for key, count in sorted(counter.items(), key=lambda item: str(item[0])) if key not in labels]
    return known + others


def _days(start, end) -> float | None:
    started, ended = moment(start), moment(end)
    if not started or not ended or ended < started:
        return None
    return (ended - started).total_seconds() / 86400


def _median(values: list[float]) -> float | None:
    return round(median(values), 1) if values else None


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def _object(value) -> dict:
    return value if isinstance(value, dict) else {}


def _text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int(value) -> int | None:
    try:
        return int(value) if value is not None and not isinstance(value, bool) else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Complaints and reviews: the overview's figures
# ---------------------------------------------------------------------------
def _complaint_rows() -> list[dict]:
    return select_all(lambda: _db().table(COMPLAINTS)
                      .select("id, category, status, severity, lodged_at, resolved_at, property_id").order("id"))


def complaint_summary(rows: list[dict] | None = None, labels: complaint_categories.Labels | None = None) -> dict:
    """ComplaintSummaryOut: every complaint by status, severity and category, from the rows themselves."""
    rows = _complaint_rows() if rows is None else rows
    labels = labels or complaint_categories.Labels()
    statuses, severities = Counter(), Counter()
    categories: dict[str, dict] = {}
    all_days: list[float] = []
    for row in rows:
        category = labels.category(row.get("category"))
        entry = categories.setdefault(category["code"], {
            "code": category["code"], "label": category["label"], "total": 0, "statuses": Counter(), "days": [],
        })
        entry["total"] += 1
        entry["statuses"][row.get("status")] += 1
        statuses[row.get("status")] += 1
        severities[row.get("severity")] += 1
        if row.get("status") in ("RESOLVED", "CLOSED"):
            days = _days(row.get("lodged_at"), row.get("resolved_at"))
            if days is not None:
                entry["days"].append(days)
                all_days.append(days)
    ordered = sorted(categories.values(), key=lambda entry: (-entry["total"], entry["label"].lower()))
    return {
        "total": len(rows),
        "open": sum(statuses.get(value, 0) for value in OPEN_COMPLAINT_STATUSES),
        "statuses": _counts(statuses, COMPLAINT_STATUSES),
        "severities": _counts(severities, SEVERITIES),
        "categories": [{
            "code": entry["code"],
            "label": entry["label"],
            "total": entry["total"],
            "statuses": _counts(entry["statuses"], COMPLAINT_STATUSES),
            "median_days_to_resolve": _median(entry["days"]),
        } for entry in ordered],
        "median_days_to_resolve": _median(all_days),
    }


def review_figures() -> dict:
    """ReviewFiguresOut: reviews by status, and the ratings of those profiles and listings show."""
    rows = select_all(lambda: _db().table(REVIEWS)
                      .select("id, property_id, rating, landlord_rating, status, is_verified_interaction").order("id"))
    visible = [row for row in rows if row.get("status") in VISIBLE_REVIEW_STATUSES]
    property_reviews = [row for row in visible if row.get("property_id")]
    ratings = [row["rating"] for row in visible if isinstance(row.get("rating"), int) and 1 <= row["rating"] <= 5]
    landlord = [row["landlord_rating"] for row in property_reviews
                if isinstance(row.get("landlord_rating"), int) and 1 <= row["landlord_rating"] <= 5]
    stars = Counter(ratings)
    return {
        "total": len(rows),
        "statuses": _counts(Counter(row.get("status") for row in rows), REVIEW_STATUSES),
        "visible": len(visible),
        "property_reviews": len(property_reviews),
        "verified": sum(1 for row in visible if row.get("is_verified_interaction")),
        "average_rating": _mean(ratings),
        "average_landlord_rating": _mean(landlord),
        "distribution": [{"key": str(star), "label": f"{star} star{'s' if star > 1 else ''}", "count": stars.get(star, 0)}
                         for star in range(1, 6)],
    }


# ---------------------------------------------------------------------------
# Referrals
# ---------------------------------------------------------------------------
def _referral_out(item: dict) -> dict:
    """ReferralOut from one item of mobile_housing_red_flag_referrals."""
    prepared = _object(item.get("preparedSnapshot"))
    evidence = _object(item.get("evidenceSnapshot"))
    complaint = _object(prepared.get("complaint"))
    parties = _object(prepared.get("parties"))
    thresholds = _object(evidence.get("thresholds"))
    photos = evidence.get("photos")
    events = evidence.get("complaintEvents")
    package_status = _text(item.get("packageStatus")) or "REFERRED"
    return {
        "id": str(item.get("id")),
        "alert_id": _text(item.get("alertId")),
        "complaint_id": _text(item.get("complaintId")),
        "case_reference": _text(item.get("caseReference")),
        "severity": _text(item.get("severity")),
        "status": _text(item.get("status")) or PACKAGE_STATUSES.get(package_status, "Closed"),
        "package_status": package_status,
        "title": _text(item.get("title")),
        "reason": _text(item.get("reason")),
        "category": _text(item.get("category")),
        "area": _text(item.get("area")),
        "address": _text(item.get("address")),
        "assigned_team": _text(item.get("assignedTeam")),
        "admin_note": _text(item.get("adminNote")),
        "regulator_note": _text(item.get("regulatorNote")),
        "referred_at": item.get("referredAt"),
        "updated_at": item.get("updatedAt"),
        "complaint": {
            "description": _text(complaint.get("description")),
            "category": _text(complaint.get("category")),
            "severity": _text(complaint.get("severity")),
            "status": _text(complaint.get("status")),
            "lodged_at": complaint.get("lodgedAt"),
        },
        "parties": {"tenant_name": _text(parties.get("tenantName")), "owner_name": _text(parties.get("ownerName"))},
        "evidence": {
            "trigger_reason": _text(evidence.get("triggerReason")),
            "days_open": _int(thresholds.get("daysOpen")),
            "property_open_complaints": _int(thresholds.get("propertyOpenComplaints")),
            "owner_open_complaints": _int(thresholds.get("ownerOpenComplaints")),
            "photo_count": len(photos) if isinstance(photos, list) else 0,
            "documents_verified": evidence.get("documentsVerified") if isinstance(evidence.get("documentsVerified"), bool) else None,
            "work_order_status": _text(evidence.get("workOrderStatus")),
            "events": [{"type": _text(event.get("type")), "note": _text(event.get("note")), "created_at": event.get("createdAt")}
                       for event in events if isinstance(event, dict)] if isinstance(events, list) else [],
        },
    }


def referrals(current: CurrentProfile) -> list[dict]:
    """The referral packages, newest work first, as the database orders them for the officer."""
    data = _rpc(user_client(current.access_token), REFERRALS_RPC)
    return [_referral_out(item) for item in (data if isinstance(data, list) else []) if isinstance(item, dict)]


def referral_figures(items: list[dict]) -> dict:
    """ReferralFiguresOut from referrals()."""
    counts = Counter(item["package_status"] for item in items)
    return {
        "total": len(items),
        "open": sum(count for key, count in counts.items() if key != "CLOSED"),
        "statuses": _counts(counts, PACKAGE_STATUSES),
    }


def act_on_referral(current: CurrentProfile, referral_id: str, action: str, note: str | None) -> dict:
    """START_REVIEW, PREPARE_PACKAGE or CLOSE one package, through mobile_housing_update_referral.

    The function updates the package's own row, so doing it again changes
    nothing else: there is never a second case for an alert. It logs the
    action in mobile_admin_audit_entries; the web's audit_log gets it too.
    """
    if not is_uuid(referral_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, REFERRAL_NOT_FOUND)
    data = _rpc(user_client(current.access_token), UPDATE_REFERRAL_RPC,
                {"p_referral_id": referral_id, "p_action": action, "p_note": note})
    row = _object(data)
    package_status = _text(row.get("packageStatus")) or ""
    audit.record(current.id, f"housing.referral.{action.lower()}", "referral_package", referral_id,
                 {"to_status": package_status, "note": bool(note)})
    return {
        "id": str(row.get("id") or referral_id),
        "status": _text(row.get("status")) or PACKAGE_STATUSES.get(package_status, "Closed"),
        "package_status": package_status,
        "regulator_note": _text(row.get("regulatorNote")),
        "updated_at": row.get("updatedAt"),
    }


# ---------------------------------------------------------------------------
# Red-flag alerts
# ---------------------------------------------------------------------------
def _area(place: dict) -> str | None:
    """A property's suburb and state, never its street."""
    return " ".join(part for part in (_text(place.get("suburb")), _text(place.get("state"))) if part) or None


def _event_out(row: dict) -> dict:
    rule = _object(row.get("rule"))
    evidence = _object(row.get("evidence"))
    return {
        "id": row["id"],
        "rule": _text(rule.get("name")),
        "severity": _text(rule.get("severity")),
        "summary": row.get("summary") or "",
        "status": row.get("status"),
        "area": _area(_object(row.get("property"))),
        "complaint_count": _int(evidence.get("complaintCount")),
        "threshold": _int(evidence.get("thresholdCount")),
        "window_days": _int(evidence.get("windowDays")),
        "details": _text(evidence.get("details")),
        "triggered_at": row.get("triggered_at"),
        "resolved_at": row.get("resolved_at"),
    }


def _events() -> list[dict]:
    return select_all(lambda: _db().table(EVENTS).select(
        "id, summary, status, triggered_at, resolved_at, evidence, "
        "rule:red_flag_rules!rule_id(name, severity), property:properties!property_id(suburb, state)"
    ).order("triggered_at", desc=True).order("id"))


def _flags() -> list[dict]:
    return select_all(lambda: _db().table(FLAGS).select("*").order("raised_at", desc=True).order("id"))


def _flag_out(row: dict) -> dict:
    return {key: row.get(key) for key in
            ("id", "severity", "title", "area", "category", "reports", "threshold", "status", "raised_at")}


def red_flags() -> dict:
    """RedFlagsOut: the database's red-flag events (read only) and the regulatory alerts, newest first."""
    return {"events": [_event_out(row) for row in _events()], "alerts": [_flag_out(row) for row in _flags()]}


def _statuses(table: str) -> Counter:
    return Counter(row.get("status") for row in select_all(lambda: _db().table(table).select("id, status").order("id")))


def red_flag_figures() -> dict:
    """RedFlagFiguresOut: the red-flag events and the regulatory alerts by status."""
    event_counts, flag_counts = _statuses(EVENTS), _statuses(FLAGS)
    return {
        "events": _counts(event_counts, EVENT_STATUSES),
        "open_events": sum(event_counts.get(value, 0) for value in OPEN_EVENT_STATUSES),
        "alerts": _counts(flag_counts, {value: value for value in FLAG_STATUSES}),
        "open_alerts": sum(flag_counts.get(value, 0) for value in OPEN_FLAG_STATUSES),
    }


def set_flag_status(current: CurrentProfile, flag_id: str, new_status: str, from_status: str) -> dict:
    """Move a regulatory alert to New, Under review, Escalated or Closed, while it has the status the officer saw.

    Asking again for the status it already has (a retry) changes nothing.
    """
    found = _db().table(FLAGS).select("*").eq("id", flag_id).limit(1).execute().data or []
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, FLAG_NOT_FOUND)
    row = found[0]
    if row.get("status") == new_status:
        return _flag_out(row)
    if row.get("status") != from_status:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"This alert is now {row.get('status')}. Reload the alerts and try again.")
    updated = (_db().table(FLAGS).update(stamp_update(FLAGS, {"status": new_status}))
               .eq("id", flag_id).eq("status", from_status).execute().data or [])
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, "This alert changed meanwhile. Reload the alerts and try again.")
    # The id is text: both logs keep it in the metadata, their entity_id being a uuid.
    admin_audit.record(
        current.id, "regulatory_flag.status_changed", "regulatory_red_flag", None,
        f"Housing Portal moved the alert \"{row.get('title')}\" from {from_status} to {new_status}.",
        {"flag_id": flag_id, "from_status": from_status, "to_status": new_status},
    )
    return _flag_out(updated[0])


# ---------------------------------------------------------------------------
# The overview
# ---------------------------------------------------------------------------
def overview(current: CurrentProfile) -> dict:
    """HousingOverviewOut: complaints by category and status, reviews and ratings, red flags and referrals."""
    return {
        "complaints": complaint_summary(),
        "reviews": review_figures(),
        "red_flags": red_flag_figures(),
        "referrals": referral_figures(referrals(current)),
    }


# ---------------------------------------------------------------------------
# Data category requests
# ---------------------------------------------------------------------------
def _names(user_ids) -> dict[str, str | None]:
    ids = [user_id for user_id in dict.fromkeys(user_ids) if user_id]
    rows = select_in(lambda: _db().table("users").select("id, full_name"), "id", ids) if ids else []
    return {row["id"]: _text(row.get("full_name")) for row in rows}


def _request_out(row: dict, names: dict[str, str | None]) -> dict:
    return {
        "id": row["id"],
        "officer_id": row.get("officer_id"),
        "officer_name": names.get(row.get("officer_id")),
        "datapoint": row["datapoint"],
        "datapoint_label": DATAPOINTS.get(row["datapoint"], row["datapoint"]),
        "requested_change": row["requested_change"],
        "reason": row["reason"],
        "status": row["status"],
        "admin_response": row.get("admin_response"),
        "responded_by_name": names.get(row.get("responded_by")),
        "responded_at": row.get("responded_at"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _requests_out(rows: list[dict]) -> list[dict]:
    names = _names([row.get("officer_id") for row in rows] + [row.get("responded_by") for row in rows])
    return [_request_out(row, names) for row in rows]


def list_requests() -> list[dict]:
    """Every data category request, newest first: the officers' and the admins' view alike."""
    return _requests_out(select_all(lambda: web_table(REQUESTS).select("*").order("created_at", desc=True).order("id")))


def _same(one: str, other: str) -> bool:
    return " ".join(one.split()).casefold() == " ".join(other.split()).casefold()


def _active_admins() -> list[str]:
    rows = (_db().table("users").select("id, status, deleted_at").eq("primary_role", "ADMIN").eq("status", "ACTIVE")
            .execute().data or [])
    return [row["id"] for row in rows if not row.get("deleted_at")]


def create_request(current: CurrentProfile, datapoint: str, requested_change: str, reason: str) -> tuple[dict, bool]:
    """An officer's request, and whether it is new.

    The same officer sending the same change again while it is pending (a
    retry, a double click) gets that request back, not a second one.
    """
    pending = (web_table(REQUESTS).select("*").eq("officer_id", current.id).eq("datapoint", datapoint)
               .eq("status", "pending").execute().data or [])
    for row in pending:
        if _same(row["requested_change"], requested_change):
            return _requests_out([row])[0], False
    row = web_table(REQUESTS).insert({
        "officer_id": current.id,
        "datapoint": datapoint,
        "requested_change": requested_change,
        "reason": reason,
    }).execute().data[0]
    audit.record(current.id, "housing.datapoint_requested", "datapoint_request", row["id"], {"datapoint": datapoint})
    label = DATAPOINTS[datapoint].lower()
    for admin_id in _active_admins():
        notifications.notify(admin_id, "account", "New data category request",
                             f"A Housing Portal officer asked for a change to the {label}.", REQUESTS_PATH_ADMIN)
    return _requests_out([row])[0], True


def respond_to_request(admin: CurrentProfile, request_id: str, decision: str, response: str, from_status: str) -> dict:
    """An admin's answer to a request, while it has the status they saw; the officer is told.

    Sending the same answer again (a retry) changes nothing.
    """
    found = (web_table(REQUESTS).select("*").eq("id", request_id).limit(1).execute().data or []
             if is_uuid(request_id) else [])
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, REQUEST_NOT_FOUND)
    row = found[0]
    if row["status"] == decision and (row.get("admin_response") or "") == response:
        return _requests_out([row])[0]
    if row["status"] != from_status:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"This request is now {row['status']}. Reload the requests and try again.")
    if decision not in REQUEST_NEXT.get(row["status"], ()):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A request that is {row['status']} cannot be {decision}.")
    updated = (web_table(REQUESTS).update({
        "status": decision, "admin_response": response, "responded_by": admin.id, "responded_at": _now(),
    }).eq("id", request_id).eq("status", from_status).execute().data or [])
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, "This request changed meanwhile. Reload the requests and try again.")
    label = DATAPOINTS.get(row["datapoint"], row["datapoint"]).lower()
    admin_audit.record(
        admin.id, "datapoint_request.answered", "datapoint_request", request_id,
        f"Marked a Housing Portal request about the {label} {decision}: {response}",
        {"from_status": from_status, "to_status": decision, "reason": response, "officer_id": row.get("officer_id")},
    )
    notifications.notify(row.get("officer_id"), "account", f"Your data category request was {decision}",
                         response, REQUESTS_PATH_OFFICER)
    return _requests_out(updated)[0]


# ---------------------------------------------------------------------------
# Housing surveys
# ---------------------------------------------------------------------------
def _survey_out(row: dict) -> dict:
    questions = sorted((question for question in row.get(QUESTIONS) or [] if isinstance(question, dict)),
                       key=lambda question: (question.get("sort_order") or 0, question.get("id") or 0))
    return {
        "id": row["id"],
        "title": row["title"],
        "audience": row["audience"],
        "status": row["status"],
        "responses": row.get("responses") or 0,
        "target_responses": row.get("target_responses") or 0,
        "closes_at": row.get("closes_at") or "",
        "created_at": row.get("created_at"),
        "questions": [{"id": question["id"], "sort_order": question.get("sort_order") or 0,
                       "text": question.get("question_text") or ""} for question in questions],
        "next_status": SURVEY_NEXT.get(row["status"]),
    }


def _survey_query():
    return _db().table(SURVEYS).select(f"*, {QUESTIONS}(id, sort_order, question_text)")


def surveys() -> list[dict]:
    """Every survey with its questions, newest first."""
    return [_survey_out(row) for row in select_all(lambda: _survey_query().order("created_at", desc=True).order("id"))]


def _get_survey(survey_id: str) -> dict:
    found = _survey_query().eq("id", survey_id).limit(1).execute().data or []
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, SURVEY_NOT_FOUND)
    return found[0]


def _insert_questions(survey_id: str, texts: list[str]) -> None:
    """The survey's questions, numbered by the database; by the web only where it gives no number.

    The snapshot shows no default for regulatory_survey_questions.id. A
    database that numbers them itself (an identity column) keeps its own
    sequence; one that refuses a question without an id (23502) gets the
    next free ids instead, tried again if another insert took them first.
    """
    rows = [{"survey_id": survey_id, "sort_order": index + 1, "question_text": text} for index, text in enumerate(texts)]
    try:
        _db().table(QUESTIONS).insert(rows).execute()
        return
    except APIError as exc:
        if getattr(exc, "code", None) != "23502":
            raise
    for _attempt in range(3):
        top = _db().table(QUESTIONS).select("id").order("id", desc=True).limit(1).execute().data or []
        start = int(top[0]["id"]) + 1 if top else 1
        try:
            _db().table(QUESTIONS).insert([{"id": start + index, **row} for index, row in enumerate(rows)]).execute()
            return
        except APIError as exc:
            if getattr(exc, "code", None) != "23505":
                raise
    raise HTTPException(status.HTTP_409_CONFLICT, "Another survey was saved at the same time. Please try again.")


def create_survey(current: CurrentProfile, payload: dict) -> dict:
    """A new Draft survey and its questions; nothing is sent to anyone."""
    survey = {
        "id": f"SV-{secrets.token_hex(4).upper()}",
        "title": payload["title"],
        "audience": payload["audience"],
        "status": "Draft",
        "target_responses": payload["target_responses"],
    }
    if payload.get("closes_on"):
        survey["closes_at"] = payload["closes_on"].isoformat()
    _db().table(SURVEYS).insert(stamp_insert(SURVEYS, survey)).execute()
    try:
        _insert_questions(survey["id"], payload["questions"])
    except Exception:
        # No survey without its questions: the questions go with it (on delete cascade).
        _db().table(SURVEYS).delete().eq("id", survey["id"]).execute()
        raise
    audit.record(current.id, "housing.survey_created", "regulatory_survey", None,
                 {"survey_id": survey["id"], "questions": len(payload["questions"])})
    return _survey_out(_get_survey(survey["id"]))


def set_survey_status(current: CurrentProfile, survey_id: str, new_status: str, from_status: str) -> dict:
    """Draft to Live, or Live to Closed, while the survey has the status the officer saw.

    Asking again for the status it already has (a retry) changes nothing.
    """
    row = _get_survey(survey_id)
    if row["status"] == new_status:
        return _survey_out(row)
    if row["status"] != from_status:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"This survey is now {row['status']}. Reload the surveys and try again.")
    if SURVEY_NEXT.get(from_status) != new_status:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {from_status} survey cannot become {new_status}.")
    updated = (_db().table(SURVEYS).update(stamp_update(SURVEYS, {"status": new_status}))
               .eq("id", survey_id).eq("status", from_status).execute().data or [])
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, "This survey changed meanwhile. Reload the surveys and try again.")
    audit.record(current.id, "housing.survey_status_changed", "regulatory_survey", None,
                 {"survey_id": survey_id, "from_status": from_status, "to_status": new_status})
    return _survey_out(_get_survey(survey_id))


# ---------------------------------------------------------------------------
# De-identified aggregates
# ---------------------------------------------------------------------------
def _suppress(cells: list[dict]) -> None:
    """Hide each count under SUPPRESS_BELOW, and enough others that none can be worked out.

    The overview publishes each category's total, so a category with a single
    hidden count would give it away by subtraction: the smallest count shown
    in that category is hidden with it.
    """
    for cell in cells:
        cell["suppressed"] = cell["count"] < SUPPRESS_BELOW
    by_category: dict[str, list[dict]] = {}
    for cell in cells:
        by_category.setdefault(cell["category_code"], []).append(cell)
    for group in by_category.values():
        hidden = [cell for cell in group if cell["suppressed"]]
        shown = sorted((cell for cell in group if not cell["suppressed"]), key=lambda cell: cell["count"])
        if len(hidden) == 1 and shown:
            shown[0]["suppressed"] = True
    for cell in cells:
        if cell["suppressed"]:
            cell["count"] = None


def aggregates() -> dict:
    """AggregatesOut: complaints about a home, counted by its suburb and the complaint's category.

    Only suburbs, states and category names leave here: never a name, an
    email, a street address or an id, and no count under SUPPRESS_BELOW.
    """
    complaints = [row for row in select_all(lambda: _db().table(COMPLAINTS).select("id, category, property_id").order("id"))
                  if row.get("property_id")]
    homes = {row["id"]: row for row in select_in(lambda: _db().table("properties").select("id, suburb, state"), "id",
                                                  [row["property_id"] for row in complaints])}
    labels = complaint_categories.Labels()
    names: dict[tuple[str, str], str] = {}
    counts: Counter = Counter()
    categories: dict[str, str] = {}
    for row in complaints:
        home = homes.get(row["property_id"]) or {}
        suburb = " ".join(str(home.get("suburb") or "").split())
        if not suburb:
            continue
        state = " ".join(str(home.get("state") or "").split()).upper()
        area = (suburb.casefold(), state)
        names.setdefault(area, suburb)
        category = labels.category(row.get("category"))
        categories[category["code"]] = category["label"]
        counts[(area, category["code"])] += 1
    cells = [{
        "area": names[area], "state": area[1], "category": categories[code], "category_code": code, "count": count,
    } for (area, code), count in counts.items()]
    _suppress(cells)
    cells.sort(key=lambda cell: (cell["state"], cell["area"].casefold(), cell["category"].casefold()))
    return {
        "threshold": SUPPRESS_BELOW,
        "areas": len(names),
        "suppressed_cells": sum(1 for cell in cells if cell["suppressed"]),
        "cells": cells,
    }
