"""The shared database's public schema, as committed in shared_schema.json.

scripts/snapshot_shared_schema.py writes the snapshot from a PostgREST
OpenAPI export; nothing here talks to the database. The tables belong to the
mobile app and the rental web (Prisma), so code asks the snapshot what a
table has rather than assuming the web's old columns.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType

SNAPSHOT_PATH = Path(__file__).with_name("shared_schema.json")


@lru_cache
def snapshot() -> dict:
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def _table(table: str) -> dict:
    try:
        return snapshot()["tables"][table]
    except KeyError:
        raise KeyError(f"{table!r} is not a table of the shared schema") from None


def _column(table: str, column: str) -> dict:
    try:
        return _table(table)["columns"][column]
    except KeyError:
        if not is_shared_table(table):
            raise
        raise KeyError(f"the shared {table!r} table has no {column!r} column") from None


def is_shared_table(table: str) -> bool:
    return table in snapshot()["tables"]


def columns(table: str) -> Mapping[str, dict]:
    """Column name -> type, format, enum, not_null, has_default, default and references."""
    return MappingProxyType(_table(table)["columns"])


def has_column(table: str, column: str) -> bool:
    return column in _table(table)["columns"]


def enum_values(table: str, column: str) -> list[str] | None:
    """The labels a Postgres enum column accepts; None for any other type."""
    values = _column(table, column).get("enum")
    return list(values) if values is not None else None


def required_without_default(table: str) -> list[str]:
    """NOT NULL columns with no database default: an insert must send every one."""
    return [name for name, spec in _table(table)["columns"].items() if spec["not_null"] and not spec["has_default"]]
