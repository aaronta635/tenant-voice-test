"""Settings the web shares with the mobile app: privacy and notification switches (R14, R36).

Both apps keep them in users.metadata.mobile: privacySettings and
notificationPreferences, the keys the mobile functions read
(mobile_discover_profiles, mobile_public_profile_json, mobile_notify_matches,
mobile_assistant_notify). The web's earlier keys, users.metadata.privacy and
.notification_preferences, are read where the mobile keys hold no switch.
"""

import pytest

from app.services import member_settings, notifications
from tests.factories_identity import users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
URL = f"{API}/profiles/me"
MEI = "c1000000-0000-4000-8000-000000000001"


def seed_member(db, metadata=None, id=MEI, role="TENANT", name="Mei Lin"):
    db.seed("users", [users_row(id, f"{id}@demo.test", role, full_name=name, metadata=metadata or {})])


def user_metadata(db, id=MEI) -> dict:
    return next(row for row in db.tables["users"] if row["id"] == id)["metadata"]


def notices(db, id=MEI) -> list[str]:
    return [row["title"] for row in db.tables.get("notifications", []) if row["user_id"] == id]


# -- the settings page reads and writes the mobile app's keys ------------------------------
def test_the_settings_page_reads_the_switches_the_mobile_app_saved(client, strict_schema, as_profile):
    seed_member(strict_schema, {"mobile": {
        "privacySettings": {"publicProfile": False, "discoverable": False, "showContact": True,
                            "showAvailability": False, "allowMessages": False},
        "notificationPreferences": {"pushEnabled": False, "matches": False, "repairs": "false",
                                    "applications": False, "profileUpdates": False},
    }})
    as_profile(id=MEI, role="tenant")

    settings = client.get(URL).json()["settings"]

    assert settings["privacy"] == {
        "public_profile": False, "discoverable": False, "show_contact": True, "show_availability": False,
        "allow_messages": False, "share_score": True,
    }
    assert settings["notification_preferences"] == {
        "push_enabled": False, "matches": False, "repairs": False, "application": False, "profile_updates": False,
        "message": True, "review": True, "booking": True, "property": True, "account": True,
    }


def test_a_switch_the_mobile_keys_lack_is_read_from_the_webs_earlier_keys(client, strict_schema, as_profile):
    seed_member(strict_schema, {
        "privacy": {"public_profile": False, "share_score": False},
        "notification_preferences": {"property": False, "message": "false", "booking": True},
        "mobile": {"privacySettings": {"shareScore": True}, "notificationPreferences": {"repairs": True}},
    })
    as_profile(id=MEI, role="tenant")

    settings = client.get(URL).json()["settings"]

    # The mobile key wins where it has one; the web's old "property" switch stood for matches and repairs too.
    # share_score is the web's alone (users.metadata.privacy): a shareScore in privacySettings is not read.
    assert (settings["privacy"]["public_profile"], settings["privacy"]["share_score"]) == (False, False)
    switches = settings["notification_preferences"]
    assert (switches["matches"], switches["repairs"], switches["property"]) == (False, True, False)
    assert (switches["message"], switches["booking"], switches["push_enabled"]) == (False, True, True)


def test_a_save_merges_json_booleans_into_the_mobile_keys(client, strict_schema, as_profile):
    seed_member(strict_schema, {"mobile": {
        "personalDetails": {"suburb": "Glebe"}, "profilePublished": True,
        "privacySettings": {"showContact": True, "theme": "dark"},
        "notificationPreferences": {"inspections": False},
    }})
    as_profile(id=MEI, role="tenant")

    saved = client.patch(URL, json={"settings": {
        "privacy": {"discoverable": False, "allow_messages": False, "share_score": False},
        "notification_preferences": {"push_enabled": False, "matches": False, "message": False, "account": False},
    }})

    assert saved.status_code == 200, saved.text
    mobile = user_metadata(strict_schema)["mobile"]
    assert mobile == {
        "personalDetails": {"suburb": "Glebe"}, "profilePublished": True,
        # No shareScore: mobile_public_profile_json hands privacySettings to every signed-in viewer.
        "privacySettings": {"showContact": True, "theme": "dark", "discoverable": False, "allowMessages": False},
        # account is not a switch: account notices always go.
        "notificationPreferences": {"inspections": False, "pushEnabled": False, "matches": False,
                                    "messages": False},
    }
    # The web's earlier privacy key is kept in step for the readers that still read it; its notification key is not.
    assert user_metadata(strict_schema)["privacy"] == {"share_score": False}
    assert "notification_preferences" not in user_metadata(strict_schema)
    assert saved.json()["settings"]["notification_preferences"]["account"] is True


