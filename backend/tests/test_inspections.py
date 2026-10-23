"""Inspection times, bookings and records (R13) on the mobile functions.

Every call runs through the stand-ins in tests/fake_rpcs/fb_inspections.py,
as the caller's JWT (current_app_user_id()). Authorization is checked per
role by direct API calls.

Regression cover: creating a time wrote columns that do not exist (500),
"Book inspection" only sent a chat message, and owners had no way to see or
decide a booking.
"""

import uuid

import pytest

from tests import fake_rpcs
from tests.factories_reviews_complaints import application, seed_rental, slot, user
from tests.fake_supabase import api_error

API = "/api/v1"
OWNER = "d0000000-0000-4000-8000-000000000001"
AGENT = "d0000000-0000-4000-8000-000000000002"
OTHER_OWNER = "d0000000-0000-4000-8000-000000000003"
PENDING_OWNER = "d0000000-0000-4000-8000-000000000004"
TESS = "c0000000-0000-4000-8000-000000000001"
TOM = "c0000000-0000-4000-8000-000000000002"
PROVIDER = "e0000000-0000-4000-8000-000000000001"
PROPERTY, LISTING = "b0000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000002"
OTHER_PROPERTY, OTHER_LISTING = "b0000000-0000-4000-8000-000000000003", "b0000000-0000-4000-8000-000000000004"
FUTURE, LATER = "2030-01-05T10:00:00+00:00", "2030-01-06T10:00:00+00:00"
PAST = "2020-01-05T10:00:00+00:00"

PEOPLE = {
    OWNER: ("Olivia Owner", "LANDLORD", "landlord"),
    AGENT: ("Alex Agent", "AGENT", "landlord"),
    OTHER_OWNER: ("Oscar Other", "LANDLORD", "landlord"),
    PENDING_OWNER: ("Pat Pending", "LANDLORD", "landlord"),
    TESS: ("Tess Tenant", "TENANT", "tenant"),
    TOM: ("Tom Tenant", "TENANT", "tenant"),
    PROVIDER: ("Pia Provider", "SERVICE_PROVIDER", "service_provider"),
}


def _uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, name))


def _auth(user_id: str) -> str:
    return _uuid(f"auth-{user_id}")


@pytest.fixture
def home(fake_db):
    """Olivia's flat, listed by her agent, and another owner's; tokens for everyone."""
    fake_db.seed("users", [
        user(person, name, role, auth_user_id=_auth(person),
             status="PENDING_VERIFICATION" if person == PENDING_OWNER else "ACTIVE")
        for person, (name, role, _) in PEOPLE.items()
    ])
    for person in PEOPLE:
        fake_db.tokens[f"jwt-{person}"] = _auth(person)
    seed_rental(fake_db, OWNER, PROPERTY, LISTING, created_by=AGENT)
    seed_rental(fake_db, OTHER_OWNER, OTHER_PROPERTY, OTHER_LISTING, title="Other flat")
    return fake_db


@pytest.fixture
def act_as(as_profile):
    def _act(person: str):
        name, _, role = PEOPLE[person]
        return as_profile(id=person, role=role, full_name=name, access_token=f"jwt-{person}")

    return _act


def _rows(db, table: str) -> list[dict]:
    return db.tables.get(table, [])


def _row(db, table: str, row_id: str) -> dict:
    return next(row for row in _rows(db, table) if row["id"] == row_id)


def _notices(db, person: str) -> list[tuple[str, str]]:
    return [(row["title"], row["body"]) for row in _rows(db, "notifications") if row["user_id"] == person]


def _callers(db, name: str) -> list:
    return [caller for called, caller in db.rpc_callers if called == name]


def _publish(client, starts, duration=30, listing=LISTING):
    return client.post(f"{API}/me/properties/{listing}/inspection-slots",
                       json={"starts_at": starts, "duration_minutes": duration})


def _book(client, slot_id, note=None):
    return client.post(f"{API}/inspection-slots/{slot_id}/bookings", json={"note": note})


def _decide(client, booking_id, decision):
    return client.post(f"{API}/inspection-bookings/{booking_id}/decision", json={"decision": decision})


