"""Write app/db/shared_catalog.json from a CSV export of the shared database's catalog.

Run from backend: .venv/bin/python -m scripts.import_shared_catalog ../output/shared-catalog/catalog-2026-10-23.csv
The CSV is what output/sql-to-apply/read_only_catalog.sql returns (kind, name,
detail, definition). This reads it as data only: nothing in it is executed,
and nothing connects to Supabase.

Per public table it keeps the primary key, the CHECK constraints (name and
expression), the unique constraints and unique indexes (their key columns or
expressions and a partial index's WHERE), the foreign keys with their ON
DELETE and ON UPDATE rules, and the triggers (timing, events, UPDATE OF
columns, deferral and function); plus the public enums. Functions, policies,
other indexes and the storage schema's triggers are left out. The CSV's sha256
is stored, so a snapshot made from an older export can be told apart. The
output is sorted, so the same export always gives the same file.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "app" / "db" / "shared_catalog.json"
SCHEMA = "public"
_ACTIONS = ("CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION")
_LEFT_OUT = {"function": "functions", "policy": "policies"}  # catalog rows the snapshot only counts


class CatalogError(ValueError):
    """A catalog row this script cannot read: refresh the script rather than drop the rule."""


def _closing(text: str, start: int) -> int:
    """The index of the bracket that closes the one at start, skipping quoted text."""
    depth, quote = 0, None
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if char == quote:
                quote = None  # a doubled quote closes and reopens: same outcome
        elif char in "'\"":
            quote = char
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
            if depth == 0:
                return index
    raise CatalogError(f"unbalanced brackets in {text!r}")


def _split(text: str) -> list[str]:
    """text split at the commas outside brackets and quotes, each part stripped."""
    parts, depth, quote, start = [], 0, None, 0
    for index, char in enumerate(text):
        if quote:
            if char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(text[start:index].strip())
            start = index + 1
    parts.append(text[start:].strip())
    return [part for part in parts if part]


def _names(text: str) -> list[str]:
    """"a, b" -> ["a", "b"]; a quoted name keeps its case without its quotes."""
    return [name[1:-1].replace('""', '"') if name.startswith('"') else name for name in _split(text)]


def _group(text: str, start: int) -> tuple[str, str]:
    """(inside of the bracket group opening at start, the text after it)."""
    end = _closing(text, start)
    return text[start + 1:end], text[end + 1:]


def _check(definition: str) -> dict:
    match = re.match(r"CHECK \(", definition)
    if not match:
        raise CatalogError(f"not a CHECK constraint: {definition!r}")
    expression, rest = _group(definition, match.end() - 1)
    check = {"expression": expression}
    if "NOT VALID" in rest:
        check["not_valid"] = True  # still checked for every new or changed row
    return check


def _unique(definition: str) -> dict:
    match = re.match(r"(?:UNIQUE|PRIMARY KEY)( NULLS NOT DISTINCT)? \(", definition)
    if not match:
        raise CatalogError(f"not a unique constraint: {definition!r}")
    columns, rest = _group(definition, match.end() - 1)
    key = {"keys": _names(columns)}
    if match.group(1):
        key["nulls_not_distinct"] = True
    if "DEFERRABLE" in rest and "NOT DEFERRABLE" not in rest:
        key["deferrable"] = True
    return key


def _action(rest: str, event: str) -> str:
    match = re.search(rf"ON {event} ({'|'.join(_ACTIONS)})(?: \(([^)]*)\))?", rest)
    if not match:
        return "no action"
    if match.group(2):
        raise CatalogError(f"the fake does not read a column list in ON {event} {match.group(1)}: {rest!r}")
    return match.group(1).lower()


_NAME = r'(?:"[^"]+"|\w+)'
_FOREIGN_KEY = re.compile(rf"FOREIGN KEY \(([^)]*)\) REFERENCES ({_NAME}(?:\.{_NAME})?)\(([^)]*)\)(.*)$")


def _foreign_key(definition: str) -> dict:
    match = _FOREIGN_KEY.match(definition)
    if not match:
        raise CatalogError(f"not a foreign key: {definition!r}")
    columns, target, target_columns, rest = match.groups()
    schema, _, table = target.rpartition(".")
    foreign_key = {
        "columns": _names(columns),
        "references": {"schema": (schema or SCHEMA).strip('"'), "table": table.strip('"'),
                       "columns": _names(target_columns)},
        "on_delete": _action(rest, "DELETE"),
        "on_update": _action(rest, "UPDATE"),
    }
    if "MATCH FULL" in rest:
        foreign_key["match"] = "full"
    if "DEFERRABLE" in rest and "NOT DEFERRABLE" not in rest:
        foreign_key["deferrable"] = True
        foreign_key["initially_deferred"] = "INITIALLY DEFERRED" in rest
    return foreign_key


_ORDERING = re.compile(r"\s+(?:ASC|DESC|NULLS FIRST|NULLS LAST)$")


def _index(definition: str) -> dict | None:
    """A unique index's keys and predicate; None for an index that is not unique."""
    match = re.match(r"CREATE (UNIQUE )?INDEX (\S+) ON (\S+) USING \w+ \(", definition)
    if not match:
        raise CatalogError(f"not an index: {definition!r}")
    if not match.group(1):
        return None
    keys, rest = _group(definition, match.end() - 1)
    parts = []
    for key in _split(keys):
        while (trimmed := _ORDERING.sub("", key)) != key:
            key = trimmed
        parts.append(key[1:-1].replace('""', '"') if re.fullmatch(r'"(?:[^"]|"")+"', key) else key)
    index = {"keys": parts}
    rest = rest.strip()
    if rest.startswith("INCLUDE ("):
        _, rest = _group(rest, len("INCLUDE "))  # covering columns take no part in uniqueness
        rest = rest.strip()
    if rest.startswith("NULLS NOT DISTINCT"):
        index["nulls_not_distinct"] = True
        rest = rest[len("NULLS NOT DISTINCT"):].strip()
    if rest.startswith("WITH ("):
        _, rest = _group(rest, len("WITH "))
        rest = rest.strip()
    if tablespace := re.match(r"TABLESPACE \S+\s*", rest):
        rest = rest[tablespace.end():]
    if rest.startswith("WHERE "):
        index["where"] = rest[len("WHERE "):]
    elif rest:
        raise CatalogError(f"unread end of index {match.group(2)}: {rest!r}")
    return index


