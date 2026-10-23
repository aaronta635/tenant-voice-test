"""/auth/register, /auth/login, /auth/refresh, /auth/me on the shared schema.

A web account is a users row, its primary user_role_assignments row and the
profile row of its role, written the way the shared database requires (the
strict fake). Regression cover for provisioning there: registration answered
400 and left its auth user behind, an account a failed request left half made
stayed so, and suspended, deactivated and closed accounts still signed in.
Registering an address also handed over a row another app made for it, with
its data, to whoever registered first: nothing confirms the address.
"""

import logging
import uuid

import pytest

from app.core.config import settings
from app.services import maps_identity
from app.services import profiles as profiles_service
from tests import fake_supabase
from tests.factories import NOW
from tests.factories_identity import (  # noqa: F401 (fixtures)
    account,
    auth_deletes,
    auth_refresh,
    fail_inserts,
    like_escapes,
    users_row,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/auth"
REGISTER_PAYLOAD = {
    "email": "new@demo.test",
    "password": "password123",
    "full_name": "New User",
    "role": "tenant",
}
MEI = "c0000000-0000-4000-8000-000000000001"
OLIVIA = "c0000000-0000-4000-8000-000000000002"
OTHER = "c0000000-0000-4000-8000-000000000003"


def _login(client, email, password="password123", **extra):
    return client.post(f"{API}/login", json={"email": email, "password": password, **extra})


def _actions(fake_db) -> list[str]:
    return [entry["action"] for entry in fake_db.schema_tables.get("web", {}).get("audit_log", [])]


@pytest.fixture
def claiming_on(monkeypatch):
    """CLAIM_ACCOUNTS_BY_EMAIL=true: a first sign-in may take over a row another app made."""
    monkeypatch.setattr(settings, "claim_accounts_by_email", True)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role, db_role, table, extra", [
    ("tenant", "TENANT", "tenant_profiles", {"has_pets": False, "completion_score": 0}),
    ("landlord", "LANDLORD", "landlord_profiles", {"verification_status": "PENDING"}),
    ("service_provider", "SERVICE_PROVIDER", "service_provider_profiles",
     {"verification_status": "PENDING", "metadata": {"is_published": False}}),
])
def test_register_creates_the_rows_a_shared_account_needs(client, strict_schema, role, db_role, table, extra):
    response = client.post(f"{API}/register", json={**REGISTER_PAYLOAD, "email": "New@Demo.test", "role": role})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["access_token"].startswith("token-") and body["token_type"] == "bearer"
    [auth_user] = strict_schema.users
    [user] = strict_schema.tables["users"]
    assert uuid.UUID(user["id"]) and user["updated_at"]
    assert (user["auth_user_id"], user["email"], user["full_name"]) == (auth_user["id"], "new@demo.test", "New User")
    # verification_status keeps its column default; PENDING_VERIFICATION is an account status.
    assert (user["primary_role"], user["status"], user["verification_status"]) == (db_role, "ACTIVE", "PENDING")
    [assignment] = strict_schema.tables["user_role_assignments"]
    assert (assignment["user_id"], assignment["role"], assignment["is_primary"]) == (user["id"], db_role, True)
    [profile_row] = strict_schema.tables[table]
    assert profile_row["user_id"] == user["id"] and profile_row["updated_at"]
    assert {key: profile_row[key] for key in extra} == extra
    assert (body["profile"]["id"], body["profile"]["role"], body["profile"]["email"]) == (user["id"], role, "new@demo.test")
    assert _actions(strict_schema) == ["auth.registered", "auth.logged_in"]


def test_register_rejects_privileged_roles(client, strict_schema):
    for role in ("admin", "officer", "not-a-role"):
        response = client.post(f"{API}/register", json={**REGISTER_PAYLOAD, "role": role})
        assert response.status_code == 400, role
    assert strict_schema.users == []


def test_register_rejects_duplicate_email(client, strict_schema):
    strict_schema.add_auth_user("new@demo.test", full_name="Existing", role="tenant")
    response = client.post(f"{API}/register", json=REGISTER_PAYLOAD)
    assert response.status_code == 400
    assert response.json()["detail"] == "An account with this email already exists"


