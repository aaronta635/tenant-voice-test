"""Tenant <-> owner threads about a listing (POST /conversations/rental with property_id, owner_id or tenant_id).

property_id is the listing id the web uses for a property; its owner is the
property's owner_user_id. A thread about a listing is a PROPERTY conversation
with that listing_id; without one, the two must be connected.
"""

import pytest

from app.services import maps_messaging as maps
from tests.factories_messaging import connection, person, seed_listing, seed_thread, stored, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

OWNER, TENANT, RIVAL = (uid(name) for name in ("owner", "tenant", "rival"))
API = "/api/v1/conversations/rental"


@pytest.fixture
def listing(strict_schema):
    strict_schema.seed("users", [person(OWNER, "LANDLORD", "Olivia Owner"), person(TENANT, "TENANT", "Tim Tenant"),
                                 person(RIVAL, "AGENT", "Rita Rival")])
    return seed_listing(strict_schema, OWNER, title="Sunny two-bedder", suburb="Enmore")


def test_a_tenant_contacts_the_owner_about_a_listing(client, strict_schema, as_profile, listing):
    as_profile(id=TENANT, role="tenant")

    opened = client.post(API, json={"property_id": listing, "body": "Is it still available?"})

    assert opened.status_code == 201, opened.text
    thread = opened.json()
    assert (thread["kind"], thread["tenant_id"], thread["owner_id"], thread["property_id"]) == (
        "rental", TENANT, OWNER, listing
    )
    assert (thread["subject"], thread["context"], thread["counterpart_name"]) == (
        "Sunny two-bedder", "Enmore", "Olivia Owner"
    )
    [row] = strict_schema.tables["conversations"]
    assert (row["conversation_type"], row["listing_id"], row["metadata"]) == (
        "PROPERTY", listing, maps.rental_metadata(TENANT, OWNER)
    )
    assert [(m["sender_user_id"], m["content"]) for m in strict_schema.tables["messages"]] == [
        (TENANT, "Is it still available?")
    ]
    [notice] = strict_schema.tables["notifications"]
    assert (notice["user_id"], notice["link"]) == (OWNER, f"/owner/messages?thread={thread['id']}")


def test_contacting_again_reopens_the_thread_even_one_the_app_started(client, strict_schema, as_profile, listing):
    mobile = seed_thread(strict_schema, [TENANT, OWNER], listing_id=listing)
    as_profile(id=TENANT, role="tenant")

    first = client.post(API, json={"property_id": listing}).json()
    as_profile(id=OWNER, role="landlord")
    second = client.post(API, json={"property_id": listing, "tenant_id": TENANT}).json()

    assert first["id"] == second["id"] == mobile
    assert len(strict_schema.tables["conversations"]) == 1


def test_a_group_thread_about_the_listing_is_not_the_pairs_own(client, strict_schema, as_profile, listing):
    # Its id sorts after the owner's, so by roles alone the owner would be its owner side.
    co_owner = "ffffffff-ffff-4fff-bfff-ffffffffffff"
    strict_schema.seed("users", [person(co_owner, "LANDLORD", "Cora Co-owner")])
    group = seed_thread(strict_schema, [TENANT, OWNER, co_owner], listing_id=listing, conversation_type="GROUP")
    as_profile(id=TENANT, role="tenant")

    opened = client.post(API, json={"property_id": listing, "body": "Just between us"})

    assert opened.status_code == 201, opened.text
    assert opened.json()["id"] != group
    assert not stored(strict_schema, "messages", conversation_id=group)
    assert [notice["user_id"] for notice in strict_schema.tables["notifications"]] == [OWNER]


