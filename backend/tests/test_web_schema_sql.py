"""supabase/shared: the web schema keeps the old tables' shape on shared ids, adds the tables the web
needed since (0004: the scorecards of R43; 0005: the listing views of R28; 0006: the Housing Portal's
data requests of R41), and changes nothing in public."""

import re
from pathlib import Path

import pytest

from app.db import schema
from tests import web_schema
from tests.web_schema import strip_comments

LEGACY_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
LEGACY_SEED = LEGACY_DIR.parent / "seed.sql"
WEB_SQL = web_schema.WEB_SCHEMA_SQL.read_text(encoding="utf-8")
SEED_SQL = web_schema.WEB_SEED_SQL.read_text(encoding="utf-8")
SCORECARDS_SQL = web_schema.SCORECARDS_SQL.read_text(encoding="utf-8")
LISTING_VIEWS_SQL = web_schema.LISTING_VIEWS_SQL.read_text(encoding="utf-8")
HOUSING_PORTAL_SQL = web_schema.HOUSING_PORTAL_SQL.read_text(encoding="utf-8")
LEGACY_SQL = "\n".join(path.read_text(encoding="utf-8") for path in sorted(LEGACY_DIR.glob("*.sql")))
README = (web_schema.SHARED_SQL_DIR / "README.md").read_text(encoding="utf-8")

# The old project's tables, which 0001 recreates in the web schema.
TABLES = {
    "bookings", "invoices", "transactions", "provider_availability", "provider_portfolio", "saved_providers",
    "audit_log", "service_categories", "faqs", "platform_settings", "subscription_plans", "user_subscriptions",
}
# Tables the web added later, each file with its own (R43, R28, R41).
LATER_TABLES = {
    web_schema.SCORECARDS_SQL: {"scorecard_requests"},
    web_schema.LISTING_VIEWS_SQL: {"listing_views", "listing_view_salts"},
    web_schema.HOUSING_PORTAL_SQL: {"datapoint_requests"},
}
SCHEMA_SQL = {path.name[:4]: path.read_text(encoding="utf-8") for path in web_schema.SCHEMA_FILES}
# Old enum type -> the web column that now holds its values as checked text.
ENUM_COLUMNS = {
    "booking_status": ("bookings", "status"),
    "invoice_status": ("invoices", "status"),
    "transaction_type": ("transactions", "type"),
    "subscription_status": ("user_subscriptions", "status"),
    "service_provider_category": ("service_categories", "category"),
    "user_role": ("subscription_plans", "audience"),
}
CATALOGUE_TABLES = {"service_categories", "subscription_plans", "faqs", "platform_settings"}


def _normalised(sql: str) -> str:
    return " ".join(strip_comments(sql).lower().split())


def _legacy_enums() -> dict[str, tuple[str, ...]]:
    enums = re.findall(r"create type (\w+) as enum \(([^)]*)\)", LEGACY_SQL)
    return {name: tuple(re.findall(r"'([^']*)'", values)) for name, values in enums}


def test_the_web_schema_has_the_tables_the_backend_queries():
    assert set(web_schema.web_tables()) == TABLES.union(*LATER_TABLES.values())
    assert {table.schema for table in web_schema.web_tables().values()} == {"web"}
    assert set(web_schema.parse_tables(WEB_SQL)) == TABLES
    for path, tables in LATER_TABLES.items():
        assert set(web_schema.parse_tables(path.read_text(encoding="utf-8"))) == tables, path.name


def test_every_file_that_creates_a_web_table_is_one_the_fake_reads():
    # A new 000N file with a table must join SCHEMA_FILES, in the order to apply, or the strict fake lacks it.
    creating = [path for path in sorted(web_schema.SHARED_SQL_DIR.glob("*.sql"))
                if "create table" in _normalised(path.read_text(encoding="utf-8"))]

    assert creating == list(web_schema.SCHEMA_FILES)


