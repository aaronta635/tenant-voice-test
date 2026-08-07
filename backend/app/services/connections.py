from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

TABLE = "connections"
PROFILE_FIELDS = "id, full_name, role, avatar_url, location, state"


def _decorate(rows: list[dict], me: str) -> list[dict]:
    """Attach the counterpart profile to each connection row."""
    if not rows:
        return []

    other_ids = {
        row["addressee_id"] if row["requester_id"] == me else row["requester_id"] for row in rows
    }
    supabase = get_supabase_client()
    profiles = (
        supabase.table("profiles").select(PROFILE_FIELDS).in_("id", list(other_ids)).execute().data
        or []
    )
    by_id = {p["id"]: p for p in profiles}

    decorated = []
    for row in rows:
        outgoing = row["requester_id"] == me
        other_id = row["addressee_id"] if outgoing else row["requester_id"]
        profile = by_id.get(other_id) or {}
        decorated.append(
            {
                **row,
                "person_id": other_id,
                "person_name": profile.get("full_name") or "TenantVoice member",
                "person_role": profile.get("role") or "tenant",
                "person_avatar_url": profile.get("avatar_url"),
                "person_location": profile.get("location"),
                "direction": "outgoing" if outgoing else "incoming",
            }
        )
    return decorated


def list_connections(profile_id: str, status_filter: str | None = None) -> list[dict]:
    supabase = get_supabase_client()
    query = (
        supabase.table(TABLE)
        .select("*")
        .or_(f"requester_id.eq.{profile_id},addressee_id.eq.{profile_id}")
    )
    if status_filter:
        query = query.eq("status", status_filter)
    rows = query.order("created_at", desc=True).execute().data or []
    return _decorate(rows, profile_id)


def create_connection(requester_id: str, addressee_id: str) -> dict:
    if requester_id == addressee_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot connect with yourself")

    supabase = get_supabase_client()
    target = supabase.table("profiles").select("id").eq("id", addressee_id).limit(1).execute()
    if not target.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    existing = (
        supabase.table(TABLE)
        .select("*")
        .or_(
            f"and(requester_id.eq.{requester_id},addressee_id.eq.{addressee_id}),"
            f"and(requester_id.eq.{addressee_id},addressee_id.eq.{requester_id})"
        )
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status.HTTP_409_CONFLICT, "A connection already exists with this member")

    result = (
        supabase.table(TABLE)
        .insert({"requester_id": requester_id, "addressee_id": addressee_id})
        .execute()
    )
    return _decorate(result.data, requester_id)[0]


def respond(connection_id: str, profile_id: str, new_status: str) -> dict:
    if new_status not in {"accepted", "declined"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Status must be accepted or declined")

    supabase = get_supabase_client()
    result = supabase.table(TABLE).select("*").eq("id", connection_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
    connection = result.data[0]

    if connection["addressee_id"] != profile_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the recipient can respond to a request")
    if connection["status"] != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This request has already been answered")

    updated = (
        supabase.table(TABLE)
        .update({"status": new_status, "responded_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", connection_id)
        .execute()
    )
    return _decorate(updated.data, profile_id)[0]


def remove(connection_id: str, profile_id: str) -> None:
    supabase = get_supabase_client()
    result = (
        supabase.table(TABLE)
        .delete()
        .eq("id", connection_id)
        .or_(f"requester_id.eq.{profile_id},addressee_id.eq.{profile_id}")
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")


def search_profiles(
    profile_id: str, search: str | None = None, role: str | None = None, limit: int = 24
) -> list[dict]:
    """Directory search used by the "Search profiles" / recommendation screens."""
    supabase = get_supabase_client()
    query = supabase.table("profiles").select(PROFILE_FIELDS).neq("id", profile_id)
    if role:
        query = query.eq("role", role)
    if search:
        query = query.or_(f"full_name.ilike.%{search}%,location.ilike.%{search}%")
    rows = query.order("full_name").limit(limit).execute().data or []

    existing = (
        supabase.table(TABLE)
        .select("requester_id, addressee_id, status")
        .or_(f"requester_id.eq.{profile_id},addressee_id.eq.{profile_id}")
        .execute()
        .data
        or []
    )
    status_by_person = {}
    for row in existing:
        other = row["addressee_id"] if row["requester_id"] == profile_id else row["requester_id"]
        status_by_person[other] = row["status"]

    for row in rows:
        row["connection_status"] = status_by_person.get(row["id"])
    return rows
