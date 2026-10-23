"""Shared fixtures.

The app's Settings() is constructed at import time and requires the two
Supabase values, so dummy values are exported *before* anything under
``app.`` is imported. No test ever talks to a real Supabase project.
"""

import os

os.environ.setdefault("SUPABASE_URL", "http://supabase.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

# True: every fake_db also enforces the shared catalog (CHECKs, unique keys, ON DELETE, triggers; StrictSchema).
CATALOG_RULES = True

import pytest
from fastapi.testclient import TestClient

from app.core import supabase as supabase_module
from app.core.deps import CurrentProfile, get_current_profile
from app.main import app
from app.services import uploads
from tests.fake_supabase import FakeSupabase


@pytest.fixture(autouse=True)
def fresh_signed_urls(monkeypatch):
    """Signed file links are reused between reads; never across tests."""
    monkeypatch.setattr(uploads, "_reused_urls", {})


@pytest.fixture
def fake_db(monkeypatch):
    """Route every Supabase client (cached service-role client and throwaway
    login client alike) to one in-memory FakeSupabase.

    It answers like the shared database, for every test: unknown tables and
    columns, bad enum values and uuids, missing NOT NULL values, repeated
    keys and foreign keys that point at no row fail with PostgREST's and
    Postgres's codes, and inserts get the column defaults. Public tables
    come from app/db/shared_schema.json, web tables from
    supabase/shared/0001_web_schema.sql. See StrictSchema.
    """
    fake = FakeSupabase()
    # A new client per call, as supabase-py makes: a user_client() token stays on its client.
    monkeypatch.setattr(supabase_module, "create_client", lambda url, key: fake.client())
    supabase_module.get_supabase_client.cache_clear()
    yield fake
    supabase_module.get_supabase_client.cache_clear()


@pytest.fixture
def strict_schema(fake_db):
    """fake_db, by the name the area ports gave it when strict answers were opt-in."""
    return fake_db


@pytest.fixture
def client(fake_db):
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def as_profile():
    """Bypass token verification: force the request to run as a given profile."""

    def _set(id="profile-1", role="service_provider", full_name="Test User", raw=None, access_token="test-jwt"):
        profile = CurrentProfile(
            id=id,
            role=role,
            full_name=full_name,
            raw=raw or {"id": id, "role": role, "full_name": full_name},
            access_token=access_token,
        )
        app.dependency_overrides[get_current_profile] = lambda: profile
        return profile

    yield _set
    app.dependency_overrides.clear()


TENANT_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def as_tenant(fake_db):
    """Authenticated tenant whose id also lands on request.state.

    Distinct from `as_profile`: AuditMiddleware reads request.state.actor_id,
    which deps.get_current_profile sets, so an override that ignores the
    Request cannot exercise the audit path.
    """
    from fastapi import Request

    def _fake(request: Request):
        request.state.actor_id = TENANT_ID
        request.state.actor_role = "tenant"
        return CurrentProfile(id=TENANT_ID, role="tenant", full_name="Test Tenant", raw={})

    app.dependency_overrides[get_current_profile] = _fake
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