def test_each_table_keeps_the_old_columns_and_their_defaults():
    legacy = web_schema.parse_tables(LEGACY_SQL)
    enums = _legacy_enums()
    for name, table in web_schema.web_tables().items():
        if name not in TABLES:
            continue  # new in the web schema: no old table to keep
        old = legacy[name].columns
        added = {"conversation_id", "review_id"} if name == "bookings" else set()
        assert set(table.columns) == set(old) | added, name
        for column_name, column in old.items():
            new = table.columns[column_name]
            assert (new.not_null, new.default) == (column.not_null, column.default), f"{name}.{column_name}"
            assert new.type == ("text" if column.type in enums else column.type), f"{name}.{column_name}"


def test_old_enum_columns_are_text_checked_against_the_same_values():
    enums = _legacy_enums()
    tables = web_schema.web_tables()
    for enum, (table, column) in ENUM_COLUMNS.items():
        assert tables[table].columns[column].allowed == enums[enum], enum
    assert "create type" not in _normalised(WEB_SQL)


def test_every_person_and_provider_is_a_shared_user():
    people = {"client_id", "provider_id", "user_id", "actor_id", "tenant_user_id", "owner_user_id"}
    for table in web_schema.web_tables().values():
        for column in table.columns.values():
            if column.name in people:
                assert column.references == ("public", "users", "id"), f"{table.name}.{column.name}"


def test_bookings_point_at_the_shared_service_thread_and_review():
    columns = web_schema.web_tables()["bookings"].columns
    links = {name: (columns[name].references, columns[name].on_delete)
             for name in ("service_id", "conversation_id", "review_id")}
    assert links == {
        "service_id": (("public", "mobile_provider_services", "id"), "set null"),
        "conversation_id": (("public", "conversations", "id"), "set null"),
        "review_id": (("public", "reviews", "id"), "set null"),
    }


def test_every_shared_table_referenced_exists_in_the_snapshot():
    for table in web_schema.web_tables().values():
        for column in table.columns.values():
            if column.references and column.references[0] == "public":
                _, target, target_column = column.references
                assert schema.columns(target)[target_column].get("primary_key"), f"{table.name}.{column.name}"


@pytest.mark.parametrize("sql", SCHEMA_SQL.values(), ids=SCHEMA_SQL.keys())
def test_nothing_in_public_is_created_or_changed(sql):
    sql = _normalised(sql)
    assert not re.search(r"\b(create|alter|drop|comment on)( unique)? (table|index|type|function|trigger|schema)"
                         r"( if (not )?exists)? public\.", sql)
    assert not re.search(r"\bon public\.", sql)  # no index, trigger or policy on a shared table
    assert "create policy" not in sql


def test_rls_is_on_for_every_table_and_only_the_service_role_is_granted():
    assert all(table.row_level_security for table in web_schema.web_tables().values())
    sql = _normalised(WEB_SQL)
    for grant in (
        "grant usage on schema web to service_role;",
        "grant all privileges on all tables in schema web to service_role;",
        "alter default privileges in schema web grant all on tables to service_role;",
    ):
        assert grant in sql
    for path, tables in LATER_TABLES.items():
        # Whichever role runs a later file, its tables get the grant 0001's defaults give.
        later = _normalised(path.read_text(encoding="utf-8"))
        assert re.findall(r"\bgrant (.+?);", later) == [
            f"all privileges on table web.{table} to service_role" for table in sorted(tables)
        ], path.name
    for sql in SCHEMA_SQL.values():
        assert not re.search(r"\b(anon|authenticated)\b", _normalised(sql))


def test_updated_at_columns_have_the_update_trigger():
    for table in web_schema.web_tables().values():
        assert table.updated_at_trigger == ("updated_at" in table.columns), table.name


def test_the_ledger_and_review_links_are_unique_per_booking():
    unique = {(table.name, index.columns, index.where)
              for table in web_schema.web_tables().values() if table.name in TABLES
              for index in table.indexes if index.unique}
    assert unique == {
        ("invoices", ("booking_id",), "booking_id is not null"),
        ("transactions", ("booking_id", "type"), "booking_id is not null and type in ('payment','platform_fee')"),
        ("bookings", ("review_id",), "review_id is not null"),
    }
    assert ("provider_id", "number") in web_schema.web_tables()["invoices"].unique
    assert ("user_id", "provider_id") in web_schema.web_tables()["saved_providers"].unique


