from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

TABLE = "properties"


def list_my_properties(owner_id: str, status_filter: str | None = None) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table(TABLE).select("*").eq("owner_id", owner_id)
    if status_filter:
        query = query.eq("status", status_filter)
    return query.order("created_at", desc=True).execute().data or []


def get_my_property(property_id: str, owner_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("id", property_id)
        .eq("owner_id", owner_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return result.data[0]


def create_property(owner_id: str, payload: dict) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    payload["owner_id"] = owner_id
    supabase = get_supabase_client()
    result = supabase.table(TABLE).insert(payload).execute()
    return result.data[0]


def update_property(property_id: str, owner_id: str, payload: dict) -> dict:
    payload = {k: v for k, v in payload.items() if v is not None}
    if not payload:
        return get_my_property(property_id, owner_id)
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .update(payload)
        .eq("id", property_id)
        .eq("owner_id", owner_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return result.data[0]


def delete_property(property_id: str, owner_id: str) -> None:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE).delete().eq("id", property_id).eq("owner_id", owner_id).execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")


def list_amenities() -> list[str]:
    """Every amenity any listing has used — the picker vocabulary, from the DB."""
    supabase = get_supabase_client()
    rows = supabase.table(TABLE).select("amenities").execute().data or []
    return sorted({a for row in rows for a in (row.get("amenities") or [])})


def get_public_property(property_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("id", property_id)
        .eq("status", "available")
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return result.data[0]


def list_public_properties(
    location: str | None = None,
    property_type: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    bedrooms: int | None = None,
    sort: str = "newest",
    limit: int = 20,
    offset: int = 0,
) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table(TABLE).select("*").eq("status", "available")

    if property_type:
        query = query.eq("property_type", property_type)
    if min_price is not None:
        query = query.gte("price", min_price)
    if max_price is not None:
        query = query.lte("price", max_price)
    if bedrooms is not None:
        query = query.gte("bedrooms", bedrooms)
    if location:
        query = query.or_(
            f"suburb.ilike.%{location}%,state.ilike.%{location}%,"
            f"postcode.ilike.%{location}%,address.ilike.%{location}%"
        )

    if sort == "price_asc":
        query = query.order("price")
    elif sort == "price_desc":
        query = query.order("price", desc=True)
    else:
        query = query.order("created_at", desc=True)

    return query.range(offset, offset + limit - 1).execute().data or []
