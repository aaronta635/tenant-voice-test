"""Shared-schema rows for the messaging, network and notification tests (strict_schema).

Every id is a uuid and every row carries the NOT NULL columns its table has no
default for, so fake_db.seed() takes them in strict mode.
"""

import uuid

from tests.factories import NOW
from tests.shared_schema import shared_user

# Before the strict fake's clock (2026-01-01T00:00:00Z), so rows the code writes sort after these.
EARLIER = "2025-12-31T09:00:00+00:00"


def uid(name: str) -> str:
    """A stable uuid for a readable test name."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:messaging-tests:{name}"))


def person(id: str, primary_role: str = "TENANT", full_name: str = "Test Person", **metadata) -> dict:
    """A users row (tests.shared_schema.shared_user) with its own email."""
    return {**shared_user(id, primary_role, full_name, **metadata), "email": f"{id}@example.test"}


def provider_profile(user_id: str, company_name: str | None = "Whitlock Property", **metadata) -> dict:
    """A service_provider_profiles row; published unless metadata says otherwise."""
    return {
        "user_id": user_id,
        "company_name": company_name,
        "service_categories": ["property_manager"],
        "metadata": {"slug": "whitlock-property", "is_published": True, **metadata},
        "updated_at": NOW,
    }


def connection(sender: str, receiver: str, status: str = "ACCEPTED", id: str | None = None,
               created_at: str = EARLIER) -> dict:
    """A connection_requests row as the shared table stores it."""
    return {
        "id": id or uid(f"connection-{sender}-{receiver}-{status}"),
        "sender_user_id": sender,
        "receiver_user_id": receiver,
        "status": status,
        "context_type": "NETWORK",
        "created_at": created_at,
        "responded_at": None if status == "PENDING" else created_at,
    }


def seed_thread(db, members: list[str], *, id: str | None = None, metadata: dict | None = None,
                listing_id: str | None = None, conversation_type: str | None = None, subject: str | None = None,
                updated_at: str = EARLIER, last_read: dict | None = None) -> str:
    """A conversations row with a conversation_participants row per member; returns its id.

    Without metadata it is a thread as the mobile app opens it. last_read maps a
    member to their last_read_at.
    """
    conversation_id = id or uid(f"thread-{'-'.join(members)}-{listing_id}-{metadata}")
    db.seed("conversations", [{
        "id": conversation_id,
        "conversation_type": conversation_type or ("PROPERTY" if listing_id else "DIRECT"),
        "subject": subject,
        "listing_id": listing_id,
        "metadata": metadata,
        "created_at": EARLIER,
        "updated_at": updated_at,
    }])
    db.seed("conversation_participants", [{
        "id": uid(f"participant-{conversation_id}-{member}"),
        "conversation_id": conversation_id,
        "user_id": member,
        "last_read_at": (last_read or {}).get(member),
    } for member in members])
    return conversation_id


def message(conversation_id: str, sender: str | None, content: str | None, created_at: str, *,
            id: str | None = None, message_type: str = "TEXT", deleted_at: str | None = None) -> dict:
    """A messages row as either app writes it."""
    return {
        "id": id or uid(f"message-{conversation_id}-{created_at}-{content}"),
        "conversation_id": conversation_id,
        "sender_user_id": sender,
        "message_type": message_type,
        "content": content,
        "created_at": created_at,
        "deleted_at": deleted_at,
    }


def attachment(message_id: str, file_url: str) -> dict:
    return {"id": uid(f"attachment-{message_id}-{file_url}"), "message_id": message_id, "file_url": file_url}


def seed_listing(db, owner: str, *, listing_id: str | None = None, title: str = "Sunny two-bedder",
                 suburb: str = "Newtown") -> str:
    """A properties row owned by owner and its listing; returns the listing id (the web's property_id)."""
    property_id = uid(f"property-{owner}-{title}")
    listing_id = listing_id or uid(f"listing-{owner}-{title}")
    db.seed("properties", [{
        "id": property_id, "owner_user_id": owner, "address_line_1": "12 Example Terrace", "suburb": suburb,
        "state": "NSW", "postcode": "2042", "updated_at": NOW,
    }])
    db.seed("listings", [{
        "id": listing_id, "property_id": property_id, "created_by_user_id": owner, "title": title,
        "weekly_rent": 650, "status": "PUBLISHED", "updated_at": NOW,
    }])
    return listing_id


def seed_booking(db, client: str, provider: str, *, id: str | None = None, conversation_id: str | None = None,
                 service_id: str | None = None, **over) -> str:
    """A web.bookings row between a client and a provider (both users.id); returns its id."""
    booking_id = id or uid(f"booking-{client}-{provider}")
    db.seed("bookings", [{
        "id": booking_id, "client_id": client, "provider_id": provider, "service_id": service_id,
        "status": "confirmed", "scheduled_date": "2026-11-03", "scheduled_time": "10:00:00",
        "property_address": "12 Example Terrace", "property_suburb": "Newtown", "price": 99,
        "conversation_id": conversation_id, **over,
    }], schema="web")
    return booking_id


def stored(db, table: str, **match) -> list[dict]:
    """The rows of a public table that have every given value."""
    return [row for row in db.tables.get(table, []) if all(row.get(k) == v for k, v in match.items())]
