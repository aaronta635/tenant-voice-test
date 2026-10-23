"""Stand-ins for the provider-service, repair and job-request functions the web calls.

Written from output/shared-catalog/functions/<name>.sql (snapshot of
2026-10-23): the same checks in the same order, the same writes and errors,
and the same return shape. The functions they call (mobile_service_validate,
mobile_repair_insert, assign_maintenance_work_order, update_maintenance_work_order,
mobile_repair_json, ...) are the helpers below, written from their bodies
too. Triggers are not run: an insert into complaints does not evaluate the
red-flag rules here.

Postgres' trim() removes spaces only, so the helpers strip " ", not all
whitespace.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

# The category codes mobile_create_provider_service, mobile_repair_insert and
# update_own_profile accept.
CATEGORIES = ("PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL")
SYDNEY = ZoneInfo("Australia/Sydney")


# ---------------------------------------------------------------------------
# SQL helpers
# ---------------------------------------------------------------------------
def _trim(value: str | None) -> str | None:
    return None if value is None else value.strip(" ")


def _nullif_blank(value: str | None) -> str | None:
    return None if value is None or value == "" else value


def _text(document, key: str) -> str | None:
    """document ->> key: the key's value as text, null for a missing key or a JSON null."""
    if not isinstance(document, dict) or document.get(key) is None:
        return None
    value = document[key]
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _numeric(text: str | None) -> Decimal | None:
    if text is None:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        raise api_error("22P02", f'invalid input syntax for type numeric: "{text}"') from None


def _integer(text: str | None) -> int | None:
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        raise api_error("22P02", f'invalid input syntax for type integer: "{text}"') from None


def _uuid(text: str | None) -> str | None:
    if text is None:
        return None
    try:
        return str(uuid.UUID(text))
    except ValueError:
        raise api_error("22P02", f'invalid input syntax for type uuid: "{text}"') from None


def _moment(value) -> datetime | None:
    """A timestamptz parameter or column as an aware datetime."""
    if value is None:
        return None
    try:
        at = datetime.fromisoformat(str(value))
    except ValueError:
        raise api_error("22007", f'invalid input syntax for type timestamp with time zone: "{value}"') from None
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def _stamp(at: datetime) -> str:
    """A timestamptz as PostgREST returns it (UTC)."""
    return at.astimezone(timezone.utc).isoformat()


def _now(ctx) -> str:
    return ctx.now()


def _row(ctx, table: str, **match) -> dict | None:
    return next((row for row in ctx.rows(table) if all(row.get(k) == v for k, v in match.items())), None)


def _user(ctx, user_id) -> dict | None:
    return _row(ctx, "users", id=user_id) if user_id else None


def _active(user: dict | None, *roles: str) -> bool:
    """status::text = 'ACTIVE' and deleted_at is null [and primary_role::text in roles]."""
    return (
        user is not None and user.get("status") == "ACTIVE" and user.get("deleted_at") is None
        and (not roles or user.get("primary_role") in roles)
    )


def _caller_id(ctx) -> str | None:
    """public.current_app_user_id()."""
    caller = ctx.caller
    return caller["id"] if caller else None


def _notify(ctx, recipients, title: str, body: str, category: str, link: str, now: str) -> None:
    """insert into notifications ... from unnest(recipients) where recipient is not null group by recipient."""
    for recipient in dict.fromkeys(person for person in recipients if person):
        ctx.table("notifications").insert({
            "id": str(uuid.uuid4()), "user_id": recipient, "title": title, "body": body, "category": category,
            "link": link, "is_read": False, "created_at": now,
        }).execute()


# ---------------------------------------------------------------------------
# Provider services
# ---------------------------------------------------------------------------
def _service_provider_id(ctx) -> str:
    """mobile_service_provider_id()."""
    user = _caller_id(ctx)
    if user is None:
        raise api_error("42501", "Please sign in first.")
    if (_user(ctx, user) or {}).get("primary_role") != "SERVICE_PROVIDER":
        raise api_error("42501", "Only service providers can manage services.")
    return user


def _service_validate(title: str | None, description: str | None, price: Decimal, status: str) -> None:
    """mobile_service_validate(p_title, p_description, p_price, p_status)."""
    if (_trim(title) or "") == "":
        raise api_error("22023", "Give the service a title.")
    if len(_trim(title)) > 80:
        raise api_error("22023", "The title can be at most 80 characters.")
    if len(description or "") > 1000:
        raise api_error("22023", "The description can be at most 1000 characters.")
    if price < 0 or price > 100000:
        raise api_error("22023", "Enter a price between 0 and 100,000.")
    if status == "active":
        if (_trim(description) or "") == "":
            raise api_error("22023", "Add a description before making the service active.")
        if price <= 0:
            raise api_error("22023", "Add a price before making the service active.")


def _clean_list(value) -> list[str]:
    """mobile_service_clean_list(p_list): trimmed, at most 120 characters each, no repeats, at most 20."""
    first: dict[str, int] = {}
    for position, element in enumerate(value if isinstance(value, list) else [], start=1):
        if element is None:
            continue
        text = _trim(element if isinstance(element, str) else json.dumps(element))
        if text == "":
            continue
        first.setdefault(text[:120], position)
    return [item for item, _ in sorted(first.items(), key=lambda pair: pair[1])][:20]


def _price_value(price: Decimal):
    """numeric as PostgREST returns it: an integer stays one."""
    return int(price) if price == price.to_integral_value() else float(price)


def _service_checks(status: str, pricing: str, category: str) -> None:
    if status not in ("active", "draft"):
        raise api_error("22023", "Status must be active or draft.")
    if pricing not in ("flat", "hourly", "from"):
        raise api_error("22023", "Pricing must be flat, hourly or from.")
    if category not in CATEGORIES:
        raise api_error("22023", "Choose a valid category.")


