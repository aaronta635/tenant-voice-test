"""Clock input and public occupied-slot regressions, on the shared schema."""
from datetime import datetime

import pytest
from fastapi import HTTPException

from app.services import bookings
from tests.factories_bookings import freeze_clock, open_week, person, seed_provider, service, uid, web_rows

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER_ID, CLIENT_ID, SERVICE_ID = uid("clock-provider"), uid("clock-client"), uid("clock-service")
TODAY = "2030-01-15"
TOMORROW = "2030-01-16"


@pytest.fixture
def marketplace(strict_schema, monkeypatch):
    freeze_clock(monkeypatch, bookings, datetime(2030, 1, 15, 12))
    # Public provider routes resolve the profile row by id or slug (service_providers.require_published).
    seed_provider(strict_schema, PROVIDER_ID, slug="clock-provider")
    strict_schema.seed("users", [person(CLIENT_ID, "Clara Client")])
    strict_schema.seed("mobile_provider_services", [service(SERVICE_ID, PROVIDER_ID, minutes=60)])
    strict_schema.seed("provider_availability", open_week(PROVIDER_ID), schema="web")
    return strict_schema


def request(**overrides):
    payload = {"provider_id": PROVIDER_ID, "service_id": SERVICE_ID, "scheduled_date": TOMORROW, "scheduled_time": "10:00:00"}
    return bookings.create_booking(CLIENT_ID, {**payload, **overrides})


@pytest.mark.parametrize("clock", ["10:00:00Z", "10:00:00+11:00", "10:00:00-07:00"])
def test_api_rejects_timezone_offsets_as_field_errors(marketplace, client, as_profile, clock):
    as_profile(CLIENT_ID, "tenant")
    response = client.post("/api/v1/bookings", json={"provider_id": PROVIDER_ID, "service_id": SERVICE_ID, "scheduled_date": TOMORROW, "scheduled_time": clock})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "scheduled_time"]
    assert not web_rows(marketplace, "bookings")
    existing = request()
    response = client.patch(f"/api/v1/bookings/{existing['id']}", json={"scheduled_time": clock})
    assert response.status_code == 422
    assert web_rows(marketplace, "bookings")[0]["scheduled_time"] == "10:00:00"


def test_same_day_past_time_rejected_but_exact_now_allowed(marketplace):
    with pytest.raises(HTTPException) as error:
        request(scheduled_date=TODAY, scheduled_time="11:59:59")
    assert error.value.status_code == 400
    assert "past" in error.value.detail
    assert request(scheduled_date=TODAY, scheduled_time="12:00:00")["status"] == "new_enquiry"


def test_time_only_reschedule_validates_existing_day(marketplace):
    existing = request(scheduled_date=TODAY, scheduled_time="13:00:00")
    with pytest.raises(HTTPException) as error:
        bookings.update_booking(existing["id"], CLIENT_ID, None, {"scheduled_time": "10:00:00"})
    assert error.value.status_code == 400
    assert web_rows(marketplace, "bookings")[0]["scheduled_time"] == "13:00:00"


def test_date_only_reschedule_validates_existing_time(marketplace):
    existing = request(scheduled_time="10:00:00")
    with pytest.raises(HTTPException) as error:
        bookings.update_booking(existing["id"], CLIENT_ID, None, {"scheduled_date": TODAY})
    assert error.value.status_code == 400
    assert web_rows(marketplace, "bookings")[0]["scheduled_date"] == TOMORROW


def test_public_busy_slug_resolves_provider_id_and_rounds_outward(marketplace, client):
    existing = request(scheduled_time="10:00:30")
    bookings.update_booking(existing["id"], PROVIDER_ID, PROVIDER_ID, {"status": "confirmed"})
    response = client.get("/api/v1/providers/clock-provider/busy-times")
    assert response.status_code == 200
    assert response.json() == [{"date": TOMORROW, "start_time": "10:00", "end_time": "11:01"}]
    assert set(response.json()[0]) == {"date", "start_time", "end_time"}