def test_register_validates_password_length(client):
    response = client.post(f"{API}/register", json={**REGISTER_PAYLOAD, "password": "short"})
    assert response.status_code == 422


def test_register_rejects_whitespace_name_without_creating_account(client, strict_schema):
    response = client.post(f"{API}/register", json={**REGISTER_PAYLOAD, "full_name": " \t \n "})
    assert response.status_code == 422
    assert not strict_schema.users


def test_register_trims_name_and_email(client):
    response = client.post(f"{API}/register", json={**REGISTER_PAYLOAD, "full_name": " New User ", "email": " new@demo.test "})
    assert response.status_code == 201
    assert response.json()["profile"]["full_name"] == "New User"
    assert response.json()["profile"]["email"] == "new@demo.test"


def _another_apps_row(fake_db):
    """A row the rental web or an import made: no auth user, the address in its own case, data of its own."""
    fake_db.seed("users", [users_row(MEI, "Mei.Lin@Demo.test", "LANDLORD", full_name="Mei Lin")])
    fake_db.seed("landlord_profiles", [{"user_id": MEI, "agency_name": "Lin Realty", "updated_at": NOW}])


@pytest.mark.parametrize("claiming", [False, True])
def test_register_never_takes_over_a_row_another_app_made(client, strict_schema, auth_deletes, monkeypatch, claiming):
    # Registration confirms no email, so whoever registered first would get the row and its data.
    monkeypatch.setattr(settings, "claim_accounts_by_email", claiming)
    _another_apps_row(strict_schema)

    response = client.post(f"{API}/register", json={**REGISTER_PAYLOAD, "email": "mei.lin@demo.test", "full_name": "Eve"})

    assert (response.status_code, response.json()["detail"]) == (409, maps_identity.UNLINKED_ACCOUNT)
    assert strict_schema.users == [] and len(auth_deletes) == 1
    [user] = strict_schema.tables["users"]
    assert (user["auth_user_id"], user["full_name"], user["updated_at"]) == (None, "Mei Lin", NOW)
    assert not strict_schema.tables.get("user_role_assignments")
    assert "auth.account_claimed" not in _actions(strict_schema)


def test_with_claiming_off_a_first_sign_in_leaves_the_row_alone(client, strict_schema):
    strict_schema.add_auth_user("mei.lin@demo.test", full_name="Eve", role="tenant")
    _another_apps_row(strict_schema)

    response = _login(client, "mei.lin@demo.test")

    assert (response.status_code, response.json()["detail"]) == (409, maps_identity.UNLINKED_ACCOUNT)
    [user] = strict_schema.tables["users"]
    assert user["auth_user_id"] is None
    assert not strict_schema.tables.get("user_role_assignments")
    assert "auth.logged_in" not in _actions(strict_schema)


def test_with_claiming_on_a_first_sign_in_takes_over_the_row_with_its_email(client, strict_schema, claiming_on):
    strict_schema.add_auth_user("mei.lin@demo.test", full_name="Mei", role="tenant")
    _another_apps_row(strict_schema)

    response = _login(client, "mei.lin@demo.test")

    assert response.status_code == 200, response.text
    [auth_user] = strict_schema.users
    [user] = strict_schema.tables["users"]
    assert (user["id"], user["auth_user_id"]) == (MEI, auth_user["id"])
    # The row keeps what it holds, its role among it: the sign-in's role creates nothing new.
    assert (user["email"], user["full_name"], user["primary_role"]) == ("Mei.Lin@Demo.test", "Mei Lin", "LANDLORD")
    assert user["updated_at"] != NOW
    assert response.json()["profile"]["role"] == "landlord"
    assert [(a["user_id"], a["role"], a["is_primary"]) for a in strict_schema.tables["user_role_assignments"]] == [
        (MEI, "LANDLORD", True)]
    assert [p["agency_name"] for p in strict_schema.tables["landlord_profiles"]] == ["Lin Realty"]
    assert not strict_schema.tables.get("tenant_profiles")
    assert "auth.account_claimed" in _actions(strict_schema)


