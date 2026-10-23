"""Map the shared messaging, network and notification rows onto the web DTOs.

Migration plan §3 a3-a5 and Appendix B. The shared schema keeps a thread's
members in conversation_participants, a connection as sender and receiver
with an upper-case status, and a notification's kind in a four-value enum.
The response models the frontend reads (ConversationOut, MessageOut,
ConnectionOut, NotificationOut) keep their shapes: these functions only
reshape rows, and conversations.py, connections.py and notifications.py
query them.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def is_uuid(value) -> bool:
    """Whether a value a request sent can be a shared row's id.

    Postgres rejects anything else in a uuid column (22P02), and a checked id
    is safe to splice into an or_() filter.
    """
    return isinstance(value, str) and UUID_PATTERN.fullmatch(value) is not None


def moment(value) -> datetime | None:
    """A timestamp PostgREST returned, as an aware datetime that compares correctly."""
    if not value:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def filter_time(value: datetime) -> str:
    """A moment as a PostgREST filter value: UTC with a Z, so no "+" has to survive the URL."""
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Notifications (plan §3 a3)
# ---------------------------------------------------------------------------
# The web's notification kinds -> the shared NotificationCategory enum, whose
# labels are lower case (system, bid, social, project).
WEB_TO_NOTIFICATION_CATEGORY = {
    "message": "social",
    "review": "social",
    "booking": "project",
    "application": "project",
    "property": "system",
    "account": "system",
}


def db_notification_category(web_category: str | None) -> str:
    return WEB_TO_NOTIFICATION_CATEGORY.get(web_category or "", "system")


def web_notification_category(link: str | None) -> str:
    """The web kind of a notification (NotificationItem.category), from where its link points.

    The shared enum cannot hold the web kinds, and social or project stands
    for two of them each, so the link decides: a messages page is a message,
    a reviews page, a provider's public page (where a reply notice opens) or
    a scorecard (the owner's page, or the tenant's Scorecards card, which
    scorecard notices open) a review, a bookings page a booking and an
    applications page an application. Anything else, such as a notice the
    mobile app wrote, is system.
    """
    path, _, section = (link or "").split("?", 1)[0].partition("#")
    segments = [segment for segment in path.split("/") if segment]
    if "messages" in segments:
        return "message"
    if "reviews" in segments or "scorecard" in segments or section == "scorecards" or path.startswith("/providers/"):
        return "review"
    if "bookings" in segments:
        return "booking"
    if "applications" in segments:
        return "application"
    return "system"


# ---------------------------------------------------------------------------
# Connections (plan §3 a5)
# ---------------------------------------------------------------------------
WEB_TO_CONNECTION_STATUS = {"pending": "PENDING", "accepted": "ACCEPTED", "declined": "DECLINED"}
# How a ConnectionStatus reads on the web. Someone BLOCKED reads as declined.
# WITHDRAWN (a request its sender took back in the mobile app) is no
# connection at all, so it is never listed and never blocks a new request.
CONNECTION_TO_WEB = {"PENDING": "pending", "ACCEPTED": "accepted", "DECLINED": "declined", "BLOCKED": "declined"}
WITHDRAWN = "WITHDRAWN"


def connection_statuses(web_status: str) -> list[str]:
    """The ConnectionStatus labels a web status filter lists; [] for a status the web does not have."""
    return [label for label, shown in CONNECTION_TO_WEB.items() if shown == web_status]


def web_connection_status(db_status: str | None) -> str | None:
    """The web status of a ConnectionStatus; None for WITHDRAWN or a label this map does not know."""
    return CONNECTION_TO_WEB.get(db_status or "")


def flatten_connection(row: dict) -> dict | None:
    """A connection_requests row as ConnectionOut's own fields; None when it is no connection (WITHDRAWN)."""
    status = web_connection_status(row.get("status"))
    if status is None:
        return None
    return {
        "id": row["id"],
        "requester_id": row.get("sender_user_id"),
        "addressee_id": row.get("receiver_user_id"),
        "status": status,
        "created_at": row.get("created_at"),
        "responded_at": row.get("responded_at"),
    }


# ---------------------------------------------------------------------------
# Conversations and messages (plan §3 a4)
# ---------------------------------------------------------------------------
MARKETPLACE = "marketplace"
RENTAL = "rental"
# Who takes the tenant side of a rental thread first when it has no web
# metadata: a tenant, then anyone else, then an owner (landlord or agent).
_RENTAL_SIDE = {"TENANT": 0, "LANDLORD": 2, "AGENT": 2}


def participant_role(participant: dict) -> str | None:
    """A participant's users.primary_role, from the users(primary_role) embed; None without a users row."""
    user = participant.get("users")
    return user.get("primary_role") if isinstance(user, dict) else None


def member_ids(row: dict) -> list[str]:
    """The users.id of everyone in a thread (its conversation_participants embed)."""
    return [p["user_id"] for p in row.get("conversation_participants") or [] if p.get("user_id")]


def marketplace_metadata(client_id: str, provider_id: str, booking_id: str | None) -> dict:
    """What the web keeps in conversations.metadata for a client <-> provider thread."""
    return {"kind": MARKETPLACE, "client_id": client_id, "provider_id": provider_id, "booking_id": booking_id}


