"""Rows of the shared schema for complaints, repairs, reviews, content and inspections.

Each holds every NOT NULL column without a default, so strict seeds take
them (docs/shared-db.md). Pass the rest as keyword arguments.
"""

NOW = "2026-01-01T00:00:00+00:00"


def user(id, full_name, primary_role="TENANT", **over) -> dict:
    return {"id": id, "email": f"{id}@example.test", "full_name": full_name, "primary_role": primary_role,
            "updated_at": NOW, **over}


def property_row(id, owner_id, **over) -> dict:
    return {"id": id, "owner_user_id": owner_id, "address_line_1": "12 Harbour St", "suburb": "Wollongong",
            "state": "NSW", "postcode": "2500", "updated_at": NOW, **over}


def listing(id, property_id, created_by, title="Harbour flat", **over) -> dict:
    return {"id": id, "property_id": property_id, "created_by_user_id": created_by, "title": title,
            "weekly_rent": 650, "status": "PUBLISHED", "updated_at": NOW, **over}


def seed_rental(db, owner_id, property_id, listing_id, created_by=None, title="Harbour flat") -> None:
    """A property its owner holds, listed by created_by (an agent, say), or by the owner."""
    db.seed("properties", [property_row(property_id, owner_id)])
    db.seed("listings", [listing(listing_id, property_id, created_by or owner_id, title)])


def complaint(id, reporter_id, description="The heater has been broken for three weeks.", **over) -> dict:
    return {"id": id, "reporter_user_id": reporter_id, "category": "maintenance", "description": description,
            "lodged_at": NOW, **over}


def work_order(id, complaint_id, tenant_id, **over) -> dict:
    return {"id": id, "complaint_id": complaint_id, "tenant_user_id": tenant_id, "created_at": NOW,
            "updated_at": NOW, **over}


def events(db, complaint_id) -> list[dict]:
    """The complaint's timeline, oldest first."""
    return [row for row in db.tables.get("complaint_events", []) if row["complaint_id"] == complaint_id]


def application(id, listing_id, applicant_id, status="APPROVED", **over) -> dict:
    return {"id": id, "listing_id": listing_id, "applicant_user_id": applicant_id, "status": status,
            "offer_weekly_rent": 650, "updated_at": NOW, **over}


def review(id, reviewer_id, reviewed_id, rating=5, **over) -> dict:
    return {"id": id, "reviewer_user_id": reviewer_id, "reviewed_user_id": reviewed_id, "rating": rating,
            "landlord_rating": rating, "status": "PUBLISHED", "created_at": NOW, "updated_at": NOW, **over}


def provider_profile(user_id, company_name, **over) -> dict:
    return {"user_id": user_id, "company_name": company_name, "updated_at": NOW, **over}


def profile_document(id, user_id, review_status="APPROVED", **over) -> dict:
    return {"id": id, "user_id": user_id, "document_type": "TRADE_LICENCE", "file_url": f"verification/{user_id}/doc.pdf",
            "review_status": review_status, "updated_at": NOW, **over}


def slot(id, owner_id, listing_id, starts_at, duration_minutes=45, **over) -> dict:
    return {"id": id, "owner_id": owner_id, "listing_id": listing_id, "starts_at": starts_at,
            "duration_minutes": duration_minutes, **over}
