"""Complaint categories are fixed codes; issue categories are the admins' alert policies (tracker R38).

The forms offer create_general_complaint's five categories, and complaints
keep their codes. mobile_admin_issue_categories rows are alert policies,
listed, saved and switched through the mobile functions run as the admin
(their stand-ins are in tests/fake_rpcs/fa_complaints.py); the web writes
the codes a policy covers, which the save function leaves alone.
"""

import dataclasses

import pytest
from fastapi import HTTPException

from app.services import complaint_categories
from tests.factories import NOW
from tests.factories_admin import bearer, issue_category, named_trail, shared_trail
from tests.factories_reviews_complaints import complaint, seed_rental

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a9000000-0000-4000-8000-000000000001"
TENANT = "b9000000-0000-4000-8000-000000000001"
OWNER = "b9000000-0000-4000-8000-000000000002"
PROPERTY = "c9000000-0000-4000-8000-000000000001"
LISTING = "c9000000-0000-4000-8000-000000000002"
MOULD = "d9000000-0000-4000-8000-000000000001"
NOISE = "d9000000-0000-4000-8000-000000000002"
API = "/api/v1"
POLICIES = f"{API}/admin/complaint-categories"


def uid(number: int) -> str:
    return f"e9000000-0000-4000-8000-{number:012d}"


@pytest.fixture
def people(client, strict_schema):
    headers = {
        "admin": bearer(strict_schema, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin"),
        "tenant": bearer(strict_schema, TENANT, "tia@example.test", full_name="Tia Nguyen"),
        "owner": bearer(strict_schema, OWNER, "oliver@example.test", "LANDLORD", full_name="Oliver Grant"),
    }
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING)
    return headers


@pytest.fixture
def policies(strict_schema, people):
    """Two policies, and complaints that one covers by code and one by a word in its description."""
    strict_schema.seed("mobile_admin_issue_categories", [
        issue_category(MOULD, "mould_damp", "Mould and damp", severity="HIGH", sla_hours=48,
                       source_categories=["PROPERTY_CONDITION", "Noise/Disturbance"], keywords=["mould"],
                       created_at="2026-01-01T00:00:00+00:00"),
        issue_category(NOISE, "noise", "Noise", severity="NORMAL", is_active=False, keywords=["noise"],
                       source_categories=[], created_at="2026-01-02T00:00:00+00:00"),
    ])
    strict_schema.seed("complaints", [
        complaint(uid(1), TENANT, category="PROPERTY_CONDITION", property_id=PROPERTY),
        complaint(uid(2), TENANT, category="OTHER", description="Black mould behind the wardrobe again."),
        complaint(uid(3), TENANT, category="PRIVACY", description="The owner shared my phone number."),
    ])
    return strict_schema


def test_the_forms_offer_the_general_categories(client):
    response = client.get(f"{API}/complaint-categories")

    assert response.status_code == 200, response.text
    assert [(item["code"], item["name"]) for item in response.json()] == [
        ("PROPERTY_CONDITION", "Property condition"), ("LANDLORD_CONDUCT", "Landlord conduct"), ("SAFETY", "Safety"),
        ("PRIVACY", "Privacy"), ("OTHER", "Other")]
    assert all(item["description"] for item in response.json())


def test_a_complaint_keeps_its_code_and_older_values_read_well(client, strict_schema, people):
    strict_schema.seed("complaints", [
        complaint(uid(1), TENANT, category="safety", against_user_id=OWNER, lodged_at="2026-01-03T00:00:00+00:00"),
        complaint(uid(2), TENANT, category="maintenance", against_user_id=OWNER, lodged_at="2026-01-02T00:00:00+00:00"),
        complaint(uid(3), TENANT, category="LANDLORD_CONDUCT", against_user_id=OWNER,
                  lodged_at="2026-01-01T00:00:00+00:00"),
    ])

    listed = client.get(f"{API}/complaints", headers=people["tenant"]).json()

    assert [(item["category"], item["category_label"]) for item in listed] == [
        ("SAFETY", "Safety"), ("maintenance", "Maintenance"), ("LANDLORD_CONDUCT", "Landlord conduct")]


