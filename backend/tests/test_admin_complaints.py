"""Complaints from submission to resolution, in each role's dashboard and the admin console (tracker R38, R40).

A tenant lodges a complaint about the listing they rent, through
create_general_complaint; it shows on the tenant's Complaints page, the
owner's and the admin console's. The owner answers, an admin takes the case,
moves it to review and resolves it through review_general_complaint, each
time with a note both parties read in the complaint's timeline
(complaint_events); the function tells the tenant, the web tells the owner.
Which admin handles a case stays with staff. Every decision is recorded with
its actor and note in both audit logs. A complaint the web wrote itself is
decided by the web.
"""

import pytest

from app.services import complaints as complaints_service
from tests.factories_admin import bearer, lands_first, named_trail, shared_trail
from tests.factories_identity import like_escapes, users_row  # noqa: F401 (fixture)
from tests.factories_reviews_complaints import application, complaint, events, seed_rental, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a3000000-0000-4000-8000-000000000001"
OTHER_ADMIN = "a3000000-0000-4000-8000-000000000002"
AWAY_ADMIN = "a3000000-0000-4000-8000-000000000003"
TENANT = "b3000000-0000-4000-8000-000000000001"
OWNER = "b3000000-0000-4000-8000-000000000002"
NEIGHBOUR = "b3000000-0000-4000-8000-000000000003"
PROPERTY = "c3000000-0000-4000-8000-000000000001"
LISTING = "c3000000-0000-4000-8000-000000000002"
FIRST = "e3000000-0000-4000-8000-000000000001"
SECOND = "e3000000-0000-4000-8000-000000000002"
THIRD = "e3000000-0000-4000-8000-000000000003"
REPAIR = "e3000000-0000-4000-8000-000000000004"
WORK_ORDER = "f3000000-0000-4000-8000-000000000001"
APPLICATION = "f3000000-0000-4000-8000-000000000002"

API = "/api/v1"
ADMIN_API = f"{API}/admin/complaints"


@pytest.fixture(autouse=True)
def database_clock(strict_schema, monkeypatch):
    """The web's now() is the fake database's, so the steps the functions date (p_now) sort with the rest."""
    monkeypatch.setattr(complaints_service, "_now", strict_schema.strict.now)


def lodged(month: int) -> str:
    return f"2026-0{month}-01T00:00:00+00:00"


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(OTHER_ADMIN, "otto@example.test", "ADMIN", full_name="Otto Admin"),
        users_row(AWAY_ADMIN, "sue@example.test", "ADMIN", full_name="Sue Suspended", status="SUSPENDED"),
        users_row(NEIGHBOUR, "ned@example.test", full_name="Ned Neighbour"),
    ])
    return strict_schema