def test_a_claimed_row_without_a_name_takes_the_sign_ins(client, strict_schema, claiming_on):
    strict_schema.add_auth_user("new@demo.test", full_name="New User", role="tenant")
    strict_schema.seed("users", [users_row(MEI, "new@demo.test", full_name=None)])

    response = _login(client, "new@demo.test")

    assert response.status_code == 200, response.text
    assert response.json()["profile"]["full_name"] == "New User"
    assert strict_schema.tables["users"][0]["full_name"] == "New User"


@pytest.mark.parametrize("rows", [
    pytest.param([users_row(MEI, "new@demo.test", auth_user_id=OTHER)], id="another auth user's"),
    pytest.param([users_row(MEI, "new@demo.test", deleted_at=NOW)], id="closed"),
    pytest.param([users_row(MEI, "new@demo.test", "ADMIN")], id="staff"),
    pytest.param([users_row(MEI, "new@demo.test"), users_row(OLIVIA, "NEW@demo.test")], id="two candidates"),
])
def test_register_never_claims_these_rows(client, strict_schema, auth_deletes, rows):
    strict_schema.catalog_rules = True  # users_email_key
    strict_schema.seed("users", rows)

    response = client.post(f"{API}/register", json=REGISTER_PAYLOAD)

    # users.email is unique (users_email_key), so the address cannot get a second account either.
    assert (response.status_code, response.json()["detail"]) == (409, maps_identity.EMAIL_TAKEN)
    assert strict_schema.users == [] and len(auth_deletes) == 1
    stored = {row["id"]: row for row in strict_schema.tables["users"]}
    assert set(stored) == {row["id"] for row in rows}
    assert [stored[row["id"]]["auth_user_id"] for row in rows] == [row["auth_user_id"] for row in rows]


@pytest.mark.parametrize("rows, assignments", [
    pytest.param([users_row(MEI, "new@demo.test", auth_user_id=OTHER)], [], id="another auth user's"),
    pytest.param([users_row(MEI, "new@demo.test", deleted_at=NOW)], [], id="closed"),
    pytest.param([users_row(MEI, "new@demo.test", "ADMIN")], [], id="staff"),
    pytest.param([users_row(MEI, "new@demo.test")], [{"id": str(uuid.uuid4()), "user_id": MEI, "role": "REGULATOR"}],
                 id="a staff role assignment"),
    pytest.param([users_row(MEI, "new@demo.test"), users_row(OLIVIA, "NEW@demo.test")], [], id="two candidates"),
])
def test_a_sign_in_never_claims_these_rows(client, strict_schema, claiming_on, rows, assignments):
    strict_schema.catalog_rules = True  # users_email_key
    strict_schema.add_auth_user("new@demo.test", full_name="New User", role="tenant")
    strict_schema.seed("users", rows)
    strict_schema.seed("user_role_assignments", assignments)

    response = _login(client, "new@demo.test")

    # users.email is unique (users_email_key): no second account for the address either.
    assert (response.status_code, response.json()["detail"]) == (409, maps_identity.EMAIL_TAKEN)
    stored = {row["id"]: row for row in strict_schema.tables["users"]}
    assert set(stored) == {row["id"] for row in rows}
    assert [stored[row["id"]]["auth_user_id"] for row in rows] == [row["auth_user_id"] for row in rows]


@pytest.mark.parametrize("claimed_by, expected", [("me", 200), ("someone else", 409)])
def test_a_row_claimed_while_the_account_was_completed(
    client, strict_schema, monkeypatch, claiming_on, claimed_by, expected
):
    strict_schema.add_auth_user("mei@demo.test")
    me = strict_schema.users[0]["id"]
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei")])
    complete = profiles_service._complete

    def complete_then_lose_the_race(user):
        complete(user)
        strict_schema.tables["users"][0]["auth_user_id"] = me if claimed_by == "me" else OTHER

    monkeypatch.setattr(profiles_service, "_complete", complete_then_lose_the_race)

    response = _login(client, "mei@demo.test")

    assert response.status_code == expected, response.text
    assert strict_schema.tables["users"][0]["auth_user_id"] == (me if claimed_by == "me" else OTHER)
    if expected == 200:
        assert response.json()["profile"]["id"] == MEI


