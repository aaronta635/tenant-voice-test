"""The owner and tenant dashboards on the shared tables (plan §3 a5, a7), under the strict fake."""

import pytest

from tests.factories_dashboards import agreement_row, inspection_row
from tests.factories_rental import (
    MANAGER,
    NOW,
    OTHER_TENANT,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    new_id,
    seed_listing,
    seed_people,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"


@pytest.fixture
def owner_view(client, strict_schema, as_profile):
    seed_people(strict_schema)
    as_profile(id=OWNER, role="landlord")
    return strict_schema


@pytest.fixture
def tenant_view(client, strict_schema, as_profile):
    seed_people(strict_schema)
    as_profile(id=TENANT, role="tenant")
    return strict_schema


def _owner(client) -> dict:
    response = client.get(f"{API}/me/dashboard/owner")
    assert response.status_code == 200, response.text
    return response.json()


def _tenant(client) -> dict:
    response = client.get(f"{API}/me/dashboard/tenant")
    assert response.status_code == 200, response.text
    return response.json()


def test_the_owner_dashboard_counts_the_listings_of_owned_and_managed_properties(client, owner_view):
    ids = {status: seed_listing(owner_view, status=status)[0]
           for status in ("DRAFT", "PUBLISHED", "APPLICATIONS_CLOSED", "PAUSED", "LEASED", "ARCHIVED")}
    seed_listing(owner_view, owner=STRANGER, prop={"manager_user_id": OWNER})
    seed_listing(owner_view, owner=STRANGER, listing={"created_by_user_id": OWNER})  # created, not owned
    owner_view.seed("rental_applications", [
        application_row(ids["PUBLISHED"]),
        application_row(ids["PUBLISHED"], applicant=OTHER_TENANT, status="UNDER_REVIEW"),
        application_row(ids["LEASED"], status="APPROVED"),
        application_row(ids["ARCHIVED"]),  # the listing was deleted on the web
    ])
    # A lease counts once its agreement is active; an approved application alone is no lease.
    owner_view.seed("rent_agreements", [agreement_row(ids["LEASED"]), agreement_row(ids["PUBLISHED"], status="DRAFT")])

    body = _owner(client)

    assert body["property_count"] == 6
    # Closed to applications still shows as available.
    assert (body["available_count"], body["rented_count"]) == (3, 1)
    assert (body["application_count"], body["new_application_count"], body["active_lease_count"]) == (3, 1, 1)


def test_the_owner_dashboard_counts_only_requests_waiting_on_the_owner(client, owner_view):
    owner_view.seed("connection_requests", [
        {"id": new_id(), "sender_user_id": TENANT, "receiver_user_id": OWNER},  # PENDING by default
        {"id": new_id(), "sender_user_id": OTHER_TENANT, "receiver_user_id": OWNER, "status": "ACCEPTED"},
        {"id": new_id(), "sender_user_id": OWNER, "receiver_user_id": MANAGER},
        {"id": new_id(), "sender_user_id": TENANT, "receiver_user_id": STRANGER},
    ])
    owner_view.seed("notifications", [
        {"user_id": user, "title": "Hello", "body": "", "category": "system", "is_read": read}
        for user, read in ((OWNER, False), (OWNER, False), (OWNER, True), (TENANT, False))
    ])

    body = _owner(client)

    assert (body["pending_connections"], body["unread_notifications"]) == (1, 2)


def test_an_owner_with_nothing_yet_sees_zeros(client, owner_view):
    assert _owner(client) == {
        "property_count": 0, "available_count": 0, "rented_count": 0, "application_count": 0,
        "new_application_count": 0, "active_lease_count": 0, "occupancy_pct": None, "active_complaint_count": 0,
        "upcoming_inspection_count": 0, "upcoming_inspections": [], "review_count": 0, "rating_avg": None,
        "reviews_awaiting_reply": 0, "favourite_count": 0, "view_count": 0, "views_available": True, "view_days": 30,
        "listings": [],
        "unread_messages": 0, "pending_connections": 0, "unread_notifications": 0,
    }


def test_the_tenant_dashboard_shows_the_active_lease(client, tenant_view):
    old, _ = seed_listing(tenant_view, listing={"title": "Old flat", "weekly_rent": 500})
    current, _ = seed_listing(tenant_view, listing={"title": "Harbour flat", "weekly_rent": 650})
    approved, _ = seed_listing(tenant_view, listing={"title": "Approved, not signed"})
    elsewhere, _ = seed_listing(tenant_view, listing={"title": "Someone else's"})
    tenant_view.seed("rental_applications", [
        application_row(approved, status="APPROVED", last_status_at="2026-09-01T00:00:00+00:00"),
    ])
    tenant_view.seed("rent_agreements", [
        agreement_row(old, status="ENDED", start_date="2025-01-01"),
        agreement_row(current, rent_amount=1300, rent_frequency="FORTNIGHTLY", start_date="2026-03-01"),
        agreement_row(approved, status="DRAFT", start_date="2026-10-01"),
        agreement_row(elsewhere, tenant=OTHER_TENANT, start_date="2026-05-01"),
    ])

    body = _tenant(client)

    assert (body["has_tenancy"], body["listing_id"], body["listing_title"]) == (True, current, "Harbour flat")
    lease = body["lease"]
    assert (lease["rent_amount"], lease["rent_frequency"], lease["start_date"]) == (1300, "FORTNIGHTLY", "2026-03-01")
    assert lease["address"] == "1 Harbour Street, Wollongong, NSW 2500"


def test_the_tenant_dashboard_counts_open_repairs_in_either_case(client, tenant_view):
    # maintenance_work_orders_status_check allows these alone; the first four are still open.
    statuses = ["OPEN", "ASSIGNED", "SCHEDULED", "PENDING_TENANT_CONFIRMATION", "RESOLVED"]
    # Spellings from before the CHECK read the same way, in either case: put on stored rows after the seed.
    older = ["open", "IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED", "cancelled"]
    tenant_view.seed("maintenance_work_orders", [
        {"complaint_id": new_id(), "tenant_user_id": TENANT, "status": status, "updated_at": NOW}
        for status in statuses + ["OPEN"] * len(older)
    ] + [{"complaint_id": new_id(), "tenant_user_id": OTHER_TENANT, "updated_at": NOW}])
    for row, status in zip(tenant_view.tables["maintenance_work_orders"][len(statuses):], older):
        row["status"] = status

    assert _tenant(client)["open_maintenance"] == 6


def test_the_tenant_dashboard_counts_upcoming_inspections_of_the_home(client, tenant_view):
    home, _ = seed_listing(tenant_view)
    elsewhere, _ = seed_listing(tenant_view)
    tenant_view.seed("rent_agreements", [agreement_row(home)])
    tenant_view.seed("mobile_inspections", [
        inspection_row(home, "2099-01-01T10:00:00+00:00"),
        inspection_row(home, "2000-01-01T10:00:00+00:00"),
        inspection_row(home, "2099-02-01T10:00:00+00:00", "Cancelled"),
        inspection_row(elsewhere, "2099-01-01T10:00:00+00:00"),
    ])
    # Open-home slots are for people looking to rent, not for the tenant.
    tenant_view.seed("mobile_inspection_slots", [
        {"owner_id": OWNER, "listing_id": home, "starts_at": "2099-01-05T10:00:00+00:00", "duration_minutes": 30},
    ])

    assert _tenant(client)["upcoming_inspections"] == 1


def test_a_tenant_without_a_tenancy_sees_none(client, tenant_view):
    listing_id, _ = seed_listing(tenant_view)
    tenant_view.seed("rental_applications", [application_row(listing_id, status="UNDER_REVIEW")])

    tenant_view.seed("rent_agreements", [agreement_row(listing_id, status="DRAFT")])

    body = _tenant(client)

    assert (body["has_tenancy"], body["listing_id"], body["lease"], body["upcoming_inspections"]) == (
        False, None, None, 0,
    )
    assert (body["next_payment"], body["overdue_count"], body["overdue_amount"]) == (None, 0, 0)
