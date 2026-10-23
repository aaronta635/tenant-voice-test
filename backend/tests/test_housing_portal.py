"""The Housing Portal's data and actions (tracker R41), as an officer gets them by direct API call.

Referrals run through the officer's JWT, so the stand-ins in
tests/fake_rpcs/fb_housing.py answer as the shared functions do. Everything
else is read from the rows with the service role, after core/officer.py let
the officer in (tests/test_housing_portal_access.py checks who is refused).
"""

import json

import pytest
from postgrest.exceptions import APIError

from app.core.supabase import user_client
from app.services import housing_portal
from tests import fake_rpcs
from tests.factories import NOW
from tests.factories_admin import bearer, issue_category, named_trail, shared_trail
from tests.factories_housing import (
    ALERT,
    COMPLAINT,
    EVENT,
    FLAG,
    HOME,
    OFFICER,
    OWNER,
    REFERRAL,
    RULE,
    SURVEY,
    TENANT,
    alert,
    event,
    flag,
    question,
    referral,
    rule,
    seed_case,
    seed_portal,
    survey,
)
from tests.factories_reviews_complaints import complaint, property_row, review, user
from tests.fake_supabase import api_error

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN_CALLER = "e1000000-0000-4000-8000-0000000000ad"
OTHER_OFFICER = "e1000000-0000-4000-8000-0000000000bb"
API = "/api/v1/housing"


def numbered(prefix: str, number: int) -> str:
    return f"{prefix}-0000-4000-8000-{number:012d}"


@pytest.fixture
def officer(strict_schema):
    """The signed-in officer's headers, over the portal's rows."""
    seed_portal(strict_schema)
    return bearer(strict_schema, OFFICER, "olive@example.test", "REGULATOR", full_name="Olive Officer")


def package(db, id=REFERRAL) -> dict:
    return next(row for row in db.tables["mobile_admin_referral_packages"] if row["id"] == id)


def notices(db, user_id=None) -> list[dict]:
    return [row for row in db.tables.get("notifications", []) if user_id is None or row["user_id"] == user_id]


def requests(db) -> list[dict]:
    return db.schema_tables.get("web", {}).get("datapoint_requests", [])


# ---------------------------------------------------------------------------
# Referrals
# ---------------------------------------------------------------------------
def test_referrals_come_from_the_database_as_the_officer(client, strict_schema, officer):
    response = client.get(f"{API}/referrals", headers=officer)

    assert response.status_code == 200, response.text
    [case] = response.json()
    assert (case["id"], case["alert_id"], case["complaint_id"]) == (REFERRAL, ALERT, COMPLAINT)
    assert (case["case_reference"], case["severity"], case["status"], case["package_status"]) == \
        ("TV-E5000000", "critical", "New", "REFERRED")
    assert (case["category"], case["area"], case["address"]) == ("Maintenance", "Glebe", "12 Harbour St, Glebe, NSW, 2037")
    assert case["parties"] == {"tenant_name": "Tess Tenant", "owner_name": "Owen Owner"}
    assert case["complaint"]["description"] == "Mould in every room."
    assert case["evidence"] == {
        "trigger_reason": "Open 21 days with 3 complaints at the same home.", "days_open": 21,
        "property_open_complaints": 3, "owner_open_complaints": 4, "photo_count": 2, "documents_verified": True,
        "work_order_status": "OPEN",
        "events": [{"type": "LODGED", "note": "Lodged by the tenant.", "created_at": "2026-01-01T00:00:00Z"}],
    }
    # Through the officer's JWT: the database checks the officer itself.
    officer_auth = next(row["auth_user_id"] for row in strict_schema.tables["users"] if row["id"] == OFFICER)
    assert ("mobile_housing_red_flag_referrals", officer_auth) in strict_schema.rpc_callers


