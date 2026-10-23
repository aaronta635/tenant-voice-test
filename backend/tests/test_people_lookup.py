"""People are users rows (bookings.people_by_id).

A person with no users row (a deleted account, say) must be listed unnamed,
not fail the bookings and finance screens that show them; a failed lookup
is an error, not a list of unnamed people.
"""

import pytest
from postgrest.exceptions import APIError

from tests.factories_bookings import booking, seed_provider, service, transaction, uid
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER, DELETED_CLIENT = uid("sam"), uid("deleted-client")
SERVICE, JOB, PAYMENT = uid("power-point"), uid("job"), uid("payment")


@pytest.fixture
def workspace(strict_schema, as_profile):
    """A provider with one paid job for a client whose account is gone."""
    seed_provider(strict_schema, PROVIDER, "Sparky Electrical", "Sam Sparky")
    strict_schema.seed("mobile_provider_services", [service(SERVICE, PROVIDER, "Power point install", price=180)])
    # Seeds skip the foreign-key check, which a deleted account's rows would fail.
    strict_schema.seed("bookings", [booking(JOB, DELETED_CLIENT, PROVIDER, "completed", service_id=SERVICE,
                                            scheduled_date="2026-10-05", scheduled_time="10:00:00", price=180)],
                       schema="web")
    strict_schema.seed("transactions", [transaction(PAYMENT, PROVIDER, "payment", 180, booking_id=JOB)], schema="web")
    as_profile(PROVIDER, "service_provider")
    return strict_schema


def test_a_client_without_a_users_row_is_listed_unnamed(client, workspace):
    bookings = client.get("/api/v1/bookings")
    transactions = client.get("/api/v1/me/transactions")

    assert bookings.status_code == 200, bookings.text
    assert [(b["id"], b["client_name"], b["service_title"]) for b in bookings.json()] == [
        (JOB, None, "Power point install"),
    ]
    assert transactions.status_code == 200, transactions.text
    assert [(t["id"], t["client_name"]) for t in transactions.json()] == [(PAYMENT, None)]


def test_a_failed_people_lookup_still_fails_the_request(client, workspace, monkeypatch):
    execute = FakeTableQuery.execute

    def timing_out(query):
        if query._name == "users":
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout",
                            "details": None, "hint": None})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", timing_out)

    for path in ("/api/v1/bookings", "/api/v1/me/transactions"):
        response = client.get(path)
        assert response.status_code == 500, path
        assert response.json() == {"detail": "Something went wrong. Please try again."}
