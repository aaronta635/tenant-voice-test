"""Repairs for tenants and owners on the shared contract (tracker R06), by direct requests per role.

A repair is a complaints row (what was reported) and its work order (who
does it, and where it stands), as the mobile app keeps it. The web moves it
only through the mobile app's functions, run as the person taking the step,
so the work order's status is only ever OPEN, ASSIGNED, SCHEDULED,
PENDING_TENANT_CONFIRMATION or RESOLVED, and the functions write the
timeline and the notices (tests/fake_rpcs/fa_repairs.py stands in for them).
"""

import io

import pytest

from tests.factories_repairs import (
    APPLICATION, CLEANER, EMPTY_LISTING, LISTING, OTHER_OWNER, OTHER_TENANT, OWNER, PLUMBER, PROPERTY, REPAIR,
    REQUEST, TENANT, case_of, seed_repair, seed_world, sign_in, work_order_of,
)
from tests.factories_reviews_complaints import complaint, events, user, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/maintenance"
WORK_ORDER_STATUSES = {"OPEN", "ASSIGNED", "SCHEDULED", "PENDING_TENANT_CONFIRMATION", "RESOLVED"}
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
NEW_REPAIR = {
    "property_id": LISTING,
    "title": "Burst pipe",
    "description": "Water coming through the kitchen ceiling.",
    "category": "PLUMBING",
    "priority": "urgent",
    "access_notes": "Key under the mat.",
}


@pytest.fixture
def world(strict_schema):
    seed_world(strict_schema)
    return strict_schema


def _caller(db, function: str) -> str | None:
    """The auth user the last call of function ran as."""
    return next(caller for name, caller in reversed(db.rpc_callers) if name == function)


def _auth_id(db, user_id: str) -> str:
    return next(row for row in db.tables["users"] if row["id"] == user_id)["auth_user_id"]


def _statuses(db) -> set[str]:
    return {row["status"] for row in db.tables.get("maintenance_work_orders", [])}


# ---------------------------------------------------------------------------
# Reporting a repair
# ---------------------------------------------------------------------------
def test_a_tenant_reports_a_repair_for_the_home_they_rent(client, world, as_profile):
    sign_in(as_profile, world, TENANT)

    response = client.post(API, json=NEW_REPAIR)

    assert response.status_code == 201, response.text
    body = response.json()
    assert _caller(world, "mobile_create_repair") == _auth_id(world, TENANT)
    [order] = world.tables["maintenance_work_orders"]
    case = case_of(world, order["complaint_id"])
    assert body["id"] == order["id"]
    assert (order["status"], order["listing_id"], order["tenant_user_id"], order["landlord_user_id"]) == (
        "OPEN", LISTING, TENANT, OWNER,
    )
    assert (case["category"], case["severity"], case["property_id"], case["against_user_id"]) == (
        "PLUMBING", "CRITICAL", PROPERTY, OWNER,
    )
    assert case["metadata"]["mobile"] == {"issueTitle": "Burst pipe", "photos": [], "createdBy": TENANT}
    assert (case["metadata"]["createdByRole"], case["metadata"]["access_notes"]) == ("TENANT", "Key under the mat.")
    assert (body["status"], body["title"], body["category"], body["category_label"], body["priority"]) == (
        "open", "Burst pipe", "PLUMBING", "Plumbing", "urgent",
    )
    assert (body["owner_name"], body["tenant_name"], body["property_title"]) == ("Olivia Owner", "Jane Tenant", "Harbour flat")
    assert (body["can_confirm"], body["can_rate"], body["can_assign"], body["can_resolve"]) == (False, False, False, False)
    # The function tells the owner; the web adds no notice of its own.
    [notice] = world.tables["notifications"]
    assert (notice["user_id"], notice["title"], notice["body"]) == (OWNER, "New repair request", "Jane Tenant reported: Burst pipe")
    # A repair is not a complaint on the complaint pages.
    assert client.get("/api/v1/complaints").json() == []
    assert [r["id"] for r in client.get(API).json()] == [order["id"]]


