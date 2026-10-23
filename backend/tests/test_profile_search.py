"""Profile search on shared users rows (primary_role + metadata, no role column)."""

import pytest

from tests.factories_messaging import connection, person

pytestmark = pytest.mark.usefixtures("strict_schema")

ME = "a0000000-0000-4000-8000-000000000001"
JON = "c0000000-0000-4000-8000-000000000001"
MEI = "c0000000-0000-4000-8000-000000000009"
AGENT = "c0000000-0000-4000-8000-000000000003"
ADMIN = "d0000000-0000-4000-8000-000000000001"
SUSPENDED = "d0000000-0000-4000-8000-000000000002"
ARCHIVED = "d0000000-0000-4000-8000-000000000003"


def seed_directory(db):
    db.seed("users", [
        person(ME, "SERVICE_PROVIDER", "Amelia Whitlock", location="Newtown", state="NSW"),
        person(JON, "LANDLORD", "Jon Doe", location="Enmore", state="NSW", postcode="2042"),
        person(MEI, "TENANT", "Mei Lin", location="Marrickville", state="NSW"),
        person(AGENT, "AGENT", "Ava Agent", location="Petersham", state="NSW"),
        person(ADMIN, "ADMIN", "Ada Admin", location="Marrickville"),
        {**person(SUSPENDED, "TENANT", "Sus Pended", location="Marrickville"), "status": "SUSPENDED"},
        {**person(ARCHIVED, "LANDLORD", "Archie Ved"), "deleted_at": "2025-12-01T00:00:00+00:00"},
    ])
    db.seed("connection_requests", [
        connection(ME, JON, "PENDING"),
        connection(AGENT, ME, "BLOCKED"),
        connection(MEI, ME, "WITHDRAWN"),
    ])


def test_profile_search_returns_web_roles_and_saved_areas(client, strict_schema, as_profile):
    seed_directory(strict_schema)
    as_profile(id=ME, role="service_provider")

    response = client.get("/api/v1/profiles/search", params={"limit": 24})

    assert response.status_code == 200, response.text
    unrated = {"rating_avg": None, "review_count": 0, "verified": False}
    assert response.json() == [
        {"id": AGENT, "full_name": "Ava Agent", "role": "landlord", "avatar_url": None,
         "location": "Petersham", "state": "NSW", "connection_status": "declined", **unrated,
         "connection": {"user_id": AGENT, "state": "unavailable", "connection_id": connection(AGENT, ME, "BLOCKED")["id"]}},
        {"id": JON, "full_name": "Jon Doe", "role": "landlord", "avatar_url": None,
         "location": "Enmore", "state": "NSW", "connection_status": "pending", **unrated,
         "connection": {"user_id": JON, "state": "sent", "connection_id": connection(ME, JON, "PENDING")["id"]}},
        {"id": MEI, "full_name": "Mei Lin", "role": "tenant", "avatar_url": None,
         "location": "Marrickville", "state": "NSW", "connection_status": None, **unrated,
         "connection": {"user_id": MEI, "state": "none", "connection_id": None}},
    ]


def test_profile_search_matches_names_saved_areas_and_roles(client, strict_schema, as_profile):
    seed_directory(strict_schema)
    as_profile(id=ME, role="service_provider")

    def found(**params):
        response = client.get("/api/v1/profiles/search", params=params)
        assert response.status_code == 200, response.text
        return [found_person["id"] for found_person in response.json()]

    assert found(search="mei") == [MEI]
    assert found(search="marrick") == [MEI]  # not the admin, nor the suspended account
    assert found(search="Enmore") == [JON]
    assert found(search="Enmore", role="tenant") == []
    assert found(role="landlord") == [AGENT, JON]  # an agent lists as a landlord; not the archived one
    assert found(role="admin") == found(role="officer") == []
    assert found(search="Parramatta") == []


HIDDEN = "c0000000-0000-4000-8000-000000000004"
SHOWN = "c0000000-0000-4000-8000-000000000005"


@pytest.mark.parametrize("hidden", [False, "false"])
def test_a_member_who_hid_their_profile_is_left_out_of_the_search(client, strict_schema, as_profile, hidden):
    # The settings' "Show my public profile" switch: public profiles leave them out too.
    seed_directory(strict_schema)
    strict_schema.seed("users", [
        person(HIDDEN, "TENANT", "Aaron Hidden", location="Newtown", privacy={"public_profile": hidden}),
        person(SHOWN, "TENANT", "Bea Shown", location="Newtown", privacy={"public_profile": True}),
    ])
    as_profile(id=JON, role="landlord")

    everyone = client.get("/api/v1/profiles/search", params={"role": "tenant"})
    by_name = client.get("/api/v1/profiles/search", params={"search": "Hidden"})
    # The hidden member sorts first, and the page still fills from the members after them.
    first = client.get("/api/v1/profiles/search", params={"role": "tenant", "limit": 1})

    assert [found["id"] for found in everyone.json()] == [SHOWN, MEI]
    assert by_name.status_code == 200 and by_name.json() == []
    assert [found["id"] for found in first.json()] == [SHOWN]
