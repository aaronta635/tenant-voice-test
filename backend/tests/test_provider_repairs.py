"""The assigned provider's repairs (tracker R33) on the strict shared schema.

A repair is a complaints row and its maintenance_work_orders row; the
provider's jobs are the work orders whose assigned_worker_id is their
users.id. Until a visit is booked they see the suburb, not the street, the
access notes or the tenant. Booking the visit (mobile_schedule_repair) and
marking the job done (mobile_complete_repair) are the shared functions, run
as the provider: they write the work order, add the timeline step and tell
the tenant and the owner. Only the assigned provider may do either, and only
to their own jobs; a done job waits for the tenant to confirm it.
"""

from datetime import datetime, timezone

import pytest

from app.services import maintenance
from tests.factories_repairs import (
    CLEANER, LISTING, OWNER, PLUMBER, PROPERTY, REPAIR, REQUEST, TENANT, case_of, seed_repair, seed_world, sign_in,
    work_order_of,
)
from tests.factories_reviews_complaints import complaint, events, property_row, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

OTHER_PROPERTY = "b6000000-0000-4000-8000-000000000009"
API = "/api/v1/me/repairs"
# 12:00 on 15 January 2030 in Sydney (AEDT, UTC+11).
NOW = datetime(2030, 1, 15, 1, 0, tzinfo=timezone.utc)
PAST_VISIT = "2030-01-14T22:30:00+00:00"    # 9:30 am on the 15th, Sydney
FUTURE_VISIT = "2030-01-16T22:30:00+00:00"  # 9:30 am on the 17th
VISIT = {"date": "2030-01-20", "time": "09:30", "duration_minutes": 90, "note": "I'll call before I arrive."}


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.setattr(maintenance, "_now", lambda: NOW)


@pytest.fixture
def world(strict_schema):
    seed_world(strict_schema)
    return strict_schema


def _assigned(db, **order):
    seed_repair(db, status=order.pop("status", "ASSIGNED"), worker=order.pop("worker", PLUMBER), **order)
    case_of(db)["metadata"]["access_notes"] = "Key under the mat."


def _notices(db, user_id) -> list[dict]:
    return [row for row in db.tables.get("notifications", []) if row["user_id"] == user_id]


def test_an_assigned_repair_shows_its_suburb_but_not_the_street_or_tenant(client, world, as_profile):
    _assigned(world)
    sign_in(as_profile, world, PLUMBER)

    [repair] = client.get(API).json()

    assert (repair["id"], repair["stage"], repair["status"]) == (REQUEST, "assigned", "in_progress")
    assert (repair["title"], repair["category"], repair["category_label"], repair["priority"]) == (
        "Burst pipe", "PLUMBING", "Plumbing", "high",
    )
    assert (repair["suburb"], repair["state"], repair["property_title"]) == ("Wollongong", "NSW", "Harbour flat")
    assert (repair["owner_id"], repair["owner_name"]) == (OWNER, "Olivia Owner")
    assert (repair["address"], repair["access_notes"], repair["tenant_name"]) == (None, None, None)
    assert client.get(f"{API}/{REQUEST}").json() == repair


def test_booking_the_visit_runs_the_shared_function_as_the_provider(client, world, as_profile):
    _assigned(world)
    provider = sign_in(as_profile, world, PLUMBER)

    response = client.post(f"{API}/{REQUEST}/schedule", json=VISIT)

    assert response.status_code == 200, response.text
    assert world.rpc_callers[-1] == ("mobile_schedule_repair", world.tokens[provider.access_token])
    assert world.rpc_calls[-1][1] == {
        "p_complaint_id": REPAIR, "p_appointment_at": "2030-01-20T09:30:00+11:00", "p_duration_minutes": 90,
        "p_note": "I'll call before I arrive.",
    }
    repair = response.json()
    assert (repair["stage"], repair["status"]) == ("scheduled", "in_progress")
    # 9:30 am Sydney daylight time is 22:30 UTC the day before.
    assert datetime.fromisoformat(repair["appointment_at"]) == datetime(2030, 1, 19, 22, 30, tzinfo=timezone.utc)
    assert (repair["estimated_duration_minutes"], repair["appointment_note"]) == (90, "I'll call before I arrive.")
    assert repair["address"] == "12 Harbour St, Wollongong, NSW, 2500"
    assert (repair["access_notes"], repair["tenant_name"]) == ("Key under the mat.", "Jane Tenant")
    order = work_order_of(world)
    assert (order["status"], order["estimated_duration_minutes"], order["appointment_note"]) == (
        "SCHEDULED", 90, "I'll call before I arrive.",
    )
    # The function's timeline step and notices; the web adds none of its own.
    [event] = events(world, REPAIR)
    assert (event["actor_user_id"], event["event_type"], event["note"], event["metadata"]) == (
        PLUMBER, "SCHEDULED", "Appointment booked for 20 Jan 2030 09:30", {"source": "mobile", "status": "In Progress"},
    )
    [tenant_notice] = _notices(world, TENANT)
    [owner_notice] = _notices(world, OWNER)
    assert tenant_notice["title"] == owner_notice["title"] == "Maintenance appointment scheduled"
    assert _notices(world, PLUMBER) == []


