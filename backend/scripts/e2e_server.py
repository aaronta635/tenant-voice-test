"""Serve the API on the strict fake Supabase, with a demo dataset, for the browser journeys (tracker R44).

Run from backend:
    .venv/bin/python -m scripts.e2e_server --port 8123 --frontend-origin http://127.0.0.1:3123

frontend/e2e/run.mjs starts it on a free port (docs/e2e.md). The app is the
real one (app.main), but every Supabase client it makes, the database,
Storage and Auth alike, is the strict fake of tests/fake_supabase.py, which
answers like the shared database. scripts/e2e_seed.py fills it through the
app's own routes. A demo password signs in through the real login form: the
fake hands out a JWT-shaped token that the app then accepts.

Nothing leaves this machine. The server listens on 127.0.0.1 only, never on
3000 or 8000 (the developer's own app). It never reads backend/.env: the
settings are made in an empty folder, so they find no .env. It refuses to
start while the environment names a Supabase project or key other than its
own fake ones, leaves the model and the virus scanner unconfigured, and
refuses every connection to another machine.

The listing import (R32) reads links through a fake network too: only
LISTING_URL answers, with the made-up page scripts/e2e_listing_page.html, at
a public-looking address, so the import's own address checks and pinned
connection run as they would; every other name is not found.

Routes of this server only, beside the app's:
    GET  /e2e/fixtures   the demo accounts, their password and the seeded ids
    POST /e2e/reset      a fresh copy of the dataset, for the next journey
    GET  /e2e/outbox     the password reset emails Auth would have sent
    GET  /storage/v1/object/public/{bucket}/{key}         a public bucket's file (listing photos)
    GET  /storage/v1/object/sign/{bucket}/{key}?token=..  a private file, while its signed link lasts
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import importlib
import ipaddress
import json
import logging
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Mapping
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from tests.fake_supabase import FakeAuth, FakeAuthAdmin, FakeBucket, FakeStorage, FakeSupabase  # noqa: E402

logger = logging.getLogger("tenantvoice.e2e")

HOST = "127.0.0.1"
# The developer's own frontend and API (docs/e2e.md): never bound, never called.
REFUSED_PORTS = frozenset({3000, 8000})
# The service-role key the app is given: not a key of any Supabase project.
FAKE_SERVICE_ROLE_KEY = "e2e-fake-service-role-key"
# Long enough for a whole run; the frontend refreshes a session once it has passed.
TOKEN_TTL_SECONDS = 12 * 60 * 60
# The in-process state some services keep between requests: a reset clears it,
# so no cached profile list, signed link or rate limit outlives the dataset it
# came from (the demo emails are the same after every reset).
SERVICE_CACHES = (
    ("app.services.public_profiles", "_scans"),
    ("app.services.provider_recommendations", "_cache"),
    ("app.services.provider_recommendations", "_last_attempt"),
    ("app.services.provider_recommendations", "_chat_turns"),
    ("app.services.matching", "_last_attempt"),
    ("app.services.uploads", "_reused_urls"),
)
# Services that clear their own state, under their own lock.
SERVICE_RESETS = (
    ("app.services.password_reset", "clear_limits"),
    ("app.services.listing_import", "clear_caches"),
)
# The listing page the journeys import, and the only link the import's fake network answers.
LISTING_HOST = "listings.wattle-lane.example"
LISTING_URL = f"https://{LISTING_HOST}/rentals/12-bridge-road-glebe"
LISTING_PAGE = Path(__file__).resolve().with_name("e2e_listing_page.html")
# What a stored file is served as when Storage was not told its type.
SUFFIX_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
                ".webp": "image/webp", ".pdf": "application/pdf"}


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------
def check_port(port: int) -> int:
    """The port to listen on, or SystemExit for one the developer's own app uses."""
    if port in REFUSED_PORTS:
        raise SystemExit(f"Port {port} belongs to the developer's own app: the E2E server never uses 3000 or 8000.")
    if not 1024 <= port <= 65535:
        raise SystemExit("Choose a port from 1024 to 65535.")
    return port


