"""Stand-ins for the complaint, red-flag and admin alert functions (tracker R38, R39, R40).

Each follows its body in output/shared-catalog/functions/<name>.sql
(snapshot of 2026-10-23): the same checks in the same order, the same
writes, the same errors and the same result. Where the function relies on
the database, the stand-in does it by hand, and says so:

- the AFTER INSERT trigger on complaints (evaluate_complaint_red_flags)
  runs after a stand-in's complaints insert, as the database runs it;
- "on conflict (complaint_id)" and "on conflict (alert_id)" find the row
  first, since the snapshot holds no unique constraints for the fake;
- Postgres trim() takes off spaces only, so these strip " ", not every
  whitespace character.

Functions the web never calls itself but these use (mobile_require_admin,
mobile_admin_log_action) are helpers here, not stand-ins, so no other
area's stand-in for them clashes with these.
"""

import math
import re
import uuid
from datetime import datetime, timedelta, timezone

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

GENERAL_CATEGORIES = ("PROPERTY_CONDITION", "LANDLORD_CONDUCT", "SAFETY", "PRIVACY", "OTHER")
COMPLAINT_SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
REVIEW_STATUSES = ("IN_REVIEW", "ESCALATED", "RESOLVED", "CLOSED")
POLICY_SEVERITIES = ("NORMAL", "HIGH", "URGENT", "CRITICAL")
ACTIVE_FLAG_STATUSES = ("OPEN", "ACKNOWLEDGED")


# ---------------------------------------------------------------------------
# Postgres behaviour the bodies rely on
# ---------------------------------------------------------------------------
def _trim(value) -> str:
    """trim(text): leading and trailing spaces only."""
    return str(value).strip(" ")


def _moment(value) -> datetime | None:
    """A timestamptz as an aware datetime; None stays None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _iso(value) -> str | None:
    moment = _moment(value)
    return moment.isoformat() if moment else None


def _like(text: str, pattern: str) -> bool:
    """text LIKE pattern: % is any run of characters, _ any one."""
    regex = re.escape(pattern).replace("%", ".*").replace("_", ".")
    return re.fullmatch(regex, text, re.DOTALL) is not None


def _initcap(text: str) -> str:
    return re.sub(r"[A-Za-z0-9]+", lambda word: word.group(0)[:1].upper() + word.group(0)[1:].lower(), text)


def _concat_ws(separator: str, *values) -> str:
    return separator.join(str(value) for value in values if value is not None)


def _nullif_empty(value):
    return None if value == "" else value


def _one(ctx, table: str, **equals) -> dict | None:
    for row in ctx.rows(table):
        if all(row.get(column) == value for column, value in equals.items()):
            return row
    return None


def _work_order(ctx, complaint_id) -> dict | None:
    """maintenance_work_orders.complaint_id is unique: at most one per complaint."""
    return _one(ctx, "maintenance_work_orders", complaint_id=complaint_id)


def _require_admin(ctx) -> str:
    """public.mobile_require_admin(): the caller's users.id, or 42501."""
    caller = ctx.caller
    if caller is None or caller.get("primary_role") != "ADMIN" or caller.get("status") != "ACTIVE" \
            or caller.get("deleted_at") is not None:
        raise api_error("42501", "You need admin privileges to access this page.")
    return caller["id"]


def _log_action(ctx, actor, action, entity_type, entity_id, summary, metadata=None) -> None:
    """public.mobile_admin_log_action()."""
    ctx.table("mobile_admin_audit_entries").insert({
        "actor_user_id": actor,
        "action": action[:80],
        "entity_type": entity_type[:80],
        "entity_id": entity_id,
        "summary": summary[:500],
        "metadata": metadata if metadata is not None else {},
    }).execute()


def _issue_text(complaint: dict) -> str:
    """lower(coalesce(metadata->'mobile'->>'issueTitle', '') || ' ' || coalesce(description, ''))."""
    meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
    mobile = meta.get("mobile") if isinstance(meta.get("mobile"), dict) else {}
    title = mobile.get("issueTitle")
    return f"{title if isinstance(title, str) else ''} {complaint.get('description') or ''}".lower()


