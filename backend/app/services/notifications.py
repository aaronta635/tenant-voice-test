"""In-app notifications raised by marketplace events.

Bookings, messages and reviews call notify() so the bell and the notifications
page reflect what actually happened, not only seeded rows. Like the audit
trail, a notification is a side effect: failing to write one must never fail
the booking, message or review that triggered it.

The shared notifications table is the mobile app's too (migration plan §3 a3):
its body is NOT NULL, the link is in link, and category is the
NotificationCategory enum (system, bid, social, project), so a web kind is
stored as one of those and read back from the link
(maps_messaging.web_notification_category).

A person turns notices off in their settings (R36), which the mobile app
shares (services/member_settings.py): users.metadata.mobile.
notificationPreferences. Each notice falls under one switch (switch_for):
the mobile app's categories (matches, repairs, applications), or one of the
web's next to them (messages, bookings, reviews, propertyUpdates). A switch
that is off writes no row, and so does pushEnabled off, for every notice but
those about the account itself and its security (ALWAYS_SENT), which always
go. As mobile_notify_matches does, a match alert links to
/matches/<type>/<id> (match_link), so neither app tells a tenant about one
match twice.
"""

import logging

from app.core.supabase import get_supabase_client
from app.services import _common, member_settings
from app.services.maps_messaging import db_notification_category
from app.services.shared_map import stamp_insert, web_role

logger = logging.getLogger(__name__)

TABLE = "notifications"

# Where each role reads its threads; notification links point there.
MESSAGES_PATH = {
    "service_provider": "/dashboard/messages",
    "tenant": "/tenant/messages",
    "landlord": "/owner/messages",
}


# The longest body a notification keeps; the rest is cut off.
BODY_LENGTH = 280
# The kinds no switch turns off: verification decisions, account status and security.
ALWAYS_SENT = frozenset({"account", "security"})
# The switch (member_settings's name) a web kind falls under; a property notice is placed by its link.
KIND_SWITCHES = {"message": "message", "review": "review", "booking": "booking", "application": "application"}
# Where a property notice about a repair points (services/maintenance.py).
REPAIR_PAGES = ("maintenance", "repairs")
# What users.metadata holds of the switches: the mobile app's keys and the web's earlier ones.
PREFERENCE_COLUMNS = (
    "web_preferences:metadata->notification_preferences, "
    "mobile_preferences:metadata->mobile->notificationPreferences"
)
MATCHES_PREFIX = "/matches/"


def notify(
    user_id: str | None,
    category: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> bool:
    """Insert one notification for a person (users.id), unless they turned its kind off; whether it did.

    category is a web kind (message, review, booking, application, property,
    account), stored as its NotificationCategory; link is the web page the
    notice opens. A notice whose switch is off in the person's settings, or
    any notice while they turned them all off (pushEnabled), writes nothing
    (switched_off); account and security notices always go. Never raises,
    but logs a failure as an error.
    """
    if not user_id:
        return False
    try:
        switch = switch_for(category, link)
        if switch is not None and switched_off(user_id, switch):
            return False
        get_supabase_client().table(TABLE).insert(
            stamp_insert(
                TABLE,
                {
                    "user_id": user_id,
                    "category": db_notification_category(category),
                    "title": title[:200],
                    "body": (body or "")[:BODY_LENGTH],
                    "link": link,
                    "is_read": False,
                },
            )
        ).execute()
    except Exception as exc:
        logger.error("notification write failed for %s (%s): %s", user_id, title, exc)
        return False
    return True


def switch_for(kind: str, link: str | None = None) -> str | None:
    """The settings switch a notice falls under (member_settings's name); None when it always goes.

    A property notice is a match alert (a /matches/ link), a repair's (a
    maintenance or repairs page), else a listing or complaint update.
    """
    if kind in ALWAYS_SENT:
        return None
    if kind in KIND_SWITCHES:
        return KIND_SWITCHES[kind]
    path = (link or "").split("?", 1)[0].split("#", 1)[0]
    if path.startswith(MATCHES_PREFIX):
        return "matches"
    if any(segment in REPAIR_PAGES for segment in path.split("/")):
        return "repairs"
    return "property"


def switched_off(user_id: str, switch: str) -> bool:
    """Whether the person turned this switch, or all notices, off. A person without a users row has none."""
    rows = get_supabase_client().table("users").select(PREFERENCE_COLUMNS).eq("id", user_id).limit(1).execute().data
    return preferences_off(rows[0] if rows else {}, switch)


def preferences_off(row: dict, switch: str) -> bool:
    """switched_off() for a row that selected PREFERENCE_COLUMNS (users, or an embed of it)."""
    switches = member_settings.notification_switches(row.get("web_preferences"), row.get("mobile_preferences"))
    return not (switches["push_enabled"] and switches[switch])


def match_link(kind: str, entity_id: str) -> str:
    """A match alert's link, as mobile_notify_matches writes it: /matches/property/<listing id>."""
    return f"{MATCHES_PREFIX}{kind}/{entity_id}"


def notified(user_id: str, links: list[str]) -> set[str]:
    """Which of these links the person already has a notice with, from either app."""
    if not links:
        return set()
    # A chunk of links at a time (_common.IN_CHUNK): hundreds of match links in one in() would make a
    # request URL the gateway refuses.
    rows = _common.select_in(
        lambda: get_supabase_client().table(TABLE).select("id, link").eq("user_id", user_id).order("id"),
        "link",
        links,
    )
    return {row["link"] for row in rows}


def messages_href(role: str | None, conversation_id: str | None = None) -> str:
    base = MESSAGES_PATH.get(role or "", "/login")
    return f"{base}?thread={conversation_id}" if conversation_id else base


def profile_summary(profile_id: str | None) -> dict:
    """Name + web role of a person (a users row; AGENT reads as landlord), for notification copy and links.

    Never raises: someone without a users row, or a failed lookup, is {}.
    """
    if not profile_id:
        return {}
    try:
        users = (
            get_supabase_client()
            .table("users")
            .select("full_name, primary_role")
            .eq("id", profile_id)
            .limit(1)
            .execute()
            .data
        )
    except Exception as exc:
        logger.warning("profile lookup for notification failed (%s): %s", profile_id, exc)
        return {}
    if not users:
        return {}
    return {"full_name": users[0].get("full_name"), "role": web_role(users[0].get("primary_role"))}


def provider_profile_id(provider_id: str | None) -> str | None:
    """The person who owns a marketplace provider, to notify. Never raises.

    A provider's id is its owner's users.id, so this is provider_id itself
    once a service_provider_profiles row shows it is a provider.
    """
    if not provider_id:
        return None
    try:
        # Deferred: conversations imports this module.
        from app.services.conversations import providers_by_id

        provider = providers_by_id([provider_id]).get(provider_id)
        return provider["profile_id"] if provider else None
    except Exception as exc:
        logger.warning("provider lookup for notification failed (%s): %s", provider_id, exc)
        return None
