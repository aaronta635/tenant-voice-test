"""An in-memory stand-in for the supabase-py client.

The backend talks to Supabase through the query-builder chain
(``table().select().eq()...execute()``), the auth client
(``auth.get_user``, ``auth.admin.*``, ``auth.sign_in_with_password``) and
storage (``storage.from_(bucket).upload / remove / create_signed_url(s)``).
This fake implements exactly the surface the services use, backed by plain
dicts, so the whole FastAPI app can be exercised without a database.

Injected in tests by patching ``app.core.supabase.create_client`` to
``FakeSupabase.client``: each client (the cached service-role one, a throwaway
login client, a user_client()) is a FakeClient with its own PostgREST token,
over the same FakeSupabase database. An RPC called through a user's client
runs as that user: tests/fake_rpcs holds Python stand-ins for the shared
database's functions, written from their real bodies.

It answers like the shared database's PostgREST: only the shared tables and
the web schema's exist, with their columns, types, keys and defaults, and
what the database would refuse fails with its error code (StrictSchema).

With the shared catalog's rules on (CATALOG_RULES in tests/conftest.py, or
fake_db.catalog_rules = True for one test), it also does what the live
database does by itself, from app/db/shared_catalog.json: CHECK constraints,
unique constraints and unique indexes, ON DELETE rules and the triggers,
which tests/fake_triggers.py emulates. Each request is then one transaction:
its triggers' writes and its deferred checks commit with it or not at all.
"""

from __future__ import annotations

import copy
import itertools
import json
import re
import sys
import uuid
from collections.abc import Callable, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from functools import cached_property, lru_cache
from types import SimpleNamespace
from urllib.parse import quote

from postgrest.exceptions import APIError

from tests import fake_sql

class FakeResult:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


def _column_value(row: dict, column: str):
    """A row's value for a column, or for a JSON key filtered as "column->>key".

    Like Postgres, ->> yields the key's value as text (true -> "true").
    """
    if "->>" not in column:
        return row.get(column)
    column, key = column.split("->>", 1)
    document = row.get(column)
    value = document.get(key) if isinstance(document, dict) else None
    return value if value is None or isinstance(value, str) else json.dumps(value)


def _ilike_match(value, pattern) -> bool:
    if value is None:
        return False
    regex = re.escape(pattern).replace("%", ".*").replace("_", ".")
    return re.fullmatch(regex, str(value), re.IGNORECASE) is not None


def _field(row, column):
    """A row value; "col->>key" reads one key of a JSON column, as in PostgREST."""
    if "->>" in column:
        base, key = column.split("->>", 1)
        value = row.get(base)
        return value.get(key) if isinstance(value, dict) else None
    return row.get(column)


def _split_terms(conditions: str) -> list[str]:
    """Split PostgREST logic on its top-level commas, keeping and(...) groups whole."""
    terms, depth, start = [], 0, 0
    for index, char in enumerate(conditions):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            terms.append(conditions[start:index])
            start = index + 1
    terms.append(conditions[start:])
    return terms


# The comparisons an or_ term may make, on how a stored value compares with its text.
_LOGIC_COMPARISONS = {
    "gt": lambda order: order > 0,
    "gte": lambda order: order >= 0,
    "lt": lambda order: order < 0,
    "lte": lambda order: order <= 0,
}
# The operators the fake evaluates inside or_(): anything else fails loudly.
LOGIC_OPERATORS = ("eq", "ilike", *_LOGIC_COMPARISONS)


def _compare_text(stored, text: str) -> int | None:
    """-1, 0 or 1 as a stored value is below, at or above a filter's text; None for a null.

    Postgres reads the text as the column's type: a number or a timestamp
    compares as one, anything else as text.
    """
    if stored is None:
        return None
    if isinstance(stored, (int, float)) and not isinstance(stored, bool):
        left, right = stored, float(text)
    else:
        try:
            left, right = (datetime.fromisoformat(str(value)) for value in (stored, text))
            left, right = (value if value.tzinfo else value.replace(tzinfo=timezone.utc) for value in (left, right))
        except ValueError:
            left, right = str(stored), text
    return (left > right) - (left < right)


def _logic_term(term: str):
    """A row check for one term: "col.op.value" (LOGIC_OPERATORS) or an and(...) / or(...) group."""
    for prefix, combine in (("and(", all), ("or(", any)):
        if term.startswith(prefix) and term.endswith(")"):
            checks = [_logic_term(part) for part in _split_terms(term[len(prefix):-1])]
            return lambda row: combine(check(row) for check in checks)
    column, op, value = term.split(".", 2)
    if op == "eq":
        return lambda row: str(_field(row, column)) == value
    if op == "ilike":
        return lambda row: _ilike_match(_field(row, column), value)
    if op in _LOGIC_COMPARISONS:
        test = _LOGIC_COMPARISONS[op]
        return lambda row: (order := _compare_text(_field(row, column), value)) is not None and test(order)
    return lambda row: False


def _predicate(op: str, column: str | None, value):
    """The row check for one filter, as PostgREST applies it; column may be a "column->>key" path."""
    def get(row):
        return _column_value(row, column)

    if op == "eq":
        return lambda row: get(row) == value
    if op == "neq":
        # As in SQL, a null never matches "<>": the comparison is unknown.
        return lambda row: get(row) is not None and get(row) != value
    if op == "in":
        return lambda row: get(row) in value
    if op == "gt":
        return lambda row: get(row) is not None and get(row) > value
    if op == "gte":
        return lambda row: get(row) is not None and get(row) >= value
    if op == "lt":
        return lambda row: get(row) is not None and get(row) < value
    if op == "lte":
        return lambda row: get(row) is not None and get(row) <= value
    if op == "is":
        if value in (None, "null"):
            return lambda row: get(row) is None
        return lambda row: get(row) == value
    if op == "ilike":
        return lambda row: _ilike_match(get(row), value)
    if op == "or":
        checks = [_logic_term(term) for term in _split_terms(value)]
        return lambda row: any(check(row) for check in checks)
    raise ValueError(f"unknown filter {op}")


class FakeTableQuery:
    def __init__(self, tables: dict[str, list[dict]], name: str, schema: str, strict: "StrictSchema"):
        self._tables = tables
        self._name = name
        self._schema = schema
        self._strict = strict
        self._filter_specs: list[tuple[str, str | None, object]] = []  # (op, column, value)
        self._order_specs: list[tuple[str, bool, bool | None, str | None]] = []
        self._limit: int | None = None
        self._range: tuple[int, int] | None = None
        self._embed_pages: dict[str, tuple[int, int]] = {}  # embedded resource -> (offset, limit)
        self._op = "select"
        self._payload = None
        self._default_to_null = True
        self._count = None
        self._head = False
        self._select = "*"

    # -- projections / mutations -------------------------------------------
    def select(self, *cols, **kw):
        """PostgREST's select: a column list returns only those columns, and embeds follow foreign keys."""
        self._count = kw.get("count")
        self._head = kw.get("head", False)
        self._select = ",".join(cols) or "*"
        return self

    def insert(self, payload, *, default_to_null: bool = True):
        self._op = "insert"
        self._payload = payload
        self._default_to_null = default_to_null
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    # -- filters ------------------------------------------------------------
    def _filter(self, op: str, column: str | None, value):
        self._filter_specs.append((op, column, value))
        return self

    def eq(self, column, value):
        return self._filter("eq", column, value)

    def neq(self, column, value):
        return self._filter("neq", column, value)

    def in_(self, column, values):
        return self._filter("in", column, list(values))

    def gt(self, column, value):
        return self._filter("gt", column, value)

    def gte(self, column, value):
        return self._filter("gte", column, value)

    def lt(self, column, value):
        return self._filter("lt", column, value)

    def lte(self, column, value):
        return self._filter("lte", column, value)

    def is_(self, column, value):
        return self._filter("is", column, value)

    def ilike(self, column, pattern):
        return self._filter("ilike", column, pattern)

    def or_(self, conditions: str):
        """PostgREST or-syntax: "col.op.value,col.op.value" (LOGIC_OPERATORS; col may be json->>key),
        where a term may also be an and(...) or or(...) group of terms."""
        return self._filter("or", None, conditions)

    # -- ordering / pagination ----------------------------------------------
    def order(self, column, desc: bool = False, nullsfirst: bool | None = None,
              foreign_table: str | None = None):
        self._order_specs.append((column, desc, nullsfirst, foreign_table))
        return self

    def limit(self, count, *, foreign_table: str | None = None):
        if foreign_table is None:
            self._limit = count
        else:
            self._embed_pages[foreign_table] = (0, count)
        return self

    def range(self, start, end, foreign_table: str | None = None):
        if foreign_table is None:
            self._range = (start, end)
        else:
            self._embed_pages[foreign_table] = (start, end - start + 1)
        return self

    # -- execution -----------------------------------------------------------
    def execute(self) -> FakeResult:
        return self._strict.execute(self)


# ---------------------------------------------------------------------------
# The shared database's tables, columns and rules
# ---------------------------------------------------------------------------
STRICT_SCHEMAS = ("public", "web")
_CLOCK_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
_ON_DELETE_RULES = (None, "no action", "restrict", "cascade", "set null")
_PUBLIC_ON_DELETE_HINT = ("The snapshot has no ON DELETE rules (migration plan, Appendix A4), "
                          "so the fake treats public foreign keys as NO ACTION.")


