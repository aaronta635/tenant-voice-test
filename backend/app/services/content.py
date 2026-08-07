"""Editorial / reference content: FAQs, support contacts, platform stats,
notifications and property inspection times — all read from Supabase.
"""

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

SUPPORT_EMAIL_KEY = "support_email"
SUPPORT_PHONE_KEY = "support_phone"


# ---------------------------------------------------------------------------
# FAQs
# ---------------------------------------------------------------------------
def list_faqs(audience: str | None = None) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table("faqs").select("*").eq("is_active", True)
    if audience:
        query = query.in_("audience", [audience, "all"])
    return query.order("sort_order").execute().data or []


# ---------------------------------------------------------------------------
# Platform settings
# ---------------------------------------------------------------------------
def get_settings(keys: list[str] | None = None) -> dict[str, str]:
    supabase = get_supabase_client()
    query = supabase.table("platform_settings").select("key, value")
    if keys:
        query = query.in_("key", keys)
    rows = query.execute().data or []
    return {row["key"]: row["value"] for row in rows}


def get_support_contact() -> dict:
    settings = get_settings([SUPPORT_EMAIL_KEY, SUPPORT_PHONE_KEY])
    missing = [k for k in (SUPPORT_EMAIL_KEY, SUPPORT_PHONE_KEY) if k not in settings]
    if missing:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Support contact details are not configured ({', '.join(missing)})",
        )
    return {"email": settings[SUPPORT_EMAIL_KEY], "phone": settings[SUPPORT_PHONE_KEY]}


# ---------------------------------------------------------------------------
# Marketplace trust statistics (landing page)
# ---------------------------------------------------------------------------
def _count(table: str, **filters) -> int:
    supabase = get_supabase_client()
    query = supabase.table(table).select("id", count="exact")
    for column, value in filters.items():
        query = query.eq(column, value)
    result = query.limit(1).execute()
    return result.count or 0


def get_platform_stats() -> dict:
    supabase = get_supabase_client()

    verified_providers = _count("service_providers", is_published=True)
    jobs_completed = _count("bookings", status="completed")
    category_count = _count("service_categories", is_active=True)

    ratings = supabase.table("reviews").select("rating").execute().data or []
    review_count = len(ratings)
    average_rating = (
        round(sum(r["rating"] for r in ratings) / review_count, 2) if review_count else 0.0
    )
    satisfied = sum(1 for r in ratings if r["rating"] >= 4)
    satisfaction_pct = round(satisfied / review_count * 100) if review_count else 0

    return {
        "verified_providers": verified_providers,
        "jobs_completed": jobs_completed,
        "average_rating": average_rating,
        "satisfaction_pct": satisfaction_pct,
        "review_count": review_count,
        "category_count": category_count,
    }


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
def list_notifications(profile_id: str, unread_only: bool = False, limit: int = 50) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table("notifications").select("*").eq("user_id", profile_id)
    if unread_only:
        query = query.eq("is_read", False)
    return query.order("created_at", desc=True).limit(limit).execute().data or []


def mark_notification_read(notification_id: str, profile_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table("notifications")
        .update({"is_read": True})
        .eq("id", notification_id)
        .eq("user_id", profile_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    return result.data[0]


def mark_all_notifications_read(profile_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("notifications")
        .update({"is_read": True})
        .eq("user_id", profile_id)
        .eq("is_read", False)
        .execute()
    )
    return result.data or []


# ---------------------------------------------------------------------------
# Property inspection times
# ---------------------------------------------------------------------------
def list_inspections(property_id: str) -> list[dict]:
    supabase = get_supabase_client()
    return (
        supabase.table("property_inspections")
        .select("*")
        .eq("property_id", property_id)
        .eq("is_active", True)
        .order("starts_at")
        .execute()
        .data
        or []
    )


def create_inspection(property_id: str, owner_id: str, payload: dict) -> dict:
    supabase = get_supabase_client()
    owned = (
        supabase.table("properties")
        .select("id")
        .eq("id", property_id)
        .eq("owner_id", owner_id)
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")

    insert_payload = {k: v for k, v in payload.items() if v is not None}
    insert_payload["property_id"] = property_id
    return supabase.table("property_inspections").insert(insert_payload).execute().data[0]


def delete_inspection(inspection_id: str, owner_id: str) -> None:
    supabase = get_supabase_client()
    row = (
        supabase.table("property_inspections")
        .select("property_id")
        .eq("id", inspection_id)
        .limit(1)
        .execute()
    )
    if not row.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Inspection not found")

    owned = (
        supabase.table("properties")
        .select("id")
        .eq("id", row.data[0]["property_id"])
        .eq("owner_id", owner_id)
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not own this property")

    supabase.table("property_inspections").delete().eq("id", inspection_id).execute()
