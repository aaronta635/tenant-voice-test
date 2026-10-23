"""Who may open a marketplace thread, and the helpers other areas open and post into threads with.

A provider may write first only to a client they have dealt with; a thread
attaches only to the client's own booking (web.bookings). marketplace_thread()
and post_message() are what bookings uses for a booking's thread and notes.
"""

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.services import conversations
from app.services import maps_messaging as maps
from tests.factories_messaging import (
    connection, message, person, provider_profile, seed_booking, seed_listing, seed_thread, stored, uid,
)
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, JON, MEI, MALLORY = (uid(name) for name in ("amelia", "jon", "mei", "mallory"))


@pytest.fixture
def market(strict_schema):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(JON, "LANDLORD", "Jonathan Hayes"),
        person(MEI, "TENANT", "Mei Lin"),
        person(MALLORY, "TENANT", "Mallory"),
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(AMELIA, "Whitlock Property")])
    return strict_schema


def _open(client, as_profile, user, role, **payload):
    as_profile(id=user, role=role)
    return client.post("/api/v1/conversations", json={"provider_id": AMELIA, **payload})


# -- a provider writing first ---------------------------------------------------
def test_a_provider_cannot_write_first_to_a_stranger(client, market, as_profile):
    response = _open(client, as_profile, AMELIA, "service_provider", client_id=JON)

    assert response.status_code == 403
    assert response.json()["detail"].startswith("You can message clients who have booked or contacted you")
    assert not market.tables.get("conversations")


def _booked(db):
    seed_booking(db, JON, AMELIA)


def _shared_thread(db):
    seed_thread(db, [JON, AMELIA], listing_id=seed_listing(db, JON))  # e.g. a thread about Jon's listing


def _connected(db):
    db.seed("connection_requests", [connection(JON, AMELIA)])


def _assigned_repair(db):
    listing = seed_listing(db, JON)
    db.seed("complaints", [{"id": uid("complaint"), "reporter_user_id": MEI, "category": "plumbing",
                            "description": "Leak"}])
    db.seed("maintenance_work_orders", [{"complaint_id": uid("complaint"), "listing_id": listing,
                                         "tenant_user_id": MEI, "landlord_user_id": JON,
                                         "assigned_worker_id": AMELIA, "updated_at": "2026-01-01T00:00:00+00:00"}])


def _assistant_job(db):
    db.seed("mobile_ai_service_jobs", [{"id": uid("job"), "owner_id": JON, "provider_id": AMELIA,
                                        "listing_id": seed_listing(db, JON), "request": {}, "payload": {}}])


@pytest.mark.parametrize("history", [_booked, _shared_thread, _connected, _assigned_repair, _assistant_job],
                         ids=["booking", "thread", "connection", "repair", "assistant job"])
def test_a_provider_may_write_to_a_client_they_have_dealt_with(client, market, as_profile, history):
    history(market)

    response = _open(client, as_profile, AMELIA, "service_provider", client_id=JON)

    assert response.status_code == 201, response.text
    assert (response.json()["client_id"], response.json()["counterpart_name"]) == (JON, "Jonathan Hayes")
    # Find-or-create: the client opening it finds the same thread, not a new empty one.
    assert _open(client, as_profile, JON, "landlord").json()["id"] == response.json()["id"]


def test_a_repair_counts_for_its_tenant_too_but_not_for_anyone_else(client, market, as_profile):
    _assigned_repair(market)

    assert _open(client, as_profile, AMELIA, "service_provider", client_id=MEI).status_code == 201
    assert _open(client, as_profile, AMELIA, "service_provider", client_id=MALLORY).status_code == 403


# -- bookings -------------------------------------------------------------------
def test_a_thread_attaches_to_the_clients_own_booking(client, market, as_profile):
    booking = seed_booking(market, JON, AMELIA)

    general = _open(client, as_profile, JON, "landlord").json()
    about_booking = _open(client, as_profile, JON, "landlord", booking_id=booking).json()
    again = _open(client, as_profile, AMELIA, "service_provider", client_id=JON, booking_id=booking).json()

    assert about_booking["id"] != general["id"]
    assert again["id"] == about_booking["id"]
    assert (about_booking["booking_id"], about_booking["booking"]["status"]) == (booking, "confirmed")
    [row] = stored(market, "conversations", id=about_booking["id"])
    assert row["metadata"] == maps.marketplace_metadata(JON, AMELIA, booking)


@pytest.mark.parametrize("booking", [uid("jon-and-amelia"), uid("nothing"), "not-a-booking"])
def test_threads_cannot_attach_to_someone_elses_booking(client, market, as_profile, booking):
    seed_booking(market, JON, AMELIA, id=uid("jon-and-amelia"))

    response = _open(client, as_profile, MALLORY, "tenant", booking_id=booking)

    assert (response.status_code, response.json()["detail"]) == (404, "Booking not found")
    assert not market.tables.get("conversations")


