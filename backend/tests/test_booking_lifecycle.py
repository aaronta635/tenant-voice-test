"""Booking lifecycle side effects on the shared schema: ledger rows, rescheduling and notifications.

A booking is a web.bookings row between two users rows; its service is a
mobile_provider_services row, and its ledger rows are web.invoices and
web.transactions.
"""

import copy
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.services import bookings, ledger
from tests.factories_bookings import freeze_clock, open_week, person, rows, seed_provider, service, uid, web_rows
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

TODAY = date(2030, 1, 15)
TOMORROW = (TODAY + timedelta(days=1)).isoformat()
YESTERDAY = (TODAY - timedelta(days=1)).isoformat()
AMELIA, JON, MALLORY = uid("amelia"), uid("jon"), uid("mallory")
APPRAISAL, RETIRED, QUICK = uid("appraisal"), uid("retired"), uid("quick")


@pytest.fixture(autouse=True)
def booking_clock(monkeypatch):
    """Freeze the marketplace clock; lifecycle tests explicitly advance to the job."""
    now = freeze_clock(monkeypatch, bookings, datetime(2030, 1, 15, 12))

    def set_time(day=TOMORROW, at="10:00:00"):
        now[0] = datetime.fromisoformat(f"{day}T{at}").replace(tzinfo=now[0].tzinfo)

    return set_time


@pytest.fixture
def marketplace(strict_schema):
    seed_provider(strict_schema, AMELIA, "Whitlock Property", "Amelia Whitlock")
    strict_schema.seed("users", [person(JON, "Jonathan Hayes"), person(MALLORY, "Mallory")])
    strict_schema.seed("mobile_provider_services", [
        service(APPRAISAL, AMELIA, "Rental appraisal", price=99),
        service(RETIRED, AMELIA, "Old service", price=50, live=False),
    ])
    strict_schema.seed("provider_availability", open_week(AMELIA), schema="web")
    return strict_schema


def _request(client=JON, **over):
    payload = {"provider_id": AMELIA, "service_id": APPRAISAL, "scheduled_date": TOMORROW,
               "scheduled_time": "10:00:00", "property_suburb": "Newtown"}
    payload.update(over)
    return bookings.create_booking(client, payload)


def _minutes(db, service_id, minutes):
    next(row for row in db.tables["mobile_provider_services"] if row["id"] == service_id)["duration"] = f"{minutes} minutes"


def test_new_enquiry_notifies_the_provider(marketplace):
    created = _request()
    assert created["price"] == 99
    [stored] = web_rows(marketplace, "bookings")
    assert (stored["client_id"], stored["provider_id"], stored["service_id"], stored["status"]) == (
        JON, AMELIA, APPRAISAL, "new_enquiry",
    )
    [notice] = rows(marketplace, "notifications", user_id=AMELIA)
    assert notice["title"] == "New enquiry from Jonathan Hayes"
    assert (notice["link"], notice["category"]) == ("/dashboard/bookings", "project")


@pytest.mark.parametrize(
    "over, client",
    [({"service_id": RETIRED}, JON), ({"scheduled_date": YESTERDAY}, JON), ({}, AMELIA)],
)
def test_invalid_requests_are_rejected(marketplace, over, client):
    payload = {"provider_id": AMELIA, "service_id": APPRAISAL, **over}
    with pytest.raises(HTTPException):
        bookings.create_booking(client, payload)
    assert not web_rows(marketplace, "bookings")


def test_completing_a_job_writes_payment_fee_and_paid_invoice(marketplace, booking_clock):
    job = _request()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "confirmed"})
    [invoice] = web_rows(marketplace, "invoices", booking_id=job["id"])
    assert (invoice["status"], invoice["amount"], invoice["provider_id"]) == ("issued", 99, AMELIA)

    booking_clock()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "in_progress"})
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "completed"})

    ledger_rows = {r["type"]: r["amount"] for r in web_rows(marketplace, "transactions", booking_id=job["id"])}
    assert ledger_rows == {"payment": 99.0, "platform_fee": 8.42}
    assert web_rows(marketplace, "invoices", booking_id=job["id"])[0]["status"] == "paid"
    titles = [n["title"] for n in rows(marketplace, "notifications", user_id=JON)]
    assert titles == [
        "Whitlock Property accepted your booking",
        "Whitlock Property has started your job",
        "Whitlock Property marked your job as done",
    ]


