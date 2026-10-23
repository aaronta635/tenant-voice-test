"""The admin overview's counts match the rows: accounts by role and status, and documents in review (R16)."""

import pytest

from tests.factories import NOW
from tests.factories_documents import document_row
from tests.factories_identity import account, users_row
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a1000000-0000-4000-8000-000000000001"


def person(n: int, primary_role="TENANT", **over) -> dict:
    return users_row(f"b1000000-0000-4000-8000-{n:012d}", f"person{n}@example.test", primary_role, **over)


def doc(n: int, user: int, **over) -> dict:
    return document_row(f"d1000000-0000-4000-8000-{n:012d}", f"b1000000-0000-4000-8000-{user:012d}", **over)


def test_the_overview_counts_accounts_by_role_and_status(client, strict_schema):
    strict_schema.seed("users", [
        person(1), person(2, status="SUSPENDED"), person(3, status="PENDING_VERIFICATION"),
        person(4, "LANDLORD"), person(5, "AGENT", status="DEACTIVATED"),
        person(6, "SERVICE_PROVIDER"), person(7, "REGULATOR"),
        person(8, deleted_at=NOW), person(9, "LANDLORD", status="SUSPENDED", deleted_at=NOW),
    ])
    strict_schema.seed("profile_documents", [
        doc(1, 1), doc(2, 1, document_type="UTILITY_BILL"), doc(3, 4),
        doc(4, 6, status="verified"), doc(5, 2, status="rejected"),
        # Verified before review_status existed: not waiting for anyone.
        doc(6, 3, review_status="PENDING", is_verified=True),
    ])
    token = account(strict_schema, ADMIN, "ada@example.test", "ADMIN")

    response = client.get("/api/v1/admin/overview", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["users_total"], body["closed_accounts"]) == (8, 2)
    roles = {item["role"]: item for item in body["roles"]}
    assert list(roles) == ["tenant", "landlord", "service_provider", "admin", "officer"]
    assert roles["tenant"] == {
        "role": "tenant", "total": 3, "active": 1, "pending_verification": 1, "suspended": 1, "deactivated": 0}
    assert (roles["landlord"]["total"], roles["landlord"]["active"], roles["landlord"]["deactivated"]) == (2, 1, 1)
    assert (roles["service_provider"]["total"], roles["admin"]["total"], roles["officer"]["total"]) == (1, 1, 1)
    assert (body["pending_documents"], body["pending_document_people"]) == (3, 2)


def test_the_overview_counts_past_the_row_cap(client, strict_schema, max_rows):
    """PostgREST answers at most max-rows rows; every page is read."""
    strict_schema.seed("users", [person(n) for n in range(1, 6)])
    strict_schema.seed("profile_documents", [doc(n, n) for n in range(1, 6)])
    token = account(strict_schema, ADMIN, "ada@example.test", "ADMIN")

    body = client.get("/api/v1/admin/overview", headers={"Authorization": f"Bearer {token}"}).json()

    assert body["users_total"] == 6
    assert (body["pending_documents"], body["pending_document_people"]) == (5, 5)