# -- marketplace_thread() ----------------------------------------------------------
def test_marketplace_thread_finds_or_opens_the_pairs_thread(market):
    booking = seed_booking(market, MEI, AMELIA)

    general = conversations.marketplace_thread(MEI, AMELIA, subject="Hello")
    for_booking = conversations.marketplace_thread(MEI, AMELIA, booking_id=booking, subject="Rental appraisal",
                                                   created_by=AMELIA)

    assert conversations.marketplace_thread(MEI, AMELIA) == general
    assert conversations.marketplace_thread(MEI, AMELIA, booking_id=booking) == for_booking
    assert {key: general[key] for key in ("kind", "client_id", "provider_id", "booking_id", "subject")} == {
        "kind": "marketplace", "client_id": MEI, "provider_id": AMELIA, "booking_id": None, "subject": "Hello",
    }
    assert (for_booking["booking_id"], for_booking["subject"]) == (booking, "Rental appraisal")
    assert [(row["id"], row["created_by_user_id"]) for row in market.tables["conversations"]] == [
        (general["id"], MEI), (for_booking["id"], AMELIA),
    ]
    assert len(market.tables["conversation_participants"]) == 4


def test_marketplace_thread_takes_the_pairs_mobile_thread_as_their_general_one(market):
    mobile = seed_thread(market, [MEI, AMELIA])

    assert conversations.marketplace_thread(MEI, AMELIA)["id"] == mobile
    assert conversations.marketplace_thread(MEI, AMELIA, booking_id=seed_booking(market, MEI, AMELIA))["id"] != mobile


@pytest.mark.parametrize("members, conversation_type", [
    ([MEI, JON, AMELIA], "GROUP"),  # say, a repair the mobile app opened for tenant, landlord and tradie
    ([MEI, AMELIA], "GROUP"),
    ([MEI, JON, AMELIA], "DIRECT"),
], ids=["group", "group of two", "direct with a third member"])
def test_a_thread_anyone_else_may_be_in_is_never_the_pairs_own(
    client, market, as_profile, members, conversation_type
):
    shared = seed_thread(market, members, conversation_type=conversation_type, id=uid("shared"))

    from_client = _open(client, as_profile, MEI, "tenant")
    from_provider = _open(client, as_profile, AMELIA, "service_provider", client_id=MEI)
    helper = conversations.marketplace_thread(MEI, AMELIA)

    assert (from_client.status_code, from_provider.status_code) == (201, 201), (from_client.text, from_provider.text)
    assert from_client.json()["id"] == from_provider.json()["id"] == helper["id"] != shared
    [private] = stored(market, "conversations", id=helper["id"])
    assert private["conversation_type"] == "DIRECT"
    members_of = sorted(p["user_id"] for p in stored(market, "conversation_participants", conversation_id=private["id"]))
    assert members_of == sorted([MEI, AMELIA])


def test_two_providers_app_thread_is_their_general_one_whichever_is_the_client(market):
    # By roles alone the smaller id is the provider; here that one is the client.
    plumber = "ffffffff-ffff-4fff-bfff-ffffffffffff"
    market.seed("users", [person(plumber, "SERVICE_PROVIDER", "Oscar Plumbing")])
    mobile = seed_thread(market, [AMELIA, plumber])
    client_id, provider_id = sorted([AMELIA, plumber])

    assert conversations.marketplace_thread(client_id, provider_id)["id"] == mobile
    assert len(market.tables["conversations"]) == 1


def test_the_pairs_own_thread_is_found_past_an_older_group_thread(market):
    group = seed_thread(market, [MEI, JON, AMELIA], conversation_type="GROUP", id=uid("group"))
    private = seed_thread(market, [MEI, AMELIA], id=uid("private"))
    stored(market, "conversations", id=group)[0]["created_at"] = "2025-11-01T00:00:00+00:00"

    assert conversations.marketplace_thread(MEI, AMELIA)["id"] == private


def test_marketplace_thread_needs_both_people(market):
    for client_id in (uid("nobody"), "someone"):
        with pytest.raises(HTTPException) as caught:
            conversations.marketplace_thread(client_id, AMELIA)
        assert caught.value.status_code == 404
    assert not market.tables.get("conversations")


def test_a_thread_whose_members_fail_is_not_left_behind(market, monkeypatch):
    execute = FakeTableQuery.execute

    def members_fail(query):
        if query._name == "conversation_participants" and query._op == "insert":
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout",
                            "hint": None, "details": None})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", members_fail)

    with pytest.raises(APIError):
        conversations.marketplace_thread(MEI, AMELIA)
    assert market.tables["conversations"] == []


