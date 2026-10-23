"""Listing moderation (tracker R40; handover package 8 step 3).

An admin pauses a listing (out of search; its owner may publish it again
once it is fixed) or archives it (gone from the web), with a reason the
owner, and an agent who manages it, are told. A rented listing is never
archived. Each decision applies only to the status the admin saw and is
recorded with its admin and reason in both audit logs.
"""

import pytest

from app.services import admin_moderation
from tests.factories_admin import bearer, lands_first, named_trail, shared_trail
from tests.factories_identity import like_escapes, users_row  # noqa: F401 (fixture)
from tests.factories_reviews_complaints import listing, property_row

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a5000000-0000-4000-8000-000000000001"
OWNER = "b5000000-0000-4000-8000-000000000001"
AGENT = "b5000000-0000-4000-8000-000000000002"
HOME = "c5000000-0000-4000-8000-000000000001"
FLAT = "c5000000-0000-4000-8000-000000000002"
LIVE = "d5000000-0000-4000-8000-000000000001"
RENTED = "d5000000-0000-4000-8000-000000000002"
DRAFT = "d5000000-0000-4000-8000-000000000003"
CLOSED = "d5000000-0000-4000-8000-000000000004"

API = "/api/v1/admin/listings"


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(OWNER, "oliver@example.test", "LANDLORD", full_name="Oliver Grant"),
        users_row(AGENT, "alex@example.test", "AGENT", full_name="Alex Agent"),
    ])
    strict_schema.seed("properties", [
        property_row(HOME, OWNER, manager_user_id=AGENT),
        property_row(FLAT, OWNER, suburb="Fairy Meadow"),
    ])
    strict_schema.seed("listings", [
        listing(LIVE, HOME, AGENT, "Sunny house", created_at="2025-12-03T00:00:00+00:00"),
        listing(RENTED, FLAT, OWNER, "Harbour flat", status="LEASED", created_at="2025-12-02T00:00:00+00:00"),
        listing(DRAFT, FLAT, OWNER, "Harbour flat (draft)", status="DRAFT", created_at="2025-12-01T00:00:00+00:00"),
    ])
    return strict_schema


@pytest.fixture
def admin(client, db):
    return bearer(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")


def status_of(db, listing_id) -> str:
    return next(row["status"] for row in db.tables["listings"] if row["id"] == listing_id)


def notices(db) -> list[tuple]:
    return [(n["user_id"], n["title"], n["body"], n["link"]) for n in db.tables.get("notifications", [])]


def ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_the_list_shows_every_listing_with_its_owner_and_what_can_be_done(client, db, admin, like_escapes):
    response = client.get(API, headers=admin)

    assert ids(response) == [LIVE, RENTED, DRAFT]
    live, rented, draft = response.json()["items"]
    assert (live["owner"]["full_name"], live["manager"]["full_name"], live["actions"]) == (
        "Oliver Grant", "Alex Agent", ["pause", "archive"])
    assert (rented["actions"], draft["actions"]) == ([], ["archive"])
    assert live["address"] == "12 Harbour St, Wollongong, NSW, 2500" and live["last_decision"] is None
    assert ids(client.get(API, params={"status": "LEASED"}, headers=admin)) == [RENTED]
    assert ids(client.get(API, params={"q": "harbour"}, headers=admin)) == [RENTED, DRAFT]
    page = client.get(API, params={"limit": 1, "offset": 1}, headers=admin)
    assert (ids(page), page.json()["total"]) == ([RENTED], 3)


def test_pausing_a_listing_takes_it_out_of_search_and_tells_its_owner(client, db, admin):
    assert LIVE in [item["id"] for item in client.get("/api/v1/properties").json()]

    response = client.post(f"{API}/{LIVE}/moderation", json={
        "action": "pause", "reason": "The photos show another house.", "expected_status": "PUBLISHED",
    }, headers=admin)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["actions"]) == ("PAUSED", ["archive"])
    assert (body["last_decision"]["decision"], body["last_decision"]["reason"]) == (
        "paused", "The photos show another house.")
    assert body["last_decision"]["actor"]["full_name"] == "Ada Admin"
    assert status_of(db, LIVE) == "PAUSED"
    assert LIVE not in [item["id"] for item in client.get("/api/v1/properties").json()]
    assert client.get(f"/api/v1/properties/{LIVE}").status_code == 404
    title = "Your listing “Sunny house” was paused"
    body_text = "A TenantVoice admin took it out of search. Reason: The photos show another house. Fix it, then publish it again."
    assert notices(db) == [(OWNER, title, body_text, f"/owner/properties/{LIVE}"),
                           (AGENT, title, body_text, f"/owner/properties/{LIVE}")]
    [entry] = shared_trail(db, "listing.moderated")
    assert (entry["actor_user_id"], entry["entity_type"], entry["entity_id"]) == (ADMIN, "listing", LIVE)
    assert entry["summary"] == "Paused the listing “Sunny house”: The photos show another house."
    assert {key: entry["metadata"][key] for key in ("decision", "from_status", "to_status", "reason", "owner_id")} == {
        "decision": "paused", "from_status": "PUBLISHED", "to_status": "PAUSED",
        "reason": "The photos show another house.", "owner_id": OWNER}
    assert [(e["actor_id"], e["action"], e["entity_id"]) for e in named_trail(db)] == [
        (ADMIN, "listing.moderated", LIVE)]


