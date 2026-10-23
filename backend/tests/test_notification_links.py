"""Message notices open the recipient's own inbox, once per thread until read."""

import pytest

from app.services import notifications
from tests.factories_messaging import connection, message, person, provider_profile, seed_thread, stored, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA = "a0000000-0000-4000-8000-000000000001"
MEI = "c0000000-0000-4000-8000-000000000009"
PEER = "c0000000-0000-4000-8000-000000000002"


@pytest.mark.parametrize("primary_role, inbox", [
    ("TENANT", "/tenant/messages"),
    ("LANDLORD", "/owner/messages"),
    ("AGENT", "/owner/messages"),
    ("SERVICE_PROVIDER", "/dashboard/messages"),
])
def test_a_new_message_links_to_the_recipients_inbox(client, strict_schema, as_profile, primary_role, inbox):
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(PEER, primary_role, "Sam Peer")])
    strict_schema.seed("connection_requests", [connection(MEI, PEER)])
    as_profile(id=MEI, role="tenant")
    thread = client.post("/api/v1/conversations/rental", json={"peer_id": PEER}).json()

    sent = client.post(f"/api/v1/conversations/{thread['id']}/messages", json={"body": "Is the lease ready?"})

    assert sent.status_code == 201, sent.text
    assert [(n["user_id"], n["link"], n["category"], n["title"], n["body"])
            for n in strict_schema.tables["notifications"]] == [
        (PEER, f"{inbox}?thread={thread['id']}", "social", "New message from Mei Lin", "Is the lease ready?")
    ]


def test_marketplace_message_notices_open_each_sides_inbox(client, strict_schema, as_profile):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(MEI, "TENANT", "Mei Lin"),
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(AMELIA)])
    as_profile(id=MEI, role="tenant")
    thread = client.post("/api/v1/conversations", json={"provider_id": AMELIA}).json()
    client.post(f"/api/v1/conversations/{thread['id']}/messages", json={"body": "Is Friday free?"})
    as_profile(id=AMELIA, role="service_provider")
    client.post(f"/api/v1/conversations/{thread['id']}/messages", json={"body": "Friday works"})

    assert [(n["user_id"], n["link"]) for n in strict_schema.tables["notifications"]] == [
        (AMELIA, f"/dashboard/messages?thread={thread['id']}"),
        (MEI, f"/tenant/messages?thread={thread['id']}"),
    ]


def test_message_notices_do_not_stack_per_thread(client, strict_schema, as_profile):
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(PEER, "LANDLORD", "Sam Peer")])
    thread = seed_thread(strict_schema, [MEI, PEER])
    as_profile(id=MEI, role="tenant")

    client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Hi"})
    client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Are you free?"})
    [notice] = strict_schema.tables["notifications"]
    assert (notice["user_id"], notice["body"]) == (PEER, "Hi")

    as_profile(id=PEER, role="landlord")
    assert client.patch(f"/api/v1/me/notifications/{notice['id']}/read").status_code == 200
    as_profile(id=MEI, role="tenant")
    client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Still there?"})
    assert [n["body"] for n in stored(strict_schema, "notifications", is_read=False)] == ["Still there?"]


def test_a_member_who_muted_the_thread_is_not_told(client, strict_schema, as_profile):
    third = uid("third")
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(PEER, "LANDLORD", "Sam Peer"),
                                 person(third, "SERVICE_PROVIDER", "Tess Trade")])
    thread = seed_thread(strict_schema, [MEI, PEER, third], conversation_type="GROUP")
    # Sam muted it in the mobile app; the shared notifications also feed the app's bell.
    stored(strict_schema, "conversation_participants", user_id=PEER)[0]["is_muted"] = True
    as_profile(id=MEI, role="tenant")

    sent = client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Plumber booked for Friday"})

    assert sent.status_code == 201, sent.text
    assert [n["user_id"] for n in strict_schema.tables["notifications"]] == [third]


def test_every_other_member_of_a_group_thread_is_told(client, strict_schema, as_profile):
    third, gone = uid("third"), uid("gone")
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(PEER, "LANDLORD", "Sam Peer"),
                                 person(third, "SERVICE_PROVIDER", "Tess Trade")])
    # A repair thread the mobile app opened; one member's account is gone since.
    strict_schema.seed("users", [person(gone, "TENANT", "Gone Soon")])
    thread = seed_thread(strict_schema, [MEI, PEER, third, gone], conversation_type="GROUP")
    strict_schema.tables["users"] = [user for user in strict_schema.tables["users"] if user["id"] != gone]
    as_profile(id=MEI, role="tenant")

    assert client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Water's off"}).status_code == 201

    assert sorted((n["user_id"], n["link"]) for n in strict_schema.tables["notifications"]) == sorted([
        (PEER, f"/owner/messages?thread={thread}"),
        (third, f"/dashboard/messages?thread={thread}"),
    ])


def test_a_notice_never_fails_the_message(client, strict_schema, as_profile, monkeypatch):
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(PEER, "LANDLORD", "Sam Peer")])
    thread = seed_thread(strict_schema, [MEI, PEER])
    strict_schema.seed("messages", [message(thread, PEER, "Hello", "2025-12-31T10:00:00+00:00")])

    def broken(*args, **kwargs):
        raise RuntimeError("notifications are down")

    monkeypatch.setattr(notifications, "messages_href", broken)
    as_profile(id=MEI, role="tenant")

    assert client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "Hi"}).status_code == 201
    assert len(strict_schema.tables["messages"]) == 2


def test_people_are_users_rows(strict_schema):
    strict_schema.seed("users", [person(PEER, "AGENT", "Sam Peer")])

    assert notifications.profile_summary(PEER) == {"full_name": "Sam Peer", "role": "landlord"}
    assert notifications.profile_summary(uid("nobody")) == {}
    assert notifications.profile_summary("not-a-uuid") == {}  # a failed lookup is no one, never an error
    assert notifications.profile_summary(None) == {}


def test_a_providers_notices_go_to_its_owner(strict_schema):
    strict_schema.seed("users", [person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"), person(MEI)])
    strict_schema.seed("service_provider_profiles", [provider_profile(AMELIA)])

    assert notifications.provider_profile_id(AMELIA) == AMELIA
    assert notifications.provider_profile_id(MEI) is None  # not a provider
    assert notifications.provider_profile_id("whitlock-property") is None
    assert notifications.provider_profile_id(None) is None
