from fastapi import HTTPException, status

from app.core.supabase import web_table
from app.services import service_providers

# A web-only table: web.saved_providers, one row per user and provider (both users.id).
TABLE = "saved_providers"


def list_saved(user_id: str) -> list[dict]:
    result = web_table(TABLE).select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    return result.data or []


def save_provider(user_id: str, provider_id: str) -> dict:
    # Only a live provider can be saved, by id or slug; the row keeps the id.
    provider_id = service_providers.require_published(provider_id)
    result = web_table(TABLE).insert({"user_id": user_id, "provider_id": provider_id}).execute()
    return result.data[0]


def unsave_provider(user_id: str, provider_id: str) -> None:
    # By id or slug, as saving takes either; a provider who went offline since can still be unsaved.
    provider_id = service_providers.provider_id_for(provider_id)
    if provider_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved provider not found")
    result = web_table(TABLE).delete().eq("user_id", user_id).eq("provider_id", provider_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved provider not found")
