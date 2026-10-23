"""The admin console's activity log (tracker R40): both audit logs, filtered and paged.

The admin log is the shared mobile_admin_audit_entries (decisions from both
apps, review reports); the web log is the web's audit_log (every change a
request made, and named events). Each is read on its own, newest first,
with the actor's name, and filtered by actor, action, kind of row and
Sydney calendar days.
"""

import pytest

from tests.factories_admin import audit_entry, bearer
from tests.factories_identity import like_escapes, users_row  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a6000000-0000-4000-8000-000000000001"
MOBILE_ADMIN = "a6000000-0000-4000-8000-000000000002"
OWNER = "b6000000-0000-4000-8000-000000000001"
TENANT = "b6000000-0000-4000-8000-000000000002"
TARGET = "c6000000-0000-4000-8000-000000000001"
REVIEW = "c6000000-0000-4000-8000-000000000002"

API = "/api/v1/admin/activity"


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(MOBILE_ADMIN, "max@example.test", "ADMIN", full_name="Max Mobile"),
        users_row(OWNER, "oliver@example.test", "LANDLORD", full_name="Oliver Grant"),
        users_row(TENANT, "tia@example.test", full_name="Tia Nguyen"),
    ])
    strict_schema.seed("mobile_admin_audit_entries", [
        audit_entry("e6000000-0000-4000-8000-000000000001", ADMIN, "user.status_changed", "user", TARGET,
                    summary="Suspended Tia Nguyen (tenant): Spam", created_at="2025-11-30T13:30:00+00:00",
                    metadata={"source": "web", "reason": "Spam", "from_status": "ACTIVE", "to_status": "SUSPENDED",
                              "nested": {"ignored": True}}),
        audit_entry("e6000000-0000-4000-8000-000000000002", OWNER, "review.reported", "review", REVIEW,
                    summary="Review reported from the web app", created_at="2025-12-02T00:00:00+00:00",
                    metadata={"source": "web", "reason": "other"}),
        audit_entry("e6000000-0000-4000-8000-000000000003", MOBILE_ADMIN, "listing.approved", "listing", None,
                    summary="Approved a listing", created_at="2025-12-03T00:00:00+00:00"),
    ])
    strict_schema.seed("audit_log", [
        {"id": "f6000000-0000-4000-8000-000000000001", "actor_id": TENANT, "action": "post:/api/v1/complaints",
         "metadata": {"method": "POST", "path": "/api/v1/complaints", "status": 201},
         "created_at": "2025-12-01T00:00:00+00:00"},
        {"id": "f6000000-0000-4000-8000-000000000002", "actor_id": OWNER, "action": "property.created",
         "entity_type": "property", "entity_id": TARGET, "metadata": {"title": "Harbour flat"},
         "created_at": "2025-12-04T00:00:00+00:00"},
    ], schema="web")
    return strict_schema


@pytest.fixture
def admin(client, db):
    return bearer(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")


def actions(client, admin, **params) -> list[str]:
    response = client.get(API, params=params, headers=admin)
    assert response.status_code == 200, response.text
    return [item["action"] for item in response.json()["items"]]


def test_the_admin_log_lists_decisions_newest_first_with_their_actors(client, db, admin):
    response = client.get(API, headers=admin)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["action"] for item in body["items"]] == ["listing.approved", "review.reported", "user.status_changed"]
    assert (body["log"], body["total"]) == ("admin", 3)
    suspended = body["items"][2]
    assert suspended["actor"] == {"id": ADMIN, "full_name": "Ada Admin", "role": "admin"}
    assert (suspended["summary"], suspended["entity_type"], suspended["entity_id"]) == (
        "Suspended Tia Nguyen (tenant): Spam", "user", TARGET)
    # Plain values only.
    assert suspended["details"] == {"source": "web", "reason": "Spam", "from_status": "ACTIVE", "to_status": "SUSPENDED"}


def test_the_web_log_lists_requests_and_events(client, db, admin):
    response = client.get(API, params={"log": "web"}, headers=admin)

    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [(item["action"], item["summary"], item["actor"]["full_name"]) for item in items] == [
        ("property.created", None, "Oliver Grant"),
        ("post:/api/v1/complaints", "POST /api/v1/complaints", "Tia Nguyen"),
    ]
    assert items[1]["details"] == {"method": "POST", "path": "/api/v1/complaints", "status": 201}


def test_an_action_is_found_as_the_log_shows_it(client, db, admin, like_escapes):
    # Web log actions hold a colon, which the console's search box keeps.
    assert actions(client, admin, log="web", action="post:/api/v1/complaints") == ["post:/api/v1/complaints"]
    assert actions(client, admin, log="web", action="POST:/API") == ["post:/api/v1/complaints"]
    # LIKE's wildcards are only themselves.
    assert actions(client, admin, log="web", action="post_/api") == []
    assert actions(client, admin, log="web", action="%") == []


def test_the_log_filters_by_actor_action_kind_and_day(client, db, admin, like_escapes):
    assert actions(client, admin, actor="ada") == ["user.status_changed"]
    assert actions(client, admin, actor=MOBILE_ADMIN) == ["listing.approved"]
    assert actions(client, admin, actor="nobody at all") == []
    assert actions(client, admin, action="status_changed") == ["user.status_changed"]
    assert actions(client, admin, entity_type="review") == ["review.reported"]
    # 30 Nov 13:30 UTC is 1 December in Sydney.
    assert actions(client, admin, **{"from": "2025-12-01", "to": "2025-12-02"}) == [
        "review.reported", "user.status_changed"]
    assert actions(client, admin, **{"to": "2025-11-30"}) == []
    assert actions(client, admin, log="web", actor="oliver") == ["property.created"]
    page = client.get(API, params={"limit": 1, "offset": 1}, headers=admin).json()
    assert ([item["action"] for item in page["items"]], page["total"]) == (["review.reported"], 3)
    backwards = client.get(API, params={"from": "2025-12-02", "to": "2025-12-01"}, headers=admin)
    assert (backwards.status_code, backwards.json()["detail"]) == (422, "The end date is before the start date.")
    assert client.get(API, params={"log": "mobile"}, headers=admin).status_code == 422
