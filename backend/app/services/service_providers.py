from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.services import categories as categories_service

PROFILE_FIELDS = "full_name,avatar_url,location,state,postcode,phone"

# Verification document types -> the badge label shown on public profiles.
VERIFICATION_LABELS = {
    "id": "ID",
    "abn": "ABN",
    "licence": "Licensed",
    "insurance": "Insured",
    "other": "Verified",
}

PRICE_UNIT_LABELS = {
    "flat": "fixed",
    "hourly": "per hour",
    "from": "from",
}


def get_provider_by_profile_id(profile_id: str) -> dict | None:
    supabase = get_supabase_client()
    result = (
        supabase.table("service_providers")
        .select("*")
        .eq("profile_id", profile_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def require_provider_by_profile_id(profile_id: str) -> dict:
    provider = get_provider_by_profile_id(profile_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No service provider profile for this account")
    return provider


def create_provider(profile_id: str, payload: dict) -> dict:
    if get_provider_by_profile_id(profile_id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Service provider profile already exists")
    payload = {k: v for k, v in payload.items() if v is not None}
    payload["profile_id"] = profile_id
    supabase = get_supabase_client()
    result = supabase.table("service_providers").insert(payload).execute()
    return result.data[0]


def update_provider(provider_id: str, payload: dict) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    supabase = get_supabase_client()
    if not payload:
        result = supabase.table("service_providers").select("*").eq("id", provider_id).limit(1).execute()
    else:
        result = supabase.table("service_providers").update(payload).eq("id", provider_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    return result.data[0]


# ---------------------------------------------------------------------------
# Public marketplace presentation
# ---------------------------------------------------------------------------
def _decorate(rows: list[dict]) -> list[dict]:
    """Resolve the derived fields the marketplace cards render.

    Verifications come from verification_documents, the "from" price and unit
    from the cheapest active service, and the category label from
    service_categories — none of it is hard-coded in the UI.
    """
    if not rows:
        return []

    supabase = get_supabase_client()
    provider_ids = [row["id"] for row in rows]

    documents = (
        supabase.table("verification_documents")
        .select("provider_id, type")
        .eq("status", "verified")
        .in_("provider_id", provider_ids)
        .execute()
        .data
        or []
    )
    verifications: dict[str, list[str]] = {}
    for document in documents:
        label = VERIFICATION_LABELS.get(document["type"], document["type"].title())
        bucket = verifications.setdefault(document["provider_id"], [])
        if label not in bucket:
            bucket.append(label)

    services = (
        supabase.table("provider_services")
        .select("provider_id, price, pricing_type")
        .eq("is_active", True)
        .in_("provider_id", provider_ids)
        .execute()
        .data
        or []
    )
    cheapest: dict[str, dict] = {}
    service_counts: dict[str, int] = {}
    for service in services:
        pid = service["provider_id"]
        service_counts[pid] = service_counts.get(pid, 0) + 1
        price = float(service["price"])
        if pid not in cheapest or price < cheapest[pid]["price"]:
            cheapest[pid] = {"price": price, "pricing_type": service["pricing_type"]}

    names = categories_service.name_by_enum()
    slugs = categories_service.slug_by_enum()

    for row in rows:
        pid = row["id"]
        row["verifications"] = verifications.get(pid, [])
        row["category_name"] = names.get(row["category"])
        row["category_slug"] = slugs.get(row["category"])
        row["service_count"] = service_counts.get(pid, 0)
        best = cheapest.get(pid)
        row["from_price"] = best["price"] if best else None
        row["price_unit"] = PRICE_UNIT_LABELS.get(best["pricing_type"]) if best else None

    return rows


def get_public_provider(provider_id: str) -> dict:
    """Look a published provider up by UUID *or* by its URL slug."""
    supabase = get_supabase_client()
    column = "slug" if not _looks_like_uuid(provider_id) else "id"
    result = (
        supabase.table("service_providers")
        .select(f"*, profiles({PROFILE_FIELDS})")
        .eq(column, provider_id)
        .eq("is_published", True)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    return _decorate(result.data)[0]


def _looks_like_uuid(value: str) -> bool:
    parts = value.split("-")
    return len(parts) == 5 and len(value) == 36


def list_public_providers(
    category: str | None = None,
    location: str | None = None,
    min_rating: float | None = None,
    search: str | None = None,
    sort: str = "rating",
    limit: int = 20,
    offset: int = 0,
) -> list[dict]:
    supabase = get_supabase_client()
    query = (
        supabase.table("service_providers")
        .select(f"*, profiles({PROFILE_FIELDS})")
        .eq("is_published", True)
    )

    if category:
        # Accept either the enum value or the URL slug.
        enum_value = category if "_" in category else categories_service.enum_for_slug(category)
        query = query.eq("category", enum_value or category)
    if min_rating is not None:
        query = query.gte("rating_avg", min_rating)
    if search:
        query = query.or_(f"business_name.ilike.%{search}%,tagline.ilike.%{search}%,bio.ilike.%{search}%")

    if sort == "newest":
        query = query.order("created_at", desc=True)
    elif sort == "reviews":
        query = query.order("review_count", desc=True)
    else:
        query = query.order("rating_avg", desc=True)

    query = query.range(offset, offset + limit - 1)
    result = query.execute()
    rows = result.data or []

    if location:
        needle = location.lower()
        rows = [
            r
            for r in rows
            if r.get("profiles")
            and needle
            in " ".join(
                filter(
                    None,
                    [r["profiles"].get("location"), r["profiles"].get("state"), r["profiles"].get("postcode")],
                )
            ).lower()
        ]

    return _decorate(rows)
