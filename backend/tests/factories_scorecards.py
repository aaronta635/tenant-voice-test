"""Rows for the scorecard tests (R43): a tenant, the owner and agent of the homes they rent or rented, and strangers.

Tanya applied to Olivia's Harbour Street home, which Avery manages, and
Olivia approved it. Tanya also leased Olivia's Beach Road home, a lease that
has ended; its application has expired since. Sam owns a third home Tanya
never rented. Each row has every NOT NULL column the shared database has no
default for, so strict seeds take it.
"""

NOW = "2026-01-01T00:00:00+00:00"

TENANT = "e1000000-0000-4000-8000-000000000001"
OTHER_TENANT = "e1000000-0000-4000-8000-000000000002"
OWNER = "e2000000-0000-4000-8000-000000000001"
AGENT = "e2000000-0000-4000-8000-000000000002"
STRANGER = "e2000000-0000-4000-8000-000000000003"
PROVIDER = "e3000000-0000-4000-8000-000000000001"
ADMIN = "e3000000-0000-4000-8000-000000000002"

HOME = "e4000000-0000-4000-8000-000000000001"
LEASED_HOME = "e4000000-0000-4000-8000-000000000002"
OTHER_HOME = "e4000000-0000-4000-8000-000000000003"
HOME_LISTING = "e5000000-0000-4000-8000-000000000001"
LEASE_LISTING = "e5000000-0000-4000-8000-000000000002"
OTHER_LISTING = "e5000000-0000-4000-8000-000000000003"
APPROVED_APPLICATION = "e6000000-0000-4000-8000-000000000001"
LEASE_APPLICATION = "e6000000-0000-4000-8000-000000000002"
OTHER_APPLICATION = "e6000000-0000-4000-8000-000000000003"
LEASE = "e7000000-0000-4000-8000-000000000001"

# The seven ratings in the scorecard's order: 32 out of 35, an average of 4.57.
ANSWERS = {
    "paid_rent_on_time": 5,
    "looked_after_property": 5,
    "communicated_respectfully": 4,
    "followed_lease_conditions": 4,
    "cooperated_with_inspections": 5,
    "left_property_in_good_condition": 4,
    "would_rent_again": 5,
}


def user(id, full_name, primary_role="TENANT", **over) -> dict:
    return {"id": id, "email": f"{id}@example.test", "full_name": full_name, "primary_role": primary_role,
            "updated_at": NOW, **over}


def home(id, owner_id, address, suburb, manager_id=None, **over) -> dict:
    return {"id": id, "owner_user_id": owner_id, "manager_user_id": manager_id, "address_line_1": address,
            "suburb": suburb, "state": "NSW", "postcode": "2500", "updated_at": NOW, **over}


def listing(id, property_id, created_by, title="Harbour flat", **over) -> dict:
    return {"id": id, "property_id": property_id, "created_by_user_id": created_by, "title": title,
            "weekly_rent": 650, "status": "LEASED", "updated_at": NOW, **over}


def application(id, listing_id, applicant_id, status="APPROVED", **over) -> dict:
    return {"id": id, "listing_id": listing_id, "applicant_user_id": applicant_id, "status": status,
            "offer_weekly_rent": 650, "updated_at": NOW, **over}


def lease(id, application_id, listing_id, tenant_id, owner_id, **over) -> dict:
    return {"id": id, "application_id": application_id, "listing_id": listing_id, "tenant_user_id": tenant_id,
            "owner_user_id": owner_id, "rent_amount": 650, "rent_frequency": "WEEKLY", "start_date": "2025-01-01",
            "end_date": "2025-12-31", "first_due_date": "2025-01-08", "status": "ENDED",
            "activated_at": "2025-01-01T00:00:00+00:00", **over}


def seed_rentals(db) -> None:
    """The people and homes of the module docstring."""
    db.seed("users", [
        user(TENANT, "Tanya Tenant"),
        user(OTHER_TENANT, "Theo Tenant"),
        user(OWNER, "Olivia Owner", "LANDLORD"),
        user(AGENT, "Avery Agent", "AGENT"),
        user(STRANGER, "Sam Stranger", "LANDLORD"),
        user(PROVIDER, "Pia Provider", "SERVICE_PROVIDER"),
        user(ADMIN, "Ada Admin", "ADMIN"),
    ])
    db.seed("properties", [
        home(HOME, OWNER, "1 Harbour Street", "Wollongong", manager_id=AGENT),
        home(LEASED_HOME, OWNER, "7 Beach Road", "Thirroul"),
        home(OTHER_HOME, STRANGER, "3 Hill Lane", "Kiama"),
    ])
    db.seed("listings", [
        listing(HOME_LISTING, HOME, AGENT),
        listing(LEASE_LISTING, LEASED_HOME, OWNER, title="Beach cottage"),
        listing(OTHER_LISTING, OTHER_HOME, STRANGER, title="Hill house", status="PUBLISHED"),
    ])
    db.seed("rental_applications", [
        application(APPROVED_APPLICATION, HOME_LISTING, TENANT),
        application(LEASE_APPLICATION, LEASE_LISTING, TENANT, status="EXPIRED"),
        application(OTHER_APPLICATION, OTHER_LISTING, TENANT, status="SUBMITTED"),
    ])
    db.seed("rent_agreements", [lease(LEASE, LEASE_APPLICATION, LEASE_LISTING, TENANT, OWNER)])


def requests(db) -> list[dict]:
    """The web.scorecard_requests rows."""
    return db.schema_tables.get("web", {}).get("scorecard_requests", [])


def notices(db, user_id) -> list[dict]:
    return [row for row in db.tables.get("notifications", []) if row["user_id"] == user_id]
