"""What strict mode caught on the shared tables (migration plan §1.2), now working.

Each test began by pinning a defect as it failed against the real shared
schema; the area port that fixed it turned it into a test of the working
behaviour, and every one is fixed now. A defect strict mode catches later is
pinned here the same way until its fix lands.
"""

import logging
import uuid

import pytest
from postgrest.exceptions import APIError
from pydantic import SecretStr

from app.core.config import settings
from app.services import audit, conversations, dashboard, notifications, profiles

OWNER = "a1111111-1111-4111-8111-111111111111"
NOW = "2026-01-01T00:00:00+00:00"


def _code(call, *args) -> APIError:
    with pytest.raises(APIError) as caught:
        call(*args)
    return caught.value


def test_provisioning_stamps_the_ids_and_times_the_shared_db_needs(strict_schema):
    # Plan a2: users.id and updated_at have no default; nor have the profile rows' updated_at.
    auth_user_id = str(uuid.uuid4())
    user = profiles.ensure_user_for_auth(auth_user_id, "New@Example.test", "New Person", "tenant")

    assert uuid.UUID(user["id"]) and user["updated_at"] and user["auth_user_id"] == auth_user_id
    assert (user["email"], user["verification_status"]) == ("new@example.test", "PENDING")
    [assignment] = strict_schema.tables["user_role_assignments"]
    assert uuid.UUID(assignment["id"]) and assignment["user_id"] == user["id"]
    [tenant] = strict_schema.tables["tenant_profiles"]
    assert tenant["updated_at"] and tenant["user_id"] == user["id"]


def test_registering_answers_201_with_the_new_account_signed_in(client, strict_schema):
    response = client.post("/api/v1/auth/register", json={
        "email": "new@example.test", "password": "password123", "full_name": "New Person", "role": "tenant",
    })

    assert response.status_code == 201, response.text
    [auth_user] = strict_schema.users
    [user] = strict_schema.tables["users"]
    assert (user["auth_user_id"], response.json()["profile"]["id"]) == (auth_user["id"], user["id"])


def test_notifications_are_saved_with_the_shared_link_body_and_category(strict_schema):
    # Plan a3: link, not link_href; a body even when there is none; a NotificationCategory label.
    strict_schema.seed("users", [{"id": OWNER, "email": "owner@example.test", "updated_at": NOW}])

    notifications.notify(OWNER, "message", "New message", None, "/owner/messages")

    [row] = strict_schema.tables["notifications"]
    assert (row["user_id"], row["link"], row["body"], row["category"]) == (OWNER, "/owner/messages", "", "social")


def test_the_audit_trail_reads_and_writes_the_web_schema(strict_schema, caplog):
    strict_schema.seed("users", [{"id": OWNER, "email": "olive@example.test", "full_name": "Olive",
                                  "updated_at": NOW}])
    with caplog.at_level(logging.WARNING, logger="app.services.audit"):
        audit.record(OWNER, "auth.logged_in", "profile", OWNER)

    assert not caplog.text
    [entry] = audit.list_entries()
    assert (entry["actor_id"], entry["actor_name"], entry["action"]) == (OWNER, "Olive", "auth.logged_in")
    assert [row["entity_id"] for row in strict_schema.schema_tables["web"]["audit_log"]] == [OWNER]


def test_the_owner_dashboard_counts_the_requests_waiting_for_the_owner(strict_schema):
    # Plan a5: the upper-case ConnectionStatus, and only requests sent to this owner.
    sender, other = str(uuid.uuid4()), str(uuid.uuid4())
    strict_schema.seed("connection_requests", [
        {"id": str(uuid.uuid4()), "sender_user_id": sender, "receiver_user_id": OWNER},
        {"id": str(uuid.uuid4()), "sender_user_id": sender, "receiver_user_id": other},
        {"id": str(uuid.uuid4()), "sender_user_id": OWNER, "receiver_user_id": other},
    ])

    assert dashboard.owner_dashboard(OWNER)["pending_connections"] == 1


def test_the_inbox_lists_the_threads_the_owner_takes_part_in(strict_schema):
    # Plan a4: a thread's members are conversation_participants rows, not conversations columns.
    thread, elsewhere = str(uuid.uuid4()), str(uuid.uuid4())
    strict_schema.seed("conversations", [{"id": thread, "conversation_type": "DIRECT", "updated_at": NOW},
                                         {"id": elsewhere, "conversation_type": "DIRECT", "updated_at": NOW}])
    strict_schema.seed("conversation_participants", [
        {"id": str(uuid.uuid4()), "conversation_id": thread, "user_id": OWNER},
        {"id": str(uuid.uuid4()), "conversation_id": elsewhere, "user_id": str(uuid.uuid4())},
    ])

    assert [thread_row["id"] for thread_row in conversations.list_conversations(OWNER)] == [thread]


def test_the_faq_page_reads_its_table_in_the_web_schema(client, strict_schema):
    strict_schema.seed("faqs", [{"audience": "all", "question": "How do I delete my account?",
                                 "answer": "Use the Contact support page.", "sort_order": 9}], schema="web")

    response = client.get("/api/v1/faqs")

    assert response.status_code == 200, response.text
    assert [faq["question"] for faq in response.json()] == ["How do I delete my account?"]


def test_a_profile_edit_moves_updated_at(client, strict_schema):
    # Plan §1.1: no trigger bumps updated_at on the shared db, so the edit stamps it.
    token = strict_schema.add_auth_user("mei@example.test", full_name="Mei", role="tenant")
    auth_id = strict_schema.tokens[token]
    strict_schema.seed("users", [{"id": OWNER, "auth_user_id": auth_id, "email": "mei@example.test",
                                  "full_name": "Mei", "updated_at": NOW}])
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/v1/profiles/me", headers=headers).status_code == 200
    response = client.patch("/api/v1/profiles/me", json={"full_name": "Mei Lin"}, headers=headers)

    assert response.status_code == 200, response.text
    assert strict_schema.tables["users"][0]["full_name"] == "Mei Lin"
    assert strict_schema.tables["users"][0]["updated_at"] != NOW


def test_the_owner_assistant_already_matches_the_shared_rpcs(client, strict_schema, monkeypatch):
    # The assistant's functions run as the owner, through their stand-ins (tests/fake_rpcs/fb_owner_ai.py).
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))
    token = strict_schema.add_auth_user("olly@example.test")
    strict_schema.seed("users", [{"id": OWNER, "auth_user_id": strict_schema.tokens[token], "email": "olly@example.test",
                                  "primary_role": "LANDLORD", "status": "ACTIVE", "verification_status": "APPROVED",
                                  "updated_at": NOW}])
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/v1/me/owner-assistant", headers=headers).status_code == 200
    asked = client.post("/api/v1/me/owner-assistant/messages", headers=headers, json={"question": "Any repairs?"})
    assert asked.status_code == 200, asked.text
    assert [name for name, _ in strict_schema.rpc_calls] == [
        "mobile_owner_assistant_context", "mobile_owner_assistant_history",
        "mobile_owner_assistant_reserve", "mobile_owner_assistant_context", "mobile_owner_assistant_finish",
    ]
    assert strict_schema.rpc_unhandled == []