@dataclass(frozen=True)
class StrictColumn:
    name: str
    not_null: bool
    default: tuple[str, object] | None = None  # ("now" | "today" | "uuid", None) or ("value", literal)
    is_uuid: bool = False
    enum: tuple[str, ...] | None = None  # a Postgres enum: anything else fails with 22P02
    enum_type: str | None = None
    check: tuple[str, ...] | None = None  # a web "check (column in (...))": anything else fails with 23514
    references: tuple[str, str, str] | None = None  # (schema, table, column)
    on_delete: str | None = None  # the foreign key's ON DELETE rule; None is NO ACTION (all public ones, unless
    #                                the catalog rules are on: StrictTable.foreign_keys then holds their real rules)
    sql_type: str | None = None  # "uuid", "numeric", 'public."UserRole"': how the catalog rules read the value

    def __post_init__(self):
        if self.on_delete not in _ON_DELETE_RULES:
            raise AssertionError(f"the fake does not imitate on delete {self.on_delete} ({self.name})")


_QUOTED = r"'(?:[^']|'')*'"


@lru_cache
def _index_predicate(where: str):
    """A row check for a partial index's WHERE: "a is [not] null" and "a in ('x', 'y')" terms joined by and."""
    checks = []
    for term in re.split(r"\s+and\s+", where.strip(), flags=re.I):
        if match := re.fullmatch(r"(\w+)\s+is\s+(not\s+)?null", term, re.I):
            column, not_null = match.group(1), bool(match.group(2))
            checks.append(lambda row, c=column, not_null=not_null: (row.get(c) is not None) == not_null)
        elif match := re.fullmatch(rf"(\w+)\s+in\s*\(\s*({_QUOTED}(?:\s*,\s*{_QUOTED})*)\s*\)", term, re.I):
            values = tuple(value[1:-1].replace("''", "'") for value in re.findall(_QUOTED, match.group(2)))
            checks.append(lambda row, c=match.group(1), values=values: row.get(c) in values)
        else:
            raise AssertionError(f"the fake cannot evaluate the index predicate {where!r}")
    return lambda row: all(check(row) for check in checks)


@dataclass(frozen=True)
class StrictKey:
    """A primary key, unique constraint or unique index: no two rows share its values (23505)."""

    name: str  # as Postgres names it: "users_pkey", "faqs_audience_question_key", "uq_invoices_booking"
    columns: tuple[str, ...]
    constraint: bool = True  # False for a unique index, which PostgREST does not read for one-to-one embeds
    where: str | None = None  # a partial unique index's predicate: it holds only the rows this is true for

    def __post_init__(self):
        if self.where:
            _index_predicate(self.where)  # an unreadable predicate fails here, not in the middle of a test

    def values(self, row: dict) -> tuple | None:
        """The row's values for the key, or None where they cannot clash: a null, or a row the index leaves out."""
        values = tuple(row.get(column) for column in self.columns)
        if None in values or (self.where and not _index_predicate(self.where)(row)):
            return None
        return values


def _typed(value, sql_type: str | None):
    """value as its column's type holds it (fake_sql.to_type), or Postgres's 22P02 for one it cannot hold."""
    try:
        return fake_sql.to_type(value, sql_type)
    except fake_sql.SqlValueError as exc:
        raise _api_error("22P02", str(exc)) from None


def _evaluated(expression: "fake_sql.Expression", row: dict, types: Mapping[str, str], rule: str):
    """expression's value on row: a value its type cannot hold is 22P02, a shape the fake cannot read is a bug."""
    try:
        return expression(row, types)
    except fake_sql.SqlValueError as exc:
        raise _api_error("22P02", str(exc)) from None
    except fake_sql.SqlUnreadable as exc:
        raise AssertionError(f"{rule}: {exc}") from None


def _hashable(value):
    """A key part's value as a set holds it: jsonb compares without key order."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return value


@dataclass(frozen=True, eq=False)
class CatalogKey:
    """A primary key, unique constraint or unique index of the shared catalog (23505).

    Its parts are columns or expressions such as
    "((metadata ->> 'maintenanceComplaintId'::text))", compared as their types
    hold them (a uuid in any case, 600 and 600.00 alike). A partial index
    holds only the rows its WHERE is true for; nulls never clash, unless the
    index says NULLS NOT DISTINCT.
    """

    name: str
    columns: tuple[str, ...]  # the parts as Postgres prints them, for messages and one-to-one embeds
    constraint: bool  # a primary key or unique constraint; PostgREST embeds one to one through these only
    parts: tuple["fake_sql.Expression", ...]
    where: "fake_sql.Expression | None"
    types: Mapping[str, str]
    nulls_not_distinct: bool = False

    def values(self, row: dict) -> tuple | None:
        if self.where is not None and _evaluated(self.where, row, self.types, self.name) is not True:
            return None
        values = tuple(_hashable(_evaluated(part, row, self.types, self.name)) for part in self.parts)
        if None in values and not self.nulls_not_distinct:
            return None
        return values


@dataclass(frozen=True, eq=False)
class StrictCheck:
    """A CHECK constraint of the shared catalog: a row it finds false fails with 23514; NULL passes."""

    name: str
    expression: "fake_sql.Expression"


@dataclass(frozen=True, eq=False)
class StrictForeignKey:
    """A foreign key of one or more columns, with its ON DELETE rule, compared as the columns' types hold them.

    As MATCH SIMPLE: a row with a null in any of its columns points at nothing.
    """

    name: str
    columns: tuple[str, ...]
    target: tuple[str, str]  # (schema, table)
    target_columns: tuple[str, ...]
    on_delete: str  # "no action", "restrict", "cascade" or "set null"
    types: Mapping[str, str]
    target_types: Mapping[str, str]

    def values(self, row: dict) -> tuple | None:
        values = tuple(_typed(row.get(column), self.types.get(column)) for column in self.columns)
        return None if None in values else values

    def target_values(self, row: dict) -> tuple | None:
        values = tuple(_typed(row.get(column), self.target_types.get(column)) for column in self.target_columns)
        return None if None in values else values


@dataclass(frozen=True, eq=False)
class StrictTrigger:
    """A row trigger of the shared catalog, run by its emulation in tests/fake_triggers.py."""

    name: str
    timing: str  # "before" or "after"
    events: tuple[str, ...]  # "insert", "update", "delete"
    function: str
    emulation: Callable
    update_of: tuple[str, ...] | None = None  # UPDATE OF: fires only for an update that sets one of these
    deferred: bool = False  # a constraint trigger INITIALLY DEFERRED: runs when the request commits

    def fires(self, timing: str, event: str, changed=()) -> bool:
        if self.timing != timing or event not in self.events:
            return False
        return event != "update" or self.update_of is None or bool(set(self.update_of) & set(changed))


@dataclass(frozen=True)
class StrictTable:
    schema: str
    name: str
    columns: dict[str, StrictColumn]
    updated_at_trigger: bool = False
    keys: tuple[StrictKey | CatalogKey, ...] = ()
    # The shared catalog's rules, set only while they are on (strict_tables(catalog=True)):
    checks: tuple[StrictCheck, ...] = ()
    foreign_keys: tuple[StrictForeignKey, ...] = ()
    triggers: tuple[StrictTrigger, ...] = ()  # by name, the order Postgres fires them in

    @cached_property
    def types(self) -> dict[str, str | None]:
        """Column name -> its type, as fake_sql reads values."""
        return {name: column.sql_type for name, column in self.columns.items()}

    def one_to_one(self, columns: tuple[str, ...]) -> bool:
        """Whether a foreign key on these columns makes PostgREST embed this table as one row.

        It does when they are the whole primary key or a unique constraint,
        as service_provider_profiles.user_id is: the embed is then an object
        or null. Any other foreign key embeds a list, even one that a unique
        index covers, such as invoices.booking_id: PostgREST reads constraints.
        """
        return any(key.constraint and set(key.columns) == set(columns) for key in self.keys)


def _known_default(expression: str) -> tuple[str, None] | None:
    lowered = expression.lower()
    if lowered in ("now()", "current_timestamp"):
        return ("now", None)
    if lowered == "current_date":
        return ("today", None)
    if lowered == "gen_random_uuid()":
        return ("uuid", None)
    return None


def _snapshot_default(spec: dict) -> tuple[str, object] | None:
    if not spec["has_default"]:
        return None
    value = spec["default"]
    return (isinstance(value, str) and _known_default(value)) or ("value", value)


def _sql_default(expression: str | None, sql_type: str) -> tuple[str, object] | None:
    if expression is None:
        return None
    if known := _known_default(expression):
        return known
    literal = expression.split("::", 1)[0]
    if literal.startswith("'"):
        text = literal[1:-1].replace("''", "'")
        if sql_type.endswith("[]"):
            return ("value", [item for item in text.strip("{}").split(",") if item])
        if sql_type in ("json", "jsonb") or "::json" in expression.lower():
            return ("value", json.loads(text))
        return ("value", text)
    if literal.lower() in ("true", "false"):
        return ("value", literal.lower() == "true")
    return ("value", float(literal) if "." in literal else int(literal))


def strict_tables(catalog: bool = False) -> dict[tuple[str, str], StrictTable]:
    """(schema, name) -> table: public from app/db/shared_schema.json, web from 0001_web_schema.sql.

    With catalog, public tables also carry the rules of app/db/shared_catalog.json
    that the fake can enforce (catalog_gaps() lists any it cannot), and every
    table its foreign keys as StrictForeignKey.
    """
    return _strict_tables(catalog)


@lru_cache
def _strict_tables(catalog: bool) -> dict[tuple[str, str], StrictTable]:
    if catalog:
        base = _strict_tables(False)
        return {key: _with_catalog(table, base, []) if table.schema == "public" else _with_foreign_keys(table, base)
                for key, table in base.items()}
    from app.db import schema
    from tests.web_schema import web_tables

    tables: dict[tuple[str, str], StrictTable] = {}
    for name, table in schema.snapshot()["tables"].items():
        columns = {}
        for column, spec in table["columns"].items():
            enum, ref = spec.get("enum"), spec.get("references")
            columns[column] = StrictColumn(
                name=column,
                not_null=spec["not_null"],
                default=_snapshot_default(spec),
                is_uuid=spec["format"] == "uuid",
                enum=tuple(enum) if enum else None,
                enum_type=spec["format"].rsplit(".", 1)[-1].strip('"') if enum else None,
                references=("public", ref["table"], ref["column"]) if ref else None,
                sql_type=spec["format"],
            )
        # The snapshot marks primary keys only: it has no unique constraints.
        primary_key = tuple(column for column, spec in table["columns"].items() if spec.get("primary_key"))
        keys = (StrictKey(f"{name}_pkey", primary_key),) if primary_key else ()
        tables[("public", name)] = StrictTable("public", name, columns, keys=keys)
    for name, table in web_tables().items():
        columns = {
            column.name: StrictColumn(
                name=column.name,
                not_null=column.not_null,
                default=_sql_default(column.default, column.type),
                is_uuid=column.type == "uuid",
                check=column.allowed,
                references=column.references,
                on_delete=column.on_delete,
                sql_type=column.type,
            )
            for column in table.columns.values()
        }
        keys = tuple(
            StrictKey(f"{name}_pkey" if unique == table.primary_key else f"{name}_{'_'.join(unique)}_key", unique)
            for unique in table.unique
        ) + tuple(StrictKey(index.name, index.columns, constraint=False, where=index.where)
                  for index in table.indexes if index.unique)
        tables[("web", name)] = StrictTable("web", name, columns, updated_at_trigger=table.updated_at_trigger,
                                            keys=keys)
    return tables


_ENFORCED_ON_DELETE = ("no action", "restrict", "cascade", "set null")


def _catalog_rule(table: StrictTable, text: str) -> "fake_sql.Expression | str":
    """A rule's SQL compiled for table, or why the fake cannot enforce it."""
    try:
        expression = fake_sql.compile_expression(text)
    except fake_sql.SqlUnreadable as exc:
        return str(exc)
    unknown = sorted(expression.columns - set(table.columns))
    if unknown:
        return f"{text!r} names no column {', '.join(unknown)} of {table.name}"
    return expression