def rental_metadata(tenant_id: str, owner_id: str) -> dict:
    """What the web keeps in conversations.metadata for a tenant <-> owner thread or a network DM."""
    return {"kind": RENTAL, "tenant_id": tenant_id, "owner_id": owner_id}


def _parties_from_metadata(meta: dict, members: set[str]) -> dict | None:
    """The parties the web wrote, if they are still the thread's members."""
    if meta.get("kind") == MARKETPLACE and {meta.get("client_id"), meta.get("provider_id")} <= members:
        booking_id = meta.get("booking_id")
        return {"kind": MARKETPLACE, "client_id": meta["client_id"], "provider_id": meta["provider_id"],
                "booking_id": booking_id if is_uuid(booking_id) else None}
    if meta.get("kind") == RENTAL and {meta.get("tenant_id"), meta.get("owner_id")} <= members:
        return {"kind": RENTAL, "tenant_id": meta["tenant_id"], "owner_id": meta["owner_id"]}
    return None


def web_parties(row: dict) -> dict | None:
    """The parties the web wrote in a thread's metadata, if they are still its members.

    None for a thread the mobile app opened, whose parties are only guessed
    from its members' roles.
    """
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return _parties_from_metadata(meta, set(member_ids(row)))


def _parties_from_roles(participants: list[dict]) -> dict:
    """The parties of a thread the mobile app opened, from its members' primary roles.

    A SERVICE_PROVIDER is the provider and the next member the client.
    Otherwise a TENANT is the tenant and a LANDLORD or AGENT the owner. Two
    members with the same role are ordered by id, as network DMs are.
    """
    people = sorted({p["user_id"]: participant_role(p) for p in participants if p.get("user_id")}.items())
    providers = [user_id for user_id, role in people if role == "SERVICE_PROVIDER"]
    if providers:
        others = sorted((_RENTAL_SIDE.get(role, 1), user_id) for user_id, role in people if user_id != providers[0])
        return {"kind": MARKETPLACE, "provider_id": providers[0], "client_id": others[0][1] if others else None}
    sides = [user_id for _, user_id in sorted((_RENTAL_SIDE.get(role, 1), user_id) for user_id, role in people)]
    return {"kind": RENTAL, "tenant_id": sides[0] if sides else None, "owner_id": sides[1] if len(sides) > 1 else None}


def flatten_conversation(row: dict) -> dict:
    """A conversations row, with its conversation_participants embed, as ConversationOut's thread fields.

    The web writes metadata {kind, client_id, provider_id, booking_id} or
    {kind, tenant_id, owner_id} when it opens a thread. A thread the mobile
    app opened has none, so its parties come from the members' roles
    (_parties_from_roles). property_id is the listing the thread is about,
    and last_message_at the time the thread last moved.
    """
    participants = row.get("conversation_participants") or []
    parties = web_parties(row) or _parties_from_roles(participants)
    return {
        "id": row["id"],
        "kind": parties["kind"],
        "client_id": parties.get("client_id"),
        "provider_id": parties.get("provider_id"),
        "owner_id": parties.get("owner_id"),
        "tenant_id": parties.get("tenant_id"),
        "property_id": row.get("listing_id"),
        "booking_id": parties.get("booking_id"),
        "subject": row.get("subject"),
        "last_message_at": row.get("updated_at"),
        "created_at": row.get("created_at"),
    }


def last_read_at(row: dict, user_id: str) -> datetime | None:
    """When user_id last read the thread (their participant row); None if never."""
    times = [moment(p.get("last_read_at")) for p in row.get("conversation_participants") or []
             if p.get("user_id") == user_id]
    return max((t for t in times if t), default=None)


def read_by_others(row: dict, sender_id: str | None) -> datetime | None:
    """The latest last_read_at of the thread's members other than the sender."""
    times = [moment(p.get("last_read_at")) for p in row.get("conversation_participants") or []
             if p.get("user_id") != sender_id]
    return max((t for t in times if t), default=None)


def is_unread(message: dict, user_id: str, read_at: datetime | None) -> bool:
    """Whether user_id has a message to read: someone else's, newer than their last read (never: all of them)."""
    if message.get("sender_user_id") == user_id:
        return False
    sent_at = moment(message.get("created_at"))
    return read_at is None or (sent_at is not None and sent_at > read_at)


def flatten_message(row: dict, others_read_at: datetime | None = None) -> dict:
    """A messages row, with its message_attachments embed, as MessageOut's fields.

    sender_id is "" for a SYSTEM message from nobody (MessageOut needs a
    string). attachment_url is the first attachment's stored file_url, which
    the caller signs or drops. The message is read once a member other than
    its sender has read the thread at or after it was sent.
    """
    attachments = row.get("message_attachments") or []
    sent_at = moment(row.get("created_at"))
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "sender_id": row.get("sender_user_id") or "",
        "body": row.get("content") or "",
        "attachment_url": attachments[0].get("file_url") if attachments else None,
        "is_read": bool(others_read_at and sent_at and others_read_at >= sent_at),
        "created_at": row.get("created_at"),
    }