def is_this_machine(host) -> bool:
    """Whether a host name or address (text or bytes) is this machine: localhost or a loopback address.

    No host at all is too: a socket call without one stays on this machine.
    """
    if isinstance(host, bytes):
        host = host.decode()
    host = str(host or "").lower().strip("[]").split("%", 1)[0]
    if host in ("", "localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def is_local_url(url: str) -> bool:
    """Whether a URL names this machine, or a host that cannot exist (the .invalid domain)."""
    host = (urlsplit(url.strip()).hostname or "").lower()
    return bool(host) and (host.endswith(".invalid") or is_this_machine(host))


def check_environment(environ: Mapping[str, str]) -> None:
    """SystemExit while the environment names a real Supabase project or key.

    Any variable with SUPABASE in its name counts: a URL must name this
    machine, and anything else (a key, a secret, a token) must be empty or the
    fake key. The message names the variable, never its value.
    """
    for name, value in environ.items():
        if "SUPABASE" not in name.upper() or not value.strip():
            continue
        if name.upper().endswith("URL"):
            if not is_local_url(value):
                raise SystemExit(f"{name} names a Supabase project: unset it. The E2E server runs on its fake only.")
        elif value != FAKE_SERVICE_ROLE_KEY:
            raise SystemExit(f"{name} is set: unset it. The E2E server never uses a real Supabase key.")


def configure_environment(port: int, origins: list[str]) -> dict[str, str]:
    """The settings the app reads, all fake or empty, set before app.core.config is imported."""
    values = {
        "SUPABASE_URL": f"http://{HOST}:{port}",
        "SUPABASE_SERVICE_ROLE_KEY": FAKE_SERVICE_ROLE_KEY,
        "DEEPSEEK_API_KEY": "",
        "CLAMAV_HOST": "",
        "CORS_ORIGINS": ",".join(origins),
        "FRONTEND_URL": origins[0],
        "CLAIM_ACCOUNTS_BY_EMAIL": "false",
    }
    os.environ.update(values)
    return values


@contextmanager
def away_from_backend_folder():
    """Run the block in a new empty folder, removed after it: the settings read .env from the working folder.

    app.core.config makes the settings once, when it is imported, so the
    import goes in the block and finds no .env.
    """
    home = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="tenantvoice-e2e-") as folder:
        os.chdir(folder)
        try:
            if Path(".env").exists():  # pragma: no cover - a new temporary folder is empty
                raise SystemExit("The E2E server's working folder has a .env; it never reads one.")
            yield Path(folder)
        finally:
            os.chdir(home)


def refuse_outbound() -> None:
    """Make every connection or name lookup this process tries for another machine fail.

    The app calls nothing outside when the model and the scanner are not
    configured; this makes sure of it. A refused call fails as a network
    error does, which the app's fallbacks already handle.
    """
    if getattr(socket.socket.connect, "e2e_guard", False):
        return
    connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo

    def check(address) -> None:
        if isinstance(address, tuple) and not is_this_machine(address[0]):
            raise ConnectionRefusedError(f"The E2E server connects to nothing outside this machine ({address[0]}).")

    def guarded_connect(self, address):
        check(address)
        return connect(self, address)

    def guarded_connect_ex(self, address):
        check(address)
        return connect_ex(self, address)

    def guarded_getaddrinfo(host, *args, **kwargs):
        if not is_this_machine(host):
            raise socket.gaierror(socket.EAI_NONAME, f"The E2E server looks up no outside name ({host}).")
        return getaddrinfo(host, *args, **kwargs)

    guarded_connect.e2e_guard = True
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.getaddrinfo = guarded_getaddrinfo


