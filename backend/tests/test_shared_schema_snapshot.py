"""The committed shared-schema snapshot, the script that writes it and app.db.schema."""

import json
from pathlib import Path

import pytest

from app.db import schema
from scripts import snapshot_shared_schema as snapshot_script

REPO_ROOT = Path(__file__).resolve().parents[2]
# output/ is gitignored: the export exists only where someone saved it.
EXPORT = REPO_ROOT / "output" / "shared-schema-openapi.json"

OPENAPI = {
    "info": {"title": "standard public schema", "version": "14.18"},
    "paths": {
        "/": {},
        "/accounts": {"get": {}, "post": {}, "patch": {}, "delete": {}},
        "/account_names": {"get": {}},
        "/rpc/touch_account": {
            "get": {},
            "post": {"parameters": [
                {"in": "body", "name": "args", "schema": {
                    "properties": {
                        "p_id": {"format": "uuid", "type": "string"},
                        "p_note": {"format": "text", "type": "string"},
                    },
                    "required": ["p_id"],
                    "type": "object",
                }},
                {"$ref": "#/parameters/preferParams"},
            ]},
        },
        "/rpc/everything": {"post": {"parameters": [{"in": "body", "name": "args", "schema": {"type": "object"}}]}},
    },
    "definitions": {
        "accounts": {
            "required": ["id", "role", "created_at"],
            "properties": {
                "id": {"description": "Note:\nThis is a Primary Key.<pk/>", "format": "uuid", "type": "string"},
                "role": {"default": "TENANT", "enum": ["TENANT", "LANDLORD"], "format": 'public."UserRole"',
                         "type": "string"},
                "manager_id": {"description": "Note:\nThis is a Foreign Key to `accounts.id`.<fk table='accounts' "
                                              "column='id'/>", "format": "uuid", "type": "string"},
                "metadata": {"format": "jsonb"},
                "code": {"format": "character varying", "maxLength": 8, "type": "string"},
                "created_at": {"default": "now()", "format": "timestamp with time zone", "type": "string"},
            },
            "type": "object",
        },
        "account_names": {"properties": {"name": {"format": "text", "type": "string"}}, "type": "object"},
    },
}


def test_columns_keep_type_enum_not_null_default_and_foreign_key():
    columns = snapshot_script.build_snapshot(OPENAPI, "abc")["tables"]["accounts"]["columns"]

    assert list(columns) == ["id", "role", "manager_id", "metadata", "code", "created_at"]
    assert columns["id"] == {"format": "uuid", "type": "string", "not_null": True, "has_default": False,
                             "primary_key": True}
    assert columns["role"] == {"format": 'public."UserRole"', "type": "string", "enum": ["TENANT", "LANDLORD"],
                               "not_null": True, "has_default": True, "default": "TENANT"}
    assert columns["manager_id"]["references"] == {"table": "accounts", "column": "id"}
    assert columns["manager_id"]["not_null"] is False
    assert columns["metadata"] == {"format": "jsonb", "not_null": False, "has_default": False}
    assert columns["code"]["max_length"] == 8
    assert columns["created_at"]["default"] == "now()"


def test_rpcs_keep_parameters_and_tables_without_insert_are_read_only():
    snapshot = snapshot_script.build_snapshot(OPENAPI, "abc")

    assert snapshot["source"] == {"sha256": "abc", "title": "standard public schema", "version": "14.18"}
    assert snapshot["tables"]["account_names"]["read_only"] is True
    assert "read_only" not in snapshot["tables"]["accounts"]
    assert snapshot["rpcs"] == {
        "everything": {"methods": ["post"], "params": {}},
        "touch_account": {"methods": ["get", "post"], "params": {
            "p_id": {"format": "uuid", "type": "string", "required": True},
            "p_note": {"format": "text", "type": "string", "required": False},
        }},
    }


def test_the_script_writes_one_line_per_column_and_rpc(tmp_path, capsys):
    export = tmp_path / "openapi.json"
    export.write_text(json.dumps(OPENAPI))
    out = tmp_path / "snapshot.json"

    snapshot_script.main([str(export), "--out", str(out)])

    text = out.read_text()
    assert json.loads(text) == snapshot_script.snapshot_file(export)
    assert '        "role": {"format": "public.\\"UserRole\\"", "type": "string", "enum": ["TENANT", "LANDLORD"]' in text
    assert '    "touch_account": {"methods": ["get", "post"], "params": {' in text
    assert "2 tables, 2 RPCs" in capsys.readouterr().out


def test_the_committed_snapshot_is_the_scripts_output():
    text = schema.SNAPSHOT_PATH.read_text(encoding="utf-8")

    assert snapshot_script.render(json.loads(text)) == text


@pytest.mark.skipif(not EXPORT.exists(), reason="no shared-schema export in output/")
def test_the_committed_snapshot_matches_the_saved_export():
    # A different hash means the export changed: re-run the script and commit.
    assert snapshot_script.snapshot_file(EXPORT) == schema.snapshot()


def test_shared_tables_are_known_and_web_tables_are_not():
    assert schema.is_shared_table("users")
    assert schema.is_shared_table("mobile_provider_services")
    assert not schema.is_shared_table("bookings")
    assert not schema.is_shared_table("profiles")


def test_required_columns_without_a_default_are_what_an_insert_must_send():
    assert schema.required_without_default("users") == ["id", "email", "updated_at"]
    assert schema.required_without_default("user_role_assignments") == ["id", "user_id", "role"]
    assert schema.required_without_default("tenant_profiles") == ["user_id", "updated_at"]
    assert schema.required_without_default("notifications") == ["user_id", "title", "body", "category"]


def test_columns_and_enums_come_from_the_snapshot():
    assert schema.has_column("users", "updated_at")
    assert not schema.has_column("user_role_assignments", "updated_at")
    assert not schema.has_column("notifications", "link_href")
    assert schema.enum_values("notifications", "category") == ["system", "bid", "social", "project"]
    assert schema.enum_values("users", "verification_status") is None  # text, not an enum
    assert schema.columns("users")["approved_by_user_id"]["references"] == {"table": "users", "column": "id"}
    with pytest.raises(TypeError):
        schema.columns("users")["role"] = {}  # read-only view of the snapshot


def test_shared_enums_are_upper_case_except_notification_categories():
    # As docs/shared-db.md says; the labels themselves come from enum_values().
    lower_case = {
        f"{table}.{column}"
        for table, spec in schema.snapshot()["tables"].items()
        for column, column_spec in spec["columns"].items()
        if any(label != label.upper() for label in column_spec.get("enum") or ())
    }

    assert lower_case == {"notifications.category"}


def test_unknown_tables_and_columns_raise():
    with pytest.raises(KeyError, match="'bookings' is not a table of the shared schema"):
        schema.columns("bookings")
    with pytest.raises(KeyError, match="not a table"):
        schema.has_column("profiles", "id")
    with pytest.raises(KeyError, match="the shared 'users' table has no 'role' column"):
        schema.enum_values("users", "role")