_TRIGGER = re.compile(
    r"CREATE (CONSTRAINT )?TRIGGER (\S+) (BEFORE|AFTER|INSTEAD OF) (.+?) ON (\S+)(.*?) FOR EACH (ROW|STATEMENT)"
    r"(?: WHEN \((.*)\))? EXECUTE (?:FUNCTION|PROCEDURE) ([\w.\"]+)\((.*)\)$"
)


def _trigger(definition: str) -> tuple[str, str, dict]:
    match = _TRIGGER.match(definition)
    if not match:
        raise CatalogError(f"not a trigger: {definition!r}")
    constraint, name, timing, events, target, options, level, when, function, arguments = match.groups()
    schema, _, table = target.rpartition(".")
    trigger = {"name": name, "timing": timing.lower(), "events": [], "level": level.lower(), "function": function}
    for event in events.split(" OR "):
        if event.startswith("UPDATE OF "):
            trigger["events"].append("update")
            trigger["update_of"] = _names(event[len("UPDATE OF "):])
        else:
            trigger["events"].append(event.lower())
    if arguments.strip():
        trigger["arguments"] = _split(arguments)
    if when:
        trigger["when"] = when
    if constraint:
        trigger["constraint"] = True
        trigger["deferrable"] = "DEFERRABLE" in options and "NOT DEFERRABLE" not in options
        trigger["initially_deferred"] = "INITIALLY DEFERRED" in options
    return schema or SCHEMA, table, trigger


def _table(tables: dict, name: str) -> dict:
    empty = {"primary_key": None, "checks": [], "unique": [], "foreign_keys": [], "triggers": []}
    return tables.setdefault(name, empty)


