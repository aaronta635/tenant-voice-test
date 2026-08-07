from app.core.supabase import get_supabase_client
from app.services import _common

TABLE = "provider_portfolio"


def list_my_portfolio(provider_id: str) -> list[dict]:
    return _common.list_owned(TABLE, provider_id, order_by="sort_order")


def create_portfolio_item(provider_id: str, payload: dict) -> dict:
    return _common.create_owned(TABLE, provider_id, payload)


def update_portfolio_item(item_id: str, provider_id: str, payload: dict) -> dict:
    return _common.update_owned(TABLE, item_id, provider_id, payload)


def delete_portfolio_item(item_id: str, provider_id: str) -> None:
    _common.delete_owned(TABLE, item_id, provider_id)


def list_public_portfolio(provider_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE).select("*").eq("provider_id", provider_id).order("sort_order").execute()
    )
    return result.data or []