def test_ledger_is_idempotent_per_booking(marketplace):
    job = _request()
    ledger.record_completion(job)
    ledger.record_completion(job)
    assert len(web_rows(marketplace, "transactions", booking_id=job["id"])) == 2
    assert len(web_rows(marketplace, "invoices", booking_id=job["id"])) == 1


def test_declining_voids_the_open_invoice(marketplace):
    job = _request()
    ledger.issue_invoice(job)
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "declined"})
    assert web_rows(marketplace, "invoices", booking_id=job["id"])[0]["status"] == "void"


def test_provider_rescheduling_messages_and_notifies_the_client(marketplace):
    job = _request()
    later = (TODAY + timedelta(days=3)).isoformat()
    updated = bookings.update_booking(
        job["id"], AMELIA, AMELIA, {"scheduled_date": later, "scheduled_time": "14:00:00"}
    )
    assert updated["status"] == "new_enquiry"
    # The booking's own thread, opened for it and kept on the booking.
    [thread] = rows(marketplace, "conversations")
    assert thread["metadata"] == {"kind": "marketplace", "client_id": JON, "provider_id": AMELIA, "booking_id": job["id"]}
    assert (updated["conversation_id"], web_rows(marketplace, "bookings")[0]["conversation_id"]) == (thread["id"],) * 2
    [message] = rows(marketplace, "messages", conversation_id=thread["id"])
    assert (message["sender_user_id"], message["message_type"]) == (AMELIA, "TEXT")
    assert "2:00 pm" in message["content"]
    [notice] = rows(marketplace, "notifications", user_id=JON)
    assert notice["title"] == "Whitlock Property rescheduled your booking"
    assert notice["link"] == f"/tenant/messages?thread={thread['id']}"


def test_client_cannot_move_a_confirmed_booking(marketplace):
    job = _request()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "confirmed"})
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], JON, None, {"scheduled_date": TOMORROW, "scheduled_time": "15:00:00"})
    assert exc.value.status_code == 403


def test_a_slot_cannot_be_double_booked(marketplace):
    first = _request()
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed"})
    with pytest.raises(HTTPException) as exc:
        _request()
    assert exc.value.status_code == 409


def test_closed_bookings_cannot_be_edited(marketplace):
    job = _request()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "declined"})
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], JON, None, {"notes": "changed my mind"})
    assert exc.value.status_code == 400


def test_client_cannot_cancel_a_started_job(marketplace, booking_clock):
    job = _request()
    booking_clock()
    for status in ("confirmed", "in_progress"):
        bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": status})
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], JON, None, {"status": "cancelled"})
    assert exc.value.status_code == 403


@pytest.mark.parametrize("current_status,next_status", [("confirmed", "in_progress"), ("in_progress", "completed")])
def test_future_jobs_cannot_start_or_complete_or_write_payments(marketplace, current_status, next_status):
    job = _request()
    web_rows(marketplace, "bookings")[0]["status"] = current_status
    before_notices = list(marketplace.tables.get("notifications", []))
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": next_status})
    assert exc.value.status_code == 400
    assert "scheduled time" in exc.value.detail
    assert web_rows(marketplace, "bookings", id=job["id"])[0]["status"] == current_status
    assert not web_rows(marketplace, "transactions", booking_id=job["id"])
    assert marketplace.tables.get("notifications", []) == before_notices


def test_start_waits_for_sydney_time_then_succeeds_at_exact_boundary(marketplace, booking_clock):
    job = _request()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "confirmed"})
    booking_clock(at="09:59:59")
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "in_progress"})
    assert exc.value.status_code == 400
    booking_clock(at="10:00:00")
    updated = bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "in_progress"})
    assert updated["status"] == "in_progress"


def test_unscheduled_job_cannot_start(marketplace):
    job = _request(scheduled_date=None, scheduled_time=None)
    web_rows(marketplace, "bookings")[0]["status"] = "confirmed"
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "in_progress"})
    assert exc.value.status_code == 400
    assert "date" in exc.value.detail


def test_duration_overlap_blocks_different_start_times_but_allows_adjacent_jobs(marketplace):
    _minutes(marketplace, APPRAISAL, 90)
    first = _request(scheduled_time="10:00:00")
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed"})
    for at in ("09:30:00", "10:30:00", "11:29:00"):
        with pytest.raises(HTTPException) as exc:
            _request(scheduled_time=at)
        assert exc.value.status_code == 409
    adjacent = _request(scheduled_time="11:30:00")
    assert adjacent["scheduled_time"] == "11:30:00"