def _keyword_match(complaint: dict, keywords) -> bool:
    text = _issue_text(complaint)
    return any(_like(text, f"%{keyword.lower()}%") for keyword in keywords or [])


def _covers(policy: dict, complaint: dict) -> bool:
    """upper(c.category) = any(source_categories), or one of the keywords in its text."""
    return str(complaint.get("category") or "").upper() in (policy.get("source_categories") or []) \
        or _keyword_match(complaint, policy.get("keywords"))


# ---------------------------------------------------------------------------
# Complaints
# ---------------------------------------------------------------------------
@rpc("create_general_complaint")
def create_general_complaint(ctx, params):
    category, severity = params["p_category"], params["p_severity"]
    description = params["p_description"]
    if category not in GENERAL_CATEGORIES:
        raise api_error("22023", "Invalid complaint category")
    if severity not in COMPLAINT_SEVERITIES:
        raise api_error("22023", "Invalid complaint severity")
    if len(_trim(description or "")) < 10 or len(_trim(description)) > 3000:
        raise api_error("22023", "Complaint description must be between 10 and 3000 characters")

    reporter = params["p_reporter_user_id"]
    tenant = _one(ctx, "users", id=reporter, primary_role="TENANT", status="ACTIVE", deleted_at=None)
    if tenant is None:
        raise api_error("42501", "Only an active tenant may submit a complaint")

    tenancy = None
    for application in ctx.rows("rental_applications"):
        if application.get("applicant_user_id") != reporter or application.get("status") != "APPROVED" \
                or application.get("listing_id") != params["p_listing_id"]:
            continue
        listing = _one(ctx, "listings", id=application["listing_id"])
        prop = _one(ctx, "properties", id=listing["property_id"]) if listing else None
        if prop is not None:
            tenancy = prop
            break
    if tenancy is None:
        raise api_error("42501", "A complaint requires an approved tenancy for this property")

    now = _iso(params["p_now"])
    complaint_id = params["p_complaint_id"]
    created = ctx.table("complaints").insert({
        "id": complaint_id,
        "reporter_user_id": reporter,
        "against_user_id": tenancy["owner_user_id"],
        "property_id": tenancy["id"],
        "category": category,
        "description": _trim(description),
        "severity": severity,
        "status": "OPEN",
        "lodged_at": now,
        "metadata": {"source": "tenant_general_complaint", "listingId": params["p_listing_id"]},
    }).execute().data[0]
    evaluate_complaint_red_flags(ctx, created)

    ctx.table("complaint_events").insert({
        "complaint_id": complaint_id,
        "actor_user_id": reporter,
        "event_type": "LODGED",
        "note": "Complaint lodged by tenant.",
        "metadata": {"status": "OPEN"},
        "created_at": now,
    }).execute()
    ctx.table("notifications").insert({
        "user_id": tenancy["owner_user_id"],
        "title": "New property complaint",
        "body": "A tenant submitted a complaint linked to one of your properties.",
        "category": "system",
        "link": "/admin/complaints",
        "created_at": now,
    }).execute()
    return [{"complaint_id": complaint_id, "complaint_status": "OPEN"}]


