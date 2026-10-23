"""Red flags (tracker R39): the database raises them, admins manage the rules and decide the flags.

Complaints are lodged through the API, so create_general_complaint's
stand-in runs the complaints trigger (evaluate_complaint_red_flags) as the
database does: the web itself never evaluates a new complaint. The cases the
tracker asks for: one complaint short of the threshold, the exact threshold,
complaints outside the window, a disabled rule, repeated evaluation and no
second active flag, non-admin calls refused, and the evidence kept after a
flag is resolved.
"""

import pytest

from app.services import complaints as complaints_service
from app.services import red_flags
from tests.factories_admin import bearer, named_trail, shared_trail
from tests.factories_identity import account
from tests.factories_reviews_complaints import application, complaint, seed_rental

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "aa000000-0000-4000-8000-000000000001"
OTHER_ADMIN = "aa000000-0000-4000-8000-000000000002"
TENANT = "ba000000-0000-4000-8000-000000000001"
OWNER = "ba000000-0000-4000-8000-000000000002"
CALLER = "ba000000-0000-4000-8000-000000000003"
PROPERTY = "ca000000-0000-4000-8000-000000000001"
LISTING = "ca000000-0000-4000-8000-000000000002"
OTHER_PROPERTY = "ca000000-0000-4000-8000-000000000003"
OTHER_LISTING = "ca000000-0000-4000-8000-000000000004"
WINDOW_RULE = "da000000-0000-4000-8000-000000000001"
TOTAL_RULE = "da000000-0000-4000-8000-000000000002"
API = "/api/v1"
RULES = f"{API}/admin/red-flags/rules"
FLAGS = f"{API}/admin/red-flags/events"
# The fake database's clock starts on 1 January 2026 (StrictSchema.now).
LONG_AGO = "2025-11-01T00:00:00+00:00"
NOW = "2026-01-01T00:00:00+00:00"


def uid(number: int) -> str:
    return f"ea000000-0000-4000-8000-{number:012d}"


def rule(id, rule_key, name, **over) -> dict:
    """A red_flag_rules row with the column defaults: 3 complaints within 30 days, HIGH, active."""
    return {"id": id, "rule_key": rule_key, "name": name, "threshold_count": 3, "window_days": 30,
            "trigger_mode": "WINDOW", "severity": "HIGH", "is_active": True, "updated_at": NOW, **over}


@pytest.fixture(autouse=True)
def database_clock(strict_schema, monkeypatch):
    """The web's now() is the fake database's: lodged_at and evaluated_at follow one clock."""
    monkeypatch.setattr(complaints_service, "_now", strict_schema.strict.now)
    monkeypatch.setattr(red_flags, "_now", strict_schema.strict.now)


@pytest.fixture
def people(client, strict_schema):
    headers = {
        "admin": bearer(strict_schema, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin"),
        "other_admin": bearer(strict_schema, OTHER_ADMIN, "otto@example.test", "ADMIN", full_name="Otto Admin"),
        "tenant": bearer(strict_schema, TENANT, "tia@example.test", full_name="Tia Nguyen"),
    }
    strict_schema.seed("users", [{"id": OWNER, "email": "oliver@example.test", "full_name": "Oliver Grant",
                                  "primary_role": "LANDLORD", "status": "ACTIVE", "updated_at": NOW}])
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING, title="Harbour flat")
    seed_rental(strict_schema, OWNER, OTHER_PROPERTY, OTHER_LISTING, title="Hill house")
    strict_schema.seed("rental_applications", [application(uid(90), LISTING, TENANT),
                                               application(uid(91), OTHER_LISTING, TENANT)])
    return headers


@pytest.fixture
def window_rule(strict_schema, people):
    strict_schema.seed("red_flag_rules", [rule(WINDOW_RULE, "repeat_complaints", "Repeat complaints")])
    return strict_schema


