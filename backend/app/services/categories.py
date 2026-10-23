"""Marketplace categories.

Every field is read from web.service_categories (supabase/shared/); the
provider count and the "from" price are aggregated live from published
providers and their live services. Nothing here is hard-coded.
"""

from fastapi import HTTPException, status

from app.core.supabase import web_table
from app.services import provider_services

TABLE = "service_categories"


def _catalogue(active_only: bool = False) -> list[dict]:
    query = web_table(TABLE).select("*")
    if active_only:
        query = query.eq("is_active", True)
    return query.order("sort_order").order("slug").execute().data or []


def _aggregate() -> tuple[dict[str, int], dict[str, float]]:
    """Return {category: listed provider count} and {category: lowest live price}.

    Counts the providers the marketplace lists, read as the listing reads
    them (a row from the mobile app has no publish flag and is listed). A
    service priced 0 has no price yet, so it sets no "from" price.
    """
    # Imported here because service_providers imports this module.
    from app.services import service_providers

    category_by_provider = {
        provider["id"]: provider["category"]
        for provider in service_providers.published_providers()
        if provider["category"]  # a provider who has not picked one yet
    }
    counts: dict[str, int] = {}
    for category in category_by_provider.values():
        counts[category] = counts.get(category, 0) + 1

    from_price: dict[str, float] = {}
    for service in provider_services.live_services(list(category_by_provider)):
        category = category_by_provider[service["provider_id"]]
        price = service["price"]
        if price > 0 and (category not in from_price or price < from_price[category]):
            from_price[category] = price

    return counts, from_price


def list_categories() -> list[dict]:
    rows = _catalogue(active_only=True)
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


def by_code() -> dict[str, dict]:
    """Every catalogue row, active or not, by its category code."""
    return {row["category"]: row for row in _catalogue()}


def code_for(value: str | None) -> str | None:
    """The category code a URL slug ('co-host-inspector') or a code names; None if unknown."""
    if not value:
        return None
    for row in _catalogue():
        if value in (row["slug"], row["category"]):
            return row["category"]
    return None