def _column_foreign_key(table: StrictTable, column: StrictColumn, tables: dict) -> StrictForeignKey:
    schema, name, target_column = column.references
    return StrictForeignKey(f"{table.name}_{column.name}_fkey", (column.name,), (schema, name), (target_column,),
                            column.on_delete or "no action", table.types, tables[(schema, name)].types)


def _with_foreign_keys(table: StrictTable, tables: dict) -> StrictTable:
    """A web table with its foreign keys as StrictForeignKey, from 0001_web_schema.sql."""
    return replace(table, foreign_keys=tuple(_column_foreign_key(table, column, tables)
                                             for column in table.columns.values() if column.references))


def _unenforced_foreign_key(spec: dict, target_known: bool) -> str | None:
    """Why the fake cannot enforce a catalog foreign key, or None."""
    if not target_known:
        return "its target is not a table the fake holds"
    if spec["on_delete"] not in _ENFORCED_ON_DELETE:
        return f"ON DELETE {spec['on_delete']}"
    if spec.get("match") == "full":
        return "MATCH FULL"
    if spec.get("deferrable"):
        return "it is deferrable"
    return None


def _unrun_trigger(spec: dict, emulation) -> str | None:
    """Why the fake cannot run a catalog trigger, or None."""
    if spec["level"] != "row":
        return "it runs FOR EACH STATEMENT"
    if spec.get("when"):
        return "it has a WHEN condition"
    if emulation is None:
        return f"tests/fake_triggers.py has no {spec['function']}()"
    return None


def _with_catalog(table: StrictTable, tables: dict, gaps: list[str]) -> StrictTable:
    """A public table with the shared catalog's checks, keys, foreign keys and emulated triggers.

    A rule the fake cannot enforce is added to gaps with the reason, and left
    out: catalog_gaps() lists them, and tests/test_fake_catalog_rules.py
    expects none.
    """
    from app.db import catalog
    from tests import fake_triggers

    rules = catalog.table_rules(table.name)
    label = f"{table.name}:"
    checks = []
    for check in rules["checks"]:
        compiled = _catalog_rule(table, check["expression"])
        if isinstance(compiled, str):
            gaps.append(f"{label} check {check['name']}: {compiled}")
        else:
            checks.append(StrictCheck(check["name"], compiled))

    primary = rules["primary_key"]
    specs = [{"name": primary["name"], "kind": "primary key", "keys": primary["columns"]}] if primary else []
    keys = [] if primary else [key for key in table.keys if isinstance(key, StrictKey)]
    for spec in specs + list(rules["unique"]):
        parts = [_catalog_rule(table, part) for part in spec["keys"]]
        where = _catalog_rule(table, spec["where"]) if spec.get("where") else None
        unread = [rule for rule in (*parts, where) if isinstance(rule, str)]
        if unread or spec.get("deferrable"):
            gaps.append(f"{label} {spec['kind']} {spec['name']}: {'; '.join(unread) or 'deferrable'}")
            continue
        keys.append(CatalogKey(spec["name"], tuple(spec["keys"]), spec["kind"] != "index", tuple(parts), where,
                               table.types, spec.get("nulls_not_distinct", False)))

    foreign_keys = []
    for spec in rules["foreign_keys"]:
        target = (spec["references"]["schema"], spec["references"]["table"])
        if why := _unenforced_foreign_key(spec, target in tables):
            gaps.append(f"{label} foreign key {spec['name']}: the fake does not enforce it, {why}")
            continue
        foreign_keys.append(StrictForeignKey(spec["name"], tuple(spec["columns"]), target,
                                             tuple(spec["references"]["columns"]), spec["on_delete"], table.types,
                                             tables[target].types))
    covered = {fk.columns for fk in foreign_keys}
    for column in table.columns.values():  # the schema's foreign keys should all be in the catalog
        if column.references and (column.name,) not in covered:
            gaps.append(f"{label} the schema's foreign key on {column.name} is not in the catalog")

    triggers = []
    for spec in rules["triggers"]:
        emulation = fake_triggers.emulation(spec["function"])
        if why := _unrun_trigger(spec, emulation):
            gaps.append(f"{label} trigger {spec['name']}: the fake does not run it, {why}")
            continue
        triggers.append(StrictTrigger(spec["name"], spec["timing"], tuple(spec["events"]), spec["function"], emulation,
                                      tuple(spec["update_of"]) if "update_of" in spec else None,
                                      bool(spec.get("constraint") and spec.get("initially_deferred"))))
    return replace(table, keys=tuple(keys), checks=tuple(checks), foreign_keys=tuple(foreign_keys),
                   triggers=tuple(triggers))


def catalog_gaps() -> list[str]:
    """The rules of app/db/shared_catalog.json the fake cannot enforce, each with the reason; none, today."""
    gaps: list[str] = []
    base = _strict_tables(False)
    for table in base.values():
        if table.schema == "public":
            _with_catalog(table, base, gaps)
    return gaps


def _catalog_rules_default() -> bool:
    """CATALOG_RULES in tests/conftest.py: whether a new fake enforces the shared catalog's rules."""
    conftest = sys.modules.get("tests.conftest")
    return bool(getattr(conftest, "CATALOG_RULES", False))


def _api_error(code: str, message: str, details: str | None = None, hint: str | None = None) -> APIError:
    return APIError({"code": code, "message": message, "details": details, "hint": hint})


# What a stand-in in tests/fake_rpcs raises where the real function raises.
api_error = _api_error


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


@dataclass
class _Field:
    key: str  # the name in the response
    column: str
    path: tuple[tuple[str, str], ...] = ()  # json path: (("->", "a"), ("->>", "b"))
    cast: str | None = None


@dataclass
class _Embed:
    key: str  # alias, else the table name
    table: str
    hint: str | None
    inner: bool
    items: list = field(default_factory=list)


