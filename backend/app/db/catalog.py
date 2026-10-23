"""The shared database's rules, as committed in shared_catalog.json.

scripts/import_shared_catalog.py writes the snapshot from a CSV export of
output/sql-to-apply/read_only_catalog.sql; nothing here talks to the
database. Where app.db.schema says what a table holds, this says what the
database refuses and does on its own: per public table its CHECK
constraints, unique constraints and unique indexes, foreign keys with their
ON DELETE rule, and triggers; and the enums. The strict test fake enforces
them (tests/fake_supabase.py).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType

CATALOG_PATH = Path(__file__).with_name("shared_catalog.json")
_NO_RULES = MappingProxyType({"primary_key": None, "checks": [], "unique": [], "foreign_keys": [], "triggers": []})


@lru_cache
def snapshot() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def table_rules(table: str) -> Mapping[str, object]:
    """primary_key, checks, unique, foreign_keys and triggers of a public table; empty for a table with none."""
    rules = snapshot()["tables"].get(table)
    return MappingProxyType(rules) if rules is not None else _NO_RULES


def checks(table: str) -> list[dict]:
    """The CHECK constraints: {name, expression}, the expression as Postgres prints it."""
    return list(table_rules(table)["checks"])


def unique_keys(table: str) -> list[dict]:
    """Unique constraints (kind "constraint") and unique indexes (kind "index"): {name, kind, keys, where?}.

    A key is a column name or, for an index, an expression such as
    "((metadata ->> 'maintenanceComplaintId'::text))". where is a partial
    index's predicate. The primary key is table_rules(table)["primary_key"].
    """
    return list(table_rules(table)["unique"])


def foreign_keys(table: str) -> list[dict]:
    """{name, columns, references: {schema, table, columns}, on_delete, on_update}; the rules are lower case."""
    return list(table_rules(table)["foreign_keys"])


def triggers(table: str) -> list[dict]:
    """{name, timing, events, level, function, update_of?, constraint?, initially_deferred?}, by name."""
    return list(table_rules(table)["triggers"])


def enum_labels(name: str) -> list[str]:
    """The labels of a public enum type, in their sort order."""
    try:
        return list(snapshot()["enums"][name])
    except KeyError:
        raise KeyError(f"{name!r} is not an enum of the shared schema") from None