@rpc("review_general_complaint")
def review_general_complaint(ctx, params):
    admin_id, new_status, note = params["p_admin_user_id"], params["p_status"], params["p_note"]
    if _one(ctx, "users", id=admin_id, primary_role="ADMIN", status="ACTIVE", deleted_at=None) is None:
        raise api_error("42501", "Administrator access is required")
    if new_status not in REVIEW_STATUSES:
        raise api_error("22023", "Invalid complaint status")
    if len(note or "") > 1200:
        raise api_error("22023", "Complaint note is too long")

    complaint = next((
        row for row in ctx.rows("complaints")
        if row["id"] == params["p_complaint_id"]
        and ((row.get("metadata") or {}).get("source") if isinstance(row.get("metadata"), dict) else None)
        == "tenant_general_complaint"
    ), None)
    if complaint is None:
        raise api_error("P0002", "Complaint not found")
    current = complaint["status"]
    if current == "CLOSED":
        raise api_error("22023", "A closed complaint cannot be changed")
    if current == new_status:
        raise api_error("22023", "Complaint already has this status")

    now = _iso(params["p_now"])
    ctx.table("complaints").update({
        "status": new_status,
        "resolved_at": now if new_status in ("RESOLVED", "CLOSED") else None,
    }).eq("id", complaint["id"]).execute()
    ctx.table("complaint_events").insert({
        "complaint_id": complaint["id"],
        "actor_user_id": admin_id,
        "event_type": "STATUS_CHANGED",
        "note": _nullif_empty(_trim(note or "")),
        "metadata": {"fromStatus": current, "toStatus": new_status},
        "created_at": now,
    }).execute()
    ctx.table("notifications").insert({
        "user_id": complaint["reporter_user_id"],
        "title": "Complaint status updated",
        "body": "Your complaint is now " + new_status.replace("_", " ").lower() + ".",
        "category": "system",
        "link": "/admin/complaints",
        "created_at": now,
    }).execute()
    return [{"complaint_id": complaint["id"], "complaint_status": new_status, "updated_at": now}]


# ---------------------------------------------------------------------------
# Red flags
# ---------------------------------------------------------------------------
def evaluate_complaint_red_flags(ctx, new: dict) -> None:
    """The trigger evaluate_complaint_red_flags_after_insert on complaints: every active rule, by id."""
    if new.get("property_id") is None:
        return
    rules = sorted((rule for rule in ctx.rows("red_flag_rules") if rule.get("is_active") is True),
                   key=lambda rule: rule["id"])
    for rule in rules:
        _evaluate_for_property(ctx, rule["id"], new["property_id"], new["id"], new["lodged_at"])


def _evaluate_for_property(ctx, rule_id, property_id, complaint_id, evaluated_at) -> str | None:
    """public.evaluate_red_flag_rule_for_property(): the new event's id, or None."""
    if property_id is None:
        return None
    rule = _one(ctx, "red_flag_rules", id=rule_id, is_active=True)
    if rule is None:
        return None

    at = _moment(evaluated_at)
    lodged = [_moment(row.get("lodged_at")) for row in ctx.rows("complaints") if row.get("property_id") == property_id]
    if rule["trigger_mode"] == "TOTAL":
        count = sum(1 for moment in lodged if moment <= at)
        window_start = None
        details = f"{count} complaints have been recorded for this property in total."
    else:
        window_start = at - timedelta(days=rule["window_days"])
        count = sum(1 for moment in lodged if window_start <= moment <= at)
        details = f"{count} complaints were recorded for this property within {rule['window_days']} days."
    if count < rule["threshold_count"]:
        return None

    # pg_advisory_xact_lock(rule, property): the fake runs one call at a time.
    if any(event.get("rule_id") == rule["id"] and event.get("property_id") == property_id
           and event.get("status") in ACTIVE_FLAG_STATUSES for event in ctx.rows("red_flag_events")):
        return None

    event_id = str(uuid.uuid4())
    ctx.table("red_flag_events").insert({
        "id": event_id,
        "rule_id": rule["id"],
        "property_id": property_id,
        "complaint_id": complaint_id,
        "summary": f"{rule['name']}: complaint threshold reached",
        "status": "OPEN",
        "triggered_at": at.isoformat(),
        "evidence": {
            "details": details,
            "complaintCount": count,
            "thresholdCount": rule["threshold_count"],
            "triggerMode": rule["trigger_mode"],
            "windowDays": rule["window_days"] if rule["trigger_mode"] == "WINDOW" else None,
            "windowStart": window_start.isoformat() if window_start else None,
            "evaluatedAt": at.isoformat(),
        },
    }).execute()
    admins = [user for user in ctx.rows("users")
              if user.get("primary_role") == "ADMIN" and user.get("status") == "ACTIVE" and user.get("deleted_at") is None]
    if admins:
        ctx.table("notifications").insert([{
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "title": "New property red flag",
            "body": f"{rule['name']} triggered after {count} complaints.",
            "category": "system",
            "link": "/admin/red-flags",
            "is_read": False,
            "created_at": at.isoformat(),
        } for user in admins]).execute()
    return event_id


