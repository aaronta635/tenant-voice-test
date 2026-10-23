"""Red flags: the admins' rules and the flags they raised (tracker R39).

The database does the counting. Every complaints insert fires
evaluate_complaint_red_flags, which runs evaluate_red_flag_rule_for_property
for each active red_flag_rules row: a rule counts the complaints about the
property, all of them (TOTAL) or those lodged in the last window_days days
(WINDOW), and at threshold_count it opens one red_flag_events row (OPEN, with
the count in evidence) and notifies every admin, unless the rule already has
an OPEN or ACKNOWLEDGED flag for that property. So the web never evaluates a
new complaint itself; "re-evaluate now" runs evaluate_red_flag_rule for one
rule over every property, after a rule changed. The shared function counts
every complaint about a property, whatever its category.

Here admins manage the rules (direct writes: rule_key, unique, comes from
the name; threshold 1 to 10000; window 1 to 3650 days) and decide the
flags: acknowledge (OPEN to ACKNOWLEDGED), resolve or dismiss (from OPEN or
ACKNOWLEDGED, setting resolved_at). red_flag_events has no column for who
decided or why, so each decision is appended to evidence.decisions (actor,
time, note), beside the evidence the database recorded, which stays as it
was. A rule that raised a flag is never deleted (its flags would go with it,
ON DELETE CASCADE): deactivate it instead. Each change is in both audit
logs (admin_audit).
"""

import re
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.services import admin_audit
from app.services._common import select_all, select_in
from app.services.complaint_categories import Labels, run_rpc
from app.services.maps_messaging import is_uuid, moment
from app.services.shared_map import stamp_insert, stamp_update

RULES = "red_flag_rules"
EVENTS = "red_flag_events"
TRIGGER_MODES = ("TOTAL", "WINDOW")
SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
EVENT_STATUSES = ("OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED")
ACTIVE = ("OPEN", "ACKNOWLEDGED")
# action: (the status it sets, the statuses it applies to, whether a note is required)
ACTIONS = {
    "acknowledge": ("ACKNOWLEDGED", ("OPEN",), False),
    "resolve": ("RESOLVED", ACTIVE, True),
    "dismiss": ("DISMISSED", ACTIVE, True),
}
PAST_TENSE = {"acknowledge": "acknowledged", "resolve": "resolved", "dismiss": "dismissed"}

RULE_ENTITY = "red_flag_rule"
EVENT_ENTITY = "red_flag_event"

RULE_NOT_FOUND = "Red-flag rule not found"
EVENT_NOT_FOUND = "Red flag not found"
RULE_CHANGED = "This rule changed while you were editing it. Reload it and try again."
RULE_EXISTS = "A rule of this name already exists. Edit that rule, or give this one another name."
EVENT_CHANGED = "This flag changed while you were looking at it. Reload it and try again."
KEEPS_FLAGS = "This rule has raised flags, and deleting it would delete them and their evidence. Deactivate it instead."
INACTIVE = "Activate the rule first: an inactive rule raises no flags."
NOTE_NEEDED = "Write a note: it is kept with the flag."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rules():
    return get_supabase_client().table(RULES)


def _events():
    return get_supabase_client().table(EVENTS)


def _text(value: str | None) -> str:
    return " ".join((value or "").split())


def _rule_key(name: str, taken: set[str]) -> str:
    """A rule_key from the name (lower case, underscores), unique among the keys taken."""
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:60] or "rule"
    candidate, number = base, 2
    while candidate in taken:
        candidate = f"{base[:56]}_{number}"
        number += 1
    return candidate


def _get_rule(rule_id: str) -> dict:
    found = _rules().select("*").eq("id", rule_id).limit(1).execute().data if is_uuid(rule_id) else []
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, RULE_NOT_FOUND)
    return found[0]


def _flag_counts(rule_ids: list[str]) -> dict[str, dict]:
    rows = select_in(lambda: _events().select("id, rule_id, status").order("id"), "rule_id", rule_ids)
    counts: dict[str, dict] = {rule_id: {"active": 0, "total": 0} for rule_id in rule_ids}
    for row in rows:
        counted = counts.setdefault(row["rule_id"], {"active": 0, "total": 0})
        counted["total"] += 1
        counted["active"] += row.get("status") in ACTIVE
    return counts