def test_moving_a_booked_visit_keeps_it_scheduled(client, world, as_profile):
    _assigned(world, status="SCHEDULED", appointment_at=FUTURE_VISIT, estimated_duration_minutes=60)
    sign_in(as_profile, world, PLUMBER)

    moved = client.post(f"{API}/{REQUEST}/schedule", json={**VISIT, "date": "2030-01-22", "note": None})

    assert moved.status_code == 200, moved.text
    order = work_order_of(world)
    assert (order["status"], order["appointment_at"], order["appointment_note"]) == (
        "SCHEDULED", "2030-01-21T22:30:00+00:00", "",
    )
    assert moved.json()["appointment_note"] is None


def test_a_visit_time_that_has_passed_is_refused_and_nothing_is_written(client, world, as_profile):
    _assigned(world)
    sign_in(as_profile, world, PLUMBER)

    refused = client.post(f"{API}/{REQUEST}/schedule", json={**VISIT, "date": "2030-01-15", "time": "11:59"})

    assert refused.status_code == 400
    assert (work_order_of(world)["status"], work_order_of(world)["appointment_at"]) == ("ASSIGNED", None)
    assert "mobile_schedule_repair" not in [name for name, _ in world.rpc_calls]


@pytest.mark.parametrize("visit", [
    {**VISIT, "duration_minutes": 10}, {**VISIT, "duration_minutes": 24 * 60 + 1}, {**VISIT, "date": "soon"},
    {**VISIT, "note": "x" * 501}, {**VISIT, "extra": True},
])
def test_a_visit_is_checked_before_anything_is_written(client, world, as_profile, visit):
    _assigned(world)
    sign_in(as_profile, world, PLUMBER)

    assert client.post(f"{API}/{REQUEST}/schedule", json=visit).status_code == 422
    assert work_order_of(world)["status"] == "ASSIGNED"


def test_marking_the_job_done_waits_for_the_tenant(client, world, as_profile):
    _assigned(world, status="SCHEDULED", appointment_at=PAST_VISIT, estimated_duration_minutes=60)
    provider = sign_in(as_profile, world, PLUMBER)

    response = client.post(f"{API}/{REQUEST}/complete", json={"note": "Replaced the burst pipe."})

    assert response.status_code == 200, response.text
    assert world.rpc_callers[-1] == ("mobile_complete_repair", world.tokens[provider.access_token])
    repair = response.json()
    assert (repair["stage"], repair["status"], repair["completion_note"]) == (
        "completed", "awaiting_confirmation", "Replaced the burst pipe.",
    )
    order = work_order_of(world)
    assert (order["status"], order["completion_note"]) == ("PENDING_TENANT_CONFIRMATION", "Replaced the burst pipe.")
    assert order["completed_at"]
    # The case stays open until the tenant confirms the work.
    assert (case_of(world)["status"], case_of(world)["resolved_at"]) == ("OPEN", None)
    [event] = events(world, REPAIR)
    assert (event["event_type"], event["note"], event["metadata"]["status"]) == (
        "COMPLETED", "Replaced the burst pipe.", "Awaiting Confirmation",
    )
    assert {notice["user_id"] for notice in world.tables["notifications"]} == {TENANT, OWNER}
    # Done now: nothing more to book or mark.
    assert client.post(f"{API}/{REQUEST}/complete", json={"note": "Again."}).status_code == 400
    assert client.post(f"{API}/{REQUEST}/schedule", json=VISIT).status_code == 400


