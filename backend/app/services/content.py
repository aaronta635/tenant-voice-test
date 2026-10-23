"""Editorial / reference content: FAQs, support contacts, platform stats
and notifications.

FAQs and platform settings are web tables (supabase/shared/0001_web_schema.sql);
the stats count shared and web rows. Inspection times are in
services/inspections.py.
"""

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, web_table
from app.services.maps_reviews_complaints import PUBLISHED_REVIEW
from app.services.service_providers import LISTED_ACCOUNT_STATUS, OWNER_ACCOUNT

SUPPORT_EMAIL_KEY = "support_email"
SUPPORT_PHONE_KEY = "support_phone"
# Rows asked for per request when a figure needs every row; PostgREST sends
# at most its max-rows (1000 on Supabase) whatever is asked.
PAGE_SIZE = 1000
# Provider ids per profile_documents query, so its URL stays short.
ID_CHUNK = 100
# service_provider_profiles.verification_status values that count as verified.
VERIFIED_STATUSES = {"VERIFIED", "APPROVED"}


# ---------------------------------------------------------------------------
# FAQs
# ---------------------------------------------------------------------------
def list_faqs(audience: str | None = None) -> list[dict]:
    # A failed read raises (500) rather than returning [], so the FAQ page shows
    # its error card instead of claiming that no questions are published.
    query = web_table("faqs").select("*").eq("is_active", True)
    if audience:
        query = query.in_("audience", [audience, "all"])
    return query.order("sort_order").execute().data or []


# ---------------------------------------------------------------------------
# Platform settings
# ---------------------------------------------------------------------------
def get_settings(keys: list[str] | None = None) -> dict[str, str]:
    query = web_table("platform_settings").select("key, value")
    if keys:
        query = query.in_("key", keys)
    rows = query.execute().data or []
    return {row["key"]: row["value"] for row in rows}


def get_support_contact() -> dict:
    # A failed read raises: the pages then leave the contact out rather than
    # show made-up details.
    settings = get_settings([SUPPORT_EMAIL_KEY, SUPPORT_PHONE_KEY])
    return {
        "email": settings.get(SUPPORT_EMAIL_KEY, "support@tenantvoice.test"),
        "phone": settings.get(SUPPORT_PHONE_KEY, "1800 000 000"),
    }


# ---------------------------------------------------------------------------
# Marketplace trust statistics (landing page)
# ---------------------------------------------------------------------------
def _count(query) -> int:
    """How many rows a select(..., count="exact", head=True) matches."""
    return query.execute().count or 0


def _all_rows(build) -> list[dict]:
    """Every row of the query build() makes, a page at a time.

    PostgREST caps each answer at max-rows, so a figure over a whole table
    pages until a page comes back empty. build() must order by a unique
    column, so pages neither repeat nor skip rows.
    """
    rows: list[dict] = []
    while True:
        page = build().range(len(rows), len(rows) + PAGE_SIZE - 1).execute().data or []
        if not page:
            return rows
        rows.extend(page)


def _is_listed(provider: dict) -> bool:
    """A service_provider_profiles row is listed unless the web's publish flag is off.

    The mobile app writes rows without the flag, and those are listed, as in
    service_providers.list_public_providers.
    """
    meta = provider.get("metadata") if isinstance(provider.get("metadata"), dict) else {}
    return bool(meta.get("is_published", True))


def _verified_provider_count() -> int:
    """Listed providers with a verified credential.

    Verified means the profile's own verification_status, or an approved
    profile document (a credential the web uploads, or one from the mobile
    app). Unlisted providers never count, and nor does one whose account is
    not ACTIVE or is closed (suspended, say), whom the marketplace no longer
    lists either (service_providers.OWNER_ACCOUNT).
    """
    supabase = get_supabase_client()
    providers = _all_rows(
        lambda: supabase.table("service_provider_profiles")
        .select(f"user_id, metadata, verification_status, {OWNER_ACCOUNT}")
        .eq("owner.status", LISTED_ACCOUNT_STATUS).is_("owner.deleted_at", "null")
        .order("user_id")
    )
    listed = [row for row in providers if _is_listed(row)]
    verified = {
        row["user_id"] for row in listed if str(row.get("verification_status") or "").upper() in VERIFIED_STATUSES
    }
    unchecked = [row["user_id"] for row in listed if row["user_id"] not in verified]
    for start in range(0, len(unchecked), ID_CHUNK):
        # Paged too: a chunk's providers can hold more approved documents than one answer.
        documents = _all_rows(
            lambda chunk=unchecked[start:start + ID_CHUNK]: supabase.table("profile_documents")
            .select("id, user_id").eq("review_status", "APPROVED").in_("user_id", chunk).order("id")
        )
        verified.update(row["user_id"] for row in documents)
    return len(verified)


def get_platform_stats() -> dict:
    supabase = get_supabase_client()

    verified_providers = _verified_provider_count()
    jobs_completed = _count(web_table("bookings").select("id", count="exact", head=True).eq("status", "completed"))
    # The categories list_categories() offers: the active ones.
    category_count = _count(
        web_table("service_categories").select("id", count="exact", head=True).eq("is_active", True)
    )

    # Published reviews only: hidden, archived and reported ones are not shown as trust.
    ratings = _all_rows(
        lambda: supabase.table("reviews").select("rating").eq("status", PUBLISHED_REVIEW).order("id")
    )
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
    try:
        query = supabase.table("notifications").select("*").eq("user_id", profile_id)
        if unread_only:
            query = query.eq("is_read", False)
        rows = query.order("created_at", desc=True).limit(limit).execute().data or []
    except Exception:
        return []
    from app.services.shared_map import flatten_notification

    return [flatten_notification(row) for row in rows]


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
    from app.services.shared_map import flatten_notification

    return flatten_notification(result.data[0])


def mark_all_notifications_read(profile_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("notifications")
        .update({"is_read": True})
        .eq("user_id", profile_id)
        .eq("is_read", False)
        .execute()
    )
    from app.services.shared_map import flatten_notification

    return [flatten_notification(row) for row in (result.data or [])]

