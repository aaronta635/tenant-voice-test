"""A failed read must reach the UI as an error, never as an empty list or $0."""

import pytest
from postgrest.exceptions import APIError

from tests.factories_bookings import booking, invoice, person, seed_provider, service, transaction, uid
from tests.factories_messaging import message, seed_thread
from tests.factories_provider_core import review_row
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

TIMEOUT = {"code": "57014", "message": "canceling statement due to statement timeout"}
MISSING = {"code": "PGRST205", "message": "Could not find the table 'web.bookings' in the schema cache"}
AMELIA, JON = uid("amelia"), uid("jon")
SERVICE, JOB, REVIEW = uid("service"), uid("job"), uid("review")


@pytest.fixture
def failing(fake_db, monkeypatch):
    """Tables whose every query raises the given PostgREST error."""
    errors: dict[str, dict] = {}
    execute = FakeTableQuery.execute

    def failing_execute(self):
        if self._name in errors:
            raise APIError({**errors[self._name], "hint": None, "details": None})
        return execute(self)

    monkeypatch.setattr(FakeTableQuery, "execute", failing_execute)
    return errors


@pytest.fixture
def provider_workspace(strict_schema, as_profile):
    # A provider is keyed by its owner's users.id; this also seeds amelia's users row.
    seed_provider(strict_schema, AMELIA, full_name="Amelia Whitlock")
    strict_schema.seed("users", [person(JON, "Jonathan Hayes")])
    strict_schema.seed("mobile_provider_services", [service(SERVICE, AMELIA, price=150)])
    # The job's review is a shared reviews row about the provider, linked from the booking.
    strict_schema.seed("reviews", [review_row(REVIEW, AMELIA, JON, 5)])
    strict_schema.seed("bookings", [booking(JOB, JON, AMELIA, "completed", service_id=SERVICE, review_id=REVIEW,
                                            scheduled_date="2026-10-05", scheduled_time="10:00:00", price=150)],
                       schema="web")
    strict_schema.seed("transactions", [transaction(uid("payment"), AMELIA, "payment", 150, booking_id=JOB)],
                       schema="web")
    strict_schema.seed("invoices", [invoice(uid("invoice"), AMELIA, JOB, amount=150, status="paid")], schema="web")
    as_profile(AMELIA)
    return strict_schema


def test_provider_screens_load_from_a_healthy_database(client, provider_workspace):
    jobs = client.get("/api/v1/bookings").json()
    assert [(b["client_name"], b["review_rating"]) for b in jobs] == [("Jonathan Hayes", 5)]
    assert [t["amount"] for t in client.get("/api/v1/me/transactions").json()] == [150]
    assert [i["number"] for i in client.get("/api/v1/me/invoices").json()] == ["INV-1"]
    assert client.get("/api/v1/me/dashboard/provider").json()["awaiting_reply"] == 1
    assert client.get("/api/v1/me/dashboard/provider/finance").json()["lifetime_earnings"] == 150


def test_the_provider_overview_counts_unread_messages_in_their_threads(client, provider_workspace):
    thread = seed_thread(provider_workspace, [JON, AMELIA], last_read={AMELIA: "2025-12-31T10:00:00+00:00"})
    provider_workspace.seed("messages", [
        message(thread, JON, "Can you quote?", "2025-12-31T11:00:00+00:00"),
        message(thread, JON, "Seen already", "2025-12-31T09:00:00+00:00"),
        message(thread, AMELIA, "On my way", "2025-12-31T12:00:00+00:00"),
    ])

    assert client.get("/api/v1/me/dashboard/provider").json()["unread_messages"] == 1


@pytest.mark.parametrize("path, table, error", [
    ("/api/v1/bookings", "bookings", TIMEOUT),
    ("/api/v1/bookings", "bookings", MISSING),
    ("/api/v1/bookings", "reviews", TIMEOUT),
    ("/api/v1/bookings", "mobile_provider_services", TIMEOUT),
    ("/api/v1/me/transactions", "transactions", TIMEOUT),
    ("/api/v1/me/transactions", "mobile_provider_services", TIMEOUT),
    ("/api/v1/me/invoices", "invoices", TIMEOUT),
    ("/api/v1/me/invoices/" + uid("invoice") + "/document", "bookings", TIMEOUT),
    ("/api/v1/me/dashboard/provider", "bookings", TIMEOUT),
    ("/api/v1/me/dashboard/provider", "transactions", TIMEOUT),
    ("/api/v1/me/dashboard/provider", "reviews", TIMEOUT),
    ("/api/v1/me/dashboard/provider", "mobile_provider_services", TIMEOUT),
    ("/api/v1/me/dashboard/provider/finance", "transactions", TIMEOUT),
    ("/api/v1/me/dashboard/provider/finance", "invoices", TIMEOUT),
])
def test_database_failures_are_errors_not_empty_screens(client, provider_workspace, failing, path, table, error):
    failing[table] = error
    response = client.get(path)
    assert response.status_code == 500
    assert response.json() == {"detail": "Something went wrong. Please try again."}
