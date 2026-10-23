"""A booking's thread is a shared conversation, kept in web.bookings.conversation_id (migration plan §3 c3).

The shared conversations have no booking_id. Bookings opens a booking's
thread with conversations.marketplace_thread() and keeps its id; the booking
card opens the same thread through POST /conversations, which names the
booking in the thread's metadata only, so a booking without conversation_id
takes that thread. Unread counts are the viewer's, by the inbox's rule.
"""

from datetime import datetime

import pytest

from app.services import bookings
from app.services import maps_messaging as maps
from tests.factories_bookings import freeze_clock, open_week, person, rows, seed_provider, service, uid, web_rows
from tests.factories_messaging import message, seed_thread

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, JON, OTHER = uid("amelia"), uid("jon"), uid("other-provider")
APPRAISAL = uid("appraisal")
API = "/api/v1"


@pytest.fixture
def market(strict_schema, monkeypatch):
    freeze_clock(monkeypatch, bookings, datetime(2030, 1, 15, 12))
    seed_provider(strict_schema, AMELIA, "Whitlock Property", "Amelia Whitlock", slug="whitlock-property")
    seed_provider(strict_schema, OTHER, "Other Co", "Olga Other", slug="other-co")
    strict_schema.seed("users", [person(JON, "Jonathan Hayes", "LANDLORD")])
    strict_schema.seed("mobile_provider_services", [service(APPRAISAL, AMELIA, "Rental appraisal", price=99)])
    strict_schema.seed("provider_availability", open_week(AMELIA), schema="web")
    return strict_schema


def _book(client, as_profile) -> dict:
    as_profile(JON, "landlord")
    response = client.post(f"{API}/bookings", json={"provider_id": AMELIA, "service_id": APPRAISAL,
                                                     "scheduled_date": "2030-01-16", "scheduled_time": "10:00:00"})
    assert response.status_code == 201, response.text
    return response.json()


def _listed(client, as_profile, user, role) -> dict:
    as_profile(user, role)
    response = client.get(f"{API}/bookings")
    assert response.status_code == 200, response.text
    return {booking["id"]: booking for booking in response.json()}


def _open_from_the_card(client, as_profile, booking) -> str:
    """What BookingList does when a booking has no thread yet."""
    as_profile(JON, "landlord")
    opened = client.post(f"{API}/conversations", json={"provider_id": AMELIA, "booking_id": booking["id"],
                                                        "subject": "Rental appraisal"})
    assert opened.status_code == 201, opened.text
    return opened.json()["id"]


def test_a_new_booking_has_no_thread_until_someone_writes(client, market, as_profile):
    booking = _book(client, as_profile)

    assert (booking["conversation_id"], booking["unread_count"]) == (None, 0)
    assert not rows(market, "conversations")


def test_the_thread_the_booking_card_opened_is_the_bookings_thread(client, market, as_profile):
    booking = _book(client, as_profile)
    thread = _open_from_the_card(client, as_profile, booking)
    sent = client.post(f"{API}/conversations/{thread}/messages", json={"body": "Is 10am still fine?"})
    assert sent.status_code == 201, sent.text

    seen_by_provider = _listed(client, as_profile, AMELIA, "service_provider")[booking["id"]]
    seen_by_client = _listed(client, as_profile, JON, "landlord")[booking["id"]]

    assert (seen_by_provider["conversation_id"], seen_by_provider["unread_count"]) == (thread, 1)
    assert (seen_by_client["conversation_id"], seen_by_client["unread_count"]) == (thread, 0)
    # Nothing was written to find it: the link is the thread's metadata.
    assert web_rows(market, "bookings")[0]["conversation_id"] is None


def test_reading_the_thread_clears_the_bookings_unread_count(client, market, as_profile):
    booking = _book(client, as_profile)
    thread = _open_from_the_card(client, as_profile, booking)
    client.post(f"{API}/conversations/{thread}/messages", json={"body": "Hello"})

    as_profile(AMELIA, "service_provider")
    assert client.post(f"{API}/conversations/{thread}/read").status_code == 204
    assert _listed(client, as_profile, AMELIA, "service_provider")[booking["id"]]["unread_count"] == 0