def test_like_wildcards_in_an_address_match_only_themselves(
    client, strict_schema, like_escapes, claiming_on, monkeypatch
):
    # The lookup escapes "_", so it fetches mei_lin's row alone. Unescaped, it
    # would fetch meiXlin's too, which same_email() would still drop: so the
    # pattern sent is checked as well as the row claimed.
    sent = []
    ilike = fake_supabase.FakeTableQuery.ilike

    def recording(query, column, pattern):
        sent.append((query._name, column, pattern))
        return ilike(query, column, pattern)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "ilike", recording)
    strict_schema.add_auth_user("mei_lin@demo.test")
    strict_schema.seed("users", [users_row(MEI, "mei_lin@demo.test"), users_row(OLIVIA, "meiXlin@demo.test")])

    response = _login(client, "mei_lin@demo.test")

    assert response.status_code == 200, response.text
    assert response.json()["profile"]["id"] == MEI
    assert [row["auth_user_id"] is None for row in strict_schema.tables["users"]] == [False, True]
    assert sent == [("users", "email", "mei\\_lin@demo.test")]


def test_a_failed_registration_removes_its_auth_user_and_a_retry_completes_the_account(
    client, strict_schema, auth_deletes, monkeypatch
):
    fail_inserts(monkeypatch, "tenant_profiles")

    first = client.post(f"{API}/register", json=REGISTER_PAYLOAD)

    assert first.status_code == 500
    assert strict_schema.users == [] and len(auth_deletes) == 1
    # The half-made row has no auth user, so nothing points at the deleted one...
    [user] = strict_schema.tables["users"]
    assert (user["auth_user_id"], user["metadata"]) == (None, {maps_identity.UNFINISHED_SIGNUP: True})
    # ...and registering again completes and claims it instead of making a second row.
    second = client.post(f"{API}/register", json=REGISTER_PAYLOAD)
    assert second.status_code == 201, second.text
    [auth_user] = strict_schema.users
    [user] = strict_schema.tables["users"]
    assert (second.json()["profile"]["id"], user["auth_user_id"], user["metadata"]) == (user["id"], auth_user["id"], {})
    assert [a["user_id"] for a in strict_schema.tables["user_role_assignments"]] == [user["id"]]
    assert [p["user_id"] for p in strict_schema.tables["tenant_profiles"]] == [user["id"]]


def test_a_sign_in_finishes_a_sign_up_that_failed_half_way(client, strict_schema, monkeypatch):
    # Its auth user could not be deleted either, so the person signs in rather than registering again.
    def delete_user(id, should_soft_delete=False):
        raise Exception("auth is down")

    monkeypatch.setattr(strict_schema.auth.admin, "delete_user", delete_user, raising=False)
    fail_inserts(monkeypatch, "tenant_profiles")
    assert client.post(f"{API}/register", json=REGISTER_PAYLOAD).status_code == 500

    response = _login(client, "new@demo.test")

    assert response.status_code == 200, response.text
    [auth_user] = strict_schema.users
    [user] = strict_schema.tables["users"]
    assert (response.json()["profile"]["id"], user["auth_user_id"], user["metadata"]) == (user["id"], auth_user["id"], {})
    assert [p["user_id"] for p in strict_schema.tables["tenant_profiles"]] == [user["id"]]


def test_a_failed_cleanup_still_reports_the_registrations_own_error(client, strict_schema, monkeypatch, caplog):
    def delete_user(id, should_soft_delete=False):
        raise Exception("auth is down")

    monkeypatch.setattr(strict_schema.auth.admin, "delete_user", delete_user, raising=False)
    fail_inserts(monkeypatch, "users")

    with caplog.at_level(logging.ERROR, logger="app.services.auth"):
        response = client.post(f"{API}/register", json=REGISTER_PAYLOAD)

    assert response.status_code == 500
    assert "could not delete auth user" in caplog.text


