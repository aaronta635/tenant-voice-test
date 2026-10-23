"""Repairs in the admin console (tracker R40): the list and an admin's decision to cancel or close one.

The parties' repair routes refuse an admin (maintenance.set_status), so the
console is the only way an admin moves a repair. A decision needs a reason;
it writes the case (CLOSED or RESOLVED) and the work order (RESOLVED, as its
CHECK allows) only while the work order still has the status the admin saw,
adds the step to the case timeline (complaint_events), records the decision
in both audit logs and tells the tenant, the owner and the assigned provider
why. Every other role is refused by direct request, and a refused request
changes nothing.
"""

import re
from pathlib import Path

import pytest

from app.services import admin_repairs
from app.services.maps_reviews_complaints import REPAIR_TO_COMPLAINT_STATUS
from tests.factories_admin import bearer, lands_first, named_trail, shared_trail
from tests.factories_identity import users_row
from tests.factories_reviews_complaints import complaint, events, seed_rental, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a9000000-0000-4000-8000-000000000001"
CALLER = "a9000000-0000-4000-8000-000000000002"
TENANT = "b9000000-0000-4000-8000-000000000001"
OWNER = "b9000000-0000-4000-8000-000000000002"
PROVIDER = "b9000000-0000-4000-8000-000000000003"
PROPERTY = "c9000000-0000-4000-8000-000000000001"
LISTING = "c9000000-0000-4000-8000-000000000002"
# The cases, and their work orders: open, booked by the provider, done.
PIPE_CASE, HEATER_CASE, TILE_CASE, COMPLAINT_ONLY = (f"d9000000-0000-4000-8000-00000000000{n}" for n in range(1, 5))
PIPE, HEATER, TILE = (f"e9000000-0000-4000-8000-00000000000{n}" for n in range(1, 4))
VISIT = "2026-03-10T23:00:00+00:00"

API = "/api/v1"
REPAIRS = f"{API}/admin/repairs"


def month(number: int) -> str:
    return f"2026-0{number}-01T00:00:00+00:00"


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(TENANT, "tia@example.test", full_name="Tia Nguyen"),
        users_row(OWNER, "oliver@example.test", "LANDLORD", full_name="Oliver Grant"),
        users_row(PROVIDER, "pat@example.test", "SERVICE_PROVIDER", full_name="Pat Plumber"),
    ])
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING, title="Harbour flat")
    strict_schema.seed("complaints", [
        complaint(PIPE_CASE, TENANT, "Water everywhere under the sink.", against_user_id=OWNER, property_id=PROPERTY,
                  severity="HIGH", metadata={"subject": "Burst pipe"}),
        complaint(HEATER_CASE, TENANT, "The heater stopped working.", against_user_id=OWNER, property_id=PROPERTY,
                  metadata={"subject": "Broken heater"}),
        complaint(TILE_CASE, TENANT, "A bathroom tile came loose.", against_user_id=OWNER, property_id=PROPERTY,
                  severity="LOW", status="RESOLVED", resolved_at=month(4), metadata={"subject": "Loose tile"}),
        # Not a repair: it has no work order.
        complaint(COMPLAINT_ONLY, TENANT, "The owner keeps calling late.", against_user_id=OWNER),
    ])
    strict_schema.seed("maintenance_work_orders", [
        work_order(PIPE, PIPE_CASE, TENANT, listing_id=LISTING, landlord_user_id=OWNER, created_at=month(1)),
        work_order(HEATER, HEATER_CASE, TENANT, listing_id=LISTING, landlord_user_id=OWNER, assigned_worker_id=PROVIDER,
                   status="SCHEDULED", appointment_at=VISIT, created_at=month(2)),
        # A finished repair is RESOLVED (maintenance_work_orders_status_check).
        work_order(TILE, TILE_CASE, TENANT, listing_id=LISTING, landlord_user_id=OWNER, status="RESOLVED",
                   completed_at=month(4), completion_note="Tile glued back.", created_at=month(3)),
    ])
    return strict_schema