def test_referrals_keep_the_databases_order_new_work_and_critical_cases_first(client, strict_schema, officer):
    for number, (severity, status, referred_at) in enumerate([
        ("HIGH", "REFERRED", "2026-01-03T00:00:00+00:00"),
        ("CRITICAL", "UNDER_REVIEW", "2026-01-04T00:00:00+00:00"),
        ("CRITICAL", "REFERRED", "2026-01-02T00:00:00+00:00"),
        ("CRITICAL", "CLOSED", "2026-01-05T00:00:00+00:00"),
    ], start=2):
        complaint_id, alert_id = numbered("e3000000", number), numbered("e5000000", number)
        strict_schema.seed("complaints", [complaint(complaint_id, TENANT, property_id=HOME)])
        strict_schema.seed("mobile_admin_alerts", [alert(alert_id, complaint_id, severity=severity)])
        strict_schema.seed("mobile_admin_referral_packages", [
            referral(numbered("e6000000", number), alert_id, complaint_id, status=status, referred_at=referred_at),
        ])

    order = [case["id"] for case in client.get(f"{API}/referrals", headers=officer).json()]

    assert order == [numbered("e6000000", 4), REFERRAL, numbered("e6000000", 2), numbered("e6000000", 3),
                     numbered("e6000000", 5)]


def test_an_action_moves_the_package_and_is_logged_in_both_logs(client, strict_schema, officer):
    response = client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer,
                           json={"action": "START_REVIEW", "note": "  Asked the owner for the repair invoice.  "})

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "Under review"
    assert response.json()["package_status"] == "UNDER_REVIEW"
    assert response.json()["regulator_note"] == "Asked the owner for the repair invoice."
    row = package(strict_schema)
    assert (row["status"], row["reviewed_by"], row["regulator_note"]) == \
        ("UNDER_REVIEW", OFFICER, "Asked the owner for the repair invoice.")
    [entry] = shared_trail(strict_schema, "HOUSING_REFERRAL_START_REVIEW")
    assert (entry["actor_user_id"], entry["entity_id"]) == (OFFICER, REFERRAL)
    assert [entry["action"] for entry in named_trail(strict_schema)] == ["housing.referral.start_review"]


def test_a_retried_action_opens_no_second_case(client, strict_schema, officer):
    body = {"action": "PREPARE_PACKAGE", "note": "Package checked."}
    first = client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer, json=body)
    reviewed_at = package(strict_schema)["reviewed_at"]
    again = client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer, json=body)

    assert (first.status_code, again.status_code) == (200, 200)
    assert first.json()["id"] == again.json()["id"] == REFERRAL
    assert len(strict_schema.tables["mobile_admin_referral_packages"]) == 1
    assert package(strict_schema)["reviewed_at"] == reviewed_at  # the first review is kept
    assert [case["id"] for case in client.get(f"{API}/referrals", headers=officer).json()] == [REFERRAL]


def test_a_blank_note_keeps_the_last_one(client, strict_schema, officer):
    client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer, json={"action": "START_REVIEW", "note": "First look."})

    response = client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer, json={"action": "CLOSE", "note": "   "})

    assert response.json()["package_status"] == "CLOSED"
    assert package(strict_schema)["regulator_note"] == "First look."


def test_an_unknown_referral_is_not_found(client, strict_schema, officer):
    missing = client.post(f"{API}/referrals/{numbered('e6000000', 99)}/actions", headers=officer,
                          json={"action": "CLOSE"})
    not_an_id = client.post(f"{API}/referrals/not-an-id/actions", headers=officer, json={"action": "CLOSE"})

    assert (missing.status_code, missing.json()["detail"]) == (404, "Referral package not found.")
    assert not_an_id.status_code == 404
    assert package(strict_schema)["status"] == "REFERRED"


def test_an_unknown_action_is_refused_before_the_database(client, strict_schema, officer):
    response = client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer, json={"action": "DELETE"})

    assert response.status_code == 422
    assert [name for name, _ in strict_schema.rpc_calls if name == "mobile_housing_update_referral"] == []


@pytest.mark.parametrize("code, answer", [("42501", 403), ("P0002", 404), ("23505", 409), ("22023", 422), ("23514", 422)])
def test_the_functions_refusals_keep_their_message(client, strict_schema, officer, monkeypatch, code, answer):
    def refuse(ctx, params):
        raise api_error(code, "The database said no.")

    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_housing_update_referral", refuse)

    response = client.post(f"{API}/referrals/{REFERRAL}/actions", headers=officer, json={"action": "CLOSE"})

    assert (response.status_code, response.json()["detail"]) == (answer, "The database said no.")
    assert named_trail(strict_schema) == []


