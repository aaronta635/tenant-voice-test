"""The inbox names the other party and shows what a thread is about (conversations._decorate)."""

import pytest

from app.services import maps_messaging as maps
from tests.factories_messaging import message, person, provider_profile, seed_booking, seed_listing, seed_thread, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, JON, MEI, OTHER = (uid(name) for name in ("amelia", "jon", "mei", "other"))


@pytest.fixture
def people(strict_schema):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(JON, "LANDLORD", "John Doe"),
        person(MEI, "TENANT", "Mei Lin"),
        person(OTHER, "TENANT", "Ola Other"),
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(AMELIA, "Whitlock Property")])
    return strict_schema


def _inbox(client, as_profile, user, role) -> dict:
    as_profile(id=user, role=role)
    response = client.get("/api/v1/conversations")
    assert response.status_code == 200, response.text
    return {thread["id"]: thread for thread in response.json()}


def test_marketplace_inbox_names_the_other_party(client, people, as_profile):
    thread = seed_thread(people, [JON, AMELIA], metadata=maps.marketplace_metadata(JON, AMELIA, None))

    as_provider = _inbox(client, as_profile, AMELIA, "service_provider")[thread]
    as_client = _inbox(client, as_profile, JON, "landlord")[thread]

    assert (as_provider["counterpart_id"], as_provider["counterpart_name"], as_provider["counterpart_role"]) == (
        JON, "John Doe", "landlord"
    )
    # The client sees the business, with the owner's own account behind it.
    assert (as_client["counterpart_id"], as_client["counterpart_name"], as_client["counterpart_role"]) == (
        AMELIA, "Whitlock Property", "service_provider"
    )
    assert (as_client["kind"], as_client["client_id"], as_client["provider_id"]) == ("marketplace", JON, AMELIA)


def test_a_provider_without_a_business_name_goes_by_their_own(client, people, as_profile):
    people.tables["service_provider_profiles"] = []  # gone since, or never named
    thread = seed_thread(people, [JON, AMELIA], metadata=maps.marketplace_metadata(JON, AMELIA, None))

    assert _inbox(client, as_profile, JON, "landlord")[thread]["counterpart_name"] == "Amelia Whitlock"


def test_network_inbox_keeps_the_peer_name(client, people, as_profile):
    thread = seed_thread(people, [AMELIA, MEI], metadata=maps.rental_metadata(*sorted([AMELIA, MEI])))

    row = _inbox(client, as_profile, AMELIA, "service_provider")[thread]

    assert (row["kind"], row["counterpart_id"], row["counterpart_name"]) == ("rental", MEI, "Mei Lin")


def test_inbox_preview_identifies_latest_sender_without_exposing_other_threads(client, people, as_profile):
    thread = seed_thread(people, [JON, AMELIA], metadata=maps.marketplace_metadata(JON, AMELIA, None),
                         last_read={AMELIA: "2025-12-31T10:30:00+00:00"})
    other = seed_thread(people, [OTHER, AMELIA])
    elsewhere = seed_thread(people, [OTHER, MEI])
    people.seed("messages", [
        message(thread, JON, "Question", "2025-12-31T10:00:00+00:00"),
        message(thread, AMELIA, "My reply", "2025-12-31T11:00:00+00:00"),
        message(other, OTHER, "Different thread", "2025-12-31T12:00:00+00:00"),
        message(elsewhere, OTHER, "Private", "2025-12-31T13:00:00+00:00"),
    ])

    inbox = _inbox(client, as_profile, AMELIA, "service_provider")

    assert set(inbox) == {thread, other}
    assert (inbox[thread]["last_message"], inbox[thread]["last_message_sender_id"], inbox[thread]["unread_count"]) == (
        "My reply", AMELIA, 0
    )
    assert (inbox[other]["last_message"], inbox[other]["unread_count"]) == ("Different thread", 1)


def test_the_most_recently_active_thread_comes_first(client, people, as_profile):
    quiet = seed_thread(people, [MEI, JON], updated_at="2025-12-01T00:00:00+00:00")
    busy = seed_thread(people, [MEI, OTHER], updated_at="2025-12-30T00:00:00+00:00")
    new = seed_thread(people, [MEI, AMELIA], updated_at="2025-12-15T00:00:00+00:00")
    as_profile(id=MEI, role="tenant")

    assert [t["id"] for t in client.get("/api/v1/conversations").json()] == [busy, new, quiet]

    client.post(f"/api/v1/conversations/{quiet}/messages", json={"body": "Back again"})
    listed = client.get("/api/v1/conversations").json()
    assert [t["id"] for t in listed] == [quiet, busy, new]
    assert listed[0]["last_message_at"] > "2025-12-30"


def test_a_booking_thread_shows_its_booking(client, people, as_profile):
    service = uid("service")
    people.seed("mobile_provider_services", [{"id": service, "provider_user_id": AMELIA, "title": "Rental appraisal",
                                              "inclusions": [], "exclusions": []}])
    linked = seed_thread(people, [JON, AMELIA], id=uid("linked"))
    named = seed_thread(people, [MEI, AMELIA], id=uid("named"),
                        metadata=maps.marketplace_metadata(MEI, AMELIA, uid("mei-booking")))
    seed_booking(people, JON, AMELIA, id=uid("jon-booking"), conversation_id=linked, service_id=service)
    seed_booking(people, MEI, AMELIA, id=uid("mei-booking"), status="new_enquiry", property_suburb="Enmore")

    inbox = _inbox(client, as_profile, AMELIA, "service_provider")

    assert (inbox[linked]["booking_id"], inbox[linked]["context"]) == (uid("jon-booking"), "Rental appraisal")
    assert inbox[linked]["booking"] == {
        "id": uid("jon-booking"), "status": "confirmed", "service_title": "Rental appraisal",
        "scheduled_date": "2026-11-03", "scheduled_time": "10:00:00", "property_address": "12 Example Terrace",
        "price": 99.0,
    }
    assert (inbox[named]["booking"]["status"], inbox[named]["context"]) == ("new_enquiry", "Enmore")


def test_someone_elses_booking_is_never_shown_in_a_thread(client, people, as_profile):
    thread = seed_thread(people, [MEI, AMELIA], metadata=maps.marketplace_metadata(MEI, AMELIA, uid("jon-booking")))
    seed_booking(people, JON, AMELIA, id=uid("jon-booking"))
    as_profile(id=MEI, role="tenant")

    [row] = client.get("/api/v1/conversations").json()

    assert (row["id"], row["booking"]) == (thread, None)


def test_a_listing_thread_says_where_the_listing_is(client, people, as_profile):
    listing = seed_listing(people, JON, title="Sunny two-bedder", suburb="Marrickville")
    thread = seed_thread(people, [MEI, JON], listing_id=listing, subject="Inspection")
    plain = seed_thread(people, [MEI, OTHER], subject="Bond question")

    inbox = _inbox(client, as_profile, MEI, "tenant")

    assert (inbox[thread]["property_id"], inbox[thread]["context"]) == (listing, "Marrickville")
    assert (inbox[plain]["property_id"], inbox[plain]["context"]) == (None, "Bond question")
