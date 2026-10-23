"""Read the web schema from supabase/shared/*.sql, the one place it is defined.

The strict fake (tests/fake_supabase.py) builds its web tables from the
files that create them (SCHEMA_FILES: 0001_web_schema.sql, then
0004_scorecards.sql, 0005_listing_views.sql and 0006_housing_portal.sql), and
the migration tests read every file. This reads the statements those files
use (create table, create index, triggers, RLS and insert ... values), not
SQL in general.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

SHARED_SQL_DIR = Path(__file__).resolve().parents[2] / "supabase" / "shared"
WEB_SCHEMA_SQL = SHARED_SQL_DIR / "0001_web_schema.sql"
WEB_SEED_SQL = SHARED_SQL_DIR / "0002_web_seed.sql"
SCORECARDS_SQL = SHARED_SQL_DIR / "0004_scorecards.sql"
LISTING_VIEWS_SQL = SHARED_SQL_DIR / "0005_listing_views.sql"
HOUSING_PORTAL_SQL = SHARED_SQL_DIR / "0006_housing_portal.sql"
# The files that create web tables, in the order they are applied (README.md).
SCHEMA_FILES = (WEB_SCHEMA_SQL, SCORECARDS_SQL, LISTING_VIEWS_SQL, HOUSING_PORTAL_SQL)

# Words that end a column's type or default expression.
_CONSTRAINT_WORDS = {"not", "null", "default", "primary", "references", "check", "unique", "constraint"}
_WORD = re.compile(r"[^\s'(),]+")


@dataclass
class SqlColumn:
    name: str
    type: str  # as written, lower case: "uuid", "numeric(10,2)", "text[]"
    not_null: bool = False
    default: str | None = None  # the expression as written: "now()", "'draft'", "'{}'::jsonb"
    references: tuple[str, str, str] | None = None  # (schema, table, column)
    on_delete: str | None = None
    allowed: tuple[str, ...] | None = None  # the values of a "check (column in (...))"


@dataclass
class SqlIndex:
    name: str
    columns: tuple[str, ...]
    unique: bool
    where: str | None


@dataclass
class SqlTable:
    schema: str
    name: str
    columns: dict[str, SqlColumn]
    primary_key: tuple[str, ...] = ()
    unique: list[tuple[str, ...]] = field(default_factory=list)  # primary key and unique constraints
    indexes: list[SqlIndex] = field(default_factory=list)
    updated_at_trigger: bool = False
    row_level_security: bool = False


def strip_comments(sql: str) -> str:
    """sql without its -- comments, leaving quoted text alone."""
    out, quoted, index = [], False, 0
    while index < len(sql):
        char = sql[index]
        if char == "'":
            quoted = not quoted  # an escaped '' toggles twice
        elif not quoted and sql.startswith("--", index):
            end = sql.find("\n", index)
            index = len(sql) if end < 0 else end
            continue
        out.append(char)
        index += 1
    return "".join(out)


def _closing(text: str, start: int) -> int:
    """The index of the bracket that closes the one at start."""
    depth, quoted = 0, False
    for index in range(start, len(text)):
        char = text[index]
        if char == "'":
            quoted = not quoted
        elif not quoted and char in "([":
            depth += 1
        elif not quoted and char in ")]":
            depth -= 1
            if depth == 0:
                return index
    raise ValueError(f"unbalanced brackets from {text[start:start + 40]!r}")


def split_top_level(text: str) -> list[str]:
    """text split at the commas outside brackets and quotes."""
    parts, depth, quoted, start = [], 0, False, 0
    for index, char in enumerate(text):
        if char == "'":
            quoted = not quoted
        elif quoted:
            continue
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(text[start:index])
            start = index + 1
    parts.append(text[start:])
    return [part.strip() for part in parts if part.strip()]


def _tokens(text: str) -> list[str]:
    """Words, quoted strings and whole (...) groups."""
    tokens, index = [], 0
    while index < len(text):
        char = text[index]
        if char.isspace() or char == ",":
            index += 1
        elif char == "'":
            end = index + 1
            while True:
                end = text.index("'", end)
                if text.startswith("''", end):
                    end += 2
                    continue
                break
            tokens.append(text[index:end + 1])
            index = end + 1
        elif char == "(":
            end = _closing(text, index)
            tokens.append(text[index:end + 1])
            index = end + 1
        else:
            match = _WORD.match(text, index)
            tokens.append(match.group())
            index = match.end()
    return tokens


def _joined(tokens: list[str]) -> str:
    """Tokens back as text: "gen_random_uuid" "()" -> "gen_random_uuid()"."""
    text = ""
    for token in tokens:
        glued = token.startswith(("(", "::", "[")) or not text
        text += token if glued else " " + token
    return text


def _in_list(check: str) -> tuple[str, tuple[str, ...]] | None:
    """("status", values) for a check "(status in ('a','b'))"; None for any other check."""
    match = re.fullmatch(r"\(\s*(\w+)\s+in\s*\((.*)\)\s*\)", check, re.S | re.I)
    if not match:
        return None
    return match.group(1), tuple(re.findall(r"'((?:[^']|'')*)'", match.group(2)))


def _column(definition: str, table: SqlTable) -> SqlColumn:
    tokens = _tokens(definition)
    column_type = tokens[1].lower()
    rest = tokens[2:]
    if rest and rest[0].startswith("("):  # numeric(10,2)
        column_type += rest.pop(0)
    column = SqlColumn(name=tokens[0], type=column_type)
    while rest:
        word = rest.pop(0).lower()
        if word == "not":
            rest.pop(0)  # null
            column.not_null = True
        elif word == "primary":
            rest.pop(0)  # key
            column.not_null = True
            table.primary_key = (column.name,)
            table.unique.append((column.name,))
        elif word == "unique":
            table.unique.append((column.name,))
        elif word == "default":
            expression = []
            while rest and rest[0].lower() not in _CONSTRAINT_WORDS:
                expression.append(rest.pop(0))
            column.default = _joined(expression)
        elif word == "references":
            target, columns = rest.pop(0), rest.pop(0)
            schema, name = target.split(".")
            column.references = (schema, name, columns.strip("()").strip())
            if len(rest) >= 2 and [w.lower() for w in rest[:2]] == ["on", "delete"]:
                del rest[:2]
                action = [rest.pop(0).lower()]
                if action[0] in ("set", "no"):
                    action.append(rest.pop(0).lower())
                column.on_delete = " ".join(action)
        elif word == "check":
            in_list = _in_list(rest.pop(0))
            if in_list:
                column.allowed = in_list[1]
    return column


def _table_constraint(definition: str, table: SqlTable) -> None:
    tokens = _tokens(definition)
    word = tokens[0].lower()
    if word == "unique":
        table.unique.append(tuple(c.strip() for c in tokens[1].strip("()").split(",")))
    elif word == "primary":
        names = tuple(c.strip() for c in tokens[2].strip("()").split(","))
        table.primary_key = names
        table.unique.append(names)
        for name in names:
            table.columns[name].not_null = True
    elif word == "check":
        in_list = _in_list(tokens[1])
        if in_list:
            table.columns[in_list[0]].allowed = in_list[1]


def parse_tables(sql: str) -> dict[str, SqlTable]:
    """Every "create table if not exists schema.name (...)" in sql, by table name."""
    sql = strip_comments(sql)
    tables: dict[str, SqlTable] = {}
    for match in re.finditer(r"create table if not exists (\w+)\.(\w+)\s*\(", sql, re.I):
        body = sql[match.end():_closing(sql, match.end() - 1)]
        table = SqlTable(schema=match.group(1), name=match.group(2), columns={})
        for definition in split_top_level(body):
            if definition.split()[0].lower() in ("unique", "primary", "check", "constraint", "foreign"):
                _table_constraint(definition, table)
            else:
                column = _column(definition, table)
                table.columns[column.name] = column
        tables[table.name] = table

    index_pattern = (r"create (unique )?index if not exists (\w+)\s+on (\w+)\.(\w+)\s*\(([^)]*)\)"
                     r"(?:\s+where\s+([^;]+))?;")
    for match in re.finditer(index_pattern, sql, re.I):
        unique, name, _schema, table, columns, where = match.groups()
        tables[table].indexes.append(SqlIndex(
            name=name,
            columns=tuple(c.strip() for c in columns.split(",")),
            unique=bool(unique),
            where=" ".join(where.split()) if where else None,
        ))
    trigger = r"create trigger \w+ before update on (\w+)\.(\w+)\s+for each row execute function \w+\.set_updated_at\(\)"
    for match in re.finditer(trigger, sql, re.I):
        tables[match.group(2)].updated_at_trigger = True
    for match in re.finditer(r"alter table (\w+)\.(\w+)\s+enable row level security", sql, re.I):
        tables[match.group(2)].row_level_security = True
    return tables


@lru_cache
def web_tables() -> dict[str, SqlTable]:
    """Every web table as SCHEMA_FILES leave it, applied in order: a later file may index an earlier one's tables."""
    return parse_tables("\n".join(path.read_text(encoding="utf-8") for path in SCHEMA_FILES))


