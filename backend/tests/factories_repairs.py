"""A rental with a repair to move along, as the shared functions see it (services/maintenance.py).

The owner's flat, an approved application for the tenant (what
mobile_create_repair and mobile_owner_create_repair read), a verified
plumber whose service_categories cover plumbing, and a verified cleaner
whose GENERAL code does not. Each person signs in with a token their
functions run as (factories_provider_core.jwt_for).
"""

from tests.factories_provider_core import jwt_for
from tests.factories_reviews_complaints import NOW, application, complaint, property_row, listing, work_order

TENANT = "a6000000-0000-4000-8000-000000000001"
OWNER = "a6000000-0000-4000-8000-000000000002"
PLUMBER = "a6000000-0000-4000-8000-000000000003"
CLEANER = "a6000000-0000-4000-8000-000000000004"
OTHER_OWNER = "a6000000-0000-4000-8000-000000000005"
OTHER_TENANT = "a6000000-0000-4000-8000-000000000006"
PROPERTY = "b6000000-0000-4000-8000-000000000001"
LISTING = "b6000000-0000-4000-8000-000000000002"
EMPTY_PROPERTY = "b6000000-0000-4000-8000-000000000003"
EMPTY_LISTING = "b6000000-0000-4000-8000-000000000004"
APPLICATION = "b6000000-0000-4000-8000-000000000005"
REPAIR = "c6000000-0000-4000-8000-000000000001"
REQUEST = "d6000000-0000-4000-8000-000000000001"
ROLES = {"TENANT": "tenant", "LANDLORD": "landlord", "SERVICE_PROVIDER": "service_provider", "ADMIN": "admin"}


def _person(id, full_name, primary_role, **over) -> dict:
    return {"id": id, "email": f"{id}@example.test", "full_name": full_name, "primary_role": primary_role,
            "status": "ACTIVE", "updated_at": NOW, **over}


def seed_world(db) -> None:
    db.seed("users", [
        _person(TENANT, "Jane Tenant", "TENANT"),
        _person(OTHER_TENANT, "Nosy Neighbour", "TENANT"),
        _person(OWNER, "Olivia Owner", "LANDLORD"),
        _person(OTHER_OWNER, "Oscar Other", "LANDLORD"),
        _person(PLUMBER, "Pat Plumber", "SERVICE_PROVIDER", verification_status="APPROVED"),
        _person(CLEANER, "Cleo Cleaner", "SERVICE_PROVIDER", verification_status="APPROVED"),
    ])
    db.seed("service_provider_profiles", [
        {"user_id": PLUMBER, "company_name": "Pat's Plumbing", "service_categories": ["PLUMBING", "LEAK", "GENERAL"],
         "service_area": "Wollongong", "pricing_summary": "From $90", "verification_status": "APPROVED",
         "metadata": {"category": "tradie"}, "updated_at": NOW},
        {"user_id": CLEANER, "company_name": "Cleo Cleans", "service_categories": ["GENERAL"],
         "verification_status": "APPROVED", "metadata": {"category": "cleaner"}, "updated_at": NOW},
    ])
    db.seed("properties", [property_row(PROPERTY, OWNER), property_row(EMPTY_PROPERTY, OWNER, address_line_1="3 Bay Rd")])
    db.seed("listings", [listing(LISTING, PROPERTY, OWNER, "Harbour flat", status="LEASED"),
                         listing(EMPTY_LISTING, EMPTY_PROPERTY, OWNER, "Bay cottage")])
    db.seed("rental_applications", [application(APPLICATION, LISTING, TENANT, last_status_at=NOW)])


def seed_repair(db, status="OPEN", worker=None, category="PLUMBING", **order) -> None:
    """A repair as mobile_create_repair leaves it, then moved to status by hand."""
    db.seed("complaints", [complaint(
        REPAIR, TENANT, description="Water coming through the kitchen ceiling.", against_user_id=OWNER,
        property_id=PROPERTY, category=category, severity="HIGH",
        metadata={"listingId": LISTING, "source": "tenant_listing_maintenance", "createdByRole": "TENANT",
                  "mobile": {"issueTitle": "Burst pipe", "photos": [], "createdBy": TENANT}},
        status=order.pop("complaint_status", "OPEN"),
    )])
    db.seed("maintenance_work_orders", [work_order(
        REQUEST, REPAIR, TENANT, listing_id=order.pop("listing_id", LISTING), landlord_user_id=OWNER,
        assigned_worker_id=worker, status=status, **order,
    )])


def sign_in(as_profile, db, user_id: str):
    """Requests as that seeded person, with the token their shared functions run on."""
    person = next(row for row in db.tables["users"] if row["id"] == user_id)
    return as_profile(id=user_id, role=ROLES[person["primary_role"]], full_name=person["full_name"],
                      access_token=jwt_for(db, user_id))


def work_order_of(db, request_id=REQUEST) -> dict:
    return next(row for row in db.tables["maintenance_work_orders"] if row["id"] == request_id)


def case_of(db, complaint_id=REPAIR) -> dict:
    return next(row for row in db.tables["complaints"] if row["id"] == complaint_id)