def test_a_repair_cannot_be_marked_done_before_its_visit(client, world, as_profile):
    _assigned(world, status="SCHEDULED", appointment_at=FUTURE_VISIT)
    sign_in(as_profile, world, PLUMBER)

    refused = client.post(f"{API}/{REQUEST}/complete", json={"note": "Done early."})

    assert refused.status_code == 400
    assert work_order_of(world)["status"] == "SCHEDULED"


def test_a_repair_needs_a_booked_visit_before_it_is_done(client, world, as_profile):
    _assigned(world)
    sign_in(as_profile, world, PLUMBER)

    assert client.post(f"{API}/{REQUEST}/complete", json={"note": "Done."}).status_code == 400
    assert client.post(f"{API}/{REQUEST}/complete", json={"note": "x"}).status_code == 422
    assert work_order_of(world)["status"] == "ASSIGNED"


def test_a_provider_the_repair_moves_to_never_inherits_the_last_ones_visit(client, world, as_profile):
    # Assigning writes ASSIGNED and keeps the earlier assignee's visit time.
    _assigned(world, worker=CLEANER, appointment_at=FUTURE_VISIT, estimated_duration_minutes=60,
              appointment_note="Old visit.")
    sign_in(as_profile, world, CLEANER)

    [repair] = client.get(API).json()

    assert (repair["stage"], repair["appointment_at"], repair["appointment_note"]) == ("assigned", None, None)
    assert (repair["address"], repair["tenant_name"]) == (None, None)
    one = client.get(f"/api/v1/maintenance/{REQUEST}").json()
    assert (one["appointment_at"], one["appointment_note"], one["property_address"]) == (None, None, None)


@pytest.mark.parametrize("stored", ["PENDING_TENANT_CONFIRMATION", "RESOLVED"])
def test_a_closed_repair_can_be_neither_booked_nor_completed(client, world, as_profile, stored):
    _assigned(world, status=stored, appointment_at=PAST_VISIT)
    sign_in(as_profile, world, PLUMBER)

    assert client.post(f"{API}/{REQUEST}/schedule", json=VISIT).status_code == 400
    assert client.post(f"{API}/{REQUEST}/complete", json={"note": "Done."}).status_code == 400
    assert work_order_of(world)["status"] == stored


def test_the_old_status_route_never_lets_the_provider_skip_the_completion_rules(client, world, as_profile):
    _assigned(world, status="SCHEDULED", appointment_at=FUTURE_VISIT)
    sign_in(as_profile, world, PLUMBER)

    refused = client.patch(f"/api/v1/maintenance/{REQUEST}/status", json={"status": "resolved"})

    assert refused.status_code == 403
    assert "Assigned repairs page" in refused.json()["detail"]
    assert work_order_of(world)["status"] == "SCHEDULED"


def test_another_providers_job_is_never_shown_or_changed(client, world, as_profile):
    _assigned(world)
    sign_in(as_profile, world, CLEANER)

    assert client.get(API).json() == []
    for response in (
        client.get(f"{API}/{REQUEST}"),
        client.post(f"{API}/{REQUEST}/schedule", json=VISIT),
        client.post(f"{API}/{REQUEST}/complete", json={"note": "Done."}),
        client.get(f"{API}/not-a-uuid"),
    ):
        assert response.status_code == 404
    assert work_order_of(world)["status"] == "ASSIGNED"


@pytest.mark.parametrize("person", [TENANT, OWNER])
def test_only_a_provider_has_assigned_repairs(client, world, as_profile, person):
    _assigned(world)
    sign_in(as_profile, world, person)

    assert client.get(API).status_code == 403
    assert client.post(f"{API}/{REQUEST}/schedule", json=VISIT).status_code == 403


def test_signed_out_callers_are_refused(client, world):
    assert client.get(API).status_code == 401
    assert client.post(f"{API}/{REQUEST}/complete", json={"note": "Done."}).status_code == 401


