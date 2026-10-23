"""Finance ledger entries driven by the booking lifecycle.

SCOPE.md: finance uses mocked totals on a real ledger structure — no money
moves, but every job leaves the same rows a real payment flow would:

  * confirmed  -> an issued invoice for the booking price
  * completed  -> a payment, the platform fee, and the invoice marked paid
  * declined / cancelled -> any open invoice is voided

The rows are web.invoices and web.transactions (migration plan §3 c3). Every
write is idempotent per booking, so a retried request never doubles a
payment or an invoice. Each one checks for its row first, and two unique
indexes settle a race between requests that both found none: one invoice per
booking (uq_invoices_booking) and one payment and one fee per booking
(uq_transactions_booking_type). The request that loses gets 23505, which
here means the row is already written.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from postgrest.exceptions import APIError

from app.core.supabase import web_table
from app.services import provider_services
from app.services.maps_bookings import payment_label

# In the web schema: query them with web_table().
INVOICES = "invoices"
TRANSACTIONS = "transactions"
# Postgres: a unique key already holds the value.
UNIQUE_VIOLATION = "23505"

PLATFORM_FEE_RATE = Decimal("0.085")
PLATFORM_FEE_LABEL = "Platform fee (8.5%)"
INVOICE_DUE_DAYS = 7


def platform_fee(price: float) -> float:
    return float((Decimal(str(price)) * PLATFORM_FEE_RATE).quantize(Decimal("0.01"), ROUND_HALF_UP))


def invoice_number(booking_id: str, whole: bool = False) -> str:
    """The number of a booking's invoice: eight hex digits of its id, or all of them with whole."""
    digits = booking_id.replace("-", "").upper()
    return f"INV-{digits if whole else digits[:8]}"


def _priced(booking: dict) -> bool:
    # A booking of a service nobody priced has no price (maps_bookings.booking_price).
    return bool(booking.get("price"))


def _service_title(service_id: str | None) -> str | None:
    if not service_id:
        return None
    return (provider_services.services_by_id([service_id]).get(service_id) or {}).get("title")


def _due_date(booking: dict) -> str:
    scheduled = booking.get("scheduled_date")
    start = date.fromisoformat(str(scheduled)[:10]) if scheduled else date.today()
    return (start + timedelta(days=INVOICE_DUE_DAYS)).isoformat()


def _invoice_for(booking: dict) -> dict | None:
    # Scoped by provider too: another provider must never be able to attach an
    # invoice to this booking and have it marked paid or voided here.
    result = (
        web_table(INVOICES)
        .select("*")
        .eq("booking_id", booking["id"])
        .eq("provider_id", booking["provider_id"])
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def _already_written(exc: APIError) -> bool:
    return getattr(exc, "code", None) == UNIQUE_VIOLATION


def issue_invoice(booking: dict, status: str = "issued") -> None:
    """Raise the booking's invoice once; no-op for unpriced bookings."""
    if not _priced(booking) or _invoice_for(booking):
        return
    invoice = {
        "provider_id": booking["provider_id"],
        "booking_id": booking["id"],
        "number": invoice_number(booking["id"]),
        "amount": float(booking["price"]),
        "status": status,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "due_date": _due_date(booking),
    }
    try:
        web_table(INVOICES).insert(invoice).execute()
    except APIError as exc:
        if not _already_written(exc):
            raise
        if _invoice_for(booking):
            return  # another request raised it first
        # The booking still has no invoice, so the number clashed: it is unique
        # per provider, and another of their invoices holds these eight digits.
        web_table(INVOICES).insert({**invoice, "number": invoice_number(booking["id"], whole=True)}).execute()


def record_completion(booking: dict) -> None:
    """Payment + platform fee for a finished job, and its invoice marked paid."""
    if not _priced(booking):
        return
    already_paid = (
        web_table(TRANSACTIONS)
        .select("id")
        .eq("booking_id", booking["id"])
        .eq("type", "payment")
        .limit(1)
        .execute()
        .data
    )
    if not already_paid:
        price = float(booking["price"])
        label = payment_label(_service_title(booking.get("service_id")), booking.get("property_suburb"))
        try:
            web_table(TRANSACTIONS).insert(
                [
                    {
                        "provider_id": booking["provider_id"],
                        "booking_id": booking["id"],
                        "type": "payment",
                        "amount": price,
                        "description": label,
                    },
                    {
                        "provider_id": booking["provider_id"],
                        "booking_id": booking["id"],
                        "type": "platform_fee",
                        "amount": platform_fee(price),
                        "description": PLATFORM_FEE_LABEL,
                    },
                ]
            ).execute()
        except APIError as exc:
            # Another request recorded this job's payment and fee first.
            if not _already_written(exc):
                raise

    invoice = _invoice_for(booking)
    if invoice is None:
        issue_invoice(booking, status="paid")
    elif invoice["status"] != "paid":
        web_table(INVOICES).update({"status": "paid"}).eq("id", invoice["id"]).execute()


def void_open_invoice(booking: dict) -> None:
    web_table(INVOICES).update({"status": "void"}).eq("booking_id", booking["id"]).eq(
        "provider_id", booking["provider_id"]
    ).in_("status", ["draft", "issued"]).execute()