def test_a_repairs_codes_are_named_as_the_mobile_app_names_them():
    labels = complaint_categories.Labels()
    assert labels.category("hvac") == {"code": "HVAC", "label": "Heating & Cooling", "active": False}
    assert labels.category("LOCKS_SECURITY")["label"] == "Locks / Security"
    assert labels.category(None) == {"code": "OTHER", "label": "Other", "active": True}


def test_the_admin_lists_the_policies_through_the_mobile_function(client, policies, people):
    response = client.get(POLICIES, headers=people["admin"])

    assert response.status_code == 200, response.text
    body = response.json()
    # Run as the admin: the function checks who is asking.
    assert policies.rpc_callers[-1] == ("mobile_admin_issue_categories", policies.tokens[people["admin"]["Authorization"][7:]])
    assert [(item["name"], item["is_active"], item["severity_label"], item["complaint_count"]) for item in body["categories"]] == [
        ("Mould and damp", True, "High", 2), ("Noise", False, "Normal", 0)]
    assert body["categories"][0]["source_categories"] == ["PROPERTY_CONDITION", "Noise/Disturbance"]
    assert [item["code"] for item in body["codes"]][:5] == list(complaint_categories.GENERAL_CODES)
    assert {item["code"]: item["kind"] for item in body["codes"]}["SAFETY"] == "both"
    assert {item["code"]: item["kind"] for item in body["codes"]}["LEAK"] == "repair"


def test_the_function_refuses_anyone_but_an_admin(policies, people):
    token = people["tenant"]["Authorization"][7:]

    with pytest.raises(HTTPException) as refused:
        complaint_categories.policies(token)

    assert (refused.value.status_code, refused.value.detail) == (403, "You need admin privileges to access this page.")


def default_source_categories(db, monkeypatch) -> None:
    """mobile_admin_issue_categories.source_categories with the '{}' default the save function's insert relies on.

    The OpenAPI export (app/db/shared_schema.json) records no default for it, but it records none for any jsonb
    or array column, and the catalog snapshot holds no column defaults: both are tested.
    """
    table = db.strict.tables[("public", "mobile_admin_issue_categories")]
    column = table.columns["source_categories"]
    assert column.not_null and column.default is None
    monkeypatch.setitem(table.columns, "source_categories", dataclasses.replace(column, default=("value", [])))


@pytest.mark.parametrize("has_default", [False, True], ids=["no column default", "a '{}' default"])
def test_a_new_policy_takes_its_code_from_its_name_and_covers_the_codes_chosen(client, policies, people, monkeypatch,
                                                                               has_default):
    if has_default:
        default_source_categories(policies, monkeypatch)
    response = client.post(POLICIES, json={
        "name": "Pest control", "description": "Rodents and insects.", "severity": "URGENT", "sla_hours": 24,
        "source_categories": ["leak", "PROPERTY_CONDITION"],
    }, headers=people["admin"])

    assert response.status_code == 201, response.text
    body = response.json()
    # The function's code and keywords (the name's words of 4 letters or more); the web's codes, in order.
    assert (body["code"], body["keywords"], body["severity"], body["sla_hours"]) == (
        "pest_control", ["pest", "control"], "URGENT", 24)
    assert body["source_categories"] == ["PROPERTY_CONDITION", "LEAK"]
    stored = next(row for row in policies.tables["mobile_admin_issue_categories"] if row["code"] == "pest_control")
    assert (stored["created_by"], stored["updated_by"], stored["is_active"]) == (ADMIN, ADMIN, True)
    # The function's own insert leaves out source_categories, which is NOT NULL: with a default it creates the
    # policy; without one it fails with 23502, and the web inserts the row and the function saves it as an edit.
    assert [params["p_category_id"] for name, params in policies.rpc_calls
            if name == "mobile_admin_save_issue_category"] == ([None] if has_default else [None, stored["id"]])
    # The function logged the save; the web logged the codes it wrote.
    assert [(entry["action"], entry["actor_user_id"]) for entry in shared_trail(policies)] == [
        ("SAVE_CATEGORY", ADMIN), ("issue_category.codes_changed", ADMIN)]
    assert [entry["action"] for entry in named_trail(policies)] == ["issue_category.saved", "issue_category.codes_changed"]


