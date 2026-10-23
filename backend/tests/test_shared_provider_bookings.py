"""Bookings through the API on the shared schema.

A provider is a service_provider_profiles row keyed by its owner's users.id,
which is the id a web.bookings row keeps, and a service is a
mobile_provider_services row. The legacy service_providers, profiles and
provider_services tables are gone: the strict fake answers like the shared
database, so a query that still reached one would fail.
"""

import pytest

from tests.factories_bookings import open_week, person, rows, seed_provider, service, uid, web_rows

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER_USER, TENANT_USER, OTHER_PROVIDER = uid("sam"), uid("tina"), uid("other")
SERVICE, DRAFT, FOREIGN, UNPRICED = uid("power-point"), uid("draft"), uid("foreign"), uid("unpriced")
REQUEST = {"provider_id": PROVIDER_USER, "service_id": SERVICE, "property_suburb": "Newtown",
           "scheduled_date": "2031-03-04", "scheduled_time": "10:00:00"}


@pytest.fixture
def shared_marketplace(strict_schema):
    seed_provider(strict_schema, PROVIDER_USER, "Sparky Electrical", "Sam Sparky", slug="sparky-electrical")
    seed_provider(strict_schema, OTHER_PROVIDER, "Other Co", "Olga Other", slug="other-co")
    strict_schema.seed("users", [person(TENANT_USER, "Tina Tenant")])
    strict_schema.seed("mobile_provider_services", [
        service(SERVICE, PROVIDER_USER, "Power point install", price=180),
        service(DRAFT, PROVIDER_USER, "Not yet offered", live=False),
        service(FOREIGN, OTHER_PROVIDER, "Someone else's job"),
        service(UNPRICED, PROVIDER_USER, "Quote on site", price=0),
    ])
    strict_schema.seed("provider_availability", open_week(PROVIDER_USER), schema="web")
    return strict_schema


def test_client_can_book_a_shared_provider_who_is_notified(client, shared_marketplace, as_profile):
    as_profile(TENANT_USER, "tenant")
    response = client.post("/api/v1/bookings", json=REQUEST)
    assert response.status_code == 201, response.text
    booking = response.json()
    assert booking["provider_id"] == PROVIDER_USER
    assert (booking["provider_name"], booking["service_title"]) == ("Sparky Electrical", "Power point install")
    assert booking["price"] == 180
    [stored] = web_rows(shared_marketplace, "bookings")
    assert (stored["id"], stored["client_id"], stored["price"]) == (booking["id"], TENANT_USER, 180)
    [notice] = rows(shared_marketplace, "notifications")
    assert notice["user_id"] == PROVIDER_USER
    assert notice["title"] == "New enquiry from Tina Tenant"

    as_profile(PROVIDER_USER, "service_provider")
    jobs = client.get("/api/v1/bookings").json()
    assert [(job["id"], job["client_name"]) for job in jobs] == [(booking["id"], "Tina Tenant")]


def test_shared_provider_without_business_name_is_shown_by_owner_name(client, shared_marketplace, as_profile):
    rows(shared_marketplace, "service_provider_profiles", user_id=PROVIDER_USER)[0]["company_name"] = None
    as_profile(TENANT_USER, "tenant")
    response = client.post("/api/v1/bookings", json=REQUEST)
    assert response.status_code == 201, response.text
    assert response.json()["provider_name"] == "Sam Sparky"


def test_shared_provider_cannot_book_their_own_service(client, shared_marketplace, as_profile):
    as_profile(PROVIDER_USER, "service_provider")
    response = client.post("/api/v1/bookings", json=REQUEST)
    assert response.status_code == 400
    assert response.json()["detail"] == "You cannot book your own service"
    assert not web_rows(shared_marketplace, "bookings")


def test_a_slug_books_the_canonical_id_without_reaching_a_uuid_column(client, shared_marketplace, as_profile):
    # The strict fake fails a slug in a uuid column with 22P02, which would answer 400.
    as_profile(TENANT_USER, "tenant")
    response = client.post("/api/v1/bookings", json={**REQUEST, "provider_id": "sparky-electrical"})
    assert response.status_code == 201, response.text
    assert response.json()["provider_id"] == PROVIDER_USER
    unknown = client.post("/api/v1/bookings", json={**REQUEST, "provider_id": "no-such-provider"})
    assert (unknown.status_code, unknown.json()["detail"]) == (404, "Service provider not found")
    assert [booking["provider_id"] for booking in web_rows(shared_marketplace, "bookings")] == [PROVIDER_USER]


