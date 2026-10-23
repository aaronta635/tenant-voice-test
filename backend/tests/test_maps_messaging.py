"""maps_messaging: shared messaging, network and notification rows as the web's DTO fields (plan §3 a3-a5)."""

from datetime import datetime, timezone

import pytest

from app.db import schema
from app.services import maps_messaging as maps
from tests.factories_messaging import uid

CLIENT, PROVIDER, TENANT, OWNER, AGENT, ADMIN = (uid(name) for name in ("client", "provider", "tenant", "owner",
                                                                        "agent", "admin"))
ROLE = {CLIENT: "LANDLORD", PROVIDER: "SERVICE_PROVIDER", TENANT: "TENANT", OWNER: "LANDLORD", AGENT: "AGENT",
        ADMIN: "ADMIN"}


def row(*members, metadata=None, listing_id=None, read=None):
    return {
        "id": uid("thread"), "conversation_type": "DIRECT", "subject": "Hello", "listing_id": listing_id,
        "metadata": metadata, "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-02T00:00:00+00:00",
        "conversation_participants": [
            {"user_id": member, "role_label": None, "last_read_at": (read or {}).get(member),
             "users": {"primary_role": ROLE[member]} if member in ROLE else None}
            for member in members
        ],
    }


def parties(thread: dict) -> tuple:
    return thread["kind"], thread["client_id"], thread["provider_id"], thread["tenant_id"], thread["owner_id"]


# -- notifications -------------------------------------------------------------
def test_every_web_kind_is_stored_as_a_value_the_shared_enum_takes():
    allowed = schema.enum_values("notifications", "category")

    assert {kind: maps.db_notification_category(kind) for kind in maps.WEB_TO_NOTIFICATION_CATEGORY} == {
        "message": "social", "review": "social", "booking": "project", "application": "project",
        "property": "system", "account": "system",
    }
    assert set(maps.WEB_TO_NOTIFICATION_CATEGORY.values()) <= set(allowed)
    assert maps.db_notification_category("anything else") == maps.db_notification_category(None) == "system"


@pytest.mark.parametrize("link, kind", [
    ("/dashboard/messages?thread=abc", "message"),
    ("/tenant/messages", "message"),
    ("/owner/messages#latest", "message"),
    ("/dashboard/reviews", "review"),
    ("/providers/whitlock-property", "review"),  # where a provider's reply notice opens
    ("/owner/scorecard", "review"),  # a scorecard request (services/scorecards.py OWNER_LINK)
    ("/tenant/dashboard#scorecards", "review"),  # its answer (TENANT_LINK)
    ("/tenant/dashboard", "system"),
    ("/dashboard/bookings", "booking"),
    ("/tenant/applications", "application"),
    ("/dashboard/network", "system"),
    ("/providers", "system"),
    (None, "system"),
    ("", "system"),
])
def test_the_web_kind_is_read_back_from_the_link(link, kind):
    assert maps.web_notification_category(link) == kind


# -- connections ---------------------------------------------------------------
def test_connection_rows_read_as_the_web_shape():
    sent = {"id": uid("c"), "sender_user_id": CLIENT, "receiver_user_id": PROVIDER, "status": "ACCEPTED",
            "context_type": "NETWORK", "created_at": "2026-01-01T00:00:00+00:00", "responded_at": None}

    assert maps.flatten_connection(sent) == {
        "id": sent["id"], "requester_id": CLIENT, "addressee_id": PROVIDER, "status": "accepted",
        "created_at": sent["created_at"], "responded_at": None,
    }
    assert maps.flatten_connection({**sent, "status": "BLOCKED"})["status"] == "declined"
    assert maps.flatten_connection({**sent, "status": "WITHDRAWN"}) is None


def test_connection_status_maps_cover_the_shared_enum():
    labels = schema.enum_values("connection_requests", "status")

    assert set(maps.CONNECTION_TO_WEB) | {maps.WITHDRAWN} == set(labels)
    assert set(maps.WEB_TO_CONNECTION_STATUS.values()) <= set(labels)
    assert maps.connection_statuses("declined") == ["DECLINED", "BLOCKED"]
    assert maps.connection_statuses("pending") == ["PENDING"]
    assert maps.connection_statuses("withdrawn") == maps.connection_statuses("PENDING") == []


# -- conversations ---------------------------------------------------------------
def test_a_web_thread_takes_its_parties_from_its_metadata():
    booking = uid("booking")
    marketplace = maps.flatten_conversation(
        row(CLIENT, PROVIDER, metadata=maps.marketplace_metadata(CLIENT, PROVIDER, booking))
    )
    rental = maps.flatten_conversation(row(TENANT, OWNER, metadata=maps.rental_metadata(OWNER, TENANT),
                                           listing_id=uid("listing")))

    assert parties(marketplace) + (marketplace["booking_id"],) == ("marketplace", CLIENT, PROVIDER, None, None, booking)
    # A network DM's tenant side is just the smaller id, whatever the roles.
    assert parties(rental) == ("rental", None, None, OWNER, TENANT)
    assert (rental["property_id"], rental["subject"]) == (uid("listing"), "Hello")
    assert (rental["created_at"], rental["last_message_at"]) == ("2026-01-01T00:00:00+00:00",
                                                                 "2026-01-02T00:00:00+00:00")