def rule_out(row: dict, counts: dict | None = None) -> dict:
    """RedFlagRuleOut."""
    counted = counts or {}
    return {
        "id": row["id"],
        "rule_key": row["rule_key"],
        "name": row["name"],
        "description": row.get("description") or "",
        "threshold_count": row["threshold_count"],
        "trigger_mode": row["trigger_mode"],
        "window_days": row["window_days"],
        "severity": row["severity"],
        "is_active": bool(row.get("is_active")),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "active_flags": counted.get("active", 0),
        "total_flags": counted.get("total", 0),
    }


def list_rules() -> list[dict]:
    """Every rule, active ones first, by name, with how many flags each raised and how many are still open."""
    rows = select_all(lambda: _rules().select("*").order("name").order("id"))
    counts = _flag_counts([row["id"] for row in rows])
    rows.sort(key=lambda row: not row.get("is_active"))
    return [rule_out(row, counts.get(row["id"])) for row in rows]


def _check_window(trigger_mode: str, window_days: int | None) -> None:
    if trigger_mode == "WINDOW" and window_days is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the window in days, from 1 to 3650.")


def _summary(row: dict) -> str:
    when = "in total" if row["trigger_mode"] == "TOTAL" else f"within {row['window_days']} days"
    return f"{row['name']}: {row['threshold_count']} complaints about a property {when}"


def create_rule(admin_id: str, payload: dict) -> dict:
    """A new rule, active unless told otherwise; its rule_key comes from its name."""
    name = _text(payload["name"])
    if len(name) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the rule a name of at least 3 characters.")
    _check_window(payload["trigger_mode"], payload.get("window_days"))
    existing = select_all(lambda: _rules().select("id, rule_key, name").order("id"))
    # A second rule of one name would raise a second flag, and notice, for every breach: a retried
    # request finds the first. (Two at once share a rule_key, which red_flag_rules_rule_key_key refuses.)
    if any(_text(row.get("name")).casefold() == name.casefold() for row in existing):
        raise HTTPException(status.HTTP_409_CONFLICT, RULE_EXISTS)
    taken = {row["rule_key"] for row in existing}
    row = stamp_insert(RULES, {
        "rule_key": _rule_key(name, taken),
        "name": name,
        "description": _text(payload.get("description")) or None,
        "threshold_count": payload["threshold_count"],
        "trigger_mode": payload["trigger_mode"],
        # NOT NULL: a TOTAL rule keeps the column's default, which a switch to WINDOW starts from.
        "window_days": payload.get("window_days") or 30,
        "severity": payload["severity"],
        "is_active": payload.get("is_active", True),
    })
    created = _rules().insert(row).execute().data[0]
    admin_audit.record(admin_id, "red_flag_rule.created", RULE_ENTITY, created["id"], f"Created the red-flag rule {_summary(created)}",
                       {key: created[key] for key in ("rule_key", "threshold_count", "trigger_mode", "window_days",
                                                      "severity", "is_active")})
    return rule_out(created)


EDITABLE = ("name", "description", "threshold_count", "trigger_mode", "window_days", "severity")


def update_rule(admin_id: str, rule_id: str, payload: dict, seen_version) -> dict:
    """Change a rule's fields, never its rule_key; 409 when it changed since the admin read it."""
    current = _get_rule(rule_id)
    seen = moment(seen_version)
    if seen is None or moment(current.get("updated_at")) != seen:
        raise HTTPException(status.HTTP_409_CONFLICT, RULE_CHANGED)
    changes: dict = {}
    for field in EDITABLE:
        if payload.get(field) is None:
            continue
        value = _text(payload[field]) if field in ("name", "description") else payload[field]
        if field == "name" and len(value) < 3:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the rule a name of at least 3 characters.")
        if field == "description":
            value = value or None
        if value != current.get(field):
            changes[field] = value
    if not changes:
        return rule_out(current, _flag_counts([rule_id]).get(rule_id))
    updated = (
        _rules().update(stamp_update(RULES, changes)).eq("id", rule_id).eq("updated_at", current["updated_at"])
        .execute().data
    )
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, RULE_CHANGED)
    fields = sorted(changes)
    admin_audit.record(admin_id, "red_flag_rule.updated", RULE_ENTITY, rule_id,
                       f"Edited the red-flag rule {_summary(updated[0])}: {', '.join(fields)}",
                       {"rule_key": current["rule_key"], "fields": fields,
                        "before": {field: current.get(field) for field in fields},
                        "after": {field: updated[0].get(field) for field in fields}})
    return rule_out(updated[0], _flag_counts([rule_id]).get(rule_id))


