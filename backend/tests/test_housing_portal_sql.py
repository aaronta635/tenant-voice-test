"""supabase/shared/0006_housing_portal.sql: the data category requests officers send the admins (tracker R41)."""

import re

from app.schemas import housing_portal as schemas
from app.services import housing_portal
from tests import web_schema
from tests.web_schema import strip_comments

HOUSING_SQL = (web_schema.SHARED_SQL_DIR / "0006_housing_portal.sql").read_text(encoding="utf-8")
README = (web_schema.SHARED_SQL_DIR / "README.md").read_text(encoding="utf-8")


def _normalised(sql: str) -> str:
    return " ".join(strip_comments(sql).lower().split())


def _statements() -> list[str]:
    return [statement.strip() for statement in _normalised(HOUSING_SQL).split(";") if statement.strip()]


def test_it_creates_the_table_the_portal_and_the_admins_read():
    assert set(web_schema.parse_tables(HOUSING_SQL)) == {housing_portal.REQUESTS}
    # The strict fake reads it too, so every test's fake_db has the table.
    table = web_schema.web_tables()[housing_portal.REQUESTS]
    assert table.schema == "web" and table.primary_key == ("id",)
    assert set(table.columns) == {
        "id", "officer_id", "datapoint", "requested_change", "reason", "status", "admin_response", "responded_by",
        "responded_at", "created_at", "updated_at",
    }
    assert {name for name, column in table.columns.items() if column.not_null and column.default is None} == \
        {"datapoint", "requested_change", "reason"}


def test_its_values_are_the_ones_the_api_takes():
    columns = web_schema.web_tables()[housing_portal.REQUESTS].columns

    assert columns["datapoint"].allowed == tuple(housing_portal.DATAPOINTS)
    assert columns["datapoint"].allowed == schemas.Datapoint.__args__
    assert columns["status"].allowed == housing_portal.REQUEST_STATUSES == schemas.RequestStatus.__args__
    assert (columns["status"].not_null, columns["status"].default) == (True, "'pending'")
    sql = _normalised(HOUSING_SQL)
    limit = schemas.DatapointRequestIn.model_fields["requested_change"].metadata[1].max_length
    for column in ("requested_change", "reason"):
        assert f"check (char_length({column}) between 1 and {limit})" in sql
    assert f"check (char_length(admin_response) <= {limit})" in sql


def test_its_people_are_shared_users_and_a_request_outlives_their_account():
    columns = web_schema.web_tables()[housing_portal.REQUESTS].columns

    for name in ("officer_id", "responded_by"):
        assert (columns[name].references, columns[name].on_delete) == (("public", "users", "id"), "set null"), name


def test_it_is_one_transaction_that_gives_up_on_a_busy_table():
    statements = _statements()

    assert (statements[0], statements[1], statements[-1]) == ("begin", "set local lock_timeout = '5s'", "commit")
    assert statements.count("begin") == statements.count("commit") == 1


def test_it_can_run_again():
    sql = _normalised(HOUSING_SQL)

    assert sql.count("create table ") == sql.count("create table if not exists ") == 1
    assert len(re.findall(r"create (unique )?index ", sql)) == len(re.findall(r"create (unique )?index if not exists ", sql)) == 2
    for trigger in re.findall(r"create trigger (\w+) ", sql):
        assert f"drop trigger if exists {trigger} " in sql
    assert "create function" not in sql and "create or replace function" not in sql  # 0001's set_updated_at()


def test_it_keeps_updated_at_fresh_with_0001s_trigger():
    table = web_schema.web_tables()[housing_portal.REQUESTS]

    assert table.updated_at_trigger
    assert "for each row execute function web.set_updated_at()" in _normalised(HOUSING_SQL)


def test_only_the_service_role_can_reach_it_and_nothing_in_public_changes():
    sql = _normalised(HOUSING_SQL)

    assert web_schema.web_tables()[housing_portal.REQUESTS].row_level_security
    assert "create policy" not in sql
    assert "grant all privileges on table web.datapoint_requests to service_role;" in sql
    assert not re.search(r"\b(anon|authenticated)\b", sql)
    assert not re.search(r"\b(create|alter|drop|comment on)( unique)? (table|index|type|function|trigger|schema)"
                         r"( if (not )?exists)? public\.", sql)
    assert not re.search(r"\bon public\.", sql)


def test_the_readme_says_how_to_apply_check_and_undo_it():
    assert "| `0006_housing_portal.sql` |" in README
    assert "paste the whole of `0006_housing_portal.sql`" in README
    assert "table_name = 'datapoint_requests'" in README
    assert "drop table if exists web.datapoint_requests;" in README