def test_a_service_without_a_readable_duration_takes_an_hour(marketplace):
    next(row for row in marketplace.tables["mobile_provider_services"] if row["id"] == APPRAISAL)["duration"] = ""
    first = _request(scheduled_time="10:00:00")
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed"})
    with pytest.raises(HTTPException) as exc:
        _request(scheduled_time="10:59:00")
    assert exc.value.status_code == 409
    assert _request(scheduled_time="11:00:00")["status"] == "new_enquiry"


def test_confirming_existing_enquiry_rechecks_duration_overlap(marketplace):
    _minutes(marketplace, APPRAISAL, 120)
    first = _request(scheduled_time="10:00:00")
    second = _request(scheduled_time="11:00:00")
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed"})
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(second["id"], AMELIA, AMELIA, {"status": "confirmed"})
    assert exc.value.status_code == 409
    assert not web_rows(marketplace, "invoices", booking_id=second["id"])
    assert web_rows(marketplace, "bookings", id=second["id"])[0]["status"] == "new_enquiry"


def test_cross_midnight_duration_blocks_following_morning(marketplace):
    _minutes(marketplace, APPRAISAL, 120)
    first = _request(scheduled_time="21:00:00")
    # Only the provider can agree a job that runs past midnight.
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed", "scheduled_time": "23:30:00"})
    next_day = (TODAY + timedelta(days=2)).isoformat()
    with pytest.raises(HTTPException) as exc:
        _request(scheduled_date=next_day, scheduled_time="00:30:00")
    assert exc.value.status_code == 409
    assert _request(scheduled_date=next_day, scheduled_time="01:30:00")["status"] == "new_enquiry"


def test_public_busy_times_exposes_only_intervals_and_splits_midnight(marketplace, client):
    _minutes(marketplace, APPRAISAL, 120)
    first = _request(scheduled_time="21:00:00", notes="Private client details", property_address="Private address")
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed", "scheduled_time": "23:30:00"})
    _request(scheduled_time="10:00:00")  # Unaccepted enquiry is not a public busy slot.
    response = client.get(f"/api/v1/providers/{AMELIA}/busy-times")
    assert response.status_code == 200
    assert response.json() == [
        {"date": TOMORROW, "start_time": "23:30", "end_time": "24:00"},
        {"date": (TODAY + timedelta(days=2)).isoformat(), "start_time": "00:00", "end_time": "01:30"},
    ]
    assert all(set(slot) == {"date", "start_time", "end_time"} for slot in response.json())
    assert "Private" not in response.text and first["id"] not in response.text


def test_public_busy_times_hides_unpublished_provider(marketplace, client):
    marketplace.tables["service_provider_profiles"][0]["metadata"]["is_published"] = False
    response = client.get(f"/api/v1/providers/{AMELIA}/busy-times")
    assert response.status_code == 404


def test_conflict_uses_each_services_duration(marketplace):
    _minutes(marketplace, APPRAISAL, 90)
    marketplace.seed("mobile_provider_services", [service(QUICK, AMELIA, "Quick look", minutes=30)])
    first = _request(scheduled_time="10:00:00")
    bookings.update_booking(first["id"], AMELIA, AMELIA, {"status": "confirmed"})
    assert _request(service_id=QUICK, scheduled_time="09:30:00")["status"] == "new_enquiry"
    with pytest.raises(HTTPException) as exc:
        _request(service_id=QUICK, scheduled_time="09:45:00")
    assert exc.value.status_code == 409


def test_provider_client_scope_does_not_mix_work_jobs_or_other_clients(marketplace, client, as_profile):
    other, other_service = uid("other-provider"), uid("other-service")
    seed_provider(marketplace, other, "Other Co", "Olga Other", slug="other-co")
    marketplace.seed("mobile_provider_services", [service(other_service, other, "Other job")])
    marketplace.seed("provider_availability", open_week(other), schema="web")
    work = _request()
    payload = {"provider_id": other, "service_id": other_service, "scheduled_date": TOMORROW, "scheduled_time": "13:00:00"}
    personal = bookings.create_booking(AMELIA, payload)
    foreign = bookings.create_booking(MALLORY, payload)
    as_profile(AMELIA)
    all_bookings = client.get("/api/v1/bookings")
    assert all_bookings.status_code == 200
    assert {row["id"] for row in all_bookings.json()} == {work["id"], personal["id"]}
    client_history = client.get("/api/v1/bookings?scope=client")
    assert client_history.status_code == 200
    assert {row["id"] for row in client_history.json()} == {personal["id"]}
    assert foreign["id"] not in client_history.text