def test_the_referral_functions_refuse_anyone_but_housing_staff(strict_schema):
    seed_case(strict_schema)
    tenant = bearer(strict_schema, numbered("e1000000", 77), "tia@example.test", "TENANT")["Authorization"][7:]
    admin = bearer(strict_schema, ADMIN_CALLER, "ada.admin@example.test", "ADMIN")["Authorization"][7:]

    with pytest.raises(APIError) as refused:
        user_client(tenant).rpc("mobile_housing_red_flag_referrals", {}).execute()
    assert (refused.value.code, refused.value.message) == ("42501", "Housing Portal access is required.")
    # The database lets an admin through; the web's own check (core/officer.py) does not.
    assert [case["id"] for case in user_client(admin).rpc("mobile_housing_red_flag_referrals", {}).execute().data] == [REFERRAL]


# ---------------------------------------------------------------------------
# Red-flag alerts
# ---------------------------------------------------------------------------
def test_red_flag_alerts_show_events_and_regulatory_alerts_without_the_street(client, strict_schema, officer):
    response = client.get(f"{API}/red-flags", headers=officer)

    assert response.status_code == 200, response.text
    [shown] = response.json()["events"]
    assert (shown["id"], shown["rule"], shown["status"], shown["area"]) == (EVENT, "Repeated complaints", "OPEN", "Glebe NSW")
    assert (shown["complaint_count"], shown["threshold"], shown["window_days"]) == (3, 3, 30)
    assert "Harbour St" not in response.text
    [alert_row] = response.json()["alerts"]
    assert (alert_row["id"], alert_row["status"], alert_row["reports"]) == (FLAG, "New", 12)


def test_red_flag_events_are_read_only(client, strict_schema, officer):
    routes = {(route.path, method) for route in client.app.routes for method in getattr(route, "methods", ())}

    assert not [path for path, method in routes if path.startswith("/api/v1/housing/red-flags/events") or
                (path.startswith("/api/v1/housing/red-flags") and method == "DELETE")]


def test_an_officer_moves_a_regulatory_alert_while_it_has_the_status_they_saw(client, strict_schema, officer):
    response = client.patch(f"{API}/red-flags/alerts/{FLAG}", headers=officer,
                            json={"status": "Escalated", "from_status": "New"})

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "Escalated"
    assert strict_schema.tables["regulatory_red_flags"][0]["status"] == "Escalated"
    [entry] = shared_trail(strict_schema, "regulatory_flag.status_changed")
    assert entry["actor_user_id"] == OFFICER and entry["entity_id"] is None
    assert entry["metadata"] == {"source": "web", "flag_id": FLAG, "from_status": "New", "to_status": "Escalated"}


def test_a_stale_alert_status_changes_nothing(client, strict_schema, officer):
    strict_schema.tables["regulatory_red_flags"][0]["status"] = "Under review"

    response = client.patch(f"{API}/red-flags/alerts/{FLAG}", headers=officer, json={"status": "Closed", "from_status": "New"})

    assert response.status_code == 409
    assert response.json()["detail"] == "This alert is now Under review. Reload the alerts and try again."
    assert strict_schema.tables["regulatory_red_flags"][0]["status"] == "Under review"
    assert shared_trail(strict_schema) == []


def test_asking_again_for_the_alerts_status_changes_nothing(client, strict_schema, officer):
    body = {"status": "Closed", "from_status": "New"}
    client.patch(f"{API}/red-flags/alerts/{FLAG}", headers=officer, json=body)

    again = client.patch(f"{API}/red-flags/alerts/{FLAG}", headers=officer, json=body)

    assert (again.status_code, again.json()["status"]) == (200, "Closed")
    assert len(shared_trail(strict_schema, "regulatory_flag.status_changed")) == 1


@pytest.mark.parametrize("flag_id, body, answer", [
    ("RF-404", {"status": "Closed", "from_status": "New"}, 404),
    (FLAG, {"status": "Archived", "from_status": "New"}, 422),
])
def test_an_unknown_alert_or_status_is_refused(client, strict_schema, officer, flag_id, body, answer):
    assert client.patch(f"{API}/red-flags/alerts/{flag_id}", headers=officer, json=body).status_code == answer
    assert strict_schema.tables["regulatory_red_flags"][0]["status"] == "New"


