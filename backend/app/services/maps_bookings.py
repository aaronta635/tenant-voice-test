"""Map bookings, their ledger and their review onto the shared rows around them (migration plan §3 c3).

A booking, its invoice and its ledger rows are web.bookings, web.invoices and
web.transactions, with the columns the web always had, so BookingOut,
InvoiceOut and TransactionOut read them as they are. What changed is around
them: the client and the provider are users rows (a provider's id is its
owner's users.id), the service is a mobile_provider_services row, the thread
a shared conversation (web.bookings.conversation_id) and the review a shared
reviews row (web.bookings.review_id). These functions only reshape rows;
bookings.py, ledger.py, invoices.py, transactions.py and reviews.py query
them.
"""

from __future__ import annotations

from app.services import maps_messaging
from app.services.maps_reviews_complaints import PUBLISHED_REVIEW, VISIBLE_REVIEW_STATUSES
from app.services.shared_map import review_rating

# What a new web.bookings row takes from the booking form (BookingCreate).
FORM_FIELDS = ("service_id", "property_address", "property_suburb", "scheduled_date", "scheduled_time", "notes")
# How long a job takes when its service gives no duration the web can read.
DEFAULT_MINUTES = 60


def booking_price(service: dict | None) -> float | None:
    """What a booking of the service costs (ProviderServiceOut fields); None when there is no price.

    mobile_provider_services.price defaults to 0, which is a service nobody
    has priced yet, not a free one: a 0 would raise a $0 invoice.
    """
    price = (service or {}).get("price")
    return float(price) if price else None


def new_booking(client_id: str, provider_id: str, form: dict, price: float | None) -> dict:
    """The web.bookings row a client's request becomes: the form fields filled in, both parties and the price."""
    row = {key: form[key] for key in FORM_FIELDS if form.get(key) is not None}
    row.update(client_id=client_id, provider_id=provider_id)
    if price is not None:
        row["price"] = price
    return row


def service_minutes(service: dict | None) -> int:
    """How long a job of the service (ProviderServiceOut fields) takes, in minutes."""
    return (service or {}).get("duration_minutes") or DEFAULT_MINUTES


def booking_threads(bookings: list[dict], threads: list[dict]) -> dict[str, str]:
    """Each booking's thread, by booking id: its conversation_id, else a thread opened for it.

    threads are conversations rows with a conversation_participants(user_id)
    embed. Opening a thread from the booking card (POST /conversations with a
    booking_id) names the booking in the thread's metadata only, so such a
    thread counts as well: the oldest whose web parties are the booking's own
    client and provider, both still members of it.
    """
    found = {booking["id"]: booking["conversation_id"] for booking in bookings if booking.get("conversation_id")}
    unlinked = {booking["id"]: booking for booking in bookings if not booking.get("conversation_id")}
    for thread in sorted(threads, key=lambda row: (str(row.get("created_at") or ""), row["id"])):
        parties = maps_messaging.web_parties(thread) or {}
        booking = unlinked.get(parties.get("booking_id")) if parties.get("kind") == maps_messaging.MARKETPLACE else None
        if booking and (parties["client_id"], parties["provider_id"]) == (booking["client_id"], booking["provider_id"]):
            found.setdefault(booking["id"], thread["id"])
    return found


def review_ratings(reviews: list[dict]) -> dict[str, int]:
    """The stars of each review moderators left up, by review id: a hidden or archived one shows none."""
    return {row["id"]: review_rating(row) for row in reviews if row.get("status") in VISIBLE_REVIEW_STATUSES}


def booking_review(booking: dict, rating: int, comment: str | None, service_title: str | None) -> dict:
    """The shared reviews row a client's review of a completed booking is, before stamp_insert().

    Like every provider review it is about the provider's users.id, with no
    property; the booking makes it a verified interaction, and the service
    booked is its title. The booking links to it through review_id.
    """
    return {
        "reviewer_user_id": booking["client_id"],
        "reviewed_user_id": booking["provider_id"],
        "property_id": None,
        "rating": rating,
        "landlord_rating": rating,
        "title": service_title,
        "body": comment,
        "is_verified_interaction": True,
        "status": PUBLISHED_REVIEW,
    }


def payment_label(service_title: str | None, suburb: str | None) -> str:
    """The description of a finished job's payment on the finance table."""
    return " · ".join(part for part in ("Payment", service_title, suburb) if part)


def place(person: dict) -> str | None:
    """Where a person (shared_map.flatten_user fields) is, as an invoice prints it."""
    return ", ".join(part for part in (person.get("location"), person.get("state")) if part) or None
