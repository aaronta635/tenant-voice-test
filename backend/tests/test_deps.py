"""Token verification, account checks and role gating (app.core.deps), exercised
end-to-end through protected routes with real (fake-backed) token lookup on the
shared schema. Regression cover: suspended, deactivated and closed accounts kept
working on the web with the tokens they already held."""

import pytest

from tests.factories import NOW
from tests.factories_identity import account, users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c0000000-0000-4000-8000-000000000001"
OLD_MEI = "c0000000-0000-4000-8000-000000000002"
ADMIN = "c0000000-0000-4000-8000-000000000003"


def _me(client, token):
    return client.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {token}"})


def test_missing_token_is_401(client):
    assert client.get("/api/v1/profiles/me").status_code == 401


def test_garbage_token_is_401(client):
    response = client.get(
        "/api/v1/profiles/me", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token"


def test_valid_token_without_profile_row_is_403(client, strict_schema):
    # A token that authenticates but has no users row behind it.
    token = strict_schema.add_auth_user("orphan@demo.test")
    response = _me(client, token)
    assert response.status_code == 403
    assert response.json()["detail"] == "No profile found for this account"


def test_valid_token_resolves_profile(client, strict_schema):
    token = account(strict_schema, MEI, "jon@demo.test", full_name="Jon")
    response = _me(client, token)
    assert response.status_code == 200
    body = response.json()
    assert (body["id"], body["full_name"], body["role"], body["email"]) == (MEI, "Jon", "tenant", "jon@demo.test")


@pytest.mark.parametrize("over, detail", [
    ({"status": "SUSPENDED"}, "This account is suspended. Contact support to restore access."),
    ({"status": "DEACTIVATED"}, "This account has been deactivated."),
    ({"deleted_at": NOW}, "This account has been closed."),
])
def test_a_blocked_or_closed_account_is_403_on_every_request(client, strict_schema, over, detail):
    token = account(strict_schema, MEI, "mei@demo.test", **over)

    response = _me(client, token)

    assert (response.status_code, response.json()["detail"]) == (403, detail)
    # Nothing was attributed to the account either.
    assert client.patch("/api/v1/profiles/me", json={"phone": "0400"},
                        headers={"Authorization": f"Bearer {token}"}).status_code == 403
    assert not strict_schema.schema_tables.get("web", {}).get("audit_log")


def test_an_account_awaiting_verification_still_signs_in(client, strict_schema):
    # Only SUSPENDED and DEACTIVATED keep a person out.
    token = account(strict_schema, MEI, "mei@demo.test", status="PENDING_VERIFICATION")
    assert _me(client, token).status_code == 200


def test_a_closed_row_never_stands_in_for_the_open_one(client, strict_schema):
    # Archived for re-registration, then made again for the same auth user.
    token = strict_schema.add_auth_user("mei@demo.test")
    auth_user_id = strict_schema.tokens[token]
    strict_schema.seed("users", [
        users_row(OLD_MEI, "archived+mei@demo.test", deleted_at=NOW, created_at="2025-01-01T00:00:00+00:00"),
        users_row(MEI, "mei@demo.test", auth_user_id=auth_user_id, full_name="Mei Lin"),
    ])
    # users_auth_user_id_key keeps a second row off the auth user today; one from before it is put on the stored
    # row behind the seed.
    next(row for row in strict_schema.tables["users"] if row["id"] == OLD_MEI)["auth_user_id"] = auth_user_id

    response = _me(client, token)

    assert response.status_code == 200, response.text
    assert response.json()["id"] == MEI


def test_require_role_blocks_other_roles(client, strict_schema):
    """The audit trail is admin-only (require_role gate)."""
    token = account(strict_schema, MEI, "jon@demo.test")
    response = client.get("/api/v1/audit", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_require_role_admits_the_right_role(client, strict_schema):
    token = account(strict_schema, ADMIN, "amelia@demo.test", "ADMIN", full_name="Amelia")
    response = client.get("/api/v1/audit", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    assert response.json() == []