# -- post_message() ---------------------------------------------------------------
def test_post_message_writes_text_notes_and_files(market):
    thread = conversations.marketplace_thread(MEI, AMELIA)["id"]

    text = conversations.post_message(thread, AMELIA, "I've moved your visit to Friday 2 pm.")
    note = conversations.post_message(thread, None, "Booking confirmed", system=True)
    file = conversations.post_message(thread, AMELIA, "", attachment={"file_url": f"{AMELIA}/{'c' * 32}.pdf",
                                                                      "file_name": "quote.pdf",
                                                                      "mime_type": "application/pdf",
                                                                      "file_size_bytes": 1200})

    assert [(m["sender_user_id"], m["message_type"], m["content"]) for m in market.tables["messages"]] == [
        (AMELIA, "TEXT", "I've moved your visit to Friday 2 pm."),
        (None, "SYSTEM", "Booking confirmed"),
        (AMELIA, "FILE", None),
    ]
    [saved] = market.tables["message_attachments"]
    assert (saved["message_id"], saved["file_name"], saved["file_size_bytes"]) == (file["id"], "quote.pdf", 1200)
    assert (text["sender_id"], text["body"], text["is_read"]) == (
        AMELIA, "I've moved your visit to Friday 2 pm.", False
    )
    assert (note["sender_id"], file["attachment_url"]) == ("", f"{AMELIA}/{'c' * 32}.pdf")
    assert not market.tables.get("notifications")  # the caller's to send


@pytest.mark.parametrize("sender, file_url", [
    (None, f"{AMELIA}/{'d' * 32}.pdf"),
    (AMELIA, f"invoices/{'d' * 32}.pdf"),
    (AMELIA, f"{MEI}/{'d' * 32}.pdf"),
    (AMELIA, "https://example.test/invoice.pdf"),
], ids=["a note from nobody", "outside her upload folder", "someone else's upload", "a link"])
def test_post_message_refuses_a_file_readers_would_never_show(market, sender, file_url):
    thread = conversations.marketplace_thread(MEI, AMELIA)["id"]

    with pytest.raises(ValueError, match="the sender's own upload"):
        conversations.post_message(thread, sender, "Your invoice", system=sender is None,
                                   attachment={"file_url": file_url, "file_name": "invoice.pdf"})
    assert not market.tables.get("messages") and not market.tables.get("message_attachments")


def test_a_file_post_message_writes_is_shown_to_the_other_member(client, market, as_profile):
    thread = conversations.marketplace_thread(MEI, AMELIA)["id"]
    key = f"{AMELIA}/{'e' * 32}.pdf"
    market.storage.objects[("message-attachments", key)] = b"%PDF-1.7"

    conversations.post_message(thread, AMELIA, "Your invoice", attachment={"file_url": key, "file_name": "invoice.pdf"})
    as_profile(id=MEI, role="tenant")
    [listed] = client.get(f"/api/v1/conversations/{thread}/messages").json()

    signed = f"http://supabase.invalid/storage/v1/object/sign/message-attachments/{key}?"
    assert listed["attachment_url"].startswith(signed)


def test_post_message_moves_the_thread_up_the_inbox(client, market, as_profile):
    older = seed_thread(market, [MEI, JON], updated_at="2025-12-30T00:00:00+00:00")
    thread = seed_thread(market, [MEI, AMELIA], updated_at="2025-12-01T00:00:00+00:00")
    as_profile(id=MEI, role="tenant")
    assert [t["id"] for t in client.get("/api/v1/conversations").json()] == [older, thread]

    conversations.post_message(thread, AMELIA, "Your booking is confirmed", system=True)

    listed = client.get("/api/v1/conversations").json()
    assert [(t["id"], t["unread_count"]) for t in listed] == [(thread, 1), (older, 0)]
    assert listed[0]["last_message"] == "Your booking is confirmed"


def test_a_failed_bump_never_loses_the_message(market, monkeypatch, caplog):
    thread = seed_thread(market, [MEI, AMELIA])
    execute = FakeTableQuery.execute

    def bump_fails(query):
        if query._name == "conversations" and query._op == "update":
            raise APIError({"code": "57014", "message": "statement timeout", "hint": None, "details": None})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", bump_fails)

    sent = conversations.post_message(thread, MEI, "Hello")

    assert [m["id"] for m in market.tables["messages"]] == [sent["id"]]
    assert "could not move conversation" in caplog.text


def test_unread_counts_a_bookings_thread(market):
    thread = conversations.marketplace_thread(MEI, AMELIA)["id"]
    market.seed("messages", [message(thread, AMELIA, "Hi", "2025-12-31T10:00:00+00:00")])

    assert conversations.unread_counts(MEI, [thread]) == {thread: 1}
    assert conversations.unread_counts(AMELIA, [thread]) == {thread: 0}
