"""Map the shared (mobile) schema onto the existing /api/v1 DTO shapes.

The Next.js app keeps tenant/landlord/service_provider roles and listing-shaped
properties. The shared database uses TENANT/LANDLORD enums, separate
properties + listings rows, and rental_applications.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.db import schema

WEB_TO_DB_ROLE = {
    "tenant": "TENANT",
    "landlord": "LANDLORD",
    "service_provider": "SERVICE_PROVIDER",
    "admin": "ADMIN",
    "officer": "REGULATOR",
}

DB_TO_WEB_ROLE = {
    "TENANT": "tenant",
    "LANDLORD": "landlord",
    "AGENT": "landlord",
    "SERVICE_PROVIDER": "service_provider",
    "ADMIN": "admin",
    "REGULATOR": "officer",
}

WEB_TO_LISTING_STATUS = {
    "available": "PUBLISHED",
    "rented": "LEASED",
    "off_market": "PAUSED",
}

LISTING_TO_WEB_STATUS = {
    "DRAFT": "off_market",
    "PUBLISHED": "available",
    "PAUSED": "off_market",
    "APPLICATIONS_CLOSED": "available",
    "LEASED": "rented",
    "ARCHIVED": "off_market",
}

WEB_TO_PROPERTY_TYPE = {
    "apartment": "APARTMENT",
    "house": "HOUSE",
    "studio": "STUDIO",
    "townhouse": "TOWNHOUSE",
    "unit": "UNIT",
    "duplex": "DUPLEX",
}

PROPERTY_TYPE_TO_WEB = {v.lower(): k for k, v in WEB_TO_PROPERTY_TYPE.items()}
PROPERTY_TYPE_TO_WEB.update({v: k for k, v in WEB_TO_PROPERTY_TYPE.items()})

WEB_TO_APP_STATUS = {
    "new": "SUBMITTED",
    "reviewing": "UNDER_REVIEW",
    "approved": "APPROVED",
    "declined": "REJECTED",
}

APP_TO_WEB_STATUS = {
    "SUBMITTED": "new",
    "UNDER_REVIEW": "reviewing",
    "SHORTLISTED": "reviewing",
    "APPROVED": "approved",
    "REJECTED": "declined",
    "WITHDRAWN": "declined",
    "EXPIRED": "declined",
}

COMPLAINT_TO_WEB = {
    "OPEN": "open",
    "IN_REVIEW": "under_review",
    "ESCALATED": "under_review",
    "RESOLVED": "resolved",
    "CLOSED": "resolved",
}

WEB_TO_COMPLAINT = {
    "open": "OPEN",
    "under_review": "IN_REVIEW",
    "resolved": "RESOLVED",
    "dismissed": "CLOSED",
}

# maintenance_work_orders.status, looked up upper-cased. Its CHECK allows OPEN,
# ASSIGNED, SCHEDULED, PENDING_TENANT_CONFIRMATION and RESOLVED, which only the
# shared functions write; the rest are older values a row may still hold.
# PENDING_TENANT_CONFIRMATION reads as open here (still the tenant's to
# confirm); the repair pages name it (services/maintenance.STATUS_TO_WEB).
MAINT_TO_WEB = {
    "OPEN": "open",
    "PENDING": "open",
    "ASSIGNED": "in_progress",
    "SCHEDULED": "in_progress",
    "IN_PROGRESS": "in_progress",
    "COMPLETED": "resolved",
    "RESOLVED": "resolved",
    "CLOSED": "resolved",
    "CANCELLED": "cancelled",
    "CANCELED": "cancelled",
}


def web_role(db_role: str | None) -> str:
    if not db_role:
        return "tenant"
    return DB_TO_WEB_ROLE.get(db_role, db_role.lower())


def db_role(web_role_name: str) -> str:
    return WEB_TO_DB_ROLE.get(web_role_name, web_role_name.upper())


def web_listing_status(db_status: str | None) -> str:
    if not db_status:
        return "available"
    return LISTING_TO_WEB_STATUS.get(db_status, "available")


def db_listing_status(web_status: str | None) -> str:
    """The shared status a web listing status is written as; ValueError for an unknown one."""
    try:
        return WEB_TO_LISTING_STATUS[web_status or "available"]
    except KeyError:
        raise ValueError(f"unknown listing status {web_status!r}") from None


def web_property_type(db_type: str | None) -> str | None:
    if not db_type:
        return None
    return PROPERTY_TYPE_TO_WEB.get(db_type, db_type.lower())


def db_property_type(web_type: str | None) -> str:
    """The shared PropertyType for the web's free-text type: anything it has no label for is OTHER."""
    if not web_type:
        return "OTHER"
    return WEB_TO_PROPERTY_TYPE.get(web_type.strip().lower(), "OTHER")


def web_application_status(db_status: str | None) -> str:
    if not db_status:
        return "new"
    return APP_TO_WEB_STATUS.get(db_status, "new")


