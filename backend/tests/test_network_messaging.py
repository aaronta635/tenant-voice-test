"""Messaging is gated on the connections the Network page saves (connection_requests)."""

import pytest

from app.services import connections
from app.services import maps_messaging as maps
from tests.factories_messaging import connection, person, provider_profile, seed_thread, stored, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA = "a0000000-0000-4000-8000-000000000001"
JON = "c0000000-0000-4000-8000-000000000001"
MEI = "c0000000-0000-4000-8000-000000000009"


@pytest.fixture
def people(strict_schema):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(JON, "LANDLORD", "Jon Doe"),
        person(MEI, "TENANT", "Mei Lin"),
    ])
    return strict_schema


def test_accepted_request_lets_either_person_open_the_same_network_thread(client, people, as_profile):
    people.seed("connection_requests", [connection(AMELIA, MEI)])

    as_profile(id=AMELIA, role="service_provider")
    opened = client.post("/api/v1/conversations/rental", json={"peer_id": MEI})
    as_profile(id=MEI, role="tenant")
    reopened = client.post("/api/v1/conversations/rental", json={"peer_id": AMELIA, "body": "Hi Amelia"})

    assert opened.status_code == 201, opened.text
    assert reopened.status_code == 201, reopened.text
    assert reopened.json()["id"] == opened.json()["id"]
    assert reopened.json()["counterpart_name"] == "Amelia Whitlock"
    assert (reopened.json()["last_message"], reopened.json()["last_message_sender_id"]) == ("Hi Amelia", MEI)
    # One DIRECT thread with a member row each, which the mobile app lists too.
    [thread] = people.tables["conversations"]
    assert (thread["conversation_type"], thread["listing_id"], thread["created_by_user_id"]) == ("DIRECT", None, AMELIA)
    assert thread["metadata"] == {"kind": "rental", "tenant_id": min(AMELIA, MEI), "owner_id": max(AMELIA, MEI)}
    assert sorted((p["user_id"], p["role_label"]) for p in people.tables["conversation_participants"]) == [
        (AMELIA, "service_provider"), (MEI, "tenant"),
    ]
    [first] = people.tables["messages"]
    assert (first["sender_user_id"], first["content"], first["message_type"]) == (MEI, "Hi Amelia", "TEXT")


def test_the_first_message_of_a_network_thread_tells_the_other_person(client, people, as_profile):
    people.seed("connection_requests", [connection(AMELIA, MEI)])
    as_profile(id=MEI, role="tenant")

    opened = client.post("/api/v1/conversations/rental", json={"peer_id": AMELIA, "body": "Are you free Friday?"})

    assert opened.status_code == 201, opened.text
    [notice] = people.tables["notifications"]
    assert (notice["user_id"], notice["body"], notice["link"]) == (
        AMELIA, "Are you free Friday?", f"/dashboard/messages?thread={opened.json()['id']}"
    )


def test_a_direct_thread_the_two_opened_in_the_mobile_app_is_reused(client, people, as_profile):
    people.seed("connection_requests", [connection(JON, MEI)])
    mobile = seed_thread(people, [MEI, JON])
    as_profile(id=JON, role="landlord")

    opened = client.post("/api/v1/conversations/rental", json={"peer_id": MEI})

    assert opened.status_code == 201, opened.text
    assert opened.json()["id"] == mobile
    assert len(people.tables["conversations"]) == 1


@pytest.mark.parametrize("caller, role, peer", [(MEI, "tenant", AMELIA), (AMELIA, "service_provider", MEI)],
                         ids=["from the tenant", "from the provider"])
def test_a_dm_reuses_the_thread_the_two_opened_in_the_app_whatever_their_roles(
    client, people, as_profile, caller, role, peer
):
    # By roles alone a thread with a provider in it reads as a marketplace thread.
    people.seed("connection_requests", [connection(AMELIA, MEI)])
    mobile = seed_thread(people, [MEI, AMELIA])
    as_profile(id=caller, role=role)

    opened = client.post("/api/v1/conversations/rental", json={"peer_id": peer})

    assert opened.status_code == 201, opened.text
    assert opened.json()["id"] == mobile
    assert len(people.tables["conversations"]) == 1


def test_two_providers_reuse_their_app_thread_from_either_side(client, people, as_profile):
    plumber = "a0000000-0000-4000-8000-000000000002"
    people.seed("users", [person(plumber, "SERVICE_PROVIDER", "Oscar Plumbing")])
    people.seed("connection_requests", [connection(plumber, AMELIA)])
    mobile = seed_thread(people, [AMELIA, plumber])

    for caller, peer in ((AMELIA, plumber), (plumber, AMELIA)):
        as_profile(id=caller, role="service_provider")
        opened = client.post("/api/v1/conversations/rental", json={"peer_id": peer})
        assert (opened.status_code, opened.json()["id"]) == (201, mobile), opened.text
    assert len(people.tables["conversations"]) == 1


