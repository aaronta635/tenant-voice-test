"""Only an active admin reaches moderation, complaints, categories, activity and analytics (tracker R38, R40).

Each endpoint is called directly with a real (fake-backed) token for every
other role, as tests/test_admin_access.py does for the rest of /admin. A
refused request changes nothing: no complaint, category, review or listing
moves, no step, notice or audit entry is written.
"""

import pytest

from tests.factories import NOW
from tests.factories_admin import issue_category, named_trail
from tests.factories_identity import account
from tests.factories_reviews_complaints import complaint, review, seed_rental, user

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a8000000-0000-4000-8000-000000000001"
CALLER = "a8000000-0000-4000-8000-000000000002"
TENANT = "b8000000-0000-4000-8000-000000000001"
OWNER = "b8000000-0000-4000-8000-000000000002"
PROPERTY = "c8000000-0000-4000-8000-000000000001"
LISTING = "c8000000-0000-4000-8000-000000000002"
COMPLAINT = "d8000000-0000-4000-8000-000000000001"
CATEGORY = "d8000000-0000-4000-8000-000000000002"
REVIEW = "d8000000-0000-4000-8000-000000000003"

ADMIN_API = "/api/v1/admin"
ENDPOINTS = [
    ("get", f"{ADMIN_API}/complaints", None),
    ("get", f"{ADMIN_API}/complaints/assignees", None),
    ("get", f"{ADMIN_API}/complaints/{COMPLAINT}", None),
    ("post", f"{ADMIN_API}/complaints/{COMPLAINT}/status", {"status": "IN_REVIEW", "note": "Testing access"}),
    ("post", f"{ADMIN_API}/complaints/{COMPLAINT}/assignment", {"assignee_id": CALLER}),
    ("get", f"{ADMIN_API}/complaint-categories", None),
    ("post", f"{ADMIN_API}/complaint-categories", {"name": "Testing", "sla_hours": 24}),
    ("patch", f"{ADMIN_API}/complaint-categories/{CATEGORY}", {"name": "Changed", "expected_updated_at": NOW}),
    ("post", f"{ADMIN_API}/complaint-categories/{CATEGORY}/active", {"is_active": False}),
    ("get", f"{ADMIN_API}/reviews", None),
    ("post", f"{ADMIN_API}/reviews/{REVIEW}/moderation", {"action": "hide", "reason": "Testing access"}),
    ("get", f"{ADMIN_API}/listings", None),
    ("post", f"{ADMIN_API}/listings/{LISTING}/moderation", {"action": "pause", "reason": "Testing access"}),
    ("get", f"{ADMIN_API}/activity", None),
    ("get", f"{ADMIN_API}/activity?log=web", None),
    ("get", f"{ADMIN_API}/analytics", None),
]


@pytest.fixture
def db(strict_schema):
    """One of each thing the endpoints read or change."""
    strict_schema.seed("users", [user(TENANT, "Tia Nguyen"), user(OWNER, "Oliver Grant", "LANDLORD")])
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING)
    strict_schema.seed("complaints", [complaint(COMPLAINT, TENANT, against_user_id=OWNER, property_id=PROPERTY)])
    strict_schema.seed("mobile_admin_issue_categories", [issue_category(CATEGORY, "MOULD", "Mould")])
    strict_schema.seed("reviews", [review(REVIEW, TENANT, OWNER, property_id=PROPERTY, status="FLAGGED")])
    return strict_schema


def call(client, method, path, body, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    if body is None:
        return getattr(client, method)(path, headers=headers)
    return getattr(client, method)(path, json=body, headers=headers)


def assert_unchanged(db):
    assert [row["status"] for row in db.tables["complaints"]] == ["OPEN"]
    assert db.tables["complaints"][0]["metadata"] is None
    assert [(row["name"], row["is_active"]) for row in db.tables["mobile_admin_issue_categories"]] == [("Mould", True)]
    assert [row["status"] for row in db.tables["reviews"]] == ["FLAGGED"]
    assert [row["status"] for row in db.tables["listings"]] == ["PUBLISHED"]
    assert not db.tables.get("complaint_events") and not db.tables.get("notifications")
    assert not db.tables.get("mobile_admin_audit_entries") and not named_trail(db)


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "REGULATOR"])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_every_other_role_is_refused_on_every_endpoint(client, db, primary_role, method, path, body):
    token = account(db, CALLER, "caller@example.test", primary_role)

    response = call(client, method, path, body, token)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "This area is for TenantVoice administrators."
    assert_unchanged(db)


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_a_signed_out_caller_is_refused_on_every_endpoint(client, db, method, path, body):
    assert call(client, method, path, body).status_code == 401
    assert call(client, method, path, body, "not-a-token").status_code == 401
    assert_unchanged(db)


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_an_admin_account_that_is_not_active_is_refused(client, db, method, path, body):
    token = account(db, ADMIN, "ada@example.test", "ADMIN", status="PENDING_VERIFICATION")

    assert call(client, method, path, body, token).status_code == 403
    assert_unchanged(db)


def test_an_admin_role_in_the_tokens_metadata_counts_for_nothing(client, db):
    token = db.add_auth_user("mallory@example.test", role="admin", primary_role="ADMIN")
    db.seed("users", [user(CALLER, "Mallory", auth_user_id=db.tokens[token])])

    for method, path, body in ENDPOINTS:
        assert call(client, method, path, body, token).status_code == 403, path
    assert_unchanged(db)


def test_an_active_admin_reads_every_page(client, db):
    token = account(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")

    for method, path, body in ENDPOINTS:
        if method == "get":
            assert call(client, method, path, body, token).status_code == 200, path