def test_a_tenant_reports_only_for_a_home_they_rent(client, world, as_profile):
    sign_in(as_profile, world, OTHER_TENANT)

    refused = client.post(API, json=NEW_REPAIR)

    assert (refused.status_code, refused.json()["detail"]) == (
        403, "You can only report repairs for a home you are renting.",
    )
    assert world.tables.get("complaints", []) == [] and world.tables.get("maintenance_work_orders", []) == []
    assert client.post(API, json={**NEW_REPAIR, "property_id": "not-a-listing"}).status_code == 404


@pytest.mark.parametrize("change", [
    {"category": "plumbing"}, {"category": "ROOFING"}, {"priority": "normal"}, {"title": " "}, {"title": "x" * 121},
    {"description": "Drip"}, {"description": "x" * 2001}, {"photos": [f"{TENANT}/{n}.png" for n in range(5)]},
])
def test_a_report_takes_what_the_shared_function_takes(client, world, as_profile, change):
    sign_in(as_profile, world, TENANT)

    assert client.post(API, json={**NEW_REPAIR, **change}).status_code == 422
    assert world.tables.get("complaints", []) == []


def test_a_photo_outside_the_reporters_folder_is_refused_by_the_function(client, world, as_profile):
    sign_in(as_profile, world, TENANT)

    refused = client.post(API, json={**NEW_REPAIR, "photos": [f"{OWNER}/kitchen.png"]})

    assert (refused.status_code, refused.json()["detail"]) == (
        422, "A photo could not be attached. Please add it again.",
    )
    assert world.tables.get("complaints", []) == []


def test_photos_are_stored_in_the_reporters_folder_and_shown_through_short_lived_links(client, world, as_profile):
    sign_in(as_profile, world, TENANT)

    uploaded = client.post(f"{API}/photos", files={"file": ("ceiling.png", io.BytesIO(PNG), "image/png")})

    assert uploaded.status_code == 201, uploaded.text
    path = uploaded.json()["path"]
    assert path.startswith(f"{TENANT}/") and ("repair-photos", path) in world.storage.objects
    created = client.post(API, json={**NEW_REPAIR, "photos": [path]}).json()
    assert case_of(world, work_order_of(world, created["id"])["complaint_id"])["metadata"]["mobile"]["photos"] == [path]
    [link] = created["photo_urls"]
    assert "/storage/v1/object/sign/repair-photos/" in link
    # The owner sees it too.
    sign_in(as_profile, world, OWNER)
    [owner_link] = client.get(f"{API}/{created['id']}").json()["photo_urls"]
    assert "/sign/repair-photos/" in owner_link
    # A provider uploads none.
    sign_in(as_profile, world, PLUMBER)
    assert client.post(f"{API}/photos", files={"file": ("x.png", io.BytesIO(PNG), "image/png")}).status_code == 403


def test_a_file_that_is_not_a_photo_is_not_stored(client, world, as_profile):
    sign_in(as_profile, world, TENANT)

    refused = client.post(f"{API}/photos", files={"file": ("lease.pdf", io.BytesIO(b"%PDF-1.7 ..."), "application/pdf")})

    assert refused.status_code == 415
    assert world.storage.objects == {}


def test_an_owner_logs_a_repair_for_a_home_with_a_tenant(client, world, as_profile):
    sign_in(as_profile, world, OWNER)

    response = client.post(API, json={**NEW_REPAIR, "priority": "medium", "category": "LEAK"})

    assert response.status_code == 201, response.text
    body = response.json()
    assert _caller(world, "mobile_owner_create_repair") == _auth_id(world, OWNER)
    order = work_order_of(world, body["id"])
    assert (order["tenant_user_id"], order["landlord_user_id"], order["status"]) == (TENANT, OWNER, "OPEN")
    assert (body["logged_by_owner"], body["priority"], body["category"], body["can_resolve"]) == (True, "medium", "LEAK", True)
    [notice] = world.tables["notifications"]
    assert (notice["user_id"], notice["title"]) == (TENANT, "Repair logged by your landlord")
    # A home without a tenant has no repairs, and another owner's never.
    for listing_id, owner in ((EMPTY_LISTING, OWNER), (LISTING, OTHER_OWNER)):
        sign_in(as_profile, world, owner)
        refused = client.post(API, json={**NEW_REPAIR, "property_id": listing_id})
        assert (refused.status_code, refused.json()["detail"]) == (
            403, "Repairs can only be logged for one of your homes with a current tenant.",
        )