def _parse_select(spec: str) -> list:
    """PostgREST's select: *, columns (alias:, ::cast, ->/->> paths) and embeds (alias:table!hint!inner(...))."""
    items: list = []
    for term in _split_terms(spec or "*"):
        term = term.strip()
        if not term:
            continue
        if term == "*":
            items.append("*")
            continue
        if term.startswith("..."):
            raise AssertionError("the fake does not spread embedded resources (...table)")
        alias, rest = None, term
        if match := re.match(r"(\w+):(?!:)(.*)", term, re.S):
            alias, rest = match.group(1), match.group(2).strip()
        if "(" in rest:
            head, inner = rest.split("(", 1)
            name, *modifiers = head.strip().split("!")
            hints = [m for m in modifiers if m not in ("inner", "left")]
            items.append(_Embed(key=alias or name, table=name, hint=hints[0] if hints else None,
                                inner="inner" in modifiers, items=_parse_select(inner.rsplit(")", 1)[0])))
            continue
        rest, _, cast = rest.partition("::")
        parts = re.split(r"(->>|->)", rest)
        path = tuple(zip(parts[1::2], (part.strip() for part in parts[2::2])))
        column = parts[0].strip()
        items.append(_Field(key=alias or (path[-1][1] if path else column), column=column, path=path,
                            cast=cast.strip() or None))
    return items


def _field_value(row: dict, item: _Field):
    value = row.get(item.column)
    for arrow, key in item.path:
        value = value.get(key) if isinstance(value, dict) else None
        if arrow == "->>" and value is not None and not isinstance(value, str):
            value = json.dumps(value)
    if item.cast == "text" and value is not None and not isinstance(value, str):
        value = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
    return copy.deepcopy(value)


def _logic_leaves(conditions: str) -> list[tuple[str, str, str]]:
    """The (column, op, value) terms of an or_ string, inside and(...) / or(...) groups too."""
    leaves = []
    for term in _split_terms(conditions):
        for prefix in ("and(", "or("):
            if term.startswith(prefix) and term.endswith(")"):
                leaves.extend(_logic_leaves(term[len(prefix):-1]))
                break
        else:
            column, op, value = term.split(".", 2)
            leaves.append((column, op, value))
    return leaves


def _embedded_path(column: str) -> tuple[tuple[str, ...], str]:
    """"rel.col" -> (("rel",), "col"); a json path such as "metadata->>a" stays a top-level column."""
    base = column.split("->", 1)[0]
    if "." not in base:
        return (), column
    *path, name = base.split(".")
    return tuple(path), name + column[len(base):]


def _sorted(pairs: list[tuple[dict, dict]], orders: list[tuple[str, bool, bool | None]]) -> list:
    """pairs of (row, response) in Postgres order: ASC puts nulls last, DESC first, unless told."""
    for column, desc, nullsfirst in reversed(orders):
        nulls_first = desc if nullsfirst is None else nullsfirst
        null_rank = (lambda v: v is None) if nulls_first == desc else (lambda v: v is not None)
        pairs.sort(key=lambda pair, c=column, rank=null_rank: (rank(pair[0].get(c)), pair[0].get(c)), reverse=desc)
    return pairs


