"""supabase/shared/0003_storage.sql: the private bucket chat attachments are stored in."""

import re

from app.services import uploads
from tests import web_schema
from tests.web_schema import strip_comments

STORAGE_SQL = (web_schema.SHARED_SQL_DIR / "0003_storage.sql").read_text(encoding="utf-8")
README = (web_schema.SHARED_SQL_DIR / "README.md").read_text(encoding="utf-8")


def _normalised(sql: str) -> str:
    return " ".join(strip_comments(sql).lower().split())


def _statements() -> list[str]:
    return [statement.strip() for statement in _normalised(STORAGE_SQL).split(";") if statement.strip()]


def _bucket() -> tuple[str, str, str, str, list[str]]:
    match = re.search(
        r"insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\) values "
        r"\( '([^']+)', '([^']+)', (\w+), (\d+), array\[([^\]]*)\] \)",
        _normalised(STORAGE_SQL),
    )
    assert match, "the bucket insert"
    *values, types = match.groups()
    return (*values, re.findall(r"'([^']+)'", types))


def test_it_creates_the_bucket_the_backend_stores_chat_files_in():
    bucket_id, name, public, size_limit, types = _bucket()
    rules = uploads.BUCKETS[uploads.MESSAGE_ATTACHMENTS_BUCKET]

    assert bucket_id == name == uploads.MESSAGE_ATTACHMENTS_BUCKET
    assert uploads.MESSAGE_ATTACHMENTS_BUCKET != uploads.VERIFICATION_DOCUMENTS_BUCKET
    assert (public, rules.public) == ("false", False)
    assert int(size_limit) == rules.max_bytes


def test_the_bucket_takes_every_type_the_upload_accepts():
    # Otherwise Storage refuses a file the backend validated, and the user gets a 502.
    assert set(uploads.BUCKETS[uploads.MESSAGE_ATTACHMENTS_BUCKET].content_types) <= set(_bucket()[4])


def test_it_is_one_transaction_that_gives_up_on_a_busy_table():
    statements = _statements()

    assert (statements[0], statements[1], statements[-1]) == ("begin", "set local lock_timeout = '5s'", "commit")
    assert statements.count("begin") == statements.count("commit") == 1


def test_it_can_run_again_and_puts_the_settings_back():
    sql = _normalised(STORAGE_SQL)

    assert "on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, " \
           "allowed_mime_types = excluded.allowed_mime_types" in sql


def test_only_the_service_role_can_reach_it_and_nothing_in_public_changes():
    sql = _normalised(STORAGE_SQL)

    assert "create policy" not in sql and "grant " not in sql
    assert not re.search(r"\b(anon|authenticated)\b", sql)
    assert "public." not in sql
    assert [s.split(" ", 2)[:2] for s in _statements()[2:-1]] == [["insert", "into"]]  # the bucket, and nothing else


def test_the_readme_says_how_to_apply_check_and_undo_it():
    assert "`0003_storage.sql`" in README
    assert "paste the whole of `0003_storage.sql`" in README
    assert f"from storage.buckets where id = '{uploads.MESSAGE_ATTACHMENTS_BUCKET}';" in README
    assert f"empty `{uploads.MESSAGE_ATTACHMENTS_BUCKET}`" in README
