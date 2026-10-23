"""Complaint categories, and the admins' alert policies (tracker R38).

complaints.category holds a fixed code, not one admins manage:

- a general complaint's, which create_general_complaint checks (GENERAL):
  PROPERTY_CONDITION, LANDLORD_CONDUCT, SAFETY, PRIVACY and OTHER. The
  complaint forms list these (GET /complaint-categories), and every web
  complaint, general or about a member, takes one;
- a repair's (services/maintenance.py), named as mobile_repair_category_label
  names them (REPAIR): PLUMBING, ELECTRICAL, HVAC, APPLIANCE, LOCKS_SECURITY,
  LEAK, SAFETY and GENERAL.

Codes compare without case. A value the web stored before these codes
(safety, maintenance, harassment, other, in lower case) keeps a readable name.

mobile_admin_issue_categories are not complaint categories: each row is an
alert policy. It covers the complaints whose category is one of its
source_categories, or whose description holds one of its keywords, and
mobile_admin_refresh_alerts raises an admin alert (services/admin_alerts.py)
for an unresolved complaint it covers once the complaint passes the policy's
response time (sla_hours) or repeats at a property or owner. Admins list,
save and switch policies through the mobile functions, run as the admin
(user_client): mobile_admin_issue_categories, mobile_admin_save_issue_category
(severity NORMAL, HIGH, URGENT or CRITICAL, sla_hours 1 to 2160, the code
derived from the name, the name's words as keywords when none are given)
and mobile_admin_toggle_issue_category, which record each change in
mobile_admin_audit_entries themselves. The save function does not write
source_categories, so the web sets the codes a policy covers itself, from
the codes above.
"""

import re
import uuid

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client, user_client
from app.services import admin_audit, audit
from app.services.maps_messaging import is_uuid, moment
from app.services.shared_map import stamp_insert, stamp_update

# (code, name, what it is for): what create_general_complaint accepts.
GENERAL = (
    ("PROPERTY_CONDITION", "Property condition",
     "Damage, damp, mould, pests or a repair that has not been made."),
    ("LANDLORD_CONDUCT", "Landlord conduct",
     "Threats, harassment, discrimination, or entry without proper notice."),
    ("SAFETY", "Safety", "A risk to health or safety, such as a smoke alarm, gas, wiring or a broken lock."),
    ("PRIVACY", "Privacy", "Personal information shared or used without consent, or surveillance."),
    ("OTHER", "Other", "Anything else about the tenancy."),
)
# A repair's codes, with mobile_repair_category_label's names.
REPAIR = (
    ("PLUMBING", "Plumbing"),
    ("ELECTRICAL", "Electrical"),
    ("HVAC", "Heating & Cooling"),
    ("APPLIANCE", "Appliance"),
    ("LOCKS_SECURITY", "Locks / Security"),
    ("LEAK", "Leak"),
    ("SAFETY", "Safety"),
    ("GENERAL", "General"),
)
GENERAL_CODES = tuple(code for code, _, _ in GENERAL)
# Every code a policy can cover, each once, the general ones first.
CODES = tuple(dict.fromkeys([*GENERAL_CODES, *(code for code, _ in REPAIR)]))
NAMES = {code: name for code, name in REPAIR} | {code: name for code, name, _ in GENERAL}
FALLBACK_CODE = "OTHER"

TABLE = "mobile_admin_issue_categories"
# The policy severities mobile_admin_save_issue_category accepts.
POLICY_SEVERITIES = ("NORMAL", "HIGH", "URGENT", "CRITICAL")
DEFAULT_ROUTING_TEAM = "Complaint Resolution Team"
# not_null_violation: what mobile_admin_save_issue_category's insert raises when
# source_categories has no default (save_policy; whether it has one is unknown).
NOT_NULL = "23502"

SAVED = "issue_category.saved"
CODES_CHANGED = "issue_category.codes_changed"
ACTIVATED = "issue_category.activated"
DEACTIVATED = "issue_category.deactivated"
ENTITY = "issue_category"

NOT_FOUND = "Alert policy not found"
NOT_OFFERED = "Choose one of the complaint categories on the form."
CHANGED = "This policy changed while you were editing it. Reload it and try again."
UNKNOWN_CODE = "Choose complaint categories from the list."

# What a shared function's error means for the request (docs/shared-db.md).
RPC_STATUS = {
    "42501": status.HTTP_403_FORBIDDEN,
    "P0002": status.HTTP_404_NOT_FOUND,
    "23505": status.HTTP_409_CONFLICT,
    "22023": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "23514": status.HTTP_422_UNPROCESSABLE_ENTITY,
}


def run_rpc(query):
    """query.execute().data; a function's refusal as its HTTP answer, with the function's own words."""
    try:
        return query.execute().data
    except APIError as exc:
        code = getattr(exc, "code", None)
        if code in RPC_STATUS:
            raise HTTPException(RPC_STATUS[code], exc.message or "The request was refused.") from exc
        raise