def _service_json(ctx, service_id: str) -> dict | None:
    """mobile_provider_service_json(p_service_id)."""
    service = _row(ctx, "mobile_provider_services", id=service_id)
    if service is None:
        return None
    complaints = {row["id"]: row for row in ctx.rows("complaints")}
    specific = set(CATEGORIES) - {"GENERAL"}

    def counted(order: dict) -> bool:
        complaint = complaints.get(order.get("complaint_id"))
        if complaint is None or order.get("assigned_worker_id") != service["provider_user_id"]:
            return False
        category = (complaint.get("category") or "").upper()
        return category not in specific if service["category"] == "GENERAL" else category == service["category"]

    return {
        "id": service["id"], "title": service["title"], "description": service["description"],
        "pricingType": service["pricing_type"], "price": service["price"], "duration": service["duration"],
        "inclusions": service["inclusions"], "exclusions": service["exclusions"],
        "serviceArea": service["service_area"], "category": service["category"], "status": service["status"],
        "bookingsCount": sum(1 for order in ctx.rows("maintenance_work_orders") if counted(order)),
        "createdAt": service["created_at"], "updatedAt": service["updated_at"],
    }


@rpc("mobile_create_provider_service")
def mobile_create_provider_service(ctx, params):
    service = params["p_service"]
    user = _service_provider_id(ctx)
    status = _nullif_blank(_text(service, "status")) or "draft"
    price = _numeric(_nullif_blank(_text(service, "price")))
    price = Decimal(0) if price is None else price
    pricing = _nullif_blank(_text(service, "pricingType")) or "flat"
    category = (_nullif_blank(_text(service, "category")) or "GENERAL").upper()
    _service_checks(status, pricing, category)
    _service_validate(_text(service, "title"), _text(service, "description"), price, status)
    live = [row for row in ctx.rows("mobile_provider_services")
            if row["provider_user_id"] == user and row["status"] != "archived"]
    if len(live) >= 50:
        raise api_error("22023", "You can have at most 50 services. Remove one first.")
    created = ctx.table("mobile_provider_services").insert({
        "provider_user_id": user,
        "title": _trim(_text(service, "title")),
        "description": _trim(_text(service, "description") or ""),
        "pricing_type": pricing,
        "price": _price_value(price),
        "duration": _trim(_text(service, "duration") or "")[:40],
        "inclusions": _clean_list((service or {}).get("inclusions") if isinstance(service, dict) else None),
        "exclusions": _clean_list((service or {}).get("exclusions") if isinstance(service, dict) else None),
        "service_area": _trim(_text(service, "serviceArea") or "")[:200],
        "category": category,
        "status": status,
    }).execute().data[0]
    return _service_json(ctx, created["id"])


@rpc("mobile_update_provider_service")
def mobile_update_provider_service(ctx, params):
    service_id, changes = params["p_service_id"], params["p_changes"]
    changes = changes if isinstance(changes, dict) else {}
    user = _service_provider_id(ctx)
    row = next((service for service in ctx.rows("mobile_provider_services")
                if service["id"] == service_id and service["provider_user_id"] == user
                and service["status"] != "archived"), None)
    if row is None:
        raise api_error("42501", "Service not found.")

    title = _trim(_text(changes, "title") or "") if "title" in changes else row["title"]
    description = _trim(_text(changes, "description") or "") if "description" in changes else row["description"]
    if "price" in changes:
        price = _numeric(_nullif_blank(_text(changes, "price")))
        price = Decimal(0) if price is None else price
    else:
        price = Decimal(str(row["price"]))
    pricing = (_text(changes, "pricingType") or "") if "pricingType" in changes else row["pricing_type"]
    category = (_text(changes, "category") or "").upper() if "category" in changes else row["category"]
    status = (_text(changes, "status") or "") if "status" in changes else row["status"]
    _service_checks(status, pricing, category)
    _service_validate(title, description, price, status)

    update = {
        "title": title, "description": description, "pricing_type": pricing, "price": _price_value(price),
        "category": category, "status": status, "updated_at": _now(ctx),
    }
    if "duration" in changes:
        update["duration"] = _trim(_text(changes, "duration") or "")[:40]
    for key in ("inclusions", "exclusions"):
        if key in changes:
            update[key] = _clean_list(changes[key])
    if "serviceArea" in changes:
        update["service_area"] = _trim(_text(changes, "serviceArea") or "")[:200]
    ctx.table("mobile_provider_services").update(update).eq("id", service_id).execute()
    return _service_json(ctx, service_id)


@rpc("mobile_delete_provider_service")
def mobile_delete_provider_service(ctx, params):
    service_id = params["p_service_id"]
    user = _service_provider_id(ctx)
    archived = (
        ctx.table("mobile_provider_services").update({"status": "archived", "updated_at": _now(ctx)})
        .eq("id", service_id).eq("provider_user_id", user).neq("status", "archived").execute().data
    )
    if not archived:
        raise api_error("42501", "Service not found.")
    return {"id": service_id, "status": "archived"}


# ---------------------------------------------------------------------------
# Repairs: a complaints row and the maintenance_work_orders row hanging off it
# ---------------------------------------------------------------------------
CATEGORY_LABELS = {
    "PLUMBING": "Plumbing", "ELECTRICAL": "Electrical", "HVAC": "Heating & Cooling", "APPLIANCE": "Appliance",
    "LOCKS_SECURITY": "Locks / Security", "LEAK": "Leak", "SAFETY": "Safety",
}
STATUS_TO_APP = {
    "OPEN": "Open", "ASSIGNED": "In Progress", "SCHEDULED": "In Progress",
    "PENDING_TENANT_CONFIRMATION": "Awaiting Confirmation", "RESOLVED": "Resolved",
}
PRIORITY_TO_APP = {"LOW": "Low", "HIGH": "High", "CRITICAL": "Urgent"}
SEVERITY_OF_PRIORITY = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH", "urgent": "CRITICAL", "critical": "CRITICAL"}


