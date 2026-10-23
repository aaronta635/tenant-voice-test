"""Every table the backend names is a shared table or a web one (migration plan §3 e3, the static check).

The fake fails a query on a table the shared database lacks, but only on the
paths a test runs. This reads app/ and scripts/ instead: each .table(),
.from_() and web_table() argument that is a string or a module constant,
and each resource a select string embeds, must be a table of
app/db/shared_schema.json or of supabase/shared/0001_web_schema.sql. A name
held in a variable (the generic helpers' table argument) is checked where
its caller names it.
"""

import ast
import re
from pathlib import Path

from app.db import schema
from tests import web_schema

BACKEND = Path(__file__).resolve().parents[1]
TABLE_CALLS = {"table", "from_", "web_table"}
# An embedded resource in a select string: name, optional !hints, then "(".
EMBED = re.compile(r"([A-Za-z_]\w*)(?:!\w+)*\s*\(")


def _constants(tree: ast.Module) -> dict[str, object]:
    """The module's top-level string constants, and tuples, lists or sets of strings."""
    found: dict[str, object] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        value = node.value
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            resolved: object = value.value
        elif isinstance(value, (ast.Tuple, ast.List, ast.Set)) and all(
            isinstance(item, ast.Constant) and isinstance(item.value, str) for item in value.elts
        ):
            resolved = [item.value for item in value.elts]
        else:
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                found[target.id] = resolved
    return found


def table_names(sources: dict[str, str]) -> dict[str, set[str]]:
    """{table: {"module:line", ...}} for the tables the sources ({module: code}) name."""
    trees = {module: ast.parse(code) for module, code in sources.items()}
    constants = {module: _constants(tree) for module, tree in trees.items()}
    names: dict[str, set[str]] = {}

    def resolve(module: str, node: ast.AST, aliases: dict[str, tuple[str, str | None]]) -> list[str]:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [node.value]
        value = None
        if isinstance(node, ast.Name):
            value = constants[module].get(node.id)
            if value is None and node.id in aliases:
                source, name = aliases[node.id]
                value = constants.get(source, {}).get(name) if name else None
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in aliases:
            source, name = aliases[node.value.id]
            value = constants.get(source, {}).get(node.attr) if name is None else None
        if value is None:
            return []
        return value if isinstance(value, list) else [value]

    for module, tree in trees.items():
        # alias -> (module, constant) for "from m import CONST", (module, None) for a module itself.
        aliases: dict[str, tuple[str, str | None]] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                for alias in node.names:
                    if f"{node.module}.{alias.name}" in sources:
                        aliases[alias.asname or alias.name] = (f"{node.module}.{alias.name}", None)
                    elif node.module in sources:
                        aliases[alias.asname or alias.name] = (node.module, alias.name)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Attribute) and func.value.attr == "storage":
                continue  # storage.from_(bucket) names a bucket
            where = f"{module}:{node.lineno}"
            if name in TABLE_CALLS:
                for table in resolve(module, node.args[0], aliases):
                    names.setdefault(table, set()).add(where)
            elif name == "select":
                for argument in node.args:
                    for spec in resolve(module, argument, aliases):
                        for table in EMBED.findall(spec):
                            names.setdefault(table, set()).add(where)
    return names


def _backend_sources() -> dict[str, str]:
    paths = sorted([*(BACKEND / "app").rglob("*.py"), *(BACKEND / "scripts").rglob("*.py")])
    return {".".join(path.relative_to(BACKEND).with_suffix("").parts): path.read_text(encoding="utf-8")
            for path in paths}


def test_every_table_the_backend_names_exists_in_the_shared_database():
    names = table_names(_backend_sources())
    known = set(schema.snapshot()["tables"]) | set(web_schema.web_tables())

    assert {"users", "conversation_participants", "mobile_provider_services", "bookings"} <= set(names)
    assert {table: sorted(where) for table, where in names.items() if table not in known} == {}


def test_the_check_sees_constants_other_modules_and_embeds():
    names = table_names({
        "app.services.legacy": 'TABLE = "profiles"\n'
                               "def read(db):\n"
                               "    db.table(TABLE).select('id, provider_services(title)').execute()\n",
        "app.services.reader": "from app.services import legacy\n"
                               "from app.services.legacy import TABLE as SAME\n"
                               "def read(db, bucket):\n"
                               "    db.table(legacy.TABLE)\n"
                               "    db.schema('web').from_(SAME)\n"
                               "    db.storage.from_('profile-documents')\n"
                               "    db.table(bucket)\n",
    })

    assert names == {
        "profiles": {"app.services.legacy:3", "app.services.reader:4", "app.services.reader:5"},
        "provider_services": {"app.services.legacy:3"},
    }