def test_archiving_a_listing_removes_it_from_the_web(client, db, admin):
    response = client.post(f"{API}/{DRAFT}/moderation", json={"action": "archive", "reason": "A scam listing."},
                           headers=admin)

    assert response.status_code == 200, response.text
    assert status_of(db, DRAFT) == "ARCHIVED" and response.json()["actions"] == []
    # The row stays: archived is how the web deletes a listing.
    assert len(db.tables["listings"]) == 3
    assert notices(db) == [(OWNER, "Your listing “Harbour flat (draft)” was removed",
                            "A TenantVoice admin archived it. Reason: A scam listing.", "/owner/properties")]


@pytest.mark.parametrize("listing_id, payload, code", [
    (RENTED, {"action": "archive", "reason": "Old"}, 409),
    (RENTED, {"action": "pause", "reason": "Old"}, 409),
    (DRAFT, {"action": "pause", "reason": "Old"}, 409),
    (LIVE, {"action": "pause", "reason": "Old", "expected_status": "PAUSED"}, 409),
    (LIVE, {"action": "pause", "reason": " "}, 422),
    (LIVE, {"action": "delete", "reason": "Old"}, 422),
    ("d5000000-0000-4000-8000-000000000099", {"action": "pause", "reason": "Old"}, 404),
    ("not-a-listing", {"action": "pause", "reason": "Old"}, 404),
])
def test_a_decision_needs_a_reason_and_a_listing_it_applies_to(client, db, admin, listing_id, payload, code):
    response = client.post(f"{API}/{listing_id}/moderation", json=payload, headers=admin)

    assert response.status_code == code, response.text
    assert [status_of(db, listing_id) for listing_id in (LIVE, RENTED, DRAFT)] == ["PUBLISHED", "LEASED", "DRAFT"]
    assert not shared_trail(db) and not db.tables.get("notifications")


def test_a_listing_closed_to_applications_offers_no_pause_and_is_refused_with_a_reason(client, db, admin):
    # enforce_listing_status_transition never moves APPLICATIONS_CLOSED to PAUSED, as the catalog rules enforce.
    assert db.catalog_rules
    db.seed("listings", [listing(CLOSED, HOME, AGENT, "Closed house", status="APPLICATIONS_CLOSED",
                                 created_at="2025-12-04T00:00:00+00:00")])
    [closed] = [item for item in client.get(API, headers=admin).json()["items"] if item["id"] == CLOSED]
    assert closed["actions"] == ["archive"]

    response = client.post(f"{API}/{CLOSED}/moderation", json={
        "action": "pause", "reason": "Wrong photos.", "expected_status": "APPLICATIONS_CLOSED",
    }, headers=admin)

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == admin_moderation.PAUSE_REFUSALS["APPLICATIONS_CLOSED"]
    assert status_of(db, CLOSED) == "APPLICATIONS_CLOSED"
    assert not shared_trail(db) and not db.tables.get("notifications")
    archived = client.post(f"{API}/{CLOSED}/moderation", json={"action": "archive", "reason": "Wrong photos."},
                           headers=admin)
    assert archived.status_code == 200, archived.text
    assert status_of(db, CLOSED) == "ARCHIVED"


def test_a_decision_on_a_listing_its_owner_just_changed_writes_nothing(client, db, admin, monkeypatch):
    lands_first(monkeypatch, admin_moderation, lambda: next(
        row for row in db.tables["listings"] if row["id"] == LIVE).update(status="APPLICATIONS_CLOSED"))

    response = client.post(f"{API}/{LIVE}/moderation", json={"action": "pause", "reason": "Wrong photos."}, headers=admin)

    assert response.status_code == 409
    assert status_of(db, LIVE) == "APPLICATIONS_CLOSED"
    assert (notices(db), shared_trail(db, "listing.moderated")) == ([], [])