def test_an_unpublished_provider_cannot_be_booked(client, shared_marketplace, as_profile):
    rows(shared_marketplace, "service_provider_profiles", user_id=PROVIDER_USER)[0]["metadata"]["is_published"] = False
    as_profile(TENANT_USER, "tenant")
    response = client.post("/api/v1/bookings", json=REQUEST)
    assert (response.status_code, response.json()["detail"]) == (404, "Service provider not found")
    assert not web_rows(shared_marketplace, "bookings")


@pytest.mark.parametrize("service_id", [DRAFT, FOREIGN, uid("no-such-service"), "svc"],
                         ids=["draft", "another provider's", "unknown", "not a uuid"])
def test_only_a_live_service_of_the_provider_can_be_booked(client, shared_marketplace, as_profile, service_id):
    as_profile(TENANT_USER, "tenant")
    response = client.post("/api/v1/bookings", json={**REQUEST, "service_id": service_id})
    assert (response.status_code, response.json()["detail"]) == (404, "Service not found for this provider")
    assert not web_rows(shared_marketplace, "bookings")


def test_a_service_nobody_priced_books_without_a_price_or_an_invoice(client, shared_marketplace, as_profile):
    # mobile_provider_services.price defaults to 0: that is no price yet, not a free job.
    as_profile(TENANT_USER, "tenant")
    booking = client.post("/api/v1/bookings", json={**REQUEST, "service_id": UNPRICED}).json()
    assert booking["price"] is None
    as_profile(PROVIDER_USER, "service_provider")
    confirmed = client.patch(f"/api/v1/bookings/{booking['id']}", json={"status": "confirmed"})
    assert confirmed.status_code == 200, confirmed.text
    assert web_rows(shared_marketplace, "bookings")[0]["price"] is None
    assert not web_rows(shared_marketplace, "invoices")


def test_a_booking_without_a_service_is_an_enquiry_at_no_price(client, shared_marketplace, as_profile):
    as_profile(TENANT_USER, "tenant")
    response = client.post("/api/v1/bookings", json={**REQUEST, "service_id": None})
    assert response.status_code == 201, response.text
    assert (response.json()["service_id"], response.json()["service_title"], response.json()["price"]) == (None,) * 3


def test_shared_provider_is_notified_when_the_client_cancels(client, shared_marketplace, as_profile):
    as_profile(TENANT_USER, "tenant")
    booking = client.post("/api/v1/bookings", json=REQUEST).json()
    response = client.patch(f"/api/v1/bookings/{booking['id']}", json={"status": "cancelled"})
    assert response.status_code == 200, response.text
    titles = [n["title"] for n in rows(shared_marketplace, "notifications", user_id=PROVIDER_USER)]
    assert titles == ["New enquiry from Tina Tenant", "Tina Tenant cancelled the booking"]


def test_shared_provider_reschedule_message_is_sent_as_the_provider(client, shared_marketplace, as_profile):
    as_profile(TENANT_USER, "tenant")
    booking = client.post("/api/v1/bookings", json=REQUEST).json()
    as_profile(PROVIDER_USER, "service_provider")
    response = client.patch(f"/api/v1/bookings/{booking['id']}",
                            json={"scheduled_date": "2031-03-05", "scheduled_time": "11:00:00"})
    assert response.status_code == 200, response.text
    [message] = rows(shared_marketplace, "messages")
    assert (message["sender_user_id"], message["conversation_id"]) == (PROVIDER_USER, response.json()["conversation_id"])
    [notice] = rows(shared_marketplace, "notifications", user_id=TENANT_USER)
    assert notice["title"] == "Sparky Electrical rescheduled your booking"


def test_someone_elses_booking_cannot_be_read_or_changed(client, shared_marketplace, as_profile):
    stranger = uid("stranger")
    shared_marketplace.seed("users", [person(stranger, "Stan Stranger")])
    as_profile(TENANT_USER, "tenant")
    booking = client.post("/api/v1/bookings", json=REQUEST).json()

    as_profile(stranger, "tenant")
    assert client.get(f"/api/v1/bookings/{booking['id']}").status_code == 403
    assert client.patch(f"/api/v1/bookings/{booking['id']}", json={"status": "cancelled"}).status_code == 403
    assert client.get("/api/v1/bookings").json() == []
    for unknown in (uid("no-such-booking"), "not-a-booking"):
        assert client.get(f"/api/v1/bookings/{unknown}").status_code == 404
    assert web_rows(shared_marketplace, "bookings")[0]["status"] == "new_enquiry"
