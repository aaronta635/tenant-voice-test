from app.core.supabase import get_supabase_client


def _decorate(transactions: list[dict]) -> list[dict]:
    """Attach the client name and the service title behind each ledger row."""
    if not transactions:
        return []

    supabase = get_supabase_client()
    booking_ids = list({t["booking_id"] for t in transactions if t.get("booking_id")})

    booking_by_id: dict[str, dict] = {}
    client_by_id: dict[str, dict] = {}
    service_title: dict[str, str] = {}

    if booking_ids:
        bookings = (
            supabase.table("bookings")
            .select("id, client_id, service_id, status")
            .in_("id", booking_ids)
            .execute()
            .data
            or []
        )
        booking_by_id = {b["id"]: b for b in bookings}

        client_ids = list({b["client_id"] for b in bookings})
        if client_ids:
            profiles = (
                supabase.table("profiles")
                .select("id, full_name, avatar_url")
                .in_("id", client_ids)
                .execute()
                .data
                or []
            )
            client_by_id = {p["id"]: p for p in profiles}

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

    for transaction in transactions:
        booking = booking_by_id.get(transaction.get("booking_id")) or {}
        client = client_by_id.get(booking.get("client_id")) or {}
        transaction["client_name"] = client.get("full_name")
        transaction["client_avatar_url"] = client.get("avatar_url")
        transaction["service_title"] = service_title.get(booking.get("service_id"))
        transaction["booking_status"] = booking.get("status")

    return transactions


def list_my_transactions(provider_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("transactions")
        .select("*")
        .eq("provider_id", provider_id)
        .order("created_at", desc=True)
        .execute()
    )
    return _decorate(result.data or [])
