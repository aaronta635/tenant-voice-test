"""Repairs as the admin console handles them (tracker R40; docs/shared-db.md, "Complaints and moderation").

Every repair, a maintenance_work_orders row and the complaint it hangs off
(services/maintenance.py), with filters, and an admin's decision to cancel
or close one, always with a reason. The parties' repair routes refuse an
admin (maintenance.set_status), so this is how one moves a repair: its case
and work order are written as maintenance.set_status writes them, and only
while the work order still has the status the admin saw. The step goes into
the case timeline (complaint_events) with the reason, the decision into
both audit logs (admin_audit), and the tenant, the owner and the assigned
provider are told why.
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.services import admin_audit, notifications
from app.services import complaints as complaints_service
from app.services._common import select_all, select_in
from app.services.maintenance import UNBOOKED_STATUSES
from app.services.maps_messaging import is_uuid, moment
from app.services.maps_reviews_complaints import EVENT_STATUS_CHANGED, REPAIR_TO_COMPLAINT_STATUS
from app.services.shared_map import flatten_maintenance, stamp_update, web_role

TABLE = "maintenance_work_orders"
COMPLAINTS = complaints_service.TABLE
ENTRIES = admin_audit.ENTRIES
STATUS_CHANGED = "repair.status_changed"
ENTITY = "repair"
# A work order with the case fields the list shows, and those a decision writes back if it must.
SELECT = "*, complaints(category, description, severity, metadata, against_user_id, status, resolved_at)"
OPEN_STATUSES = ("open", "in_progress")
# Each decision: the web status it moves a repair to, and its name in the logs and notices.
DECISIONS = {"cancel": ("cancelled", "cancelled"), "close": ("resolved", "closed")}
# The only end state maintenance_work_orders.status allows (its CHECK); the case's
# CLOSED or RESOLVED and the decision in the logs say which one it was.
CLOSED_WORK_STATUS = "RESOLVED"
# Where each party follows their repairs; the notices link there.
REPAIRS_PATHS = {"tenant": "/tenant/maintenance", "owner": "/owner/maintenance", "provider": "/dashboard/repairs"}

NOT_FOUND = "Repair not found"
CHANGED = "This repair changed while you were looking at it. Reload the list and try again."
CLOSED_ALREADY = "This repair is closed already."


def _db():
    return get_supabase_client()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _work_status(row: dict) -> str:
    return str(row.get("status") or "OPEN")


def _owner_id(row: dict) -> str | None:
    return row.get("landlord_user_id") or (row.get("complaints") or {}).get("against_user_id")


def _people(user_ids) -> dict[str, dict]:
    user_ids = [user_id for user_id in set(user_ids) if user_id]
    if not user_ids:
        return {}
    rows = select_in(lambda: _db().table("users").select("id, full_name, email, primary_role").order("id"), "id",
                     user_ids)
    return {row["id"]: row for row in rows}


def _party(user_id: str | None, people: dict[str, dict]) -> dict | None:
    if not user_id:
        return None
    person = people.get(user_id) or {}
    return {
        "id": user_id,
        "full_name": person.get("full_name") or person.get("email"),
        "role": web_role(person.get("primary_role")) if person else None,
    }


def _listings(listing_ids) -> dict[str, dict]:
    listing_ids = [listing_id for listing_id in set(listing_ids) if listing_id]
    if not listing_ids:
        return {}
    rows = select_in(lambda: _db().table("listings").select("id, title, properties(suburb, state)").order("id"), "id",
                     listing_ids)
    return {row["id"]: row for row in rows}


def _decisions(repair_ids: list[str]) -> dict[str, dict]:
    """The newest admin decision on each repair, from the shared admin log."""
    if not repair_ids:
        return {}
    entries = select_in(
        lambda: _db().table(ENTRIES).select("id, actor_user_id, entity_id, metadata, created_at")
        .eq("entity_type", ENTITY).eq("action", STATUS_CHANGED).order("created_at").order("id"),
        "entity_id", repair_ids,
    )
    newest: dict[str, dict] = {}
    for entry in sorted(entries, key=lambda entry: (moment(entry.get("created_at")), entry["id"])):
        newest[entry["entity_id"]] = entry
    return newest


def _items(rows: list[dict]) -> list[dict]:
    """AdminRepairOut for work orders selected with SELECT: the case, the place and the people behind each."""
    listings = _listings(row.get("listing_id") for row in rows)
    decisions = _decisions([row["id"] for row in rows])
    people = _people(
        [person for row in rows for person in (row.get("tenant_user_id"), _owner_id(row), row.get("assigned_worker_id"))]
        + [entry.get("actor_user_id") for entry in decisions.values()]
    )
    items = []
    for row in rows:
        request = flatten_maintenance(row)
        listing = listings.get(row.get("listing_id")) or {}
        place = listing.get("properties") if isinstance(listing.get("properties"), dict) else {}
        booked = bool(row.get("appointment_at")) and _work_status(row).upper() not in UNBOOKED_STATUSES
        decision = decisions.get(row["id"])
        meta = decision.get("metadata") if decision and isinstance(decision.get("metadata"), dict) else {}
        items.append({
            "id": row["id"],
            "title": request["title"],
            "description": request["description"],
            "category": request["category"],
            "priority": request["priority"],
            "status": request["status"],
            "work_status": _work_status(row),
            "property_title": listing.get("title"),
            "area": ", ".join(part for part in (place.get("suburb"), place.get("state")) if part) or None,
            "tenant": _party(row.get("tenant_user_id"), people),
            "owner": _party(_owner_id(row), people),
            "provider": _party(row.get("assigned_worker_id"), people),
            "appointment_at": row.get("appointment_at") if booked else None,
            "resolution_note": request["resolution_note"],
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "resolved_at": request["resolved_at"],
            "actions": list(DECISIONS) if request["status"] in OPEN_STATUSES else [],
            "last_decision": {
                "decision": meta.get("decision"),
                "reason": meta.get("reason"),
                "actor": _party(decision.get("actor_user_id"), people),
                "created_at": decision["created_at"],
            } if decision else None,
        })
    return items


def _matches(row: dict, repair_status: str | None, priority: str | None, needle: str | None) -> bool:
    request = flatten_maintenance(row)
    if repair_status and request["status"] != repair_status:
        return False
    if priority and request["priority"] != priority:
        return False
    return not needle or needle in f"{request['title']}\n{request['description']}".casefold()


def repair_queue(repair_status: str | None = None, priority: str | None = None, q: str | None = None,
                 limit: int = 20, offset: int = 0) -> dict:
    """AdminRepairPageOut: one page of repairs, newest first, with the total that match.

    The statuses and priorities are read from the rows as the parties' pages
    read them (stored values vary in case and spelling), so the page is cut
    from every repair that matched; the search looks in the title and the
    description.
    """
    needle = " ".join((q or "").split()).casefold() or None
    rows = select_all(lambda: _db().table(TABLE).select(SELECT).order("created_at", desc=True).order("id"))
    rows = [row for row in rows if _matches(row, repair_status, priority, needle)]
    return {"items": _items(rows[offset:offset + limit]), "total": len(rows), "limit": limit, "offset": offset}


def _row(repair_id: str) -> dict:
    found = _db().table(TABLE).select(SELECT).eq("id", repair_id).limit(1).execute().data if is_uuid(repair_id) else []
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return found[0]


def decide(admin_id: str, repair_id: str, action: str, reason: str, seen_status: str | None) -> dict:
    """Cancel or close a repair with a reason the tenant, owner and provider are told; the repair as the list shows it.

    The case goes first, then the work order (CLOSED_WORK_STATUS); each only
    while it still has the status read, and the work order the one the admin
    saw (409 otherwise). If the work order's write finds it moved on, the
    case goes back as it was, unless something wrote it since.
    """
    row = _row(repair_id)
    request = flatten_maintenance(row)
    current = _work_status(row)
    if seen_status is not None and seen_status != current:
        raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
    if request["status"] not in OPEN_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, CLOSED_ALREADY)
    new_status, decision = DECISIONS[action]
    now = _now()
    case = row.get("complaints") if isinstance(row.get("complaints"), dict) else {}
    closed = {"status": REPAIR_TO_COMPLAINT_STATUS[new_status], "resolved_at": now.isoformat()}
    wrote_case = (
        _db().table(COMPLAINTS).update(stamp_update(COMPLAINTS, closed, now))
        .eq("id", row["complaint_id"]).eq("status", case.get("status") or "OPEN").execute().data
    )
    if not wrote_case:
        # The tenant withdrew it, say, since the admin's read.
        raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
    changes = {"status": CLOSED_WORK_STATUS, "completed_at": now.isoformat(), "completion_note": reason}
    updated = (
        _db().table(TABLE).update(stamp_update(TABLE, changes, now))
        .eq("id", repair_id).eq("status", row.get("status")).execute().data
    )
    if not updated:
        (
            _db().table(COMPLAINTS)
            .update(stamp_update(COMPLAINTS, {"status": case.get("status") or "OPEN", "resolved_at": case.get("resolved_at")},
                                 now))
            .eq("id", row["complaint_id"]).eq("status", closed["status"]).eq("resolved_at", closed["resolved_at"])
            .execute()
        )
        raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)

    complaints_service.record_event(
        row["complaint_id"], admin_id, EVENT_STATUS_CHANGED, reason,
        work_order_id=repair_id, from_status=request["status"], to_status=new_status, decision=decision,
    )
    tenant_id, owner_id, provider_id = row.get("tenant_user_id"), _owner_id(row), row.get("assigned_worker_id")
    admin_audit.record(
        admin_id, STATUS_CHANGED, ENTITY, repair_id,
        f"{decision.capitalize()} the repair “{request['title']}”: {reason}",
        {"decision": decision, "from_status": request["status"], "to_status": new_status, "reason": reason,
         "complaint_id": row["complaint_id"], "tenant_id": tenant_id, "owner_id": owner_id, "provider_id": provider_id},
    )
    told = set()
    for person, side in ((tenant_id, "tenant"), (owner_id, "owner"), (provider_id, "provider")):
        if person and person not in told and person != admin_id:
            told.add(person)
            notifications.notify(person, "property", f"Repair {decision}: {request['title']}",
                                 f"A TenantVoice admin {decision} it. Reason: {reason}", REPAIRS_PATHS[side])
    return _items([{**updated[0], "complaints": {**case, **closed}}])[0]
