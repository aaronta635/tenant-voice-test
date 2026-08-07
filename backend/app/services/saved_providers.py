from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client


def list_saved(user_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("saved_providers")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def save_provider(user_id: str, provider_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table("saved_providers")
        .insert({"user_id": user_id, "provider_id": provider_id})
        .execute()
    )
    return result.data[0]


def unsave_provider(user_id: str, provider_id: str) -> None:
    supabase = get_supabase_client()
    result = (
        supabase.table("saved_providers")
        .delete()
        .eq("user_id", user_id)
        .eq("provider_id", provider_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved provider not found")
