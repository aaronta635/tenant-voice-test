import re
from collections.abc import Callable, Iterable, Sequence

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, web_table
from app.db import schema
from app.services.shared_map import stamp_insert, stamp_update

# Characters with meaning in a PostgREST filter string (",", "(", ")", quotes)
# or in a LIKE pattern ("%", "*", "_", "\\"). A user's search text is spliced
# into or_() filters, so these must never reach it: a comma would start a new,
# attacker-chosen condition (e.g. probing other users' phone numbers).
_FILTER_UNSAFE = re.compile(r"[,()%*_\\\"':;]")

# PostgREST answers a select with at most max-rows rows (1000 on Supabase), so
# a read that may match more goes page by page.
PAGE_SIZE = 1000
# Values per in_() filter, which keeps a request URL well within gateway limits.
IN_CHUNK = 100


def search_term(value: str | None, max_length: int = 80) -> str:
    """User search text made safe to embed in an ilike/or_ filter."""
    cleaned = _FILTER_UNSAFE.sub(" ", value or "")
    return " ".join(cleaned.split())[:max_length]


def select_all(build: Callable) -> list[dict]:
    """Every row a select matches, past PostgREST's max-rows cap.

    build() returns a fresh query, ordered by a unique column so that pages
    neither repeat nor skip a row. Only an empty page ends the read: the
    project's max-rows may be below PAGE_SIZE, and then every page is short.
    """
    rows: list[dict] = []
    while True:
        page = build().range(len(rows), len(rows) + PAGE_SIZE - 1).execute().data or []
        if not page:
            return rows
        rows.extend(page)


def select_in(build: Callable, column: str, values: Iterable) -> list[dict]:
    """select_all() of the rows whose column is one of values, a chunk of values at a time."""
    values = list(dict.fromkeys(values))
    rows: list[dict] = []
    for start in range(0, len(values), IN_CHUNK):
        chunk = values[start : start + IN_CHUNK]
        rows.extend(select_all(lambda: build().in_(column, chunk)))
    return rows


# ---------------------------------------------------------------------------
# Rows a provider or user owns, scoped by owner_column
# ---------------------------------------------------------------------------
# web=True reaches a web-only table (supabase/shared/0001_web_schema.sql);
# otherwise the table is in public. Writes to a shared table get the id and
# updated_at it has no default for (stamp_insert, stamp_update).
def _query(table: str, web: bool):
    return web_table(table) if web else get_supabase_client().table(table)


def _is_shared(table: str, web: bool) -> bool:
    return not web and schema.is_shared_table(table)


def list_owned(
    table: str,
    owner_id: str,
    order_by: str | Sequence[str] | None = None,
    desc: bool = False,
    *,
    owner_column: str = "provider_id",
    web: bool = False,
) -> list[dict]:
    query = _query(table, web).select("*").eq(owner_column, owner_id)
    for column in [order_by] if isinstance(order_by, str) else order_by or ():
        query = query.order(column, desc=desc)
    return query.execute().data or []


def create_owned(
    table: str, owner_id: str, payload: dict, *, owner_column: str = "provider_id", web: bool = False
) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    payload[owner_column] = owner_id
    if _is_shared(table, web):
        payload = stamp_insert(table, payload)
    result = _query(table, web).insert(payload).execute()
    return result.data[0]


def get_owned(
    table: str, row_id: str, owner_id: str, *, owner_column: str = "provider_id", web: bool = False
) -> dict:
    result = _query(table, web).select("*").eq("id", row_id).eq(owner_column, owner_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return result.data[0]


def update_owned(
    table: str,
    row_id: str,
    owner_id: str,
    payload: dict,
    *,
    owner_column: str = "provider_id",
    web: bool = False,
) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    if not payload:
        return get_owned(table, row_id, owner_id, owner_column=owner_column, web=web)
    if _is_shared(table, web):
        payload = stamp_update(table, payload)
    result = _query(table, web).update(payload).eq("id", row_id).eq(owner_column, owner_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return result.data[0]


def delete_owned(
    table: str, row_id: str, owner_id: str, *, owner_column: str = "provider_id", web: bool = False
) -> None:
    result = _query(table, web).delete().eq("id", row_id).eq(owner_column, owner_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
