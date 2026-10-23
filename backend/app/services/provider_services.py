"""A provider's services, kept as the shared mobile_provider_services (migration plan §3 b1).

The mobile app lists and edits the same rows, and both apps write them only
through the shared functions, run as the provider (their JWT):
mobile_create_provider_service, mobile_update_provider_service and
mobile_delete_provider_service. Those check what a service may be (a title of
up to 80 characters, a description of up to 1000, a price from 0 to 100,000,
a description and a price above 0 to be active, at most 50 services not
archived), clean the inclusion lists, and archive a removed service, so the
bookings that name it keep it. Their refusals reach the provider with their
own message (maps_provider_core.run_function).

The table has no sort order or cancellation policy: services are listed in
the order they were created and numbered by their place, and the web keeps a
service's cancellation policy on its provider's profile, in
service_provider_profiles.metadata[EXTRAS_KEY].
"""

from collections.abc import Iterable

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, user_client
from app.services import _common
from app.services.maps_messaging import is_uuid
from app.services.maps_provider_core import (
    SERVICE_ARCHIVED_STATUS,
    SERVICE_LIVE_STATUS,
    flatten_provider_service,
    run_function,
    service_changes,
)
from app.services.shared_map import stamp_update

TABLE = "mobile_provider_services"
OWNER = "provider_user_id"
ORDER = ("created_at", "id")
PROFILES_TABLE = "service_provider_profiles"
# metadata key on the provider's profile: {service id: {"cancellation_policy": ...}}
EXTRAS_KEY = "service_extras"


def _bookings():
    # Imported on use: bookings imports the provider modules.
    from app.services import bookings

    return bookings


def _ordered(query):
    for column in ORDER:
        query = query.order(column)
    return query


def _profile_metadata(provider_id: str) -> dict:
    rows = (
        get_supabase_client().table(PROFILES_TABLE).select("metadata").eq("user_id", provider_id).limit(1).execute().data
    )
    meta = rows[0].get("metadata") if rows else None
    return meta if isinstance(meta, dict) else {}


def _extras(meta: dict) -> dict[str, dict]:
    extras = meta.get(EXTRAS_KEY)
    if not isinstance(extras, dict):
        return {}
    return {service_id: entry for service_id, entry in extras.items() if isinstance(entry, dict)}


def _save_policy(provider_id: str, service_id: str, policy: str | None) -> None:
    """Store, change or clear one service's cancellation policy on its provider's profile.

    Like a profile edit, this rewrites the profile's metadata as read.
    """
    meta = _profile_metadata(provider_id)
    extras = _extras(meta)
    entry = {key: value for key, value in extras.get(service_id, {}).items() if key != "cancellation_policy"}
    if policy:
        entry["cancellation_policy"] = policy
    if entry:
        extras[service_id] = entry
    else:
        extras.pop(service_id, None)
    if extras == _extras(meta):
        return
    (
        get_supabase_client()
        .table(PROFILES_TABLE)
        .update(stamp_update(PROFILES_TABLE, {"metadata": {**meta, EXTRAS_KEY: extras}}))
        .eq("user_id", provider_id)
        .execute()
    )


def _present(rows: list[dict], provider_id: str) -> list[dict]:
    """One provider's rows, in list order, with their place, policy and booking count."""
    if not rows:
        return []
    extras = _extras(_profile_metadata(provider_id))
    counts = _bookings().booking_counts([row["id"] for row in rows])
    services = []
    for place, row in enumerate(rows, start=1):
        service = flatten_provider_service(row, sort_order=place, extras=extras.get(row["id"]))
        service["booking_count"] = counts.get(row["id"], 0)
        services.append(service)
    return services


def _mine(provider_id: str, service_id: str) -> dict:
    return next(service for service in list_my_services(provider_id) if service["id"] == service_id)


def _require_mine(provider_id: str, service_id: str) -> None:
    """404 unless the service is the provider's and not archived: another's is never confirmed to exist."""
    rows = (
        get_supabase_client().table(TABLE).select("id").eq("id", service_id).eq(OWNER, provider_id)
        .neq("status", SERVICE_ARCHIVED_STATUS).limit(1).execute().data
        if is_uuid(service_id) else []
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")


def list_my_services(provider_id: str) -> list[dict]:
    """The provider's services that are not archived, oldest first."""
    query = get_supabase_client().table(TABLE).select("*").eq(OWNER, provider_id).neq("status", SERVICE_ARCHIVED_STATUS)
    return _present(_ordered(query).execute().data or [], provider_id)


def create_service(provider_id: str, payload: dict, access_token: str) -> dict:
    """A new service, through mobile_create_provider_service as the provider; GENERAL unless a category is sent."""
    created = run_function(
        user_client(access_token).rpc("mobile_create_provider_service", {"p_service": service_changes(payload)})
    )
    if payload.get("cancellation_policy"):
        _save_policy(provider_id, created["id"], payload["cancellation_policy"])
    return _mine(provider_id, created["id"])


def update_service(service_id: str, provider_id: str, payload: dict, access_token: str) -> dict:
    """Change the fields sent; a null clears an optional one (service_changes)."""
    _require_mine(provider_id, service_id)
    changes = service_changes(payload)
    if changes:
        run_function(user_client(access_token).rpc(
            "mobile_update_provider_service", {"p_service_id": service_id, "p_changes": changes},
        ))
    if "cancellation_policy" in payload:
        _save_policy(provider_id, service_id, payload["cancellation_policy"])
    return _mine(provider_id, service_id)


def delete_service(service_id: str, provider_id: str, access_token: str) -> None:
    """Archive the service (mobile_delete_provider_service): its bookings, invoices and reviews keep its name."""
    _require_mine(provider_id, service_id)
    run_function(user_client(access_token).rpc("mobile_delete_provider_service", {"p_service_id": service_id}))
    _save_policy(provider_id, service_id, None)


def list_public_services(provider_id: str) -> list[dict]:
    query = get_supabase_client().table(TABLE).select("*").eq(OWNER, provider_id).eq("status", SERVICE_LIVE_STATUS)
    return _present(_ordered(query).execute().data or [], provider_id)


# ---------------------------------------------------------------------------
# For other modules: services as ProviderServiceOut fields, without the
# cancellation policy, place or booking count
# ---------------------------------------------------------------------------
def live_services(provider_ids: Iterable[str]) -> list[dict]:
    """The live services of these providers, each provider's in list order."""
    rows = _common.select_in(
        lambda: _ordered(get_supabase_client().table(TABLE).select("*").eq("status", SERVICE_LIVE_STATUS)),
        OWNER,
        provider_ids,
    )
    return [flatten_provider_service(row) for row in rows]


def has_live_service(provider_id: str) -> bool:
    rows = (
        get_supabase_client()
        .table(TABLE)
        .select("id")
        .eq(OWNER, provider_id)
        .eq("status", SERVICE_LIVE_STATUS)
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


def services_by_id(service_ids: Iterable[str]) -> dict[str, dict]:
    """Services of any provider and status, by id: what a booking, invoice or thread names."""
    rows = _common.select_in(lambda: get_supabase_client().table(TABLE).select("*").order("id"), "id", service_ids)
    return {row["id"]: flatten_provider_service(row) for row in rows}
