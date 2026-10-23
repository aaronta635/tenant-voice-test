"""A provider's ledger rows (web.transactions) for the finance table (migration plan §3 c3)."""

from app.core.supabase import web_table
from app.services import _common, provider_services
from app.services import bookings as bookings_service

# In the web schema: query it with web_table(TABLE).
TABLE = "transactions"


def _decorate(transactions: list[dict]) -> list[dict]:
    """Attach the client name and the service title behind each ledger row."""
    if not transactions:
        return []

    booking_ids = {t["booking_id"] for t in transactions if t.get("booking_id")}
    bookings = _common.select_in(
        lambda: web_table(bookings_service.TABLE).select("id, client_id, service_id, status").order("id"),
        "id",
        booking_ids,
    )
    booking_by_id = {b["id"]: b for b in bookings}
    # Clients are users rows; someone whose account is gone is unnamed.
    client_by_id = bookings_service.people_by_id(b["client_id"] for b in bookings)
    services = provider_services.services_by_id({b["service_id"] for b in bookings if b.get("service_id")})

    for transaction in transactions:
        booking = booking_by_id.get(transaction.get("booking_id")) or {}
        client = client_by_id.get(booking.get("client_id")) or {}
        transaction["client_name"] = client.get("full_name") or None
        transaction["client_avatar_url"] = client.get("avatar_url")
        transaction["service_title"] = (services.get(booking.get("service_id")) or {}).get("title")
        transaction["booking_status"] = booking.get("status")

    return transactions


def list_my_transactions(provider_id: str) -> list[dict]:
    rows = _common.select_all(
        lambda: web_table(TABLE).select("*").eq("provider_id", provider_id).order("created_at", desc=True).order("id")
    )
    return _decorate(rows)