# --------------------------------------------------------------------------- Anyone
def test_visitors_see_the_open_times_still_to_come_without_the_street(client, home):
    home.seed("mobile_inspection_slots", [
        slot(_uuid("later"), OWNER, LISTING, LATER, duration_minutes=15),
        slot(_uuid("next"), OWNER, LISTING, FUTURE),
        slot(_uuid("past"), OWNER, LISTING, PAST),
        slot(_uuid("cancelled"), OWNER, LISTING, FUTURE, status="cancelled"),
        # Another time: one open, held or booked slot per listing and start
        # (mobile_inspection_slots_listing_start_active_idx).
        slot(_uuid("held"), OWNER, LISTING, "2030-01-06T11:00:00+00:00", status="held"),
    ])

    response = client.get(f"{API}/properties/{LISTING}/inspections")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(item["id"], item["duration_minutes"], item["status"]) for item in body] == [
        (_uuid("next"), 45, "open"), (_uuid("later"), 15, "open")]
    assert {item["address"] for item in body} == {None}
    assert body[0]["property_title"] == "Harbour flat"


@pytest.mark.parametrize("listing_status", ["DRAFT", "PAUSED", "LEASED", "ARCHIVED"])
def test_a_home_that_is_not_listed_shows_no_times(client, home, listing_status):
    _row(home, "listings", LISTING)["status"] = listing_status
    home.seed("mobile_inspection_slots", [slot(_uuid("next"), OWNER, LISTING, FUTURE)])

    assert client.get(f"{API}/properties/{LISTING}/inspections").json() == []


# --------------------------------------------------------------------------- Owners publish times
def test_the_owner_publishes_times_entered_in_sydney_time(client, home, act_as):
    act_as(OWNER)

    # 9 Nov is daylight time (+11), 8 June standard time (+10).
    response = _publish(client, ["2030-11-09T10:00", "2030-06-08T10:00"], duration=45)

    assert response.status_code == 201, response.text
    assert [(item["starts_at"], item["duration_minutes"], item["status"]) for item in response.json()] == [
        ("2030-11-08T23:00:00Z", 45, "open"), ("2030-06-08T00:00:00Z", 45, "open")]
    assert sorted(row["starts_at"] for row in _rows(home, "mobile_inspection_slots")) == [
        "2030-06-08T00:00:00+00:00", "2030-11-08T23:00:00+00:00"]
    assert {(row["owner_id"], row["listing_id"]) for row in _rows(home, "mobile_inspection_slots")} == {(OWNER, LISTING)}
    # The function ran as the owner, not the service role.
    assert _callers(home, "mobile_inspection_create_slots") == [_auth(OWNER)]


def test_a_time_with_an_offset_is_taken_as_that_instant(client, home, act_as):
    act_as(OWNER)

    response = _publish(client, ["2030-01-05T21:00:00+11:00"])

    assert [item["starts_at"] for item in response.json()] == ["2030-01-05T10:00:00Z"]


def test_an_hour_that_does_not_exist_in_sydney_is_refused(client, home, act_as):
    act_as(OWNER)

    response = _publish(client, ["2030-10-06T02:30"])  # clocks go from 2:00 to 3:00

    assert response.status_code == 422
    assert response.json()["detail"] == ("Sun 6 Oct 2030, 2:30 AM does not exist in Sydney: "
                                         "clocks go forward an hour that night. Choose another time.")
    assert home.rpc_calls == []


def test_a_repeated_hour_reads_as_daylight_time(client, home, act_as):
    act_as(OWNER)

    response = _publish(client, ["2030-04-07T02:30"])  # 2:00 to 3:00 happens twice

    assert [item["starts_at"] for item in response.json()] == ["2030-04-06T15:30:00Z"]


def test_times_the_listing_already_has_are_skipped(client, home, act_as):
    home.seed("mobile_inspection_slots", [slot(_uuid("next"), OWNER, LISTING, FUTURE)])
    act_as(OWNER)

    response = _publish(client, ["2030-01-05T21:00", "2030-01-06T21:00", "2030-01-06T21:00"])

    assert response.status_code == 201, response.text
    assert [item["starts_at"] for item in response.json()] == ["2030-01-06T10:00:00Z"]
    again = _publish(client, ["2030-01-05T21:00"])
    assert (again.status_code, again.json()["detail"]) == (422, "Those times already have open or booked slots.")
    assert len(_rows(home, "mobile_inspection_slots")) == 2