def db_application_status(web_status: str | None) -> str:
    """The shared status a web application status is written as; ValueError for an unknown one."""
    try:
        return WEB_TO_APP_STATUS[web_status or "new"]
    except KeyError:
        raise ValueError(f"unknown application status {web_status!r}") from None


def address_of(prop: dict) -> str:
    parts = [
        prop.get("address_line_1"),
        prop.get("address_line_2"),
        prop.get("suburb"),
        prop.get("state"),
        prop.get("postcode"),
    ]
    return ", ".join(p for p in parts if p) or ""


def flatten_listing(listing: dict, prop: dict, media: list[dict] | None = None, reviews: list[dict] | None = None) -> dict:
    """Present a listing+property pair as the historical PropertyOut shape.

    Public and owner UIs use listing.id as the resource id because applications,
    inspections and repairs all hang off listings.
    """
    photos = []
    for item in media or []:
        url = item.get("media_url")
        if url:
            photos.append(url)
    review_rows = reviews or []
    rating_avg = 0.0
    if review_rows:
        rating_avg = round(sum(r.get("rating") or 0 for r in review_rows) / len(review_rows), 2)
    meta = prop.get("metadata") if isinstance(prop.get("metadata"), dict) else {}
    lease_months = listing.get("lease_term_months")
    return {
        "id": listing["id"],
        "owner_id": prop.get("owner_user_id") or listing.get("created_by_user_id"),
        "title": listing.get("title") or prop.get("nickname") or "Listing",
        "description": listing.get("description"),
        "address": address_of(prop) or prop.get("nickname") or "",
        "suburb": prop.get("suburb"),
        "state": prop.get("state"),
        "postcode": prop.get("postcode"),
        "property_type": web_property_type(prop.get("property_type")),
        "bedrooms": prop.get("bedrooms"),
        "bathrooms": prop.get("bathrooms"),
        "parking": prop.get("parking_spaces"),
        "price": float(listing.get("weekly_rent") or 0),
        "bond": float(listing["bond_amount"]) if listing.get("bond_amount") is not None else None,
        "lease_term": f"{lease_months} months" if lease_months else None,
        "available_from": listing.get("available_from"),
        "amenities": meta.get("amenities") if isinstance(meta.get("amenities"), list) else [],
        "photo_urls": photos,
        "status": web_listing_status(listing.get("status")),
        "rating_avg": rating_avg,
        "review_count": len(review_rows),
        "created_at": listing.get("created_at") or prop.get("created_at"),
        "updated_at": listing.get("updated_at") or prop.get("updated_at"),
        "property_row_id": prop.get("id"),
    }


def flatten_user(user: dict) -> dict:
    meta = user.get("metadata") if isinstance(user.get("metadata"), dict) else {}
    return {
        "id": user["id"],
        "role": web_role(user.get("primary_role")),
        "full_name": user.get("full_name") or "",
        "email": user.get("email"),
        "avatar_url": user.get("avatar_url"),
        "phone": user.get("phone"),
        "location": meta.get("location"),
        "state": meta.get("state"),
        "postcode": meta.get("postcode"),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
        "auth_user_id": user.get("auth_user_id"),
    }


def flatten_application(row: dict) -> dict:
    status = web_application_status(row.get("status"))
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "id": row["id"],
        "property_id": row.get("listing_id"),
        "tenant_id": row.get("applicant_user_id"),
        "status": status,
        "annual_income": meta.get("annual_income"),
        "move_in_date": meta.get("move_in_date"),
        "rent_offered": float(row["offer_weekly_rent"]) if row.get("offer_weekly_rent") is not None else None,
        "tenant_score": meta.get("tenant_score"),
        "shortlisted": row.get("status") == "SHORTLISTED",
        "has_pets": bool(meta.get("has_pets")),
        "message": row.get("message"),
        "created_at": row.get("created_at") or row.get("submitted_at"),
        "updated_at": row.get("updated_at") or row.get("last_status_at"),
        "tenant_name": None,
        "tenant_phone": None,
    }


def review_rating(row: dict) -> int:
    """A review's stars: provider reviews use rating, property reviews also landlord_rating."""
    return row.get("rating") or row.get("landlord_rating") or 0


def flatten_review(row: dict) -> dict:
    flagged = (row.get("status") or "") == "FLAGGED"
    return {
        "id": row["id"],
        "booking_id": None,
        "provider_id": row["reviewed_user_id"],
        "client_id": row.get("reviewer_user_id"),
        "rating": review_rating(row),
        # Only what the reviewer wrote. The title names the review (the
        # service booked, or the web's "Property review"), and service_title
        # already shows it.
        "comment": row.get("body"),
        "provider_reply": row.get("landlord_reply"),
        "replied_at": row.get("landlord_replied_at"),
        "is_flagged": flagged,
        "created_at": row.get("created_at"),
        "client_name": None,
        "client_avatar_url": None,
        "service_title": row.get("title"),
        "location": None,
        "property_id": row.get("property_id"),
    }