def _category_label(category: str | None) -> str:
    """mobile_repair_category_label(p_category)."""
    return CATEGORY_LABELS.get((category or "").upper(), "General")


def _order_of(ctx, complaint_id) -> dict | None:
    return _row(ctx, "maintenance_work_orders", complaint_id=complaint_id)


def _check_access(ctx, complaint_id, user_id) -> None:
    """mobile_repair_check_access(p_complaint_id, p_user)."""
    if user_id is None:
        raise api_error("42501", "Please sign in first.")
    order = _order_of(ctx, complaint_id)
    if order is None or user_id not in (order.get("tenant_user_id"), order.get("landlord_user_id"),
                                        order.get("assigned_worker_id")):
        raise api_error("42501", "Repair request not found.")


def _repair_event(ctx, complaint_id, actor, event: str, note: str | None, status: str) -> None:
    """mobile_repair_event(p_complaint_id, p_actor, p_event, p_note, p_status)."""
    ctx.table("complaint_events").insert({
        "id": str(uuid.uuid4()), "complaint_id": complaint_id, "actor_user_id": actor, "event_type": event,
        "note": note, "metadata": {"source": "mobile", "status": status}, "created_at": _now(ctx),
    }).execute()


def _name(value: str | None) -> str | None:
    """nullif(trim(name), '')."""
    return _nullif_blank(_trim(value))


def _repair_json(ctx, complaint_id, viewer_id) -> dict | None:
    """mobile_repair_json(p_complaint_id, p_viewer_id)."""
    complaint = _row(ctx, "complaints", id=complaint_id)
    order = _order_of(ctx, complaint_id)
    if complaint is None or order is None:
        return None
    meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
    mobile = meta.get("mobile") if isinstance(meta.get("mobile"), dict) else {}
    prop = _row(ctx, "properties", id=complaint.get("property_id")) or {}
    listing = _row(ctx, "listings", id=order.get("listing_id")) or {}
    tenant = _user(ctx, order.get("tenant_user_id")) or {}
    owner = _user(ctx, order.get("landlord_user_id")) or {}
    worker = _user(ctx, order.get("assigned_worker_id")) or {}
    company = (_row(ctx, "service_provider_profiles", user_id=order.get("assigned_worker_id")) or {}).get("company_name")
    status = order.get("status")
    logged_by_owner = meta.get("createdByRole") == "LANDLORD"
    history = [{"status": "Open",
                "note": "Logged by the property owner" if logged_by_owner else "Request submitted by tenant",
                "at": complaint.get("lodged_at")}]
    for event in ctx.rows("complaint_events"):
        if event.get("complaint_id") != complaint_id:
            continue
        event_meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        words = event["event_type"].replace("_", " ").title()
        history.append({"status": _text(event_meta, "status") or words, "note": event.get("note") or words,
                        "at": event.get("created_at")})
    history.sort(key=lambda entry: str(entry["at"] or ""))
    return {
        "id": complaint["id"],
        "issueTitle": _nullif_blank(_text(mobile, "issueTitle")) or f"{_category_label(complaint.get('category'))} issue",
        "description": complaint.get("description"),
        "category": (complaint.get("category") or "").upper() if complaint.get("category") is not None else None,
        "categoryLabel": _category_label(complaint.get("category")),
        "priority": PRIORITY_TO_APP.get(complaint.get("severity"), "Medium"),
        "severity": complaint.get("severity"),
        "status": STATUS_TO_APP.get(status, "Open"),
        "workOrderStatus": status,
        "submittedAt": complaint.get("lodged_at"),
        "updatedAt": order.get("updated_at"),
        "resolvedAt": complaint.get("resolved_at"),
        "listingId": order.get("listing_id"),
        "propertyId": complaint.get("property_id"),
        "propertyTitle": listing.get("title") or "Property",
        "address": ", ".join(part for part in (prop.get("address_line_1"), prop.get("suburb"), prop.get("state"),
                                               prop.get("postcode")) if part is not None),
        "userId": order.get("tenant_user_id"),
        "userName": _name(tenant.get("full_name")) or tenant.get("email") or "Tenant",
        "ownerId": order.get("landlord_user_id"),
        "ownerName": _name(owner.get("full_name")) or "Property Owner",
        "workerId": order.get("assigned_worker_id"),
        "workerName": (_name(company) or _name(worker.get("full_name")) or "Service provider")
        if order.get("assigned_worker_id") else None,
        "appointmentAt": order.get("appointment_at"),
        "estimatedDurationMinutes": order.get("estimated_duration_minutes"),
        "appointmentNote": _nullif_blank(order.get("appointment_note")),
        "completedAt": order.get("completed_at"),
        "completionNote": order.get("completion_note"),
        "tenantRating": order.get("tenant_rating"),
        "conversationId": order.get("conversation_id"),
        "photos": mobile.get("photos") if mobile.get("photos") is not None else [],
        "loggedByOwner": logged_by_owner,
        "canConfirm": status == "PENDING_TENANT_CONFIRMATION" and order.get("tenant_user_id") == viewer_id,
        "canRate": status == "RESOLVED" and order.get("tenant_rating") is None
        and order.get("tenant_user_id") == viewer_id,
        "canAssign": status in ("OPEN", "ASSIGNED") and order.get("landlord_user_id") == viewer_id,
        "canResolve": status != "RESOLVED" and order.get("landlord_user_id") == viewer_id,
        "canSchedule": status in ("ASSIGNED", "SCHEDULED") and order.get("assigned_worker_id") == viewer_id,
        "canComplete": status == "SCHEDULED" and order.get("assigned_worker_id") == viewer_id,
        "statusHistory": history,
    }


