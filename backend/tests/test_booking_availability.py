"""Clients can only request times inside the provider's weekly hours (Sydney time).

The hours are web.provider_availability rows and the services
mobile_provider_services rows, whose duration is text ("90 minutes").
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from app.services import bookings
from tests.factories_bookings import freeze_clock, hours, person, seed_provider, service, uid, web_rows

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER_ID, JON = uid("amelia"), uid("jon")
HOUR, LONG = uid("hour"), uid("long")
SUNDAY, MONDAY, SATURDAY = "2030-01-20", "2030-01-21", "2030-01-26"
OUTSIDE_HOURS = "That time is outside the provider's available hours. Choose another time."


@pytest.fixture
def weekday_provider(strict_schema, monkeypatch):
    """Open Monday to Friday, 9am to 5pm, with a lunch break on Mondays; it is Tuesday 15 Jan 2030."""
    freeze_clock(monkeypatch, bookings, datetime(2030, 1, 15, 12))
    seed_provider(strict_schema, PROVIDER_ID)
    strict_schema.seed("users", [person(JON, "Jonathan Hayes")])
    strict_schema.seed("mobile_provider_services", [service(HOUR, PROVIDER_ID, "Hour job", minutes=60),
                                                    service(LONG, PROVIDER_ID, "Long job", minutes=90)])
    strict_schema.seed("provider_availability", [
        hours(PROVIDER_ID, 1, "09:00:00", "12:00:00"),
        hours(PROVIDER_ID, 1, "13:00:00", "17:00:00"),
        *[hours(PROVIDER_ID, day, "09:00:00", "17:00:00") for day in range(2, 6)],
        hours(PROVIDER_ID, 6, "09:00:00", "17:00:00", is_available=False),
    ], schema="web")
    return strict_schema


def _request(day=MONDAY, at="10:00:00", service=HOUR, client=JON):
    return bookings.create_booking(client, {"provider_id": PROVIDER_ID, "service_id": service,
                                            "scheduled_date": day, "scheduled_time": at})


@pytest.mark.parametrize("day, at, service", [
    (SUNDAY, "03:00:00", HOUR),      # not a working day
    (SATURDAY, "10:00:00", HOUR),    # day switched off
    (MONDAY, "08:30:00", HOUR),      # before opening
    (MONDAY, "16:30:00", HOUR),      # runs past closing
    (MONDAY, "11:30:00", HOUR),      # runs into the lunch break
    (MONDAY, "12:15:00", HOUR),      # starts in the lunch break
    (MONDAY, "15:45:00", LONG),      # the longer service runs past closing
])
def test_requests_outside_the_weekly_hours_are_rejected(weekday_provider, day, at, service):
    with pytest.raises(HTTPException) as exc:
        _request(day, at, service)
    assert (exc.value.status_code, exc.value.detail) == (400, OUTSIDE_HOURS)
    assert not web_rows(weekday_provider, "bookings")


@pytest.mark.parametrize("day, at, service", [
    (MONDAY, "09:00:00", HOUR), (MONDAY, "11:00:00", HOUR), (MONDAY, "13:00:00", HOUR),
    (MONDAY, "16:00:00", HOUR), (MONDAY, "15:30:00", LONG), ("2030-01-25", "16:00:00", HOUR),
])
def test_requests_inside_a_window_are_accepted(weekday_provider, day, at, service):
    assert _request(day, at, service)["status"] == "new_enquiry"


def test_provider_without_any_hours_cannot_be_booked_for_a_time(weekday_provider):
    weekday_provider.schema_tables["web"]["provider_availability"] = []
    with pytest.raises(HTTPException) as exc:
        _request()
    assert exc.value.status_code == 400


def test_api_rejects_sunday_3am_for_a_weekday_provider(weekday_provider, client, as_profile):
    as_profile(JON, "tenant")
    response = client.post("/api/v1/bookings", json={"provider_id": PROVIDER_ID, "service_id": HOUR,
                                                     "scheduled_date": SUNDAY, "scheduled_time": "03:00:00"})
    assert response.status_code == 400
    assert response.json() == {"detail": OUTSIDE_HOURS}
    assert not web_rows(weekday_provider, "bookings")


@pytest.mark.parametrize("day", [SUNDAY, SATURDAY])
def test_api_rejects_a_date_without_a_time_on_a_day_off(weekday_provider, client, as_profile, day):
    as_profile(JON, "tenant")
    response = client.post("/api/v1/bookings", json={"provider_id": PROVIDER_ID, "service_id": HOUR,
                                                     "scheduled_date": day})
    assert response.status_code == 400
    assert response.json() == {"detail": OUTSIDE_HOURS}
    assert not web_rows(weekday_provider, "bookings")


def test_client_cannot_move_an_enquiry_outside_the_hours(weekday_provider):
    booking = _request()
    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(booking["id"], JON, None, {"scheduled_date": SUNDAY, "scheduled_time": "10:00:00"})
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        bookings.update_booking(booking["id"], JON, None, {"scheduled_time": "12:30:00"})
    [stored] = web_rows(weekday_provider, "bookings")
    assert (stored["scheduled_date"], stored["scheduled_time"]) == (MONDAY, "10:00:00")
    moved = bookings.update_booking(booking["id"], JON, None, {"scheduled_time": "14:00:00"})
    assert moved["scheduled_time"] == "14:00:00"


def test_client_cannot_move_a_date_only_enquiry_to_a_day_off(weekday_provider, client, as_profile):
    as_profile(JON, "tenant")
    created = client.post("/api/v1/bookings", json={"provider_id": PROVIDER_ID, "service_id": HOUR,
                                                    "scheduled_date": MONDAY})
    assert created.status_code == 201, created.text
    url = f"/api/v1/bookings/{created.json()['id']}"
    response = client.patch(url, json={"scheduled_date": SUNDAY})
    assert response.status_code == 400
    assert response.json() == {"detail": OUTSIDE_HOURS}
    assert web_rows(weekday_provider, "bookings")[0]["scheduled_date"] == MONDAY
    moved = client.patch(url, json={"scheduled_date": "2030-01-25"})  # a Friday
    assert moved.status_code == 200, moved.text
    assert (moved.json()["scheduled_date"], moved.json()["scheduled_time"]) == ("2030-01-25", None)


def test_provider_may_agree_a_time_outside_their_hours(weekday_provider):
    booking = _request()
    moved = bookings.update_booking(booking["id"], PROVIDER_ID, PROVIDER_ID,
                                    {"scheduled_date": SUNDAY, "scheduled_time": "08:00:00"})
    assert (str(moved["scheduled_date"]), moved["scheduled_time"]) == (SUNDAY, "08:00:00")
    confirmed = bookings.update_booking(booking["id"], PROVIDER_ID, PROVIDER_ID, {"status": "confirmed"})
    assert confirmed["status"] == "confirmed"