def key(value) -> str:
    """How a code or a stored complaints.category compares: trimmed, single-spaced, lower case."""
    return " ".join(str(value or "").split()).lower()


GENERAL_BY_KEY = {key(code): (code, name, description) for code, name, description in GENERAL}
CODE_BY_KEY = {key(code): code for code in CODES}


def form_categories() -> list[dict]:
    """GET /complaint-categories: the general categories, in the order the forms show them, Other last."""
    return [{"code": code, "name": name, "description": description} for code, name, description in GENERAL]


def for_new_complaint(value) -> str:
    """The general code a complaint names (any case); 422 for anything else."""
    found = GENERAL_BY_KEY.get(key(value) or key(FALLBACK_CODE))
    if found is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NOT_OFFERED)
    return found[0]


def _humanised(value: str) -> str:
    text = " ".join(str(value).replace("_", " ").split())
    return text[:1].upper() + text[1:].lower() if text else "Other"


class Labels:
    """A stored complaints.category as {code, label, active}: active while the complaint forms offer it.

    A value no code matches keeps its own text, with a readable name.
    """

    def category(self, stored) -> dict:
        value_key = key(stored) or key(FALLBACK_CODE)
        code = CODE_BY_KEY.get(value_key)
        if code:
            return {"code": code, "label": NAMES[code], "active": code in GENERAL_CODES}
        text = " ".join(str(stored).split())
        return {"code": text, "label": _humanised(text), "active": False}


def code_choices() -> list[dict]:
    """The codes a policy can cover, with their names and whether a general complaint or a repair uses them."""
    repair = {code for code, _ in REPAIR}
    return [
        {"code": code, "label": NAMES[code],
         "kind": "both" if code in GENERAL_CODES and code in repair else "general" if code in GENERAL_CODES
         else "repair"}
        for code in CODES
    ]


# ---------------------------------------------------------------------------
# Alert policies (mobile_admin_issue_categories)
# ---------------------------------------------------------------------------
def policy_out(item: dict) -> dict:
    """IssueCategoryOut from a policy as the mobile functions return it."""
    return {
        "id": item["id"],
        "code": item.get("code"),
        "name": item.get("name"),
        "description": item.get("description") or "",
        "severity": item.get("severity"),
        "severity_label": item.get("severityLabel"),
        "sla_hours": item.get("slaHours"),
        "routing_team": item.get("routingTeam"),
        "source_categories": list(item.get("sourceCategories") or []),
        "keywords": list(item.get("keywords") or []),
        "is_active": bool(item.get("isActive")),
        "complaint_count": item.get("complaintCount"),
        "updated_at": item.get("updatedAt"),
    }


def _row_json(row: dict) -> dict:
    """A table row in the shape the mobile functions return a policy."""
    return {
        "id": row["id"], "code": row["code"], "name": row["name"], "description": row.get("description"),
        "severity": row.get("severity"), "severityLabel": str(row.get("severity") or "").capitalize() or None,
        "slaHours": row.get("sla_hours"), "routingTeam": row.get("routing_team"),
        "sourceCategories": row.get("source_categories"), "keywords": row.get("keywords"),
        "isActive": row.get("is_active"), "complaintCount": None, "updatedAt": row.get("updated_at"),
    }


def policies(access_token: str) -> list[dict]:
    """Every policy, active ones first, with the complaints each covers (mobile_admin_issue_categories)."""
    found = run_rpc(user_client(access_token).rpc("mobile_admin_issue_categories", {}))
    return [policy_out(item) for item in (found if isinstance(found, list) else [])]


def _get(category_id: str) -> dict:
    found = (
        get_supabase_client().table(TABLE).select("*").eq("id", category_id).limit(1).execute().data
        if is_uuid(category_id) else []
    )
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return found[0]


def _codes(values: list[str] | None) -> list[str]:
    """Codes a policy covers, upper case, each once, in CODES order; 422 for one not in CODES."""
    given = {key(value) for value in values or [] if key(value)}
    unknown = given - set(CODE_BY_KEY)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, UNKNOWN_CODE)
    return [code for code in CODES if key(code) in given]


EDITABLE = ("name", "description", "severity", "sla_hours", "routing_team", "source_categories", "keywords")


def _payload(fields: dict) -> dict:
    """p_payload for mobile_admin_save_issue_category."""
    return {
        "name": fields["name"],
        "description": fields.get("description") or "",
        "severity": fields["severity"],
        "routingTeam": fields.get("routing_team") or DEFAULT_ROUTING_TEAM,
        "slaHours": fields["sla_hours"],
        "keywords": list(fields.get("keywords") or []),
    }