def _clean_photos(photos, owner) -> list[str]:
    """mobile_repair_clean_photos(p_photos, p_owner): trimmed keys in order, each once, at most 4, all the owner's."""
    first: dict[str, int] = {}
    for position, raw in enumerate(photos or [], start=1):
        path = _trim(raw)
        if path:
            first.setdefault(path, position)
    paths = [path for path, _ in sorted(first.items(), key=lambda pair: pair[1])]
    if len(paths) > 4:
        raise api_error("22023", "You can attach up to 4 photos.")
    for path in paths:
        if not re.fullmatch(f"{re.escape(str(owner))}/[A-Za-z0-9._-]+", path):
            raise api_error("22023", "A photo could not be attached. Please add it again.")
    return paths


def _create_maintenance_request(ctx, complaint_id, listing_id, property_id, tenant_id, landlord_id, category,
                                description, severity, role, now) -> str:
    """create_maintenance_request(...): the complaint and its OPEN work order."""
    ctx.table("complaints").insert({
        "id": complaint_id, "reporter_user_id": tenant_id, "against_user_id": landlord_id,
        "property_id": property_id, "category": category, "description": description, "severity": severity,
        "status": "OPEN", "lodged_at": now, "resolved_at": None,
        "metadata": {"listingId": listing_id, "source": "tenant_listing_maintenance", "createdByRole": role},
    }).execute()
    ctx.table("maintenance_work_orders").insert({
        "complaint_id": complaint_id, "listing_id": listing_id, "tenant_user_id": tenant_id,
        "landlord_user_id": landlord_id, "status": "OPEN", "created_at": now, "updated_at": now,
    }).execute()
    return complaint_id


def _repair_insert(ctx, actor, actor_role, listing_id, property_id, tenant_id, landlord_id, issue_title,
                   description, category, priority, photos) -> str:
    """mobile_repair_insert(...)."""
    title = _nullif_blank(_trim(issue_title or ""))
    description = _trim(description or "")
    category = _trim("GENERAL" if category is None else category).upper()
    if category not in CATEGORIES:
        raise api_error("22023", "Please choose a repair category.")
    severity = SEVERITY_OF_PRIORITY.get(_trim("medium" if priority is None else priority).lower())
    if severity is None:
        raise api_error("22023", "Please choose a priority.")
    if title is None or len(title) > 120:
        raise api_error("22023", "Please give the issue a short title (up to 120 characters).")
    if len(description) < 5 or len(description) > 2000:
        raise api_error("22023", "Please describe the issue (5 to 2000 characters).")
    cleaned = _clean_photos(photos, actor)
    complaint_id = str(uuid.uuid4())
    _create_maintenance_request(ctx, complaint_id, listing_id, property_id, tenant_id, landlord_id, category,
                                description, severity, actor_role, _now(ctx))
    complaint = _row(ctx, "complaints", id=complaint_id)
    metadata = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
    ctx.table("complaints").update({
        "metadata": {**metadata, "mobile": {"issueTitle": title, "photos": cleaned, "createdBy": actor}},
    }).eq("id", complaint_id).execute()
    return complaint_id


def _approved_homes(ctx, **where) -> list[tuple[dict, dict, dict]]:
    """(application, listing, property) for APPROVED applications, joined as the functions join them."""
    listings = {row["id"]: row for row in ctx.rows("listings")}
    properties = {row["id"]: row for row in ctx.rows("properties")}
    homes = []
    for application in ctx.rows("rental_applications"):
        listing = listings.get(application.get("listing_id"))
        prop = properties.get((listing or {}).get("property_id"))
        if application.get("status") != "APPROVED" or listing is None or prop is None:
            continue
        if where.get("applicant") is not None and application.get("applicant_user_id") != where["applicant"]:
            continue
        if where.get("owner") is not None and prop.get("owner_user_id") != where["owner"]:
            continue
        if where.get("listing") is not None and application.get("listing_id") != where["listing"]:
            continue
        homes.append((application, listing, prop))
    return homes


def _address(prop: dict) -> str:
    """concat_ws(', ', address_line_1, suburb, state, postcode)."""
    return ", ".join(part for part in (prop.get("address_line_1"), prop.get("suburb"), prop.get("state"),
                                       prop.get("postcode")) if part is not None)


@rpc("mobile_create_repair")
def mobile_create_repair(ctx, params):
    user = _caller_id(ctx)
    if user is None:
        raise api_error("42501", "Please sign in first.")
    if not _active(_user(ctx, user), "TENANT"):
        raise api_error("42501", "Only tenant accounts can report repairs.")
    homes = _approved_homes(ctx, applicant=user, listing=params["p_listing_id"])
    if not homes:
        raise api_error("42501", "You can only report repairs for a home you are renting.")
    _, _, prop = homes[0]
    complaint_id = _repair_insert(
        ctx, user, "TENANT", params["p_listing_id"], prop["id"], user, prop["owner_user_id"],
        params["p_issue_title"], params["p_description"], params["p_category"], params["p_priority"],
        params.get("p_photos"),
    )
    name = _name((_user(ctx, user) or {}).get("full_name")) or "A tenant"
    _notify(ctx, [prop["owner_user_id"]], "New repair request", f"{name} reported: {_trim(params['p_issue_title'])}",
            "system", "/admin/maintenance", _now(ctx))
    return _repair_json(ctx, complaint_id, user)