class StrictSchema:
    """Answer like the shared database's PostgREST rather than accept any table or column.

    Public tables come from app/db/shared_schema.json and the web schema from
    supabase/shared/0001_web_schema.sql. Writes and filters fail as they would
    there:

    - unknown schema -> PGRST106; unknown table -> PGRST205;
    - unknown column in a select (embeds too), filter or order -> 42703;
    - unknown key in an insert or update -> PGRST204;
    - a value outside a Postgres enum, or not a uuid for a uuid column -> 22P02;
    - a missing or null NOT NULL column that has no default -> 23502;
    - a value outside a web CHECK list -> 23514 (web statuses are checked text);
    - a value a primary key, unique constraint or web unique index already
      holds -> 23505 (a partial index compares only the rows its WHERE fits;
      nulls never clash);
    - an inserted or changed foreign key with no row to point at -> 23503;
    - deleting a row that another still points at -> 23503, unless that
      foreign key cascades or sets null, which then happens. The snapshot has
      no ON DELETE rules, so public foreign keys count as NO ACTION;
    - an embed with no relationship -> PGRST200, with several -> PGRST201;
    - an unknown RPC, or unknown or missing parameters -> PGRST202.

    Inserts get the column defaults (gen_random_uuid(), now() and literals),
    web updated_at triggers run, and embeds are resolved from foreign keys.
    As in PostgREST, an embed is one object or null when it follows a foreign
    key to the row it points at, or a foreign key that is the embedded
    table's primary key or a unique constraint (users -> tenant_profiles);
    any other embed is a list.
    now() is 2026-01-01T00:00:00Z for the first request and one second later
    for each next one, so later rows sort later. A column list returns
    exactly those columns.

    stores are the fake's rows by schema and table: a foreign key may point
    into another schema (web.bookings.client_id -> public.users.id).

    With catalog (the shared catalog's rules, app/db/shared_catalog.json), a
    public table also has what the live database enforces by itself:

    - a row its CHECK constraints find false -> 23514 (NULL passes), on
      inserts, updates and seeds;
    - a value its unique constraints or unique indexes already hold -> 23505,
      with partial WHERE predicates and expression keys such as
      (metadata ->> 'key'); nulls never clash. Its unique constraints embed one
      to one, as PostgREST reads them;
    - each foreign key's real ON DELETE rule (cascade, set null, restrict or
      no action) and the multi-column ones;
    - its triggers, emulated in tests/fake_triggers.py: BEFORE ones refuse a
      write before its checks, AFTER ones write once the rows are stored,
      INITIALLY DEFERRED ones run when the request commits. Seeds run none;
    - each request (a table write, or an RPC with all its stand-in's writes)
      is one transaction, undone whole by any error in it (transaction()).
    """

    def __init__(self, stores: dict[str, dict[str, list[dict]]], catalog: bool = False,
                 storage: "FakeStorage | None" = None):
        self.stores = stores
        self.storage = storage  # the FakeStorage a trigger looks objects up in
        self._ticks = itertools.count()
        self._depth = 0  # requests running: a trigger's or a stand-in's writes run inside one
        self._deferred: list[tuple[StrictTable, StrictTrigger, str, dict]] = []  # (table, trigger, event, NEW)
        self.use_catalog(catalog)

    def use_catalog(self, on: bool) -> None:
        """Enforce the shared catalog's rules from now on (on), or the schema's only."""
        self.catalog = on
        self.tables = strict_tables(catalog=on)
        self._referrers: dict[tuple[str, str], list[tuple[StrictTable, StrictColumn]]] = {}
        self._foreign_keys_to: dict[tuple[str, str], list[tuple[StrictTable, StrictForeignKey]]] = {}
        for table in self.tables.values():
            for column in table.columns.values():
                if column.references:
                    self._referrers.setdefault(column.references[:2], []).append((table, column))
            for foreign_key in table.foreign_keys:
                self._foreign_keys_to.setdefault(foreign_key.target, []).append((table, foreign_key))

    def now(self) -> str:
        return (_CLOCK_START + timedelta(seconds=next(self._ticks))).isoformat()

    def _rows(self, table: StrictTable) -> list[dict]:
        """The rows the fake holds for table, without creating its store."""
        return self.stores.get(table.schema, {}).get(table.name, [])

    def table(self, schema: str, name: str) -> StrictTable:
        if schema not in STRICT_SCHEMAS:
            raise _api_error("PGRST106", f"Invalid schema: {schema}")
        table = self.tables.get((schema, name))
        if table is None:
            raise _api_error("PGRST205", f"Could not find the table '{schema}.{name}' in the schema cache")
        return table

    # -- rows -----------------------------------------------------------------
    def _default(self, column: StrictColumn, now: str):
        if column.default is None:
            return None
        kind, value = column.default
        if kind == "now":
            return now
        if kind == "today":
            return now[:10]
        if kind == "uuid":
            return str(uuid.uuid4())
        return copy.deepcopy(value)

    @staticmethod
    def _check_keys(table: StrictTable, payload: dict) -> None:
        for key in payload:
            if key not in table.columns:
                raise _api_error("PGRST204", f"Could not find the '{key}' column of '{table.name}' in the schema cache")

    @staticmethod
    def _check_types(table: StrictTable, values: dict) -> None:
        for name, value in values.items():
            column = table.columns[name]
            if value is None:
                continue
            if column.is_uuid and not _is_uuid(value):
                raise _api_error("22P02", f'invalid input syntax for type uuid: "{value}"')
            if column.enum and value not in column.enum:
                raise _api_error("22P02", f'invalid input value for enum "{column.enum_type}": "{value}"')

    @staticmethod
    def _check_constraints(table: StrictTable, row: dict, names) -> None:
        for name in names:
            column, value = table.columns[name], row.get(name)
            if value is None and column.not_null:
                raise _api_error("23502", f'null value in column "{name}" of relation "{table.name}" '
                                          "violates not-null constraint")
            if value is not None and column.check and value not in column.check:
                raise _api_error("23514", f'new row for relation "{table.name}" violates check constraint '
                                          f'"{table.name}_{name}_check"')

    def _check_catalog(self, table: StrictTable, row: dict) -> None:
        """23514 for a CHECK constraint of the shared catalog that row breaks."""
        for check in table.checks:
            if _evaluated(check.expression, row, table.types, f"{table.name}.{check.name}") is False:
                failing = ", ".join("null" if value is None else fake_sql.to_text(value) for value in row.values())
                raise _api_error("23514", f'new row for relation "{table.name}" violates check constraint '
                                          f'"{check.name}"', f"Failing row contains ({failing}).")

    def _check_row(self, table: StrictTable, row: dict, names) -> None:
        """NOT NULL and the web CHECK lists for the columns named, then every catalog CHECK."""
        self._check_constraints(table, row, names)
        self._check_catalog(table, row)

    def _build(self, table: StrictTable, payload: dict, null_keys=(), now: str | None = None) -> dict:
        """payload as a whole row, defaults filled in, before any constraint is checked."""
        self._check_keys(table, payload)
        given = {**{key: None for key in null_keys}, **payload}
        self._check_types(table, given)
        now = now or self.now()
        return {name: copy.deepcopy(given[name]) if name in given else self._default(column, now)
                for name, column in table.columns.items()}

    def row(self, table: StrictTable, payload: dict, null_keys=(), now: str | None = None) -> dict:
        """payload as the stored row: every column, defaults filled, or the error Postgres raises.

        null_keys are columns a bulk insert names but this row leaves out:
        PostgREST writes null there, not the default (supabase-py's
        default_to_null). now is the statement's time, as now() is in Postgres.
        """
        row = self._build(table, payload, null_keys, now)
        self._check_constraints(table, row, table.columns)
        return row

    def seed(self, schema: str, name: str, rows: list[dict]) -> None:
        """Store rows as the database would hold them, or fail.

        Keys are checked but foreign keys are not, so a test seeds only the
        rows it needs. Inserts and updates check both. With the catalog rules
        the CHECK constraints are checked too, but no trigger runs: seed the
        rows a trigger would have written (a users row's primary
        user_role_assignments row, say) when a test needs them.
        """
        table = self.table(schema, name)
        new = [self.row(table, row) for row in rows]
        for row in new:
            self._check_catalog(table, row)
        store = self.stores.setdefault(schema, {}).setdefault(name, [])
        self._check_unique(table, new, store)
        store.extend(new)

    def conflicts(self, table: StrictTable, payload: dict, now: str) -> bool:
        """Whether inserting payload would repeat a key a row already holds: ON CONFLICT DO NOTHING skips it."""
        row = self._build(table, payload, (), now)
        stored = self._rows(table)
        return any((values := key.values(row)) is not None and any(key.values(other) == values for other in stored)
                   for key in table.keys)

    # -- the catalog's write path: triggers, checks and the request's transaction --
    @contextmanager
    def transaction(self):
        """One PostgREST request, or one statement inside it. With the catalog rules on, all or nothing.

        The outermost one is the request's transaction: its deferred
        constraint triggers run when it ends, as COMMIT runs them, and an error
        anywhere in it (a trigger's, a deferred check's, a stand-in's)
        restores every row as it was before the request. One inside it (a
        trigger's write, a statement of an RPC's stand-in) is a savepoint: an
        error undoes that statement and its queued deferred checks, so a
        stand-in that catches it, as a plpgsql EXCEPTION block does, goes on
        without them. With the rules off it only counts how deep it is.
        """
        if not self.catalog:
            self._depth += 1
            try:
                yield
            finally:
                self._depth -= 1
            return
        saved = {schema: {name: (list(rows), [dict(row) for row in rows]) for name, rows in tables.items()}
                 for schema, tables in self.stores.items()}
        queued, outermost = len(self._deferred), not self._depth
        self._depth += 1
        try:
            yield
            while outermost and self._deferred:
                table, trigger, event, new = self._deferred.pop(0)
                trigger.emulation(TriggerContext(self, table, event, self.now()), None, new)
        except BaseException:
            self._restore(saved)
            del self._deferred[queued:]
            raise
        finally:
            self._depth -= 1
            if outermost:
                self._deferred.clear()

    def run_in_transaction(self, run: Callable):
        """run() as one request (an RPC's stand-in): its writes commit together."""
        with self.transaction():
            return run()

    def _restore(self, saved: dict) -> None:
        """Put back every row as transaction() saved it, in the same row and list objects."""
        for schema, tables in self.stores.items():
            before = saved.get(schema, {})
            for name, rows in tables.items():
                if name not in before:
                    rows.clear()
            for name, (rows, contents) in before.items():
                for row, content in zip(rows, contents):
                    row.clear()
                    row.update(content)
                tables.setdefault(name, [])[:] = rows

    def _fire(self, table: StrictTable, timing: str, event: str, old: dict | None, new: dict | None, now: str,
              changed=()) -> None:
        """Run table's row triggers for timing and event, by name as Postgres orders them."""
        for trigger in table.triggers:
            if not trigger.deferred and trigger.fires(timing, event, changed):
                trigger.emulation(TriggerContext(self, table, event, now), old, new)

    def _defer(self, table: StrictTable, event: str, rows: list[dict], changed=()) -> None:
        """Queue table's deferred constraint triggers for rows, to run when the request commits."""
        for trigger in table.triggers:
            if trigger.deferred and trigger.fires("after", event, changed):
                self._deferred.extend((table, trigger, event, copy.deepcopy(row)) for row in rows)

    def _insert_rows(self, table: StrictTable, rows: list[dict], now: str) -> list[dict]:
        """Store built rows as Postgres inserts them: BEFORE triggers, checks, keys, AFTER triggers."""
        for row in rows:
            self._fire(table, "before", "insert", None, row, now)
        for row in rows:
            self._check_row(table, row, table.columns)
        store = self.stores.setdefault(table.schema, {}).setdefault(table.name, [])
        self._check_unique(table, rows, store)
        self._check_foreign_keys(table, rows)
        store.extend(rows)
        inserted = copy.deepcopy(rows)
        for row in rows:
            self._fire(table, "after", "insert", None, row, now)
        self._defer(table, "insert", rows)
        return inserted

    def _update_rows(self, table: StrictTable, rows: list[dict], changes: dict, now: str) -> list[dict]:
        """Apply changes to stored rows as Postgres updates them, triggers and checks included."""
        pairs = []
        for row in rows:
            new = {**row, **copy.deepcopy(changes)}
            if table.updated_at_trigger:
                new["updated_at"] = now
            pairs.append((row, new))
        for row, new in pairs:
            self._fire(table, "before", "update", row, new, now, changes)
        for _, new in pairs:
            self._check_row(table, new, changes)
        replaced, new_rows = {id(row) for row, _ in pairs}, [new for _, new in pairs]
        self._check_unique(table, new_rows, [row for row in self._rows(table) if id(row) not in replaced])
        self._check_foreign_keys(table, new_rows, [row for row, _ in pairs])
        before = [dict(row) for row, _ in pairs]
        for row, new in pairs:
            row.update(new)
        updated = [copy.deepcopy(row) for row, _ in pairs]
        for old, (row, _) in zip(before, pairs):
            self._fire(table, "after", "update", old, row, now, changes)
        self._defer(table, "update", [row for row, _ in pairs], changes)
        return updated

    def _remove(self, table: StrictTable, rows: list[dict], now: str, pending: list) -> None:
        """Delete rows with their triggers, then apply each ON DELETE rule that points at them.

        cascade deletes the rows pointing at them (their triggers run), set
        null updates those rows' key (their update triggers and NOT NULL
        apply). no action and restrict are checked once the statement is done
        (pending), so a row a cascade removes meanwhile does not count.
        """
        for row in rows:
            self._fire(table, "before", "delete", row, None, now)
        gone = {id(row) for row in rows}
        store = self._rows(table)
        store[:] = [row for row in store if id(row) not in gone]
        for row in rows:
            self._fire(table, "after", "delete", row, None, now)
        for child, foreign_key in self._foreign_keys_to.get((table.schema, table.name), ()):
            keys = {values for row in rows if (values := foreign_key.target_values(row)) is not None}
            children = [row for row in self._rows(child) if foreign_key.values(row) in keys] if keys else []
            if not children:
                continue
            if foreign_key.on_delete == "cascade":
                self._remove(child, children, now, pending)
            elif foreign_key.on_delete == "set null":
                self._update_rows(child, children, {column: None for column in foreign_key.columns}, now)
            else:
                pending.append((table, child, foreign_key, keys))

    def _remove_rows(self, table: StrictTable, rows: list[dict]) -> None:
        if not self.catalog:
            self._delete(table, rows)
            return
        pending: list = []
        self._remove(table, rows, self.now(), pending)
        for parent, child, foreign_key, keys in pending:
            left = [row for row in self._rows(child) if foreign_key.values(row) in keys]
            if left:
                values = ", ".join(map(fake_sql.to_text, foreign_key.values(left[0])))
                raise _api_error(
                    "23503", f'update or delete on table "{parent.name}" violates foreign key constraint '
                             f'"{foreign_key.name}" on table "{child.name}"',
                    f'Key ({", ".join(foreign_key.target_columns)})=({values}) is still referenced from table '
                    f'"{child.name}".')

    def _check_foreign_keys(self, table: StrictTable, rows: list[dict], before: list[dict] | None = None) -> None:
        """23503 when one of rows points at no row; the catalog's foreign keys, multi-column ones too.

        before holds an update's rows as they were: a key the update leaves as
        it was is not checked again.
        """
        if not self.catalog:
            self._check_references(table, rows, before)
            return
        for foreign_key in table.foreign_keys:
            target = self.tables[foreign_key.target]
            present = {foreign_key.target_values(row) for row in self._rows(target)}
            if target is table:  # a row may point at another row of the same statement
                present |= {foreign_key.target_values(row) for row in rows}
            for index, row in enumerate(rows):
                values = foreign_key.values(row)
                if values is None or values in present or (before and foreign_key.values(before[index]) == values):
                    continue
                raise _api_error("23503", f'insert or update on table "{table.name}" violates foreign key '
                                          f'constraint "{foreign_key.name}"',
                                 f'Key ({", ".join(foreign_key.columns)})=({", ".join(map(fake_sql.to_text, values))}) '
                                 f'is not present in table "{target.name}".')

    # -- keys and foreign keys ------------------------------------------------
    @staticmethod
    def _check_unique(table: StrictTable, rows: list[dict], others: list[dict]) -> None:
        """23505 when one of rows repeats a key of others, or of another of rows."""
        for key in table.keys:
            taken = {values for row in others if (values := key.values(row)) is not None}
            for row in rows:
                values = key.values(row)
                if values is None:
                    continue
                if values in taken:
                    raise _api_error("23505", f'duplicate key value violates unique constraint "{key.name}"',
                                     f"Key ({', '.join(key.columns)})=({', '.join(map(str, values))}) already exists.")
                taken.add(values)

    def _check_references(self, table: StrictTable, rows: list[dict], before: list[dict] | None = None) -> None:
        """23503 when one of rows points at a row that is not there.

        before holds an update's rows as they were: as in Postgres, a foreign
        key that the update leaves as it was is not checked again.
        """
        for column in table.columns.values():
            if column.references is None:
                continue
            schema, name, key = column.references
            target = self.tables[(schema, name)]
            present = {row.get(key) for row in self._rows(target)}
            if target is table:  # a row may point at another row of the same statement
                present |= {row.get(key) for row in rows}
            for index, row in enumerate(rows):
                value = row.get(column.name)
                if value is None or value in present or (before and before[index].get(column.name) == value):
                    continue
                raise _api_error("23503", f'insert or update on table "{table.name}" violates foreign key '
                                          f'constraint "{table.name}_{column.name}_fkey"',
                                 f'Key ({column.name})=({value}) is not present in table "{name}".')

    def _delete(self, table: StrictTable, rows: list[dict]) -> None:
        """Remove rows, applying the ON DELETE rule of each foreign key that points at them.

        cascade removes the rows pointing at them as well, and set null clears
        those rows' key (their updated_at trigger runs). With no rule (NO
        ACTION) or restrict, a row still pointing at a removed one fails the
        whole statement with 23503, and nothing is removed.
        """
        removing = {(table.schema, table.name): {id(row): row for row in rows}}  # (schema, table) -> id -> row
        pending = [(table, rows)]
        while pending:  # cascades first: a row they remove no longer points anywhere
            parent, removed = pending.pop()
            for child, column in self._referrers.get((parent.schema, parent.name), ()):
                if column.on_delete != "cascade":
                    continue
                keys = {row.get(column.references[2]) for row in removed}
                gone = removing.get((child.schema, child.name), {})
                more = [row for row in self._rows(child) if row.get(column.name) in keys and id(row) not in gone]
                if more:
                    removing.setdefault((child.schema, child.name), {}).update((id(row), row) for row in more)
                    pending.append((child, more))
        cleared = []  # (table, row, column) that set null clears
        for (schema, name), rows_by_id in removing.items():
            for child, column in self._referrers.get((schema, name), ()):
                if column.on_delete == "cascade":
                    continue
                keys = {row.get(column.references[2]) for row in rows_by_id.values()}
                gone = removing.get((child.schema, child.name), {})
                left = [row for row in self._rows(child) if row.get(column.name) in keys and id(row) not in gone]
                if not left:
                    continue
                if column.on_delete != "set null":
                    raise _api_error(
                        "23503", f'update or delete on table "{name}" violates foreign key constraint '
                                 f'"{child.name}_{column.name}_fkey" on table "{child.name}"',
                        f'Key ({column.references[2]})=({left[0][column.name]}) is still referenced from table '
                        f'"{child.name}".', _PUBLIC_ON_DELETE_HINT if child.schema == "public" else None)
                if column.not_null:
                    raise _api_error("23502", f'null value in column "{column.name}" of relation "{child.name}" '
                                              "violates not-null constraint")
                cleared.extend((child, row, column.name) for row in left)
        for (schema, name), rows_by_id in removing.items():
            tables = self.stores[schema]
            tables[name] = [row for row in tables[name] if id(row) not in rows_by_id]
        now = self.now() if cleared else None
        for child, row, column_name in cleared:
            row[column_name] = None
            if child.updated_at_trigger:
                row["updated_at"] = now

    # -- query checks ---------------------------------------------------------
    def _relationship(self, parent: StrictTable, embed: _Embed):
        """(target table, one-or-many, parent column, target column) for an embed."""
        target = self.tables.get((parent.schema, embed.table))
        if target is None:
            if any(c.references and c.references[1] == embed.table for c in parent.columns.values()):
                raise AssertionError(f"the fake does not embed {embed.table} in {parent.schema}.{parent.name}: "
                                     "its foreign key points at another schema")
            raise _api_error("PGRST200", f"Could not find a relationship between '{parent.name}' and "
                                         f"'{embed.table}' in the schema cache")
        candidates = []  # (kind, parent column, target column, foreign-key column, its table)
        for column in parent.columns.values():
            if column.references and column.references[:2] == (parent.schema, target.name):
                candidates.append(("one", column.name, column.references[2], column.name, parent.name))
        for column in target.columns.values():
            if column.references and column.references[:2] == (parent.schema, parent.name):
                kind = "one" if target.one_to_one((column.name,)) else "many"
                candidates.append((kind, column.references[2], column.name, column.name, target.name))
        if embed.hint:
            candidates = [c for c in candidates if embed.hint in (c[3], f"{c[4]}_{c[3]}_fkey")]
        if not candidates:
            raise _api_error("PGRST200", f"Could not find a relationship between '{parent.name}' and "
                                         f"'{embed.table}' in the schema cache")
        if len(candidates) > 1:
            raise _api_error("PGRST201", f"Could not embed because more than one relationship was found for "
                                         f"'{parent.name}' and '{embed.table}'")
        return (target, *candidates[0][:3])

    def _check_select(self, table: StrictTable, items: list, path: tuple = ()) -> dict:
        """The embeds by path of keys, after checking every column the select names."""
        embeds = {}
        for item in items:
            if isinstance(item, _Field) and item.column not in table.columns:
                raise _api_error("42703", f"column {table.name}.{item.column} does not exist")
            if isinstance(item, _Embed):
                target = self._relationship(table, item)[0]
                embeds[path + (item.key,)] = target
                embeds.update(self._check_select(target, item.items, path + (item.key,)))
        return embeds

    def _check_filter(self, table: StrictTable, column: str, op: str, value) -> None:
        base = column.split("->", 1)[0]
        spec = table.columns.get(base)
        if spec is None:
            raise _api_error("42703", f"column {table.name}.{base} does not exist")
        if "->" in column or op in ("is", "ilike"):
            return  # json text, null / true / false, or a pattern
        for item in value if op == "in" else [value]:
            if spec.is_uuid and not _is_uuid(item):
                raise _api_error("22P02", f'invalid input syntax for type uuid: "{item}"')
            if spec.enum and item not in spec.enum:
                raise _api_error("22P02", f'invalid input value for enum "{spec.enum_type}": "{item}"')

    def _filters(self, query: "FakeTableQuery", table: StrictTable, embeds: dict):
        """Checks for the rows themselves, and for embedded rows by path."""
        top, nested = [], {}
        for op, column, value in query._filter_specs:
            if op == "or":
                for leaf_column, leaf_op, leaf_value in _logic_leaves(value):
                    if leaf_op not in LOGIC_OPERATORS:
                        raise AssertionError(
                            f"the fake's or_ evaluates {', '.join(LOGIC_OPERATORS)} only, not {leaf_op}"
                        )
                    self._check_filter(table, leaf_column, leaf_op, leaf_value)
                top.append(_predicate(op, column, value))
                continue
            path, name = _embedded_path(column)
            target = embeds.get(path, table if not path else None)
            if target is None:
                raise _api_error("PGRST108", f"'{'.'.join(path)}' is not an embedded resource in this request")
            self._check_filter(target, name, op, value)
            (nested.setdefault(path, []) if path else top).append(_predicate(op, name, value))
        return top, nested

    def _orders(self, query: "FakeTableQuery", table: StrictTable, embeds: dict) -> dict:
        orders: dict[tuple, list] = {}
        for column, desc, nullsfirst, foreign_table in query._order_specs:
            path = tuple(foreign_table.split(".")) if foreign_table else ()
            target = embeds.get(path, table if not path else None)
            if target is None:
                raise _api_error("PGRST108", f"'{foreign_table}' is not an embedded resource in this request")
            if column.split("->", 1)[0] not in target.columns:
                raise _api_error("42703", f"column {target.name}.{column} does not exist")
            orders.setdefault(path, []).append((column, desc, nullsfirst))
        for foreign_table in query._embed_pages:
            if tuple(foreign_table.split(".")) not in embeds:
                raise _api_error("PGRST108", f"'{foreign_table}' is not an embedded resource in this request")
        return orders

    # -- execution --------------------------------------------------------------
    def _insert(self, table: StrictTable, store: list[dict], query: "FakeTableQuery") -> list[dict]:
        bulk = isinstance(query._payload, list)
        payloads = query._payload if bulk else [query._payload]
        named = set().union(*payloads) if bulk and query._default_to_null else set()
        now = self.now()
        if self.catalog:
            return self._insert_rows(table, [self._build(table, payload, named - set(payload), now)
                                             for payload in payloads], now)
        rows = [self.row(table, payload, named - set(payload), now) for payload in payloads]
        self._check_unique(table, rows, store)
        self._check_references(table, rows)
        store.extend(rows)
        return copy.deepcopy(rows)

    def _update(self, table: StrictTable, store: list[dict], matched: list[dict], changes: dict) -> list[dict]:
        self._check_keys(table, changes)
        self._check_types(table, changes)
        if self.catalog:
            return self._update_rows(table, matched, changes, self.now())
        updated, now = [], self.now()
        for row in matched:
            new = {**row, **copy.deepcopy(changes)}
            if table.updated_at_trigger:
                new["updated_at"] = now
            self._check_constraints(table, new, changes)
            updated.append((row, new))
        replaced, new_rows = {id(row) for row, _ in updated}, [new for _, new in updated]
        self._check_unique(table, new_rows, [row for row in store if id(row) not in replaced])
        self._check_references(table, new_rows, [row for row, _ in updated])
        for row, new in updated:
            row.update(new)
        return [copy.deepcopy(new) for _, new in updated]

    def execute(self, query: "FakeTableQuery") -> FakeResult:
        table = self.table(query._schema, query._name)
        store = query._tables.setdefault(query._name, [])
        items = _parse_select(query._select) if query._op == "select" else ["*"]
        embeds = self._check_select(table, items)
        top, nested = self._filters(query, table, embeds)
        orders = self._orders(query, table, embeds)

        if query._op == "insert":
            with self.transaction():
                return FakeResult(self._insert(table, store, query))

        matched = [row for row in store if all(check(row) for check in top)]
        if query._op == "update":
            with self.transaction():
                return FakeResult(self._update(table, store, matched, query._payload))

        if query._op == "delete":
            with self.transaction():
                self._remove_rows(table, matched)
            return FakeResult(copy.deepcopy(matched))

        pairs = self._resolve(query, table, matched, items, (), nested, orders)
        count = len(pairs) if query._count else None
        pairs = _sorted(pairs, orders.get((), []))
        if query._range is not None:
            pairs = pairs[query._range[0]:query._range[1] + 1]
        if query._limit is not None:
            pairs = pairs[:query._limit]
        return FakeResult([] if query._head else [response for _, response in pairs], count=count)

    def _resolve(self, query, table: StrictTable, rows: list, items: list, path: tuple,
                 nested: dict, orders: dict) -> list[tuple[dict, dict]]:
        """(row, response) pairs, leaving out rows an !inner embed found nothing for."""
        pairs = []
        for row in rows:
            response, keep = {}, True
            for item in items:
                if item == "*":
                    response.update({name: copy.deepcopy(row.get(name)) for name in table.columns})
                elif isinstance(item, _Field):
                    response[item.key] = _field_value(row, item)
                else:
                    value = self._embedded(query, table, row, item, path + (item.key,), nested, orders)
                    keep = keep and not (item.inner and not value)
                    response[item.key] = value
            if keep:
                pairs.append((row, response))
        return pairs

    def _embedded(self, query, parent: StrictTable, row: dict, embed: _Embed, path: tuple,
                  nested: dict, orders: dict):
        target, kind, parent_column, target_column = self._relationship(parent, embed)
        key = row.get(parent_column)
        related = [r for r in query._tables.get(target.name, [])
                   if key is not None and r.get(target_column) == key
                   and all(check(r) for check in nested.get(path, []))]
        pairs = _sorted(self._resolve(query, target, related, embed.items, path, nested, orders),
                        orders.get(path, []))
        if (page := query._embed_pages.get(".".join(path))) is not None:
            pairs = pairs[page[0]:page[0] + page[1]]
        responses = [response for _, response in pairs]
        if kind == "one":
            return responses[0] if responses else None
        return responses

    # -- rpc ----------------------------------------------------------------------
    def check_rpc(self, schema: str, name: str, params: dict) -> None:
        if schema not in STRICT_SCHEMAS:
            raise _api_error("PGRST106", f"Invalid schema: {schema}")
        from app.db.schema import snapshot

        rpc = snapshot()["rpcs"].get(name) if schema == "public" else None
        given = set(params)
        if rpc is None or given - set(rpc["params"]) or {
            param for param, spec in rpc["params"].items() if spec["required"]
        } - given:
            raise _api_error("PGRST202", f"Could not find the function {schema}.{name}({', '.join(sorted(given))}) "
                                         "in the schema cache")
        for param, value in params.items():
            if rpc["params"][param]["format"] == "uuid" and value is not None and not _is_uuid(value):
                raise _api_error("22P02", f'invalid input syntax for type uuid: "{value}"')


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class FakeAuthAdmin:
    def __init__(self, root: "FakeSupabase"):
        self._root = root

    def create_user(self, attrs: dict):
        email = attrs["email"]
        if any(u["email"] == email for u in self._root.users):
            raise Exception("A user with this email address has already been registered")
        user = {
            "id": str(uuid.uuid4()),
            "email": email,
            "password": attrs.get("password"),
            "user_metadata": attrs.get("user_metadata", {}),
        }
        # Nothing shows that the shared project makes a users row for a new
        # auth user (migration plan, appendix A2), so the fake makes none.
        self._root.users.append(user)
        return SimpleNamespace(user=SimpleNamespace(id=user["id"], email=email))

    def get_user_by_id(self, user_id: str):
        for user in self._root.users:
            if user["id"] == user_id:
                return SimpleNamespace(user=SimpleNamespace(id=user_id, email=user["email"]))
        raise Exception("User not found")


