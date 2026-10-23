"""Only an active admin reaches /admin, on every endpoint, by direct API call (tracker R16, R17).

Requests carry real (fake-backed) tokens, so the check runs as in production:
get_current_profile reads the users row, and get_current_admin wants the
ADMIN primary role and an ACTIVE account. A refused request changes nothing.
"""

import pytest

from tests.factories import NOW
from tests.factories_documents import document_row, stored_file
from tests.factories_identity import account, users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a1000000-0000-4000-8000-000000000001"
MEMBER = "a1000000-0000-4000-8000-000000000002"
CALLER = "a1000000-0000-4000-8000-000000000003"
DOC = "d1000000-0000-4000-8000-000000000001"

ENDPOINTS = [
    ("get", "/api/v1/admin/me", None),
    ("get", "/api/v1/admin/overview", None),
    ("get", "/api/v1/admin/users", None),
    ("get", f"/api/v1/admin/users/{MEMBER}", None),
    ("post", f"/api/v1/admin/users/{MEMBER}/status", {"status": "SUSPENDED", "reason": "Testing access"}),
    ("get", f"/api/v1/admin/documents/{DOC}/link", None),
    ("get", "/api/v1/admin/verification", None),
    ("get", f"/api/v1/admin/verification/{MEMBER}", None),
    ("post", f"/api/v1/admin/documents/{DOC}/decision", {"decision": "APPROVED", "expected_updated_at": NOW}),
    ("post", f"/api/v1/admin/users/{MEMBER}/verification", {"decision": "REJECTED", "reason": "Testing access"}),
]


@pytest.fixture
def member(strict_schema):
    """A tenant with a document: what each endpoint would read or change."""
    strict_schema.seed("users", [users_row(MEMBER, "mia@example.test", full_name="Mia Member")])
    strict_schema.seed("profile_documents", [document_row(DOC, MEMBER, file_url=stored_file(strict_schema, MEMBER))])
    return strict_schema


def call(client, method, path, body, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return getattr(client, method)(path, json=body, headers=headers) if body else getattr(client, method)(path, headers=headers)


def assert_unchanged(db):
    member = next(user for user in db.tables["users"] if user["id"] == MEMBER)
    assert (member["status"], member["verification_status"]) == ("ACTIVE", "PENDING")
    assert [row["review_status"] for row in db.tables["profile_documents"]] == ["PENDING"]
    assert not db.tables.get("profile_document_review_events") and not db.tables.get("notifications")
    assert not db.tables.get("mobile_admin_audit_entries")
    assert not [entry for entry in db.schema_tables.get("web", {}).get("audit_log", []) if entry["action"] != "auth.logged_in"]
    assert db.storage.signatures == []


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "REGULATOR"])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_every_other_role_is_refused_on_every_admin_endpoint(client, member, primary_role, method, path, body):
    token = account(member, CALLER, "caller@example.test", primary_role)

    response = call(client, method, path, body, token)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "This area is for TenantVoice administrators."
    assert_unchanged(member)


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_a_signed_out_caller_is_refused_on_every_admin_endpoint(client, member, method, path, body):
    assert call(client, method, path, body).status_code == 401
    assert call(client, method, path, body, "not-a-token").status_code == 401
    assert_unchanged(member)


@pytest.mark.parametrize("over, detail", [
    ({"status": "PENDING_VERIFICATION"}, "This admin account is not active. Ask the TenantVoice team to restore it."),
    ({"status": "SUSPENDED"}, "This account is suspended. Contact support to restore access."),
    ({"deleted_at": NOW}, "This account has been closed."),
])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_an_admin_account_that_is_not_active_is_refused(client, member, over, detail, method, path, body):
    token = account(member, ADMIN, "ada@example.test", "ADMIN", **over)

    response = call(client, method, path, body, token)

    assert (response.status_code, response.json()["detail"]) == (403, detail)
    assert_unchanged(member)


def test_an_admin_role_in_the_tokens_metadata_counts_for_nothing(client, member):
    # Anyone can write their own user_metadata; only the users row decides.
    token = member.add_auth_user("mallory@example.test", role="admin", primary_role="ADMIN")
    member.seed("users", [users_row(CALLER, "mallory@example.test", auth_user_id=member.tokens[token])])

    for method, path, body in ENDPOINTS:
        assert call(client, method, path, body, token).status_code == 403
    assert_unchanged(member)


def test_an_active_admin_reaches_the_console(client, member):
    token = account(member, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")

    response = call(client, "get", "/api/v1/admin/me", None, token)

    assert response.status_code == 200, response.text
    assert response.json() == {"id": ADMIN, "full_name": "Ada Admin", "email": "ada@example.test"}
    for method, path, body in ENDPOINTS:
        if method == "get":
            assert call(client, method, path, body, token).status_code == 200, path