@pytest.mark.parametrize("stored", [
    {"mobile": "dark mode"},
    {"mobile": {"privacySettings": ["publicProfile"]}},
])
def test_switches_another_app_stored_in_another_shape_are_never_overwritten(client, strict_schema, as_profile,
                                                                             stored):
    seed_member(strict_schema, stored)
    as_profile(id=MEI, role="tenant")

    response = client.patch(URL, json={"full_name": "Mei Chen", "settings": {"privacy": {"public_profile": False}}})

    assert response.status_code == 409, response.text
    row = next(row for row in strict_schema.tables["users"] if row["id"] == MEI)
    assert (row["metadata"], row["full_name"]) == (stored, "Mei Lin")


@pytest.mark.parametrize("text, value", [("false", False), ("FALSE", False), ("f", False), ("no", False),
                                         ("off", False), ("0", False), ("true", True), ("yes", True),
                                         ("maybe", None), (None, None), (0, None)])
def test_a_switch_saved_as_text_reads_as_postgres_casts_it(text, value):
    assert member_settings.switch(text) is value


# -- notify() honours the shared switches ------------------------------------------------------
def test_with_every_notice_off_only_account_and_security_notices_go(strict_schema):
    seed_member(strict_schema, {"mobile": {"notificationPreferences": {"pushEnabled": False}}})

    for kind in ("message", "review", "booking", "application", "property"):
        assert notifications.notify(MEI, kind, f"A {kind} notice") is False
    assert notifications.notify(MEI, "account", "Your account is verified") is True
    assert notifications.notify(MEI, "security", "Your password was changed") is True

    assert notices(strict_schema) == ["Your account is verified", "Your password was changed"]


@pytest.mark.parametrize("switch, kind, link", [
    ("matches", "property", "/matches/property/c1000000-0000-4000-8000-0000000000aa"),
    ("repairs", "property", "/tenant/maintenance"),
    ("repairs", "property", "/dashboard/repairs"),
    ("propertyUpdates", "property", "/owner/properties/c1000000-0000-4000-8000-0000000000aa"),
    ("propertyUpdates", "property", "/tenant/complaints"),
    ("applications", "application", "/tenant/applications"),
    ("messages", "message", "/tenant/messages"),
    ("bookings", "booking", "/tenant/bookings"),
    ("reviews", "review", "/dashboard/reviews"),
])
def test_each_notice_falls_under_one_shared_switch(strict_schema, switch, kind, link):
    seed_member(strict_schema, {"mobile": {"notificationPreferences": {switch: False}}})
    others = [("message", "/tenant/messages"), ("property", "/matches/property/x"), ("property", "/tenant/maintenance"),
              ("property", "/tenant/complaints"), ("application", None), ("booking", None), ("review", None)]

    assert notifications.notify(MEI, kind, "Off", "Not sent", link) is False
    sent = [notifications.notify(MEI, other, "On", "Sent", other_link) for other, other_link in others
            if notifications.switch_for(other, other_link) != notifications.switch_for(kind, link)]

    assert sent and all(sent)
    assert "Off" not in notices(strict_schema)


def test_the_switch_names_are_the_ones_the_mobile_functions_read():
    assert {member_settings.NOTIFICATION_KEYS[name] for name in ("push_enabled", "matches", "repairs",
                                                                 "application", "profile_updates")} == {
        "pushEnabled", "matches", "repairs", "applications", "profileUpdates"}
    assert {member_settings.PRIVACY_KEYS[name] for name in ("public_profile", "discoverable", "show_contact",
                                                            "show_availability", "allow_messages")} == {
        "publicProfile", "discoverable", "showContact", "showAvailability", "allowMessages"}