class FakeAuth:
    def __init__(self, root: "FakeSupabase"):
        self._root = root
        self.admin = FakeAuthAdmin(root)

    def get_user(self, token: str):
        user_id = self._root.tokens.get(token)
        if user_id is None:
            raise Exception("Invalid JWT")
        return SimpleNamespace(user=SimpleNamespace(id=user_id))

    def sign_in_with_password(self, credentials: dict):
        for user in self._root.users:
            if user["email"] == credentials["email"] and user["password"] == credentials["password"]:
                token = f"token-{user['id']}"
                self._root.tokens[token] = user["id"]
                session = SimpleNamespace(
                    access_token=token,
                    refresh_token=f"refresh-{user['id']}",
                    expires_at=4102444800,
                )
                # Like gotrue, the signed-in user carries the metadata its owner set.
                return SimpleNamespace(
                    user=SimpleNamespace(id=user["id"], email=user["email"], user_metadata=user["user_metadata"]),
                    session=session,
                )
        raise Exception("Invalid login credentials")


class FakePostgrest:
    def __init__(self):
        self.auth_tokens: list[str] = []  # user JWTs attached, as user_client() does

    def auth(self, token: str):
        self.auth_tokens.append(token)
        return self


class FakeRpcQuery:
    def __init__(self, data=None, error: APIError | None = None, run=None):
        self._data = data if data is not None else []
        self._error = error
        self._run = run  # a stand-in's call, made on execute() as PostgREST runs it then

    def execute(self) -> FakeResult:
        if self._error is not None:
            raise self._error
        if self._run is not None:
            return FakeResult(copy.deepcopy(self._run()))
        return FakeResult(copy.deepcopy(self._data))


