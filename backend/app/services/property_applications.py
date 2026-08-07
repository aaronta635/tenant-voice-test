from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

TABLE = "property_applications"


def _attach_tenant_details(applications: list[dict]) -> list[dict]:
    """Enrich landlord-facing applications with the applicant's name + phone.

    The base row only carries tenant_id; owners need a human name. We batch-load
    the referenced profiles with the service-role client (one extra query).
    """
    tenant_ids = list({app["tenant_id"] for app in applications})
    if not tenant_ids:
        return applications

    supabase = get_supabase_client()
    profiles = (
        supabase.table("profiles")
        .select("id, full_name, phone")
        .in_("id", tenant_ids)
        .execute()
        .data
        or []
    )
    by_id = {p["id"]: p for p in profiles}
    for app in applications:
        profile = by_id.get(app["tenant_id"])
        app["tenant_name"] = profile["full_name"] if profile else None
        app["tenant_phone"] = profile.get("phone") if profile else None
    return applications


def _require_owned_property(property_id: str, owner_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table("properties")
        .select("*")
        .eq("id", property_id)
        .eq("owner_id", owner_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return result.data[0]


def create_application(tenant_id: str, payload: dict) -> dict:
    supabase = get_supabase_client()

    property_result = (
        supabase.table("properties")
        .select("id")
        .eq("id", payload["property_id"])
        .eq("status", "available")
        .limit(1)
        .execute()
    )
    if not property_result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found or not accepting applications")

    existing = (
        supabase.table(TABLE)
        .select("id")
        .eq("property_id", payload["property_id"])
        .eq("tenant_id", tenant_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status.HTTP_409_CONFLICT, "You have already applied to this property")

    insert_payload = {k: v for k, v in payload.items() if v is not None}
    insert_payload["tenant_id"] = tenant_id
    result = supabase.table(TABLE).insert(insert_payload).execute()
    return result.data[0]


def list_my_applications(tenant_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def list_property_applications(
    property_id: str, owner_id: str, status_filter: str | None = None
) -> list[dict]:
    _require_owned_property(property_id, owner_id)
    supabase = get_supabase_client()
    query = supabase.table(TABLE).select("*").eq("property_id", property_id)
    if status_filter:
        query = query.eq("status", status_filter)
    applications = query.order("created_at", desc=True).execute().data or []
    return _attach_tenant_details(applications)


def update_application(application_id: str, owner_id: str, payload: dict) -> dict:
    supabase = get_supabase_client()
    result = supabase.table(TABLE).select("*").eq("id", application_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
    application = result.data[0]

    _require_owned_property(application["property_id"], owner_id)

    payload = {k: v for k, v in payload.items() if v is not None}
    if not payload:
        return _attach_tenant_details([application])[0]

    updated = supabase.table(TABLE).update(payload).eq("id", application_id).execute()
    return _attach_tenant_details([updated.data[0]])[0]


def withdraw_application(application_id: str, tenant_id: str) -> None:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .delete()
        .eq("id", application_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