def test_the_repair_homes_are_the_rented_ones(client, world, as_profile):
    sign_in(as_profile, world, TENANT)
    assert client.get(f"{API}/homes").json() == [{
        "listing_id": LISTING, "property_id": PROPERTY, "title": "Harbour flat",
        "address": "12 Harbour St, Wollongong, NSW, 2500", "owner_name": "Olivia Owner", "tenant_name": None,
    }]
    sign_in(as_profile, world, OWNER)
    [home] = client.get(f"{API}/homes").json()
    assert (home["listing_id"], home["tenant_name"], home["owner_name"]) == (LISTING, "Jane Tenant", None)
    for nobody in (OTHER_TENANT, OTHER_OWNER):
        sign_in(as_profile, world, nobody)
        assert client.get(f"{API}/homes").json() == []
    sign_in(as_profile, world, PLUMBER)
    assert client.get(f"{API}/homes").status_code == 403


# ---------------------------------------------------------------------------
# Who sees a repair
# ---------------------------------------------------------------------------
def test_each_party_sees_the_repair_and_no_one_else(client, world, as_profile):
    seed_repair(world, status="ASSIGNED", worker=PLUMBER)
    for person in (TENANT, OWNER, PLUMBER):
        sign_in(as_profile, world, person)
        assert [r["id"] for r in client.get(API).json()] == [REQUEST], person
        assert client.get(f"{API}/{REQUEST}").status_code == 200, person
    for person in (OTHER_TENANT, OTHER_OWNER, CLEANER):
        sign_in(as_profile, world, person)
        assert client.get(API).json() == [], person
        assert client.get(f"{API}/{REQUEST}").status_code == 403, person
    assert client.get(f"{API}/not-a-uuid").status_code == 404


@pytest.mark.parametrize("stored_status, shown", [
    ("OPEN", "open"), ("ASSIGNED", "in_progress"), ("SCHEDULED", "in_progress"),
    ("PENDING_TENANT_CONFIRMATION", "awaiting_confirmation"), ("RESOLVED", "resolved"),
])
def test_every_stored_status_reads_as_a_web_status(client, world, as_profile, stored_status, shown):
    seed_repair(world, status=stored_status)
    sign_in(as_profile, world, TENANT)

    assert client.get(f"{API}/{REQUEST}").json()["status"] == shown
    assert [r["id"] for r in client.get(API, params={"status": shown}).json()] == [REQUEST]


def test_a_mobile_repair_reads_its_report_from_the_complaint(client, world, as_profile):
    # The mobile app may leave the landlord off the work order; the complaint still names them.
    world.seed("complaints", [complaint(REPAIR, TENANT, description="Oven will not heat.\nTried the fuse box.",
                                        against_user_id=OWNER, category="appliance", severity="CRITICAL",
                                        metadata={"mobile": {"issueTitle": "", "photos": []}})])
    world.seed("maintenance_work_orders", [work_order(REQUEST, REPAIR, TENANT, listing_id=LISTING, status="OPEN")])
    sign_in(as_profile, world, TENANT)

    body = client.get(f"{API}/{REQUEST}").json()

    assert (body["title"], body["category"], body["category_label"], body["priority"]) == (
        "Oven will not heat.", "APPLIANCE", "Appliance", "urgent",
    )
    assert (body["owner_id"], body["owner_name"]) == (OWNER, "Olivia Owner")


# ---------------------------------------------------------------------------
# The owner: assigning a provider, resolving
# ---------------------------------------------------------------------------
def test_the_owner_picks_from_the_approved_providers_who_cover_the_category(client, world, as_profile):
    seed_repair(world)
    world.seed("users", [user("a6000000-0000-4000-8000-000000000007", "Pending Plumber", "SERVICE_PROVIDER")])
    world.seed("service_provider_profiles", [{"user_id": "a6000000-0000-4000-8000-000000000007",
                                              "service_categories": ["PLUMBING"], "updated_at": "2026-01-01T00:00:00+00:00"}])
    sign_in(as_profile, world, OWNER)

    providers = client.get(f"{API}/{REQUEST}/providers").json()

    assert providers == [{"id": PLUMBER, "name": "Pat's Plumbing", "service_area": "Wollongong",
                          "pricing_summary": "From $90"}]
    for person in (TENANT, OTHER_OWNER):
        sign_in(as_profile, world, person)
        assert client.get(f"{API}/{REQUEST}/providers").status_code == 403, person