def _new_code(name: str) -> str:
    """The code mobile_admin_save_issue_category gives a new policy: its name in snake case, made unique."""
    code = re.sub(r"[^A-Za-z0-9]+", "_", name).lower().strip("_")
    taken = get_supabase_client().table(TABLE).select("id").eq("code", code).limit(1).execute().data
    return f"{code}_{uuid.uuid4().hex[:6]}" if taken else code


def _insert_policy(admin_id: str, fields: dict) -> dict:
    """A new policy row as the save function would insert it, covering no codes yet (_set_codes writes them)."""
    row = {
        "code": _new_code(" ".join(str(fields["name"]).split())),
        "name": " ".join(str(fields["name"]).split()),
        "description": (fields.get("description") or "").strip(),
        "severity": fields["severity"],
        "sla_hours": fields["sla_hours"],
        "routing_team": (fields.get("routing_team") or DEFAULT_ROUTING_TEAM).strip(),
        "source_categories": [],
        "keywords": [],
        "created_by": admin_id,
        "updated_by": admin_id,
    }
    return get_supabase_client().table(TABLE).insert(stamp_insert(TABLE, row)).execute().data[0]


def _set_codes(admin_id: str, row: dict, codes: list[str]) -> dict:
    """Write the codes a policy covers, which the save function leaves alone; the row after.

    Values another app stored that are not codes here are kept after them.
    """
    before = list(row.get("source_categories") or [])
    codes = [*codes, *(value for value in before if key(value) not in CODE_BY_KEY)]
    if before == codes:
        return row
    updated = (
        get_supabase_client().table(TABLE)
        .update(stamp_update(TABLE, {"source_categories": codes, "updated_by": admin_id}))
        .eq("id", row["id"]).execute().data
    )
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    admin_audit.record(
        admin_id, CODES_CHANGED, ENTITY, row["id"],
        f"Set the complaint categories the alert policy {row['name']} covers: {', '.join(codes) or 'none'}",
        {"code": row["code"], "before": before, "after": codes},
    )
    return updated[0]


def save_policy(current, category_id: str | None, fields: dict, seen_version=None) -> dict:
    """Create a policy (category_id None) or change one, through mobile_admin_save_issue_category.

    An edit applies only to the version the admin read (409 otherwise). The
    function checks the fields and records the save in the shared admin log;
    the codes the policy covers are written after it, when they change.
    """
    # Only codes the admin sent are checked and written: a policy may hold another app's values.
    codes = _codes(fields.get("source_categories")) if fields.get("source_categories") is not None else None
    if category_id is not None:
        current_row = _get(category_id)
        seen = moment(seen_version)
        if seen is None or moment(current_row.get("updated_at")) != seen:
            raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
        # The function saves every field: a field left out keeps its value.
        fields = {field: current_row.get(field) if fields.get(field) is None else fields[field] for field in EDITABLE}
    def save(policy_id: str | None):
        return run_rpc(user_client(current.access_token).rpc(
            "mobile_admin_save_issue_category", {"p_category_id": policy_id, "p_payload": _payload(fields)},
        ))

    try:
        saved = save(category_id)
    except APIError as exc:
        if category_id is not None or str(exc.code) != NOT_NULL:
            raise
        # The function's insert leaves out source_categories, which is NOT NULL, and failed for want of a
        # default: the web inserts the row it would, then saves it through the function as an edit, which
        # checks and logs it.
        created = _insert_policy(current.id, fields)
        try:
            saved = save(created["id"])
        except Exception:
            get_supabase_client().table(TABLE).delete().eq("id", created["id"]).execute()
            raise
    if not isinstance(saved, dict) or not saved.get("id"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The policy was not saved. Please try again.")
    audit.record(current.id, SAVED, ENTITY, saved["id"], {
        "code": saved.get("code"), "name": saved.get("name"), "severity": saved.get("severity"),
        "sla_hours": saved.get("slaHours"), "created": category_id is None,
    })
    if codes is None:
        return policy_out(saved) | {"complaint_count": None}
    return policy_out(_row_json(_set_codes(current.id, _get(saved["id"]), codes)))


def set_active(current, category_id: str, is_active: bool, reason: str | None) -> dict:
    """Switch a policy on or off through mobile_admin_toggle_issue_category; nothing changes when it already is."""
    row = _get(category_id)
    if bool(row.get("is_active")) == is_active:
        return policy_out(_row_json(row))
    run_rpc(user_client(current.access_token).rpc(
        "mobile_admin_toggle_issue_category", {"p_category_id": category_id, "p_is_active": is_active},
    ))
    reason = " ".join((reason or "").split()) or None
    audit.record(current.id, ACTIVATED if is_active else DEACTIVATED, ENTITY, category_id,
                 {"code": row["code"], "is_active": is_active, "reason": reason})
    return policy_out(_row_json(_get(category_id)))
