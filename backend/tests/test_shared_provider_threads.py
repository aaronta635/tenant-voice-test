"""Marketplace threads with a provider, whose id is its owner's users.id (service_provider_profiles.user_id)."""

import pytest

from tests.factories_messaging import connection, person, provider_profile, stored

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA = "a0000000-0000-4000-8000-000000000001"
MEI = "c0000000-0000-4000-8000-000000000009"
DEPARTED = "a0000000-0000-4000-8000-0000000000ff"


@pytest.fixture
def shared_provider(strict_schema):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(MEI, "TENANT", "Mei Lin"),
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(AMELIA, "Whitlock Property")])
    return strict_schema


def test_client_can_open_and_message_a_provider(client, shared_provider, as_profile):
    as_profile(id=MEI, role="tenant")
    opened = client.post("/api/v1/conversations", json={"provider_id": AMELIA, "subject": "Appraisal"})
    assert opened.status_code == 201, opened.text
    thread = opened.json()
    assert (thread["counterpart_id"], thread["counterpart_name"]) == (AMELIA, "Whitlock Property")
    assert (thread["kind"], thread["client_id"], thread["provider_id"], thread["booking_id"]) == (
        "marketplace", MEI, AMELIA, None
    )

    sent = client.post(f"/api/v1/conversations/{thread['id']}/messages", json={"body": "Is Friday free?"})
    assert sent.status_code == 201, sent.text
    assert (sent.json()["sender_id"], sent.json()["sender_name"], sent.json()["is_read"]) == (MEI, "Mei Lin", False)
    assert [n["user_id"] for n in shared_provider.tables["notifications"]] == [AMELIA]

    as_profile(id=AMELIA, role="service_provider")
    inbox = client.get("/api/v1/conversations")
    assert inbox.status_code == 200, inbox.text
    assert [(t["id"], t["counterpart_name"], t["unread_count"], t["context"]) for t in inbox.json()] == [
        (thread["id"], "Mei Lin", 1, "Appraisal")
    ]


def test_a_new_thread_is_a_direct_conversation_both_apps_list(client, shared_provider, as_profile):
    as_profile(id=MEI, role="tenant")

    thread = client.post("/api/v1/conversations", json={"provider_id": AMELIA, "subject": "Appraisal"}).json()

    [row] = shared_provider.tables["conversations"]
    assert (row["id"], row["conversation_type"], row["subject"], row["listing_id"], row["created_by_user_id"]) == (
        thread["id"], "DIRECT", "Appraisal", None, MEI
    )
    assert row["metadata"] == {"kind": "marketplace", "client_id": MEI, "provider_id": AMELIA, "booking_id": None}
    assert sorted((p["user_id"], p["role_label"], p["last_read_at"]) for p in
                  stored(shared_provider, "conversation_participants", conversation_id=thread["id"])) == sorted([
        (MEI, "tenant", None), (AMELIA, "service_provider", None),
    ])


def test_repeated_clicks_reopen_the_same_thread(client, shared_provider, as_profile):
    as_profile(id=MEI, role="tenant")

    first = client.post("/api/v1/conversations", json={"provider_id": AMELIA}).json()
    again = client.post("/api/v1/conversations", json={"provider_id": AMELIA}).json()

    assert again["id"] == first["id"]
    assert len(shared_provider.tables["conversations"]) == 1


@pytest.mark.parametrize("unknown", ["whitlock-property", DEPARTED, MEI, "x,user_id.eq.a"])
def test_anything_but_a_providers_id_is_no_provider(client, shared_provider, as_profile, unknown):
    # A slug or other text never reaches the uuid column: the strict fake would answer 22P02 (400).
    as_profile(id=MEI, role="tenant")

    response = client.post("/api/v1/conversations", json={"provider_id": unknown})

    assert (response.status_code, response.json()["detail"]) == (404, "Service provider not found")
    assert not shared_provider.tables.get("conversations")


def test_an_unpublished_provider_is_found_only_by_people_they_know(client, shared_provider, as_profile):
    shared_provider.tables["service_provider_profiles"] = [provider_profile(AMELIA, is_published=False)]
    as_profile(id=MEI, role="tenant")

    assert client.post("/api/v1/conversations", json={"provider_id": AMELIA}).status_code == 404

    shared_provider.seed("connection_requests", [connection(AMELIA, MEI)])
    assert client.post("/api/v1/conversations", json={"provider_id": AMELIA}).status_code == 201


def test_nobody_can_message_their_own_listing(client, shared_provider, as_profile):
    as_profile(id=AMELIA, role="service_provider")

    for payload in ({"provider_id": AMELIA, "client_id": AMELIA}, {"provider_id": AMELIA}):
        response = client.post("/api/v1/conversations", json=payload)
        assert response.status_code == 400, payload
    assert not shared_provider.tables.get("conversations")


def test_a_provider_who_left_keeps_their_threads_readable(client, shared_provider, as_profile):
    as_profile(id=MEI, role="tenant")
    opened = client.post("/api/v1/conversations", json={"provider_id": AMELIA}).json()

    shared_provider.tables["service_provider_profiles"] = []
    inbox = client.get("/api/v1/conversations")

    assert inbox.status_code == 200, inbox.text
    assert [(t["id"], t["counterpart_name"]) for t in inbox.json()] == [(opened["id"], "Amelia Whitlock")]
    sent = client.post(f"/api/v1/conversations/{opened['id']}/messages", json={"body": "Still there?"})
    assert sent.status_code == 201, sent.text
