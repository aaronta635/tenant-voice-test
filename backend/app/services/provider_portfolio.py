from app.core.supabase import web_table
from app.services import _common

# A web-only table: web.provider_portfolio, keyed by the provider's users.id.
TABLE = "provider_portfolio"
ORDER = ("sort_order", "created_at")


def list_my_portfolio(provider_id: str) -> list[dict]:
    return _common.list_owned(TABLE, provider_id, order_by=ORDER, web=True)


def create_portfolio_item(provider_id: str, payload: dict) -> dict:
    return _common.create_owned(TABLE, provider_id, payload, web=True)


def update_portfolio_item(item_id: str, provider_id: str, payload: dict) -> dict:
    return _common.update_owned(TABLE, item_id, provider_id, payload, web=True)


def delete_portfolio_item(item_id: str, provider_id: str) -> None:
    _common.delete_owned(TABLE, item_id, provider_id, web=True)


def list_public_portfolio(provider_id: str) -> list[dict]:
    query = web_table(TABLE).select("*").eq("provider_id", provider_id)
    for column in ORDER:
        query = query.order(column)
    return query.execute().data or []
