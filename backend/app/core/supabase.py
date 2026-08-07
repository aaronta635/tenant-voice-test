from functools import lru_cache

from supabase import Client, create_client

from app.core.config import settings


@lru_cache
def get_supabase_client() -> Client:
    """The shared service-role client, used for all data access.

    Never sign a user in on this client — see create_supabase_client().
    """
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


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