def test_a_thread_naming_the_booking_between_other_people_is_not_its_thread(client, market, as_profile):
    booking = _book(client, as_profile)
    # Jon and another provider's thread, whose metadata names Jon's booking with Amelia.
    seed_thread(market, [JON, OTHER], metadata=maps.marketplace_metadata(JON, OTHER, booking["id"]))

    assert _listed(client, as_profile, JON, "landlord")[booking["id"]]["conversation_id"] is None


def test_an_app_thread_between_the_two_is_not_the_bookings_thread(client, market, as_profile):
    booking = _book(client, as_profile)
    app_thread = seed_thread(market, [JON, AMELIA])
    market.seed("messages", [message(app_thread, AMELIA, "Hi from the app", "2025-12-31T10:00:00+00:00")])

    listed = _listed(client, as_profile, JON, "landlord")[booking["id"]]
    assert (listed["conversation_id"], listed["unread_count"]) == (None, 0)


def test_rescheduling_posts_into_the_thread_the_card_opened_and_keeps_it(client, market, as_profile):
    booking = _book(client, as_profile)
    thread = _open_from_the_card(client, as_profile, booking)

    as_profile(AMELIA, "service_provider")
    moved = client.patch(f"{API}/bookings/{booking['id']}", json={"scheduled_date": "2030-01-17",
                                                                   "scheduled_time": "14:00:00"})

    assert moved.status_code == 200, moved.text
    assert moved.json()["conversation_id"] == thread
    assert [row["id"] for row in rows(market, "conversations")] == [thread]
    [note] = rows(market, "messages", conversation_id=thread)
    assert (note["sender_user_id"], note["message_type"]) == (AMELIA, "TEXT")
    assert note["content"].startswith("I've rescheduled Rental appraisal: Thu 17 Jan at 2:00 pm.")
    assert web_rows(market, "bookings")[0]["conversation_id"] == thread
    [notice] = rows(market, "notifications", user_id=JON, title="Whitlock Property rescheduled your booking")
    assert notice["link"] == f"/owner/messages?thread={thread}"


def test_rescheduling_twice_keeps_one_thread_for_the_booking(client, market, as_profile):
    booking = _book(client, as_profile)
    as_profile(AMELIA, "service_provider")
    for at in ("14:00:00", "15:00:00"):
        response = client.patch(f"{API}/bookings/{booking['id']}", json={"scheduled_time": at})
        assert response.status_code == 200, response.text

    [thread] = rows(market, "conversations")
    assert thread["metadata"] == maps.marketplace_metadata(JON, AMELIA, booking["id"])
    assert thread["created_by_user_id"] == AMELIA
    assert len(rows(market, "messages", conversation_id=thread["id"])) == 2
    assert web_rows(market, "bookings")[0]["conversation_id"] == thread["id"]
    # The booking's thread is not the pair's general one.
    as_profile(JON, "landlord")
    general = client.post(f"{API}/conversations", json={"provider_id": AMELIA}).json()
    assert general["id"] != thread["id"]


def test_the_providers_status_notice_opens_the_bookings_thread(client, market, as_profile):
    booking = _book(client, as_profile)
    thread = _open_from_the_card(client, as_profile, booking)

    as_profile(AMELIA, "service_provider")
    assert client.patch(f"{API}/bookings/{booking['id']}", json={"status": "confirmed"}).status_code == 200

    [notice] = rows(market, "notifications", user_id=JON, title="Whitlock Property accepted your booking")
    assert notice["link"] == f"/owner/messages?thread={thread}"


def test_a_linked_thread_counts_only_other_peoples_unread_messages(client, market, as_profile):
    booking = _book(client, as_profile)
    thread = seed_thread(market, [JON, AMELIA], metadata=maps.marketplace_metadata(JON, AMELIA, booking["id"]),
                         last_read={AMELIA: "2025-12-31T10:00:00+00:00"})
    web_rows(market, "bookings")[0]["conversation_id"] = thread
    market.seed("messages", [
        message(thread, JON, "Seen already", "2025-12-31T09:00:00+00:00"),
        message(thread, JON, "New", "2025-12-31T11:00:00+00:00"),
        message(thread, AMELIA, "Mine", "2025-12-31T12:00:00+00:00"),
    ])

    assert _listed(client, as_profile, AMELIA, "service_provider")[booking["id"]]["unread_count"] == 1
    assert _listed(client, as_profile, JON, "landlord")[booking["id"]]["unread_count"] == 1