def test_registering_into_a_suspended_account_is_refused(client, strict_schema, auth_deletes):
    strict_schema.seed("users", [users_row(MEI, "new@demo.test", status="SUSPENDED")])

    response = client.post(f"{API}/register", json=REGISTER_PAYLOAD)

    assert (response.status_code, response.json()["detail"]) == (
        403, "This account is suspended. Contact support to restore access.")
    assert strict_schema.users == [] and len(auth_deletes) == 1
    assert strict_schema.tables["users"][0]["auth_user_id"] is None
    assert not strict_schema.tables.get("user_role_assignments")


# ---------------------------------------------------------------------------
# Sign-in
# ---------------------------------------------------------------------------


def test_login_success(client, strict_schema):
    account(strict_schema, MEI, "jon@demo.test", full_name="Jon")
    response = _login(client, "jon@demo.test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"]
    assert (body["profile"]["id"], body["profile"]["full_name"]) == (MEI, "Jon")


def test_login_wrong_password_is_401(client, strict_schema):
    account(strict_schema, MEI, "jon@demo.test")
    response = _login(client, "jon@demo.test", "wrong-password")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_login_unknown_email_is_401(client):
    assert _login(client, "ghost@demo.test").status_code == 401


def test_me_returns_the_token_owner(client, strict_schema):
    token = account(strict_schema, MEI, "jon@demo.test", full_name="Jon")
    response = client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert (response.json()["full_name"], response.json()["email"]) == ("Jon", "jon@demo.test")


def test_me_requires_a_token(client):
    assert client.get(f"{API}/me").status_code == 401


def test_a_first_sign_in_provisions_an_auth_user_made_elsewhere(client, strict_schema):
    # Say a mobile sign-up: an auth user with no users row yet.
    strict_schema.add_auth_user("olivia@demo.test", full_name="Olivia", role="landlord")

    response = _login(client, "olivia@demo.test")

    assert response.status_code == 200, response.text
    [user] = strict_schema.tables["users"]
    assert (user["full_name"], user["primary_role"], user["auth_user_id"]) == (
        "Olivia", "LANDLORD", strict_schema.users[0]["id"])
    assert (response.json()["profile"]["id"], response.json()["profile"]["role"]) == (user["id"], "landlord")
    assert [p["user_id"] for p in strict_schema.tables["landlord_profiles"]] == [user["id"]]


@pytest.mark.parametrize("claimed_role", ["admin", "officer", "ADMIN", "superuser"])
def test_login_never_provisions_a_privileged_role_from_user_metadata(client, strict_schema, claimed_role):
    # An auth account created outside /auth/register (e.g. a direct Supabase sign-up
    # with the public anon key) carries whatever metadata its owner chose.
    strict_schema.add_auth_user("mallory@demo.test", "password123", full_name="Mallory", role=claimed_role)
    response = _login(client, "mallory@demo.test")
    assert response.status_code == 200
    assert response.json()["profile"]["role"] == "tenant"
    assert [row["primary_role"] for row in strict_schema.tables["users"]] == ["TENANT"]


def test_a_sign_in_completes_a_half_made_account(client, strict_schema):
    strict_schema.catalog_rules = True  # guard_primary_role_assignment, one primary per person
    # The role and profile rows are missing; a row from before the guard marked a different role primary.
    account(strict_schema, OLIVIA, "olivia@demo.test", "LANDLORD")
    strict_schema.seed("user_role_assignments", [
        {"id": str(uuid.uuid4()), "user_id": OLIVIA, "role": "TENANT", "is_primary": True}])

    for _ in range(2):  # the second sign-in finds nothing missing
        assert _login(client, "olivia@demo.test").status_code == 200

    # The assignment of users.primary_role must be the primary one.
    assert [(a["role"], a["is_primary"]) for a in strict_schema.tables["user_role_assignments"]] == [
        ("TENANT", False), ("LANDLORD", True)]
    assert [p["user_id"] for p in strict_schema.tables["landlord_profiles"]] == [OLIVIA]
    assert len(strict_schema.tables["users"]) == 1


def test_a_sign_in_leaves_the_rows_of_agent_and_staff_accounts_alone(client, strict_schema):
    account(strict_schema, MEI, "agent@demo.test", "AGENT")
    account(strict_schema, OLIVIA, "admin@demo.test", "ADMIN")

    assert _login(client, "agent@demo.test").json()["profile"]["role"] == "landlord"
    assert _login(client, "admin@demo.test").json()["profile"]["role"] == "admin"

    for table in ("user_role_assignments", "landlord_profiles", "agent_profiles", "tenant_profiles"):
        assert not strict_schema.tables.get(table), table