def lodge(client, people, listing=LISTING, number=1) -> str:
    response = client.post(f"{API}/complaints", json={
        "subject": f"Complaint {number}", "description": f"The hot water failed again, time {number}.",
        "category": "PROPERTY_CONDITION", "property_id": listing,
    }, headers=people["tenant"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


def flags(db) -> list[dict]:
    return db.tables.get("red_flag_events", [])


def admin_notices(db) -> list[tuple]:
    return [(n["user_id"], n["title"], n["body"], n["link"]) for n in db.tables.get("notifications", [])
            if n["link"] == "/admin/red-flags"]


# ---------------------------------------------------------------------------
# What the database raises
# ---------------------------------------------------------------------------
def test_one_complaint_short_of_the_threshold_raises_nothing(client, window_rule, people):
    lodge(client, people, number=1)
    lodge(client, people, number=2)

    assert flags(window_rule) == [] and admin_notices(window_rule) == []


def test_the_complaint_that_reaches_the_threshold_raises_one_flag_and_tells_every_admin(client, window_rule, people):
    for number in (1, 2):
        lodge(client, people, number=number)
    third = lodge(client, people, number=3)

    [flag] = flags(window_rule)
    assert (flag["rule_id"], flag["property_id"], flag["complaint_id"], flag["status"]) == (
        WINDOW_RULE, PROPERTY, third, "OPEN")
    assert flag["summary"] == "Repeat complaints: complaint threshold reached"
    evidence = flag["evidence"]
    assert (evidence["complaintCount"], evidence["thresholdCount"], evidence["triggerMode"], evidence["windowDays"]) == (
        3, 3, "WINDOW", 30)
    assert evidence["details"] == "3 complaints were recorded for this property within 30 days."
    assert sorted(admin_notices(window_rule)) == sorted([
        (ADMIN, "New property red flag", "Repeat complaints triggered after 3 complaints.", "/admin/red-flags"),
        (OTHER_ADMIN, "New property red flag", "Repeat complaints triggered after 3 complaints.", "/admin/red-flags"),
    ])
    # The web never evaluates a complaint itself: the database's trigger did.
    assert not [name for name, _ in window_rule.rpc_calls if name.startswith("evaluate_red_flag")]


def test_complaints_outside_the_window_do_not_count(client, window_rule, people):
    window_rule.seed("complaints", [
        complaint(uid(1), TENANT, property_id=PROPERTY, lodged_at=LONG_AGO),
        complaint(uid(2), TENANT, property_id=PROPERTY, lodged_at=LONG_AGO),
    ])
    lodge(client, people, number=1)
    lodge(client, people, number=2)

    assert flags(window_rule) == []
    lodge(client, people, number=3)
    assert [flag["evidence"]["complaintCount"] for flag in flags(window_rule)] == [3]


def test_a_total_rule_counts_every_complaint_about_the_property(client, strict_schema, people):
    strict_schema.seed("red_flag_rules", [rule(TOTAL_RULE, "lifetime", "Lifetime complaints", trigger_mode="TOTAL")])
    strict_schema.seed("complaints", [complaint(uid(1), TENANT, property_id=PROPERTY, lodged_at=LONG_AGO),
                                      complaint(uid(2), TENANT, property_id=PROPERTY, lodged_at=LONG_AGO)])

    lodge(client, people)

    [flag] = flags(strict_schema)
    assert (flag["evidence"]["triggerMode"], flag["evidence"]["windowDays"], flag["evidence"]["windowStart"]) == (
        "TOTAL", None, None)
    assert flag["evidence"]["details"] == "3 complaints have been recorded for this property in total."


def test_a_disabled_rule_raises_nothing(client, strict_schema, people):
    strict_schema.seed("red_flag_rules", [rule(WINDOW_RULE, "repeat", "Repeat", is_active=False, threshold_count=1)])

    lodge(client, people)

    assert flags(strict_schema) == []


def test_an_active_flag_is_never_raised_twice_and_a_new_breach_after_resolving_opens_another(client, window_rule, people):
    for number in range(1, 5):
        lodge(client, people, number=number)
    assert len(flags(window_rule)) == 1

    # Re-evaluating finds the open flag and opens nothing.
    again = client.post(f"{RULES}/{WINDOW_RULE}/evaluate", headers=people["admin"])
    assert (again.status_code, again.json()["created"]) == (200, 0)

    [flag] = flags(window_rule)
    resolved = client.post(f"{FLAGS}/{flag['id']}/resolve", json={"note": "Hot water system replaced."},
                           headers=people["admin"])
    assert resolved.status_code == 200, resolved.text
    lodge(client, people, number=5)
    assert [item["status"] for item in flags(window_rule)] == ["RESOLVED", "OPEN"]


def test_each_property_is_counted_on_its_own(client, window_rule, people):
    lodge(client, people, number=1)
    lodge(client, people, number=2)
    lodge(client, people, listing=OTHER_LISTING, number=3)

    assert flags(window_rule) == []


def test_re_evaluating_a_rule_runs_the_database_function_over_every_property(client, strict_schema, people):
    strict_schema.seed("complaints", [complaint(uid(n), TENANT, property_id=PROPERTY, lodged_at=NOW) for n in (1, 2)])
    strict_schema.seed("red_flag_rules", [rule(WINDOW_RULE, "pair", "Pairs", threshold_count=2)])

    response = client.post(f"{RULES}/{WINDOW_RULE}/evaluate", headers=people["admin"])

    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1
    [(name, params)] = [call for call in strict_schema.rpc_calls if call[0] == "evaluate_red_flag_rule"]
    assert params["p_rule_id"] == WINDOW_RULE and strict_schema.rpc_callers[-1] == ("evaluate_red_flag_rule", None)
    [flag] = flags(strict_schema)
    assert (flag["property_id"], flag["evidence"]["complaintCount"]) == (PROPERTY, 2)
    assert [entry["action"] for entry in shared_trail(strict_schema)] == ["red_flag_rule.evaluated"]
    assert shared_trail(strict_schema)[0]["metadata"]["created"] == 1


def test_an_inactive_rule_is_not_re_evaluated(client, strict_schema, people):
    strict_schema.seed("red_flag_rules", [rule(WINDOW_RULE, "off", "Off", is_active=False)])

    response = client.post(f"{RULES}/{WINDOW_RULE}/evaluate", headers=people["admin"])

    assert response.status_code == 409
    assert not [name for name, _ in strict_schema.rpc_calls if name == "evaluate_red_flag_rule"]


# ---------------------------------------------------------------------------
# Deciding a flag
# ---------------------------------------------------------------------------
@pytest.fixture
def raised(client, window_rule, people):
    for number in (1, 2, 3):
        lodge(client, people, number=number)
    [flag] = flags(window_rule)
    return flag


def test_the_flags_list_shows_the_rule_property_complaint_and_evidence(client, window_rule, raised, people):
    response = client.get(FLAGS, headers=people["admin"])

    assert response.status_code == 200, response.text
    page = response.json()
    [item] = page["items"]
    assert (page["total"], item["rule_name"], item["status"], item["property_title"], item["listing_id"]) == (
        1, "Repeat complaints", "OPEN", "Harbour flat", LISTING)
    assert item["address"] == "12 Harbour St, Wollongong, NSW, 2500"
    assert (item["complaint"]["category_label"], item["actions"]) == ("Property condition", ["acknowledge", "resolve", "dismiss"])
    assert item["evidence"]["complaintCount"] == 3 and item["decisions"] == []
    assert client.get(FLAGS, params={"status": "RESOLVED"}, headers=people["admin"]).json()["items"] == []
    assert client.get(FLAGS, params={"rule_id": WINDOW_RULE}, headers=people["admin"]).json()["total"] == 1


def test_acknowledging_then_resolving_keeps_who_when_and_why_beside_the_evidence(client, window_rule, raised, people):
    evidence = dict(raised["evidence"])

    seen = client.post(f"{FLAGS}/{raised['id']}/acknowledge", json={"expected_status": "OPEN"}, headers=people["admin"])
    assert seen.status_code == 200, seen.text
    assert (seen.json()["status"], seen.json()["actions"]) == ("ACKNOWLEDGED", ["resolve", "dismiss"])
    done = client.post(f"{FLAGS}/{raised['id']}/resolve", json={"note": " The owner replaced the system. "},
                       headers=people["other_admin"])
    assert done.status_code == 200, done.text

    body = done.json()
    assert (body["status"], body["actions"]) == ("RESOLVED", [])
    assert [(d["action"], d["from_status"], d["to_status"], d["actor_name"], d["note"]) for d in body["decisions"]] == [
        ("acknowledged", "OPEN", "ACKNOWLEDGED", "Ada Admin", None),
        ("resolved", "ACKNOWLEDGED", "RESOLVED", "Otto Admin", "The owner replaced the system."),
    ]
    stored = flags(window_rule)[0]
    assert stored["resolved_at"] and stored["status"] == "RESOLVED"
    # The database's evidence is as it was; the decisions sit beside it.
    assert {key: value for key, value in stored["evidence"].items() if key != "decisions"} == evidence
    assert [(entry["actor_user_id"], entry["action"], entry["metadata"]["reason"]) for entry in shared_trail(window_rule)] == [
        (ADMIN, "red_flag_event.acknowledged", None),
        (OTHER_ADMIN, "red_flag_event.resolved", "The owner replaced the system."),
    ]
    assert [entry["action"] for entry in named_trail(window_rule)] == [
        "red_flag_event.acknowledged", "red_flag_event.resolved"]


def test_resolving_or_dismissing_needs_a_note(client, window_rule, raised, people):
    for action in ("resolve", "dismiss"):
        response = client.post(f"{FLAGS}/{raised['id']}/{action}", json={"note": "   "}, headers=people["admin"])
        assert (response.status_code, response.json()["detail"]) == (422, "Write a note: it is kept with the flag.")
    assert flags(window_rule)[0]["status"] == "OPEN"


def test_a_decided_flag_takes_no_other_decision(client, window_rule, raised, people):
    client.post(f"{FLAGS}/{raised['id']}/dismiss", json={"note": "Duplicate tenant."}, headers=people["admin"])

    for action in ("acknowledge", "resolve", "dismiss"):
        response = client.post(f"{FLAGS}/{raised['id']}/{action}", json={"note": "Again"}, headers=people["admin"])
        assert response.status_code == 409
    assert flags(window_rule)[0]["status"] == "DISMISSED"
    assert len(flags(window_rule)[0]["evidence"]["decisions"]) == 1


def test_a_decision_on_a_flag_someone_else_just_decided_is_refused(client, window_rule, raised, people):
    response = client.post(f"{FLAGS}/{raised['id']}/resolve", json={"note": "Fixed.", "expected_status": "ACKNOWLEDGED"},
                           headers=people["admin"])

    assert response.status_code == 409
    assert flags(window_rule)[0]["status"] == "OPEN"


def test_an_unknown_flag_or_action_is_refused(client, window_rule, raised, people):
    assert client.post(f"{FLAGS}/{uid(99)}/resolve", json={"note": "x"}, headers=people["admin"]).status_code == 404
    assert client.post(f"{FLAGS}/not-an-id/resolve", json={"note": "x"}, headers=people["admin"]).status_code == 404
    assert client.post(f"{FLAGS}/{raised['id']}/reopen", json={}, headers=people["admin"]).status_code == 422


# ---------------------------------------------------------------------------
# Managing the rules
# ---------------------------------------------------------------------------
def test_an_admin_creates_a_rule_with_a_unique_key_from_its_name(client, window_rule, people):
    # Another name, but the key repeat_complaints is taken.
    response = client.post(RULES, json={"name": "Repeat complaints!", "threshold_count": 5, "trigger_mode": "TOTAL",
                                        "severity": "CRITICAL"}, headers=people["admin"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["rule_key"], body["threshold_count"], body["trigger_mode"], body["window_days"], body["severity"]) == (
        "repeat_complaints_2", 5, "TOTAL", 30, "CRITICAL")
    assert body["is_active"] is True and body["active_flags"] == 0
    [entry] = shared_trail(window_rule)
    assert (entry["action"], entry["actor_user_id"], entry["summary"]) == (
        "red_flag_rule.created", ADMIN, "Created the red-flag rule Repeat complaints!: 5 complaints about a property in total")


@pytest.mark.parametrize("name", ["Repeat complaints", "  repeat   COMPLAINTS "])
def test_a_rule_of_a_name_already_there_is_refused(client, window_rule, people, name):
    # A retried request (a lost answer, a second tab) would otherwise flag every breach twice.
    response = client.post(RULES, json={"name": name, "threshold_count": 5, "trigger_mode": "TOTAL",
                                        "severity": "CRITICAL"}, headers=people["admin"])

    assert (response.status_code, response.json()["detail"]) == (409, red_flags.RULE_EXISTS)
    assert [row["id"] for row in window_rule.tables["red_flag_rules"]] == [WINDOW_RULE]
    assert shared_trail(window_rule) == []


@pytest.mark.parametrize("payload", [
    {"threshold_count": 0}, {"threshold_count": 10001}, {"window_days": 0}, {"window_days": 3651},
    {"trigger_mode": "WEEKLY"}, {"severity": "URGENT"}, {"trigger_mode": "WINDOW", "window_days": None},
])
def test_a_rule_outside_the_tables_checks_is_refused(client, window_rule, people, payload):
    response = client.post(RULES, json={"name": "Bad rule", **payload}, headers=people["admin"])

    assert response.status_code == 422
    assert len(window_rule.tables["red_flag_rules"]) == 1


def test_an_edit_changes_the_fields_and_never_the_key(client, window_rule, people):
    response = client.patch(f"{RULES}/{WINDOW_RULE}", json={"threshold_count": 4, "window_days": 14,
                                                             "expected_updated_at": NOW}, headers=people["admin"])

    assert response.status_code == 200, response.text
    assert (response.json()["rule_key"], response.json()["threshold_count"], response.json()["window_days"]) == (
        "repeat_complaints", 4, 14)
    [entry] = shared_trail(window_rule)
    assert entry["metadata"]["before"] == {"threshold_count": 3, "window_days": 30}
    stale = client.patch(f"{RULES}/{WINDOW_RULE}", json={"threshold_count": 6, "expected_updated_at": NOW},
                         headers=people["admin"])
    assert stale.status_code == 409


def test_a_rule_is_switched_off_with_a_reason_and_its_flags_stay(client, window_rule, raised, people):
    response = client.post(f"{RULES}/{WINDOW_RULE}/active", json={"is_active": False, "reason": "Too noisy"},
                           headers=people["admin"])

    assert response.status_code == 200, response.text
    assert (response.json()["is_active"], response.json()["active_flags"], response.json()["total_flags"]) == (False, 1, 1)
    assert shared_trail(window_rule)[-1]["summary"] == "Deactivated the red-flag rule Repeat complaints: Too noisy"
    assert len(flags(window_rule)) == 1


def test_only_a_rule_that_never_raised_a_flag_is_deleted(client, window_rule, raised, people):
    kept = client.delete(f"{RULES}/{WINDOW_RULE}", headers=people["admin"])
    assert kept.status_code == 409
    assert kept.json()["detail"].startswith("This rule has raised flags")

    window_rule.seed("red_flag_rules", [rule(TOTAL_RULE, "unused", "Unused")])
    gone = client.delete(f"{RULES}/{TOTAL_RULE}", headers=people["admin"])
    assert gone.status_code == 204
    assert [row["id"] for row in window_rule.tables["red_flag_rules"]] == [WINDOW_RULE]
    assert shared_trail(window_rule)[-1]["action"] == "red_flag_rule.deleted"


def test_the_rules_list_counts_each_rules_flags(client, window_rule, raised, people):
    window_rule.seed("red_flag_rules", [rule(TOTAL_RULE, "lifetime", "Lifetime", is_active=False)])

    listed = client.get(RULES, headers=people["admin"]).json()

    assert [(item["name"], item["is_active"], item["active_flags"]) for item in listed] == [
        ("Repeat complaints", True, 1), ("Lifetime", False, 0)]


# ---------------------------------------------------------------------------
# Only an active admin
# ---------------------------------------------------------------------------
ENDPOINTS = [
    ("get", RULES, None),
    ("post", RULES, {"name": "Testing access"}),
    ("patch", f"{RULES}/{WINDOW_RULE}", {"threshold_count": 1, "expected_updated_at": NOW}),
    ("post", f"{RULES}/{WINDOW_RULE}/active", {"is_active": False}),
    ("delete", f"{RULES}/{WINDOW_RULE}", None),
    ("post", f"{RULES}/{WINDOW_RULE}/evaluate", None),
    ("get", FLAGS, None),
    ("post", f"{FLAGS}/{uid(1)}/resolve", {"note": "Testing access"}),
]


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "REGULATOR"])
@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_every_other_role_is_refused(client, window_rule, primary_role, method, path, body):
    token = account(window_rule, CALLER, "caller@example.test", primary_role)
    headers = {"Authorization": f"Bearer {token}"}

    response = client.request(method, path, json=body, headers=headers)

    assert response.status_code == 403, response.text
    assert [row["threshold_count"] for row in window_rule.tables["red_flag_rules"]] == [3]
    assert window_rule.tables["red_flag_rules"][0]["is_active"] is True
    assert not window_rule.rpc_calls and not shared_trail(window_rule)


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_a_signed_out_caller_is_refused(client, window_rule, method, path, body):
    assert client.request(method, path, json=body).status_code == 401