@pytest.fixture
def admin(db):
    return bearer(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")


def stored(db, table, row_id):
    return next(row for row in db.tables[table] if row["id"] == row_id)


def notices(db) -> list[tuple]:
    return [(n["user_id"], n["title"], n["body"], n["link"]) for n in db.tables.get("notifications", [])]


def listed(client, admin, **params) -> list[str]:
    response = client.get(REPAIRS, params=params, headers=admin)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def assert_unchanged(db):
    assert [row["status"] for row in db.tables["maintenance_work_orders"]] == ["OPEN", "SCHEDULED", "RESOLVED"]
    assert [row["status"] for row in db.tables["complaints"]] == ["OPEN", "OPEN", "RESOLVED", "OPEN"]
    assert not db.tables.get("complaint_events") and not db.tables.get("notifications")
    assert not shared_trail(db) and not named_trail(db)


# ---------------------------------------------------------------------------
# Who may
# ---------------------------------------------------------------------------
ENDPOINTS = [
    ("get", REPAIRS, None),
    ("post", f"{REPAIRS}/{PIPE}/decision", {"action": "cancel", "reason": "Testing access"}),
]


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "REGULATOR"])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_every_other_role_is_refused(client, db, primary_role, method, path, body):
    caller = bearer(db, CALLER, "caller@example.test", primary_role)

    response = getattr(client, method)(path, headers=caller, **({"json": body} if body else {}))

    assert response.status_code == 403
    assert response.json()["detail"] == "This area is for TenantVoice administrators."
    assert_unchanged(db)


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_a_suspended_admin_and_a_visitor_are_refused(client, db, method, path, body):
    away = bearer(db, CALLER, "sue@example.test", "ADMIN", status="SUSPENDED")
    kwargs = {"json": body} if body else {}

    assert getattr(client, method)(path, **kwargs).status_code == 401
    assert getattr(client, method)(path, headers=away, **kwargs).status_code == 403
    assert_unchanged(db)


def test_an_admin_still_moves_no_repair_through_the_parties_route(client, db, admin):
    response = client.patch(f"{API}/maintenance/{PIPE}/status", json={"status": "cancelled"}, headers=admin)

    assert response.status_code == 403
    assert_unchanged(db)


# ---------------------------------------------------------------------------
# The list
# ---------------------------------------------------------------------------
def test_the_list_shows_every_repair_newest_first_with_its_parties(client, db, admin):
    page = client.get(REPAIRS, headers=admin).json()

    assert ([item["id"] for item in page["items"]], page["total"]) == ([TILE, HEATER, PIPE], 3)
    tile, heater, pipe = page["items"]
    assert (pipe["title"], pipe["priority"], pipe["status"], pipe["work_status"], pipe["actions"]) == (
        "Burst pipe", "urgent", "open", "OPEN", ["cancel", "close"])
    assert (pipe["property_title"], pipe["area"], pipe["provider"]) == ("Harbour flat", "Wollongong, NSW", None)
    assert pipe["tenant"] == {"id": TENANT, "full_name": "Tia Nguyen", "role": "tenant"}
    assert pipe["owner"] == {"id": OWNER, "full_name": "Oliver Grant", "role": "landlord"}
    assert (heater["status"], heater["work_status"], heater["priority"]) == ("in_progress", "SCHEDULED", "normal")
    assert heater["provider"] == {"id": PROVIDER, "full_name": "Pat Plumber", "role": "service_provider"}
    assert heater["appointment_at"].startswith("2026-03-10T23:00:00")
    assert (tile["status"], tile["actions"], tile["resolution_note"]) == ("resolved", [], "Tile glued back.")
    assert all(item["last_decision"] is None for item in page["items"])


def test_the_list_filters_by_status_priority_and_words_and_pages(client, db, admin):
    assert listed(client, admin, status="open") == [PIPE]
    assert listed(client, admin, status="in_progress") == [HEATER]
    assert listed(client, admin, status="resolved") == [TILE]
    assert listed(client, admin, status="cancelled") == []
    assert listed(client, admin, priority="urgent") == [PIPE]
    assert listed(client, admin, priority="low") == [TILE]
    assert listed(client, admin, q="HEATER") == [HEATER]
    assert listed(client, admin, q="under the sink") == [PIPE]
    page = client.get(REPAIRS, params={"limit": 1, "offset": 1}, headers=admin).json()
    assert ([item["id"] for item in page["items"]], page["total"]) == ([HEATER], 3)
    assert client.get(REPAIRS, params={"status": "OPEN"}, headers=admin).status_code == 422
    assert client.get(REPAIRS, params={"priority": "high"}, headers=admin).status_code == 422