class RpcContext:
    """What a tests/fake_rpcs stand-in sees of its call: the database and the caller.

    caller is the users row public.current_app_user_id() returns for the
    caller's JWT (an ACTIVE, undeleted row whose auth_user_id is the token's
    user), or None for the service role and for unknown or inactive users.
    """

    def __init__(self, db: "FakeSupabase", token: str | None):
        self.db = db
        self.token = token
        self.auth_uid = db.tokens.get(token) if token else None

    @property
    def caller(self) -> dict | None:
        if self.auth_uid is None:
            return None
        for row in self.db.tables.get("users", []):
            if row.get("auth_user_id") == self.auth_uid and row.get("status") == "ACTIVE" and row.get("deleted_at") is None:
                return row
        return None

    def table(self, name: str, schema: str = "public") -> "FakeTableQuery":
        """A strict query on one table, as the function's own SQL would run it."""
        return self.db.schema(schema).table(name) if schema != "public" else self.db.table(name)

    def rows(self, name: str, schema: str = "public") -> list[dict]:
        """The stored rows of a table, for reads; write through table() so the strict checks apply."""
        return self.db.schema_tables.get(schema, {}).get(name, [])

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat()


class TriggerContext:
    """What a tests/fake_triggers emulation sees of its firing: the database inside the request.

    event is TG_OP in lower case ("insert", "update", "delete") and
    table_name TG_TABLE_NAME; now is the statement's now(). rows() reads a
    public table as it stands; table() and insert() write through the strict
    checks, so a trigger's own writes are checked and fire their triggers too.
    """

    def __init__(self, strict: StrictSchema, table: StrictTable, event: str, now: str):
        self._strict = strict
        self.table_name = table.name
        self.event = event
        self.now = now

    def rows(self, name: str) -> list[dict]:
        return self._strict.stores.get("public", {}).get(name, [])

    def table(self, name: str) -> FakeTableQuery:
        return FakeTableQuery(self._strict.stores.setdefault("public", {}), name, "public", self._strict)

    def insert(self, name: str, row: dict, *, on_conflict_do_nothing: bool = False) -> dict | None:
        """INSERT INTO name: the stored row, or None when ON CONFLICT DO NOTHING met a key already held."""
        if on_conflict_do_nothing and self._strict.conflicts(self._strict.table("public", name), row, self.now):
            return None
        return self.table(name).insert(row).execute().data[0]

    def typed(self, name: str, column: str, value):
        """value as the column's type holds it, to compare it as Postgres does (fake_sql.to_type)."""
        return _typed(value, self._strict.table("public", name).columns[column].sql_type)

    def stored(self, bucket: str, path: str) -> bool:
        """Whether Storage holds the object: a storage.objects row with that bucket_id and name."""
        storage = self._strict.storage
        return storage is not None and (bucket, path) in storage.objects