# ---------------------------------------------------------------------------
# Complaints, reviews and the overview
# ---------------------------------------------------------------------------
def seed_complaints(db, specs) -> None:
    """(category, status, lodged_at, resolved_at, property_id) per complaint, after seed_portal's one."""
    db.seed("complaints", [complaint(numbered("e3100000", number), TENANT, category=category, status=status,
                                     lodged_at=lodged, resolved_at=resolved, property_id=home)
                           for number, (category, status, lodged, resolved, home) in enumerate(specs, start=1)])


def test_complaint_statuses_count_every_complaint_by_category_and_status(client, strict_schema, officer):
    strict_schema.seed("mobile_admin_issue_categories", [issue_category(numbered("e4000000", 2), "SAFETY", "Safety")])
    seed_complaints(strict_schema, [
        ("safety", "OPEN", NOW, None, HOME),  # the web's older lower-case value reads as SAFETY
        ("SAFETY", "RESOLVED", "2026-01-01T00:00:00+00:00", "2026-01-03T00:00:00+00:00", None),
        ("MAINTENANCE", "CLOSED", "2026-01-01T00:00:00+00:00", "2026-01-05T00:00:00+00:00", HOME),
        ("PEST_CONTROL", "IN_REVIEW", NOW, None, None),
    ])

    summary = client.get(f"{API}/complaints", headers=officer).json()

    assert (summary["total"], summary["open"]) == (5, 3)
    assert {row["key"]: row["count"] for row in summary["statuses"]} == \
        {"OPEN": 1, "IN_REVIEW": 1, "ESCALATED": 1, "RESOLVED": 1, "CLOSED": 1}
    categories = {row["code"]: row for row in summary["categories"]}
    assert [row["code"] for row in summary["categories"]] == ["MAINTENANCE", "SAFETY", "PEST_CONTROL"]
    assert (categories["SAFETY"]["label"], categories["SAFETY"]["total"]) == ("Safety", 2)
    assert {row["key"]: row["count"] for row in categories["SAFETY"]["statuses"]}["RESOLVED"] == 1
    assert categories["SAFETY"]["median_days_to_resolve"] == 2.0
    assert categories["PEST_CONTROL"]["label"] == "Pest control"
    assert summary["median_days_to_resolve"] == 3.0


def test_review_figures_rate_only_the_reviews_people_see(strict_schema):
    seed_case(strict_schema)
    # A tenant reviews a home once (reviews_property_id_reviewer_user_id_key): the flagged one is another tenant's.
    other_tenant = numbered("e1000000", 5)
    strict_schema.seed("users", [user(other_tenant, "Theo Tenant")])
    strict_schema.seed("reviews", [
        review(numbered("e9000000", 1), TENANT, OWNER, rating=4, property_id=HOME, is_verified_interaction=True),
        review(numbered("e9000000", 2), other_tenant, OWNER, rating=2, property_id=HOME, status="FLAGGED",
               landlord_rating=1),
        review(numbered("e9000000", 3), TENANT, OWNER, rating=5, status="HIDDEN"),
        review(numbered("e9000000", 4), TENANT, OWNER, rating=3),  # about a provider: no home, no landlord rating
    ])

    figures = housing_portal.review_figures()

    assert (figures["total"], figures["visible"], figures["property_reviews"], figures["verified"]) == (4, 3, 2, 1)
    assert figures["average_rating"] == 3.0
    assert figures["average_landlord_rating"] == 2.5
    assert {row["key"]: row["count"] for row in figures["distribution"]} == {"1": 0, "2": 1, "3": 1, "4": 1, "5": 0}
    assert {row["key"]: row["count"] for row in figures["statuses"]} == \
        {"PUBLISHED": 2, "FLAGGED": 1, "HIDDEN": 1, "ARCHIVED": 0}


