"""Conversations.

A thread is either a **marketplace** thread (client_id + provider_id) or a
**rental** thread (tenant_id + owner_id [+ property_id]) — see
docs/messaging-plan.md and migration 0005_messaging.sql.

Every list response is decorated with the counterpart's name, a context line,
the last message preview and an unread count, so the UI renders real data
instead of placeholder strings.
"""

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

TABLE = "conversations"


def _is_participant(conversation: dict, profile_id: str, provider_id: str | None) -> bool:
    if conversation.get("client_id") == profile_id:
        return True
    if conversation.get("owner_id") == profile_id:
        return True
    if conversation.get("tenant_id") == profile_id:
        return True
    return provider_id is not None and conversation.get("provider_id") == provider_id


def _kind(conversation: dict) -> str:
    return "rental" if conversation.get("tenant_id") else "marketplace"


# ---------------------------------------------------------------------------
# Decoration
# ---------------------------------------------------------------------------
def _decorate(conversations: list[dict], me: str, my_provider_id: str | None) -> list[dict]:
    if not conversations:
        return []

    supabase = get_supabase_client()
    conversation_ids = [c["id"] for c in conversations]

    # --- last message + unread count -------------------------------------
    messages = (
        supabase.table("messages")
        .select("conversation_id, sender_id, body, is_read, created_at")
        .in_("conversation_id", conversation_ids)
        .order("created_at")
        .execute()
        .data
        or []
    )
    last_message: dict[str, str] = {}
    unread: dict[str, int] = {}
    for message in messages:
        last_message[message["conversation_id"]] = message["body"]
        if not message["is_read"] and message["sender_id"] != me:
            key = message["conversation_id"]
            unread[key] = unread.get(key, 0) + 1

    # --- counterpart profile ---------------------------------------------
    provider_ids = {c["provider_id"] for c in conversations if c.get("provider_id")}
    provider_profile_id: dict[str, str] = {}
    provider_label: dict[str, str] = {}
    if provider_ids:
        providers = (
            supabase.table("service_providers")
            .select("id, profile_id, business_name")
            .in_("id", list(provider_ids))
            .execute()
            .data
            or []
        )
        for provider in providers:
            provider_profile_id[provider["id"]] = provider["profile_id"]
            if provider.get("business_name"):
                provider_label[provider["id"]] = provider["business_name"]

    counterpart_ids: dict[str, str | None] = {}
    for conversation in conversations:
        if _kind(conversation) == "rental":
            other = (
                conversation["owner_id"]
                if conversation["tenant_id"] == me
                else conversation["tenant_id"]
            )
        else:
            mine_as_provider = (
                my_provider_id is not None and conversation.get("provider_id") == my_provider_id
            )
            other = (
                conversation["client_id"]
                if mine_as_provider
                else provider_profile_id.get(conversation.get("provider_id"))
            )
        counterpart_ids[conversation["id"]] = other

    profile_ids = {pid for pid in counterpart_ids.values() if pid}
    profiles = (
        supabase.table("profiles")
        .select("id, full_name, role, avatar_url")
        .in_("id", list(profile_ids))
        .execute()
        .data
        or []
    ) if profile_ids else []
    profile_by_id = {p["id"]: p for p in profiles}

    # --- context (property address or booking service) --------------------
    property_ids = {c["property_id"] for c in conversations if c.get("property_id")}
    property_by_id: dict[str, dict] = {}
    if property_ids:
        rows = (
            supabase.table("properties")
            .select("id, title, address, suburb")
            .in_("id", list(property_ids))
            .execute()
            .data
            or []
        )
        property_by_id = {r["id"]: r for r in rows}

    booking_ids = {c["booking_id"] for c in conversations if c.get("booking_id")}
    booking_by_id: dict[str, dict] = {}
    if booking_ids:
        rows = (
            supabase.table("bookings")
            .select(
                "id, status, service_id, scheduled_date, scheduled_time, "
                "property_address, property_suburb, price"
            )
            .in_("id", list(booking_ids))
            .execute()
            .data
            or []
        )
        service_ids = {r["service_id"] for r in rows if r.get("service_id")}
        service_title: dict[str, str] = {}
        if service_ids:
            services = (
                supabase.table("provider_services")
                .select("id, title")
                .in_("id", list(service_ids))
                .execute()
                .data
                or []
            )
            service_title = {s["id"]: s["title"] for s in services}
        for row in rows:
            row["service_title"] = service_title.get(row.get("service_id"))
            booking_by_id[row["id"]] = row

    for conversation in conversations:
        conversation["kind"] = _kind(conversation)
        other_id = counterpart_ids[conversation["id"]]
        profile = profile_by_id.get(other_id) if other_id else None
        conversation["counterpart_id"] = other_id
        conversation["counterpart_name"] = (
            provider_label.get(conversation.get("provider_id"))
            or (profile or {}).get("full_name")
        )
        conversation["counterpart_role"] = (profile or {}).get("role")
        conversation["counterpart_avatar_url"] = (profile or {}).get("avatar_url")
        conversation["last_message"] = last_message.get(conversation["id"])
        conversation["unread_count"] = unread.get(conversation["id"], 0)

        booking = booking_by_id.get(conversation.get("booking_id"))
        if booking:
            conversation["booking"] = {
                "id": booking["id"],
                "status": booking["status"],
                "service_title": booking.get("service_title"),
                "scheduled_date": booking.get("scheduled_date"),
                "scheduled_time": booking.get("scheduled_time"),
                "property_address": booking.get("property_address"),
                "price": booking.get("price"),
            }

        prop = property_by_id.get(conversation.get("property_id"))
        context_parts = []
        if prop:
            context_parts.append(prop.get("suburb") or prop.get("address") or prop["title"])
        if booking and booking.get("service_title"):
            context_parts.append(booking["service_title"])
        elif booking and booking.get("property_suburb"):
            context_parts.append(booking["property_suburb"])
        if not context_parts and conversation.get("subject"):
            context_parts.append(conversation["subject"])
        conversation["context"] = " · ".join(context_parts) or None

    return conversations