def test_assigning_opens_the_thread_and_the_providers_job_request(client, world, as_profile):
    seed_repair(world)
    sign_in(as_profile, world, OWNER)

    response = client.post(f"{API}/{REQUEST}/assign", json={"provider_id": PLUMBER})

    assert response.status_code == 200, response.text
    assert _caller(world, "mobile_assign_repair") == _auth_id(world, OWNER)
    body = response.json()
    assert (body["status"], body["provider_id"], body["provider_name"]) == ("in_progress", PLUMBER, "Pat's Plumbing")
    order = work_order_of(world)
    assert (order["status"], order["assigned_worker_id"], order["appointment_at"]) == ("ASSIGNED", PLUMBER, None)
    assert case_of(world)["status"] == "IN_REVIEW"
    [thread] = world.tables["conversations"]
    assert (order["conversation_id"], thread["metadata"]) == (thread["id"], {"maintenanceComplaintId": REPAIR})
    assert {(p["user_id"], p["role_label"]) for p in world.tables["conversation_participants"]} == {
        (TENANT, "Tenant"), (PLUMBER, "Maintenance worker"),
    }
    [job] = world.tables["mobile_ai_service_jobs"]
    assert (job["owner_id"], job["provider_id"], job["listing_id"], job["request"]) == (
        OWNER, PLUMBER, LISTING, {"complaintId": REPAIR, "source": "maintenance"},
    )
    assert job["payload"]["status"] == "pending"
    [event] = events(world, REPAIR)
    assert (event["event_type"], event["note"], event["actor_user_id"]) == ("ASSIGNED", "Assigned to Pat's Plumbing", OWNER)
    assert {notice["user_id"] for notice in world.tables["notifications"]} == {TENANT, PLUMBER}
    # The provider has it on their repairs page.
    sign_in(as_profile, world, PLUMBER)
    assert [repair["id"] for repair in client.get("/api/v1/me/repairs").json()] == [REQUEST]


def test_a_provider_who_does_not_cover_the_category_is_refused_by_the_function(client, world, as_profile):
    seed_repair(world)
    sign_in(as_profile, world, OWNER)

    refused = client.post(f"{API}/{REQUEST}/assign", json={"provider_id": CLEANER})

    assert (refused.status_code, refused.json()["detail"]) == (
        403, "Approved worker qualified for this maintenance category required",
    )
    assert (work_order_of(world)["status"], work_order_of(world)["assigned_worker_id"]) == ("OPEN", None)
    assert world.tables.get("mobile_ai_service_jobs", []) == []
    # A GENERAL repair is the cleaner's to take.
    world.tables["complaints"][0]["category"] = "GENERAL"
    assert client.post(f"{API}/{REQUEST}/assign", json={"provider_id": CLEANER}).status_code == 200


@pytest.mark.parametrize("stored_status", ["SCHEDULED", "PENDING_TENANT_CONFIRMATION", "RESOLVED"])
def test_a_repair_past_its_assignment_is_not_reassigned(client, world, as_profile, stored_status):
    seed_repair(world, status=stored_status, worker=PLUMBER)
    sign_in(as_profile, world, OWNER)

    refused = client.post(f"{API}/{REQUEST}/assign", json={"provider_id": CLEANER})

    assert refused.status_code == 409
    assert work_order_of(world)["assigned_worker_id"] == PLUMBER


