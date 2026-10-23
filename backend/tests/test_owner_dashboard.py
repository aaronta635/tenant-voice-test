"""The owner's dashboard and listing analytics (tracker R28), under the strict fake.

Each figure counts the rows it names: occupancy the listings with an ACTIVE
rent agreement, complaints what the owner's Complaints page shows as open
or under review, upcoming inspections the accepted open-home bookings and
scheduled inspections still to come, reviews the PUBLISHED ones,
favourites the listing_favorites rows and views the web.listing_views rows.
"""

from datetime import date

import pytest
from postgrest.exceptions import APIError

from app.services import dashboard, listing_views
from tests.factories_dashboards import (
    FUTURE,
    PAST,
    agreement_row,
    complaint_row,
    favourite_row,
    inspection_row,
    seed_booking,
    view_rows,
    work_order_row,
)
from tests.factories_rental import (
    MANAGER,
    NOW,
    OTHER_TENANT,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    review_row,
    seed_listing,
    seed_people,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/dashboard"
TODAY = date(2026, 10, 23)


@pytest.fixture
def owner_view(client, strict_schema, as_profile, monkeypatch):
    seed_people(strict_schema)
    monkeypatch.setattr(dashboard, "_local_today", lambda: TODAY)
    as_profile(id=OWNER, role="landlord")
    return strict_schema


def _owner(client) -> dict:
    response = client.get(f"{API}/owner")
    assert response.status_code == 200, response.text
    return response.json()


def _row(body: dict, listing_id: str) -> dict:
    return next(row for row in body["listings"] if row["id"] == listing_id)


def _analytics(client, listing_id: str, days: int | None = None) -> dict:
    response = client.get(f"{API}/owner/properties/{listing_id}", params={"days": days} if days else None)
    assert response.status_code == 200, response.text
    return response.json()


# -- occupancy ------------------------------------------------------------------------
def test_occupancy_counts_the_listings_with_an_active_agreement(client, owner_view):
    signed, _ = seed_listing(owner_view, status="LEASED")
    approved, _ = seed_listing(owner_view, status="LEASED")  # approved, agreement not activated yet
    ended, _ = seed_listing(owner_view)
    empty, _ = seed_listing(owner_view)
    owner_view.seed("rent_agreements", [
        agreement_row(signed),
        agreement_row(approved, status="DRAFT"),
        agreement_row(ended, status="ENDED", end_date="2026-06-30"),
    ])

    body = _owner(client)

    assert (body["active_lease_count"], body["occupancy_pct"]) == (1, 25.0)
    assert [_row(body, listing)["occupied"] for listing in (signed, approved, ended, empty)] == [True, False, False, False]
    # Marked leased is not occupied: rented_count still follows the listing status.
    assert body["rented_count"] == 2


def test_occupancy_changes_only_when_an_agreement_is_activated(client, owner_view):
    leased, _ = seed_listing(owner_view, status="LEASED")
    seed_listing(owner_view)
    agreement = agreement_row(leased, status="DRAFT")
    owner_view.seed("rent_agreements", [agreement])
    stored = owner_view.tables["rent_agreements"][0]

    assert _owner(client)["occupancy_pct"] == 0.0
    stored.update(tenant_confirmed_at=NOW)
    assert _owner(client)["occupancy_pct"] == 0.0
    stored.update(status="ACTIVE", activated_at=NOW)
    assert (_owner(client)["occupancy_pct"], _owner(client)["active_lease_count"]) == (50.0, 1)
    stored.update(status="ENDED")
    assert _owner(client)["occupancy_pct"] == 0.0


# -- complaints -----------------------------------------------------------------------
def test_active_complaints_are_those_the_complaints_page_shows_open_or_under_review(client, owner_view):
    _, home = seed_listing(owner_view)
    _, managed = seed_listing(owner_view, owner=STRANGER, prop={"manager_user_id": OWNER})
    repair = complaint_row(property_id=home)
    owner_view.seed("complaints", [
        complaint_row(against_user_id=OWNER),
        complaint_row(property_id=home, status="IN_REVIEW"),
        complaint_row(property_id=home, status="ESCALATED"),
        complaint_row(property_id=home, status="RESOLVED"),
        complaint_row(against_user_id=OWNER, status="CLOSED", metadata={"dismissed": True}),
        complaint_row(against_user_id=STRANGER, property_id=managed),  # the owner of that home is someone else
        complaint_row(reporter=OWNER, against_user_id=TENANT),  # lodged by the owner
        repair,  # a repair is not a complaint on the web
    ])
    owner_view.seed("maintenance_work_orders", [work_order_row(repair["id"])])

    page = client.get("/api/v1/complaints/against-me").json()

    active = [row for row in page if row["status"] in ("open", "under_review")]
    assert _owner(client)["active_complaint_count"] == len(active) == 3


# -- inspections ----------------------------------------------------------------------
def test_upcoming_inspections_are_accepted_bookings_and_scheduled_inspections_to_come(client, owner_view):
    home, _ = seed_listing(owner_view, listing={"title": "Harbour flat"})
    other, _ = seed_listing(owner_view, listing={"title": "Garden house"})
    strangers, _ = seed_listing(owner_view, owner=STRANGER)
    soonest = seed_booking(owner_view, home, "2099-01-02T09:00:00+00:00")
    # Each at its own time: one open, held or booked slot per listing and start
    # (mobile_inspection_slots_listing_start_active_idx).
    seed_booking(owner_view, home, FUTURE, status="pending", tenant=OTHER_TENANT)
    seed_booking(owner_view, home, "2099-01-05T01:00:00+00:00", status="rejected", tenant=OTHER_TENANT)
    seed_booking(owner_view, home, "2099-01-05T02:00:00+00:00", status="reschedule_requested", tenant=OTHER_TENANT)
    seed_booking(owner_view, home, PAST)
    seed_booking(owner_view, other, FUTURE, slot_status="cancelled")
    seed_booking(owner_view, strangers, FUTURE)
    later = inspection_row(other, "2099-03-01T01:00:00+00:00", kind="Entry condition")
    owner_view.seed("mobile_inspections", [
        later,
        inspection_row(home, PAST),
        inspection_row(home, FUTURE, status="Completed"),
        inspection_row(home, FUTURE, status="Cancelled"),
        inspection_row(strangers, FUTURE, owner=STRANGER),
    ])

    body = _owner(client)

    assert body["upcoming_inspection_count"] == 2
    assert [(item["id"], item["kind"], item["label"], item["listing_title"]) for item in body["upcoming_inspections"]] == [
        (soonest["id"], "booking", "Open home booking", "Harbour flat"),
        (later["id"], "inspection", "Entry condition", "Garden house"),
    ]
    assert body["upcoming_inspections"][0]["starts_at"] == "2099-01-02T09:00:00Z"
    assert (_row(body, home)["upcoming_inspection_count"], _row(body, other)["upcoming_inspection_count"]) == (1, 1)


def test_the_dashboard_lists_the_first_five_upcoming_inspections_and_counts_them_all(client, owner_view):
    home, _ = seed_listing(owner_view)
    owner_view.seed("mobile_inspections", [inspection_row(home, f"2099-01-0{day}T00:00:00+00:00") for day in range(1, 8)])

    body = _owner(client)

    assert body["upcoming_inspection_count"] == 7
    assert [item["starts_at"][:10] for item in body["upcoming_inspections"]] == [f"2099-01-0{day}" for day in range(1, 6)]


# -- reviews, favourites, views, applications ------------------------------------------
def test_review_figures_count_the_published_reviews_of_the_owners_homes(client, owner_view):
    home, home_property = seed_listing(owner_view)
    managed, managed_property = seed_listing(owner_view, owner=STRANGER, prop={"manager_user_id": OWNER})
    _, strangers = seed_listing(owner_view, owner=STRANGER)
    owner_view.seed("reviews", [
        review_row(home_property, 5, landlord_reply="Thank you!"),
        review_row(home_property, 4, reviewer_user_id=OTHER_TENANT),
        review_row(managed_property, 3, reviewer_user_id=MANAGER),
        review_row(home_property, 1, status="HIDDEN", reviewer_user_id=STRANGER),
        review_row(home_property, 2, status="FLAGGED", reviewer_user_id=OWNER),
        review_row(strangers, 5),
    ])

    body = _owner(client)

    assert (body["review_count"], body["rating_avg"], body["reviews_awaiting_reply"]) == (3, 4.0, 2)
    assert (_row(body, home)["review_count"], _row(body, home)["rating_avg"]) == (2, 4.5)
    assert (_row(body, managed)["review_count"], _row(body, managed)["rating_avg"]) == (1, 3.0)


def test_favourites_and_the_last_30_days_of_views_count_per_listing(client, owner_view, monkeypatch):
    home, _ = seed_listing(owner_view)
    other, _ = seed_listing(owner_view)
    strangers, _ = seed_listing(owner_view, owner=STRANGER)
    owner_view.seed("listing_favorites", [
        favourite_row(home), favourite_row(home, OTHER_TENANT), favourite_row(other), favourite_row(strangers),
    ])
    owner_view.seed("listing_views", view_rows(home, "2026-10-23", 3) + view_rows(home, "2026-09-24", 2)
                    + view_rows(home, "2026-09-23", 5) + view_rows(other, "2026-10-01", 1)
                    + view_rows(strangers, "2026-10-23", 4), schema="web")

    # The database counts each listing's views: the dashboard reads no view row.
    monkeypatch.setattr(listing_views, "select_in", lambda *args, **kwargs: pytest.fail("view rows read"))

    body = _owner(client)

    assert (body["favourite_count"], body["view_count"], body["view_days"]) == (3, 6, 30)
    assert [(_row(body, listing)["favourite_count"], _row(body, listing)["view_count"]) for listing in (home, other)] == [
        (2, 5), (1, 1),
    ]


def test_applications_per_listing_leave_out_the_withdrawn_and_expired(client, owner_view):
    home, _ = seed_listing(owner_view)
    other, _ = seed_listing(owner_view)
    owner_view.seed("rental_applications", [
        application_row(home),
        application_row(home, applicant=OTHER_TENANT, status="SHORTLISTED"),
        application_row(home, applicant=STRANGER, status="WITHDRAWN"),
        application_row(other, status="EXPIRED"),
        application_row(other, applicant=OTHER_TENANT, status="REJECTED"),
    ])

    body = _owner(client)

    assert [(_row(body, listing)["application_count"], _row(body, listing)["new_application_count"])
            for listing in (home, other)] == [(2, 1), (1, 0)]
    assert (body["application_count"], body["new_application_count"]) == (3, 1)
    # As My properties counts them.
    cards = {card["id"]: card["application_count"] for card in client.get("/api/v1/me/properties").json()}
    assert cards == {home: 2, other: 1}


def test_a_listing_row_names_the_listing_and_its_status(client, owner_view):
    draft, _ = seed_listing(owner_view, status="DRAFT", listing={"title": "Studio, not yet listed"})
    seed_listing(owner_view, status="ARCHIVED")

    body = _owner(client)

    assert body["listings"] == [{
        "id": draft, "title": "Studio, not yet listed", "listing_status": "draft", "occupied": False,
        "application_count": 0, "new_application_count": 0, "view_count": 0, "favourite_count": 0,
        "review_count": 0, "rating_avg": None, "upcoming_inspection_count": 0,
    }]


# -- the listing analytics ---------------------------------------------------------------
def test_a_listings_analytics_count_each_figure_from_its_rows(client, owner_view):
    home, home_property = seed_listing(owner_view, status="LEASED", listing={
        "title": "Harbour flat", "published_at": "2026-09-01T00:00:00+00:00",
    })
    other, _ = seed_listing(owner_view)
    owner_view.seed("listing_views", view_rows(home, "2026-10-23", 2) + view_rows(home, "2026-10-17", 1)
                    + view_rows(home, "2026-10-16", 4) + view_rows(other, "2026-10-23", 9), schema="web")
    owner_view.seed("listing_favorites", [
        favourite_row(home, created_at="2026-10-20T00:00:00+00:00"),
        favourite_row(home, OTHER_TENANT, created_at="2026-09-01T00:00:00+00:00"),
        favourite_row(other),
    ])
    owner_view.seed("rental_applications", [
        application_row(home, status="APPROVED", submitted_at="2026-09-02T00:00:00+00:00"),
        application_row(home, applicant=OTHER_TENANT, status="SHORTLISTED", submitted_at="2026-10-18T00:00:00+00:00"),
        application_row(home, applicant=STRANGER, status="WITHDRAWN", submitted_at="2026-10-19T00:00:00+00:00"),
        application_row(home, applicant=MANAGER, status="REJECTED", submitted_at="2026-08-01T00:00:00+00:00"),
        application_row(other),
    ])
    soonest = seed_booking(owner_view, home, "2099-01-02T09:00:00+00:00")
    seed_booking(owner_view, home, FUTURE, status="pending", tenant=OTHER_TENANT)
    seed_booking(owner_view, home, PAST, status="cancelled", tenant=OTHER_TENANT)
    seed_booking(owner_view, other, FUTURE)
    owner_view.seed("mobile_inspections", [inspection_row(home, PAST, status="Completed")])
    owner_view.seed("reviews", [
        review_row(home_property, 5, landlord_reply="Thanks"),
        review_row(home_property, 3, reviewer_user_id=OTHER_TENANT),
        review_row(home_property, 3, reviewer_user_id=STRANGER),
        review_row(home_property, 1, status="HIDDEN", reviewer_user_id=MANAGER),
    ])
    lease = agreement_row(home, rent_amount=2800, rent_frequency="MONTHLY", start_date="2026-09-15", end_date="2027-09-14")
    owner_view.seed("rent_agreements", [lease, agreement_row(home, status="ENDED", tenant=OTHER_TENANT)])

    body = _analytics(client, home, days=7)

    assert (body["property_id"], body["title"], body["listing_status"]) == (home, "Harbour flat", "leased")
    assert (body["days"], body["start"], body["end"]) == (7, "2026-10-17", "2026-10-23")
    assert body["views"]["daily"] == [
        {"date": day, "count": count} for day, count in (
            ("2026-10-17", 1), ("2026-10-18", 0), ("2026-10-19", 0), ("2026-10-20", 0), ("2026-10-21", 0),
            ("2026-10-22", 0), ("2026-10-23", 2),
        )
    ]
    assert (body["views"]["total"], body["views"]["period"]) == (7, 3)
    assert body["favourites"] == {"total": 2, "period": 1}
    assert body["applications"] == {
        "total": 4, "period": 2, "new": 0, "reviewing": 1, "shortlisted": 1, "approved": 1, "declined": 1,
        "withdrawn": 1, "expired": 0,
    }
    inspections = body["inspections"]
    assert (inspections["bookings"], inspections["accepted"], inspections["pending"], inspections["cancelled"]) == (3, 1, 1, 1)
    assert (inspections["upcoming_count"], [item["id"] for item in inspections["upcoming"]]) == (1, [soonest["id"]])
    assert body["reviews"] == {
        "count": 3, "rating_avg": 3.67, "awaiting_reply": 2,
        "distribution": [{"rating": 5, "count": 1}, {"rating": 4, "count": 0}, {"rating": 3, "count": 2},
                         {"rating": 2, "count": 0}, {"rating": 1, "count": 0}],
    }
    assert body["lease"] == {"agreement_id": lease["id"], "start_date": "2026-09-15", "end_date": "2027-09-14",
                             "rent_amount": 2800.0, "rent_frequency": "MONTHLY"}


@pytest.mark.parametrize("days", [7, 30, 90])
def test_the_views_run_day_by_day_over_the_range(client, owner_view, days):
    home, _ = seed_listing(owner_view)

    body = _analytics(client, home, days)

    assert len(body["views"]["daily"]) == days
    assert body["views"]["daily"][-1]["date"] == "2026-10-23"
    assert (body["lease"], body["reviews"]["rating_avg"]) == (None, None)


def test_the_analytics_default_to_30_days_and_refuse_other_ranges(client, owner_view):
    home, _ = seed_listing(owner_view)

    assert _analytics(client, home)["days"] == 30
    assert client.get(f"{API}/owner/properties/{home}", params={"days": 365}).status_code == 422


def test_a_manager_reads_the_analytics_of_a_listing_they_manage(client, owner_view, as_profile):
    managed, _ = seed_listing(owner_view, owner=STRANGER, prop={"manager_user_id": MANAGER})
    as_profile(id=MANAGER, role="landlord")

    assert _analytics(client, managed)["property_id"] == managed
    assert [row["id"] for row in _owner(client)["listings"]] == [managed]


# -- who may read them ---------------------------------------------------------------
@pytest.mark.parametrize("role", ["tenant", "service_provider", "admin", "officer"])
def test_only_landlords_read_the_owner_dashboard_and_analytics(client, owner_view, as_profile, role):
    home, _ = seed_listing(owner_view)
    as_profile(id=TENANT, role=role)

    assert client.get(f"{API}/owner").status_code == 403
    assert client.get(f"{API}/owner/properties/{home}").status_code == 403


@pytest.mark.parametrize("status", ["PUBLISHED", "ARCHIVED"])
def test_another_owners_or_an_archived_listing_is_not_found(client, owner_view, status):
    strangers, _ = seed_listing(owner_view, owner=STRANGER, status=status)
    archived, _ = seed_listing(owner_view, status="ARCHIVED")

    assert client.get(f"{API}/owner/properties/{strangers}").status_code == 404
    assert client.get(f"{API}/owner/properties/{archived}").status_code == 404
    assert client.get(f"{API}/owner/properties/not-a-listing").status_code == 404


def test_another_owners_rows_never_reach_the_dashboard(client, owner_view):
    strangers, strangers_property = seed_listing(owner_view, owner=STRANGER)
    owner_view.seed("rent_agreements", [agreement_row(strangers, owner=STRANGER)])
    owner_view.seed("listing_favorites", [favourite_row(strangers)])
    owner_view.seed("reviews", [review_row(strangers_property, 5, reviewed_user_id=STRANGER)])
    owner_view.seed("rental_applications", [application_row(strangers)])
    owner_view.seed("listing_views", view_rows(strangers, "2026-10-23", 3), schema="web")
    seed_booking(owner_view, strangers, FUTURE)

    body = _owner(client)

    assert (body["property_count"], body["active_lease_count"], body["favourite_count"], body["review_count"],
            body["application_count"], body["view_count"], body["upcoming_inspection_count"]) == (0, 0, 0, 0, 0, 0, 0)


def test_the_dashboard_and_analytics_answer_before_the_views_table_exists(client, owner_view, monkeypatch):
    home, _ = seed_listing(owner_view)
    owner_view.seed("listing_favorites", [favourite_row(home)])
    real = listing_views.web_table

    def missing(name):
        if name == listing_views.TABLE:
            raise APIError({"code": "PGRST205", "message": "Could not find the table 'web.listing_views' in the schema cache"})
        return real(name)

    monkeypatch.setattr(listing_views, "web_table", missing)

    body = _owner(client)
    analytics = client.get(f"{API}/owner/properties/{home}", params={"days": 7})

    assert (body["view_count"], body["views_available"], body["favourite_count"]) == (None, False, 1)
    assert _row(body, home)["view_count"] is None
    assert analytics.status_code == 200, analytics.text
    assert analytics.json()["views"] == {"available": False, "total": None, "period": None, "daily": []}
    assert analytics.json()["favourites"]["total"] == 1


def test_the_shells_badges_count_without_the_rest_of_the_dashboard(client, owner_view, monkeypatch):
    home, _ = seed_listing(owner_view)
    managed, _ = seed_listing(owner_view, owner=STRANGER, prop={"manager_user_id": OWNER})
    strangers, _ = seed_listing(owner_view, owner=STRANGER)
    owner_view.seed("rental_applications", [
        application_row(home), application_row(home, applicant=OTHER_TENANT, status="SHORTLISTED"),
        application_row(managed), application_row(strangers),
    ])
    owner_view.seed("notifications", [
        {"id": f"c5000000-0000-4000-8000-00000000000{index}", "user_id": OWNER, "title": "Hi", "body": "Hi",
         "category": "system", "is_read": index == 2} for index in (1, 2)
    ])
    monkeypatch.setattr(dashboard.complaints_service, "list_complaints_against_me", lambda *args: pytest.fail("complaints read"))
    monkeypatch.setattr(listing_views, "period_counts", lambda *args, **kwargs: pytest.fail("views read"))

    response = client.get(f"{API}/owner/badges")

    assert response.status_code == 200, response.text
    assert response.json() == {"new_application_count": 2, "unread_messages": 0, "pending_connections": 0,
                               "unread_notifications": 1}


@pytest.mark.parametrize("role", ["tenant", "service_provider", "admin"])
def test_only_owners_get_the_shells_badges(client, owner_view, as_profile, role):
    as_profile(id=OWNER, role=role)

    assert client.get(f"{API}/owner/badges").status_code == 403