def build_catalog(rows: list[dict], source: dict) -> dict:
    """The snapshot of the catalog rows (dicts with kind, name, detail and definition)."""
    tables: dict[str, dict] = {}
    enums: dict[str, list[str]] = {}
    constraint_names: dict[str, set[str]] = {}  # an index that backs a constraint is that constraint
    indexes: list[tuple[str, str, dict]] = []
    skipped: dict[str, int] = {}
    for row in rows:
        kind, name, detail, definition = (row[key] for key in ("kind", "name", "detail", "definition"))
        if kind == "constraint":
            table_name, _, constraint = name.partition(".")
            table = _table(tables, table_name)
            constraint_names.setdefault(table_name, set()).add(constraint)
            if detail == "p":
                table["primary_key"] = {"name": constraint, "columns": _unique(definition)["keys"]}
            elif detail == "u":
                table["unique"].append({"name": constraint, "kind": "constraint", **_unique(definition)})
            elif detail == "c":
                table["checks"].append({"name": constraint, **_check(definition)})
            elif detail == "f":
                table["foreign_keys"].append({"name": constraint, **_foreign_key(definition)})
            elif detail == "t":
                continue  # a constraint trigger: its trigger row holds it
            else:
                raise CatalogError(f"constraint {name} has the unknown kind {detail!r}")
        elif kind == "index":
            table_name, _, index_name = name.partition(".")
            index = _index(definition)
            if index is not None:
                indexes.append((table_name, index_name, index))
        elif kind == "trigger":
            schema, table_name, trigger = _trigger(definition)
            if schema != SCHEMA:
                skipped[f"{schema} triggers"] = skipped.get(f"{schema} triggers", 0) + 1
                continue
            _table(tables, table_name)["triggers"].append(trigger)
        elif kind == "enum":
            enums[name] = definition.split(",") if definition else []
        elif kind in _LEFT_OUT:
            skipped[_LEFT_OUT[kind]] = skipped.get(_LEFT_OUT[kind], 0) + 1
        else:
            raise CatalogError(f"unknown catalog row kind {kind!r} ({name})")
    for table_name, index_name, index in indexes:
        if index_name in constraint_names.get(table_name, ()):
            continue
        _table(tables, table_name)["unique"].append({"name": index_name, "kind": "index", **index})
    for table in tables.values():
        for key in ("checks", "unique", "foreign_keys", "triggers"):
            table[key].sort(key=lambda entry: entry["name"])
    return {
        "generated_by": "scripts/import_shared_catalog.py",
        "source": source,
        "schema": SCHEMA,
        "tables": dict(sorted(tables.items())),
        "enums": dict(sorted(enums.items())),
        "left_out": dict(sorted(skipped.items())),
    }


def read_rows(raw: bytes) -> list[dict]:
    """The CSV's rows; a function's definition runs to thousands of characters."""
    csv.field_size_limit(sys.maxsize)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    missing = {"kind", "name", "detail", "definition"} - set(reader.fieldnames or ())
    if missing:
        raise CatalogError(f"the CSV has no {', '.join(sorted(missing))} column")
    return list(reader)


def render(catalog: dict) -> str:
    """The snapshot as JSON with one line per rule, so a new export diffs readably."""

    def line(value) -> str:
        return json.dumps(value, ensure_ascii=False)

    out = ["{"]
    for key in ("generated_by", "source", "schema"):
        out.append(f"  {line(key)}: {line(catalog[key])},")
    out.append('  "tables": {')
    tables = list(catalog["tables"].items())
    for index, (name, table) in enumerate(tables):
        out.append(f"    {line(name)}: {{")
        out.append(f'      "primary_key": {line(table["primary_key"])},')
        sections = ("checks", "unique", "foreign_keys", "triggers")
        for section_index, section in enumerate(sections):
            comma = "," if section_index < len(sections) - 1 else ""
            entries = table[section]
            if not entries:
                out.append(f"      {line(section)}: []{comma}")
                continue
            out.append(f"      {line(section)}: [")
            out.extend(f"        {line(entry)}{',' if i < len(entries) - 1 else ''}" for i, entry in enumerate(entries))
            out.append(f"      ]{comma}")
        out.append("    }" + ("," if index < len(tables) - 1 else ""))
    out.append("  },")
    out.append('  "enums": {')
    enums = list(catalog["enums"].items())
    out.extend(f"    {line(name)}: {line(labels)}{',' if i < len(enums) - 1 else ''}"
               for i, (name, labels) in enumerate(enums))
    out.append("  },")
    out.append(f'  "left_out": {line(catalog["left_out"])}')
    out.append("}")
    return "\n".join(out) + "\n"


def catalog_file(csv_path: Path) -> dict:
    raw = csv_path.read_bytes()
    source = {"file": csv_path.name, "sha256": hashlib.sha256(raw).hexdigest()}
    return build_catalog(read_rows(raw), source)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", type=Path, help="CSV export of read_only_catalog.sql (kind, name, detail, definition)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help=f"Where to write the snapshot (default {DEFAULT_OUT})")
    args = parser.parse_args(argv)
    catalog = catalog_file(args.csv)
    args.out.write_text(render(catalog), encoding="utf-8")
    counts = {key: sum(len(table[key]) for table in catalog["tables"].values())
              for key in ("checks", "unique", "foreign_keys", "triggers")}
    print(f"Wrote {args.out}: {len(catalog['tables'])} tables, {counts['checks']} checks, "
          f"{counts['unique']} unique keys, {counts['foreign_keys']} foreign keys, {counts['triggers']} triggers, "
          f"{len(catalog['enums'])} enums")


if __name__ == "__main__":
    main()