def _in_progress_job(marketplace, booking_clock) -> dict:
    job = _request()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "confirmed"})
    booking_clock()
    bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "in_progress"})
    return bookings.get_booking(job["id"])


def test_mark_done_that_loses_a_race_records_no_payment(marketplace, booking_clock, monkeypatch):
    job = _in_progress_job(marketplace, booking_clock)
    # The provider cancelled the job in another tab after this request read it.
    monkeypatch.setattr(bookings, "get_booking", lambda booking_id: copy.deepcopy(job))
    web_rows(marketplace, "bookings", id=job["id"])[0]["status"] = "cancelled"
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "completed"})
    assert exc.value.status_code == 409
    assert not web_rows(marketplace, "transactions", booking_id=job["id"])
    assert web_rows(marketplace, "invoices", booking_id=job["id"])[0]["status"] == "issued"


def test_two_simultaneous_mark_done_requests_record_one_payment(marketplace, booking_clock, monkeypatch):
    job = _in_progress_job(marketplace, booking_clock)
    # Both requests read the job while it was still in progress.
    monkeypatch.setattr(bookings, "get_booking", lambda booking_id: copy.deepcopy(job))
    service_title = ledger._service_title
    second: dict = {}

    def second_request_meanwhile(service_id):
        # The ledger looks the title up between its "already paid?" check and
        # its insert: run the other tab's request right there, once.
        if not second:
            second["started"] = True
            try:
                second["status"] = bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "completed"})["status"]
            except HTTPException as exc:
                second["status"] = exc.status_code
        return service_title(service_id)

    monkeypatch.setattr(ledger, "_service_title", second_request_meanwhile)
    first = bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "completed"})
    assert (first["status"], second["status"]) == ("completed", 409)
    assert sorted(r["type"] for r in web_rows(marketplace, "transactions", booking_id=job["id"])) == ["payment", "platform_fee"]


def test_failed_ledger_write_reopens_the_job_so_mark_done_can_be_retried(marketplace, booking_clock, monkeypatch):
    job = _in_progress_job(marketplace, booking_clock)
    execute = FakeTableQuery.execute
    timeouts = [APIError({"code": "57014", "message": "canceling statement due to statement timeout",
                          "hint": None, "details": None})]

    def ledger_insert_times_out_once(self):
        if (self._schema, self._name, self._op) == ("web", "transactions", "insert") and timeouts:
            raise timeouts.pop()
        return execute(self)

    monkeypatch.setattr(FakeTableQuery, "execute", ledger_insert_times_out_once)
    done = {"status": "completed", "completion_report": "Appraisal emailed"}
    with pytest.raises(APIError):
        bookings.update_booking(job["id"], AMELIA, AMELIA, done)
    reopened = web_rows(marketplace, "bookings", id=job["id"])[0]
    assert (reopened["status"], reopened.get("completion_report")) == ("in_progress", None)
    assert not web_rows(marketplace, "transactions", booking_id=job["id"])

    assert bookings.update_booking(job["id"], AMELIA, AMELIA, done)["status"] == "completed"
    assert sorted(r["type"] for r in web_rows(marketplace, "transactions", booking_id=job["id"])) == ["payment", "platform_fee"]
    assert web_rows(marketplace, "invoices", booking_id=job["id"])[0]["status"] == "paid"


def test_status_changes_move_updated_at(marketplace):
    job = _request()
    updated = bookings.update_booking(job["id"], AMELIA, AMELIA, {"status": "confirmed"})
    # web.bookings has an updated_at trigger: the write itself sends no updated_at.
    assert updated["updated_at"] > job["updated_at"]
    assert web_rows(marketplace, "bookings")[0]["updated_at"] == updated["updated_at"]


def test_an_unknown_booking_id_is_not_found(marketplace):
    for unknown in ("not-a-booking", uid("nothing")):
        with pytest.raises(HTTPException) as exc:
            bookings.get_booking(unknown)
        assert exc.value.status_code == 404
