"""Make the fake answer like the shared database where its schema alone does not.

PostgREST answers a select with at most max-rows rows (1000 on Supabase),
however many match. Import the fixture into the test module that needs it.
"""

import pytest

from tests.fake_supabase import FakeTableQuery


@pytest.fixture
def max_rows(monkeypatch):
    """Answer every select with at most one row, as PostgREST caps responses at max-rows."""
    execute = FakeTableQuery.execute

    def _execute(query):
        result = execute(query)
        if query._op == "select":
            result.data = result.data[:1]
        return result

    monkeypatch.setattr(FakeTableQuery, "execute", _execute)