# ---------------------------------------------------------------------------
# Marketplace threads
# ---------------------------------------------------------------------------
def create_conversation(profile_id: str, provider_id: str | None, payload: dict) -> dict:
    supabase = get_supabase_client()

    target_provider_id = payload["provider_id"]
    provider_result = (
        supabase.table("service_providers").select("id").eq("id", target_provider_id).limit(1).execute()
    )
    if not provider_result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")

    is_owner = provider_id is not None and provider_id == target_provider_id
    insert_payload = {
        "provider_id": target_provider_id,
        "booking_id": payload.get("booking_id"),
        "subject": payload.get("subject"),
        "client_id": profile_id if not is_owner else payload.get("client_id"),
    }
    if not insert_payload["client_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "client_id is required")

    result = supabase.table(TABLE).insert(insert_payload).execute()
    return _decorate(result.data, profile_id, provider_id)[0]


# ---------------------------------------------------------------------------
# Rental threads (tenant <-> owner)
# ---------------------------------------------------------------------------
def create_rental_conversation(profile_id: str, role: str, payload: dict) -> dict:
    supabase = get_supabase_client()

    property_id = payload.get("property_id")
    owner_id = payload.get("owner_id")
    tenant_id = profile_id

    if property_id:
        prop = (
            supabase.table("properties")
            .select("id, owner_id, title")
            .eq("id", property_id)
            .limit(1)
            .execute()
        )
        if not prop.data:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
        owner_id = prop.data[0]["owner_id"]

    if not owner_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Provide either property_id or owner_id"
        )

    if role == "landlord":
        # A landlord starting the thread messages a tenant instead.
        if not payload.get("owner_id"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Landlords must pass the tenant id as owner_id"
            )
        tenant_id = payload["owner_id"]
        owner_id = profile_id

    if owner_id == tenant_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot message yourself")

    query = supabase.table(TABLE).select("*").eq("owner_id", owner_id).eq("tenant_id", tenant_id)
    query = query.eq("property_id", property_id) if property_id else query.is_("property_id", "null")
    existing = query.limit(1).execute()

    if existing.data:
        conversation = existing.data[0]
    else:
        conversation = (
            supabase.table(TABLE)
            .insert(
                {
                    "owner_id": owner_id,
                    "tenant_id": tenant_id,
                    "property_id": property_id,
                    "subject": payload.get("subject"),
                }
            )
            .execute()
            .data[0]
        )

    body = (payload.get("body") or "").strip()
    if body:
        supabase.table("messages").insert(
            {"conversation_id": conversation["id"], "sender_id": profile_id, "body": body}
        ).execute()
        conversation = (
            supabase.table(TABLE).select("*").eq("id", conversation["id"]).limit(1).execute().data[0]
        )

    return _decorate([conversation], profile_id, None)[0]


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def list_conversations(profile_id: str, provider_id: str | None) -> list[dict]:
    supabase = get_supabase_client()
    filters = [f"client_id.eq.{profile_id}", f"owner_id.eq.{profile_id}", f"tenant_id.eq.{profile_id}"]
    if provider_id:
        filters.append(f"provider_id.eq.{provider_id}")

    rows = (
        supabase.table(TABLE)
        .select("*")
        .or_(",".join(filters))
        .order("last_message_at", desc=True, nullsfirst=False)
        .execute()
        .data
        or []
    )
    return _decorate(rows, profile_id, provider_id)


def get_conversation(conversation_id: str, profile_id: str, provider_id: str | None) -> dict:
    supabase = get_supabase_client()
    result = supabase.table(TABLE).select("*").eq("id", conversation_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    conversation = result.data[0]
    if not _is_participant(conversation, profile_id, provider_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this conversation")
    return _decorate([conversation], profile_id, provider_id)[0]


def list_messages(conversation_id: str, profile_id: str, provider_id: str | None) -> list[dict]:
    get_conversation(conversation_id, profile_id, provider_id)
    supabase = get_supabase_client()
    rows = (
        supabase.table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    if not rows:
        return []

    sender_ids = list({r["sender_id"] for r in rows})
    profiles = (
        supabase.table("profiles").select("id, full_name").in_("id", sender_ids).execute().data or []
    )
    name_by_id = {p["id"]: p["full_name"] for p in profiles}
    for row in rows:
        row["sender_name"] = name_by_id.get(row["sender_id"])
    return rows


def create_message(conversation_id: str, sender_id: str, provider_id: str | None, payload: dict) -> dict:
    get_conversation(conversation_id, sender_id, provider_id)
    supabase = get_supabase_client()
    insert_payload = {k: v for k, v in payload.items() if v is not None}
    insert_payload["conversation_id"] = conversation_id
    insert_payload["sender_id"] = sender_id
    result = supabase.table("messages").insert(insert_payload).execute()
    message = result.data[0]

    profile = supabase.table("profiles").select("full_name").eq("id", sender_id).limit(1).execute()
    message["sender_name"] = profile.data[0]["full_name"] if profile.data else None
    return message


def mark_read(conversation_id: str, profile_id: str, provider_id: str | None) -> int:
    """Mark the *other* party's messages as read; returns how many changed."""
    get_conversation(conversation_id, profile_id, provider_id)
    supabase = get_supabase_client()
    result = (
        supabase.table("messages")
        .update({"is_read": True})
        .eq("conversation_id", conversation_id)
        .eq("is_read", False)
        .neq("sender_id", profile_id)
        .execute()
    )
    return len(result.data or [])
