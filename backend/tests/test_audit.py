"""The audit trail is a cross-cutting Base requirement (SCOPE.md §8).

What matters is not just that entries are written, but that the trail stays
trustworthy and never takes the API down with it. On the shared database it
lives in the web schema's audit_log (strict fake): regression cover for the
trail writing and reading a public audit_log the shared database lacks, and
for the admin read selecting a users.role column it does not have.
"""

import logging
from unittest.mock import patch

import pytest

from app.services import audit
from tests.factories_identity import account, users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

TENANT_ID = "11111111-1111-1111-1111-111111111111"
ADMIN_ID = "c0000000-0000-4000-8000-000000000003"
MEI = "c0000000-0000-4000-8000-000000000001"
SAM = "c0000000-0000-4000-8000-000000000002"
COMPLAINT_ID = "22222222-2222-2222-2222-222222222222"

COMPLAINT_STUB = {
    "id": COMPLAINT_ID,
    "complainant_id": TENANT_ID,
    "against_id": None,
    "property_id": None,
    "category": "other",
    "subject": "s",
    "description": "d",
    "status": "open",
    "response": None,
    "responded_at": None,
    "resolution_note": None,
    "resolved_at": None,
    "is_escalated": False,
    "evidence_urls": None,
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
    "complainant_name": None,
    "against_name": None,
    "property_title": None,
}

NEW_COMPLAINT = {"subject": "Broken alarm", "description": "Not working for weeks"}


def _trail(fake_db) -> list[dict]:
    return fake_db.schema_tables.get("web", {}).get("audit_log", [])


def test_reads_are_not_audited(client):
    """A GET is not a user action on data; auditing it would only add noise."""
    with patch("app.services.audit.record") as record:
        assert client.get("/api/v1/health").status_code == 200
    record.assert_not_called()


def test_rejected_requests_are_not_audited(client):
    """An unauthenticated attempt changed nothing, so it is not an action."""
    with patch("app.services.audit.record") as record:
        assert client.post("/api/v1/complaints", json=NEW_COMPLAINT).status_code == 401
    record.assert_not_called()


def test_successful_mutation_is_attributed_to_the_actor(as_tenant):
    with (
        patch("app.services.audit.record") as record,
        patch("app.services.complaints.create_complaint", return_value=COMPLAINT_STUB),
    ):
        response = as_tenant.post(
            "/api/v1/complaints", json=NEW_COMPLAINT, headers={"Authorization": "Bearer x"}
        )

    assert response.status_code == 201
    record.assert_called_once()
    entry = record.call_args.kwargs
    assert entry["actor_id"] == TENANT_ID
    assert entry["action"] == "post:/api/v1/complaints"
    assert entry["metadata"]["status"] == 201


def test_a_failing_audit_write_never_breaks_the_request(as_tenant):
    """The trail is best-effort. Losing the database must not lose the write."""
    with (
        patch("app.core.supabase.get_supabase_client", side_effect=RuntimeError("db down")),
        patch("app.services.complaints.create_complaint", return_value=COMPLAINT_STUB),
    ):
        response = as_tenant.post(
            "/api/v1/complaints", json=NEW_COMPLAINT, headers={"Authorization": "Bearer x"}
        )

    assert response.status_code == 201


def test_audit_log_is_admin_only(as_tenant):
    """The trail spans every account, so a tenant must not be able to read it."""
    response = as_tenant.get("/api/v1/audit", headers={"Authorization": "Bearer x"})
    assert response.status_code == 403


def test_an_entry_is_written_to_the_web_schema(strict_schema):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test")])

    audit.record(MEI, "complaint.updated", "complaint", COMPLAINT_ID, {"fields": ["description"]})

    [entry] = _trail(strict_schema)
    assert (entry["actor_id"], entry["action"], entry["entity_type"], entry["entity_id"], entry["metadata"]) == (
        MEI, "complaint.updated", "complaint", COMPLAINT_ID, {"fields": ["description"]})
    assert entry["id"] and entry["created_at"]
    assert not strict_schema.tables.get("audit_log")
    assert not strict_schema.tables.get("mobile_admin_audit_entries")


def test_a_failed_write_is_logged_as_an_error_and_never_raised(strict_schema, caplog):
    # actor_id points at public.users: an actor with no users row fails the foreign key.
    with caplog.at_level(logging.ERROR, logger="app.services.audit"):
        audit.record(MEI, "auth.logged_in", "profile", MEI)

    assert not _trail(strict_schema)
    assert "audit trail write failed for auth.logged_in" in caplog.text and "23503" in caplog.text


def test_entries_read_back_newest_first_with_their_actors_names(strict_schema):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin"),
                                 users_row(SAM, "sam@demo.test", full_name="Sam Okafor")])
    audit.record(MEI, "auth.logged_in", "profile", MEI)
    audit.record(SAM, "complaint.responded", "complaint", COMPLAINT_ID)
    audit.record(None, "system.cleanup")

    entries = audit.list_entries()

    assert [(e["action"], e["actor_name"]) for e in entries] == [
        ("system.cleanup", None), ("complaint.responded", "Sam Okafor"), ("auth.logged_in", "Mei Lin")]
    assert [e["action"] for e in audit.list_entries(actor_id=MEI)] == ["auth.logged_in"]
    assert [e["action"] for e in audit.list_entries(entity_type="complaint")] == ["complaint.responded"]
    assert [e["action"] for e in audit.list_entries(action="system.cleanup", limit=1)] == ["system.cleanup"]
    assert [e["action"] for e in audit.list_entries(limit=1, offset=1)] == ["complaint.responded"]


def test_an_admin_reads_each_request_by_its_actor(client, strict_schema):
    tenant = account(strict_schema, MEI, "mei@demo.test", full_name="Mei Lin")
    admin = account(strict_schema, ADMIN_ID, "amelia@demo.test", "ADMIN", full_name="Amelia")
    assert client.patch("/api/v1/profiles/me", json={"phone": "0400 111 222"},
                        headers={"Authorization": f"Bearer {tenant}"}).status_code == 200

    response = client.get("/api/v1/audit", headers={"Authorization": f"Bearer {admin}"})

    assert response.status_code == 200, response.text
    [entry] = response.json()
    assert (entry["actor_id"], entry["actor_name"], entry["action"]) == (
        MEI, "Mei Lin", "patch:/api/v1/profiles/me")
    assert entry["metadata"] == {"method": "PATCH", "path": "/api/v1/profiles/me", "status": 200}