@pytest.mark.parametrize("over, detail", [
    ({"status": "SUSPENDED"}, "This account is suspended. Contact support to restore access."),
    ({"status": "DEACTIVATED"}, "This account has been deactivated."),
    ({"deleted_at": NOW}, "This account has been closed."),
])
def test_blocked_and_closed_accounts_cannot_sign_in(client, strict_schema, over, detail):
    account(strict_schema, MEI, "mei@demo.test", **over)

    response = _login(client, "mei@demo.test")

    assert (response.status_code, response.json()["detail"]) == (403, detail)
    assert "access_token" not in response.json()
    # A closed account is not provisioned again either, and nothing is completed.
    assert [row["id"] for row in strict_schema.tables["users"]] == [MEI]
    assert not strict_schema.tables.get("user_role_assignments")
    assert "auth.logged_in" not in _actions(strict_schema)


def test_refresh_renews_the_session(client, strict_schema, auth_refresh):
    account(strict_schema, MEI, "mei@demo.test", full_name="Mei")
    session = _login(client, "mei@demo.test").json()

    response = client.post(f"{API}/refresh", json={"refresh_token": session["refresh_token"]})

    assert response.status_code == 200, response.text
    assert response.json()["access_token"] != session["access_token"]
    assert (response.json()["profile"]["id"], response.json()["profile"]["full_name"]) == (MEI, "Mei")


def test_a_suspended_account_cannot_renew_its_session(client, strict_schema, auth_refresh):
    token = account(strict_schema, MEI, "mei@demo.test")
    session = _login(client, "mei@demo.test").json()
    strict_schema.tables["users"][0]["status"] = "SUSPENDED"  # say, by a mobile admin

    response = client.post(f"{API}/refresh", json={"refresh_token": session["refresh_token"]})

    assert response.status_code == 403
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"}).status_code == 403


def test_refresh_with_an_unknown_token_is_401(client, auth_refresh):
    response = client.post(f"{API}/refresh", json={"refresh_token": "refresh-nobody"})
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# The login form's role selector is a real constraint, not decoration.
# Choosing "Client" and typing a landlord's address must not hand back a
# landlord session.
# ---------------------------------------------------------------------------


def test_login_rejects_a_role_the_account_does_not_hold(client, strict_schema):
    account(strict_schema, OLIVIA, "olivia@demo.test", "LANDLORD", full_name="Olivia Owner")

    response = _login(client, "olivia@demo.test", role="tenant")

    assert response.status_code == 403
    # The real role is not disclosed, so the endpoint cannot be used to find
    # out which addresses belong to landlords.
    assert "landlord" not in response.json()["detail"].lower()
    assert _actions(strict_schema) == ["auth.role_mismatch"]


def test_login_succeeds_when_the_role_matches(client, strict_schema):
    account(strict_schema, OLIVIA, "olivia@demo.test", "LANDLORD", full_name="Olivia Owner")

    response = _login(client, "olivia@demo.test", role="landlord")

    assert response.status_code == 200, response.text
    assert response.json()["profile"]["role"] == "landlord"


def test_login_without_a_role_still_works(client, strict_schema):
    """role is optional so existing API clients and tooling keep working."""
    account(strict_schema, MEI, "jane@demo.test", full_name="Jane Tenant")

    response = _login(client, "jane@demo.test")

    assert response.status_code == 200, response.text
    assert response.json()["profile"]["role"] == "tenant"


def test_login_rejects_an_unknown_role(client, strict_schema):
    account(strict_schema, MEI, "jane@demo.test")
    assert _login(client, "jane@demo.test", role="admin").status_code == 400


def test_a_wrong_password_is_still_rejected_before_the_role_check(client, strict_schema):
    """Role mismatch must not become an oracle for valid credentials."""
    account(strict_schema, OLIVIA, "olivia@demo.test", "LANDLORD")
    assert _login(client, "olivia@demo.test", "wrong-password", role="tenant").status_code == 401
