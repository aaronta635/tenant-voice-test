from app.core.supabase import get_supabase_client
from app.services import _common

TABLE = "provider_availability"


def list_my_availability(provider_id: str) -> list[dict]:
    return _common.list_owned(TABLE, provider_id, order_by="day_of_week")


def create_availability(provider_id: str, payload: dict) -> dict:
    return _common.create_owned(TABLE, provider_id, payload)


def update_availability(availability_id: str, provider_id: str, payload: dict) -> dict:
    return _common.update_owned(TABLE, availability_id, provider_id, payload)


def delete_availability(availability_id: str, provider_id: str) -> None:
    _common.delete_owned(TABLE, availability_id, provider_id)


def list_public_availability(provider_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("provider_id", provider_id)
        .order("day_of_week")
        .execute()
    )
    return result.data or []