def test_a_dm_never_takes_a_bookings_thread_between_the_two(client, people, as_profile):
    people.seed("connection_requests", [connection(AMELIA, MEI)])
    booking_thread = seed_thread(people, [MEI, AMELIA], metadata=maps.marketplace_metadata(MEI, AMELIA, uid("job")))
    as_profile(id=MEI, role="tenant")

    opened = client.post("/api/v1/conversations/rental", json={"peer_id": AMELIA})

    assert opened.status_code == 201, opened.text
    assert opened.json()["id"] != booking_thread
    assert len(people.tables["conversations"]) == 2


def test_a_dm_never_posts_into_a_group_thread_the_two_are_in(client, people, as_profile):
    # Sam's id sorts after Jon's, so by roles alone Jon would be the group's owner side.
    sam = "c0000000-0000-4000-8000-00000000000f"
    people.seed("users", [person(sam, "LANDLORD", "Sam Sharma")])
    people.seed("connection_requests", [connection(MEI, JON)])
    group = seed_thread(people, [MEI, JON, sam], conversation_type="GROUP")
    as_profile(id=MEI, role="tenant")

    opened = client.post("/api/v1/conversations/rental", json={"peer_id": JON, "body": "Just between us"})

    assert opened.status_code == 201, opened.text
    assert opened.json()["id"] != group
    assert not stored(people, "messages", conversation_id=group)
    assert [notice["user_id"] for notice in people.tables["notifications"]] == [JON]


@pytest.mark.parametrize("status", ["PENDING", "DECLINED", "BLOCKED", "WITHDRAWN"])
def test_unanswered_declined_or_withdrawn_request_does_not_unlock_messages(client, people, as_profile, status):
    people.seed("connection_requests", [connection(AMELIA, MEI, status)])
    as_profile(id=AMELIA, role="service_provider")

    response = client.post("/api/v1/conversations/rental", json={"peer_id": MEI})

    assert response.status_code == 403
    assert not people.tables.get("conversations")


def test_an_unknown_peer_is_refused_without_a_thread(client, people, as_profile):
    as_profile(id=AMELIA, role="service_provider")

    for peer in (uid("nobody"), "x,status.eq.ACCEPTED"):
        assert client.post("/api/v1/conversations/rental", json={"peer_id": peer}).status_code == 403
    assert not people.tables.get("conversations")


def test_provider_can_open_a_thread_with_a_network_contact(client, people, as_profile):
    people.seed("service_provider_profiles", [provider_profile(AMELIA)])
    people.seed("connection_requests", [connection(JON, AMELIA)])
    as_profile(id=AMELIA, role="service_provider")

    response = client.post("/api/v1/conversations", json={"provider_id": AMELIA, "client_id": JON})

    assert response.status_code == 201, response.text
    assert (response.json()["counterpart_name"], response.json()["kind"]) == ("Jon Doe", "marketplace")


def test_a_crafted_client_id_cannot_widen_the_connection_check(client, people, as_profile):
    people.seed("service_provider_profiles", [provider_profile(AMELIA)])
    people.seed("connection_requests", [connection(AMELIA, MEI)])
    as_profile(id=AMELIA, role="service_provider")

    for crafted in ("x,status.eq.ACCEPTED", f"{MEI},sender_user_id.eq.{AMELIA}"):
        response = client.post("/api/v1/conversations", json={"provider_id": AMELIA, "client_id": crafted})
        assert response.status_code == 403, crafted
    assert not people.tables.get("conversations")


def test_the_newest_request_of_a_pair_decides_and_withdrawn_ones_do_not_count(people):
    people.seed("connection_requests", [
        connection(AMELIA, MEI, "DECLINED", created_at="2025-12-01T00:00:00+00:00"),
        connection(MEI, AMELIA, "ACCEPTED", created_at="2025-12-02T00:00:00+00:00"),
        connection(AMELIA, MEI, "WITHDRAWN", created_at="2025-12-03T00:00:00+00:00"),
        connection(JON, AMELIA, "BLOCKED"),
    ])

    assert connections.statuses_for(AMELIA) == {MEI: "accepted", JON: "declined"}
    assert connections.are_connected(MEI, AMELIA)
    assert not connections.are_connected(AMELIA, JON)
    assert stored(people, "connection_requests", status="WITHDRAWN")  # read, never changed
