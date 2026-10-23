"""The committed shared-catalog snapshot, the script that writes it and app.db.catalog."""

import csv
import io
import json
from pathlib import Path

import pytest

from app.db import catalog, schema
from scripts import import_shared_catalog as importer

REPO_ROOT = Path(__file__).resolve().parents[2]
# output/ is gitignored: the export exists only where someone saved it.
EXPORT = REPO_ROOT / "output" / "shared-catalog" / "catalog-2026-10-23.csv"

ROWS = [
    ("constraint", "accounts.accounts_pkey", "p", "PRIMARY KEY (id)"),
    ("constraint", "accounts.accounts_code_key", "u", "UNIQUE (code)"),
    ("constraint", "accounts.accounts_status_check", "c",
     "CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))"),
    ("constraint", "accounts.accounts_old_check", "c", "CHECK ((balance >= (0)::numeric)) NOT VALID"),
    ("constraint", "accounts.accounts_owner_id_fkey", "f",
     "FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL"),
    ("constraint", "accounts.accounts_plan_fkey", "f", "FOREIGN KEY (plan_id, region) REFERENCES plans(id, region)"),
    ("constraint", "accounts.accounts_consistency_guard", "t", "TRIGGER DEFERRABLE INITIALLY DEFERRED"),
    ("index", "accounts.accounts_pkey", "", "CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id)"),
    ("index", "accounts.accounts_code_key", "",
     "CREATE UNIQUE INDEX accounts_code_key ON public.accounts USING btree (code)"),
    ("index", "accounts.accounts_one_open_idx", "",
     "CREATE UNIQUE INDEX accounts_one_open_idx ON public.accounts USING btree (owner_id, created_at DESC) "
     "WHERE (status = 'open'::text)"),
    ("index", "accounts.accounts_ref_key", "",
     "CREATE UNIQUE INDEX accounts_ref_key ON public.accounts USING btree (((metadata ->> 'ref'::text)))"),
    ("index", "accounts.accounts_owner_idx", "",
     "CREATE INDEX accounts_owner_idx ON public.accounts USING btree (owner_id)"),
    ("trigger", "public.accounts.accounts_consistency_guard", "",
     "CREATE CONSTRAINT TRIGGER accounts_consistency_guard AFTER INSERT OR UPDATE OF status, owner_id ON "
     "public.accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accounts()"),
    ("trigger", "public.accounts.accounts_guard", "",
     "CREATE TRIGGER accounts_guard BEFORE INSERT OR DELETE OR UPDATE ON public.accounts FOR EACH ROW "
     "EXECUTE FUNCTION guard_accounts()"),
    ("trigger", "storage.objects.protect_objects_delete", "",
     "CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT "
     "EXECUTE FUNCTION storage.protect_delete()"),
    ("enum", "AccountStatus", "", "open,closed"),
    ("function", "guard_accounts", "", "CREATE OR REPLACE FUNCTION public.guard_accounts() ..."),
    ("policy", "public.accounts.accounts_select_self", "SELECT", "using: (owner_id = auth.uid()) | check: -"),
]


def _csv(rows=ROWS) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["kind", "name", "detail", "definition"])
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def _build(rows=ROWS) -> dict:
    return importer.build_catalog(importer.read_rows(_csv(rows)), {"file": "test.csv", "sha256": "abc"})


def test_checks_keep_their_name_and_expression():
    checks = _build()["tables"]["accounts"]["checks"]

    assert checks == [
        {"name": "accounts_old_check", "expression": "(balance >= (0)::numeric)", "not_valid": True},
        {"name": "accounts_status_check", "expression": "(status = ANY (ARRAY['open'::text, 'closed'::text]))"},
    ]


def test_unique_constraints_and_unique_indexes_keep_keys_and_predicates():
    table = _build()["tables"]["accounts"]

    assert table["primary_key"] == {"name": "accounts_pkey", "columns": ["id"]}
    # The index behind a constraint is that constraint; a plain index is left out.
    assert table["unique"] == [
        {"name": "accounts_code_key", "kind": "constraint", "keys": ["code"]},
        {"name": "accounts_one_open_idx", "kind": "index", "keys": ["owner_id", "created_at"],
         "where": "(status = 'open'::text)"},
        {"name": "accounts_ref_key", "kind": "index", "keys": ["((metadata ->> 'ref'::text))"]},
    ]


def test_foreign_keys_keep_their_columns_target_and_rules():
    foreign_keys = _build()["tables"]["accounts"]["foreign_keys"]

    assert foreign_keys == [
        {"name": "accounts_owner_id_fkey", "columns": ["owner_id"],
         "references": {"schema": "public", "table": "users", "columns": ["id"]},
         "on_delete": "set null", "on_update": "cascade"},
        {"name": "accounts_plan_fkey", "columns": ["plan_id", "region"],
         "references": {"schema": "public", "table": "plans", "columns": ["id", "region"]},
         "on_delete": "no action", "on_update": "no action"},
    ]