def test_metadata_naming_someone_outside_the_thread_is_ignored():
    stale = maps.flatten_conversation(row(TENANT, PROVIDER, metadata=maps.marketplace_metadata(CLIENT, PROVIDER, None)))
    bad_booking = maps.flatten_conversation(
        row(CLIENT, PROVIDER, metadata=maps.marketplace_metadata(CLIENT, PROVIDER, "not-a-uuid"))
    )

    assert parties(stale) == ("marketplace", TENANT, PROVIDER, None, None)  # from the members' roles
    assert bad_booking["booking_id"] is None


@pytest.mark.parametrize("members, expected", [
    ((TENANT, PROVIDER), ("marketplace", TENANT, PROVIDER, None, None)),
    ((PROVIDER, OWNER), ("marketplace", OWNER, PROVIDER, None, None)),
    ((OWNER, TENANT), ("rental", None, None, TENANT, OWNER)),
    ((AGENT, TENANT), ("rental", None, None, TENANT, AGENT)),
    ((TENANT, ADMIN), ("rental", None, None, TENANT, ADMIN)),
])
def test_a_mobile_thread_takes_its_parties_from_the_members_roles(members, expected):
    assert parties(maps.flatten_conversation(row(*members))) == expected


def test_members_with_the_same_role_are_ordered_by_id():
    first, second = sorted([OWNER, CLIENT])  # both landlords

    assert parties(maps.flatten_conversation(row(second, first))) == ("rental", None, None, first, second)


def test_a_thread_with_one_member_or_a_departed_one_still_maps():
    gone = uid("gone")

    assert parties(maps.flatten_conversation(row(TENANT))) == ("rental", None, None, TENANT, None)
    assert parties(maps.flatten_conversation(row(PROVIDER, gone))) == ("marketplace", gone, PROVIDER, None, None)


# -- messages --------------------------------------------------------------------
def test_a_message_reads_as_message_out():
    message = {"id": uid("m"), "conversation_id": uid("thread"), "sender_user_id": CLIENT, "content": "Hi",
               "message_type": "TEXT", "created_at": "2026-01-01T10:00:00+00:00",
               "message_attachments": [{"file_url": f"{CLIENT}/a.png"}, {"file_url": f"{CLIENT}/b.png"}]}

    assert maps.flatten_message(message) == {
        "id": message["id"], "conversation_id": message["conversation_id"], "sender_id": CLIENT, "body": "Hi",
        "attachment_url": f"{CLIENT}/a.png", "is_read": False, "created_at": "2026-01-01T10:00:00+00:00",
    }
    system = maps.flatten_message({**message, "sender_user_id": None, "content": None, "message_attachments": []})
    assert (system["sender_id"], system["body"], system["attachment_url"]) == ("", "", None)


def test_a_message_is_read_once_another_member_read_the_thread_after_it():
    thread = row(CLIENT, PROVIDER, read={CLIENT: "2026-01-01T10:00:00Z", PROVIDER: "2026-01-01T09:00:00+00:00"})
    sent = {"id": uid("m"), "conversation_id": thread["id"], "content": "Hi", "sender_user_id": PROVIDER}

    def is_read(at):
        return maps.flatten_message({**sent, "created_at": at}, maps.read_by_others(thread, PROVIDER))["is_read"]

    assert is_read("2026-01-01T10:00:00.000+00:00")  # the same moment, another format
    assert is_read("2026-01-01T09:59:59.5+00:00")
    assert not is_read("2026-01-01T10:00:00.1+00:00")
    # The sender's own reading never counts.
    assert maps.read_by_others(thread, CLIENT) == datetime(2026, 1, 1, 9, tzinfo=timezone.utc)


def test_unread_means_someone_elses_message_after_the_last_read():
    read_at = maps.moment("2026-01-01T10:00:00+00:00")

    def unread(sender, at, seen=read_at):
        return maps.is_unread({"sender_user_id": sender, "created_at": at}, CLIENT, seen)

    assert unread(PROVIDER, "2026-01-01T10:00:01+00:00")
    assert not unread(PROVIDER, "2026-01-01T10:00:00+00:00")
    assert not unread(CLIENT, "2026-01-01T11:00:00+00:00")
    assert unread(None, "2026-01-01T11:00:00+00:00")  # a note from nobody
    assert unread(PROVIDER, "2025-01-01T00:00:00+00:00", seen=None)  # never read: all of them


def test_only_uuids_count_as_ids():
    assert maps.is_uuid(CLIENT) and maps.is_uuid(CLIENT.upper())
    for value in ("x,status.eq.accepted", "whitlock-property", f"{CLIENT},id.eq.{PROVIDER}", "", None, 7):
        assert not maps.is_uuid(value)