def flatten_complaint(row: dict) -> dict:
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "id": row["id"],
        "complainant_id": row.get("reporter_user_id"),
        "against_id": row.get("against_user_id"),
        "property_id": row.get("property_id"),
        "category": (row.get("category") or "other").lower(),
        "subject": meta.get("subject") or (row.get("category") or "Complaint"),
        "description": row.get("description"),
        "status": COMPLAINT_TO_WEB.get(row.get("status") or "OPEN", "open"),
        "is_escalated": (row.get("status") or "") == "ESCALATED",
        "response": meta.get("response"),
        "responded_at": meta.get("responded_at"),
        "resolution_note": meta.get("resolution_note"),
        "resolved_at": row.get("resolved_at"),
        "evidence_urls": meta.get("evidence_urls"),
        # complaints has no created_at or updated_at: lodged_at, then the last
        # step the row records (a response, then a resolution).
        "created_at": row.get("lodged_at"),
        "updated_at": row.get("resolved_at") or meta.get("responded_at") or row.get("lodged_at"),
        "complainant_name": None,
        "against_name": None,
        "property_title": None,
    }


def flatten_maintenance(row: dict) -> dict:
    """A work order with its complaint embedded (maintenance.WORK_ORDER_SELECT) as MaintenanceOut.

    A repair is a complaints row plus its maintenance_work_orders row: the
    complaint holds what was reported (title in metadata, description,
    category, severity), the work order who does it and where it stands.
    """
    from app.services.maps_reviews_complaints import SEVERITY_TO_PRIORITY

    complaint = row.get("complaints") if isinstance(row.get("complaints"), dict) else {}
    meta = complaint.get("metadata") if isinstance(complaint.get("metadata"), dict) else {}
    description = complaint.get("description") or ""
    return {
        "id": row["id"],
        # MaintenanceOut needs both ids, but listing_id and landlord_user_id are
        # nullable; the complaint names the landlord too.
        "property_id": row.get("listing_id") or "",
        "tenant_id": row.get("tenant_user_id"),
        "owner_id": row.get("landlord_user_id") or complaint.get("against_user_id") or "",
        "provider_id": row.get("assigned_worker_id"),
        "booking_id": None,
        "category": (complaint.get("category") or "other").lower(),
        "priority": SEVERITY_TO_PRIORITY.get(complaint.get("severity"), "normal"),
        "status": MAINT_TO_WEB.get(str(row.get("status") or "OPEN").upper(), "open"),
        "title": meta.get("subject") or description.split("\n", 1)[0] or "Maintenance request",
        "description": description or "Maintenance request",
        "photo_urls": meta.get("photo_urls"),
        "access_notes": meta.get("access_notes"),
        "resolution_note": row.get("completion_note"),
        # The visit time once one is booked (mobile_schedule_repair).
        "assigned_at": row.get("appointment_at"),
        "resolved_at": row.get("completed_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "property_title": None,
        "property_address": None,
        "tenant_name": None,
        "owner_name": None,
        "provider_name": None,
    }


def flatten_inspection_slot(row: dict) -> dict:
    return {
        "id": row["id"],
        "property_id": row.get("listing_id"),
        "starts_at": row.get("starts_at"),
        "duration_minutes": row.get("duration_minutes"),
        # mobile_inspection_slots keeps neither.
        "capacity": None,
        "notes": None,
    }


def flatten_notification(row: dict) -> dict:
    """A notifications row as NotificationOut.

    The stored category is the shared enum (system, bid, social, project),
    which cannot tell a message from a review, so the web kind comes from
    the link (maps_messaging.web_notification_category). An empty body,
    which the NOT NULL column stores for "none", is None.
    """
    from app.services.maps_messaging import web_notification_category

    return {
        "id": row["id"],
        "user_id": row.get("user_id"),
        "category": web_notification_category(row.get("link")),
        "title": row.get("title") or "",
        "body": row.get("body") or None,
        "link_href": row.get("link"),
        "is_read": bool(row.get("is_read")),
        "created_at": row.get("created_at"),
    }


def _timestamp(now: datetime | None) -> str:
    return (now or datetime.now(timezone.utc)).isoformat()


def stamp_insert(table: str, row: dict, now: datetime | None = None) -> dict:
    """row plus the id and updated_at that a shared table needs but has no default for.

    Prisma leaves both to its client, and not every table has both columns,
    so the snapshot decides per table: sending updated_at to a table without
    it fails (PGRST204). Values the row already has are kept.
    """
    stamped = dict(row)
    required = schema.required_without_default(table)
    if "id" in required and stamped.get("id") is None:
        stamped["id"] = str(uuid.uuid4())
    if "updated_at" in required and stamped.get("updated_at") is None:
        stamped["updated_at"] = _timestamp(now)
    return stamped


def stamp_update(table: str, changes: dict, now: datetime | None = None) -> dict:
    """changes plus updated_at, if the shared table has that column.

    A column default fills it only on insert, and Prisma's @updatedAt is set
    by Prisma's client, not by the database. A value already given is kept.
    """
    stamped = dict(changes)
    if schema.has_column(table, "updated_at") and stamped.get("updated_at") is None:
        stamped["updated_at"] = _timestamp(now)
    return stamped