def test_the_overview_counts_complaints_reviews_red_flags_and_referrals(client, strict_schema, officer):
    strict_schema.seed("red_flag_events", [event(numbered("e8000000", 2), RULE, HOME, status="RESOLVED")])

    response = client.get(f"{API}/overview", headers=officer)

    assert response.status_code == 200, response.text
    overview = response.json()
    assert (overview["complaints"]["total"], overview["complaints"]["open"]) == (1, 1)
    assert overview["complaints"]["categories"][0]["label"] == "Maintenance"
    assert (overview["reviews"]["total"], overview["reviews"]["average_rating"]) == (1, 2.0)
    assert (overview["red_flags"]["open_events"], overview["red_flags"]["open_alerts"]) == (1, 1)
    assert {row["key"]: row["count"] for row in overview["red_flags"]["events"]}["RESOLVED"] == 1
    assert (overview["referrals"]["total"], overview["referrals"]["open"]) == (1, 1)
    assert {row["key"]: row["label"] for row in overview["referrals"]["statuses"]} == {
        "REFERRED": "New", "UNDER_REVIEW": "Under review", "PACKAGE_READY": "Package ready", "CLOSED": "Closed",
    }


# ---------------------------------------------------------------------------
# Data category requests
# ---------------------------------------------------------------------------
NEW_REQUEST = {"datapoint": "maintenance_categories", "requested_change": "Add Pest control as a repair category.",
               "reason": "Pest complaints are filed under Other."}


@pytest.fixture
def admin(strict_schema, officer):
    return bearer(strict_schema, ADMIN_CALLER, "ada.admin@example.test", "ADMIN", full_name="Ada Admin")


def test_an_officer_asks_for_a_change_and_the_admins_are_told(client, strict_schema, officer, admin):
    response = client.post(f"{API}/datapoint-requests", headers=officer, json=NEW_REQUEST)

    assert response.status_code == 201, response.text
    created = response.json()
    assert (created["officer_id"], created["officer_name"], created["status"]) == (OFFICER, "Olive Officer", "pending")
    assert (created["datapoint"], created["datapoint_label"]) == ("maintenance_categories", "Maintenance categories")
    [row] = requests(strict_schema)
    assert (row["officer_id"], row["requested_change"], row["reason"]) == \
        (OFFICER, NEW_REQUEST["requested_change"], NEW_REQUEST["reason"])
    # Every active admin, the one seed_case made and the one signed in.
    assert sorted(notice["user_id"] for notice in notices(strict_schema)) == sorted(["e1000000-0000-4000-8000-000000000002",
                                                                                       ADMIN_CALLER])
    assert {notice["link"] for notice in notices(strict_schema)} == {"/admin/data-requests"}
    assert [entry["action"] for entry in named_trail(strict_schema)] == ["housing.datapoint_requested"]


def test_sending_the_same_pending_request_again_returns_it(client, strict_schema, officer, admin):
    first = client.post(f"{API}/datapoint-requests", headers=officer, json=NEW_REQUEST)
    again = client.post(f"{API}/datapoint-requests", headers=officer, json={
        **NEW_REQUEST, "requested_change": "  add pest control as a repair   category. "})

    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"]
    assert len(requests(strict_schema)) == 1
    assert len(notices(strict_schema, ADMIN_CALLER)) == 1


def test_another_change_or_another_officer_makes_a_new_request(client, strict_schema, officer):
    other = bearer(strict_schema, OTHER_OFFICER, "otto@example.test", "REGULATOR", full_name="Otto Officer")
    client.post(f"{API}/datapoint-requests", headers=officer, json=NEW_REQUEST)

    assert client.post(f"{API}/datapoint-requests", headers=officer,
                       json={**NEW_REQUEST, "requested_change": "Add Mould."}).status_code == 201
    assert client.post(f"{API}/datapoint-requests", headers=other, json=NEW_REQUEST).status_code == 201
    assert len(requests(strict_schema)) == 3


@pytest.mark.parametrize("over", [
    {"requested_change": "   "},
    {"reason": ""},
    {"datapoint": "listing_prices"},
    {"requested_change": "x" * 1001},
])
def test_a_request_needs_a_known_datapoint_a_change_and_a_reason(client, strict_schema, officer, over):
    response = client.post(f"{API}/datapoint-requests", headers=officer, json={**NEW_REQUEST, **over})

    assert response.status_code == 422
    assert requests(strict_schema) == []


