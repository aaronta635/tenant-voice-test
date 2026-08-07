"""Marketplace categories.

Every field is read from public.service_categories; the provider count and the
"from" price are aggregated live from published providers and their active
services. Nothing here is hard-coded.
"""

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client


def _aggregate() -> tuple[dict[str, int], dict[str, float]]:
    """Return {category: published provider count} and {category: min active price}."""
    supabase = get_supabase_client()

    providers = (
        supabase.table("service_providers")
        .select("id, category")
        .eq("is_published", True)
        .execute()
        .data
        or []
    )

    counts: dict[str, int] = {}
    category_by_provider: dict[str, str] = {}
    for provider in providers:
        counts[provider["category"]] = counts.get(provider["category"], 0) + 1
        category_by_provider[provider["id"]] = provider["category"]

    from_price: dict[str, float] = {}
    if category_by_provider:
        services = (
            supabase.table("provider_services")
            .select("provider_id, price")
            .eq("is_active", True)
            .in_("provider_id", list(category_by_provider))
            .execute()
            .data
            or []
        )
        for service in services:
            category = category_by_provider.get(service["provider_id"])
            if category is None:
                continue
            price = float(service["price"])
            if category not in from_price or price < from_price[category]:
                from_price[category] = price

    return counts, from_price


def list_categories() -> list[dict]:
    supabase = get_supabase_client()
    rows = (
        supabase.table("service_categories")
        .select("*")
        .eq("is_active", True)
        .order("sort_order")
        .execute()
        .data
        or []
    )

    counts, from_price = _aggregate()
    for row in rows:
        row["provider_count"] = counts.get(row["category"], 0)
        row["from_price"] = from_price.get(row["category"])
    return rows


def get_category(slug: str) -> dict:
    for row in list_categories():
        if row["slug"] == slug:
            return row
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")


def enum_for_slug(slug: str | None) -> str | None:
    """Translate a URL slug ('co-host-inspector') into its enum value."""
    if not slug:
        return None
    supabase = get_supabase_client()
    result = (
        supabase.table("service_categories").select("category").eq("slug", slug).limit(1).execute()
    )
    return result.data[0]["category"] if result.data else None


def name_by_enum() -> dict[str, str]:
    supabase = get_supabase_client()
    rows = supabase.table("service_categories").select("category, name, slug").execute().data or []
    return {row["category"]: row["name"] for row in rows}


def slug_by_enum() -> dict[str, str]:
    supabase = get_supabase_client()
    rows = supabase.table("service_categories").select("category, slug").execute().data or []
    return {row["category"]: row["slug"] for row in rows}