def test_a_second_policy_of_the_same_name_gets_its_own_code(client, policies, people):
    first = client.post(POLICIES, json={"name": "Noise", "sla_hours": 24}, headers=people["admin"]).json()

    assert first["code"].startswith("noise_") and len(first["code"]) == len("noise_") + 6


@pytest.mark.parametrize("payload, detail", [
    ({"name": "ab"}, "Enter a category name between 3 and 80 characters."),
    ({"name": "Pests", "routing_team": " x "}, "Enter a routing team between 3 and 80 characters."),
])
def test_the_functions_checks_reach_the_admin_in_its_words(client, policies, people, payload, detail):
    response = client.post(POLICIES, json={"sla_hours": 24, **payload}, headers=people["admin"])

    assert (response.status_code, response.json()["detail"]) == (422, detail)
    assert len(policies.tables["mobile_admin_issue_categories"]) == 2 and not shared_trail(policies)


def test_a_code_from_outside_the_list_is_refused_before_anything_is_saved(client, policies, people):
    response = client.post(POLICIES, json={"name": "Pests", "sla_hours": 24, "source_categories": ["PESTS"]},
                           headers=people["admin"])

    assert (response.status_code, response.json()["detail"]) == (422, "Choose complaint categories from the list.")
    assert not [call for call in policies.rpc_calls if call[0] == "mobile_admin_save_issue_category"]


@pytest.mark.parametrize("sla", [0, 2161])
def test_the_response_time_is_1_to_2160_hours(client, policies, people, sla):
    response = client.post(POLICIES, json={"name": "Pests", "sla_hours": sla}, headers=people["admin"])

    assert response.status_code == 422


def test_an_edit_saves_the_fields_given_and_keeps_the_rest(client, policies, people):
    response = client.patch(f"{POLICIES}/{MOULD}", json={
        "sla_hours": 12, "source_categories": ["SAFETY"], "expected_updated_at": NOW,
    }, headers=people["admin"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["name"], body["severity"], body["sla_hours"], body["keywords"], body["code"]) == (
        "Mould and damp", "HIGH", 12, ["mould"], "mould_damp")
    # Another app's value stays after the codes chosen.
    assert body["source_categories"] == ["SAFETY", "Noise/Disturbance"]
    [(_, params)] = [call for call in policies.rpc_calls if call[0] == "mobile_admin_save_issue_category"]
    assert params == {"p_category_id": MOULD, "p_payload": {
        "name": "Mould and damp", "description": "", "severity": "HIGH", "routingTeam": "Complaint Resolution Team",
        "slaHours": 12, "keywords": ["mould"]}}


def test_an_edit_of_a_version_someone_else_changed_is_refused(client, policies, people):
    response = client.patch(f"{POLICIES}/{MOULD}", json={"sla_hours": 12, "expected_updated_at": "2026-02-01T00:00:00Z"},
                            headers=people["admin"])

    assert response.status_code == 409
    assert not [call for call in policies.rpc_calls if call[0] == "mobile_admin_save_issue_category"]


def test_switching_a_policy_goes_through_the_mobile_function(client, policies, people):
    off = client.post(f"{POLICIES}/{MOULD}/active", json={"is_active": False, "reason": "Merged into Safety"},
                      headers=people["admin"])
    again = client.post(f"{POLICIES}/{MOULD}/active", json={"is_active": False}, headers=people["admin"])

    assert off.status_code == 200 and off.json()["is_active"] is False
    assert again.status_code == 200
    assert [call[0] for call in policies.rpc_calls].count("mobile_admin_toggle_issue_category") == 1
    assert [(entry["action"], entry["summary"]) for entry in shared_trail(policies)] == [
        ("TOGGLE_CATEGORY", "Deactivated Mould and damp.")]
    [web] = named_trail(policies)
    assert (web["action"], web["metadata"]["reason"]) == ("issue_category.deactivated", "Merged into Safety")


def test_an_unknown_policy_is_not_found(client, policies, people):
    for method, path, payload in [
        ("patch", f"{POLICIES}/{uid(99)}", {"name": "Pests", "expected_updated_at": NOW}),
        ("post", f"{POLICIES}/{uid(99)}/active", {"is_active": False}),
        ("post", f"{POLICIES}/not-an-id/active", {"is_active": False}),
    ]:
        assert client.request(method, path, json=payload, headers=people["admin"]).status_code == 404