def test_officers_and_admins_see_every_request_newest_first(client, strict_schema, officer, admin):
    other = bearer(strict_schema, OTHER_OFFICER, "otto@example.test", "REGULATOR", full_name="Otto Officer")
    client.post(f"{API}/datapoint-requests", headers=officer, json=NEW_REQUEST)
    client.post(f"{API}/datapoint-requests", headers=other, json={**NEW_REQUEST, "datapoint": "red_flag_rules"})

    for headers, path in ((officer, f"{API}/datapoint-requests"), (admin, "/api/v1/admin/datapoint-requests")):
        listed = client.get(path, headers=headers).json()
        assert [(row["officer_name"], row["datapoint"]) for row in listed] == \
            [("Otto Officer", "red_flag_rules"), ("Olive Officer", "maintenance_categories")]


def test_an_admin_answers_and_the_officer_is_told(client, strict_schema, officer, admin):
    request_id = client.post(f"{API}/datapoint-requests", headers=officer, json=NEW_REQUEST).json()["id"]

    response = client.patch(f"/api/v1/admin/datapoint-requests/{request_id}", headers=admin, json={
        "status": "accepted", "response": "We will add it next sprint.", "from_status": "pending"})

    assert response.status_code == 200, response.text
    answered = response.json()
    assert (answered["status"], answered["admin_response"], answered["responded_by_name"]) == \
        ("accepted", "We will add it next sprint.", "Ada Admin")
    assert answered["responded_at"] is not None
    [row] = requests(strict_schema)
    assert (row["status"], row["responded_by"]) == ("accepted", ADMIN_CALLER)
    [notice] = notices(strict_schema, OFFICER)
    assert (notice["title"], notice["body"], notice["link"]) == \
        ("Your data category request was accepted", "We will add it next sprint.", "/housing/data-requests")
    [entry] = shared_trail(strict_schema, "datapoint_request.answered")
    assert (entry["actor_user_id"], entry["entity_id"]) == (ADMIN_CALLER, request_id)
    # The officer reads the answer in the portal.
    assert client.get(f"{API}/datapoint-requests", headers=officer).json()[0]["admin_response"] == "We will add it next sprint."


def test_an_answer_needs_the_status_the_admin_saw_and_a_request_still_open(client, strict_schema, officer, admin):
    request_id = client.post(f"{API}/datapoint-requests", headers=officer, json=NEW_REQUEST).json()["id"]
    path = f"/api/v1/admin/datapoint-requests/{request_id}"
    stale = client.patch(path, headers=admin, json={"status": "declined", "response": "No.", "from_status": "accepted"})
    done = client.patch(path, headers=admin, json={"status": "completed", "response": "Added.", "from_status": "pending"})
    retried = client.patch(path, headers=admin, json={"status": "completed", "response": "Added.", "from_status": "pending"})
    reopened = client.patch(path, headers=admin, json={"status": "accepted", "response": "Again.", "from_status": "completed"})

    assert (stale.status_code, done.status_code, retried.status_code, reopened.status_code) == (409, 200, 200, 409)
    assert reopened.json()["detail"] == "A request that is completed cannot be accepted."
    assert requests(strict_schema)[0]["status"] == "completed"
    assert len(notices(strict_schema, OFFICER)) == 1
    assert client.patch("/api/v1/admin/datapoint-requests/not-an-id", headers=admin,
                        json={"status": "accepted", "response": "Yes.", "from_status": "pending"}).status_code == 404


# ---------------------------------------------------------------------------
# Housing surveys
# ---------------------------------------------------------------------------
def test_surveys_list_with_their_questions_in_order(client, strict_schema, officer):
    strict_schema.seed("regulatory_survey_questions", [question(2, SURVEY, 3, "Would you rent here again?"),
                                                       question(3, SURVEY, 2, "Was the bond returned?")])

    [shown] = client.get(f"{API}/surveys", headers=officer).json()

    assert (shown["id"], shown["status"], shown["next_status"], shown["closes_at"]) == (SURVEY, "Draft", "Live", "Not scheduled")
    assert [item["text"] for item in shown["questions"]] == [
        "How quickly was your repair done?", "Was the bond returned?", "Would you rent here again?"]