# ---------------------------------------------------------------------------
# The fake, with the Auth and Storage the app needs beyond the tests' fake
# ---------------------------------------------------------------------------
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def token_claims(token: str) -> dict:
    """A minted token's payload; {} for anything else."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}
    return claims if isinstance(claims, dict) else {}


class E2EAuthAdmin(FakeAuthAdmin):
    """The admin calls the app makes beyond the fake's: removing a user, a new password, ending sessions."""

    def delete_user(self, id, should_soft_delete=False):
        if self._root.auth_user(id=id) is None:
            raise Exception("User not found")
        self._root.users[:] = [user for user in self._root.users if user["id"] != id]
        self._root.end_sessions(id)

    def update_user_by_id(self, uid, attributes):
        user = self._root.auth_user(id=uid)
        if user is None:
            raise Exception("User not found")
        if "password" in attributes:
            user["password"] = attributes["password"]
        return SimpleNamespace(user=SimpleNamespace(id=uid, email=user["email"]))

    def sign_out(self, jwt, scope="global"):
        user_id = self._root.tokens.get(jwt)
        if user_id is not None:
            self._root.end_sessions(user_id)


class E2EAuth(FakeAuth):
    """Sign-in, refresh and recovery emails as Supabase Auth answers them, with JWT-shaped tokens."""

    def __init__(self, root: E2ESupabase):
        super().__init__(root)
        self.admin = E2EAuthAdmin(root)

    def get_user(self, token: str):
        if token in self._root.tokens and token_claims(token).get("exp", float("inf")) < time.time():
            raise Exception("JWT expired")
        return super().get_user(token)

    def sign_in_with_password(self, credentials: dict):
        user = self._root.auth_user(email=credentials.get("email", ""))
        if user is None or user["password"] != credentials.get("password"):
            raise Exception("Invalid login credentials")
        return self._root.signed_in(user, "password")

    def refresh_session(self, refresh_token=None):
        user_id = self._root.refresh_tokens.pop(refresh_token or "", None)
        user = self._root.auth_user(id=user_id) if user_id else None
        if user is None:
            raise Exception("Invalid Refresh Token: Refresh Token Not Found")
        return self._root.signed_in(user, "password")

    def reset_password_for_email(self, email: str, options: dict | None = None):
        """Keep the recovery email in the outbox instead of sending it; an unknown address gets none, as in Auth."""
        user = self._root.auth_user(email=email)
        if user is None:
            return None
        session = self._root.signed_in(user, "otp").session
        fragment = (f"access_token={session.access_token}&expires_at={session.expires_at}"
                    f"&expires_in={TOKEN_TTL_SECONDS}&refresh_token={session.refresh_token}"
                    "&token_type=bearer&type=recovery")
        redirect = (options or {}).get("redirect_to") or ""
        self._root.outbox.append({
            "to": user["email"], "subject": "Reset your password", "link": f"{redirect}#{fragment}",
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })
        return None


class E2EBucket(FakeBucket):
    """A bucket that also remembers the type each file was stored as, to serve it as that."""

    def upload(self, path, data, options):
        super().upload(path, data, options)
        self._storage.types[(self._bucket, path)] = (options or {}).get("content-type")


class E2EStorage(FakeStorage):
    """The fake's Storage, which also keeps each file's type and each signed link's token and expiry."""

    def __init__(self):
        super().__init__()
        self.types: dict[tuple[str, str], str | None] = {}
        self.links: dict[str, tuple[str, str, float]] = {}  # token -> (bucket, key, expires)

    def from_(self, bucket: str) -> E2EBucket:
        return E2EBucket(self, bucket)

    def signed_url(self, bucket: str, path: str) -> str:
        url = super().signed_url(bucket, path)
        last = self.signatures[-1] if self.signatures else None
        ttl = last[2] if last and last[:2] == (bucket, path) else 300
        token = parse_qs(urlsplit(url).query)["token"][0]
        self.links[token] = (bucket, path, time.time() + ttl)
        return url

    def content_type(self, bucket: str, path: str) -> str:
        return self.types.get((bucket, path)) or SUFFIX_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")


