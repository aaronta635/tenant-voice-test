"""The admin console's analytics (tracker R40): counts over time from the rows themselves.

New accounts, listings, applications, complaints and reviews per day, week
or month of Sydney's calendar, read only from the range; complaints by
category and status and reviews by status in the range; totals of all time.
Repairs never count as complaints.
"""

from datetime import date, datetime, timezone

import pytest

from app.services import admin_analytics
from tests.factories_admin import bearer
from tests.factories_identity import users_row
from tests.factories_reviews_complaints import application, complaint, listing, property_row, review, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a7000000-0000-4000-8000-000000000001"
OWNER = "b7000000-0000-4000-8000-000000000001"
TENANT = "b7000000-0000-4000-8000-000000000002"
NEWCOMER = "b7000000-0000-4000-8000-000000000003"
PROPERTY = "c7000000-0000-4000-8000-000000000001"

API = "/api/v1/admin/analytics"
# 20 October 2026, 2pm in Sydney (daylight time, UTC+11).
NOW = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)
# 1:30am on 20 October in Sydney, though still the 19th in UTC.
LAST_DAY = "2026-10-19T14:30:00+00:00"
FIRST_DAY = "2026-09-21T01:00:00+00:00"
# 11pm on 20 September in Sydney (UTC+10 then): the day before the range.
BEFORE = "2026-09-20T13:00:00+00:00"


def uid(n: int) -> str:
    return f"d7000000-0000-4000-8000-{n:012d}"


@pytest.fixture
def db(strict_schema, monkeypatch):
    monkeypatch.setattr(admin_analytics, "_now", lambda: NOW)
    strict_schema.seed("users", [
        users_row(OWNER, "oliver@example.test", "LANDLORD", created_at=BEFORE),
        users_row(TENANT, "tia@example.test", created_at=FIRST_DAY),
        users_row(NEWCOMER, "neo@example.test", created_at=LAST_DAY),
        users_row(uid(99), "gone@example.test", created_at=LAST_DAY, deleted_at=LAST_DAY),
    ])
    strict_schema.seed("properties", [property_row(PROPERTY, OWNER)])
    strict_schema.seed("listings", [
        listing(uid(1), PROPERTY, OWNER, created_at=LAST_DAY),
        listing(uid(2), PROPERTY, OWNER, created_at=BEFORE),
    ])
    strict_schema.seed("rental_applications", [
        application(uid(3), uid(1), TENANT, created_at=LAST_DAY),
        # A listing approves one application (rental_applications_one_approved_per_listing_idx).
        application(uid(4), uid(1), NEWCOMER, status="SUBMITTED", created_at="2026-10-10T00:00:00+00:00"),
    ])
    strict_schema.seed("complaints", [
        complaint(uid(5), TENANT, category="SAFETY", lodged_at=FIRST_DAY),
        complaint(uid(6), TENANT, category="safety", status="IN_REVIEW", lodged_at=LAST_DAY),
        complaint(uid(7), TENANT, category="HARASSMENT", status="RESOLVED", lodged_at=LAST_DAY),
        complaint(uid(8), TENANT, category="OTHER", status="CLOSED", lodged_at=LAST_DAY,
                  metadata={"dismissed": True}),
        complaint(uid(9), TENANT, category="plumbing", lodged_at=LAST_DAY),
        complaint(uid(10), TENANT, category="SAFETY", lodged_at=BEFORE),
    ])
    strict_schema.seed("maintenance_work_orders", [work_order(uid(11), uid(9), TENANT)])
    strict_schema.seed("reviews", [
        review(uid(12), TENANT, OWNER, created_at=LAST_DAY),
        review(uid(13), TENANT, OWNER, status="FLAGGED", created_at=FIRST_DAY),
        review(uid(14), TENANT, OWNER, status="HIDDEN", created_at=LAST_DAY),
        review(uid(15), TENANT, OWNER, created_at=BEFORE),
    ])
    return strict_schema


@pytest.fixture
def admin(client, db):
    # Its account dates from the fake's clock (2026-01-01), long before the range.
    return bearer(db, ADMIN, "ada@example.test", "ADMIN", created_at="2026-01-01T00:00:00+00:00")


def test_thirty_days_count_each_sydney_day_and_the_breakdowns(client, db, admin):
    response = client.get(API, headers=admin)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["days"], body["granularity"], body["start"], body["end"]) == (30, "day", "2026-09-21", "2026-10-20")
    assert len(body["periods"]) == 30 and body["periods"][-1] == "2026-10-20"
    series = {item["key"]: item for item in body["series"]}
    assert {key: item["total"] for key, item in series.items()} == {
        "users": 3, "listings": 1, "applications": 2, "complaints": 4, "reviews": 3}
    # The first and the last day of the range.
    assert (series["users"]["counts"][0], series["users"]["counts"][-1]) == (1, 2)
    assert series["complaints"]["counts"][0] == 1 and series["complaints"]["counts"][-1] == 3
    assert series["applications"]["counts"][19] == 1  # 10 October
    assert body["complaints_by_category"] == [
        {"code": "SAFETY", "label": "Safety", "count": 2},
        {"code": "HARASSMENT", "label": "Harassment", "count": 1},
        {"code": "OTHER", "label": "Other", "count": 1},
    ]
    assert {item["status"]: item["count"] for item in body["complaints_by_status"]} == {
        "OPEN": 1, "IN_REVIEW": 1, "ESCALATED": 0, "RESOLVED": 1, "CLOSED": 0, "WITHDRAWN": 1}
    assert {item["status"]: item["count"] for item in body["reviews_by_status"]} == {
        "PUBLISHED": 1, "FLAGGED": 1, "HIDDEN": 1, "ARCHIVED": 0}
    # All time: open accounts, every complaint but the repair.
    assert body["totals"] == {"users": 4, "listings": 2, "applications": 2, "complaints": 5, "reviews": 4}


def test_longer_ranges_count_by_week_and_by_month(client, db, admin):
    weeks = client.get(API, params={"days": 90}, headers=admin).json()
    months = client.get(API, params={"days": 365}, headers=admin).json()

    assert weeks["granularity"] == "week" and weeks["periods"][-1] == "2026-10-19"
    assert all(date.fromisoformat(day).weekday() == 0 for day in weeks["periods"])
    assert weeks["start"] <= "2026-07-23" and len(weeks["periods"]) == 14
    assert months["granularity"] == "month" and len(months["periods"]) == 12
    assert (months["periods"][0], months["periods"][-1]) == ("2025-11-01", "2026-10-01")
    month_series = {item["key"]: item for item in months["series"]}
    # Everything seeded falls in September or October.
    assert month_series["complaints"]["counts"][-2:] == [2, 3]
    assert month_series["users"]["total"] == 5


def test_only_the_three_ranges_are_offered(client, db, admin):
    response = client.get(API, params={"days": 7}, headers=admin)

    assert (response.status_code, response.json()["detail"]) == (422, "Choose 30, 90 or 365 days.")