def test_an_officer_creates_a_draft_survey_that_nobody_is_sent(client, strict_schema, officer):
    response = client.post(f"{API}/surveys", headers=officer, json={
        "title": "Bond returns", "audience": "Tenants", "target_responses": 250, "closes_on": "2026-12-01",
        "questions": [" Was your bond returned in full? ", "How long did it take?"]})

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["id"].startswith("SV-") and created["status"] == "Draft"
    assert (created["target_responses"], created["closes_at"], created["responses"]) == (250, "2026-12-01", 0)
    # The snapshot gives the questions no id default: they take the next free ids.
    assert [(item["id"], item["sort_order"], item["text"]) for item in created["questions"]] == [
        (2, 1, "Was your bond returned in full?"), (3, 2, "How long did it take?")]
    assert notices(strict_schema) == []
    assert [entry["action"] for entry in named_trail(strict_schema)] == ["housing.survey_created"]


def test_questions_taken_meanwhile_are_numbered_again(client, strict_schema, officer, monkeypatch):
    real = housing_portal._db

    class Racing:
        """Another survey's question lands with the first free id just before this one's insert."""

        raced = False

        def table(self, name):
            query = real().table(name)
            if name == housing_portal.QUESTIONS and not Racing.raced:
                insert = query.insert

                def racing_insert(rows, **kwargs):
                    if isinstance(rows, list) and rows and "id" in rows[0]:
                        Racing.raced = True
                        real().table(name).insert(question(rows[0]["id"], SURVEY, 9, "Raced in")).execute()
                    return insert(rows, **kwargs)

                query.insert = racing_insert
            return query

    monkeypatch.setattr(housing_portal, "_db", lambda: Racing())

    response = client.post(f"{API}/surveys", headers=officer, json={"title": "Race", "audience": "Tenants",
                                                                     "questions": ["One?"]})

    assert response.status_code == 201, response.text
    assert [item["id"] for item in response.json()["questions"]] == [3]


def test_a_survey_without_its_questions_is_not_kept(client, strict_schema, officer, monkeypatch):
    def fail(survey_id, texts):
        raise APIError({"code": "57014", "message": "canceling statement due to statement timeout"})

    monkeypatch.setattr(housing_portal, "_insert_questions", fail)

    response = client.post(f"{API}/surveys", headers=officer, json={"title": "Gone", "audience": "Tenants",
                                                                     "questions": ["One?"]})

    assert response.status_code == 500
    assert [row["id"] for row in strict_schema.tables["regulatory_surveys"]] == [SURVEY]


def test_a_survey_goes_live_once_then_closes_once(client, strict_schema, officer):
    path = f"{API}/surveys/{SURVEY}"
    live = client.patch(path, headers=officer, json={"status": "Live", "from_status": "Draft"})
    back = client.patch(path, headers=officer, json={"status": "Draft", "from_status": "Live"})
    closed = client.patch(path, headers=officer, json={"status": "Closed", "from_status": "Live"})
    retried = client.patch(path, headers=officer, json={"status": "Closed", "from_status": "Live"})
    reopened = client.patch(path, headers=officer, json={"status": "Live", "from_status": "Closed"})

    assert (live.status_code, back.status_code, closed.status_code, retried.status_code, reopened.status_code) == \
        (200, 409, 200, 200, 409)
    assert (closed.json()["status"], closed.json()["next_status"]) == ("Closed", None)
    assert strict_schema.tables["regulatory_surveys"][0]["status"] == "Closed"
    assert [entry["action"] for entry in named_trail(strict_schema)] == ["housing.survey_status_changed"] * 2


def test_a_stale_or_unknown_survey_changes_nothing(client, strict_schema, officer):
    stale = client.patch(f"{API}/surveys/{SURVEY}", headers=officer, json={"status": "Closed", "from_status": "Live"})
    unknown = client.patch(f"{API}/surveys/SV-404", headers=officer, json={"status": "Live", "from_status": "Draft"})

    assert (stale.status_code, unknown.status_code) == (409, 404)
    assert stale.json()["detail"] == "This survey is now Draft. Reload the surveys and try again."
    assert strict_schema.tables["regulatory_surveys"][0]["status"] == "Draft"


@pytest.mark.parametrize("over", [{"questions": []}, {"questions": ["  "]}, {"title": " "}, {"target_responses": 0}])
def test_a_survey_needs_a_title_and_its_questions(client, strict_schema, officer, over):
    body = {"title": "Bond returns", "audience": "Tenants", "questions": ["Returned?"], **over}

    assert client.post(f"{API}/surveys", headers=officer, json=body).status_code == 422
    assert len(strict_schema.tables["regulatory_surveys"]) == 1