def test_a_mobile_repair_without_a_listing_takes_its_suburb_from_the_case(client, world, as_profile):
    world.seed("properties", [property_row(OTHER_PROPERTY, OWNER, suburb="Thirroul", address_line_1="3 Beach Rd")])
    world.seed("complaints", [complaint("c6000000-0000-4000-8000-000000000002", TENANT, against_user_id=OWNER,
                                        property_id=OTHER_PROPERTY, category="ELECTRICAL")])
    world.seed("maintenance_work_orders", [work_order(
        "d6000000-0000-4000-8000-000000000002", "c6000000-0000-4000-8000-000000000002", TENANT,
        assigned_worker_id=PLUMBER, status="ASSIGNED",
    )])
    sign_in(as_profile, world, PLUMBER)

    [repair] = client.get(API).json()

    assert (repair["suburb"], repair["property_title"], repair["category"]) == ("Thirroul", None, "ELECTRICAL")
    assert repair["title"] == "The heater has been broken for three weeks."
    assert repair["owner_name"] == "Olivia Owner"


def test_open_jobs_come_first_and_booked_visits_soonest_first(client, world, as_profile):
    jobs = [
        ("01", "PENDING_TENANT_CONFIRMATION", PAST_VISIT, "2026-01-05T00:00:00+00:00"),
        ("02", "SCHEDULED", "2030-01-25T00:00:00+00:00", "2026-01-04T00:00:00+00:00"),
        ("03", "SCHEDULED", FUTURE_VISIT, "2026-01-03T00:00:00+00:00"),
        ("04", "ASSIGNED", None, "2026-01-02T00:00:00+00:00"),
    ]
    for suffix, stored, visit, created in jobs:
        world.seed("complaints", [complaint(f"c6000000-0000-4000-8000-0000000000{suffix}", TENANT,
                                            against_user_id=OWNER, property_id=PROPERTY, category="PLUMBING")])
        world.seed("maintenance_work_orders", [work_order(
            f"d6000000-0000-4000-8000-0000000000{suffix}", f"c6000000-0000-4000-8000-0000000000{suffix}", TENANT,
            listing_id=LISTING, landlord_user_id=OWNER, assigned_worker_id=PLUMBER, status=stored,
            appointment_at=visit, created_at=created,
        )])
    sign_in(as_profile, world, PLUMBER)

    listed = [(repair["id"][-2:], repair["stage"]) for repair in client.get(API).json()]

    assert listed == [("04", "assigned"), ("03", "scheduled"), ("02", "scheduled"), ("01", "completed")]


def test_the_repairs_api_keeps_the_street_from_the_provider_until_a_visit_is_booked(client, world, as_profile):
    _assigned(world)
    sign_in(as_profile, world, PLUMBER)

    [before] = client.get("/api/v1/maintenance").json()
    one = client.get(f"/api/v1/maintenance/{REQUEST}").json()
    assert client.post(f"{API}/{REQUEST}/schedule", json=VISIT).status_code == 200
    [after] = client.get("/api/v1/maintenance").json()

    for hidden in (before, one):
        assert (hidden["property_address"], hidden["access_notes"], hidden["tenant_name"]) == (None, None, None)
    assert (after["property_address"], after["access_notes"], after["tenant_name"]) == (
        "12 Harbour St", "Key under the mat.", "Jane Tenant",
    )
    # The tenant and the owner always see their own repair in full.
    for person in (TENANT, OWNER):
        sign_in(as_profile, world, person)
        [theirs] = client.get("/api/v1/maintenance").json()
        assert theirs["property_address"] == "12 Harbour St"


def test_a_winter_visit_is_booked_in_sydney_standard_time(client, world, as_profile):
    _assigned(world)
    sign_in(as_profile, world, PLUMBER)

    response = client.post(f"{API}/{REQUEST}/schedule", json={**VISIT, "date": "2030-07-01", "time": "09:00"})

    assert datetime.fromisoformat(response.json()["appointment_at"]) == datetime(2030, 6, 30, 23, 0, tzinfo=timezone.utc)
    assert events(world, REPAIR)[0]["note"] == "Appointment booked for 01 Jul 2030 09:00"