@pytest.mark.parametrize("starts, duration, message", [
    (["2020-01-05T10:00"], 30, "Inspection times must be in the future."),
    (["2030-01-05T10:00", "2020-01-05T10:00"], 30, "Inspection times must be in the future."),
    ([], 30, "Add at least one inspection time."),
    ([f"2030-01-{day:02d}T10:00" for day in range(1, 22)], 30, "You can create up to 20 slots at once."),
    (["2030-01-05T10:00"], 25, "Choose a duration of 15, 30, 45, 60, 90 or 120 minutes."),
])
def test_the_functions_rules_for_new_times_come_back_as_422(client, home, act_as, starts, duration, message):
    act_as(OWNER)

    response = _publish(client, starts, duration)

    assert (response.status_code, response.json()["detail"]) == (422, message)
    assert _rows(home, "mobile_inspection_slots") == []


@pytest.mark.parametrize("person", [AGENT, OTHER_OWNER])  # the agent created the listing but does not own it
def test_only_the_property_owner_publishes_times(client, home, act_as, person):
    act_as(person)

    response = _publish(client, ["2030-01-05T10:00"])

    assert (response.status_code, response.json()["detail"]) == (403, "Choose one of your properties.")
    assert _rows(home, "mobile_inspection_slots") == []


# --------------------------------------------------------------------------- Tenants book
@pytest.fixture
def times(home):
    home.seed("mobile_inspection_slots", [
        slot(_uuid("next"), OWNER, LISTING, FUTURE),
        slot(_uuid("later"), OWNER, LISTING, LATER),
        slot(_uuid("past"), OWNER, LISTING, PAST),
        slot(_uuid("cancelled"), OWNER, LISTING, LATER, status="cancelled"),
        slot(_uuid("elsewhere"), OTHER_OWNER, OTHER_LISTING, FUTURE),
    ])
    return home


def test_a_tenant_books_an_open_time_and_the_owner_is_told(client, times, act_as):
    act_as(TESS)
    assert [item["id"] for item in client.get(f"{API}/properties/{LISTING}/inspection-slots").json()] == [
        _uuid("next"), _uuid("later")]

    response = _book(client, _uuid("next"), "  Could we see the garage too?  ")

    assert response.status_code == 201, response.text
    booking = response.json()
    assert (booking["status"], booking["slot_status"], booking["note"]) == ("pending", "held", "Could we see the garage too?")
    assert (booking["tenant_name"], booking["owner_name"], booking["address"]) == (
        "Tess Tenant", "Olivia Owner", "12 Harbour St, Wollongong, NSW, 2500")
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "held"
    assert _notices(times, OWNER) == [("New inspection request", "Tess Tenant requested an inspection. "
                                       "Open Inspections to accept, decline or ask to reschedule.")]
    assert [row["link"] for row in _rows(times, "notifications")] == ["/inspections"]
    assert _callers(times, "mobile_inspection_book") == [_auth(TESS)]
    # The held time is no longer offered, and the booking shows after a reload.
    assert [item["id"] for item in client.get(f"{API}/properties/{LISTING}/inspection-slots").json()] == [_uuid("later")]
    assert [item["id"] for item in client.get(f"{API}/me/inspection-bookings").json()] == [booking["id"]]


def test_a_booking_note_is_at_most_500_characters(client, times, act_as):
    act_as(TESS)

    assert _book(client, _uuid("next"), "x" * 501).status_code == 422
    assert _book(client, _uuid("next"), "x" * 500).status_code == 201


@pytest.mark.parametrize("slot_name", ["past", "cancelled", "missing"])
def test_a_past_cancelled_or_missing_time_cannot_be_booked(client, times, act_as, slot_name):
    act_as(TESS)

    response = _book(client, _uuid(slot_name))

    assert (response.status_code, response.json()["detail"]) == (422, "That inspection time is no longer available.")
    assert _rows(times, "mobile_inspection_bookings") == []