def _literal(text: str):
    lowered = text.lower()
    if lowered == "null":
        return None
    if lowered in ("true", "false"):
        return lowered == "true"
    if text.startswith("'"):
        return text[1:-1].replace("''", "'")
    if lowered.startswith("array["):
        return [_literal(item) for item in split_top_level(text[len("array["):-1])]
    return float(text) if "." in text else int(text)


@dataclass
class SqlInsert:
    table: str
    rows: list[dict]
    on_conflict: tuple[str, ...] | None  # the conflict target of "on conflict (...) do nothing"


def parse_inserts(sql: str, tables: set[str] | None = None) -> list[SqlInsert]:
    """Every "insert into schema.table (columns) values (...), ... [on conflict ...];" in sql.

    Values must be literals; tables limits the inserts read to those tables.
    """
    sql = strip_comments(sql)
    inserts = []
    for match in re.finditer(r"insert into (\w+)\.(\w+)\s*\(([^)]*)\)\s*values\s*", sql, re.I):
        if tables is not None and match.group(2) not in tables:
            continue
        columns = [c.strip() for c in match.group(3).split(",")]
        rows, index = [], match.end()
        while sql[index] == "(":
            end = _closing(sql, index)
            values = [_literal(value) for value in split_top_level(sql[index + 1:end])]
            rows.append(dict(zip(columns, values, strict=True)))
            index = end + 1
            while sql[index] in " \n\t,":
                index += 1
        conflict = re.match(r"on conflict\s*(\(([^)]*)\))?\s*do nothing\s*;", sql[index:], re.I)
        target = None
        if conflict and conflict.group(2):
            target = tuple(c.strip() for c in conflict.group(2).split(","))
        inserts.append(SqlInsert(table=match.group(2), rows=rows, on_conflict=target))
    return inserts
