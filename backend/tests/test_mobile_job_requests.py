"""Job requests owners send a provider from the mobile app (mobile_ai_service_jobs, tracker R33).

The provider's dashboard lists their own through mobile_ai_jobs and moves
them on through mobile_ai_provider_job, both run as the provider, so the
function's moves are the only ones: pending to accepted or declined,
accepted to in progress, in progress to completed. The function tells the
owner each time.
"""

import pytest

from tests.factories_repairs import CLEANER, LISTING, OWNER, PLUMBER, REQUEST, seed_world, sign_in
from tests.factories_reviews_complaints import NOW

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/job-requests"
JOB = "e6000000-0000-4000-8000-000000000001"
OLDER = "e6000000-0000-4000-8000-000000000002"
CLEANERS = "e6000000-0000-4000-8000-000000000003"


def _job(id, provider, status="pending", created_at=NOW, **payload) -> dict:
    """A mobile_ai_service_jobs row as mobile_ai_provider_job's create leaves it."""
    return {
        "id": id, "owner_id": OWNER, "provider_id": provider, "listing_id": LISTING,
        "request": {"action": "create", "requestId": id, "propertyId": LISTING, "providerId": provider},
        "payload": {"id": id, "title": "Fix the gutters", "description": "Both sides of the roof.", "ownerId": OWNER,
                    "providerId": provider, "propertyTitle": "Harbour flat", "ownerName": "Olivia Owner",
                    "providerName": "Pat's Plumbing", "propertyId": LISTING, "status": status, "createdAt": created_at,
                    **payload},
        "created_at": created_at,
    }


@pytest.fixture
def world(strict_schema):
    seed_world(strict_schema)
    strict_schema.seed("mobile_ai_service_jobs", [
        _job(JOB, PLUMBER, created_at="2026-02-01T00:00:00+00:00"),
        _job(OLDER, PLUMBER, status="completed", created_at="2026-01-01T00:00:00+00:00", title="Unblock a drain",
             complaintId="c6000000-0000-4000-8000-000000000001"),
        _job(CLEANERS, CLEANER),
    ])
    return strict_schema


def _payload(db, job_id) -> dict:
    return next(row for row in db.tables["mobile_ai_service_jobs"] if row["id"] == job_id)["payload"]


def test_a_provider_sees_the_job_requests_sent_to_them(client, world, as_profile):
    provider = sign_in(as_profile, world, PLUMBER)

    jobs = client.get(API).json()

    assert world.rpc_callers[-1] == ("mobile_ai_jobs", world.tokens[provider.access_token])
    assert [(job["id"], job["status"], job["from_repair"]) for job in jobs] == [
        (JOB, "pending", False), (OLDER, "completed", True),
    ]
    first = jobs[0]
    assert (first["title"], first["description"], first["owner_name"], first["property_title"]) == (
        "Fix the gutters", "Both sides of the roof.", "Olivia Owner", "Harbour flat",
    )
    assert (first["owner_id"], first["listing_id"], first["next_statuses"]) == (OWNER, LISTING, ["accepted", "declined"])
    assert jobs[1]["next_statuses"] == []


def test_a_provider_moves_a_job_through_the_functions_steps(client, world, as_profile):
    sign_in(as_profile, world, PLUMBER)

    accepted = client.post(f"{API}/{JOB}/status", json={"status": "accepted"})
    started = client.post(f"{API}/{JOB}/status", json={"status": "in_progress"})
    done = client.post(f"{API}/{JOB}/status", json={"status": "completed"})

    assert [response.status_code for response in (accepted, started, done)] == [200, 200, 200], done.text
    assert (accepted.json()["next_statuses"], started.json()["status"], done.json()["status"]) == (
        ["in_progress"], "in_progress", "completed",
    )
    assert _payload(world, JOB)["status"] == "completed"
    # The function tells the owner of each move.
    notices = [row for row in world.tables["notifications"] if row["user_id"] == OWNER]
    assert [(notice["title"], notice["body"]) for notice in notices] == [("Service job updated", "Fix the gutters")] * 3


@pytest.mark.parametrize("move", ["in_progress", "completed"])
def test_a_job_moves_only_as_the_function_allows(client, world, as_profile, move):
    sign_in(as_profile, world, PLUMBER)

    refused = client.post(f"{API}/{JOB}/status", json={"status": move})

    assert (refused.status_code, refused.json()["detail"]) == (409, "Invalid job status change.")
    assert _payload(world, JOB)["status"] == "pending"
    assert world.tables.get("notifications", []) == []


def test_a_declined_job_stays_declined(client, world, as_profile):
    sign_in(as_profile, world, PLUMBER)

    assert client.post(f"{API}/{JOB}/status", json={"status": "declined"}).json()["status"] == "declined"
    assert client.post(f"{API}/{JOB}/status", json={"status": "accepted"}).status_code == 409
    assert client.post(f"{API}/{JOB}/status", json={"status": "cancelled"}).status_code == 422


def test_another_providers_job_is_never_shown_or_moved(client, world, as_profile):
    sign_in(as_profile, world, PLUMBER)

    for job_id in (CLEANERS, REQUEST, "not-a-uuid"):
        assert client.post(f"{API}/{job_id}/status", json={"status": "accepted"}).status_code == 404, job_id
    assert _payload(world, CLEANERS)["status"] == "pending"


@pytest.mark.parametrize("person", [OWNER, "a6000000-0000-4000-8000-000000000001"])
def test_only_a_provider_has_job_requests_here(client, world, as_profile, person):
    sign_in(as_profile, world, person)

    assert client.get(API).status_code == 403
    assert client.post(f"{API}/{JOB}/status", json={"status": "accepted"}).status_code == 403


def test_a_closed_account_gets_the_functions_refusal(client, world, as_profile):
    sign_in(as_profile, world, PLUMBER)
    next(row for row in world.tables["users"] if row["id"] == PLUMBER)["status"] = "SUSPENDED"

    refused = client.get(API)

    assert (refused.status_code, refused.json()["detail"]) == (403, "Sign in with an active Supabase account.")