def test_a_time_someone_else_holds_cannot_be_booked_again(client, times, act_as):
    act_as(TESS)
    assert _book(client, _uuid("next")).status_code == 201
    act_as(TOM)

    response = _book(client, _uuid("next"))

    assert (response.status_code, response.json()["detail"]) == (422, "That inspection time is no longer available.")
    assert len(_rows(times, "mobile_inspection_bookings")) == 1


def test_one_active_booking_per_home(client, times, act_as):
    act_as(TESS)
    assert _book(client, _uuid("next")).status_code == 201

    response = _book(client, _uuid("later"))

    assert (response.status_code, response.json()["detail"]) == (422, "You already have an active inspection for this home.")
    assert _row(times, "mobile_inspection_slots", _uuid("later"))["status"] == "open"


def test_no_application_is_needed_but_the_home_must_be_listed(client, times, act_as):
    _row(times, "listings", LISTING)["status"] = "DRAFT"
    act_as(TESS)

    for response in (client.get(f"{API}/properties/{LISTING}/inspection-slots"), _book(client, _uuid("next"))):
        assert (response.status_code, response.json()["detail"]) == (
            422, "Inspections are only available while this property is listed for viewing.")


def test_a_home_where_the_tenant_is_owed_a_reschedule_is_held_by_that_booking(client, times, act_as):
    """The unique index keeps a reschedule request on its slot, so nobody else can take it."""
    times.seed("mobile_inspection_bookings", [{
        "id": _uuid("asked"), "slot_id": _uuid("next"), "owner_id": OWNER, "tenant_id": TESS, "listing_id": LISTING,
        "status": "reschedule_requested",
    }])
    act_as(TOM)

    response = _book(client, _uuid("next"))

    assert (response.status_code, response.json()["detail"]) == (409, "That inspection time is no longer available.")
    # Nothing of the failed booking was written.
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "open"
    assert [row["id"] for row in _rows(times, "mobile_inspection_bookings")] == [_uuid("asked")]
    assert _rows(times, "notifications") == []


def test_booking_another_time_closes_the_tenants_reschedule_request(client, times, act_as):
    times.seed("mobile_inspection_bookings", [{
        "id": _uuid("asked"), "slot_id": _uuid("next"), "owner_id": OWNER, "tenant_id": TESS, "listing_id": LISTING,
        "status": "reschedule_requested",
    }])
    act_as(TESS)

    assert _book(client, _uuid("later")).status_code == 201
    assert _row(times, "mobile_inspection_bookings", _uuid("asked"))["status"] == "cancelled"


def test_tenants_see_the_homes_with_open_times(client, times, act_as):
    act_as(TESS)

    response = client.get(f"{API}/me/inspection-homes")

    assert response.status_code == 200, response.text
    assert [(home["property_id"], home["owner_name"], home["open_slot_count"]) for home in response.json()] == [
        (LISTING, "Olivia Owner", 2), (OTHER_LISTING, "Oscar Other", 1)]


# --------------------------------------------------------------------------- Owners decide
@pytest.fixture
def requested(times, act_as, client):
    """Tess asked for the next time."""
    act_as(TESS)
    return _book(client, _uuid("next"), "After work please").json()["id"]


def test_the_owner_sees_times_and_requests_of_one_listing(client, requested, act_as):
    act_as(OWNER)

    response = client.get(f"{API}/me/inspections", params={"property_id": LISTING})

    assert response.status_code == 200, response.text
    body = response.json()
    # Cancelled times are left out; times from the last 14 days stay.
    assert [(item["id"], item["status"]) for item in body["slots"]] == [
        (_uuid("next"), "held"), (_uuid("later"), "open")]
    assert [(item["id"], item["tenant_name"], item["note"]) for item in body["bookings"]] == [
        (requested, "Tess Tenant", "After work please")]
    assert client.get(f"{API}/me/inspections", params={"property_id": OTHER_LISTING}).status_code == 403


def test_accepting_books_the_time_and_tells_the_tenant(client, times, requested, act_as):
    act_as(OWNER)

    response = _decide(client, requested, "accept")

    assert response.status_code == 200, response.text
    assert (response.json()["status"], response.json()["slot_status"]) == ("accepted", "booked")
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "booked"
    assert _notices(times, TESS) == [("Inspection viewing approved", "Your inspection viewing was approved. "
                                      "This is not a rental application decision. See Inspections for the time.")]
    assert _callers(times, "mobile_inspection_decide") == [_auth(OWNER)]
    # A booked time cannot be cancelled while the accepted viewing stands.
    cancelled = client.post(f"{API}/inspection-slots/{_uuid('next')}/cancel")
    assert (cancelled.status_code, cancelled.json()["detail"]) == (
        422, "Cancel the accepted booking before removing this slot.")


