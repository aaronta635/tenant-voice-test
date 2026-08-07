from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client


def decorate(reviews: list[dict]) -> list[dict]:
    """Attach the reviewer's name and the reviewed service / location."""
    if not reviews:
        return []

    supabase = get_supabase_client()
    client_ids = list({r["client_id"] for r in reviews})
    booking_ids = [r["booking_id"] for r in reviews if r.get("booking_id")]

    profiles = (
        supabase.table("profiles")
        .select("id, full_name, avatar_url, location, state")
        .in_("id", client_ids)
        .execute()
        .data
        or []
    )
    profile_by_id = {p["id"]: p for p in profiles}

    booking_by_id: dict[str, dict] = {}
    service_title: dict[str, str] = {}
    if booking_ids:
        bookings = (
            supabase.table("bookings")
            .select("id, service_id, property_suburb")
            .in_("id", booking_ids)
            .execute()
            .data
            or []
        )
        booking_by_id = {b["id"]: b for b in bookings}
        service_ids = list({b["service_id"] for b in bookings if b.get("service_id")})
        if service_ids:
            services = (
                supabase.table("provider_services")
                .select("id, title")
                .in_("id", service_ids)
                .execute()
                .data
                or []
            )
            service_title = {s["id"]: s["title"] for s in services}

    for review in reviews:
        profile = profile_by_id.get(review["client_id"]) or {}
        booking = booking_by_id.get(review.get("booking_id")) or {}
        review["client_name"] = profile.get("full_name")
        review["client_avatar_url"] = profile.get("avatar_url")
        review["service_title"] = service_title.get(booking.get("service_id"))
        review["location"] = booking.get("property_suburb") or ", ".join(
            filter(None, [profile.get("location"), profile.get("state")])
        ) or None

    return reviews


def create_review(client_id: str, payload: dict) -> dict:
    supabase = get_supabase_client()

    booking_result = (
        supabase.table("bookings").select("*").eq("id", payload["booking_id"]).limit(1).execute()
    )
    if not booking_result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    booking = booking_result.data[0]

    if booking["client_id"] != client_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only review your own bookings")
    if booking["status"] != "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can only review a completed booking")

    existing = (
        supabase.table("reviews").select("id").eq("booking_id", booking["id"]).limit(1).execute()
    )
    if existing.data:
        raise HTTPException(status.HTTP_409_CONFLICT, "This booking has already been reviewed")

    insert_payload = {
        "booking_id": booking["id"],
        "provider_id": booking["provider_id"],
        "client_id": client_id,
        "rating": payload["rating"],
        "comment": payload.get("comment"),
    }
    result = supabase.table("reviews").insert(insert_payload).execute()
    return decorate(result.data)[0]


def list_provider_reviews(provider_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("reviews")
        .select("*")
        .eq("provider_id", provider_id)
        .order("created_at", desc=True)
        .execute()
    )
    return decorate(result.data or [])


def get_review(review_id: str) -> dict:
    supabase = get_supabase_client()
    result = supabase.table("reviews").select("*").eq("id", review_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    return result.data[0]


def reply_to_review(review_id: str, provider_id: str, reply: str) -> dict:
    review = get_review(review_id)
    if review["provider_id"] != provider_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only reply to your own reviews")

    supabase = get_supabase_client()
    result = (
        supabase.table("reviews")
        .update({"provider_reply": reply, "replied_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", review_id)
        .execute()
    )
    return decorate(result.data)[0]


def flag_review(review_id: str) -> dict:
    get_review(review_id)
    supabase = get_supabase_client()
    result = supabase.table("reviews").update({"is_flagged": True}).eq("id", review_id).execute()
    return decorate(result.data)[0]


def list_my_reviews(provider_id: str) -> list[dict]:
    return list_provider_reviews(provider_id)