@rpc("mobile_owner_create_repair")
def mobile_owner_create_repair(ctx, params):
    user = _caller_id(ctx)
    if user is None:
        raise api_error("42501", "Please sign in first.")
    if not _active(_user(ctx, user), "LANDLORD"):
        raise api_error("42501", "Active landlord access is required")
    homes = _approved_homes(ctx, owner=user, listing=params["p_listing_id"])
    homes.sort(key=lambda home: str(home[0].get("last_status_at") or ""), reverse=True)
    if not homes:
        raise api_error("42501", "Repairs can only be logged for one of your homes with a current tenant.")
    application, _, prop = homes[0]
    tenant = application["applicant_user_id"]
    complaint_id = _repair_insert(
        ctx, user, "LANDLORD", params["p_listing_id"], prop["id"], tenant, user,
        params["p_issue_title"], params["p_description"], params["p_category"], params["p_priority"],
        params.get("p_photos"),
    )
    name = _name((_user(ctx, user) or {}).get("full_name")) or "Your landlord"
    _notify(ctx, [tenant], "Repair logged by your landlord", f"{name} logged: {_trim(params['p_issue_title'])}",
            "system", "/admin/maintenance", _now(ctx))
    return _repair_json(ctx, complaint_id, user)


def _assign_work_order(ctx, complaint_id, landlord_id, worker_id, tenant_name, now) -> str:
    """assign_maintenance_work_order(p_complaint_id, p_landlord_id, p_worker_id, p_tenant_name, p_now)."""
    if not _active(_user(ctx, landlord_id), "LANDLORD"):
        raise api_error("42501", "Active landlord access is required")
    complaint = _row(ctx, "complaints", id=complaint_id)
    if complaint is None:
        raise api_error("P0002", "Maintenance request not found")
    order = _order_of(ctx, complaint_id)
    if order is None:
        raise api_error("P0002", "Maintenance work order not found")
    if order.get("landlord_user_id") != landlord_id or order.get("status") not in ("OPEN", "ASSIGNED"):
        raise api_error("42501", "Maintenance order cannot be assigned")
    worker = _user(ctx, worker_id)
    profile = _row(ctx, "service_provider_profiles", user_id=worker_id)
    categories = (profile or {}).get("service_categories")
    qualified = (
        _active(worker, "SERVICE_PROVIDER") and worker.get("verification_status") == "APPROVED"
        and profile is not None and isinstance(categories, list)
        and (complaint.get("category") or "").upper() in [code for code in categories if isinstance(code, str)]
    )
    if not qualified:
        raise api_error("42501", "Approved worker qualified for this maintenance category required")

    threads = sorted(
        (row for row in ctx.rows("conversations")
         if isinstance(row.get("metadata"), dict) and row["metadata"].get("maintenanceComplaintId") == complaint_id),
        key=lambda row: str(row.get("created_at") or ""),
    )
    conversation_id = threads[0]["id"] if threads else None
    if conversation_id is None:
        conversation_id = str(uuid.uuid4())
        ctx.table("conversations").insert({
            "id": conversation_id, "conversation_type": "PROPERTY",
            "subject": f"Maintenance appointment: {_name(tenant_name) or 'tenant'}",
            "listing_id": order.get("listing_id"), "application_id": None, "created_by_user_id": worker_id,
            "metadata": {"maintenanceComplaintId": complaint_id}, "created_at": now, "updated_at": now,
        }).execute()
    previous = order.get("assigned_worker_id")
    if previous is not None and previous != worker_id:
        (ctx.table("conversation_participants").delete().eq("conversation_id", conversation_id)
         .eq("user_id", previous).eq("role_label", "Maintenance worker").execute())
    for person, label in ((order["tenant_user_id"], "Tenant"), (worker_id, "Maintenance worker")):
        # on conflict (conversation_id, user_id) do update set role_label, is_muted = false
        existing = _row(ctx, "conversation_participants", conversation_id=conversation_id, user_id=person)
        if existing is None:
            ctx.table("conversation_participants").insert({
                "id": str(uuid.uuid4()), "conversation_id": conversation_id, "user_id": person, "role_label": label,
                "joined_at": now, "last_read_at": None, "is_muted": False,
            }).execute()
        else:
            (ctx.table("conversation_participants").update({"role_label": label, "is_muted": False})
             .eq("id", existing["id"]).execute())
    ctx.table("maintenance_work_orders").update({
        "assigned_worker_id": worker_id, "status": "ASSIGNED", "conversation_id": conversation_id, "updated_at": now,
    }).eq("complaint_id", complaint_id).execute()
    ctx.table("complaints").update({"status": "IN_REVIEW"}).eq("id", complaint_id).execute()
    _notify(ctx, [order["tenant_user_id"], worker_id], "Maintenance worker assigned",
            "A maintenance work order has been assigned.", "system", "/admin/maintenance", now)
    return conversation_id


@rpc("mobile_assign_repair")
def mobile_assign_repair(ctx, params):
    complaint_id, provider_id = params["p_complaint_id"], params["p_provider_id"]
    user = _caller_id(ctx)
    _check_access(ctx, complaint_id, user)
    order = _order_of(ctx, complaint_id)
    tenant = _user(ctx, order["tenant_user_id"])
    tenant_name = (_name(tenant.get("full_name")) or "tenant") if tenant else None
    listing_id = order.get("listing_id") if tenant else None
    now = _now(ctx)
    _assign_work_order(ctx, complaint_id, user, provider_id, tenant_name, now)

    provider = _user(ctx, provider_id)
    company = (_row(ctx, "service_provider_profiles", user_id=provider_id) or {}).get("company_name")
    provider_name = (_name(company) or _name(provider.get("full_name")) or "Service Provider") if provider else None
    owner_name = _name((_user(ctx, user) or {}).get("full_name")) or "Owner"
    category = (_row(ctx, "complaints", id=complaint_id) or {}).get("category")
    title = f"Maintenance: {category or 'Repair request'}"
    job = next((row for row in ctx.rows("mobile_ai_service_jobs")
                if isinstance(row.get("request"), dict) and row["request"].get("complaintId") == complaint_id), None)
    existing_provider = job.get("provider_id") if job else None
    existing_status = _text(job.get("payload"), "status") if job else None
    payload = {
        "title": title, "description": "Maintenance work order assigned by property owner.", "ownerId": user,
        "providerId": provider_id, "ownerName": owner_name, "providerName": provider_name,
        "propertyTitle": "Property maintenance", "propertyId": listing_id, "complaintId": complaint_id,
        "status": existing_status
        if existing_provider == provider_id and existing_status in ("accepted", "inProgress", "completed") else "pending",
        "createdAt": now,
    }
    if job is None:
        job_id = str(uuid.uuid4())
        ctx.table("mobile_ai_service_jobs").insert({
            "id": job_id, "owner_id": user, "provider_id": provider_id, "listing_id": listing_id,
            "request": {"complaintId": complaint_id, "source": "maintenance"},
            "payload": {**payload, "id": job_id}, "created_at": now,
        }).execute()
    else:
        stored = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        created = stored["createdAt"] if stored.get("createdAt") is not None else job.get("created_at")
        ctx.table("mobile_ai_service_jobs").update({
            "provider_id": provider_id, "payload": {**payload, "id": job["id"], "createdAt": created},
        }).eq("id", job["id"]).execute()
    _repair_event(ctx, complaint_id, user, "ASSIGNED", f"Assigned to {provider_name}", "In Progress")
    return _repair_json(ctx, complaint_id, user)


