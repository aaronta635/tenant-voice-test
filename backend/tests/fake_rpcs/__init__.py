"""Python stand-ins for the shared database's functions, used by the strict fake.

Each module here registers stand-ins with ``@rpc("name")``. A stand-in is
``stand_in(ctx, params) -> result``:

- written from the function's real body, as saved in
  output/shared-catalog/functions/<name>.sql (snapshot of 2026-10-23);
- ``ctx`` is a tests.fake_supabase.RpcContext: ``ctx.caller`` is the users
  row ``public.current_app_user_id()`` gives for the caller's JWT, or None
  for the service role;
- it reads and writes through ``ctx.table(...)``, so the strict checks apply
  to its writes as to the backend's, and raises
  ``tests.fake_supabase.api_error(code, message)`` where the function raises;
- it returns what PostgREST returns for the call: the function's value for a
  scalar or jsonb result, a list of row dicts for ``RETURNS TABLE``.

A test that only needs a fixed answer sets ``fake_db.rpc_results[name]``,
which wins over the stand-in. An RPC with neither answers [] and is listed in
``fake_db.rpc_unhandled``.
"""

import importlib
import pkgutil

_STAND_INS: dict = {}
_loaded = False


def rpc(name: str):
    """Register the decorated function as the stand-in for the named database function."""

    def register(stand_in):
        if name in _STAND_INS:
            raise ValueError(f"two stand-ins for {name}")
        _STAND_INS[name] = stand_in
        return stand_in

    return register


def handler(name: str):
    """The stand-in for a database function, or None; loads every module here on first use."""
    global _loaded
    if not _loaded:
        _loaded = True
        for module in pkgutil.iter_modules(__path__):
            importlib.import_module(f"{__name__}.{module.name}")
    return _STAND_INS.get(name)
