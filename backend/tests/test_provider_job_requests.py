"""A provider from sign-up to a job request, through the API on the strict shared schema (tracker R33).

Real accounts sign up and sign in (FakeSupabase's auth), so every request
resolves its caller from the shared users table, as on the live project.
The provider completes their profile (ABN included) and lists a service; a
landlord finds them in the marketplace, books, and opens the booking's
thread. The request then reaches that provider, and only them: their
notifications, their bookings, their dashboard and their inbox.
"""

from datetime import date, datetime

import pytest

from app.services import bookings, dashboard
from tests.factories_bookings import freeze_clock
from tests.factories_identity import verify

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"


def _ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def _register(client, email: str, full_name: str, role: str) -> dict:
    """Sign up and return the bearer headers for the new account."""
    created = _ok(client.post(f"{API}/auth/register", json={
        "email": email, "password": "password123", "full_name": full_name, "role": role,
    }), 201)
    return {"Authorization": f"Bearer {created['access_token']}"}


@pytest.fixture
def frozen(monkeypatch):
    freeze_clock(monkeypatch, bookings, datetime(2030, 1, 15, 12))
    monkeypatch.setattr(dashboard, "_local_today", lambda: date(2030, 1, 15))


def test_a_booking_reaches_the_provider_who_listed_the_service_and_no_one_else(client, frozen, fake_db):
    fake_db.seed("service_categories", [{
        "category": "cleaner", "slug": "cleaner", "name": "Cleaners", "description": "Cleaning", "sort_order": 1,
        "is_active": True,
    }], schema="web")
    nina = _register(client, "nina@example.test", "Nina New", "service_provider")
    rival = _register(client, "rival@example.test", "Rita Rival", "service_provider")
    jon = _register(client, "jon@example.test", "Jonathan Hayes", "landlord")

    # The provider sets up: business details, an ABN, a priced service and weekly hours, then goes live
    # once an admin has verified them (services/gates.py).
    _ok(client.post(f"{API}/me/provider", headers=nina, json={"category": "cleaner", "business_name": "Nina Cleans"}), 201)
    profile = _ok(client.patch(f"{API}/me/provider", headers=nina, json={
        "bio": "Bond cleans across the Inner West.", "headline": "Bond cleans", "abn": "51824753556",
    }))
    assert (profile["abn"], profile["slug"]) == ("51 824 753 556", "nina-cleans")
    service = _ok(client.post(f"{API}/me/services", headers=nina, json={
        "title": "Bond clean", "price": 85, "pricing_type": "hourly", "duration_minutes": 120,
        "service_area": "Newtown, Glebe", "description": "Bond-back cleans, oven and windows included.",
    }), 201)
    for day in range(7):
        _ok(client.post(f"{API}/me/availability", headers=nina, json={
            "day_of_week": day, "start_time": "08:00", "end_time": "18:00",
        }), 201)
    verify(fake_db, profile["id"])
    assert _ok(client.patch(f"{API}/me/provider", headers=nina, json={"is_published": True}))["is_published"] is True

    # The landlord finds the provider in the marketplace and asks for the service.
    [listed] = _ok(client.get(f"{API}/providers", params={"category": "cleaner"}))
    assert (listed["business_name"], listed["from_price"], listed["price_unit"]) == ("Nina Cleans", 85, "per hour")
    booked = _ok(client.post(f"{API}/bookings", headers=jon, json={
        "provider_id": listed["slug"], "service_id": service["id"], "scheduled_date": "2030-01-16",
        "scheduled_time": "10:00:00", "property_suburb": "Newtown",
    }), 201)
    nina_id = profile["id"]
    assert (booked["provider_id"], booked["status"], booked["service_title"]) == (nina_id, "new_enquiry", "Bond clean")
    thread = _ok(client.post(f"{API}/conversations", headers=jon, json={
        "provider_id": nina_id, "booking_id": booked["id"], "subject": "Bond clean",
    }), 201)
    _ok(client.post(f"{API}/conversations/{thread['id']}/messages", headers=jon, json={"body": "Is 10am still fine?"}), 201)

    # It reaches that provider: the bell, the bookings list, the dashboard and the inbox.
    notices = _ok(client.get(f"{API}/me/notifications", headers=nina))
    enquiry = next(notice for notice in notices if notice["link_href"] == "/dashboard/bookings")
    assert (enquiry["title"], enquiry["category"]) == ("New enquiry from Jonathan Hayes", "booking")
    [job] = _ok(client.get(f"{API}/bookings", headers=nina))
    assert (job["id"], job["client_name"], job["service_title"], job["status"]) == (
        booked["id"], "Jonathan Hayes", "Bond clean", "new_enquiry",
    )
    overview = _ok(client.get(f"{API}/me/dashboard/provider", headers=nina))
    assert (overview["new_enquiries"], overview["published_service_count"]) == (1, 1)
    [inbox] = _ok(client.get(f"{API}/conversations", headers=nina))
    assert (inbox["id"], inbox["counterpart_name"], inbox["unread_count"]) == (thread["id"], "Jonathan Hayes", 1)
    assert inbox["booking"]["id"] == booked["id"]
    assert any(notice["link_href"].startswith("/dashboard/messages") for notice in notices)

    # Nobody else's: another provider has no notice, booking, enquiry or thread of it.
    assert _ok(client.get(f"{API}/me/notifications", headers=rival)) == []
    assert _ok(client.get(f"{API}/bookings", headers=rival)) == []
    assert _ok(client.get(f"{API}/conversations", headers=rival)) == []
    assert client.get(f"{API}/bookings/{booked['id']}", headers=rival).status_code == 403
    assert client.get(f"{API}/conversations/{thread['id']}", headers=rival).status_code in (403, 404)

    # Accepting it is the listing provider's alone.
    assert client.patch(f"{API}/bookings/{booked['id']}", headers=rival, json={"status": "confirmed"}).status_code == 403
    assert _ok(client.patch(f"{API}/bookings/{booked['id']}", headers=nina, json={"status": "confirmed"}))["status"] == "confirmed"
    accepted = _ok(client.get(f"{API}/me/notifications", headers=jon))
    assert any(notice["title"] == "Nina Cleans accepted your booking" for notice in accepted)