def _update_work_order(ctx, complaint_id, actor_id, action: str, updates: dict, now: str) -> str:
    """update_maintenance_work_order(p_complaint_id, p_actor_user_id, p_action, p_updates, p_now)."""
    actor = _user(ctx, actor_id)
    if not _active(actor):
        raise api_error("42501", "Active account access is required")
    if _row(ctx, "complaints", id=complaint_id) is None:
        raise api_error("P0002", "Maintenance request not found")
    order = _order_of(ctx, complaint_id)
    if order is None:
        raise api_error("P0002", "Maintenance work order not found")

    worker_only = "Assigned maintenance worker access is required"
    if action == "schedule":
        if (actor.get("primary_role") != "SERVICE_PROVIDER" or actor.get("verification_status") != "APPROVED"
                or order.get("assigned_worker_id") != actor_id):
            raise api_error("42501", worker_only)
        if order.get("status") not in ("ASSIGNED", "SCHEDULED"):
            raise api_error("22023", "Work order cannot be scheduled from its current status")
        at = _moment(_nullif_blank(_text(updates, "appointmentAt")))
        duration = _integer(_nullif_blank(_text(updates, "estimatedDurationMinutes")))
        if at is None or duration is None or not 15 <= duration <= 1440:
            raise api_error("22023", "Valid appointment and duration are required")
        ctx.table("maintenance_work_orders").update({
            "status": "SCHEDULED", "appointment_at": _stamp(at), "estimated_duration_minutes": duration,
            "appointment_note": _text(updates, "appointmentNote") or "", "updated_at": now,
        }).eq("complaint_id", complaint_id).execute()
        new_status, title, body = ("SCHEDULED", "Maintenance appointment scheduled",
                                   "Your maintenance appointment details are ready.")
        recipients = [order.get("tenant_user_id"), order.get("landlord_user_id")]
    elif action == "complete":
        if (actor.get("primary_role") != "SERVICE_PROVIDER" or actor.get("verification_status") != "APPROVED"
                or order.get("assigned_worker_id") != actor_id):
            raise api_error("42501", worker_only)
        if order.get("status") != "SCHEDULED":
            raise api_error("22023", "Only a scheduled work order can be completed")
        note = _nullif_blank(_trim(_text(updates, "completionNote")))
        if note is None:
            raise api_error("22023", "Completion note is required")
        ctx.table("maintenance_work_orders").update({
            "status": "PENDING_TENANT_CONFIRMATION", "completed_at": now, "completion_note": note, "updated_at": now,
        }).eq("complaint_id", complaint_id).execute()
        new_status, title, body = ("PENDING_TENANT_CONFIRMATION", "Maintenance awaiting confirmation",
                                   "The maintenance worker marked this work as complete.")
        recipients = [order.get("tenant_user_id"), order.get("landlord_user_id")]
    elif action == "confirm":
        if actor.get("primary_role") != "TENANT" or order.get("tenant_user_id") != actor_id:
            raise api_error("42501", "Reporting tenant access is required")
        if order.get("status") != "PENDING_TENANT_CONFIRMATION":
            raise api_error("22023", "Work order is not awaiting tenant confirmation")
        rating = _integer(_nullif_blank(_text(updates, "rating")))
        if rating is None or not 1 <= rating <= 5:
            raise api_error("22023", "Rating must be between 1 and 5")
        ctx.table("maintenance_work_orders").update({
            "status": "RESOLVED", "tenant_rating": rating, "rated_at": now, "updated_at": now,
        }).eq("complaint_id", complaint_id).execute()
        ctx.table("complaints").update({"status": "RESOLVED", "resolved_at": now}).eq("id", complaint_id).execute()
        new_status, title, body = ("RESOLVED", "Maintenance completed",
                                   "The tenant confirmed the maintenance work is resolved.")
        recipients = [order.get("assigned_worker_id"), order.get("landlord_user_id")]
    else:
        raise api_error("22023", "Invalid maintenance action")
    _notify(ctx, recipients, title, body, "system", "/admin/maintenance", now)
    return new_status


@rpc("mobile_schedule_repair")
def mobile_schedule_repair(ctx, params):
    complaint_id = params["p_complaint_id"]
    user = _caller_id(ctx)
    _check_access(ctx, complaint_id, user)
    at = _moment(params["p_appointment_at"])
    now = _now(ctx)
    if at is None or at <= _moment(now):
        raise api_error("22023", "Please select a valid time.")
    _update_work_order(ctx, complaint_id, user, "schedule", {
        "appointmentAt": _stamp(at), "estimatedDurationMinutes": params["p_duration_minutes"],
        "appointmentNote": _trim(params.get("p_note")) or "",
    }, now)
    local = at.astimezone(SYDNEY)
    _repair_event(ctx, complaint_id, user, "SCHEDULED", f"Appointment booked for {local:%d %b %Y %H:%M}", "In Progress")
    return _repair_json(ctx, complaint_id, user)