def test_declining_opens_the_time_to_others(client, times, requested, act_as):
    act_as(OWNER)
    assert _decide(client, requested, "  Reject ").json()["status"] == "rejected"
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "open"
    assert _notices(times, TESS)[-1][0] == "Inspection viewing declined"

    act_as(TOM)
    assert _book(client, _uuid("next")).status_code == 201


def test_asking_to_reschedule_lets_the_tenant_pick_another_time(client, times, requested, act_as):
    act_as(OWNER)
    assert _decide(client, requested, "reschedule").json()["status"] == "reschedule_requested"
    assert _notices(times, TESS)[-1] == ("Please reschedule inspection",
                                         "The owner asked you to pick a different inspection viewing time.")

    act_as(TESS)
    assert [item["status"] for item in client.get(f"{API}/me/inspection-bookings").json()] == ["reschedule_requested"]
    assert _book(client, _uuid("later")).status_code == 201
    assert [item["status"] for item in client.get(f"{API}/me/inspection-bookings").json()] == ["pending"]


def test_a_request_is_decided_once(client, times, requested, act_as):
    act_as(OWNER)
    assert _decide(client, requested, "accept").status_code == 200

    for decision in ("reject", "accept"):
        response = _decide(client, requested, decision)
        assert (response.status_code, response.json()["detail"]) == (422, "This booking has already been decided.")
    bad = _decide(client, requested, "maybe")
    assert (bad.status_code, bad.json()["detail"]) == (422, "Choose accept, reject or reschedule.")


def test_only_the_owner_decides_a_request(client, times, requested, act_as):
    act_as(OTHER_OWNER)
    assert (_decide(client, requested, "accept").status_code, _decide(client, _uuid("missing"), "accept").status_code) == (
        403, 404)
    assert _callers(times, "mobile_inspection_decide") == []
    assert _row(times, "mobile_inspection_bookings", requested)["status"] == "pending"


def test_cancelling_a_time_cancels_the_request_waiting_on_it(client, times, requested, act_as):
    act_as(OWNER)

    response = client.post(f"{API}/inspection-slots/{_uuid('next')}/cancel")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert _row(times, "mobile_inspection_bookings", requested)["status"] == "cancelled"
    assert _notices(times, TESS)[-1][0] == "Inspection slot cancelled"
    assert _callers(times, "mobile_inspection_cancel_slot") == [_auth(OWNER)]
    # The tenant no longer sees the cancelled request.
    act_as(TESS)
    assert client.get(f"{API}/me/inspection-bookings").json() == []


def test_only_the_owner_cancels_a_time(client, times, act_as):
    act_as(OTHER_OWNER)

    assert client.post(f"{API}/inspection-slots/{_uuid('next')}/cancel").status_code == 403
    assert client.post(f"{API}/inspection-slots/{_uuid('missing')}/cancel").status_code == 404
    assert _callers(times, "mobile_inspection_cancel_slot") == []
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "open"


def test_an_account_the_database_does_not_see_as_active_cannot_cancel_anyones_time(client, times, act_as):
    """With no app user the function's owner check is null, so it would cancel any slot: the web checks first."""
    from app.core.supabase import user_client

    act_as(PENDING_OWNER)
    assert client.post(f"{API}/inspection-slots/{_uuid('next')}/cancel").status_code == 403
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "open"

    # What the function does when called for that account.
    user_client(f"jwt-{PENDING_OWNER}").rpc("mobile_inspection_cancel_slot", {"p_slot_id": _uuid("next")}).execute()
    assert _row(times, "mobile_inspection_slots", _uuid("next"))["status"] == "cancelled"


# --------------------------------------------------------------------------- Records
@pytest.fixture
def applied(home):
    home.seed("rental_applications", [application(_uuid("tess-app"), LISTING, TESS, status="SUBMITTED"),
                                      application(_uuid("tom-app"), LISTING, TOM, status="WITHDRAWN")])
    return home