def test_without_repairs_the_list_is_empty(client, strict_schema):
    admin = bearer(strict_schema, ADMIN, "ada@example.test", "ADMIN")

    assert client.get(REPAIRS, headers=admin).json() == {"items": [], "total": 0, "limit": 20, "offset": 0}


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------
def test_cancelling_a_repair_closes_its_case_and_tells_the_tenant_owner_and_provider(client, db, admin):
    response = client.post(f"{REPAIRS}/{HEATER}/decision", json={
        "action": "cancel", "reason": "  The tenant moved out before the visit. ", "expected_status": "SCHEDULED",
    }, headers=admin)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["work_status"], body["actions"], body["resolution_note"]) == (
        "resolved", "RESOLVED", [], "The tenant moved out before the visit.")
    assert (body["last_decision"]["decision"], body["last_decision"]["actor"]["full_name"]) == ("cancelled", "Ada Admin")
    order = stored(db, "maintenance_work_orders", HEATER)
    assert (order["status"], order["completion_note"], bool(order["completed_at"])) == (
        "RESOLVED", "The tenant moved out before the visit.", True)
    case = stored(db, "complaints", HEATER_CASE)
    assert (case["status"], bool(case["resolved_at"]), case["metadata"]) == ("CLOSED", True, {"subject": "Broken heater"})
    [step] = events(db, HEATER_CASE)
    assert (step["actor_user_id"], step["event_type"], step["note"]) == (
        ADMIN, "STATUS_CHANGED", "The tenant moved out before the visit.")
    assert step["metadata"] == {"source": "web", "work_order_id": HEATER, "from_status": "in_progress",
                                "to_status": "cancelled", "decision": "cancelled"}
    [entry] = shared_trail(db, "repair.status_changed")
    assert (entry["actor_user_id"], entry["entity_type"], entry["entity_id"]) == (ADMIN, "repair", HEATER)
    assert entry["summary"] == "Cancelled the repair “Broken heater”: The tenant moved out before the visit."
    assert entry["metadata"] == {
        "source": "web", "decision": "cancelled", "from_status": "in_progress", "to_status": "cancelled",
        "reason": "The tenant moved out before the visit.", "complaint_id": HEATER_CASE, "tenant_id": TENANT,
        "owner_id": OWNER, "provider_id": PROVIDER,
    }
    assert [(row["actor_id"], row["action"], row["entity_id"]) for row in named_trail(db)] == [
        (ADMIN, "repair.status_changed", HEATER)]
    body = "A TenantVoice admin cancelled it. Reason: The tenant moved out before the visit."
    assert notices(db) == [
        (TENANT, "Repair cancelled: Broken heater", body, "/tenant/maintenance"),
        (OWNER, "Repair cancelled: Broken heater", body, "/owner/maintenance"),
        (PROVIDER, "Repair cancelled: Broken heater", body, "/dashboard/repairs"),
    ]


def test_closing_a_repair_marks_it_done_for_the_parties(client, db, admin):
    response = client.post(f"{REPAIRS}/{PIPE}/decision", json={
        "action": "close", "reason": "The owner's plumber fixed it outside TenantVoice.", "expected_status": "OPEN",
    }, headers=admin)

    assert response.status_code == 200, response.text
    assert (stored(db, "maintenance_work_orders", PIPE)["status"], stored(db, "complaints", PIPE_CASE)["status"]) == (
        "RESOLVED", "RESOLVED")
    assert [entry["metadata"]["decision"] for entry in shared_trail(db)] == ["closed"]
    # Nobody is assigned, so the tenant and the owner are told.
    assert [(user_id, title) for user_id, title, _body, _link in notices(db)] == [
        (TENANT, "Repair closed: Burst pipe"), (OWNER, "Repair closed: Burst pipe")]
    # The tenant's own page reads the repair as done, with the reason.
    mine = client.get(f"{API}/maintenance", headers=bearer_for(db, TENANT)).json()
    pipe = next(item for item in mine if item["id"] == PIPE)
    assert (pipe["status"], pipe["resolution_note"]) == ("resolved", "The owner's plumber fixed it outside TenantVoice.")


def bearer_for(db, user_id) -> dict:
    """Headers for a users row the fixture seeded, given a sign-in of its own."""
    token = db.add_auth_user(f"{user_id[:8]}-signin@example.test")
    stored(db, "users", user_id)["auth_user_id"] = db.tokens[token]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("body, message", [
    ({"action": "cancel", "reason": "   "}, "Give a reason. It is kept with the decision."),
    ({"action": "cancel"}, "Give a reason. It is kept with the decision."),
    ({"action": "delete", "reason": "Spam"}, None),
])
def test_a_decision_needs_a_reason_and_a_known_action(client, db, admin, body, message):
    response = client.post(f"{REPAIRS}/{PIPE}/decision", json=body, headers=admin)

    assert response.status_code == 422
    if message:
        assert response.json()["detail"][0]["msg"] == message
    assert_unchanged(db)


