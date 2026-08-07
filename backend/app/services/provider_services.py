from app.core.supabase import get_supabase_client
from app.services import _common

TABLE = "provider_services"


def _with_booking_counts(services: list[dict]) -> list[dict]:
    """Attach how many bookings each service has attracted (the UI shows it)."""
    if not services:
        return []

    supabase = get_supabase_client()
    service_ids = [s["id"] for s in services]
    bookings = (
        supabase.table("bookings")
        .select("service_id")
        .in_("service_id", service_ids)
        .execute()
        .data
        or []
    )
    counts: dict[str, int] = {}
    for booking in bookings:
        counts[booking["service_id"]] = counts.get(booking["service_id"], 0) + 1

    for service in services:
        service["booking_count"] = counts.get(service["id"], 0)
    return services


def list_my_services(provider_id: str) -> list[dict]:
    return _with_booking_counts(_common.list_owned(TABLE, provider_id, order_by="sort_order"))


def create_service(provider_id: str, payload: dict) -> dict:
    return _with_booking_counts([_common.create_owned(TABLE, provider_id, payload)])[0]


def update_service(service_id: str, provider_id: str, payload: dict) -> dict:
    return _with_booking_counts([_common.update_owned(TABLE, service_id, provider_id, payload)])[0]


def delete_service(service_id: str, provider_id: str) -> None:
    _common.delete_owned(TABLE, service_id, provider_id)


def list_public_services(provider_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("provider_id", provider_id)
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )
    return _with_booking_counts(result.data or [])