def set_rule_active(admin_id: str, rule_id: str, is_active: bool, reason: str | None) -> dict:
    """Switch a rule on or off: an inactive rule counts no new complaints. Its flags stay."""
    current = _get_rule(rule_id)
    if bool(current.get("is_active")) == is_active:
        return rule_out(current, _flag_counts([rule_id]).get(rule_id))
    updated = (
        _rules().update(stamp_update(RULES, {"is_active": is_active})).eq("id", rule_id)
        .eq("is_active", not is_active).execute().data
    )
    if not updated:
        return rule_out(_get_rule(rule_id), _flag_counts([rule_id]).get(rule_id))
    reason = _text(reason) or None
    verb = "Activated" if is_active else "Deactivated"
    admin_audit.record(admin_id, f"red_flag_rule.{verb.lower()}", RULE_ENTITY, rule_id,
                       f"{verb} the red-flag rule {current['name']}" + (f": {reason}" if reason else ""),
                       {"rule_key": current["rule_key"], "is_active": is_active, "reason": reason})
    return rule_out(updated[0], _flag_counts([rule_id]).get(rule_id))


def delete_rule(admin_id: str, rule_id: str) -> None:
    """Delete a rule that never raised a flag; 409 for one that did."""
    current = _get_rule(rule_id)
    if _events().select("id").eq("rule_id", rule_id).limit(1).execute().data:
        raise HTTPException(status.HTTP_409_CONFLICT, KEEPS_FLAGS)
    _rules().delete().eq("id", rule_id).execute()
    admin_audit.record(admin_id, "red_flag_rule.deleted", RULE_ENTITY, rule_id,
                       f"Deleted the red-flag rule {current['name']}",
                       {key: current.get(key) for key in ("rule_key", "name", "threshold_count", "trigger_mode",
                                                          "window_days", "severity")})


def evaluate_now(admin_id: str, rule_id: str) -> dict:
    """Run one active rule over every property now (evaluate_red_flag_rule); how many flags it opened."""
    rule = _get_rule(rule_id)
    if not rule.get("is_active"):
        raise HTTPException(status.HTTP_409_CONFLICT, INACTIVE)
    evaluated_at = _now()
    created = run_rpc(get_supabase_client().rpc("evaluate_red_flag_rule", {
        "p_rule_id": rule_id, "p_evaluated_at": evaluated_at,
    }))
    created = created if isinstance(created, int) else 0
    admin_audit.record(admin_id, "red_flag_rule.evaluated", RULE_ENTITY, rule_id,
                       f"Re-evaluated the red-flag rule {rule['name']}: {created} new "
                       f"{'flag' if created == 1 else 'flags'}",
                       {"rule_key": rule["rule_key"], "created": created, "evaluated_at": evaluated_at})
    return {"rule_id": rule_id, "created": created, "evaluated_at": evaluated_at}


# ---------------------------------------------------------------------------
# Flags (red_flag_events)
# ---------------------------------------------------------------------------
def _evidence(row: dict) -> dict:
    return dict(row["evidence"]) if isinstance(row.get("evidence"), dict) else {}


def _places(property_ids) -> dict[str, dict]:
    """Each property's address and its newest listing's title."""
    property_ids = [property_id for property_id in set(property_ids) if property_id]
    if not property_ids:
        return {}
    supabase = get_supabase_client()
    places = {
        row["id"]: {
            "address": ", ".join(str(row[part]) for part in ("address_line_1", "suburb", "state", "postcode")
                                 if row.get(part)) or None,
            "owner_id": row.get("owner_user_id"),
        }
        for row in supabase.table("properties").select("id, address_line_1, suburb, state, postcode, owner_user_id")
        .in_("id", property_ids).execute().data or []
    }
    listings = (
        supabase.table("listings").select("id, title, property_id, created_at").in_("property_id", property_ids)
        .order("created_at", desc=True).execute().data or []
    )
    for listing in listings:
        place = places.get(listing["property_id"])
        if place is not None and "listing_id" not in place:
            place.update({"listing_id": listing["id"], "title": listing.get("title")})
    return places


def _names(user_ids) -> dict[str, str]:
    user_ids = [user_id for user_id in set(user_ids) if user_id]
    if not user_ids:
        return {}
    rows = get_supabase_client().table("users").select("id, full_name, email").in_("id", user_ids).execute().data or []
    return {row["id"]: row.get("full_name") or row.get("email") or "An admin" for row in rows}


