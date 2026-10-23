from functools import lru_cache

from postgrest import SyncPostgrestClient, SyncRequestBuilder
from supabase import Client, create_client

from app.core.config import settings

# The web backend's own tables, kept out of the Prisma-managed public schema
# of the shared database (supabase/shared/0001_web_schema.sql).
WEB_SCHEMA = "web"


@lru_cache
def get_supabase_client() -> Client:
    """The shared service-role client, used for all data access.

    Never sign a user in on this client — see create_supabase_client().
    """
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def web_table(name: str) -> SyncRequestBuilder:
    """A query on one of the web-only tables, through the service-role client.

    PostgREST serves the schema only once "web" is among the project's
    exposed schemas (supabase/shared/README.md).
    """
    return _web_schema(get_supabase_client()).table(name)


@lru_cache(maxsize=1)
def _web_schema(client: Client) -> SyncPostgrestClient:
    # postgrest-py's schema() builds a new HTTP client on every call; keep one
    # per service-role client rather than a connection pool per query.
    return client.schema(WEB_SCHEMA)


def create_supabase_client() -> Client:
    """A fresh, uncached client for operations that sign a user in.

    supabase-py listens to its own auth events: on SIGNED_IN it overwrites the
    client's Authorization header with the *user's* access token and discards
    the cached PostgREST client (see Client._listen_to_auth_events). On the
    shared client above that would silently downgrade every later request from
    service_role to whichever user logged in most recently — breaking
    auth.admin calls with 403 and putting all table reads behind that user's
    RLS. Signing in on a throwaway client keeps the contamination local.
    """
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def user_client(access_token: str) -> Client:
    """A fresh client whose PostgREST requests (tables and RPCs) run as the signed-in user.

    For the shared database's mobile_* RPCs, which take the caller from
    auth.uid(): the service role has no user. Only PostgREST carries the
    user's token; this client's storage and auth.admin keep the service-role
    key, so use it for user-scoped queries and RPCs only.
    """
    if not access_token:
        # Never fall back to the service role: it bypasses RLS and has no auth.uid().
        raise ValueError("user_client needs the user's access token")
    client = create_supabase_client()
    client.postgrest.auth(access_token)
    return client
