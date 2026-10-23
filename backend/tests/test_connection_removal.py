"""Who may remove a connection request from the Network page.

Regression cover: DELETE /me/connections/{id} removed any row the caller was
part of, so a requester whose request was declined could clear the decline,
which is what stops them sending a new request.
"""

import pytest

from tests.factories_messaging import connection, person

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/connections"
AMELIA = "a0000000-0000-4000-8000-000000000021"  # sent the request
MEI = "c0000000-0000-4000-8000-000000000021"  # received it
JON = "c0000000-0000-4000-8000-000000000022"  # neither
REQUEST = "d0000000-0000-4000-8000-000000000021"


@pytest.fixture
def people(strict_schema):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(MEI, "TENANT", "Mei Lin"),
        person(JON, "LANDLORD", "Jon Doe"),
    ])
    return strict_schema


def _request(db, status):
    db.seed("connection_requests", [connection(AMELIA, MEI, status, id=REQUEST)])


def _stored(db) -> list[str]:
    return [row["id"] for row in db.tables.get("connection_requests", [])]


@pytest.mark.parametrize("status", ["DECLINED", "BLOCKED"])
def test_a_declined_requester_cannot_clear_the_decline(client, people, as_profile, status):
    _request(people, status)
    as_profile(id=AMELIA, role="service_provider")

    response = client.delete(f"{API}/{REQUEST}")

    assert response.status_code == 403
    assert response.json()["detail"] == "Only the person who declined this request can remove it"
    assert _stored(people) == [REQUEST]  # so a new request is still refused


@pytest.mark.parametrize("status, user, role", [
    ("DECLINED", MEI, "tenant"),  # the person who declined changes their mind
    ("PENDING", AMELIA, "service_provider"),  # the requester cancels
    ("ACCEPTED", AMELIA, "service_provider"),
    ("ACCEPTED", MEI, "tenant"),
])
def test_cancelling_clearing_a_decline_and_disconnecting_still_work(client, people, as_profile, status, user, role):
    _request(people, status)
    as_profile(id=user, role=role)

    assert client.delete(f"{API}/{REQUEST}").status_code == 204
    assert _stored(people) == []


@pytest.mark.parametrize("status", ["PENDING", "ACCEPTED", "DECLINED"])
def test_someone_outside_the_request_cannot_find_it(client, people, as_profile, status):
    _request(people, status)
    as_profile(id=JON, role="landlord")

    assert client.delete(f"{API}/{REQUEST}").status_code == 404
    assert client.delete(f"{API}/d0000000-0000-4000-8000-0000000000ff").status_code == 404
    assert client.delete(f"{API}/not-a-request").status_code == 404
    assert _stored(people) == [REQUEST]


def test_a_request_withdrawn_in_the_app_is_no_longer_there(client, people, as_profile):
    _request(people, "WITHDRAWN")
    as_profile(id=AMELIA, role="service_provider")

    assert client.delete(f"{API}/{REQUEST}").status_code == 404
    as_profile(id=MEI, role="tenant")
    assert client.patch(f"{API}/{REQUEST}", json={"status": "accepted"}).status_code == 404
    assert _stored(people) == [REQUEST]
