"""A provider's invoices (web.invoices, migration plan §3 c3).

The ledger raises one per priced booking (ledger.py); a provider may also
write their own. The printed invoice names the provider and the client from
their users rows and the job from its web.bookings row and service.
"""

from datetime import date, datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import web_table
from app.schemas.invoices import ALLOWED_TRANSITIONS
from app.services import _common, provider_services
from app.services import bookings as bookings_service
from app.services.maps_bookings import place
from app.services.maps_messaging import is_uuid

# In the web schema: query it with web_table(TABLE).
TABLE = "invoices"


def _owned(invoice_id: str, provider_id: str) -> dict:
    # id is a uuid column: anything else is no invoice, not a 22P02.
    if not is_uuid(invoice_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return _common.get_owned(TABLE, invoice_id, provider_id, web=True)


def list_my_invoices(provider_id: str) -> list[dict]:
    """The provider's invoices, newest first, read page by page past PostgREST's max-rows cap."""
    return _common.select_all(
        lambda: web_table(TABLE).select("*").eq("provider_id", provider_id).order("created_at", desc=True).order("id")
    )


def get_my_invoice(invoice_id: str, provider_id: str) -> dict:
    return _owned(invoice_id, provider_id)


def create_invoice(provider_id: str, payload: dict) -> dict:
    booking_id = payload.get("booking_id")
    if booking_id:
        owned = is_uuid(booking_id) and (
            web_table(bookings_service.TABLE)
            .select("id")
            .eq("id", booking_id)
            .eq("provider_id", provider_id)
            .limit(1)
            .execute()
            .data
        )
        if not owned:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return _common.create_owned(TABLE, provider_id, payload, web=True)


def update_invoice(invoice_id: str, provider_id: str, payload: dict) -> dict:
    invoice = _owned(invoice_id, provider_id)
    payload = {k: v for k, v in payload.items() if v is not None}

    new_status = payload.get("status")
    if new_status:
        allowed = ALLOWED_TRANSITIONS.get(invoice["status"], set())
        if new_status not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot transition invoice from {invoice['status']} to {new_status}",
            )
        if new_status == "issued":
            payload["issued_at"] = datetime.now(timezone.utc).isoformat()

    return _common.update_owned(TABLE, invoice_id, provider_id, payload, web=True)


def delete_invoice(invoice_id: str, provider_id: str) -> None:
    invoice = _owned(invoice_id, provider_id)
    if invoice["status"] != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only draft invoices can be deleted")
    _common.delete_owned(TABLE, invoice_id, provider_id, web=True)


def _booking(booking_id: str | None) -> dict:
    """The web.bookings row an invoice is for; {} for an invoice of no booking."""
    if not booking_id:
        return {}
    rows = web_table(bookings_service.TABLE).select("*").eq("id", booking_id).limit(1).execute().data
    return rows[0] if rows else {}


def invoice_document(invoice_id: str, provider: dict) -> dict:
    """The invoice plus the provider, client and job details printed on it.

    `provider` is the caller's own provider record (service_providers).
    """
    invoice = _owned(invoice_id, provider["id"])
    booking = _booking(invoice.get("booking_id"))
    people = bookings_service.people_by_id([provider.get("profile_id"), booking.get("client_id")])
    owner = people.get(provider.get("profile_id")) or {}
    client = people.get(booking.get("client_id")) or {}
    services = provider_services.services_by_id([booking["service_id"]] if booking.get("service_id") else [])
    service = services.get(booking.get("service_id")) or {}

    scheduled = booking.get("scheduled_date")
    when = None
    if scheduled:
        day = date.fromisoformat(str(scheduled)[:10])
        when = f"{day.day} {day.strftime('%b %Y')}"
    detail = " · ".join(
        str(part) for part in (when, booking.get("property_address"), booking.get("property_suburb")) if part
    )
    return {
        **invoice,
        "provider": {
            "name": provider.get("business_name") or owner.get("full_name") or None,
            "abn": provider.get("abn"),
            "location": place(owner),
            "phone": owner.get("phone"),
        },
        "client": {"name": client.get("full_name") or None, "location": booking.get("property_suburb") or place(client)},
        "lines": [
            {
                "description": service.get("title") or "Service",
                "detail": detail or None,
                "amount": float(invoice["amount"]),
            }
        ],
    }