@pytest.fixture
def people(client, db):
    """The headers of the tenant, the owner and the admin; the owner's listing."""
    headers = {
        "tenant": bearer(db, TENANT, "tia@example.test", full_name="Tia Nguyen"),
        "owner": bearer(db, OWNER, "oliver@example.test", "LANDLORD", full_name="Oliver Grant"),
        "admin": bearer(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin"),
    }
    seed_rental(db, OWNER, PROPERTY, LISTING, title="Harbour flat")
    db.seed("rental_applications", [application(APPLICATION, LISTING, TENANT)])
    return headers


def notices(db, user_id) -> list[tuple[str, str, str | None]]:
    return [(n["title"], n["body"], n["link"]) for n in db.tables.get("notifications", []) if n["user_id"] == user_id]


def steps(complaint_json) -> list[tuple]:
    return [(step["kind"], step["status"], step["note"], step["actor"]) for step in complaint_json["timeline"]]


def test_a_complaint_is_followed_from_submission_to_resolution_in_each_dashboard(client, db, people):
    tenant, owner, admin = people["tenant"], people["owner"], people["admin"]

    # The tenant lodges it.
    created = client.post(f"{API}/complaints", json={
        "subject": "Heater broken", "description": "The heater has been broken for three weeks.",
        "category": "PROPERTY_CONDITION", "property_id": LISTING,
    }, headers=tenant)
    assert created.status_code == 201, created.text
    complaint_id = created.json()["id"]
    assert steps(created.json()) == [("lodged", None, None, "you")]
    # create_general_complaint's notice.
    assert notices(db, OWNER) == [(
        "New property complaint", "A tenant submitted a complaint linked to one of your properties.", "/admin/complaints",
    )]

    # The owner's page and the admin console list it.
    [theirs] = client.get(f"{API}/complaints/against-me", headers=owner).json()
    assert (theirs["id"], theirs["status"], theirs["complainant_name"]) == (complaint_id, "open", "Tia Nguyen")
    assert steps(theirs) == [("lodged", None, None, "complainant")]
    page = client.get(ADMIN_API, headers=admin).json()
    assert [(item["id"], item["status"], item["assignee"], item["property_title"]) for item in page["items"]] == [
        (complaint_id, "OPEN", None, "Harbour flat")]
    assert page["items"][0]["complainant"] == {"id": TENANT, "full_name": "Tia Nguyen", "role": "tenant"}

    # The owner answers.
    answered = client.post(f"{API}/complaints/{complaint_id}/respond", json={"response": "A technician comes Friday."},
                           headers=owner)
    assert answered.status_code == 200, answered.text
    assert notices(db, TENANT) == [
        ("Your complaint was answered: Heater broken", "A technician comes Friday.", "/tenant/complaints")]

    # An admin takes the case, then moves it to review and resolves it.
    taken = client.post(f"{ADMIN_API}/{complaint_id}/assignment", json={"assignee_id": ADMIN}, headers=admin)
    assert taken.status_code == 200, taken.text
    assert taken.json()["assignee"] == {"id": ADMIN, "full_name": "Ada Admin", "role": "admin"}
    # The owner's answer moved it to review already.
    reviewing = client.post(f"{ADMIN_API}/{complaint_id}/status", json={
        "status": "IN_REVIEW", "note": "We asked the owner for the technician's report.",
    }, headers=admin)
    assert reviewing.status_code == 400, reviewing.text
    escalated = client.post(f"{ADMIN_API}/{complaint_id}/status", json={
        "status": "ESCALATED", "note": "No technician came.", "expected_status": "IN_REVIEW",
    }, headers=admin)
    assert escalated.status_code == 200, escalated.text
    resolved = client.post(f"{ADMIN_API}/{complaint_id}/status", json={
        "status": "RESOLVED", "note": "  The heater was replaced on 2 March. ", "expected_status": "ESCALATED",
    }, headers=admin)
    assert resolved.status_code == 200, resolved.text
    detail = resolved.json()
    # review_general_complaint keeps the note in its step; any other status may follow but CLOSED's.
    assert (detail["status"], detail["resolution_note"], detail["transitions"]) == (
        "RESOLVED", "The heater was replaced on 2 March.", ["IN_REVIEW", "ESCALATED", "CLOSED"])
    assert detail["source"] == "tenant_general_complaint"
    assert [(step["event_type"], step["actor"]["id"] if step["actor"] else None) for step in detail["timeline"]] == [
        ("LODGED", TENANT), ("RESPONDED", OWNER), ("ASSIGNED", ADMIN), ("STATUS_CHANGED", ADMIN),
        ("STATUS_CHANGED", ADMIN)]
    assert (detail["timeline"][4]["from_status"], detail["timeline"][4]["to_status"]) == ("ESCALATED", "RESOLVED")
    assert detail["timeline"][2]["assignee"]["full_name"] == "Ada Admin"
    reviews = [params for name, params in db.rpc_calls if name == "review_general_complaint"]
    assert [(params["p_admin_user_id"], params["p_status"], params["p_note"]) for params in reviews] == [
        (ADMIN, "ESCALATED", "No technician came."), (ADMIN, "RESOLVED", "The heater was replaced on 2 March.")]

    # Both parties see where it stands and why, but not who handled it.
    [mine] = client.get(f"{API}/complaints", headers=tenant).json()
    assert (mine["status"], mine["resolution_note"]) == ("resolved", "The heater was replaced on 2 March.")
    assert mine["resolved_at"]
    expected = [
        ("lodged", None, None, "you"),
        ("responded", None, None, "respondent"),
        ("status", "escalated", "No technician came.", "staff"),
        ("status", "resolved", "The heater was replaced on 2 March.", "staff"),
    ]
    assert steps(mine) == expected
    [theirs] = client.get(f"{API}/complaints/against-me", headers=owner).json()
    assert theirs["status"] == "resolved"
    assert steps(theirs) == [("lodged", None, None, "complainant"), ("responded", None, None, "you"), *expected[2:]]
    # review_general_complaint tells the tenant; the web adds no second notice.
    assert notices(db, TENANT)[1:] == [
        ("Complaint status updated", "Your complaint is now escalated.", "/admin/complaints"),
        ("Complaint status updated", "Your complaint is now resolved.", "/admin/complaints"),
    ]
    assert notices(db, OWNER)[1:] == [
        ("A complaint about you was escalated: Heater broken", "No technician came.", "/owner/complaints"),
        ("A complaint about you was resolved: Heater broken", "The heater was replaced on 2 March.", "/owner/complaints"),
    ]
    resolved_only = client.get(ADMIN_API, params={"status": "RESOLVED"}, headers=admin).json()["items"]
    assert [item["id"] for item in resolved_only] == [complaint_id]

    # Each admin decision is in both logs, naming the admin and the note.
    entries = [(e["actor_user_id"], e["action"], e["metadata"].get("reason")) for e in shared_trail(db)]
    assert entries == [
        (ADMIN, "complaint.assigned", None),
        (ADMIN, "complaint.status_changed", "No technician came."),
        (ADMIN, "complaint.status_changed", "The heater was replaced on 2 March."),
    ]
    last = shared_trail(db)[-1]
    assert [step["actor"] for step in steps_of(db, complaint_id)] == [TENANT, OWNER, ADMIN, ADMIN, ADMIN]
    assert last["summary"] == "Moved the complaint “Heater broken” from Escalated to Resolved: The heater was replaced on 2 March."
    assert (last["metadata"]["from_status"], last["metadata"]["to_status"], last["entity_id"]) == (
        "ESCALATED", "RESOLVED", complaint_id)
    assert [(e["actor_id"], e["action"]) for e in named_trail(db)] == [
        (ADMIN, "complaint.assigned"), (ADMIN, "complaint.status_changed"), (ADMIN, "complaint.status_changed")]
    [*_, last_event] = events(db, complaint_id)
    assert (last_event["actor_user_id"], last_event["note"], last_event["metadata"]) == (
        ADMIN, "The heater was replaced on 2 March.", {"fromStatus": "ESCALATED", "toStatus": "RESOLVED"})
    stored = next(row for row in db.tables["complaints"] if row["id"] == complaint_id)
    assert (stored["status"], stored["resolved_at"] is not None) == ("RESOLVED", True)
    assert "resolution_note" not in stored["metadata"]


def steps_of(db, complaint_id) -> list[dict]:
    return [{"actor": event["actor_user_id"], "type": event["event_type"]} for event in events(db, complaint_id)]


def test_a_closed_general_complaint_cannot_change(client, db, people):
    created = client.post(f"{API}/complaints", json={
        "subject": "Heater broken", "description": "The heater has been broken for three weeks.",
        "category": "SAFETY", "property_id": LISTING,
    }, headers=people["tenant"]).json()
    closed = client.post(f"{ADMIN_API}/{created['id']}/status", json={"status": "CLOSED", "note": "Duplicate case."},
                         headers=people["admin"])
    assert closed.status_code == 200, closed.text
    assert closed.json()["transitions"] == []

    again = client.post(f"{ADMIN_API}/{created['id']}/status", json={"status": "IN_REVIEW", "note": "Reopen"},
                        headers=people["admin"])

    assert again.status_code == 400
    assert [params["p_status"] for name, params in db.rpc_calls if name == "review_general_complaint"] == ["CLOSED"]


def test_the_functions_refusal_reaches_the_admin_in_its_own_words(client, db, people, monkeypatch):
    created = client.post(f"{API}/complaints", json={
        "subject": "Heater broken", "description": "The heater has been broken for three weeks.",
        "category": "SAFETY", "property_id": LISTING,
    }, headers=people["tenant"]).json()
    # Another admin closed it after this one read it: the function refuses.
    row = next(row for row in db.tables["complaints"] if row["id"] == created["id"])
    monkeypatch.setattr(complaints_service, "staff_transitions", lambda _row: ("IN_REVIEW",))
    row["status"] = "CLOSED"

    refused = client.post(f"{ADMIN_API}/{created['id']}/status", json={"status": "IN_REVIEW", "note": "Looking."},
                          headers=people["admin"])

    assert (refused.status_code, refused.json()["detail"]) == (422, "A closed complaint cannot be changed")
    assert [event["event_type"] for event in events(db, created["id"])] == ["LODGED"]


@pytest.fixture
def three(db, people):
    """Three complaints, a repair, and one assigned to another admin."""
    db.seed("complaints", [
        complaint(FIRST, TENANT, category="safety", against_user_id=OWNER, property_id=PROPERTY, lodged_at=lodged(1),
                  description="The smoke alarm has no battery.", metadata={"subject": "Smoke alarm"}),
        complaint(SECOND, TENANT, category="HARASSMENT", against_user_id=OWNER, status="IN_REVIEW",
                  lodged_at=lodged(2), metadata={"subject": "Entry without notice", "assigned_admin_id": OTHER_ADMIN}),
        complaint(THIRD, NEIGHBOUR, category="OTHER", against_user_id=TENANT, status="RESOLVED", lodged_at=lodged(3),
                  resolved_at=lodged(4), metadata={"subject": "Parking", "resolution_note": "Sorted."}),
        complaint(REPAIR, TENANT, category="plumbing", against_user_id=OWNER, lodged_at=lodged(5),
                  metadata={"subject": "Burst pipe"}),
    ])
    db.seed("maintenance_work_orders", [work_order(WORK_ORDER, REPAIR, TENANT, listing_id=LISTING)])
    return db


def listed(client, headers, **params) -> list[str]:
    response = client.get(ADMIN_API, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_the_admin_list_filters_and_pages_complaints_but_never_repairs(client, three, people, like_escapes):
    admin = people["admin"]

    assert listed(client, admin) == [THIRD, SECOND, FIRST]
    assert listed(client, admin, status="IN_REVIEW") == [SECOND]
    # The web's older name reads as the standard category.
    assert listed(client, admin, category="SAFETY") == [FIRST]
    assert listed(client, admin, assignee="unassigned") == [THIRD, FIRST]
    assert listed(client, admin, assignee=OTHER_ADMIN) == [SECOND]
    assert listed(client, admin, assignee="me") == []
    assert listed(client, admin, q="smoke") == [FIRST]
    assert listed(client, admin, q="parking") == [THIRD]
    page = client.get(ADMIN_API, params={"limit": 1, "offset": 1}, headers=admin).json()
    assert ([item["id"] for item in page["items"]], page["total"]) == ([SECOND], 3)
    second = page["items"][0]
    assert (second["category"], second["category_label"], second["assignee"]["full_name"]) == (
        "HARASSMENT", "Harassment", "Otto Admin")
    assert client.get(ADMIN_API, params={"assignee": "someone"}, headers=admin).status_code == 422
    assert client.get(ADMIN_API, params={"status": "DISMISSED"}, headers=admin).status_code == 422
    for missing in [REPAIR, "e3000000-0000-4000-8000-000000000099", "not-a-complaint"]:
        assert client.get(f"{ADMIN_API}/{missing}", headers=admin).status_code == 404


def test_a_status_change_needs_a_note_and_a_status_it_can_move_to(client, three, people):
    admin = people["admin"]

    no_note = client.post(f"{ADMIN_API}/{FIRST}/status", json={"status": "IN_REVIEW", "note": "  "}, headers=admin)
    assert no_note.status_code == 422
    assert no_note.json()["detail"][0]["msg"] == "Write a note. Both parties see it with the new status."
    wrong = client.post(f"{ADMIN_API}/{SECOND}/status", json={"status": "OPEN", "note": "Back"}, headers=admin)
    assert wrong.status_code == 400
    assert wrong.json()["detail"] == "Cannot move a complaint from IN_REVIEW to OPEN"
    stale = client.post(f"{ADMIN_API}/{FIRST}/status", json={"status": "CLOSED", "note": "Duplicate",
                                                             "expected_status": "IN_REVIEW"}, headers=admin)
    assert stale.status_code == 409
    assert [row["status"] for row in three.tables["complaints"]] == ["OPEN", "IN_REVIEW", "RESOLVED", "OPEN"]
    assert not three.tables.get("complaint_events") and not shared_trail(three)


def test_a_resolved_complaint_can_be_reopened_and_both_parties_are_told(client, three, people):
    response = client.post(f"{ADMIN_API}/{THIRD}/status", json={"status": "IN_REVIEW", "note": "The car is back."},
                           headers=people["admin"])

    assert response.status_code == 200, response.text
    row = next(row for row in three.tables["complaints"] if row["id"] == THIRD)
    assert (row["status"], row["resolved_at"]) == ("IN_REVIEW", None)
    assert "resolution_note" not in row["metadata"] and row["metadata"]["subject"] == "Parking"
    assert notices(three, NEIGHBOUR) == [("Your complaint was reopened: Parking", "The car is back.", "/tenant/complaints")]
    assert notices(three, TENANT) == [
        ("A complaint about you was reopened: Parking", "The car is back.", "/tenant/complaints")]
    # That page lists the complaints about the tenant from /complaints/against-me (TenantComplaints).
    about = client.get(f"{API}/complaints/against-me", headers=people["tenant"]).json()
    assert [(item["id"], item["status"]) for item in about] == [(THIRD, "under_review")]


def test_a_withdrawn_complaint_stays_withdrawn(client, three, people):
    withdrawn = next(row for row in three.tables["complaints"] if row["id"] == FIRST)
    withdrawn.update(status="CLOSED", metadata={**withdrawn["metadata"], "dismissed": True})

    detail = client.get(f"{ADMIN_API}/{FIRST}", headers=people["admin"]).json()
    assert (detail["status"], detail["withdrawn"], detail["transitions"]) == ("CLOSED", True, [])
    response = client.post(f"{ADMIN_API}/{FIRST}/status", json={"status": "IN_REVIEW", "note": "Reopen"},
                           headers=people["admin"])
    assert response.status_code == 400 and withdrawn["status"] == "CLOSED"


def test_a_complaint_is_assigned_only_to_an_active_admin(client, three, people):
    admin = people["admin"]

    for someone in [TENANT, AWAY_ADMIN, "not-an-admin"]:
        refused = client.post(f"{ADMIN_API}/{FIRST}/assignment", json={"assignee_id": someone}, headers=admin)
        assert (refused.status_code, refused.json()["detail"]) == (422, "Choose an active TenantVoice admin.")
    handed = client.post(f"{ADMIN_API}/{FIRST}/assignment", json={"assignee_id": OTHER_ADMIN, "note": " Yours "},
                         headers=admin)
    assert handed.status_code == 200, handed.text
    again = client.post(f"{ADMIN_API}/{FIRST}/assignment", json={"assignee_id": OTHER_ADMIN}, headers=admin)
    assert again.status_code == 200
    dropped = client.post(f"{ADMIN_API}/{FIRST}/assignment", json={"assignee_id": None}, headers=admin)
    assert dropped.status_code == 200 and dropped.json()["assignee"] is None

    row = next(row for row in three.tables["complaints"] if row["id"] == FIRST)
    # Assigned, then unassigned: the same admin again changed nothing.
    assert row["metadata"] == {"subject": "Smoke alarm", "revision": 2}
    assert [(e["event_type"], e["note"], e["metadata"]["assignee_id"]) for e in events(three, FIRST)] == [
        ("ASSIGNED", "Yours", OTHER_ADMIN), ("ASSIGNED", None, None)]
    assert [(e["action"], e["summary"]) for e in shared_trail(three)] == [
        ("complaint.assigned", "Assigned the complaint “Smoke alarm” to Otto Admin: Yours"),
        ("complaint.assigned", "Unassigned the complaint “Smoke alarm”"),
    ]
    # The parties never see who handles it.
    mine = next(c for c in client.get(f"{API}/complaints", headers=people["tenant"]).json() if c["id"] == FIRST)
    assert mine["timeline"] == []


def test_the_assignees_are_the_active_admins(client, three, people):
    response = client.get(f"{ADMIN_API}/assignees", headers=people["admin"])

    assert response.status_code == 200, response.text
    assert [(person["id"], person["full_name"]) for person in response.json()] == [
        (ADMIN, "Ada Admin"), (OTHER_ADMIN, "Otto Admin")]


# ---------------------------------------------------------------------------
# A change another admin makes between this one's read and its write
# ---------------------------------------------------------------------------
def stored_complaint(db, complaint_id):
    return next(row for row in db.tables["complaints"] if row["id"] == complaint_id)


def test_a_status_change_to_a_complaint_another_admin_just_moved_writes_nothing(client, three, people, monkeypatch):
    lands_first(monkeypatch, complaints_service, lambda: stored_complaint(three, FIRST).update(status="RESOLVED"))

    response = client.post(f"{ADMIN_API}/{FIRST}/status", json={"status": "IN_REVIEW", "note": "Looking into it."},
                           headers=people["admin"])

    assert response.status_code == 409
    assert stored_complaint(three, FIRST)["status"] == "RESOLVED"
    assert (events(three, FIRST), shared_trail(three), three.tables.get("notifications", [])) == ([], [], [])


def test_an_assignment_to_a_complaint_another_admin_just_moved_keeps_both(client, three, people, monkeypatch):
    lands_first(monkeypatch, complaints_service, lambda: stored_complaint(three, FIRST).update(status="IN_REVIEW"))

    response = client.post(f"{ADMIN_API}/{FIRST}/assignment", json={"assignee_id": ADMIN}, headers=people["admin"])

    # Who handles a case does not depend on where it stands: the assignment is made on the new row.
    assert response.status_code == 200, response.text
    stored = stored_complaint(three, FIRST)
    assert (stored["status"], stored["metadata"]["assigned_admin_id"]) == ("IN_REVIEW", ADMIN)
    assert [e["event_type"] for e in events(three, FIRST)] == ["ASSIGNED"]
    assert [e["action"] for e in shared_trail(three)] == ["complaint.assigned"]


# ---------------------------------------------------------------------------
# Two writes that merge into one complaint's metadata at once (no updated_at):
# metadata.revision lets the later one start again from the new row
# ---------------------------------------------------------------------------
def answer(text: str):
    return lambda: complaints_service.respond_to_complaint(SECOND, OWNER, text)


def test_an_assignment_keeps_the_answer_its_respondent_sent_meanwhile(client, three, people, monkeypatch):
    lands_first(monkeypatch, complaints_service, answer("The agent never entered without notice."))

    response = client.post(f"{ADMIN_API}/{SECOND}/assignment", json={"assignee_id": ADMIN}, headers=people["admin"])

    assert response.status_code == 200, response.text
    meta = stored_complaint(three, SECOND)["metadata"]
    assert (meta["assigned_admin_id"], meta["assigned_by"], meta["response"]) == (
        ADMIN, ADMIN, "The agent never entered without notice.")
    assert meta["revision"] == 2
    assert response.json()["response"] == "The agent never entered without notice."
    assert [e["event_type"] for e in events(three, SECOND)] == ["RESPONDED", "ASSIGNED"]
    [assigned] = [e for e in events(three, SECOND) if e["event_type"] == "ASSIGNED"]
    assert assigned["metadata"]["previous_assignee_id"] == OTHER_ADMIN


def test_an_answer_keeps_the_assignment_an_admin_made_meanwhile(client, three, people, monkeypatch):
    lands_first(monkeypatch, complaints_service, lambda: complaints_service.staff_assign(SECOND, ADMIN, ADMIN, None))

    response = client.post(f"{API}/complaints/{SECOND}/respond", json={"response": "Nobody entered."},
                           headers=people["owner"])

    assert response.status_code == 200, response.text
    meta = stored_complaint(three, SECOND)["metadata"]
    assert (meta["response"], meta["assigned_admin_id"], meta["subject"]) == ("Nobody entered.", ADMIN,
                                                                              "Entry without notice")
    assert meta["revision"] == 2
    assert [e["event_type"] for e in events(three, SECOND)] == ["ASSIGNED", "RESPONDED"]
    assert notices(three, TENANT) == [("Your complaint was answered: Entry without notice", "Nobody entered.",
                                       "/tenant/complaints")]


def test_a_status_change_keeps_an_answer_that_left_the_status_as_it_was(client, three, people, monkeypatch):
    lands_first(monkeypatch, complaints_service, answer("The agent never entered."))

    response = client.post(f"{ADMIN_API}/{SECOND}/status", json={
        "status": "ESCALATED", "note": "Both sides disagree.", "expected_status": "IN_REVIEW",
    }, headers=people["admin"])

    assert response.status_code == 200, response.text
    stored = stored_complaint(three, SECOND)
    assert (stored["status"], stored["metadata"]["response"], stored["metadata"]["assigned_admin_id"]) == (
        "ESCALATED", "The agent never entered.", OTHER_ADMIN)


def test_a_write_that_keeps_losing_the_race_is_refused_and_writes_nothing(client, three, people, monkeypatch):
    stamp = complaints_service.stamp_update

    def another_write_each_time(table, changes, *args):
        # Another web write lands between every read and write of this one.
        row = stored_complaint(three, SECOND)
        row["metadata"] = {**row["metadata"], "revision": (row["metadata"].get("revision") or 0) + 1}
        return stamp(table, changes, *args)

    monkeypatch.setattr(complaints_service, "stamp_update", another_write_each_time)

    response = client.post(f"{ADMIN_API}/{SECOND}/assignment", json={"assignee_id": ADMIN}, headers=people["admin"])

    assert response.status_code == 409
    assert response.json()["detail"] == "This complaint changed while you were looking at it. Reload it and try again."
    stored = stored_complaint(three, SECOND)
    assert (stored["metadata"]["assigned_admin_id"], stored["metadata"]["revision"]) == (
        OTHER_ADMIN, complaints_service.WRITE_ATTEMPTS)
    assert (events(three, SECOND), shared_trail(three)) == ([], [])


def test_a_complaint_another_app_wrote_without_a_revision_takes_its_first(client, three, people):
    assert "revision" not in stored_complaint(three, FIRST)["metadata"]

    client.post(f"{ADMIN_API}/{FIRST}/assignment", json={"assignee_id": ADMIN}, headers=people["admin"])
    client.post(f"{API}/complaints/{FIRST}/respond", json={"response": "Fixed."}, headers=people["owner"])

    meta = stored_complaint(three, FIRST)["metadata"]
    assert (meta["revision"], meta["assigned_admin_id"], meta["response"]) == (2, ADMIN, "Fixed.")


def test_a_partys_status_step_shows_without_its_note(client, three, people):
    # Another app's STATUS_CHANGED by the respondent: the parties see the step, not what they wrote with it.
    three.seed("complaint_events", [{
        "id": "f3000000-0000-4000-8000-000000000009", "complaint_id": FIRST, "actor_user_id": OWNER,
        "event_type": "STATUS_CHANGED", "note": "Private note to staff", "metadata": {"to_status": "IN_REVIEW"},
        "created_at": lodged(2),
    }])

    mine = next(item for item in client.get(f"{API}/complaints", headers=people["tenant"]).json() if item["id"] == FIRST)

    step = next(step for step in mine["timeline"] if step["kind"] == "status")
    assert step["note"] is None