def test_a_thread_about_another_listing_is_another_thread(client, strict_schema, as_profile, listing):
    other = seed_listing(strict_schema, OWNER, title="Garden flat", suburb="Petersham")
    strict_schema.seed("connection_requests", [connection(TENANT, OWNER)])
    as_profile(id=TENANT, role="tenant")

    ids = {client.post(API, json=payload).json()["id"]
           for payload in ({"property_id": listing}, {"property_id": other}, {"owner_id": OWNER})}

    assert len(ids) == 3
    assert sorted(str(row["listing_id"]) for row in strict_schema.tables["conversations"]) == sorted(
        [listing, other, "None"]
    )


def test_an_owner_messages_a_tenant_only_about_their_own_listing(client, strict_schema, as_profile, listing):
    as_profile(id=RIVAL, role="landlord")
    refused = client.post(API, json={"property_id": listing, "tenant_id": TENANT})
    as_profile(id=OWNER, role="landlord")
    allowed = client.post(API, json={"property_id": listing, "tenant_id": TENANT})

    assert (refused.status_code, refused.json()["detail"]) == (403, "You do not own this property")
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["counterpart_name"] == "Tim Tenant"


def test_the_agent_managing_a_listing_messages_its_applicants_too(client, strict_schema, as_profile, listing):
    # The manager decides the listing's applications (property_applications), so they may answer an applicant.
    prop = next(row for row in strict_schema.tables["properties"] if row["owner_user_id"] == OWNER)
    prop["manager_user_id"] = RIVAL
    as_profile(id=RIVAL, role="landlord")

    opened = client.post(API, json={"property_id": listing, "tenant_id": TENANT})

    assert opened.status_code == 201, opened.text
    assert (opened.json()["owner_id"], opened.json()["tenant_id"], opened.json()["counterpart_name"]) == (
        RIVAL, TENANT, "Tim Tenant")


def test_without_a_listing_the_two_must_be_connected(client, strict_schema, as_profile, listing):
    as_profile(id=OWNER, role="landlord")
    assert client.post(API, json={"tenant_id": TENANT}).status_code == 403
    as_profile(id=TENANT, role="tenant")
    assert client.post(API, json={"owner_id": OWNER}).status_code == 403

    strict_schema.seed("connection_requests", [connection(OWNER, TENANT)])
    assert client.post(API, json={"owner_id": OWNER}).status_code == 201


@pytest.mark.parametrize("payload, user, role, status, detail", [
    ({"property_id": uid("no-listing")}, TENANT, "tenant", 404, "Property not found"),
    ({"property_id": "sunny-two-bedder"}, TENANT, "tenant", 404, "Property not found"),
    ({}, TENANT, "tenant", 400, "Provide either property_id, owner_id, or peer_id"),
    ({"property_id": "listing"}, OWNER, "landlord", 404, "Property not found"),
    ({}, OWNER, "landlord", 400, "tenant_id is required when messaging a tenant"),
    ({"tenant_id": "LISTING"}, OWNER, "landlord", 403, "Connect with this person before messaging them"),
])
def test_bad_requests_open_nothing(client, strict_schema, as_profile, listing, payload, user, role, status, detail):
    as_profile(id=user, role=role)

    response = client.post(API, json=payload)

    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert not strict_schema.tables.get("conversations")


def test_an_owner_cannot_open_a_listing_thread_with_someone_who_does_not_exist(client, strict_schema, as_profile,
                                                                               listing):
    as_profile(id=OWNER, role="landlord")

    for tenant in (uid("nobody"), "not-a-person"):
        response = client.post(API, json={"property_id": listing, "tenant_id": tenant})
        assert (response.status_code, response.json()["detail"]) == (404, "Profile not found"), tenant
    assert not strict_schema.tables.get("conversations")


def test_nobody_messages_themselves(client, strict_schema, as_profile, listing):
    as_profile(id=OWNER, role="tenant")  # an owner looking at their own listing as a tenant would

    response = client.post(API, json={"property_id": listing})

    assert (response.status_code, response.json()["detail"]) == (400, "You cannot message yourself")
    assert stored(strict_schema, "conversations") == []
