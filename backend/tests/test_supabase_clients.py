"""The clients in app.core.supabase: which schema and whose token each request carries.

The real supabase-py client is built against SUPABASE_URL from conftest and
only its request headers are read: no test here sends a request.
"""

import pytest

from app.core import supabase as supabase_module
from app.core.config import settings
from app.core.supabase import user_client, web_table

# supabase-py 2.31 passes these to its own PostgREST client.
pytestmark = pytest.mark.filterwarnings("ignore:The '(timeout|verify)' parameter is deprecated:DeprecationWarning")


@pytest.fixture
def service_client():
    supabase_module.get_supabase_client.cache_clear()
    yield supabase_module.get_supabase_client()
    supabase_module.get_supabase_client.cache_clear()


def test_web_table_queries_the_web_schema_of_the_fake(fake_db):
    [faq] = web_table("faqs").insert({"question": "How do I pay?", "answer": "By card."}).execute().data

    assert web_table("faqs").select("question, audience").execute().data == [
        {"question": "How do I pay?", "audience": "all"}  # the column default
    ]
    assert [row["id"] for row in fake_db.schema_tables["web"]["faqs"]] == [faq["id"]]
    assert "faqs" not in fake_db.tables  # the public schema


def test_web_table_asks_postgrest_for_the_web_schema(service_client):
    query = web_table("bookings")

    assert (query.headers["Accept-Profile"], query.headers["Content-Profile"]) == ("web", "web")
    assert query.headers["Authorization"] == f"Bearer {settings.supabase_service_role_key}"
    assert str(query.path).endswith("/rest/v1/bookings")
    shared = service_client.table("users")
    assert (shared.headers["Accept-Profile"], shared.headers["Content-Profile"]) == ("public", "public")


def test_web_table_reuses_one_http_client_per_service_client(service_client):
    first = web_table("bookings").session

    assert web_table("invoices").session is first
    supabase_module.get_supabase_client.cache_clear()
    assert web_table("bookings").session is not first  # a new service client gets its own


def test_user_client_runs_postgrest_as_the_user(service_client):
    client = user_client("user-jwt")

    assert client is not service_client
    assert client.postgrest.headers["Authorization"] == "Bearer user-jwt"
    assert client.table("users").headers["Authorization"] == "Bearer user-jwt"
    assert service_client.postgrest.headers["Authorization"] == f"Bearer {settings.supabase_service_role_key}"


@pytest.mark.parametrize("token", ["", None])
def test_user_client_never_falls_back_to_the_service_role(token):
    with pytest.raises(ValueError, match="access token"):
        user_client(token)