def _events_out(rows: list[dict]) -> list[dict]:
    """RedFlagEventOut for red_flag_events rows."""
    rules = {}
    rule_ids = list({row["rule_id"] for row in rows})
    if rule_ids:
        rules = {row["id"]: row for row in _rules().select("id, name, rule_key, trigger_mode, window_days, threshold_count")
                 .in_("id", rule_ids).execute().data or []}
    places = _places(row.get("property_id") for row in rows)
    complaint_ids = [row["complaint_id"] for row in rows if row.get("complaint_id")]
    complaints = {}
    if complaint_ids:
        complaints = {row["id"]: row for row in get_supabase_client().table("complaints")
                      .select("id, category, status, lodged_at").in_("id", complaint_ids).execute().data or []}
    deciders = _names(decision.get("actor_user_id") for row in rows
                      for decision in (_evidence(row).get("decisions") or []) if isinstance(decision, dict))
    labels = Labels()
    items = []
    for row in rows:
        evidence = _evidence(row)
        decisions = [decision for decision in evidence.pop("decisions", None) or [] if isinstance(decision, dict)]
        rule = rules.get(row["rule_id"]) or {}
        place = places.get(row.get("property_id")) or {}
        complaint = complaints.get(row.get("complaint_id"))
        items.append({
            "id": row["id"],
            "rule_id": row["rule_id"],
            "rule_name": rule.get("name"),
            "summary": row["summary"],
            "status": row["status"],
            "triggered_at": row["triggered_at"],
            "resolved_at": row.get("resolved_at"),
            "property_id": row.get("property_id"),
            "address": place.get("address"),
            "listing_id": place.get("listing_id"),
            "property_title": place.get("title"),
            "complaint": {
                "id": complaint["id"],
                "category_label": labels.category(complaint.get("category"))["label"],
                "status": complaint.get("status"),
                "lodged_at": complaint.get("lodged_at"),
            } if complaint else None,
            "evidence": evidence,
            "decisions": [{
                "action": decision.get("action"),
                "from_status": decision.get("from_status"),
                "to_status": decision.get("to_status"),
                "actor_id": decision.get("actor_user_id"),
                "actor_name": deciders.get(decision.get("actor_user_id")),
                "note": decision.get("note"),
                "at": decision.get("at"),
            } for decision in decisions],
            "actions": [action for action, (_, applies, _) in ACTIONS.items() if row["status"] in applies],
        })
    return items


def list_events(event_status: str | None = None, rule_id: str | None = None, limit: int = 50,
                offset: int = 0) -> dict:
    """One page of flags, newest first, with the total that match."""
    if rule_id is not None and not is_uuid(rule_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, RULE_NOT_FOUND)

    def build():
        query = _events().select("*")
        if event_status:
            query = query.eq("status", event_status)
        if rule_id:
            query = query.eq("rule_id", rule_id)
        return query.order("triggered_at", desc=True).order("id")

    rows = select_all(build)
    page = rows[offset:offset + limit]
    return {"items": _events_out(page), "total": len(rows), "limit": limit, "offset": offset}


def decide(admin_id: str, event_id: str, action: str, note: str | None, seen_status: str | None) -> dict:
    """Acknowledge, resolve or dismiss a flag, with who, when and why kept in its evidence; the flag after."""
    to_status, applies, needs_note = ACTIONS[action]
    found = _events().select("*").eq("id", event_id).limit(1).execute().data if is_uuid(event_id) else []
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, EVENT_NOT_FOUND)
    row = found[0]
    current = row["status"]
    if seen_status is not None and seen_status != current:
        raise HTTPException(status.HTTP_409_CONFLICT, EVENT_CHANGED)
    if current not in applies:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A flag that is {current.lower()} cannot be {PAST_TENSE[action]}.")
    note = _text(note) or None
    if needs_note and not note:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NOTE_NEEDED)
    at = _now()
    evidence = _evidence(row)
    decisions = [decision for decision in evidence.get("decisions") or [] if isinstance(decision, dict)]
    evidence["decisions"] = [*decisions, {
        "action": PAST_TENSE[action], "from_status": current, "to_status": to_status,
        "actor_user_id": admin_id, "at": at, "note": note,
    }]
    changes = {"status": to_status, "evidence": evidence}
    if to_status in ("RESOLVED", "DISMISSED"):
        changes["resolved_at"] = at
    updated = _events().update(stamp_update(EVENTS, changes)).eq("id", event_id).eq("status", current).execute().data
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, EVENT_CHANGED)
    admin_audit.record(admin_id, f"red_flag_event.{PAST_TENSE[action]}", EVENT_ENTITY, event_id,
                       f"{PAST_TENSE[action].capitalize()} the red flag “{row['summary']}”" + (f": {note}" if note else ""),
                       {"from_status": current, "to_status": to_status, "reason": note, "rule_id": row["rule_id"],
                        "property_id": row.get("property_id")})
    return _events_out(updated)[0]