def test_a_tenant_has_one_pending_scorecard_request_per_owner_and_home():
    table = web_schema.web_tables()["scorecard_requests"]

    assert [(index.columns, index.where) for index in table.indexes if index.unique] == [
        (("tenant_user_id", "owner_user_id", "property_id"), "status in ('PENDING')"),
    ]
    assert table.unique == [("id",)]  # answered and cancelled requests stay beside a new one
    assert table.columns["status"].allowed == ("PENDING", "COMPLETED", "DECLINED", "CANCELLED")
    assert (table.columns["status"].not_null, table.columns["status"].default) == (True, "'PENDING'")


def test_a_scorecard_request_points_at_its_people_home_and_tenancy():
    columns = web_schema.web_tables()["scorecard_requests"].columns
    links = {name: (columns[name].references, columns[name].not_null, columns[name].on_delete)
             for name in ("tenant_user_id", "owner_user_id", "property_id", "agreement_id", "application_id")}

    assert links == {
        "tenant_user_id": (("public", "users", "id"), True, "cascade"),
        "owner_user_id": (("public", "users", "id"), True, "cascade"),
        "property_id": (("public", "properties", "id"), True, "cascade"),
        "agreement_id": (("public", "rent_agreements", "id"), False, "set null"),
        "application_id": (("public", "rental_applications", "id"), False, "set null"),
    }
    # Off the public profile until the tenant chooses to show it (tracker assumption #20).
    assert (columns["visible_on_profile"].not_null, columns["visible_on_profile"].default) == (True, "false")
    assert (columns["answers"].type, columns["answers"].not_null) == ("jsonb", False)


def test_a_completed_scorecard_has_its_answers_and_no_one_asks_themselves():
    sql = _normalised(SCORECARDS_SQL)

    assert "check (tenant_user_id <> owner_user_id)" in sql
    assert "check (status <> 'completed' or (answers is not null and completed_at is not null))" in sql
    assert "answers jsonb check (answers is null or jsonb_typeof(answers) = 'object')" in sql


def test_a_scorecard_request_keeps_when_it_was_decided_whatever_made_its_table():
    columns = web_schema.web_tables()["scorecard_requests"].columns
    sql = _normalised(SCORECARDS_SQL)

    # Not updated_at, which moves when a linked lease or application goes (set null).
    assert (columns["decided_at"].type, columns["decided_at"].not_null) == ("timestamptz", False)
    # A table made from the file's first draft, without the column, gets it when the file runs again.
    assert "alter table web.scorecard_requests add column if not exists decided_at timestamptz" in sql


def test_a_viewer_counts_once_per_listing_and_day_and_is_kept_only_as_a_hash():
    table = web_schema.web_tables()["listing_views"]

    assert table.unique == [("id",), ("listing_id", "viewed_on", "visitor_hash")]
    assert [index for index in table.indexes if index.unique] == []
    # The day, not the time: nothing to match against access logs.
    assert {name: (column.type, column.not_null) for name, column in table.columns.items()} == {
        "id": ("uuid", True), "listing_id": ("uuid", True), "viewed_on": ("date", True),
        "visitor_hash": ("text", True),
    }
    assert (table.columns["listing_id"].references, table.columns["listing_id"].on_delete) == (
        ("public", "listings", "id"), "cascade",
    )
    # Nothing that names a person: the hash is HMAC-SHA256 hex, checked by the database.
    assert "visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$')" in _normalised(LISTING_VIEWS_SQL)
    # Its key is the day's random salt, one row a day.
    salts = web_schema.web_tables()["listing_view_salts"]
    assert salts.primary_key == ("viewed_on",)
    assert {name: (column.type, column.not_null) for name, column in salts.columns.items()} == {
        "viewed_on": ("date", True), "salt": ("text", True),
    }
    assert "salt text not null check (salt ~ '^[0-9a-f]{64}$')" in _normalised(LISTING_VIEWS_SQL)


@pytest.mark.parametrize("sql", [WEB_SQL, SEED_SQL, SCORECARDS_SQL, LISTING_VIEWS_SQL, HOUSING_PORTAL_SQL],
                         ids=["0001", "0002", "0004", "0005", "0006"])
def test_each_file_is_one_transaction(sql):
    statements = [s.strip() for s in _normalised(sql).split(";") if s.strip()]
    assert (statements[0], statements[-1]) == ("begin", "commit")
    assert statements.count("begin") == statements.count("commit") == 1