@rpc("evaluate_red_flag_rule_for_property")
def evaluate_red_flag_rule_for_property(ctx, params):
    return _evaluate_for_property(ctx, params["p_rule_id"], params["p_property_id"], params["p_complaint_id"],
                                  params["p_evaluated_at"])


@rpc("evaluate_red_flag_rule")
def evaluate_red_flag_rule(ctx, params):
    at = _moment(params["p_evaluated_at"])
    created = 0
    properties = []
    for row in ctx.rows("complaints"):
        if row.get("property_id") is not None and row["property_id"] not in properties:
            properties.append(row["property_id"])
    for property_id in properties:
        lodged = sorted(
            (row for row in ctx.rows("complaints")
             if row.get("property_id") == property_id and _moment(row.get("lodged_at")) <= at),
            key=lambda row: (_moment(row["lodged_at"]), row["id"]),
            reverse=True,
        )
        complaint_id = lodged[0]["id"] if lodged else None
        if _evaluate_for_property(ctx, params["p_rule_id"], property_id, complaint_id, params["p_evaluated_at"]):
            created += 1
    return created


# ---------------------------------------------------------------------------
# Issue categories (the admins' alert policies)
# ---------------------------------------------------------------------------
def _policy_json(row: dict, complaint_count: int) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row["description"],
        "severity": row["severity"],
        "severityLabel": _initcap(row["severity"].lower()),
        "slaHours": row["sla_hours"],
        "routingTeam": row["routing_team"],
        "sourceCategories": list(row["source_categories"]),
        "keywords": list(row["keywords"]),
        "isActive": row["is_active"],
        "complaintCount": complaint_count,
        "updatedAt": _iso(row["updated_at"]),
    }


@rpc("mobile_admin_issue_categories")
def mobile_admin_issue_categories(ctx, params):
    _require_admin(ctx)
    policies = sorted(ctx.rows("mobile_admin_issue_categories"),
                      key=lambda row: (not row["is_active"], _moment(row["created_at"])))
    complaints = ctx.rows("complaints")
    return [_policy_json(row, sum(1 for complaint in complaints if _covers(row, complaint))) for row in policies]


def _sla_hours(payload: dict):
    """(p_payload ->> 'slaHours')::integer, or None where the cast fails."""
    value = payload.get("slaHours")
    if value is None or isinstance(value, bool) or isinstance(value, float):
        return None
    text = str(value).strip()
    return int(text) if re.fullmatch(r"[+-]?\d+", text) else None


