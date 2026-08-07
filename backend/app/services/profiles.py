import logging

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)


def _with_email(profile: dict) -> dict:
    """Attach the account email from auth.users (profiles does not duplicate it)."""
    supabase = get_supabase_client()
    try:
        user = supabase.auth.admin.get_user_by_id(profile["id"])
        profile["email"] = user.user.email if user and user.user else None
    except Exception as exc:  # non-fatal: the screen simply shows no email
        logger.warning("Could not resolve email for %s: %s", profile["id"], exc)
        profile["email"] = None
    return profile


def get_profile(profile_id: str) -> dict:
    supabase = get_supabase_client()
    result = supabase.table("profiles").select("*").eq("id", profile_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return _with_email(result.data[0])


def update_profile(profile_id: str, payload: dict) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    supabase = get_supabase_client()
    if not payload:
        return get_profile(profile_id)
    result = supabase.table("profiles").update(payload).eq("id", profile_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return _with_email(result.data[0])
