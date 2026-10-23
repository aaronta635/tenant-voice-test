"""Accounts on the shared schema, and the auth and LIKE behaviour the fake lacks.

FakeSupabase's auth has no admin.delete_user or refresh_session, and its ilike
ignores LIKE escapes (a \\_ in a pattern matches only a backslash there). The
fixtures here add each for the one test that asks; import them into the test
module, as with tests.schema_variants.
"""

import re
from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError

from tests import fake_supabase
from tests.factories import NOW


def users_row(id, email, primary_role="TENANT", auth_user_id=None, **over) -> dict:
    """A users row as the shared schema stores it, with every NOT NULL column it has no default for."""
    row = {
        "id": id,
        "auth_user_id": auth_user_id,
        "email": email,
        "full_name": "Test Person",
        "primary_role": primary_role,
        "status": "ACTIVE",
        "metadata": {},
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def account(fake_db, id, email, primary_role="TENANT", password="password123", **over) -> str:
    """An auth user and the users row it signs in to (no role or profile rows); returns a bearer token."""
    token = fake_db.add_auth_user(email, password)
    fake_db.seed("users", [users_row(id, email, primary_role, auth_user_id=fake_db.tokens[token], **over)])
    return token


def verify(db, *user_ids, status="APPROVED") -> None:
    """Set these accounts' verification, and a provider's profile with it, as an admin's decisions would.

    The verification gates (services/gates.py) read both: applying, publishing,
    the paid AI, confirming bookings, taking repairs and going live need APPROVED.
    """
    for user in db.tables.get("users", []):
        if user["id"] in user_ids:
            user["verification_status"] = status
    for profile in db.tables.get("service_provider_profiles", []):
        if profile["user_id"] in user_ids:
            profile["verification_status"] = status


def fail_inserts(monkeypatch, table, times=1, code="57014"):
    """Make the next `times` inserts into a public table fail with that code (57014: a timeout)."""
    execute = fake_supabase.FakeTableQuery.execute
    left = [times]

    def _execute(query):
        if query._op == "insert" and query._schema == "public" and query._name == table and left[0] > 0:
            left[0] -= 1
            raise APIError({"code": code, "message": f"insert into {table} failed"})
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", _execute)


@pytest.fixture
def auth_deletes(fake_db, monkeypatch):
    """auth.admin.delete_user, as GoTrue has it; returns the ids it deleted."""
    deleted: list[str] = []

    def delete_user(id, should_soft_delete=False):
        if not any(user["id"] == id for user in fake_db.users):
            raise Exception("User not found")
        fake_db.users[:] = [user for user in fake_db.users if user["id"] != id]
        for token in [token for token, user_id in fake_db.tokens.items() if user_id == id]:
            del fake_db.tokens[token]
        deleted.append(id)

    monkeypatch.setattr(fake_db.auth.admin, "delete_user", delete_user, raising=False)
    return deleted


@pytest.fixture
def auth_refresh(fake_db, monkeypatch):
    """auth.refresh_session for the refresh tokens the fake's sign-in hands out (refresh-<auth id>)."""

    def refresh_session(refresh_token=None):
        user_id = (refresh_token or "").removeprefix("refresh-")
        user = next((user for user in fake_db.users if user["id"] == user_id), None)
        if user is None:
            raise Exception("Invalid Refresh Token: Refresh Token Not Found")
        token = f"token-{user_id}-renewed"
        fake_db.tokens[token] = user_id
        session = SimpleNamespace(access_token=token, refresh_token=refresh_token, expires_at=4102444800)
        return SimpleNamespace(user=SimpleNamespace(id=user_id, email=user["email"]), session=session)

    monkeypatch.setattr(fake_db.auth, "refresh_session", refresh_session, raising=False)


def _escaped_ilike(value, pattern) -> bool:
    """Postgres ILIKE: % and _ are wildcards unless a backslash escapes them."""
    if value is None:
        return False
    regex, chars = [], iter(pattern)
    for char in chars:
        if char == "\\":
            regex.append(re.escape(next(chars, "\\")))
        elif char == "%":
            regex.append(".*")
        elif char == "_":
            regex.append(".")
        else:
            regex.append(re.escape(char))
    return re.fullmatch("".join(regex), str(value), re.IGNORECASE | re.DOTALL) is not None


@pytest.fixture
def like_escapes(monkeypatch):
    """The fake's ilike, honouring LIKE escapes as Postgres does."""
    monkeypatch.setattr(fake_supabase, "_ilike_match", _escaped_ilike)