@pytest.mark.parametrize("sql", [WEB_SQL, SEED_SQL, SCORECARDS_SQL, LISTING_VIEWS_SQL, HOUSING_PORTAL_SQL],
                         ids=["0001", "0002", "0004", "0005", "0006"])
def test_each_file_gives_up_on_a_busy_table_after_5_seconds(sql):
    # Rather than wait for a lock, with the mobile app's writes to that table queued behind it.
    statements = [s.strip() for s in _normalised(sql).split(";") if s.strip()]
    assert statements[1] == "set local lock_timeout = '5s'"  # local: it ends with the transaction


@pytest.mark.parametrize("path", web_schema.SCHEMA_FILES, ids=[path.name[:4] for path in web_schema.SCHEMA_FILES])
def test_the_schema_files_can_run_again(path):
    sql = _normalised(path.read_text(encoding="utf-8"))
    tables = TABLES if path == web_schema.WEB_SCHEMA_SQL else LATER_TABLES[path]
    assert sql.count("create table ") == sql.count("create table if not exists ") == len(tables)
    assert len(re.findall(r"create (unique )?index ", sql)) == len(re.findall(r"create (unique )?index if not exists ", sql))
    assert ("create schema if not exists web;" in sql) == (path == web_schema.WEB_SCHEMA_SQL)
    assert "create function" not in sql  # only "create or replace function"
    for trigger in re.findall(r"create trigger (\w+) ", sql):
        assert f"drop trigger if exists {trigger} " in sql


def test_the_seed_rows_fit_their_tables_and_skip_existing_keys():
    tables = web_schema.web_tables()
    inserts = web_schema.parse_inserts(SEED_SQL)
    assert {insert.table: len(insert.rows) for insert in inserts} == {
        "service_categories": 9, "subscription_plans": 5, "faqs": 9, "platform_settings": 3,
    }
    for insert in inserts:
        table = tables[insert.table]
        assert insert.on_conflict in table.unique, insert.table
        for row in insert.rows:
            assert set(row) <= set(table.columns), insert.table
            for column in table.columns.values():
                if column.not_null and column.default is None:
                    assert row.get(column.name) is not None, f"{insert.table}.{column.name}"
                if column.allowed and column.name in row:
                    assert row[column.name] in column.allowed, f"{insert.table}.{column.name}"


def test_the_seed_rows_are_the_old_catalogue():
    old = web_schema.parse_inserts(LEGACY_SEED.read_text(encoding="utf-8"), tables=CATALOGUE_TABLES)
    new = web_schema.parse_inserts(SEED_SQL)
    assert {insert.table: insert.rows for insert in new} == {insert.table: insert.rows for insert in old}
    assert "public." not in _normalised(SEED_SQL)


def test_the_readme_api_check_reads_a_seeded_web_column():
    table, column = re.search(r"/rest/v1/(\w+)\?select=(\w+)&limit=1", README).groups()

    assert column in web_schema.web_tables()[table].columns
    assert any(insert.table == table and insert.rows for insert in web_schema.parse_inserts(SEED_SQL))
    assert '-H "Accept-Profile: web"' in README  # the profile web_table() asks for (test_supabase_clients)


def test_the_readme_lists_every_sql_file_in_the_order_to_apply_them():
    # The apply list is the whole set: a new file in supabase/shared must be added to it.
    rows = re.findall(r"^\| (\d+) \| (`\d{4}_\w+\.sql`|\*Data API setting\*) \|", README, re.MULTILINE)
    files = [f"`{path.name}`" for path in sorted(web_schema.SHARED_SQL_DIR.glob("*.sql"))]

    items = [item for _, item in rows]
    assert [int(order) for order, _ in rows] == list(range(1, len(rows) + 1))
    assert [item for item in items if item.endswith(".sql`")] == files
    # PostgREST can expose the schema only once 0001 has made it.
    assert items.index("*Data API setting*") > items.index("`0001_web_schema.sql`")
    # The Apply steps paste them in the same order.
    assert [f"`{name}`" for name in re.findall(r"paste the whole of `(\d{4}_\w+\.sql)`", README, re.I)] == files
