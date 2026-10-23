"""stamp_insert / stamp_update add what each shared table lacks a default for, and nothing else."""

import uuid
from datetime import datetime, timezone

import pytest

from app.services.shared_map import stamp_insert, stamp_update

NOW = datetime(2026, 10, 22, 9, 30, tzinfo=timezone.utc)

# Migration plan §3 a1: the keys an insert gains, and whether an update gains updated_at.
PLAN_A1 = {
    "users": ({"id", "updated_at"}, True),
    "user_role_assignments": ({"id"}, False),
    "tenant_profiles": ({"updated_at"}, True),
    "landlord_profiles": ({"updated_at"}, True),
    "service_provider_profiles": ({"updated_at"}, True),
    "properties": ({"id", "updated_at"}, True),
    "listings": ({"id", "updated_at"}, True),
    "property_media": ({"id"}, False),
    "rental_applications": ({"id", "updated_at"}, True),
    "reviews": ({"id", "updated_at"}, True),
    "complaints": ({"id"}, False),
    "maintenance_work_orders": ({"updated_at"}, True),
    "conversations": ({"id", "updated_at"}, True),
    "conversation_participants": ({"id"}, False),
    "messages": ({"id"}, False),
    "message_attachments": ({"id"}, False),
    "connection_requests": ({"id"}, False),
    "profile_documents": ({"id", "updated_at"}, True),
    "notifications": (set(), False),
    "mobile_inspection_slots": (set(), True),  # its updated_at default applies on insert only
    "mobile_provider_services": (set(), True),
    "mobile_admin_audit_entries": (set(), False),
    "complaint_events": (set(), False),
}


@pytest.mark.parametrize("table", PLAN_A1)
def test_each_table_gets_only_the_keys_it_has_no_default_for(table):
    insert_keys, update_stamped = PLAN_A1[table]

    assert set(stamp_insert(table, {"title": "x"}, now=NOW)) - {"title"} == insert_keys
    assert ("updated_at" in stamp_update(table, {"title": "x"}, now=NOW)) is update_stamped


def test_an_insert_gets_a_new_uuid4_and_the_time():
    first = stamp_insert("users", {"email": "mei@example.test"}, now=NOW)
    second = stamp_insert("users", {"email": "mei@example.test"})

    assert uuid.UUID(first["id"]).version == 4
    assert first["id"] != second["id"]
    assert first["updated_at"] == "2026-10-22T09:30:00+00:00"
    assert datetime.fromisoformat(second["updated_at"]).tzinfo is not None


def test_values_the_row_has_are_kept_and_the_row_is_not_changed():
    row = {"id": "a0000000-0000-4000-8000-000000000001", "email": "x@example.test", "updated_at": "2026-01-01T00:00:00+00:00"}

    assert stamp_insert("users", row, now=NOW) == row
    assert stamp_update("users", {"updated_at": "2026-01-02T00:00:00+00:00"}, now=NOW)["updated_at"] == "2026-01-02T00:00:00+00:00"
    plain = {"email": "x@example.test"}
    stamp_insert("users", plain)
    stamp_update("users", plain)
    assert plain == {"email": "x@example.test"}


def test_a_null_id_or_time_counts_as_missing():
    stamped = stamp_insert("users", {"id": None, "updated_at": None}, now=NOW)

    assert stamped["id"] is not None
    assert stamped["updated_at"] == NOW.isoformat()
    assert stamp_update("listings", {"updated_at": None}, now=NOW)["updated_at"] == NOW.isoformat()


def test_web_tables_are_not_stamped_from_the_shared_snapshot():
    # The web schema has its own defaults and update triggers.
    with pytest.raises(KeyError, match="not a table of the shared schema"):
        stamp_insert("bookings", {})
    with pytest.raises(KeyError, match="not a table of the shared schema"):
        stamp_update("bookings", {})