def test_an_agent_owner_follows_the_repairs_but_takes_no_owner_step(client, world, as_profile):
    from app.services.maintenance import LANDLORD_STEPS_ONLY
    from tests.factories_provider_core import jwt_for

    seed_repair(world)
    # An agent who owns the home signs in as a landlord on the web; the functions take a LANDLORD account only.
    next(row for row in world.tables["users"] if row["id"] == OWNER)["primary_role"] = "AGENT"
    as_profile(id=OWNER, role="landlord", full_name="Olivia Owner", access_token=jwt_for(world, OWNER))
    calls = len(world.rpc_calls)

    [listed] = client.get(API).json()
    assert (listed["id"], listed["can_assign"], listed["can_resolve"]) == (REQUEST, False, False)
    assert client.get(f"{API}/homes").json() == []
    for method, path, body in (
        ("post", API, NEW_REPAIR), ("get", f"{API}/{REQUEST}/providers", None),
        ("post", f"{API}/{REQUEST}/assign", {"provider_id": PLUMBER}), ("post", f"{API}/{REQUEST}/resolve", {}),
        ("patch", f"{API}/{REQUEST}/status", {"status": "resolved"}),
    ):
        response = client.request(method, path, json=body)
        assert (response.status_code, response.json()["detail"]) == (403, LANDLORD_STEPS_ONLY), path
    assert world.rpc_calls[calls:] == []
    assert work_order_of(world)["status"] == "OPEN"


def test_only_the_owner_assigns(client, world, as_profile):
    seed_repair(world)
    sign_in(as_profile, world, OTHER_OWNER)
    assert client.post(f"{API}/{REQUEST}/assign", json={"provider_id": PLUMBER}).status_code == 403
    sign_in(as_profile, world, TENANT)
    assert client.post(f"{API}/{REQUEST}/assign", json={"provider_id": PLUMBER}).status_code == 403
    sign_in(as_profile, world, OWNER)
    assert client.post(f"{API}/{REQUEST}/assign", json={"provider_id": "nobody"}).status_code == 404
    assert work_order_of(world)["assigned_worker_id"] is None


def test_the_owner_resolves_a_repair_and_the_tenant_rates_it(client, world, as_profile):
    seed_repair(world, status="ASSIGNED", worker=PLUMBER)
    sign_in(as_profile, world, OWNER)

    resolved = client.post(f"{API}/{REQUEST}/resolve", json={"note": "Fixed by my own plumber."})

    assert resolved.status_code == 200, resolved.text
    assert _caller(world, "mobile_resolve_repair") == _auth_id(world, OWNER)
    order = work_order_of(world)
    assert (order["status"], order["completion_note"]) == ("RESOLVED", "Fixed by my own plumber.")
    assert (case_of(world)["status"], resolved.json()["status"], resolved.json()["can_resolve"]) == (
        "RESOLVED", "resolved", False,
    )
    assert events(world, REPAIR)[-1]["event_type"] == "RESOLVED_BY_OWNER"

    sign_in(as_profile, world, TENANT)
    assert client.get(f"{API}/{REQUEST}").json()["can_rate"] is True
    rated = client.post(f"{API}/{REQUEST}/rate", json={"rating": 4})
    assert rated.status_code == 200, rated.text
    assert (work_order_of(world)["tenant_rating"], rated.json()["tenant_rating"], rated.json()["can_rate"]) == (4, 4, False)
    again = client.post(f"{API}/{REQUEST}/rate", json={"rating": 5})
    assert (again.status_code, again.json()["detail"]) == (422, "This work order has already been rated")
    assert client.post(f"{API}/{REQUEST}/rate", json={"rating": 6}).status_code == 422


def test_only_the_owner_resolves(client, world, as_profile):
    seed_repair(world, status="SCHEDULED", worker=PLUMBER, appointment_at="2030-01-16T22:30:00+00:00")
    for person in (TENANT, PLUMBER, OTHER_OWNER):
        sign_in(as_profile, world, person)
        assert client.post(f"{API}/{REQUEST}/resolve", json={}).status_code == 403, person
    assert work_order_of(world)["status"] == "SCHEDULED"


