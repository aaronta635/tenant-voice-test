"""Write app/db/shared_schema.json from a PostgREST OpenAPI export of the shared database.

Run from backend: .venv/bin/python -m scripts.snapshot_shared_schema ../output/shared-schema-openapi.json
It reads only the file it is given and never connects to Supabase. The export
is the JSON that GET {SUPABASE_URL}/rest/v1/ returns to the service role.

Per column it keeps the Postgres type (format), the JSON type, enum values,
NOT NULL (the export's "required"), the default and the foreign key target;
per RPC, the parameters and whether each is required. The export's sha256 is
stored too, so a snapshot made from an older export can be told apart.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "app" / "db" / "shared_schema.json"

_FK = re.compile(r"<fk table='([^']+)' column='([^']+)'/>")


def _column(prop: dict, required: bool) -> dict:
    column = {"format": prop.get("format")}
    if "type" in prop:  # json and jsonb columns have no JSON type
        column["type"] = prop["type"]
    if "enum" in prop:
        column["enum"] = prop["enum"]
    column["not_null"] = required
    column["has_default"] = "default" in prop
    if "default" in prop:
        column["default"] = prop["default"]
    if "maxLength" in prop:
        column["max_length"] = prop["maxLength"]
    note = prop.get("description") or ""
    if "<pk/>" in note:
        column["primary_key"] = True
    if fk := _FK.search(note):
        column["references"] = {"table": fk.group(1), "column": fk.group(2)}
    return column


def _table(definition: dict, path: dict | None) -> dict:
    required = set(definition.get("required", []))
    table = {
        "columns": {
            name: _column(prop, name in required) for name, prop in definition.get("properties", {}).items()
        }
    }
    if path is not None and "post" not in path:
        table["read_only"] = True  # a view PostgREST cannot insert into
    return table


def _rpc(path: dict) -> dict:
    body = next((p for p in path["post"].get("parameters", []) if p.get("in") == "body"), {})
    schema = body.get("schema", {})
    required = set(schema.get("required", []))
    params = {}
    for name, prop in schema.get("properties", {}).items():
        param = {"format": prop.get("format")}
        if "type" in prop:
            param["type"] = prop["type"]
        param["required"] = name in required
        params[name] = param
    return {"methods": sorted(path), "params": params}


def build_snapshot(openapi: dict, sha256: str) -> dict:
    paths = openapi.get("paths", {})
    tables = {
        name: _table(definition, paths.get(f"/{name}"))
        for name, definition in sorted(openapi.get("definitions", {}).items())
    }
    rpcs = {
        path[len("/rpc/"):]: _rpc(spec)
        for path, spec in sorted(paths.items())
        if path.startswith("/rpc/") and "post" in spec
    }
    info = openapi.get("info", {})
    return {
        "generated_by": "scripts/snapshot_shared_schema.py",
        "source": {"sha256": sha256, "title": info.get("title"), "version": info.get("version")},
        "schema": "public",
        "tables": tables,
        "rpcs": rpcs,
    }


def render(snapshot: dict) -> str:
    """The snapshot as JSON with one line per column and per RPC, so a new export diffs readably."""

    def line(value) -> str:
        return json.dumps(value, ensure_ascii=False)

    out = ["{"]
    for key in ("generated_by", "source", "schema"):
        out.append(f"  {line(key)}: {line(snapshot[key])},")
    out.append('  "tables": {')
    tables = list(snapshot["tables"].items())
    for index, (name, table) in enumerate(tables):
        out.append(f"    {line(name)}: {{")
        if table.get("read_only"):
            out.append('      "read_only": true,')
        out.append('      "columns": {')
        columns = list(table["columns"].items())
        for column_index, (column, spec) in enumerate(columns):
            comma = "," if column_index < len(columns) - 1 else ""
            out.append(f"        {line(column)}: {line(spec)}{comma}")
        out.append("      }")
        out.append("    }" + ("," if index < len(tables) - 1 else ""))
    out.append("  },")
    out.append('  "rpcs": {')
    rpcs = list(snapshot["rpcs"].items())
    for index, (name, rpc) in enumerate(rpcs):
        comma = "," if index < len(rpcs) - 1 else ""
        out.append(f"    {line(name)}: {line(rpc)}{comma}")
    out.append("  }")
    out.append("}")
    return "\n".join(out) + "\n"


def snapshot_file(openapi_path: Path) -> dict:
    raw = openapi_path.read_bytes()
    return build_snapshot(json.loads(raw), hashlib.sha256(raw).hexdigest())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("openapi", type=Path, help="PostgREST OpenAPI export of the shared database (JSON)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"Where to write the snapshot (default {DEFAULT_OUT})")
    args = parser.parse_args(argv)
    snapshot = snapshot_file(args.openapi)
    args.out.write_text(render(snapshot), encoding="utf-8")
    print(f"Wrote {args.out}: {len(snapshot['tables'])} tables, {len(snapshot['rpcs'])} RPCs")


if __name__ == "__main__":
    main()