def test_triggers_keep_timing_events_columns_and_deferral_and_other_schemas_are_left_out():
    catalog_ = _build()

    assert catalog_["tables"]["accounts"]["triggers"] == [
        {"name": "accounts_consistency_guard", "timing": "after", "events": ["insert", "update"], "level": "row",
         "function": "check_accounts", "update_of": ["status", "owner_id"], "constraint": True, "deferrable": True,
         "initially_deferred": True},
        {"name": "accounts_guard", "timing": "before", "events": ["insert", "delete", "update"], "level": "row",
         "function": "guard_accounts"},
    ]
    assert "objects" not in catalog_["tables"]
    assert catalog_["left_out"] == {"functions": 1, "policies": 1, "storage triggers": 1}
    assert catalog_["enums"] == {"AccountStatus": ["open", "closed"]}


def test_a_definition_longer_than_the_csv_default_limit_is_read():
    body = "x" * 200_000  # the csv module's default limit is 131072 characters
    default = csv.field_size_limit(131_072)
    try:
        rows = importer.read_rows(_csv([("function", "huge", "", body)]))
    finally:
        csv.field_size_limit(default)

    assert rows[0]["definition"] == body


@pytest.mark.parametrize("row", [
    ("constraint", "accounts.accounts_excl", "x", "EXCLUDE USING gist (period WITH &&)"),
    ("constraint", "accounts.accounts_fkey", "f", "FOREIGN KEY (a) REFERENCES b(c) ON DELETE SET NULL (a)"),
    ("index", "accounts.weird", "", "CREATE UNIQUE INDEX weird ON public.accounts USING btree (a) EXTRA"),
    ("trigger", "public.accounts.t", "", "CREATE TRIGGER t SOMETIME ON public.accounts"),
    ("sequence", "accounts_id_seq", "", ""),
])
def test_a_row_the_script_cannot_read_stops_it(row):
    with pytest.raises(importer.CatalogError):
        _build([row])


def test_the_output_is_sorted_and_the_same_for_the_same_export(tmp_path):
    shuffled = list(reversed(ROWS))
    source = tmp_path / "catalog.csv"
    source.write_bytes(_csv(shuffled))

    importer.main([str(source), "--out", str(tmp_path / "a.json")])
    importer.main([str(source), "--out", str(tmp_path / "b.json")])
    written = json.loads((tmp_path / "a.json").read_text(encoding="utf-8"))

    assert (tmp_path / "a.json").read_text(encoding="utf-8") == (tmp_path / "b.json").read_text(encoding="utf-8")
    assert written["source"]["file"] == "catalog.csv" and len(written["source"]["sha256"]) == 64
    assert written["tables"]["accounts"] == _build(shuffled)["tables"]["accounts"]
    assert [check["name"] for check in written["tables"]["accounts"]["checks"]] == [
        "accounts_old_check", "accounts_status_check"]


@pytest.mark.skipif(not EXPORT.exists(), reason="the catalog export is not saved here")
def test_the_committed_snapshot_is_what_the_script_writes_from_the_export():
    assert catalog.CATALOG_PATH.read_text(encoding="utf-8") == importer.render(importer.catalog_file(EXPORT))


def test_the_snapshot_covers_the_tables_of_the_schema_snapshot():
    assert set(catalog.snapshot()["tables"]) == set(schema.snapshot()["tables"])
    assert catalog.snapshot()["source"]["file"] == EXPORT.name


def test_the_loader_answers_per_table():
    assert {"name": "maintenance_work_orders_status_check",
            "expression": "(status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'SCHEDULED'::text, "
                          "'PENDING_TENANT_CONFIRMATION'::text, 'RESOLVED'::text]))"} in catalog.checks(
        "maintenance_work_orders")
    assert {"name": "profile_documents_user_id_document_type_key", "kind": "index",
            "keys": ["user_id", "document_type"]} in catalog.unique_keys("profile_documents")
    assert {(fk["name"], fk["on_delete"]) for fk in catalog.foreign_keys("notifications")} == {
        ("notifications_user_id_fkey", "cascade")}
    assert [trigger["function"] for trigger in catalog.triggers("users")] == ["sync_primary_role_assignment"]
    assert catalog.table_rules("not_a_table")["checks"] == []
    assert catalog.enum_labels("ListingStatus")[:2] == ["DRAFT", "PUBLISHED"]
    with pytest.raises(KeyError, match="not an enum"):
        catalog.enum_labels("Colour")
