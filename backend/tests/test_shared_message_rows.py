"""A thread as the mobile app writes it reads, counts and marks read like a web thread.

Its members are conversation_participants rows with a last_read_at each; its
messages name sender_user_id and hold content, and a SYSTEM note may come
from nobody. A soft-deleted message (deleted_at) is gone. A thread's history
can be longer than one PostgREST response holds (max-rows): the inbox, the
counts and reading a thread never depend on reading all of it at once.
"""

import pytest

from app.services import conversations
from tests.factories_messaging import message, person, seed_listing, seed_thread, stored, uid
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c0000000-0000-4000-8000-000000000009"
SAM = "c0000000-0000-4000-8000-000000000002"


@pytest.fixture
def thread(strict_schema):
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(SAM, "LANDLORD", "Sam Okafor")])
    listing = seed_listing(strict_schema, SAM, title="Sunny two-bedder", suburb="Enmore")
    thread_id = seed_thread(strict_schema, [MEI, SAM], listing_id=listing, subject="Lease",
                            last_read={MEI: "2025-12-31T10:30:00+00:00", SAM: "2025-12-31T11:30:00+00:00"})
    strict_schema.seed("messages", [
        message(thread_id, MEI, "Is the lease ready?", "2025-12-31T10:00:00+00:00", id=uid("asked")),
        message(thread_id, SAM, "Sent it this morning", "2025-12-31T11:00:00+00:00", id=uid("answered")),
        message(thread_id, None, "Lease sent for signing", "2025-12-31T11:05:00+00:00", id=uid("note"),
                message_type="SYSTEM"),
        message(thread_id, SAM, "Wrong file, ignore", "2025-12-31T11:06:00+00:00", id=uid("deleted"),
                deleted_at="2025-12-31T11:07:00+00:00"),
    ])
    return thread_id


def test_messages_list_with_their_sender_and_who_has_read_them(client, thread, as_profile):
    as_profile(id=MEI, role="tenant")

    response = client.get(f"/api/v1/conversations/{thread}/messages")

    assert response.status_code == 200, response.text
    assert [(m["id"], m["sender_id"], m["sender_name"], m["body"], m["is_read"]) for m in response.json()] == [
        (uid("asked"), MEI, "Mei Lin", "Is the lease ready?", True),  # Sam read the thread after it
        (uid("answered"), SAM, "Sam Okafor", "Sent it this morning", False),  # Mei has not
        (uid("note"), "", None, "Lease sent for signing", True),  # from nobody: Sam has read it
    ]


def test_the_inbox_counts_and_previews_a_mobile_thread(client, thread, as_profile):
    as_profile(id=MEI, role="tenant")

    inbox = client.get("/api/v1/conversations")
    opened = client.get(f"/api/v1/conversations/{thread}")

    assert inbox.status_code == 200, inbox.text
    assert opened.status_code == 200, opened.text
    [row] = inbox.json()
    assert row == opened.json()
    # Two of Sam's messages arrived after Mei last read; the deleted one is gone.
    assert (row["last_message"], row["last_message_sender_id"], row["unread_count"]) == (
        "Lease sent for signing", None, 2
    )
    assert (row["kind"], row["tenant_id"], row["owner_id"]) == ("rental", MEI, SAM)
    assert (row["counterpart_id"], row["counterpart_name"], row["counterpart_role"]) == (SAM, "Sam Okafor", "landlord")
    assert (row["context"], row["subject"]) == ("Enmore", "Lease")


def test_reading_a_thread_clears_its_unread_messages_until_the_next_one(client, thread, as_profile):
    as_profile(id=MEI, role="tenant")

    assert client.post(f"/api/v1/conversations/{thread}/read").status_code == 204
    assert client.get("/api/v1/conversations").json()[0]["unread_count"] == 0

    as_profile(id=SAM, role="landlord")
    assert client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Signed?"}).status_code == 201
    as_profile(id=MEI, role="tenant")
    [row] = client.get("/api/v1/conversations").json()
    assert (row["unread_count"], row["last_message"]) == (1, "Signed?")


def test_only_the_readers_own_participant_row_changes(client, thread, as_profile, strict_schema):
    as_profile(id=MEI, role="tenant")

    client.post(f"/api/v1/conversations/{thread}/read")

    assert {p["user_id"]: p["last_read_at"] for p in strict_schema.tables["conversation_participants"]} == {
        MEI: "2025-12-31T11:05:00+00:00",  # the newest message still shown
        SAM: "2025-12-31T11:30:00+00:00",
    }
    assert stored(strict_schema, "messages", deleted_at=None)  # messages themselves are not written


def test_nobody_outside_the_thread_reads_or_writes_it(client, thread, as_profile, strict_schema):
    outsider = uid("outsider")
    strict_schema.seed("users", [person(outsider, "TENANT", "Olly Outsider")])
    as_profile(id=outsider, role="tenant")

    for response in (
        client.get(f"/api/v1/conversations/{thread}"),
        client.get(f"/api/v1/conversations/{thread}/messages"),
        client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Hello?"}),
        client.post(f"/api/v1/conversations/{thread}/read"),
    ):
        assert response.status_code == 403
    assert client.get("/api/v1/conversations").json() == []
    assert client.get(f"/api/v1/conversations/{uid('missing')}").status_code == 404
    assert client.get("/api/v1/conversations/not-a-thread").status_code == 404


@pytest.fixture
def three_rows_a_response(monkeypatch):
    """Answer each select with at most three rows, as PostgREST caps a response at max-rows."""
    execute = FakeTableQuery.execute

    def capped(query):
        result = execute(query)
        if query._op == "select":
            result.data = result.data[:3]
        return result

    monkeypatch.setattr(FakeTableQuery, "execute", capped)


@pytest.fixture
def long_thread(strict_schema):
    """Mei last read at 10:00; Sam wrote six messages after that, more than a response holds."""
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(SAM, "LANDLORD", "Sam Okafor")])
    thread_id = seed_thread(strict_schema, [MEI, SAM], last_read={MEI: "2025-12-31T10:00:00+00:00"})
    strict_schema.seed("messages", [
        *(message(thread_id, MEI, f"Earlier {n}", f"2025-12-31T09:0{n}:00+00:00") for n in range(4)),
        *(message(thread_id, SAM, f"Update {n}", f"2025-12-31T10:0{n}:00+00:00") for n in range(1, 7)),
        message(thread_id, SAM, "Taken back", "2025-12-31T10:09:00+00:00", deleted_at="2025-12-31T10:10:00+00:00"),
    ])
    return thread_id


def test_a_long_thread_previews_its_newest_message_and_counts_every_unread_one(
    client, long_thread, as_profile, three_rows_a_response
):
    as_profile(id=MEI, role="tenant")

    [row] = client.get("/api/v1/conversations").json()

    assert (row["last_message"], row["unread_count"]) == ("Update 6", 6)
    assert conversations.unread_counts(MEI) == {long_thread: 6}
    assert conversations.unread_counts(SAM) == {long_thread: 4}


def test_reading_a_long_thread_reads_it_up_to_its_newest_message(
    client, long_thread, as_profile, strict_schema, three_rows_a_response
):
    as_profile(id=MEI, role="tenant")

    assert client.post(f"/api/v1/conversations/{long_thread}/read").status_code == 204

    [mine] = stored(strict_schema, "conversation_participants", user_id=MEI)
    assert mine["last_read_at"] == "2025-12-31T10:06:00+00:00"
    assert conversations.unread_counts(MEI) == {long_thread: 0}
    assert client.get("/api/v1/conversations").json()[0]["unread_count"] == 0
