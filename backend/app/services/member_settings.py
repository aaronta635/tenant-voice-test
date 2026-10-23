"""A member's privacy and notification settings, shared with the mobile app.

The mobile app keeps them in users.metadata.mobile, and its functions read
them there: privacySettings (publicProfile, discoverable, showContact,
showAvailability, allowMessages: mobile_discover_profiles,
mobile_public_profile_json, mobile_start_conversation) and
notificationPreferences (pushEnabled, and the categories matches, repairs,
applications and profileUpdates: mobile_notify_matches,
mobile_assistant_notify). The web reads and writes the same keys, as JSON
booleans merged into what is stored, with its own switches next to them:
messages, bookings, reviews and propertyUpdates in notificationPreferences.
The web's share_score stays in users.metadata.privacy alone:
mobile_public_profile_json hands privacySettings to every signed-in viewer.

Before, the web kept users.metadata.privacy and
users.metadata.notification_preferences. A switch the mobile keys do not hold
is still read from those, so nothing saved earlier is lost; privacy's
public_profile is still written there too, for the readers that have not
moved to this module.

The settings page names each switch as SettingsOut does (schemas/profiles.py).
"""

from fastapi import HTTPException, status

MOBILE = "mobile"
PRIVACY_SETTINGS = "privacySettings"
NOTIFICATION_PREFERENCES = "notificationPreferences"
# The web's earlier keys, read when the mobile keys hold no switch.
WEB_PRIVACY = "privacy"
WEB_NOTIFICATIONS = "notification_preferences"

# Privacy: the web's name -> the key in users.metadata.mobile.privacySettings.
PRIVACY_KEYS = {
    "public_profile": "publicProfile",
    "discoverable": "discoverable",
    "show_contact": "showContact",
    "show_availability": "showAvailability",
    "allow_messages": "allowMessages",
}
# The web's own privacy switches, kept in users.metadata.privacy alone: privacySettings reaches every
# signed-in viewer (mobile_public_profile_json), and whether a tenant shares their score is private.
WEB_ONLY_PRIVACY = ("share_score",)
PRIVACY_NAMES = (*PRIVACY_KEYS, *WEB_ONLY_PRIVACY)
# What a missing switch means, as the mobile functions read it: contact details stay hidden.
PRIVACY_DEFAULTS = {name: name != "show_contact" for name in PRIVACY_NAMES}
# The privacy switches the web kept in users.metadata.privacy, under the same names; still written.
WEB_PRIVACY_MIRRORED = ("public_profile", *WEB_ONLY_PRIVACY)

# Notifications: the web's name -> the key in users.metadata.mobile.notificationPreferences.
NOTIFICATION_KEYS = {
    "push_enabled": "pushEnabled",
    "matches": "matches",
    "repairs": "repairs",
    "application": "applications",
    "profile_updates": "profileUpdates",
    "message": "messages",
    "booking": "bookings",
    "review": "reviews",
    "property": "propertyUpdates",
}
# Each switch's switch in users.metadata.notification_preferences, which the web
# wrote before: the old "property" switch stood for match alerts and repairs too.
WEB_NOTIFICATION_SOURCE = {
    "matches": "property",
    "repairs": "property",
    "application": "application",
    "message": "message",
    "booking": "booking",
    "review": "review",
    "property": "property",
}
# Account, verification and security notices always go: no switch, even pushEnabled, stops them.
ALWAYS_ON = ("account",)

# Postgres's boolean literals, which the mobile functions cast these keys with (::boolean).
TRUE_TEXT = frozenset({"t", "true", "y", "yes", "on", "1"})
FALSE_TEXT = frozenset({"f", "false", "n", "no", "off", "0"})

SECTION_NAMES = {PRIVACY_SETTINGS: "privacy settings", NOTIFICATION_PREFERENCES: "notification settings"}


