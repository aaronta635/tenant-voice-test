"""Sending, answering and listing connection requests (/me/connections) on the shared connection_requests rows.

A request goes from sender_user_id to receiver_user_id with an upper-case
status; the API keeps requester, addressee and lower-case statuses. A request
withdrawn in the mobile app neither lists nor blocks a new one.
"""

import pytest

from app.services import connections
from tests.factories_messaging import connection, person

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/connections"
AMELIA = "a0000000-0000-4000-8000-000000000031"
MEI = "c0000000-0000-4000-8000-000000000031"
JON = "c0000000-0000-4000-8000-000000000032"
NOBODY = "c0000000-0000-4000-8000-0000000000ff"
WITHDRAWN = "d0000000-0000-4000-8000-000000000031"
DECLINE = "d0000000-0000-4000-8000-000000000032"


@pytest.fixture
def people(strict_schema, as_profile):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(MEI, "TENANT", "Mei Lin", location="Newtown"),
        person(JON, "AGENT", "Jon Doe"),
    ])
    as_profile(id=AMELIA, role="service_provider")
    return strict_schema


def _stored(db) -> list[tuple]:
    return [(row["sender_user_id"], row["receiver_user_id"], row["status"])
            for row in db.tables.get("connection_requests", [])]


def test_a_request_is_sent_pending_and_outgoing(client, people):
    response = client.post(API, json={"addressee_id": MEI})

    assert response.status_code == 201, response.text
    sent = response.json()
    assert (sent["status"], sent["direction"], sent["person_id"]) == ("pending", "outgoing", MEI)
    assert (sent["requester_id"], sent["addressee_id"], sent["responded_at"]) == (AMELIA, MEI, None)
    assert (sent["person_name"], sent["person_role"], sent["person_location"]) == ("Mei Lin", "tenant", "Newtown")
    [row] = people.tables["connection_requests"]
    assert (row["sender_user_id"], row["receiver_user_id"], row["status"], row["context_type"]) == (
        AMELIA, MEI, "PENDING", "NETWORK"
    )
    assert [request["id"] for request in client.get(API).json()] == [sent["id"]]


def test_nobody_can_connect_with_themselves(client, people):
    response = client.post(API, json={"addressee_id": AMELIA})

    assert (response.status_code, response.json()["detail"]) == (400, "You cannot connect with yourself")
    assert _stored(people) == []


@pytest.mark.parametrize("addressee", [NOBODY, "not-a-person", f"{MEI},status.eq.PENDING"])
def test_an_unknown_profile_cannot_be_asked(client, people, addressee):
    response = client.post(API, json={"addressee_id": addressee})

    assert (response.status_code, response.json()["detail"]) == (404, "Profile not found")
    assert _stored(people) == []


@pytest.mark.parametrize("sender, receiver, status", [
    (AMELIA, MEI, "PENDING"), (MEI, AMELIA, "PENDING"),
    (AMELIA, MEI, "ACCEPTED"), (MEI, AMELIA, "ACCEPTED"),
    (AMELIA, MEI, "DECLINED"),  # Mei declined Amelia's request
    (AMELIA, MEI, "BLOCKED"), (MEI, AMELIA, "BLOCKED"),
])
def test_a_second_request_between_two_people_is_refused_in_either_direction(client, people, sender, receiver, status):
    people.seed("connection_requests", [connection(sender, receiver, status)])

    response = client.post(API, json={"addressee_id": MEI})

    assert (response.status_code, response.json()["detail"]) == (409, "A connection already exists with this member")
    assert _stored(people) == [(sender, receiver, status)]


def test_after_a_decline_only_the_person_who_declined_can_send_again(client, people, as_profile):
    people.seed("connection_requests", [connection(MEI, AMELIA, "DECLINED", id=DECLINE)])  # Amelia declined Mei

    as_profile(id=MEI, role="tenant")
    assert client.post(API, json={"addressee_id": AMELIA}).status_code == 409
    as_profile(id=AMELIA, role="service_provider")
    response = client.post(API, json={"addressee_id": MEI})

    assert response.status_code == 201, response.text
    assert (response.json()["id"], response.json()["direction"]) == (DECLINE, "outgoing")  # on the same row
    assert _stored(people) == [(AMELIA, MEI, "PENDING")]
    [row] = people.tables["connection_requests"]
    assert row["responded_at"] is None


