"""Dashboard 'unread messages' and 'pending connections' count what the inbox and Network page show.

Unread is the inbox's rule: in each thread the person takes part in, other
people's messages newer than their last_read_at (conversation_participants).
"""

import pytest
from postgrest.exceptions import APIError

from app.services import conversations, dashboard
from tests.factories_messaging import connection, message, person, seed_thread, uid
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

OWNER, TENANT, OTHER, AMELIA = (uid(name) for name in ("owner", "tenant", "other", "amelia"))


@pytest.fixture
def owner_inbox(strict_schema, as_profile):
    """A rental thread the owner last read at 10:00, and a mobile thread they never opened."""
    strict_schema.seed("users", [person(OWNER, "LANDLORD", "Olivia Owner"), person(TENANT, "TENANT", "Tim Tenant"),
                                 person(OTHER, "TENANT", "Ola Other"), person(AMELIA, "SERVICE_PROVIDER", "Amelia")])
    rental = seed_thread(strict_schema, [OWNER, TENANT], id=uid("rental"),
                         last_read={OWNER: "2025-12-31T10:00:00+00:00"})
    mobile = seed_thread(strict_schema, [OWNER, OTHER], id=uid("mobile"))
    elsewhere = seed_thread(strict_schema, [TENANT, OTHER], id=uid("elsewhere"))
    strict_schema.seed("messages", [
        message(rental, TENANT, "Seen already", "2025-12-31T09:00:00+00:00"),
        message(rental, TENANT, "New one", "2025-12-31T11:00:00+00:00"),
        message(rental, TENANT, "And another", "2025-12-31T12:00:00+00:00"),
        message(rental, TENANT, "Taken back", "2025-12-31T12:30:00+00:00", deleted_at="2025-12-31T12:31:00+00:00"),
        message(rental, OWNER, "My own reply", "2025-12-31T13:00:00+00:00"),
        message(mobile, OTHER, "Hello from the app", "2025-12-31T08:00:00+00:00"),
        message(elsewhere, OTHER, "Not the owner's thread", "2025-12-31T08:00:00+00:00"),
    ])
    as_profile(OWNER, "landlord")
    return strict_schema


def _owner_dashboard(client) -> dict:
    response = client.get("/api/v1/me/dashboard/owner")
    assert response.status_code == 200, response.text
    return response.json()


def test_unread_counts_other_peoples_newer_messages_in_every_thread(client, owner_inbox):
    assert _owner_dashboard(client)["unread_messages"] == 3
    assert conversations.unread_counts(OWNER) == {uid("rental"): 2, uid("mobile"): 1}


def test_reading_a_thread_clears_its_unread_messages(client, owner_inbox):
    assert client.post(f"/api/v1/conversations/{uid('rental')}/read").status_code == 204

    assert _owner_dashboard(client)["unread_messages"] == 1
    inbox = {t["id"]: t["unread_count"] for t in client.get("/api/v1/conversations").json()}
    assert inbox == {uid("rental"): 0, uid("mobile"): 1}


def test_counts_can_be_limited_to_some_threads(owner_inbox):
    # For bookings, which count each booking's own thread.
    wanted = [uid("mobile"), uid("elsewhere"), "not-a-thread"]

    assert conversations.unread_counts(OWNER, wanted) == {uid("mobile"): 1}
    assert conversations.unread_counts(OWNER, []) == {}
    assert conversations.unread_counts(uid("nobody")) == {}


def test_a_provider_counts_their_marketplace_threads(owner_inbox):
    client_thread = seed_thread(owner_inbox, [TENANT, AMELIA], id=uid("marketplace"),
                                last_read={AMELIA: "2025-12-31T10:00:00+00:00"})
    owner_inbox.seed("messages", [
        message(client_thread, TENANT, "Can you quote?", "2025-12-31T11:00:00+00:00"),
        message(client_thread, TENANT, "Old question", "2025-12-31T09:00:00+00:00"),
        message(client_thread, AMELIA, "Sure", "2025-12-31T12:00:00+00:00"),
    ])

    assert dashboard._unread_message_count(AMELIA) == 1


def test_message_lookup_failure_is_an_error_not_zero(client, owner_inbox, monkeypatch):
    execute = FakeTableQuery.execute

    def timing_out(query):
        if query._name == "messages":
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout",
                            "hint": None, "details": None})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", timing_out)
    assert client.get("/api/v1/me/dashboard/owner").status_code == 500


def test_pending_connections_are_the_requests_waiting_for_the_owner(client, owner_inbox):
    owner_inbox.seed("connection_requests", [
        connection(TENANT, OWNER, "PENDING"),  # waiting for the owner
        connection(OWNER, OTHER, "PENDING"),  # the owner's own request
        connection(AMELIA, OWNER, "ACCEPTED"),
        connection(OTHER, OWNER, "WITHDRAWN"),
        connection(TENANT, OTHER, "PENDING"),  # someone else's
    ])

    assert _owner_dashboard(client)["pending_connections"] == 1
