"""Admin alerts (tracker R39, R41): mobile_admin_alerts lists them, mobile_admin_escalate_alert refers critical ones.

Both run as the admin (user_client), through their stand-ins in
tests/fake_rpcs/fa_complaints.py: the list first refreshes the alerts from
the unresolved complaints the active policies cover, and the escalation
prepares the Housing Portal referral package.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services import admin_alerts
from tests.factories_admin import bearer, issue_category, named_trail, shared_trail
from tests.factories_identity import account
from tests.factories_reviews_complaints import complaint, seed_rental, user

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "ab000000-0000-4000-8000-000000000001"
OFFICER = "ab000000-0000-4000-8000-000000000002"
TENANT = "bb000000-0000-4000-8000-000000000001"
OWNER = "bb000000-0000-4000-8000-000000000002"
CALLER = "bb000000-0000-4000-8000-000000000003"
PROPERTY = "cb000000-0000-4000-8000-000000000001"
LISTING = "cb000000-0000-4000-8000-000000000002"
POLICY = "db000000-0000-4000-8000-000000000001"
LATE = "eb000000-0000-4000-8000-000000000001"
URGENT = "eb000000-0000-4000-8000-000000000002"
FRESH = "eb000000-0000-4000-8000-000000000003"
ALERTS = "/api/v1/admin/alerts"


def hours_ago(hours: float) -> str:
    """The stand-ins' now() is the real clock, as the database's is."""
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


@pytest.fixture
def db(client, strict_schema):
    strict_schema.seed("users", [user(OWNER, "Oliver Grant", "LANDLORD"),
                                 user(OFFICER, "Olive Officer", "REGULATOR", status="ACTIVE")])
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING)
    strict_schema.seed("mobile_admin_issue_categories", [issue_category(
        POLICY, "property_condition", "Property condition", severity="HIGH", sla_hours=4,
        routing_team="Housing Resolution Team", source_categories=["PROPERTY_CONDITION"], keywords=[],
    )])
    return strict_schema


@pytest.fixture
def admin(db):
    return bearer(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")


def seed_complaints(db, *rows) -> None:
    db.seed("users", [user(TENANT, "Tia Nguyen")]) if not any(u["id"] == TENANT for u in db.tables["users"]) else None
    db.seed("complaints", list(rows))


def test_a_complaint_past_its_policys_response_time_raises_an_alert(client, db, admin):
    seed_complaints(db,
                    complaint(LATE, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY, lodged_at=hours_ago(6),
                              description="The roof leaks into the bedroom."),
                    # No policy covers privacy; lodged 40 days ago, it is not a repeat at the property either.
                    complaint(FRESH, TENANT, category="PRIVACY", property_id=PROPERTY, lodged_at=hours_ago(24 * 40)))

    response = client.get(ALERTS, headers=admin)

    assert response.status_code == 200, response.text
    [alert] = response.json()
    assert (alert["complaint_id"], alert["severity"], alert["status"], alert["category_name"]) == (
        LATE, "HIGH", "OPEN", "Property condition")
    assert alert["reason"] == "The complaint exceeded its configured 4-hour response SLA."
    assert (alert["title"], alert["routing_team"], alert["address"], alert["area"]) == (
        "Property condition", "Housing Resolution Team", "12 Harbour St, Wollongong, NSW, 2500", "Wollongong")
    # Run as the admin; the call refreshed the alerts first.
    token = admin["Authorization"][7:]
    assert db.rpc_callers[-1] == ("mobile_admin_alerts", db.tokens[token])
    assert len(db.tables["mobile_admin_alerts"]) == 1


def test_a_critical_complaint_or_a_pattern_makes_a_critical_alert(client, db, admin):
    seed_complaints(db,
                    complaint(LATE, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY, lodged_at=hours_ago(1)),
                    complaint(URGENT, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY, severity="CRITICAL",
                              lodged_at=hours_ago(2)))

    alerts = {item["complaint_id"]: item for item in client.get(ALERTS, headers=admin).json()}

    # Two open at one property: both are alerts before their response time.
    assert alerts[URGENT]["severity"] == "CRITICAL" and alerts[LATE]["severity"] == "HIGH"
    assert alerts[LATE]["reason"] == "Multiple unresolved complaints were detected for the same property."
    assert alerts[LATE]["property_open_complaints"] == 2
    assert list(alerts) == [URGENT, LATE]  # critical first


def test_an_alert_counted_as_none_open_says_none(client, db, admin):
    # Lodged 40 days ago and past its response time: the refresh counts no open complaint within 30 days, and
    # the list keeps that 0 (coalesce turns only a missing count into 1).
    seed_complaints(db, complaint(LATE, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY,
                                  lodged_at=hours_ago(24 * 40)))

    [alert] = client.get(ALERTS, headers=admin).json()

    snapshot = db.tables["mobile_admin_alerts"][0]["threshold_snapshot"]
    assert (snapshot["propertyOpenComplaints"], snapshot["ownerOpenComplaints"]) == (0, 1)
    assert (alert["property_open_complaints"], alert["owner_open_complaints"]) == (0, 1)


def test_a_resolved_complaints_alert_leaves_the_list(client, db, admin):
    seed_complaints(db, complaint(LATE, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY,
                                  lodged_at=hours_ago(6)))
    assert len(client.get(ALERTS, headers=admin).json()) == 1
    db.tables["complaints"][0].update(status="RESOLVED", resolved_at=hours_ago(0))

    assert client.get(ALERTS, headers=admin).json() == []
    assert db.tables["mobile_admin_alerts"][0]["status"] == "RESOLVED"


@pytest.fixture
def critical(client, db, admin):
    seed_complaints(db, complaint(URGENT, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY,
                                  severity="CRITICAL", lodged_at=hours_ago(6), description="Gas smell in the kitchen."))
    [alert] = client.get(ALERTS, headers=admin).json()
    return alert


def test_a_critical_alert_is_referred_to_the_housing_portal(client, db, admin, critical):
    response = client.post(f"{ALERTS}/{critical['id']}/escalate", json={"note": "  Gas leak not fixed in 6 hours. "},
                           headers=admin)

    assert response.status_code == 200, response.text
    body = response.json()
    reference = "TV-" + critical["id"].replace("-", "")[:10].upper()
    assert (body["status"], body["housing_portal_status"], body["case_reference"], body["escalation_note"]) == (
        "ESCALATED", "REFERRED", reference, "Gas leak not fixed in 6 hours.")
    [package] = db.tables["mobile_admin_referral_packages"]
    assert (package["alert_id"], package["complaint_id"], package["referred_by"]) == (critical["id"], URGENT, ADMIN)
    assert package["prepared_snapshot"]["property"]["address"] == "12 Harbour St, Wollongong, NSW, 2500"
    assert package["prepared_snapshot"]["parties"]["ownerName"] == "Oliver Grant"
    assert [(n["user_id"], n["title"], n["link"]) for n in db.tables["notifications"]] == [
        (OFFICER, "Critical case referred to Housing Portal", "/housing/red-flags")]
    # The function logged it in the shared log; the web's log has it too.
    assert [(entry["action"], entry["actor_user_id"]) for entry in shared_trail(db)] == [("ESCALATE_ALERT", ADMIN)]
    [web] = named_trail(db)
    assert (web["action"], web["metadata"]["case_reference"]) == ("admin_alert.escalated", reference)
    assert [item["status"] for item in client.get(ALERTS, headers=admin).json()] == ["ESCALATED"]


def test_referring_again_updates_the_package_and_tells_the_officers_once(client, db, admin, critical):
    client.post(f"{ALERTS}/{critical['id']}/escalate", json={"note": "First"}, headers=admin)
    again = client.post(f"{ALERTS}/{critical['id']}/escalate", json={"note": "More photos attached"}, headers=admin)

    assert again.status_code == 200, again.text
    [package] = db.tables["mobile_admin_referral_packages"]
    assert package["admin_note"] == "More photos attached"
    assert len([n for n in db.tables["notifications"] if n["user_id"] == OFFICER]) == 1


def test_only_a_critical_alert_is_referred(client, db, admin):
    seed_complaints(db, complaint(LATE, TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY,
                                  lodged_at=hours_ago(6)))
    [alert] = client.get(ALERTS, headers=admin).json()

    response = client.post(f"{ALERTS}/{alert['id']}/escalate", json={}, headers=admin)

    assert response.status_code == 422
    assert response.json()["detail"] == "Only critical alerts can be referred to the Housing Portal for NCAT preparation."
    assert not db.tables.get("mobile_admin_referral_packages") and not named_trail(db)


def test_an_alert_that_is_gone_is_not_found(client, db, admin):
    response = client.post(f"{ALERTS}/{POLICY}/escalate", json={}, headers=admin)

    assert (response.status_code, response.json()["detail"]) == (404, "This alert is no longer available.")


def test_the_functions_refuse_anyone_but_an_admin(db):
    token = account(db, CALLER, "caller@example.test", "TENANT")

    with pytest.raises(HTTPException) as refused:
        admin_alerts.list_alerts(token)

    assert refused.value.status_code == 403


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "REGULATOR"])
@pytest.mark.parametrize("method, path", [("get", ALERTS), ("post", f"{ALERTS}/{POLICY}/escalate")])
def test_every_other_role_is_refused(client, db, primary_role, method, path):
    token = account(db, CALLER, "caller@example.test", primary_role)

    response = client.request(method, path, json={} if method == "post" else None,
                              headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert not db.rpc_calls and not db.tables.get("mobile_admin_alerts")


@pytest.mark.parametrize("method, path", [("get", ALERTS), ("post", f"{ALERTS}/{POLICY}/escalate")])
def test_a_signed_out_caller_is_refused(client, db, method, path):
    assert client.request(method, path, json={} if method == "post" else None).status_code == 401