@rpc("mobile_complete_repair")
def mobile_complete_repair(ctx, params):
    complaint_id, note = params["p_complaint_id"], params["p_note"]
    user = _caller_id(ctx)
    _check_access(ctx, complaint_id, user)
    _update_work_order(ctx, complaint_id, user, "complete", {"completionNote": note}, _now(ctx))
    _repair_event(ctx, complaint_id, user, "COMPLETED", _trim(note), "Awaiting Confirmation")
    return _repair_json(ctx, complaint_id, user)


@rpc("mobile_confirm_repair")
def mobile_confirm_repair(ctx, params):
    complaint_id, rating = params["p_complaint_id"], params["p_rating"]
    user = _caller_id(ctx)
    _check_access(ctx, complaint_id, user)
    _update_work_order(ctx, complaint_id, user, "confirm", {"rating": rating}, _now(ctx))
    _repair_event(ctx, complaint_id, user, "CONFIRMED", f"Tenant confirmed the repair ({rating}/5)", "Resolved")
    return _repair_json(ctx, complaint_id, user)


def _rate_completed(ctx, complaint_id, tenant_id, rating, now) -> int:
    """rate_completed_maintenance_work_order(p_complaint_id, p_tenant_user_id, p_rating, p_now)."""
    if not _active(_user(ctx, tenant_id), "TENANT"):
        raise api_error("42501", "Active tenant access is required")
    order = _order_of(ctx, complaint_id)
    if order is None:
        raise api_error("P0002", "Maintenance work order not found")
    if order.get("tenant_user_id") != tenant_id:
        raise api_error("42501", "Only the reporting tenant can rate this work")
    if order.get("status") != "RESOLVED":
        raise api_error("22023", "Only a completed work order can be rated")
    if order.get("tenant_rating") is not None:
        raise api_error("22023", "This work order has already been rated")
    # "p_rating not between 1 and 5" is null for a null rating, so that passes.
    if rating is not None and not 1 <= rating <= 5:
        raise api_error("22023", "Rating must be between 1 and 5")
    ctx.table("maintenance_work_orders").update({
        "tenant_rating": rating, "rated_at": now, "updated_at": now,
    }).eq("complaint_id", complaint_id).execute()
    _notify(ctx, [order.get("assigned_worker_id"), order.get("landlord_user_id")], "Maintenance work rated",
            "The tenant submitted a rating for completed maintenance work.", "social", "/admin/maintenance", now)
    return rating


@rpc("mobile_rate_repair")
def mobile_rate_repair(ctx, params):
    complaint_id, rating = params["p_complaint_id"], params["p_rating"]
    user = _caller_id(ctx)
    _check_access(ctx, complaint_id, user)
    _rate_completed(ctx, complaint_id, user, rating, _now(ctx))
    _repair_event(ctx, complaint_id, user, "RATED", f"Tenant rated the repair {rating}/5", "Resolved")
    return _repair_json(ctx, complaint_id, user)


@rpc("mobile_resolve_repair")
def mobile_resolve_repair(ctx, params):
    complaint_id = params["p_complaint_id"]
    user = _caller_id(ctx)
    note = _nullif_blank(_trim(params.get("p_note") or ""))
    now = _now(ctx)
    if user is None:
        raise api_error("42501", "Please sign in first.")
    if note is not None and len(note) > 1200:
        raise api_error("22023", "The note is too long.")
    order = _order_of(ctx, complaint_id)
    if order is None or order.get("landlord_user_id") != user:
        raise api_error("42501", "Only the property owner can resolve this repair.")
    if not _active(_user(ctx, user), "LANDLORD"):
        raise api_error("42501", "Active landlord access is required")
    if order.get("status") == "RESOLVED":
        return _repair_json(ctx, complaint_id, user)
    ctx.table("maintenance_work_orders").update({
        "status": "RESOLVED",
        "completed_at": order.get("completed_at") or now,
        "completion_note": order.get("completion_note") or note or "Marked resolved by the owner.",
        "updated_at": now,
    }).eq("complaint_id", complaint_id).execute()
    ctx.table("complaints").update({"status": "RESOLVED", "resolved_at": now}).eq("id", complaint_id).execute()
    _repair_event(ctx, complaint_id, user, "RESOLVED_BY_OWNER", note or "Marked resolved by the owner.", "Resolved")
    complaint = _row(ctx, "complaints", id=complaint_id) or {}
    meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
    title = _text(meta.get("mobile"), "issueTitle")
    title = "Your repair request" if title is None else title
    _notify(ctx, [order.get("tenant_user_id"), order.get("assigned_worker_id")], "Repair resolved",
            f"{title} was marked resolved by the owner.", "system", "/admin/maintenance", now)
    return _repair_json(ctx, complaint_id, user)