# ---------------------------------------------------------------------------
# The tenant: confirming the work
# ---------------------------------------------------------------------------
def test_the_tenant_confirms_the_finished_work_with_a_rating(client, world, as_profile):
    seed_repair(world, status="PENDING_TENANT_CONFIRMATION", worker=PLUMBER, completion_note="Pipe replaced.")
    sign_in(as_profile, world, TENANT)
    assert client.get(f"{API}/{REQUEST}").json()["can_confirm"] is True

    confirmed = client.post(f"{API}/{REQUEST}/confirm", json={"rating": 5})

    assert confirmed.status_code == 200, confirmed.text
    assert _caller(world, "mobile_confirm_repair") == _auth_id(world, TENANT)
    order = work_order_of(world)
    assert (order["status"], order["tenant_rating"]) == ("RESOLVED", 5)
    assert (case_of(world)["status"], confirmed.json()["status"]) == ("RESOLVED", "resolved")
    assert events(world, REPAIR)[-1]["note"] == "Tenant confirmed the repair (5/5)"
    assert {notice["user_id"] for notice in world.tables["notifications"]} == {PLUMBER, OWNER}


def test_only_finished_work_is_confirmed_and_only_by_its_tenant(client, world, as_profile):
    seed_repair(world, status="SCHEDULED", worker=PLUMBER, appointment_at="2030-01-16T22:30:00+00:00")
    sign_in(as_profile, world, TENANT)

    early = client.post(f"{API}/{REQUEST}/confirm", json={"rating": 5})

    assert (early.status_code, early.json()["detail"]) == (422, "Work order is not awaiting tenant confirmation")
    work_order_of(world)["status"] = "PENDING_TENANT_CONFIRMATION"
    sign_in(as_profile, world, OTHER_TENANT)
    assert client.post(f"{API}/{REQUEST}/confirm", json={"rating": 5}).status_code == 403
    sign_in(as_profile, world, OWNER)
    assert client.post(f"{API}/{REQUEST}/confirm", json={"rating": 5}).status_code == 403
    assert work_order_of(world)["status"] == "PENDING_TENANT_CONFIRMATION"


# ---------------------------------------------------------------------------
# The older status route
# ---------------------------------------------------------------------------
def test_the_status_route_resolves_for_the_owner_only(client, world, as_profile):
    seed_repair(world, status="ASSIGNED", worker=PLUMBER)
    sign_in(as_profile, world, OWNER)
    for change in ({"status": "in_progress"}, {"status": "open"}, {"status": "cancelled"}):
        assert client.patch(f"{API}/{REQUEST}/status", json=change).status_code == 422, change
    sign_in(as_profile, world, TENANT)
    tenant = client.patch(f"{API}/{REQUEST}/status", json={"status": "resolved"})
    assert (tenant.status_code, tenant.json()["detail"]) == (
        403, "Confirm the repair with a rating once the provider has marked it done.",
    )
    sign_in(as_profile, world, PLUMBER)
    assert client.patch(f"{API}/{REQUEST}/status", json={"status": "resolved"}).status_code == 403
    assert work_order_of(world)["status"] == "ASSIGNED"

    sign_in(as_profile, world, OWNER)
    resolved = client.patch(f"{API}/{REQUEST}/status", json={"status": "resolved", "resolution_note": "Done."})
    assert resolved.status_code == 200, resolved.text
    assert (work_order_of(world)["status"], work_order_of(world)["completion_note"]) == ("RESOLVED", "Done.")


@pytest.mark.parametrize("account_status", ["ACTIVE", "SUSPENDED"])
def test_an_admin_neither_reads_nor_moves_a_repair_through_the_parties_routes(client, world, as_profile, account_status):
    admin = "a6000000-0000-4000-8000-000000000009"
    world.seed("users", [user(admin, "Ada Admin", "ADMIN", status=account_status)])
    seed_repair(world, status="ASSIGNED", worker=PLUMBER)
    as_profile(id=admin, role="admin", raw={"id": admin, "status": account_status})

    read = client.get(f"{API}/{REQUEST}")
    changed = client.patch(f"{API}/{REQUEST}/status", json={"status": "resolved"})

    assert (read.status_code, changed.status_code) == (403, 403)
    assert changed.json()["detail"] == "A repair is moved by its tenant, owner and assigned provider, not from an admin account."
    assert work_order_of(world)["status"] == "ASSIGNED"
    assert world.tables.get("notifications", []) == []