def _record(client, **over):
    payload = {"type": "Private viewing", "scheduled_at": "2030-11-09T10:00", "attendee_id": TESS,
               "notes": "Video call: https://meet.example.test/abc", **over}
    return client.post(f"{API}/me/properties/{LISTING}/inspection-records", json=payload)


def test_the_owner_schedules_a_remote_inspection_with_an_applicant(client, applied, act_as):
    act_as(OWNER)
    assert client.get(f"{API}/me/properties/{LISTING}/inspection-attendees").json() == [
        {"user_id": TESS, "name": "Tess Tenant"}]

    response = _record(client)

    assert response.status_code == 201, response.text
    record = response.json()
    assert (record["type"], record["scheduled_at"], record["status"], record["attendee_name"]) == (
        "Private viewing", "2030-11-08T23:00:00Z", "Scheduled", "Tess Tenant")
    assert record["notes"] == "Video call: https://meet.example.test/abc"
    assert [step["note"] for step in record["history"]] == ["Inspection scheduled by owner"]
    # The notice gives the Sydney time.
    assert _notices(applied, TESS) == [("Inspection scheduled", "Private viewing at Harbour flat on Sat 09 Nov, 10:00 AM.")]
    assert _callers(applied, "mobile_create_inspection") == [_auth(OWNER)]


@pytest.mark.parametrize("over, message", [
    ({"attendee_id": OTHER_OWNER}, "That person has not applied for this property."),
    ({"type": "Party"}, "Choose a valid inspection type."),
    ({"scheduled_at": "2020-01-05T10:00"}, "Choose a date and time in the future."),
    ({"notes": "x" * 1001}, "Notes can be up to 1000 characters."),
])
def test_the_rules_for_a_record_come_back_as_422(client, applied, act_as, over, message):
    act_as(OWNER)

    response = _record(client, **over)

    assert (response.status_code, response.json()["detail"]) == (422, message)
    assert _rows(applied, "mobile_inspections") == []


@pytest.mark.parametrize("person", [AGENT, OTHER_OWNER])
def test_only_the_owner_schedules_a_record(client, applied, act_as, person):
    act_as(person)

    response = _record(client)

    assert (response.status_code, response.json()["detail"]) == (
        403, "You can only schedule inspections for your own properties.")


def test_rescheduling_and_completing_a_record_keep_its_history(client, applied, act_as):
    act_as(OWNER)
    record = _record(client).json()

    moved = client.put(f"{API}/inspection-records/{record['id']}", json={
        "type": "Routine inspection", "scheduled_at": "2030-06-08T10:00", "attendee_id": TESS, "notes": "Bring keys"})

    assert moved.status_code == 200, moved.text
    assert (moved.json()["type"], moved.json()["scheduled_at"], moved.json()["notes"]) == (
        "Routine inspection", "2030-06-08T00:00:00Z", "Bring keys")
    assert _notices(applied, TESS)[-1] == ("Inspection rescheduled", "Routine inspection at Harbour flat is Sat 08 Jun, 10:00 AM.")

    done = client.post(f"{API}/inspection-records/{record['id']}/status",
                       json={"status": "Completed", "note": "Findings: the bathroom fan is broken."})

    assert done.status_code == 200, done.text
    assert [(step["status"], step["note"]) for step in done.json()["history"]] == [
        ("Scheduled", "Inspection scheduled by owner"),
        ("Scheduled", "Rescheduled to Sat 08 Jun, 10:00 AM"),
        ("Completed", "Findings: the bathroom fan is broken."),
    ]
    again = client.post(f"{API}/inspection-records/{record['id']}/status", json={"status": "Cancelled"})
    assert (again.status_code, again.json()["detail"]) == (422, "This inspection is already completed.")
    edit = client.put(f"{API}/inspection-records/{record['id']}", json={
        "type": "Routine inspection", "scheduled_at": "2030-06-08T10:00"})
    assert (edit.status_code, edit.json()["detail"]) == (422, "Only scheduled inspections can be edited.")