@rpc("mobile_repair_providers")
def mobile_repair_providers(ctx, params):
    user = _caller_id(ctx)
    complaint = _row(ctx, "complaints", id=params["p_complaint_id"])
    order = _order_of(ctx, params["p_complaint_id"])
    if complaint is None or order is None or user is None or order.get("landlord_user_id") != user:
        raise api_error("42501", "Repair request not found.")
    category = (complaint.get("category") or "").upper()
    profiles = {row["user_id"]: row for row in ctx.rows("service_provider_profiles")}
    found = []
    for person in ctx.rows("users"):
        profile = profiles.get(person["id"])
        categories = (profile or {}).get("service_categories")
        if (profile is None or not _active(person, "SERVICE_PROVIDER")
                or person.get("verification_status") != "APPROVED" or not isinstance(categories, list)
                or category not in [code for code in categories if isinstance(code, str)]):
            continue
        found.append({
            "id": person["id"],
            "name": _name(profile.get("company_name")) or _name(person.get("full_name")) or "Service provider",
            "contactName": person.get("full_name"), "serviceArea": profile.get("service_area"),
            "pricing": profile.get("pricing_summary"), "categories": categories,
            "_order": _name(profile.get("company_name")) or person.get("full_name"),
        })
    found.sort(key=lambda entry: (entry["_order"] is None, entry["_order"] or ""))
    return [{key: value for key, value in entry.items() if key != "_order"} for entry in found]


@rpc("mobile_my_repair_properties")
def mobile_my_repair_properties(ctx, params):
    user = _caller_id(ctx)
    homes = _approved_homes(ctx, applicant=user) if user else []
    homes.sort(key=lambda home: str(home[0].get("last_status_at") or ""), reverse=True)
    result = []
    for _, listing, prop in homes:
        owner = _user(ctx, prop.get("owner_user_id")) or {}
        result.append({
            "listingId": listing["id"], "propertyId": prop["id"], "title": listing.get("title"),
            "address": _address(prop), "ownerId": prop.get("owner_user_id"),
            "ownerName": _name(owner.get("full_name")) or "Property Owner",
        })
    return result


@rpc("mobile_owner_repair_properties")
def mobile_owner_repair_properties(ctx, params):
    user = _caller_id(ctx)
    newest: dict[str, tuple] = {}
    for application, listing, prop in (_approved_homes(ctx, owner=user) if user else []):
        when = str(application.get("last_status_at") or "")
        if listing["id"] not in newest or when > newest[listing["id"]][0]:
            newest[listing["id"]] = (when, application, listing, prop)
    result = []
    for when, application, listing, prop in sorted(newest.values(), key=lambda entry: entry[0], reverse=True):
        tenant = _user(ctx, application["applicant_user_id"]) or {}
        result.append({
            "listingId": listing["id"], "propertyId": prop["id"], "title": listing.get("title"),
            "address": _address(prop), "tenantId": application["applicant_user_id"],
            "tenantName": _name(tenant.get("full_name")) or tenant.get("email") or "Tenant",
        })
    return result


# ---------------------------------------------------------------------------
# Job requests: mobile_ai_service_jobs
# ---------------------------------------------------------------------------
def _ai_identity(ctx) -> dict:
    """mobile_ai_identity(): the caller's mobile_account_json, the fields these functions read."""
    user = _user(ctx, _caller_id(ctx))
    if not _active(user):
        raise api_error("42501", "Sign in with an active Supabase account.")
    return {"id": user["id"], "fullName": user.get("full_name") or ""}


@rpc("mobile_ai_jobs")
def mobile_ai_jobs(ctx, params):
    user = _ai_identity(ctx)["id"]
    jobs = [row for row in ctx.rows("mobile_ai_service_jobs") if user in (row.get("owner_id"), row.get("provider_id"))]
    jobs.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return [{**(row.get("payload") or {}), "id": row["id"], "createdAt": row.get("created_at")} for row in jobs]


@rpc("mobile_ai_provider_job")
def mobile_ai_provider_job(ctx, params):
    action = params["p_action"] if isinstance(params["p_action"], dict) else {}
    user = _ai_identity(ctx)["id"]
    kind = _text(action, "action")
    if kind == "create":
        # Its body reads mobile_listing_json and mobile_ai_providers, which the fake has no stand-ins for.
        raise AssertionError("the web never creates a job request; seed mobile_ai_service_jobs instead")
    job_id = _uuid(_text(action, "jobId"))
    job = next((row for row in ctx.rows("mobile_ai_service_jobs")
                if row["id"] == job_id and user in (row.get("owner_id"), row.get("provider_id"))), None)
    if job is None:
        raise api_error("P0001", "Job is unavailable.")
    result = dict(job.get("payload") or {})
    current = _text(result, "status")
    if kind == "status":
        target = _text(action, "status")
        if target is not None and target == current:
            return result
        owner_cancels = user == job["owner_id"] and target == "cancelled" and current in ("pending", "accepted")
        provider_moves = user == job["provider_id"] and (
            (current == "pending" and target in ("accepted", "declined"))
            or (current == "accepted" and target == "inProgress")
            or (current == "inProgress" and target == "completed")
        )
        if not (owner_cancels or provider_moves):
            raise api_error("P0001", "Invalid job status change.")
        result["status"] = target
    elif kind == "review":
        if user != job["owner_id"] or current != "completed":
            raise api_error("P0001", "Only the owner can review a completed job.")
        if _text(result, "reviewed") == "true":
            raise api_error("P0001", "This job already has a review.")
        rating = _integer(_text(action, "rating")) or 0
        if not 1 <= rating <= 5 or not 1 <= len((_text(action, "text") or "").strip(" ")) <= 2000:
            raise api_error("P0001", "Enter a rating and review.")
        result.update(reviewed=True, review=_text(action, "text"), rating=rating)
    else:
        raise api_error("P0001", "Unsupported job action.")
    ctx.table("mobile_ai_service_jobs").update({"payload": result}).eq("id", job_id).execute()
    owner = _text(result, "ownerId")
    recipient = _text(result, "providerId") if owner is not None and user == owner else owner
    ctx.table("notifications").insert({
        "id": str(uuid.uuid4()), "user_id": recipient, "title": "Service job updated",
        "body": (_text(result, "title") or "")[:160] if _text(result, "title") is not None else None,
        "category": "system", "link": "/messages", "is_read": False, "created_at": _now(ctx),
    }).execute()
    return result