# ---------------------------------------------------------------------------
# Editing a report, and the statuses written
# ---------------------------------------------------------------------------
def test_tenant_edits_change_the_report_and_keep_the_mobile_keys(client, world, as_profile):
    seed_repair(world)
    case_of(world)["metadata"]["mobile"]["photos"] = [f"{TENANT}/ceiling.png"]
    sign_in(as_profile, world, TENANT)

    response = client.patch(f"{API}/{REQUEST}", json={
        "title": "Leaking pipe", "description": "Slow drip under the sink now.", "priority": "low", "category": "LEAK",
    })

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["title"], body["priority"], body["category"]) == ("Leaking pipe", "low", "LEAK")
    edited = case_of(world)
    assert (edited["description"], edited["severity"], edited["category"]) == ("Slow drip under the sink now.", "LOW", "LEAK")
    assert edited["metadata"]["mobile"] == {"issueTitle": "Leaking pipe", "photos": [f"{TENANT}/ceiling.png"],
                                            "createdBy": TENANT}
    [event] = events(world, REPAIR)
    assert (event["event_type"], event["metadata"]["fields"]) == ("UPDATED", ["category", "description", "priority", "title"])


def test_a_tenant_cannot_edit_a_repair_their_owner_logged(client, world, as_profile):
    sign_in(as_profile, world, OWNER)
    logged = client.post(API, json={**NEW_REPAIR, "category": "SAFETY", "title": "Replace the hallway smoke alarm"})
    assert logged.status_code == 201, logged.text
    complaint_id = work_order_of(world, logged.json()["id"])["complaint_id"]
    before = dict(case_of(world, complaint_id))
    sign_in(as_profile, world, TENANT)

    response = client.patch(f"{API}/{logged.json()['id']}", json={
        "title": "Nothing wrong", "description": "Nothing to see here.", "priority": "low", "category": "GENERAL",
    })

    assert (response.status_code, response.json()["detail"]) == (
        403, "Only the person who reported this repair can edit it")
    assert case_of(world, complaint_id) == before


def test_tenant_cannot_edit_once_work_has_started(client, world, as_profile):
    seed_repair(world, status="ASSIGNED", worker=PLUMBER)
    sign_in(as_profile, world, TENANT)

    assert client.patch(f"{API}/{REQUEST}", json={"title": "Actually fine now"}).status_code == 400
    assert case_of(world)["metadata"]["mobile"]["issueTitle"] == "Burst pipe"


def test_a_repair_from_report_to_confirmation_writes_only_the_shared_statuses(client, world, as_profile):
    sign_in(as_profile, world, TENANT)
    request_id = client.post(API, json=NEW_REPAIR).json()["id"]
    seen = [_statuses(world)]
    sign_in(as_profile, world, OWNER)
    assert client.post(f"{API}/{request_id}/assign", json={"provider_id": PLUMBER}).status_code == 200
    seen.append(_statuses(world))
    sign_in(as_profile, world, PLUMBER)
    assert client.post(f"/api/v1/me/repairs/{request_id}/schedule", json={
        "date": "2099-01-20", "time": "09:30", "duration_minutes": 60,
    }).status_code == 200
    seen.append(_statuses(world))
    work_order_of(world, request_id)["appointment_at"] = "2020-01-01T00:00:00+00:00"  # the visit has started
    assert client.post(f"/api/v1/me/repairs/{request_id}/complete", json={"note": "Pipe replaced."}).status_code == 200
    seen.append(_statuses(world))
    sign_in(as_profile, world, TENANT)
    assert client.post(f"{API}/{request_id}/confirm", json={"rating": 4}).status_code == 200
    seen.append(_statuses(world))

    assert seen == [{"OPEN"}, {"ASSIGNED"}, {"SCHEDULED"}, {"PENDING_TENANT_CONFIRMATION"}, {"RESOLVED"}]
    assert set().union(*seen) == WORK_ORDER_STATUSES
    assert APPLICATION in {row["id"] for row in world.tables["rental_applications"]}
    # The tenant's dashboard stops counting it once it is resolved.
    assert client.get("/api/v1/me/dashboard/tenant").json()["open_maintenance"] == 0