def switch(value) -> bool | None:
    """A stored switch as a boolean, as Postgres casts it; None when it holds none."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in TRUE_TEXT:
            return True
        if text in FALSE_TEXT:
            return False
    return None


def _object(value) -> dict:
    return value if isinstance(value, dict) else {}


def mobile_section(meta, key: str) -> dict:
    """users.metadata.mobile.<key> when it is an object; {} otherwise."""
    return _object(_object(_object(meta).get(MOBILE)).get(key))


# -- reading -------------------------------------------------------------------
def privacy(meta) -> dict:
    """The privacy switches users.metadata holds, by the web's names (PrivacyOut)."""
    mobile = mobile_section(meta, PRIVACY_SETTINGS)
    web = _object(_object(meta).get(WEB_PRIVACY))
    values = {}
    for name in PRIVACY_NAMES:
        value = switch(mobile.get(PRIVACY_KEYS[name])) if name in PRIVACY_KEYS else None
        if value is None and name in WEB_PRIVACY_MIRRORED:
            value = switch(web.get(name))
        values[name] = PRIVACY_DEFAULTS[name] if value is None else value
    return values


def notification_preferences(meta) -> dict:
    """The notification switches users.metadata holds, by the web's names; a missing one is on."""
    return notification_switches(
        _object(_object(meta).get(WEB_NOTIFICATIONS)), mobile_section(meta, NOTIFICATION_PREFERENCES)
    )


def notification_switches(web, mobile) -> dict:
    """The switches from the two stored objects: the mobile key first, then the web's earlier one."""
    web, mobile = _object(web), _object(mobile)
    values = {name: True for name in ALWAYS_ON}
    for name, key in NOTIFICATION_KEYS.items():
        value = switch(mobile.get(key))
        if value is None and name in WEB_NOTIFICATION_SOURCE:
            value = switch(web.get(WEB_NOTIFICATION_SOURCE[name]))
        values[name] = value is not False
    return values


def published(primary_role: str | None, profile_published) -> bool:
    """Whether a member's profile is published: a tenant's, unless the mobile app holds false (profilePublished)."""
    return primary_role != "TENANT" or switch(profile_published) is not False


def discoverable_member(meta, primary_role: str | None) -> bool:
    """Whether a search of members may find someone, as mobile_discover_profiles finds them, from their metadata.

    Their profile is public and discoverable, and a tenant's is published
    in the mobile app.
    """
    switches = privacy(meta)
    profile_published = _object(_object(meta).get(MOBILE)).get("profilePublished")
    return switches["public_profile"] and switches["discoverable"] and published(primary_role, profile_published)


# -- writing -------------------------------------------------------------------
def changes(meta: dict, settings: dict) -> dict:
    """The metadata changes a settings patch (SettingsUpdate, only the keys sent) makes, for profiles.merged().

    The switches go to the mobile keys, merged into what is there: keys
    another app keeps in users.metadata.mobile stay. privacy.public_profile
    is written to the web's earlier key too, and .share_score only there. A null clears
    a switch, which then reads as its default; a null for a whole section
    clears only the switches the web knows. 409 when another app stored a
    section in another shape: a save would overwrite it.
    """
    mobile_changes: dict = {}
    web_changes: dict = {}
    if "privacy" in settings:
        patch = _cleared(settings["privacy"], PRIVACY_NAMES)
        _refuse_another_shape(meta, PRIVACY_SETTINGS)
        mobile_patch = {PRIVACY_KEYS[name]: value for name, value in patch.items() if name in PRIVACY_KEYS}
        if mobile_patch:
            mobile_changes[PRIVACY_SETTINGS] = mobile_patch
        mirrored = {name: patch[name] for name in WEB_PRIVACY_MIRRORED if name in patch}
        if mirrored and not _another_shape(_object(meta).get(WEB_PRIVACY)):
            web_changes[WEB_PRIVACY] = mirrored
    if "notification_preferences" in settings:
        patch = _cleared(settings["notification_preferences"], NOTIFICATION_KEYS)
        _refuse_another_shape(meta, NOTIFICATION_PREFERENCES)
        mobile_changes[NOTIFICATION_PREFERENCES] = {
            NOTIFICATION_KEYS[name]: value for name, value in patch.items() if name in NOTIFICATION_KEYS
        }
    if mobile_changes:
        web_changes[MOBILE] = mobile_changes
    return web_changes


def _cleared(value: dict | None, keys) -> dict:
    return {name: None for name in keys} if value is None else value


def _another_shape(value) -> bool:
    return value is not None and not isinstance(value, dict)


def _refuse_another_shape(meta: dict, key: str) -> None:
    mobile = _object(meta).get(MOBILE)
    if _another_shape(mobile) or _another_shape(_object(mobile).get(key)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Your {SECTION_NAMES[key]} were saved by another app in a form this page cannot change. "
            "Update them in that app.",
        )
