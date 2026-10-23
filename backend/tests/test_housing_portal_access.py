"""Only an active officer reaches /housing, on every endpoint, by direct API call (tracker R41, assumption #8).

Requests carry real (fake-backed) tokens, so the check runs as in production:
get_current_profile reads the users row, and get_current_officer wants the
REGULATOR primary role and an ACTIVE account. Admins are refused too: they
prepare referrals in the admin console. A refused request changes nothing.
The admins' side of the data category requests is for admins alone.
"""

import copy

import pytest

from app.core.officer import INACTIVE_OFFICER, NOT_AN_OFFICER
from tests import fake_rpcs
from tests.factories import NOW
from tests.factories_admin import bearer
from tests.factories_housing import FLAG, OFFICER, REFERRAL, SURVEY, seed_portal
from tests.fake_supabase import api_error

pytestmark = pytest.mark.usefixtures("strict_schema")

CALLER = "e1000000-0000-4000-8000-0000000000aa"
REQUEST = "ea000000-0000-4000-8000-000000000001"

ENDPOINTS = [
    ("get", "/api/v1/housing/me", None),
    ("get", "/api/v1/housing/overview", None),
    ("get", "/api/v1/housing/referrals", None),
    ("post", f"/api/v1/housing/referrals/{REFERRAL}/actions", {"action": "START_REVIEW", "note": "Testing access"}),
    ("get", "/api/v1/housing/red-flags", None),
    ("patch", f"/api/v1/housing/red-flags/alerts/{FLAG}", {"status": "Under review", "from_status": "New"}),
    ("get", "/api/v1/housing/complaints", None),
    ("get", "/api/v1/housing/datapoint-requests", None),
    ("post", "/api/v1/housing/datapoint-requests",
     {"datapoint": "maintenance_categories", "requested_change": "Add pests", "reason": "Testing access"}),
    ("get", "/api/v1/housing/surveys", None),
    ("post", "/api/v1/housing/surveys", {"title": "Access", "audience": "Tenants", "questions": ["Why?"]}),
    ("patch", f"/api/v1/housing/surveys/{SURVEY}", {"status": "Live", "from_status": "Draft"}),
    ("get", "/api/v1/housing/aggregates", None),
]
ADMIN_ENDPOINTS = [
    ("get", "/api/v1/admin/datapoint-requests", None),
    ("patch", f"/api/v1/admin/datapoint-requests/{REQUEST}",
     {"status": "accepted", "response": "Testing access", "from_status": "pending"}),
]


@pytest.fixture
def portal(strict_schema):
    seed_portal(strict_schema)
    strict_schema.seed("datapoint_requests", [{
        "id": REQUEST, "officer_id": None, "datapoint": "other", "requested_change": "Add a field",
        "reason": "Testing access", "created_at": NOW, "updated_at": NOW,
    }], schema="web")
    return strict_schema


def call(client, method, path, body, headers=None):
    headers = headers or {}
    return getattr(client, method)(path, json=body, headers=headers) if body else getattr(client, method)(path, headers=headers)


def snapshot(db) -> dict:
    """What a refused request must leave as it was: every row but the trail of requests and sign-ins."""
    tables = copy.deepcopy(db.schema_tables)
    tables.get("web", {}).pop("audit_log", None)
    return tables


def named_entries(db) -> list[dict]:
    return [entry for entry in db.schema_tables.get("web", {}).get("audit_log", []) if ":" not in entry["action"]]


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "ADMIN"])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_every_other_role_is_refused_on_every_portal_endpoint(client, portal, primary_role, method, path, body):
    headers = bearer(portal, CALLER, "caller@example.test", primary_role)
    before = snapshot(portal)

    response = call(client, method, path, body, headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == NOT_AN_OFFICER
    assert snapshot(portal) == before
    assert named_entries(portal) == []
    # Refused before any function ran as the caller.
    assert [name for name, _ in portal.rpc_calls if name.startswith("mobile_housing")] == []


@pytest.mark.parametrize("method, path, body", ENDPOINTS + ADMIN_ENDPOINTS)
def test_a_signed_out_caller_is_refused_on_every_endpoint(client, portal, method, path, body):
    before = snapshot(portal)

    assert call(client, method, path, body).status_code == 401
    assert call(client, method, path, body, {"Authorization": "Bearer not-a-token"}).status_code == 401
    assert snapshot(portal) == before


@pytest.mark.parametrize("over, detail", [
    ({"status": "PENDING_VERIFICATION"}, INACTIVE_OFFICER),
    ({"status": "SUSPENDED"}, "This account is suspended. Contact support to restore access."),
    ({"deleted_at": NOW}, "This account has been closed."),
])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_an_officer_account_that_is_not_active_is_refused(client, portal, over, detail, method, path, body):
    headers = bearer(portal, OFFICER, "olive@example.test", "REGULATOR", **over)
    before = snapshot(portal)

    response = call(client, method, path, body, headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == detail
    assert snapshot(portal) == before


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_an_active_officer_reaches_every_portal_endpoint(client, portal, method, path, body):
    headers = bearer(portal, OFFICER, "olive@example.test", "REGULATOR", full_name="Olive Officer")

    response = call(client, method, path, body, headers)

    assert response.status_code in (200, 201), response.text


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "REGULATOR"])
@pytest.mark.parametrize("method, path, body", ADMIN_ENDPOINTS)
def test_only_an_admin_reaches_the_admins_side_of_the_requests(client, portal, primary_role, method, path, body):
    headers = bearer(portal, CALLER, "caller@example.test", primary_role)
    before = snapshot(portal)

    response = call(client, method, path, body, headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "This area is for TenantVoice administrators."
    assert snapshot(portal) == before


@pytest.mark.parametrize("method, path, body", ADMIN_ENDPOINTS)
def test_an_admin_reaches_the_admins_side_of_the_requests(client, portal, method, path, body):
    headers = bearer(portal, CALLER, "ada.admin@example.test", "ADMIN", full_name="Ada Admin")

    assert call(client, method, path, body, headers).status_code == 200


def test_the_officer_header_names_the_signed_in_officer(client, portal):
    headers = bearer(portal, OFFICER, "olive@example.test", "REGULATOR", full_name="Olive Officer")

    assert client.get("/api/v1/housing/me", headers=headers).json() == {
        "id": OFFICER, "full_name": "Olive Officer", "email": "olive@example.test",
    }


def test_a_role_taken_away_stops_working_at_once(client, portal):
    headers = bearer(portal, OFFICER, "olive@example.test", "REGULATOR")
    assert client.get("/api/v1/housing/me", headers=headers).status_code == 200

    next(row for row in portal.tables["users"] if row["id"] == OFFICER)["primary_role"] = "TENANT"

    assert client.get("/api/v1/housing/me", headers=headers).status_code == 403


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_the_databases_officer_rule_holds_on_every_endpoint(client, portal, monkeypatch, method, path, body):
    """A REGULATOR the web would let in, but whom mobile_require_housing_officer refuses (say a tightened rule)."""
    def refuse(ctx, params):
        raise api_error("42501", "Housing Portal access is required.")

    fake_rpcs.handler("mobile_require_housing_officer")  # load the stand-ins before replacing one
    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_require_housing_officer", refuse)
    before = copy.deepcopy(portal.tables)
    headers = bearer(portal, CALLER, "ola@example.test", "REGULATOR", full_name="Ola Officer")

    response = call(client, method, path, body, headers)

    assert (response.status_code, response.json()["detail"]) == (403, "Housing Portal access is required.")
    assert {name: rows for name, rows in portal.tables.items() if name != "users"} == {
        name: rows for name, rows in before.items() if name != "users"}