class E2ESupabase(FakeSupabase):
    """The tests' strict fake, as a server needs it: real time, one query at a time, and the Auth of a browser.

    The database's now() is the real clock, since the app compares its own
    times with the rows'. Each query runs alone, as a statement does in the
    database: the server answers requests on several threads. The shared
    catalog's checks, keys and triggers are always on, as in the tests: the
    server never loads tests/conftest.py, whose CATALOG_RULES the fake would
    otherwise read.
    """

    def __init__(self):
        super().__init__(catalog_rules=True)
        self.auth = E2EAuth(self)
        self.storage = E2EStorage()
        self.refresh_tokens: dict[str, str] = {}  # refresh token -> auth user id
        self.outbox: list[dict] = []
        self.lock = threading.RLock()
        self._secret = secrets.token_bytes(32)
        self.strict.now = lambda: datetime.now(timezone.utc).isoformat()
        execute = self.strict.execute

        def locked(query):
            with self.lock:
                return execute(query)

        self.strict.execute = locked

    def auth_user(self, *, id: str | None = None, email: str | None = None) -> dict | None:
        """An auth user by id, or by email ignoring case, as Auth compares addresses."""
        for user in self.users:
            if id is not None and user["id"] == id:
                return user
            if email is not None and user["email"].lower() == email.strip().lower():
                return user
        return None

    def mint(self, user: dict, method: str) -> tuple[str, int]:
        """A signed JWT for an auth user that this fake's Auth accepts, and when it expires."""
        now = int(time.time())
        claims = {"iss": "tenantvoice-e2e", "sub": user["id"], "aud": "authenticated", "role": "authenticated",
                  "email": user["email"], "iat": now, "exp": now + TOKEN_TTL_SECONDS,
                  "session_id": str(uuid.uuid4()), "amr": [{"method": method, "timestamp": now}]}
        head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
        body = _b64(json.dumps(claims, separators=(",", ":")).encode())
        signature = _b64(hmac.new(self._secret, f"{head}.{body}".encode(), hashlib.sha256).digest())
        token = f"{head}.{body}.{signature}"
        self.tokens[token] = user["id"]
        return token, claims["exp"]

    def signed_in(self, user: dict, method: str):
        """Auth's answer to a sign-in: the user, with the metadata its owner set, and a new session."""
        token, expires_at = self.mint(user, method)
        refresh = secrets.token_urlsafe(24)
        self.refresh_tokens[refresh] = user["id"]
        return SimpleNamespace(
            user=SimpleNamespace(id=user["id"], email=user["email"], user_metadata=user["user_metadata"]),
            session=SimpleNamespace(access_token=token, refresh_token=refresh, expires_at=expires_at,
                                    expires_in=TOKEN_TTL_SECONDS, token_type="bearer"),
        )

    def end_sessions(self, user_id: str) -> None:
        for store in (self.tokens, self.refresh_tokens):
            for token in [token for token, owner in store.items() if owner == user_id]:
                del store[token]


class Clients:
    """What every create_client() call of the app gets: a client of the current fake, which a reset replaces.

    One client per call, as supabase-py makes and as the tests' fake_db does, so a
    user_client() token stays on its client and a mobile function runs as that user.
    """

    def __init__(self):
        self.fake = E2ESupabase()

    def create(self, *args, **kwargs):
        return self.fake.client()


def install(clients: Clients) -> None:
    """Point every Supabase client the app makes at the fake (the shared one, the login and the recovery
    client), and the listing import's DNS and sockets at a fake network that serves LISTING_PAGE only."""
    from app.core import supabase as supabase_module
    from app.services import listing_import, password_reset
    from tests.factories_listing_import import FakeWeb, html

    supabase_module.create_client = clients.create
    password_reset.create_client = clients.create
    web = FakeWeb()
    web.site(LISTING_HOST, html(LISTING_PAGE.read_text(encoding="utf-8")))
    listing_import._getaddrinfo = web._lookup
    listing_import._network_backend = lambda: web
    forget_clients()


def forget_clients() -> None:
    from app.core import supabase as supabase_module

    supabase_module.get_supabase_client.cache_clear()
    supabase_module._web_schema.cache_clear()