@pytest.mark.parametrize("sender, receiver", [(AMELIA, MEI), (MEI, AMELIA)], ids=["own", "theirs"])
def test_a_request_withdrawn_in_the_app_does_not_block_a_new_one(client, people, sender, receiver):
    people.seed("connection_requests", [connection(sender, receiver, "WITHDRAWN", id=WITHDRAWN)])

    response = client.post(API, json={"addressee_id": MEI})

    assert response.status_code == 201, response.text
    assert response.json()["id"] == WITHDRAWN  # sent again on the same row
    assert _stored(people) == [(AMELIA, MEI, "PENDING")]
    [row] = people.tables["connection_requests"]
    assert row["responded_at"] is None and row["created_at"] > "2026"


def test_the_recipient_accepts_or_declines_once(client, people, as_profile):
    request = client.post(API, json={"addressee_id": MEI}).json()

    assert client.patch(f"{API}/{request['id']}", json={"status": "accepted"}).status_code == 403  # the sender
    as_profile(id=MEI, role="tenant")
    assert client.patch(f"{API}/{request['id']}", json={"status": "maybe"}).status_code == 400
    answered = client.patch(f"{API}/{request['id']}", json={"status": "accepted"})
    again = client.patch(f"{API}/{request['id']}", json={"status": "declined"})

    assert answered.status_code == 200, answered.text
    assert (answered.json()["status"], answered.json()["direction"], answered.json()["person_id"]) == (
        "accepted", "incoming", AMELIA
    )
    assert answered.json()["responded_at"] is not None
    assert (again.status_code, again.json()["detail"]) == (400, "This request has already been answered")
    assert _stored(people) == [(AMELIA, MEI, "ACCEPTED")]


def test_an_answer_the_app_gave_first_wins(client, people, as_profile, monkeypatch):
    request = client.post(API, json={"addressee_id": MEI}).json()
    as_profile(id=MEI, role="tenant")
    # Declined in the mobile app after the web read the request as pending.
    read = connections._connection
    monkeypatch.setattr(connections, "_connection", lambda connection_id: {
        **read(connection_id), "status": "pending",
    })
    people.tables["connection_requests"][0]["status"] = "DECLINED"

    response = client.patch(f"{API}/{request['id']}", json={"status": "accepted"})

    assert (response.status_code, response.json()["detail"]) == (400, "This request has already been answered")
    assert _stored(people) == [(AMELIA, MEI, "DECLINED")]


def test_a_declined_requester_can_ask_again_only_once_the_decliner_clears_it(client, people, as_profile):
    request = client.post(API, json={"addressee_id": MEI}).json()
    as_profile(id=MEI, role="tenant")
    assert client.patch(f"{API}/{request['id']}", json={"status": "declined"}).status_code == 200

    as_profile(id=AMELIA, role="service_provider")
    assert client.post(API, json={"addressee_id": MEI}).status_code == 409
    assert _stored(people) == [(AMELIA, MEI, "DECLINED")]

    as_profile(id=MEI, role="tenant")
    assert client.delete(f"{API}/{request['id']}").status_code == 204
    as_profile(id=AMELIA, role="service_provider")
    again = client.post(API, json={"addressee_id": MEI})
    assert again.status_code == 201, again.text
    assert _stored(people) == [(AMELIA, MEI, "PENDING")]


def test_the_network_page_lists_both_directions_and_filters_by_status(client, people):
    people.seed("connection_requests", [
        connection(AMELIA, MEI, "ACCEPTED", created_at="2025-12-01T00:00:00+00:00"),
        connection(JON, AMELIA, "PENDING", created_at="2025-12-02T00:00:00+00:00"),
        connection(AMELIA, NOBODY, "BLOCKED", created_at="2025-12-03T00:00:00+00:00"),
        connection(NOBODY, AMELIA, "WITHDRAWN", created_at="2025-12-04T00:00:00+00:00"),
        connection(JON, MEI, "ACCEPTED"),  # someone else's
    ])

    def listed(**params):
        response = client.get(API, params=params)
        assert response.status_code == 200, response.text
        return [(c["person_id"], c["status"], c["direction"]) for c in response.json()]

    assert listed() == [
        (NOBODY, "declined", "outgoing"), (JON, "pending", "incoming"), (MEI, "accepted", "outgoing"),
    ]
    assert listed(status="pending") == [(JON, "pending", "incoming")]
    assert listed(status="declined") == [(NOBODY, "declined", "outgoing")]
    # A person with no users row is listed unnamed; an agent is a landlord.
    by_person = {c["person_id"]: c for c in client.get(API).json()}
    assert (by_person[NOBODY]["person_name"], by_person[JON]["person_role"]) == ("TenantVoice member", "landlord")
    response = client.get(API, params={"status": "withdrawn"})
    assert (response.status_code, response.json()["detail"]) == (400, "Status must be pending, accepted or declined")