def test_a_finished_repair_is_not_decided_again(client, db, admin):
    response = client.post(f"{REPAIRS}/{TILE}/decision", json={"action": "cancel", "reason": "Duplicate"}, headers=admin)

    assert (response.status_code, response.json()["detail"]) == (409, "This repair is closed already.")
    assert_unchanged(db)


@pytest.mark.parametrize("repair_id", ["e9000000-0000-4000-8000-000000000099", "not-a-repair", PIPE_CASE])
def test_an_unknown_repair_is_not_found(client, db, admin, repair_id):
    response = client.post(f"{REPAIRS}/{repair_id}/decision", json={"action": "cancel", "reason": "Gone"}, headers=admin)

    assert response.status_code == 404
    assert_unchanged(db)


def test_a_repair_that_moved_since_the_admin_saw_it_writes_nothing(client, db, admin):
    response = client.post(f"{REPAIRS}/{HEATER}/decision", json={
        "action": "close", "reason": "Done", "expected_status": "ASSIGNED",
    }, headers=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "This repair changed while you were looking at it. Reload the list and try again."
    assert_unchanged(db)


def test_a_case_the_tenant_withdrew_meanwhile_is_left_as_they_left_it(client, db, admin, monkeypatch):
    def withdrawn():
        stored(db, "maintenance_work_orders", PIPE).update(status="RESOLVED", completed_at=month(5))
        stored(db, "complaints", PIPE_CASE).update(status="CLOSED", resolved_at=month(5))

    lands_first(monkeypatch, admin_repairs, withdrawn)

    response = client.post(f"{REPAIRS}/{PIPE}/decision", json={"action": "close", "reason": "Fixed"}, headers=admin)

    assert response.status_code == 409
    assert stored(db, "complaints", PIPE_CASE)["resolved_at"] == month(5)
    assert stored(db, "maintenance_work_orders", PIPE)["completion_note"] is None
    assert not db.tables.get("complaint_events") and not shared_trail(db) and not db.tables.get("notifications")


def test_a_visit_booked_meanwhile_keeps_the_repair_and_reopens_its_case(client, db, admin, monkeypatch):
    # The provider books the visit between the admin's read and the work order's write.
    lands_first(monkeypatch, admin_repairs, lambda: stored(db, "maintenance_work_orders", HEATER).update(
        status="IN_PROGRESS"))

    response = client.post(f"{REPAIRS}/{HEATER}/decision", json={"action": "cancel", "reason": "Moved out"},
                           headers=admin)

    assert response.status_code == 409
    assert stored(db, "maintenance_work_orders", HEATER)["status"] == "IN_PROGRESS"
    case = stored(db, "complaints", HEATER_CASE)
    assert (case["status"], case["resolved_at"]) == ("OPEN", None)
    assert not db.tables.get("complaint_events") and not shared_trail(db) and not db.tables.get("notifications")


def test_the_list_shows_the_last_decision_and_the_activity_log_finds_it(client, db, admin):
    client.post(f"{REPAIRS}/{PIPE}/decision", json={"action": "cancel", "reason": "Reported twice."}, headers=admin)

    pipe = next(item for item in client.get(REPAIRS, headers=admin).json()["items"] if item["id"] == PIPE)
    assert (pipe["last_decision"]["decision"], pipe["last_decision"]["reason"]) == ("cancelled", "Reported twice.")
    activity = client.get(f"{API}/admin/activity", params={"entity_type": "repair"}, headers=admin).json()
    assert [entry["action"] for entry in activity["items"]] == ["repair.status_changed"]


def test_the_contract_doc_names_the_statuses_a_decision_writes():
    # maintenance_work_orders_status_check allows OPEN, ASSIGNED, SCHEDULED, PENDING_TENANT_CONFIRMATION and
    # RESOLVED only, so docs/shared-db.md must not send anyone writing CANCELLED or COMPLETED.
    doc = " ".join((Path(__file__).resolve().parents[2] / "docs" / "shared-db.md").read_text(encoding="utf-8").split())
    decisions = re.search(r"\*\*Repairs in the console\.\*\*(.+?)### ", doc).group(1)

    assert "`CANCELLED`" not in decisions and "`COMPLETED`" not in decisions
    assert f"Both decisions write the work order `{admin_repairs.CLOSED_WORK_STATUS}`" in decisions
    cancel, close = (REPAIR_TO_COMPLAINT_STATUS[admin_repairs.DECISIONS[action][0]] for action in ("cancel", "close"))
    assert f"the case `{cancel}` for a cancel or `{close}` for a close" in decisions