def clear_service_caches() -> list[str]:
    """Empty the services' in-process caches; returns the ones it could not find."""
    missing = []
    for module_name, name in SERVICE_CACHES:
        cache = getattr(importlib.import_module(module_name), name, None)
        if hasattr(cache, "clear"):
            cache.clear()
        else:
            missing.append(f"{module_name}.{name}")
    for module_name, name in SERVICE_RESETS:
        clear = getattr(importlib.import_module(module_name), name, None)
        if callable(clear):
            clear()
        else:
            missing.append(f"{module_name}.{name}")
    return missing


# ---------------------------------------------------------------------------
# The server
# ---------------------------------------------------------------------------
def build_app(clients: Clients, seed):
    """The app with this server's own routes before it. seed(api) fills the current fake and returns its fixtures."""
    from fastapi import FastAPI, HTTPException, Query, Response

    from app.main import app as api
    from app.services import uploads

    server = FastAPI(title="TenantVoice E2E", docs_url=None, redoc_url=None, openapi_url=None)
    state = {"fixtures": seed(api)}
    reset_lock = threading.Lock()

    @server.get("/e2e/fixtures")
    def fixtures():
        return state["fixtures"]

    @server.post("/e2e/reset")
    def reset():
        with reset_lock:
            clients.fake = E2ESupabase()
            forget_clients()
            for name in clear_service_caches():
                logger.warning("no %s to clear: renamed?", name)
            state["fixtures"] = seed(api)
        return state["fixtures"]

    @server.get("/e2e/outbox")
    def outbox():
        return clients.fake.outbox

    def stored(bucket: str, key: str) -> Response:
        storage = clients.fake.storage
        data = storage.objects.get((bucket, key))
        if data is None:
            raise HTTPException(404, "Object not found")
        return Response(data, media_type=storage.content_type(bucket, key),
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @server.get("/storage/v1/object/public/{bucket}/{key:path}")
    def public_object(bucket: str, key: str):
        rules = uploads.BUCKETS.get(bucket)
        if rules is None or not rules.public:
            raise HTTPException(400, "Bucket not public")
        return stored(bucket, key)

    @server.get("/storage/v1/object/sign/{bucket}/{key:path}")
    def signed_object(bucket: str, key: str, token: str = Query(...)):
        link = clients.fake.storage.links.get(token)
        if link is None or link[:2] != (bucket, key) or link[2] < time.time():
            raise HTTPException(400, "Invalid or expired signature")
        return stored(bucket, key)

    server.mount("/", api)
    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, required=True, help="The port to listen on (127.0.0.1 only)")
    parser.add_argument("--frontend-origin", action="append", default=[],
                        help="An origin the browser app runs on, for CORS and the emailed links; repeat for more")
    args = parser.parse_args(argv)
    port = check_port(args.port)
    origins = args.frontend_origin or [f"http://{HOST}:3123"]
    for origin in origins:
        if not is_local_url(origin):
            raise SystemExit(f"{origin} is not on this machine: the E2E frontend runs locally.")
        if urlsplit(origin).port in REFUSED_PORTS:
            raise SystemExit(f"{origin} is the developer's own app: the E2E frontend never uses 3000 or 8000.")
    check_environment(os.environ)
    if "app.core.config" in sys.modules:  # pragma: no cover - only a script runs this
        raise SystemExit("Start the E2E server as its own process: the app's settings are already made.")
    expected = configure_environment(port, origins)
    refuse_outbound()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    with away_from_backend_folder():
        from app.core.config import settings

    if (settings.supabase_url, settings.supabase_service_role_key) != (
        expected["SUPABASE_URL"], FAKE_SERVICE_ROLE_KEY
    ) or settings.deepseek_api_key.get_secret_value() or settings.clamav_host:
        raise SystemExit("The app's settings are not the E2E server's fake ones; refusing to start.")

    from scripts import e2e_seed

    clients = Clients()
    install(clients)
    server = build_app(clients, e2e_seed.seed)

    import uvicorn

    print(f"TenantVoice E2E API on http://{HOST}:{port} (strict fake Supabase, demo data)", flush=True)
    uvicorn.run(server, host=HOST, port=port, log_level="warning", lifespan="off")


if __name__ == "__main__":
    main()