class FakeClientPostgrest:
    """A client's PostgREST: the token user_client() attaches stays on that client."""

    def __init__(self, root: "FakeSupabase"):
        self._root = root
        self.token: str | None = None

    def auth(self, token: str):
        self.token = token
        self._root.postgrest.auth_tokens.append(token)  # every token any client attached, in order
        return self


class FakeClient:
    """One supabase-py client over the shared fake database, as create_client() returns."""

    def __init__(self, root: "FakeSupabase"):
        self._root = root
        self.postgrest = FakeClientPostgrest(root)
        self.auth = root.auth
        self.storage = root.storage

    def __getattr__(self, name: str):
        # Everything else (seed, tables, users, test helpers) is the shared database's.
        return getattr(self._root, name)

    def table(self, name: str) -> "FakeTableQuery":
        return self._root.table(name)

    from_ = table

    def schema(self, name: str) -> "FakeSchema":
        return FakeSchema(self._root, name, client=self)

    def rpc(self, name: str, params: dict | None = None) -> FakeRpcQuery:
        replaced = self._root.__dict__.get("rpc")
        if replaced is not None:  # a test monkeypatched the database's rpc(): every client answers with it
            return replaced(name, params)
        return self._root._rpc("public", name, params, token=self.postgrest.token)


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
class FakeBucket:
    def __init__(self, storage: "FakeStorage", bucket: str):
        self._storage = storage
        self._bucket = bucket

    def upload(self, path, data, _options):
        self._storage.objects[(self._bucket, path)] = data

    def remove(self, paths):
        """Like Storage, removing an object that is not there is not an error."""
        return [{"name": path} for path in paths if self._storage.objects.pop((self._bucket, path), None) is not None]

    def create_signed_url(self, path, expires_in):
        url = self._sign(path, expires_in)
        return {"signedURL": url, "signedUrl": url}

    def create_signed_urls(self, paths, expires_in):
        """Like Storage, a missing object comes back as an error, not a URL."""
        items = []
        for path in paths:
            if (self._bucket, path) in self._storage.objects:
                url = self._sign(path, expires_in)
                items.append({"error": None, "path": path, "signedURL": url, "signedUrl": url})
            else:
                items.append({"error": "Either the object does not exist or you do not have access to it",
                              "path": path, "signedURL": None, "signedUrl": None})
        return items

    def _sign(self, path, expires_in):
        self._storage.signatures.append((self._bucket, path, expires_in))
        return self._storage.signed_url(self._bucket, path)


class FakeStorage:
    """Private buckets whose signed URLs look like Storage's, with a new token each time."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.signatures: list[tuple[str, str, int]] = []  # (bucket, path, expires_in)
        self._tokens = itertools.count(1)

    def from_(self, bucket: str) -> FakeBucket:
        return FakeBucket(self, bucket)

    def signed_url(self, bucket: str, path: str) -> str:
        from app.core.config import settings

        return f"{settings.supabase_url}/storage/v1/object/sign/{bucket}/{quote(path)}?token=t{next(self._tokens)}"


class FakeSchema:
    """client.schema(name): the same fake database, with tables of one Postgres schema."""

    def __init__(self, root: "FakeSupabase", name: str, client: "FakeClient | None" = None):
        self._root = root
        self.name = name
        self._client = client

    def table(self, name: str) -> FakeTableQuery:
        tables = self._root.schema_tables.setdefault(self.name, {})
        return FakeTableQuery(tables, name, self.name, self._root.strict)

    from_ = table

    def rpc(self, name: str, params: dict | None = None) -> FakeRpcQuery:
        token = self._client.postgrest.token if self._client is not None else None
        return self._root._rpc(self.name, name, params, token=token)


class FakeSupabase:
    """The fake database and project. catalog_rules (default: CATALOG_RULES in tests/conftest.py) turns on
    the shared catalog's checks, keys, ON DELETE rules and triggers (StrictSchema)."""

    def __init__(self, catalog_rules: bool | None = None):
        self.tables: dict[str, list[dict]] = {}  # the public schema
        self.schema_tables: dict[str, dict[str, list[dict]]] = {"public": self.tables}
        self.users: list[dict] = []       # fake auth.users
        self.tokens: dict[str, str] = {}  # access token -> user id
        self.auth = FakeAuth(self)
        self.postgrest = FakePostgrest()
        self.storage = FakeStorage()
        self.rpc_results: dict[str, object] = {}  # a fixed answer per RPC; wins over its stand-in
        self.rpc_calls: list[tuple[str, dict]] = []  # (name, params), in call order
        self.rpc_callers: list[tuple[str, str | None]] = []  # (name, auth user id of the caller's JWT or None)
        self.rpc_unhandled: list[str] = []  # RPCs answered [] for want of a fixed answer or a stand-in
        self.strict = StrictSchema(self.schema_tables,
                                   catalog=_catalog_rules_default() if catalog_rules is None else catalog_rules,
                                   storage=self.storage)

    @property
    def catalog_rules(self) -> bool:
        """Whether the shared catalog's rules apply; set it before seeding, as a test's first step."""
        return self.strict.catalog

    @catalog_rules.setter
    def catalog_rules(self, on: bool) -> None:
        self.strict.use_catalog(on)

    def client(self) -> FakeClient:
        """A new client over this database, as supabase-py's create_client() makes."""
        return FakeClient(self)

    def table(self, name: str) -> FakeTableQuery:
        return FakeTableQuery(self.tables, name, "public", self.strict)

    def schema(self, name: str) -> FakeSchema:
        return FakeSchema(self, name)

    def rpc(self, name: str, params: dict | None = None) -> FakeRpcQuery:
        return self._rpc("public", name, params)

    def _rpc(self, schema: str, name: str, params: dict | None, token: str | None = None) -> FakeRpcQuery:
        params = params or {}
        self.rpc_calls.append((name, copy.deepcopy(params)))
        self.rpc_callers.append((name, self.tokens.get(token) if token else None))
        try:
            self.strict.check_rpc(schema, name, params)
        except APIError as exc:
            return FakeRpcQuery(self.rpc_results.get(name, []), exc)  # PostgREST answers when the call runs
        if name in self.rpc_results:
            return FakeRpcQuery(self.rpc_results[name])
        from tests import fake_rpcs

        stand_in = fake_rpcs.handler(name) if schema == "public" else None
        if stand_in is None:
            self.rpc_unhandled.append(name)
            return FakeRpcQuery([])
        context = RpcContext(self, token)

        def run():  # one request: with the catalog rules on, its writes commit together, deferred checks last
            return self.strict.run_in_transaction(lambda: stand_in(context, copy.deepcopy(params)))

        return FakeRpcQuery(run=run)

    # -- test helpers ---------------------------------------------------------
    def seed(self, name: str, rows: list[dict], schema: str = "public") -> None:
        """Store rows as the database would hold them, or fail; foreign keys are not checked (StrictSchema.seed)."""
        self.strict.seed(schema, name, rows)

    def add_auth_user(self, email: str, password: str = "password123", **metadata) -> str:
        """Create an auth user, with no users row (seed one), and return a ready-to-use bearer token."""
        created = self.auth.admin.create_user(
            {"email": email, "password": password, "user_metadata": metadata}
        )
        token = f"token-{created.user.id}"
        self.tokens[token] = created.user.id
        return token