def test_cancelling_a_record_tells_the_attendee(client, applied, act_as):
    act_as(OWNER)
    record = _record(client).json()

    response = client.post(f"{API}/inspection-records/{record['id']}/status", json={"status": "Cancelled"})

    assert response.json()["status"] == "Cancelled"
    assert _notices(applied, TESS)[-1] == ("Inspection cancelled", "The inspection at Harbour flat has been cancelled.")
    bad = client.post(f"{API}/inspection-records/{record['id']}/status", json={"status": "Done"})
    assert (bad.status_code, bad.json()["detail"]) == (422, "Status must be Completed or Cancelled.")


def test_another_owner_cannot_touch_a_record(client, applied, act_as):
    act_as(OWNER)
    record = _record(client).json()
    act_as(OTHER_OWNER)

    assert client.put(f"{API}/inspection-records/{record['id']}", json={
        "type": "Open home", "scheduled_at": "2030-11-09T10:00"}).status_code == 403
    assert client.post(f"{API}/inspection-records/{record['id']}/status", json={"status": "Cancelled"}).status_code == 403
    assert client.get(f"{API}/me/inspection-records").json() == []


def test_owners_and_attendees_list_their_records(client, applied, act_as):
    act_as(OWNER)
    record = _record(client).json()
    assert [item["id"] for item in client.get(f"{API}/me/inspection-records").json()] == [record["id"]]
    assert client.get(f"{API}/me/inspection-records", params={"property_id": OTHER_LISTING}).json() == []

    act_as(TESS)
    [seen] = client.get(f"{API}/me/inspection-records").json()
    assert (seen["id"], seen["notes"], seen["address"]) == (
        record["id"], "Video call: https://meet.example.test/abc", "12 Harbour St, Wollongong, NSW, 2500")
    assert seen["listed"] is True
    _row(applied, "listings", LISTING)["status"] = "LEASED"
    assert client.get(f"{API}/me/inspection-records").json()[0]["listed"] is False
    act_as(TOM)
    assert client.get(f"{API}/me/inspection-records").json() == []


def test_an_attendee_reads_the_notes_but_not_the_owners_findings(client, applied, act_as):
    act_as(OWNER)
    record = _record(client).json()
    client.post(f"{API}/inspection-records/{record['id']}/status",
                json={"status": "Completed", "note": "Tess was late, decline her application."})

    act_as(TESS)
    [seen] = client.get(f"{API}/me/inspection-records").json()

    assert seen["notes"] == "Video call: https://meet.example.test/abc"
    assert [(step["status"], step["note"]) for step in seen["history"]] == [
        ("Scheduled", None), ("Completed", None)]
    assert "Tess was late" not in str(seen)


@pytest.mark.parametrize("code, message, expected", [
    ("23505", 'duplicate key value violates unique constraint "mobile_inspection_slots_listing_start_idx"',
     (409, "Those times already have open or booked slots.")),
    ("P0002", "Listing not found.", (404, "Listing not found.")),
    ("23514", "Duration must be between 15 and 120 minutes.", (422, "Duration must be between 15 and 120 minutes.")),
])
def test_a_functions_refusal_maps_to_its_http_status(client, home, act_as, monkeypatch, code, message, expected):
    def refuse(ctx, params):
        raise api_error(code, message)

    fake_rpcs.handler("mobile_inspection_create_slots")  # load the stand-ins before replacing one
    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_inspection_create_slots", refuse)
    act_as(OWNER)

    response = _publish(client, [FUTURE])

    assert (response.status_code, response.json()["detail"]) == expected
    assert _rows(home, "mobile_inspection_slots") == []


# --------------------------------------------------------------------------- Who may call what
TENANT_CALLS = [
    ("get", f"/properties/{LISTING}/inspection-slots", None),
    ("post", f"/inspection-slots/{_uuid('next')}/bookings", {}),
    ("get", "/me/inspection-bookings", None),
    ("get", "/me/inspection-homes", None),
]
OWNER_CALLS = [
    ("get", "/me/inspections", None),
    ("post", f"/me/properties/{LISTING}/inspection-slots", {"starts_at": ["2030-01-05T10:00"]}),
    ("post", f"/inspection-slots/{_uuid('next')}/cancel", None),
    ("post", f"/inspection-bookings/{_uuid('booking')}/decision", {"decision": "accept"}),
    ("get", f"/me/properties/{LISTING}/inspection-attendees", None),
    ("post", f"/me/properties/{LISTING}/inspection-records", {"type": "Open home", "scheduled_at": "2030-01-05T10:00"}),
    ("put", f"/inspection-records/{_uuid('record')}", {"type": "Open home", "scheduled_at": "2030-01-05T10:00"}),
    ("post", f"/inspection-records/{_uuid('record')}/status", {"status": "Cancelled"}),
]


