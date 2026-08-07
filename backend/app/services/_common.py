from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client


def list_owned(table: str, provider_id: str, order_by: str | None = None, desc: bool = False) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table(table).select("*").eq("provider_id", provider_id)
    if order_by:
        query = query.order(order_by, desc=desc)
    return query.execute().data or []


def create_owned(table: str, provider_id: str, payload: dict) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    payload["provider_id"] = provider_id
    supabase = get_supabase_client()
    result = supabase.table(table).insert(payload).execute()
    return result.data[0]


def get_owned(table: str, row_id: str, provider_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table(table).select("*").eq("id", row_id).eq("provider_id", provider_id).limit(1).execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return result.data[0]


def update_owned(table: str, row_id: str, provider_id: str, payload: dict) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    supabase = get_supabase_client()
    if not payload:
        return get_owned(table, row_id, provider_id)
    result = (
        supabase.table(table).update(payload).eq("id", row_id).eq("provider_id", provider_id).execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return result.data[0]


def delete_owned(table: str, row_id: str, provider_id: str) -> None:
    supabase = get_supabase_client()
    result = (
        supabase.table(table).delete().eq("id", row_id).eq("provider_id", provider_id).execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
