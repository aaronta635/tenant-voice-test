"""Notification switches (R36): a kind a person turned off writes no notification.

These are the web's earlier switches, users.metadata.notification_preferences.
<kind>, which notify() still reads where the keys the mobile app shares hold
none (tests/test_shared_settings.py has those). False, or text Postgres reads
as false, is off; a missing switch is on. Account and security notices
always go.
"""

import pytest

from app.schemas.profiles import NOTIFICATION_KINDS
from app.services import notifications
from tests.factories_messaging import connection, person, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = uid("mei-switches")
AMELIA = uid("amelia-switches")
SWITCHABLE = [kind for kind in NOTIFICATION_KINDS if kind != "account"]


def member(db, preferences=None, id=MEI, role="TENANT", name="Mei Lin"):
    metadata = {} if preferences is None else {"notification_preferences": preferences}
    db.seed("users", [person(id, role, name, **metadata)])


def notices(db, user_id=MEI) -> list[dict]:
    return [row for row in db.tables.get("notifications", []) if row["user_id"] == user_id]


@pytest.mark.parametrize("kind", SWITCHABLE)
def test_a_kind_switched_off_writes_no_row(strict_schema, kind):
    member(strict_schema, {kind: False})

    assert notifications.notify(MEI, kind, "Off", "Not sent") is False
    other = next(other for other in SWITCHABLE if other != kind)
    assert notifications.notify(MEI, other, "On", "Sent") is True

    assert [row["title"] for row in notices(strict_schema)] == ["On"]


@pytest.mark.parametrize("preferences", [None, {}, {"message": True}, {"message": None}, {"message": "yes"},
                                         {"push_enabled": False}])
def test_a_missing_or_true_switch_is_on(strict_schema, preferences):
    member(strict_schema, preferences)

    assert notifications.notify(MEI, "message", "New message", "Hi") is True
    assert len(notices(strict_schema)) == 1


def test_false_saved_as_text_is_off_too(strict_schema):
    member(strict_schema, {"message": "false"})

    assert notifications.notify(MEI, "message", "New message", "Hi") is False
    assert notices(strict_schema) == []


def test_account_and_security_notices_always_go(strict_schema):
    member(strict_schema, {"account": False, "security": False})

    assert notifications.notify(MEI, "account", "Your account is verified") is True
    assert notifications.notify(MEI, "security", "Your password was changed") is True

    assert [(row["title"], row["category"]) for row in notices(strict_schema)] == [
        ("Your account is verified", "system"), ("Your password was changed", "system"),
    ]


def test_the_switches_the_settings_page_saves_stop_new_notices(client, strict_schema, as_profile):
    member(strict_schema)
    as_profile(id=MEI, role="tenant")

    saved = client.patch("/api/v1/profiles/me", json={"settings": {"notification_preferences": {"property": False}}})
    assert saved.status_code == 200, saved.text
    notifications.notify(MEI, "property", "A new home matches your preferences")

    client.patch("/api/v1/profiles/me", json={"settings": {"notification_preferences": {"property": True}}})
    notifications.notify(MEI, "property", "Another home matches your preferences")

    assert [row["title"] for row in notices(strict_schema)] == ["Another home matches your preferences"]


def test_a_message_to_someone_who_turned_messages_off_tells_them_nothing(client, strict_schema, as_profile):
    member(strict_schema, {"message": False})
    member(strict_schema, id=AMELIA, role="SERVICE_PROVIDER", name="Amelia Whitlock")
    strict_schema.seed("connection_requests", [connection(AMELIA, MEI)])
    as_profile(id=AMELIA, role="service_provider")

    sent = client.post("/api/v1/conversations/rental", json={"peer_id": MEI, "body": "Are you free Friday?"})

    assert sent.status_code == 201, sent.text
    assert [row["content"] for row in strict_schema.tables["messages"]] == ["Are you free Friday?"]
    assert notices(strict_schema) == []
