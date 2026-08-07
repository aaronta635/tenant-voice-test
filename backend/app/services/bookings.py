from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

ALLOWED_TRANSITIONS = {
    "new_enquiry": {"confirmed", "declined", "cancelled"},
    "confirmed": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "declined": set(),
    "cancelled": set(),
}


def decorate(bookings: list[dict]) -> list[dict]:
    """Attach client / provider names, the service title and the review rating.

    The bookings table only stores foreign keys; every screen that lists bookings
    needs human-readable labels, so they are resolved here in batch rather than
    being invented in the UI.
    """
    if not bookings:
        return []

    supabase = get_supabase_client()
    booking_ids = [b["id"] for b in bookings]
    client_ids = list({b["client_id"] for b in bookings})
    provider_ids = list({b["provider_id"] for b in bookings})
    service_ids = list({b["service_id"] for b in bookings if b.get("service_id")})

    profiles = (
        supabase.table("profiles")
        .select("id, full_name, avatar_url")
        .in_("id", client_ids)
        .execute()
        .data
        or []
    )
    profile_by_id = {p["id"]: p for p in profiles}

    providers = (
        supabase.table("service_providers")
        .select("id, business_name, profiles(full_name)")
        .in_("id", provider_ids)
        .execute()
        .data
        or []
    )
    provider_name_by_id = {
        p["id"]: p.get("business_name") or (p.get("profiles") or {}).get("full_name")
        for p in providers
    }

    service_title_by_id: dict[str, str] = {}
    if service_ids:
        services = (
            supabase.table("provider_services")
            .select("id, title")
            .in_("id", service_ids)
            .execute()
            .data
            or []
        )
        service_title_by_id = {s["id"]: s["title"] for s in services}

    reviews = (
        supabase.table("reviews")
        .select("booking_id, rating")
        .in_("booking_id", booking_ids)
        .execute()
        .data
        or []
    )
    rating_by_booking = {r["booking_id"]: r["rating"] for r in reviews if r.get("booking_id")}

    conversations = (
        supabase.table("conversations")
        .select("id, booking_id")
        .in_("booking_id", booking_ids)
        .execute()
        .data
        or []
    )
    unread_by_booking: dict[str, int] = {}
    if conversations:
        booking_by_conversation = {c["id"]: c["booking_id"] for c in conversations}
        unread = (
            supabase.table("messages")
            .select("conversation_id")
            .eq("is_read", False)
            .in_("conversation_id", list(booking_by_conversation))
            .execute()
            .data
            or []
        )
        for message in unread:
            booking_id = booking_by_conversation.get(message["conversation_id"])
            if booking_id:
                unread_by_booking[booking_id] = unread_by_booking.get(booking_id, 0) + 1

    for booking in bookings:
        profile = profile_by_id.get(booking["client_id"]) or {}
        booking["client_name"] = profile.get("full_name")
        booking["client_avatar_url"] = profile.get("avatar_url")
        booking["provider_name"] = provider_name_by_id.get(booking["provider_id"])
        booking["service_title"] = service_title_by_id.get(booking.get("service_id"))
        booking["review_rating"] = rating_by_booking.get(booking["id"])
        booking["unread_count"] = unread_by_booking.get(booking["id"], 0)

    return bookings


def create_booking(client_id: str, payload: dict) -> dict:
    supabase = get_supabase_client()

    provider_id = payload["provider_id"]
    provider_result = (
        supabase.table("service_providers")
        .select("id")
        .eq("id", provider_id)
        .eq("is_published", True)
        .limit(1)
        .execute()
    )
    if not provider_result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")

    price = None
    service_id = payload.get("service_id")
    if service_id:
        service_result = (
            supabase.table("provider_services")
            .select("price")
            .eq("id", service_id)
            .eq("provider_id", provider_id)
            .limit(1)
            .execute()
        )
        if not service_result.data:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found for this provider")
        price = service_result.data[0]["price"]

    insert_payload = {k: v for k, v in payload.items() if v is not None}
    insert_payload["client_id"] = client_id
    if price is not None:
        insert_payload["price"] = price

    result = supabase.table("bookings").insert(insert_payload).execute()
    return decorate(result.data)[0]


def get_booking(booking_id: str) -> dict:
    supabase = get_supabase_client()
    result = supabase.table("bookings").select("*").eq("id", booking_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return result.data[0]


def assert_participant(booking: dict, profile_id: str, provider_id: str | None) -> None:
    is_client = booking["client_id"] == profile_id
    is_provider = provider_id is not None and booking["provider_id"] == provider_id
    if not (is_client or is_provider):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this booking")


def list_bookings(profile_id: str, provider_id: str | None, status_filter: str | None) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table("bookings").select("*")

    if provider_id:
        query = query.or_(f"client_id.eq.{profile_id},provider_id.eq.{provider_id}")
    else:
        query = query.eq("client_id", profile_id)

    if status_filter:
        query = query.eq("status", status_filter)

    query = query.order("created_at", desc=True)
    return decorate(query.execute().data or [])


def update_booking(
    booking_id: str, profile_id: str, provider_id: str | None, payload: dict
) -> dict:
    booking = get_booking(booking_id)
    assert_participant(booking, profile_id, provider_id)

    is_provider = provider_id is not None and booking["provider_id"] == provider_id
    update_payload = {k: v for k, v in payload.items() if v is not None}

    new_status = update_payload.get("status")
    if new_status:
        allowed = ALLOWED_TRANSITIONS.get(booking["status"], set())
        if new_status not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot transition booking from {booking['status']} to {new_status}",
            )
        if new_status == "confirmed" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can confirm a booking")
        if new_status == "in_progress" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can start a booking")
        if new_status == "completed" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can complete a booking")
        if new_status == "declined" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can decline a booking")

    if "completion_report" in update_payload and not is_provider:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can set a completion report")

    if not update_payload:
        return decorate([booking])[0]

    supabase = get_supabase_client()
    result = supabase.table("bookings").update(update_payload).eq("id", booking_id).execute()
    return decorate(result.data)[0]