# ---------------------------------------------------------------------------
# De-identified aggregates
# ---------------------------------------------------------------------------
def seed_suburbs(db, counts) -> None:
    """counts: {(suburb, category): n}; one home per suburb, n complaints about it in that category."""
    homes: dict[str, str] = {}
    number = 0
    rows = []
    for (suburb, category), total in counts.items():
        if suburb not in homes:
            homes[suburb] = numbered("e2100000", len(homes) + 1)
            db.seed("properties", [property_row(homes[suburb], OWNER, suburb=suburb, address_line_1=f"{len(homes)} Secret Lane")])
        for _ in range(total):
            number += 1
            rows.append(complaint(numbered("e3200000", number), TENANT, category=category, property_id=homes[suburb],
                                  description="Jo Bloggs at jo@example.test says the heater is broken."))
    db.seed("complaints", rows)


@pytest.fixture
def aggregate_db(strict_schema):
    strict_schema.seed("users", [user(TENANT, "Tess Tenant"), user(OWNER, "Owen Owner", "LANDLORD")])
    strict_schema.seed("mobile_admin_issue_categories", [issue_category(numbered("e4000000", 1), "MAINTENANCE", "Maintenance"),
                                                          issue_category(numbered("e4000000", 2), "SAFETY", "Safety")])
    return strict_schema


def cells(db) -> dict:
    return {(cell["area"], cell["category"]): cell["count"] for cell in housing_portal.aggregates()["cells"]}


def test_aggregates_count_complaints_by_suburb_and_category_and_hide_small_counts(aggregate_db):
    seed_suburbs(aggregate_db, {("Glebe", "MAINTENANCE"): 7, ("Glebe", "SAFETY"): 2, ("Newtown", "MAINTENANCE"): 5,
                                ("Newtown", "SAFETY"): 4, ("Ryde", "SAFETY"): 6})

    result = housing_portal.aggregates()

    assert result["threshold"] == 5 and result["areas"] == 3
    assert cells(aggregate_db) == {("Glebe", "Maintenance"): 7, ("Glebe", "Safety"): None, ("Newtown", "Maintenance"): 5,
                                   ("Newtown", "Safety"): None, ("Ryde", "Safety"): 6}
    assert result["suppressed_cells"] == 2
    assert {cell["state"] for cell in result["cells"]} == {"NSW"}


def test_one_small_count_in_a_category_hides_the_next_smallest_with_it(aggregate_db):
    # The overview shows Safety's total, so a lone hidden 2 would be that total minus the others.
    seed_suburbs(aggregate_db, {("Glebe", "SAFETY"): 2, ("Newtown", "SAFETY"): 9, ("Ryde", "SAFETY"): 6,
                                ("Ryde", "MAINTENANCE"): 8})

    assert cells(aggregate_db) == {("Glebe", "Safety"): None, ("Newtown", "Safety"): 9, ("Ryde", "Safety"): None,
                                   ("Ryde", "Maintenance"): 8}


def test_aggregates_carry_no_names_emails_street_addresses_or_ids(client, aggregate_db):
    seed_suburbs(aggregate_db, {("Glebe", "MAINTENANCE"): 6, ("Newtown", "MAINTENANCE"): 1})
    headers = bearer(aggregate_db, OFFICER, "olive@example.test", "REGULATOR", full_name="Olive Officer")

    response = client.get(f"{API}/aggregates", headers=headers)

    assert response.status_code == 200, response.text
    for private in ("Tess", "Owen", "Bloggs", "@example.test", "Secret Lane", "2037", "e2100000", "e3200000", TENANT):
        assert private not in response.text
    assert set(json.loads(response.text)["cells"][0]) == {"area", "state", "category", "category_code", "count", "suppressed"}


def test_aggregates_group_a_suburb_whatever_its_case_and_leave_out_complaints_without_a_home(aggregate_db):
    seed_suburbs(aggregate_db, {("Glebe", "MAINTENANCE"): 3, ("  glebe ", "MAINTENANCE"): 3})
    aggregate_db.seed("complaints", [complaint(numbered("e3300000", 1), TENANT, category="MAINTENANCE")])

    assert cells(aggregate_db) == {("Glebe", "Maintenance"): 6}