def _send(client, method, path, body):
    return getattr(client, method)(f"{API}{path}", **({"json": body} if body is not None else {}))


@pytest.mark.parametrize("method, path, body", TENANT_CALLS)
@pytest.mark.parametrize("role", ["landlord", "service_provider", "admin"])
def test_tenant_calls_refuse_other_roles(client, times, as_profile, role, method, path, body):
    as_profile(id=OWNER, role=role, access_token=f"jwt-{OWNER}")

    assert _send(client, method, path, body).status_code == 403
    assert times.rpc_calls == []


@pytest.mark.parametrize("method, path, body", OWNER_CALLS)
@pytest.mark.parametrize("role", ["tenant", "service_provider", "admin"])
def test_owner_calls_refuse_other_roles(client, times, as_profile, role, method, path, body):
    as_profile(id=TESS, role=role, access_token=f"jwt-{TESS}")

    assert _send(client, method, path, body).status_code == 403
    assert times.rpc_calls == []


@pytest.mark.parametrize("method, path, body", TENANT_CALLS + OWNER_CALLS + [("get", "/me/inspection-records", None)])
def test_every_inspection_call_needs_a_sign_in(client, times, method, path, body):
    assert _send(client, method, path, body).status_code == 401


@pytest.mark.parametrize("role", ["service_provider", "admin"])
def test_records_are_for_owners_and_tenants(client, times, as_profile, role):
    as_profile(id=PROVIDER, role=role, access_token=f"jwt-{PROVIDER}")

    assert client.get(f"{API}/me/inspection-records").status_code == 403


# --------------------------------------------------------------------------- The stand-ins with no app user
def _service(name, params):
    from app.core.supabase import get_supabase_client

    return get_supabase_client().rpc(name, params).execute().data


@pytest.mark.parametrize("name, params, code, message", [
    ("mobile_inspection_open_slots", {"p_listing_id": LISTING}, "42501", "Sign in to book an inspection."),
    ("mobile_inspection_book", {"p_slot_id": _uuid("next")}, "42501", "Sign in to book an inspection."),
    ("mobile_inspection_create_slots", {"p_listing_id": LISTING, "p_starts": [FUTURE]}, "42501",
     "Choose one of your properties."),
    ("mobile_create_inspection", {"p_listing_id": LISTING, "p_type": "Open home", "p_scheduled_at": FUTURE}, "42501",
     "Please sign in first."),
    ("mobile_owner_inspections", {}, "42501", "Please sign in first."),
])
def test_without_an_app_user_the_functions_refuse(times, name, params, code, message):
    from postgrest.exceptions import APIError

    with pytest.raises(APIError) as refused:
        _service(name, params)
    assert (refused.value.code, refused.value.message) == (code, message)


def test_without_an_app_user_the_lists_are_empty_and_decide_goes_through(times):
    """Like cancel, decide compares the owner with <>: a null app user passes."""
    times.seed("mobile_inspection_bookings", [{
        "id": _uuid("asked"), "slot_id": _uuid("next"), "owner_id": OWNER, "tenant_id": TESS, "listing_id": LISTING,
    }])

    assert _service("mobile_inspection_owner_list", {}) == {"slots": [], "bookings": []}
    assert _service("mobile_inspection_my_bookings", {}) == []
    assert _service("mobile_inspection_decide", {"p_booking_id": _uuid("asked"), "p_decision": "accept"})["status"] == "accepted"


def test_an_evening_time_reads_as_pm_in_the_notice(client, applied, act_as):
    act_as(OWNER)

    _record(client, scheduled_at="2030-11-09T21:30")

    assert _notices(applied, TESS) == [("Inspection scheduled", "Private viewing at Harbour flat on Sat 09 Nov, 09:30 PM.")]
