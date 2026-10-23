"""_common's owned-row helpers on the shared and web schemas, and its paged reads.

A shared table gets the id and updated_at it has no default for, a web table
is reached through web_table(), and a read past PostgREST's max-rows cap goes
page by page.
"""

import pytest
from fastapi import HTTPException

from app.core.supabase import get_supabase_client
from app.services import _common
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

OWNER = "a0000000-0000-4000-8000-000000000001"
OTHER = "a0000000-0000-4000-8000-000000000002"
NOW = "2026-01-01T00:00:00+00:00"


@pytest.fixture
def owners(strict_schema):
    strict_schema.seed("users", [{"id": user, "email": f"{user}@example.test", "updated_at": NOW}
                                 for user in (OWNER, OTHER)])
    return strict_schema


def test_a_shared_tables_row_is_stamped_and_scoped_by_its_owner_column(owners):
    created = _common.create_owned("profile_documents", OWNER, {
        "document_type": "OTHER", "file_url": "", "metadata": None,
    }, owner_column="user_id")

    assert created["user_id"] == OWNER and created["id"] and created["updated_at"]
    with pytest.raises(HTTPException) as exc:
        _common.get_owned("profile_documents", created["id"], OTHER, owner_column="user_id")
    assert exc.value.status_code == 404

    owners.tables["profile_documents"][0]["updated_at"] = NOW
    updated = _common.update_owned("profile_documents", created["id"], OWNER, {"file_url": "x"}, owner_column="user_id")
    assert updated["updated_at"] != NOW
    assert [row["id"] for row in _common.list_owned("profile_documents", OWNER, owner_column="user_id")] == [created["id"]]


def test_a_web_table_is_reached_through_the_web_schema(owners):
    created = _common.create_owned("provider_portfolio", OWNER, {"image_url": "https://example.test/a.jpg", "title": None},
                                   web=True)

    assert owners.schema_tables["web"]["provider_portfolio"][0]["id"] == created["id"]
    assert "provider_portfolio" not in owners.tables
    _common.delete_owned("provider_portfolio", created["id"], OWNER, web=True)
    assert owners.schema_tables["web"]["provider_portfolio"] == []
    with pytest.raises(HTTPException):
        _common.delete_owned("provider_portfolio", created["id"], OWNER, web=True)


def test_rows_are_listed_in_the_order_given(owners):
    for title, order in (("b", 2), ("a", 1), ("c", 1)):
        _common.create_owned("provider_portfolio", OWNER, {"image_url": f"https://example.test/{title}.jpg",
                                                           "title": title, "sort_order": order}, web=True)
    rows = _common.list_owned("provider_portfolio", OWNER, order_by=("sort_order", "title"), web=True)
    assert [row["title"] for row in rows] == ["a", "c", "b"]


def test_select_all_and_select_in_read_past_the_page_size(owners, monkeypatch):
    monkeypatch.setattr(_common, "PAGE_SIZE", 2)
    monkeypatch.setattr(_common, "IN_CHUNK", 2)
    users = [f"b0000000-0000-4000-8000-00000000000{n}" for n in range(5)]
    owners.seed("users", [{"id": user, "email": f"{n}@example.test", "updated_at": NOW} for n, user in enumerate(users)])

    def build():
        return get_supabase_client().table("users").select("id").order("id")

    assert [row["id"] for row in _common.select_all(build)] == sorted([OWNER, OTHER, *users])
    assert [row["id"] for row in _common.select_in(build, "id", users + users[:1])] == users
    assert _common.select_in(build, "id", []) == []


def test_select_all_reads_past_a_max_rows_below_its_page_size(owners, max_rows):
    # The shared project's max-rows is not known: here it is 1, so every page is short.
    def build():
        return get_supabase_client().table("users").select("id").order("id")

    assert [row["id"] for row in _common.select_all(build)] == sorted([OWNER, OTHER])