def _text_field(payload: dict, key: str, default: str) -> str:
    value = payload.get(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return "true" if value else "false"
    return value if isinstance(value, str) else str(value)


@rpc("mobile_admin_save_issue_category")
def mobile_admin_save_issue_category(ctx, params):
    admin = _require_admin(ctx)
    payload = params["p_payload"] if isinstance(params["p_payload"], dict) else {}
    name = _trim(_text_field(payload, "name", ""))
    description = _trim(_text_field(payload, "description", ""))
    severity = _trim(_text_field(payload, "severity", "NORMAL")).upper()
    routing_team = _trim(_text_field(payload, "routingTeam", "Complaint Resolution Team"))
    if not 3 <= len(name) <= 80:
        raise api_error("22023", "Enter a category name between 3 and 80 characters.")
    if len(description) > 240:
        raise api_error("22023", "The description can be up to 240 characters.")
    if severity not in POLICY_SEVERITIES:
        raise api_error("22023", "Choose a valid severity.")
    if not 3 <= len(routing_team) <= 80:
        raise api_error("22023", "Enter a routing team between 3 and 80 characters.")
    sla = _sla_hours(payload)
    if sla is None or not 1 <= sla <= 2160:
        raise api_error("22023", "SLA hours must be between 1 and 2160.")
    given = payload.get("keywords") if isinstance(payload.get("keywords"), list) else []
    keywords = sorted({
        _trim(value if isinstance(value, str) else str(value)).lower()
        for value in given
        if 2 <= len(_trim(value if isinstance(value, str) else str(value))) <= 60
    })
    if not keywords:
        keywords = [word.lower() for word in re.split(r"\s+", name) if len(word) >= 4]

    now = ctx.now()
    if params["p_category_id"] is None:
        code = re.sub(r"[^A-Za-z0-9]+", "_", name).lower().strip("_")
        if _one(ctx, "mobile_admin_issue_categories", code=code):
            code = f"{code}_{uuid.uuid4().hex[:6]}"
        row = ctx.table("mobile_admin_issue_categories").insert({
            "code": code, "name": name, "description": description, "severity": severity, "sla_hours": sla,
            "routing_team": routing_team, "keywords": keywords, "created_by": admin, "updated_by": admin,
            # As the function: no source_categories, which is NOT NULL. The schema export records no default
            # for it, so the strict fake raises 23502 unless a test gives it one (test_complaint_categories).
        }).execute().data[0]
    else:
        found = ctx.table("mobile_admin_issue_categories").update({
            "name": name, "description": description, "severity": severity, "sla_hours": sla,
            "routing_team": routing_team, "keywords": keywords, "updated_by": admin, "updated_at": now,
        }).eq("id", params["p_category_id"]).execute().data
        if not found:
            raise api_error("P0002", "Category not found.")
        row = found[0]

    _log_action(ctx, admin, "SAVE_CATEGORY", "issue_category", row["id"],
                f"Saved complaint policy category {row['name']}.",
                {"severity": row["severity"], "slaHours": row["sla_hours"]})
    return _policy_json(row, 0)


@rpc("mobile_admin_toggle_issue_category")
def mobile_admin_toggle_issue_category(ctx, params):
    admin = _require_admin(ctx)
    found = ctx.table("mobile_admin_issue_categories").update({
        "is_active": params["p_is_active"], "updated_by": admin, "updated_at": ctx.now(),
    }).eq("id", params["p_category_id"]).execute().data
    if not found:
        raise api_error("P0002", "Category not found.")
    row = found[0]
    _log_action(ctx, admin, "TOGGLE_CATEGORY", "issue_category", row["id"],
                ("Activated " if params["p_is_active"] else "Deactivated ") + row["name"] + ".", {})
    return {"id": row["id"], "isActive": row["is_active"], "updatedAt": _iso(row["updated_at"])}


# ---------------------------------------------------------------------------
# Admin alerts
# ---------------------------------------------------------------------------
def _unresolved(complaint: dict) -> bool:
    return complaint.get("resolved_at") is None and complaint.get("status") != "RESOLVED"


def _refresh_alerts(ctx) -> int:
    """The body of public.mobile_admin_refresh_alerts() after its admin check."""
    now = _moment(ctx.now())
    properties = {row["id"]: row for row in ctx.rows("properties")}
    complaints = ctx.rows("complaints")
    policies = [row for row in ctx.rows("mobile_admin_issue_categories") if row.get("is_active")]
    count = 0
    for complaint in complaints:
        prop = properties.get(complaint.get("property_id"))
        if prop is None or not _unresolved(complaint):
            continue
        lodged = _moment(complaint["lodged_at"])
        hours_open = (now - lodged).total_seconds() / 3600
        days_open = max(0, math.floor((now - lodged).total_seconds() / 86400))
        property_open = sum(
            1 for other in complaints
            if other.get("property_id") == complaint["property_id"] and _unresolved(other)
            and _moment(other["lodged_at"]) >= now - timedelta(days=30)
        )
        owner_open = sum(
            1 for other in complaints
            if other.get("property_id") in properties
            and properties[other["property_id"]].get("owner_user_id") == prop.get("owner_user_id")
            and _unresolved(other) and _moment(other["lodged_at"]) >= now - timedelta(days=90)
        )
        covering = sorted((policy for policy in policies if _covers(policy, complaint)),
                          key=lambda policy: (not _keyword_match(complaint, policy.get("keywords")),
                                              _moment(policy["created_at"])))
        if not covering:
            continue
        policy = covering[0]
        sla = policy["sla_hours"]
        if not (hours_open >= sla or property_open >= 2 or owner_open >= 3):
            continue
        critical = complaint.get("severity") == "CRITICAL" or policy["severity"] == "CRITICAL" \
            or hours_open >= max(sla * 2, 48) or property_open >= 3 or owner_open >= 4
        if owner_open >= 3:
            reason = "Repeated unresolved complaint pattern across this owner's properties."
        elif property_open >= 2:
            reason = "Multiple unresolved complaints were detected for the same property."
        else:
            reason = f"The complaint exceeded its configured {sla}-hour response SLA."
        meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
        mobile = meta.get("mobile") if isinstance(meta.get("mobile"), dict) else {}
        work = _work_order(ctx, complaint["id"])
        values = {
            "category_id": policy["id"],
            "severity": "CRITICAL" if critical else "HIGH",
            "title": (_nullif_empty(mobile.get("issueTitle")) or policy["name"])[:160],
            "reason": reason,
            "threshold_snapshot": {"slaHours": sla, "daysOpen": days_open, "propertyOpenComplaints": property_open,
                                   "ownerOpenComplaints": owner_open},
            "metadata": {
                "address": _concat_ws(", ", prop.get("address_line_1"), prop.get("suburb"), prop.get("state"),
                                      prop.get("postcode")),
                "area": _nullif_empty(prop.get("suburb")) or prop.get("state") or "NSW",
                "tenantId": work.get("tenant_user_id") if work else None,
                "ownerId": prop.get("owner_user_id"),
                "workOrderStatus": work.get("status") if work else None,
                "routingTeam": policy["routing_team"],
            },
            "updated_at": now.isoformat(),
        }
        existing = _one(ctx, "mobile_admin_alerts", complaint_id=complaint["id"])
        if existing is None:
            ctx.table("mobile_admin_alerts").insert({"complaint_id": complaint["id"], **values}).execute()
        else:
            status = "ESCALATED" if existing["status"] == "ESCALATED" else "OPEN"
            ctx.table("mobile_admin_alerts").update({**values, "status": status}).eq("id", existing["id"]).execute()
        count += 1

    by_id = {complaint["id"]: complaint for complaint in complaints}
    for alert in list(ctx.rows("mobile_admin_alerts")):
        complaint = by_id.get(alert["complaint_id"])
        if alert["status"] != "RESOLVED" and complaint is not None and not _unresolved(complaint):
            ctx.table("mobile_admin_alerts").update({"status": "RESOLVED", "updated_at": now.isoformat()}) \
                .eq("id", alert["id"]).execute()
    return count


@rpc("mobile_admin_refresh_alerts")
def mobile_admin_refresh_alerts(ctx, params):
    _require_admin(ctx)
    return _refresh_alerts(ctx)


STATUS_ORDER = {"OPEN": 0, "UNDER_REVIEW": 1, "ESCALATED": 2}


def _count_or_one(value) -> int:
    """coalesce((snapshot ->> key)::integer, 1)."""
    return 1 if value is None else int(value)


@rpc("mobile_admin_alerts")
def mobile_admin_alerts(ctx, params):
    _require_admin(ctx)
    _refresh_alerts(ctx)
    policies = {row["id"]: row for row in ctx.rows("mobile_admin_issue_categories")}
    complaints = {row["id"]: row for row in ctx.rows("complaints")}
    users = {row["id"]: row for row in ctx.rows("users")}
    listed = []
    for alert in ctx.rows("mobile_admin_alerts"):
        complaint = complaints.get(alert["complaint_id"])
        if complaint is None or alert["status"] == "RESOLVED":
            continue
        policy = policies.get(alert.get("category_id")) or {}
        work = _work_order(ctx, complaint["id"])
        tenant = users.get(work.get("tenant_user_id")) if work else None
        snapshot = alert.get("threshold_snapshot") or {}
        meta = alert.get("metadata") or {}
        complaint_meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
        mobile = complaint_meta.get("mobile") if isinstance(complaint_meta.get("mobile"), dict) else {}
        photos = mobile.get("photos")
        listed.append({
            "id": alert["id"],
            "complaintId": alert["complaint_id"],
            "categoryId": alert.get("category_id"),
            "categoryName": policy.get("name") or "Complaint",
            "routingTeam": meta.get("routingTeam") or policy.get("routing_team") or "Housing Resolution Team",
            "severity": alert["severity"],
            "status": alert["status"],
            "title": alert["title"],
            "reason": alert["reason"],
            "address": meta.get("address"),
            "area": meta.get("area"),
            "daysOpen": int(snapshot.get("daysOpen") if snapshot.get("daysOpen") is not None else 0),
            # coalesce(... ::integer, 1): a stored 0 stays 0.
            "propertyOpenComplaints": _count_or_one(snapshot.get("propertyOpenComplaints")),
            "ownerOpenComplaints": _count_or_one(snapshot.get("ownerOpenComplaints")),
            "affectedTenants": _count_or_one(snapshot.get("propertyOpenComplaints")),
            "photoCount": len(photos) if isinstance(photos, list) else 0,
            "documentsVerified": bool(tenant and tenant.get("verification_status") == "APPROVED"),
            "createdAt": _iso(alert["created_at"]),
            "updatedAt": _iso(alert["updated_at"]),
            "escalatedAt": _iso(alert.get("escalated_at")),
            "escalationNote": alert.get("escalation_note"),
        })
    listed.sort(key=lambda item: _moment(item["updatedAt"]), reverse=True)
    listed.sort(key=lambda item: (STATUS_ORDER.get(item["status"], 3), 0 if item["severity"] == "CRITICAL" else 1))
    return listed


@rpc("mobile_admin_escalate_alert")
def mobile_admin_escalate_alert(ctx, params):
    admin = _require_admin(ctx)
    alert = next((row for row in ctx.rows("mobile_admin_alerts")
                  if row["id"] == params["p_alert_id"] and row["status"] != "RESOLVED"), None)
    if alert is None:
        raise api_error("P0002", "This alert is no longer available.")
    if alert["severity"] != "CRITICAL":
        raise api_error("22023", "Only critical alerts can be referred to the Housing Portal for NCAT preparation.")
    first_referral = alert["status"] != "ESCALATED"
    now = ctx.now()
    note = _nullif_empty(_trim(params.get("p_note") or "")[:500])
    alert = ctx.table("mobile_admin_alerts").update({
        "status": "ESCALATED",
        "escalated_at": alert.get("escalated_at") or now,
        "escalated_by": admin,
        "escalation_note": note,
        "updated_at": now,
    }).eq("id", alert["id"]).execute().data[0]

    referral = None
    complaint = _one(ctx, "complaints", id=alert["complaint_id"])
    prop = _one(ctx, "properties", id=complaint.get("property_id")) if complaint else None
    if complaint is not None and prop is not None:
        work = _work_order(ctx, complaint["id"])
        tenant = _one(ctx, "users", id=work.get("tenant_user_id")) if work else None
        owner = _one(ctx, "users", id=prop.get("owner_user_id"))
        policy = _one(ctx, "mobile_admin_issue_categories", id=alert.get("category_id")) or {}
        team = (alert.get("metadata") or {}).get("routingTeam") or policy.get("routing_team") or "Housing Resolution Team"
        meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
        mobile = meta.get("mobile") if isinstance(meta.get("mobile"), dict) else {}
        events = sorted((event for event in ctx.rows("complaint_events") if event["complaint_id"] == complaint["id"]),
                        key=lambda event: _moment(event["created_at"]))
        values = {
            "assigned_team": team,
            "prepared_snapshot": {
                "caseReference": "TV-" + alert["id"].replace("-", "")[:10].upper(),
                "complaint": {
                    "id": complaint["id"], "title": alert["title"], "description": complaint["description"],
                    "category": complaint["category"], "severity": complaint["severity"],
                    "status": complaint["status"], "lodgedAt": _iso(complaint["lodged_at"]),
                },
                "property": {
                    "id": prop["id"],
                    "address": _concat_ws(", ", prop.get("address_line_1"), prop.get("suburb"), prop.get("state"),
                                          prop.get("postcode")),
                    "area": _nullif_empty(prop.get("suburb")) or prop.get("state"),
                },
                "parties": {
                    "tenantId": work.get("tenant_user_id") if work else None,
                    "tenantName": (_nullif_empty(tenant.get("full_name")) or tenant.get("email")) if tenant else None,
                    "ownerId": prop.get("owner_user_id"),
                    "ownerName": (_nullif_empty(owner.get("full_name")) or owner.get("email")) if owner else None,
                },
                "routingTeam": team,
                "preparedAt": now,
            },
            "evidence_snapshot": {
                "triggerReason": alert["reason"],
                "thresholds": alert["threshold_snapshot"],
                "photos": mobile.get("photos") if isinstance(mobile.get("photos"), list) else [],
                "documentsVerified": bool(tenant and tenant.get("verification_status") == "APPROVED"),
                "workOrderStatus": work.get("status") if work else None,
                "complaintEvents": [
                    {key: value for key, value in {"type": event["event_type"], "note": event.get("note"),
                                                   "createdAt": _iso(event["created_at"])}.items() if value is not None}
                    for event in events
                ],
            },
            "admin_note": note,
            "updated_at": now,
        }
        existing = _one(ctx, "mobile_admin_referral_packages", alert_id=alert["id"])
        if existing is None:
            referral = ctx.table("mobile_admin_referral_packages").insert({
                "alert_id": alert["id"], "complaint_id": complaint["id"], "referred_by": admin,
                "referred_at": alert.get("escalated_at") or now, **values,
            }).execute().data[0]
        else:
            referral = ctx.table("mobile_admin_referral_packages").update(values).eq("id", existing["id"]) \
                .execute().data[0]

    if first_referral:
        officers = [user for user in ctx.rows("users") if user.get("primary_role") == "REGULATOR"
                    and user.get("status") == "ACTIVE" and user.get("deleted_at") is None]
        if officers:
            ctx.table("notifications").insert([{
                "id": str(uuid.uuid4()), "user_id": user["id"], "title": "Critical case referred to Housing Portal",
                "body": f"{alert['title']} · {(alert.get('metadata') or {}).get('area') or 'NSW'}"[:500],
                "category": "system", "link": "/housing/red-flags", "is_read": False, "created_at": now,
            } for user in officers]).execute()

    _log_action(ctx, admin, "ESCALATE_ALERT", "red_flag_alert", alert["id"],
                "Referred a critical case and evidence package to the Housing Portal for regulatory review.",
                {"complaintId": alert["complaint_id"], "referralId": referral["id"] if referral else None,
                 "note": alert.get("escalation_note")})
    return {
        "id": alert["id"],
        "status": alert["status"],
        "escalatedAt": _iso(alert.get("escalated_at")),
        "escalationNote": alert.get("escalation_note"),
        "housingPortalStatus": referral["status"] if referral else None,
        "caseReference": (referral["prepared_snapshot"] or {}).get("caseReference") if referral else None,
    }
