"""Complaints on the shared schema: the rows the web writes, and what it lists.

A tenant's complaint about a listing goes through create_general_complaint
(its stand-in in tests/fake_rpcs/fa_complaints.py), which needs an approved
tenancy; a complaint about a member is written by the web, with the same
categories. Regression cover for the shared-schema port: raising a complaint
sent no id (23502), named the listing's creator instead of the property's
owner and wrote to an audit table the shared database lacks, so the case
kept no timeline. Every repair also showed up as a complaint, and the
responses had no resolved_at. Earlier, responding, withdrawing and editing
wrote legacy columns, and a withdrawn complaint (stored as CLOSED) read back
as resolved.
"""

import logging
import uuid
from datetime import datetime

import pytest
from postgrest.exceptions import APIError

from tests.factories_reviews_complaints import application, complaint, events, seed_rental, user, work_order
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

TENANT = "11111111-1111-4111-8111-111111111111"
OWNER = "22222222-2222-4222-8222-222222222222"
ADMIN = "33333333-3333-4333-8333-333333333333"
AGENT = "55555555-5555-4555-8555-555555555555"
COMPLAINT = "44444444-4444-4444-8444-444444444444"
REPAIR = "44444444-4444-4444-8444-444444444445"
WORK_ORDER = "66666666-6666-4666-8666-666666666666"
PROPERTY = "77777777-7777-4777-8777-777777777777"
LISTING = "88888888-8888-4888-8888-888888888888"
API = "/api/v1/complaints"
LATER = "2026-02-01T00:00:00+00:00"
APPLICATION = "99999999-9999-4999-8999-999999999999"
NEIGHBOUR = "12121212-1212-4212-8212-121212121212"


@pytest.fixture
def case(strict_schema):
    """An open complaint by the tenant against the owner, and a repair that is a complaint too."""
    strict_schema.seed("users", [
        user(TENANT, "Tia Nguyen"),
        user(OWNER, "Oliver Grant", "LANDLORD"),
        user(ADMIN, "Ada Admin", "ADMIN"),
        user(AGENT, "Alex Agent", "AGENT"),
    ])
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING, created_by=AGENT, title="Harbour flat")
    strict_schema.seed("complaints", [
        complaint(COMPLAINT, TENANT, against_user_id=OWNER, metadata={"subject": "Broken heater"}),
        complaint(REPAIR, TENANT, description="Water through the kitchen ceiling.", against_user_id=OWNER,
                  property_id=PROPERTY, category="plumbing", metadata={"subject": "Burst pipe"}),
    ])
    strict_schema.seed("maintenance_work_orders", [work_order(WORK_ORDER, REPAIR, TENANT, listing_id=LISTING,
                                                              landlord_user_id=OWNER)])
    # The tenant rents the flat: their application was approved.
    strict_schema.seed("rental_applications", [application(APPLICATION, LISTING, TENANT)])
    return strict_schema


def _stored(db, complaint_id=COMPLAINT) -> dict:
    return next(row for row in db.tables["complaints"] if row["id"] == complaint_id)


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value)


NEW = {"subject": "Mould in the bathroom", "description": "Black mould keeps coming back on the ceiling.",
       "category": "safety", "severity": "HIGH"}


def _notices(db, user_id=OWNER) -> list[tuple]:
    return [(n["title"], n["link"]) for n in db.tables.get("notifications", []) if n["user_id"] == user_id]


@pytest.mark.parametrize("named", [LISTING, PROPERTY])  # the web's property id is the listing's
def test_a_tenants_complaint_about_their_rental_goes_through_create_general_complaint(client, as_profile, case, named):
    as_profile(id=TENANT, role="tenant")
    response = client.post(API, json={**NEW, "property_id": named, "evidence_urls": ["https://example.test/m.jpg"]})

    assert response.status_code == 201, response.text
    body = response.json()
    # The property's owner, not the agent who created the listing.
    assert (body["against_id"], body["against_name"], body["property_title"]) == (OWNER, "Oliver Grant", "Harbour flat")
    assert (body["status"], body["subject"], body["severity"]) == ("open", "Mould in the bathroom", "HIGH")
    assert (body["category"], body["category_label"]) == ("SAFETY", "Safety")
    assert body["created_at"] == body["updated_at"] and body["resolved_at"] is None
    # The function wrote the case, on the service role, with the listing the tenant rents.
    [(name, params)] = [call for call in case.rpc_calls if call[0] == "create_general_complaint"]
    assert case.rpc_callers[-1] == ("create_general_complaint", None)
    assert (params["p_listing_id"], params["p_category"], params["p_severity"]) == (LISTING, "SAFETY", "HIGH")
    stored = _stored(case, body["id"])
    assert uuid.UUID(stored["id"]).version == 4 and stored["id"] == params["p_complaint_id"]
    assert (stored["reporter_user_id"], stored["against_user_id"], stored["property_id"]) == (TENANT, OWNER, PROPERTY)
    assert (stored["status"], stored["category"], stored["severity"]) == ("OPEN", "SAFETY", "HIGH")
    # The function's keys, then the web's.
    assert stored["metadata"] == {"source": "tenant_general_complaint", "listingId": LISTING,
                                  "subject": "Mould in the bathroom", "evidence_urls": ["https://example.test/m.jpg"]}
    [event] = events(case, body["id"])
    assert (event["actor_user_id"], event["event_type"], event["metadata"]) == (TENANT, "LODGED", {"status": "OPEN"})
    assert [step["kind"] for step in body["timeline"]] == ["lodged"]
    # The function told the owner; the web adds no second notice.
    assert _notices(case) == [("New property complaint", "/admin/complaints")]


def test_a_complaint_about_a_property_needs_an_approved_tenancy_there(client, as_profile, case):
    case.tables["rental_applications"][0]["status"] = "SUBMITTED"
    as_profile(id=TENANT, role="tenant")

    response = client.post(API, json={**NEW, "property_id": LISTING})

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "A complaint requires an approved tenancy for this property"
    assert len(case.tables["complaints"]) == 2 and not case.tables.get("complaint_events")
    assert not case.tables.get("notifications")


def test_only_a_tenant_lodges_a_complaint_about_a_property(client, as_profile, case):
    as_profile(id=OWNER, role="landlord")

    response = client.post(API, json={**NEW, "property_id": LISTING})

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Only an active tenant may submit a complaint"
    assert len(case.tables["complaints"]) == 2


@pytest.mark.parametrize("payload, detail", [
    # The function trims spaces first: 5 characters are left.
    ({"description": "    short     "}, "Complaint description must be between 10 and 3000 characters"),
    ({"category": "MAINTENANCE"}, "Choose one of the complaint categories on the form."),
])
def test_a_complaint_the_rules_refuse_writes_nothing(client, as_profile, case, payload, detail):
    as_profile(id=TENANT, role="tenant")

    response = client.post(API, json={**NEW, "property_id": LISTING, **payload})

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == detail
    assert len(case.tables["complaints"]) == 2 and not case.tables.get("complaint_events")


def test_the_form_offers_the_tenants_approved_tenancies(client, as_profile, case):
    as_profile(id=TENANT, role="tenant")
    assert client.get(f"{API}/tenancies").json() == [
        {"listing_id": LISTING, "title": "Harbour flat", "address": "12 Harbour St, Wollongong, NSW, 2500"}]
    as_profile(id=OWNER, role="landlord")
    assert client.get(f"{API}/tenancies").json() == []


def test_a_complaint_about_a_member_is_written_by_the_web(client, as_profile, case):
    case.seed("users", [user(NEIGHBOUR, "Ned Neighbour")])
    as_profile(id=TENANT, role="tenant")

    response = client.post(API, json={**NEW, "category": "PRIVACY", "against_id": NEIGHBOUR})

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["against_id"], body["property_id"], body["category"], body["category_label"]) == (
        NEIGHBOUR, None, "PRIVACY", "Privacy")
    stored = _stored(case, body["id"])
    assert stored["metadata"] == {"source": "web_member_complaint", "subject": "Mould in the bathroom"}
    assert (stored["severity"], stored["status"]) == ("HIGH", "OPEN")
    assert not [call for call in case.rpc_calls if call[0] == "create_general_complaint"]
    [event] = events(case, body["id"])
    assert (event["event_type"], event["metadata"]) == ("LODGED", {"source": "web", "status": "OPEN"})
    assert _notices(case, NEIGHBOUR) == [("A complaint was lodged about you", "/tenant/complaints")]


def test_a_complaint_must_name_someone_else(client, as_profile, case):
    as_profile(id=OWNER, role="landlord")
    assert client.post(API, json={**NEW, "against_id": OWNER}).status_code == 400
    assert client.post(API, json={k: v for k, v in NEW.items()}).status_code == 400
    assert client.post(API, json={**NEW, "property_id": str(uuid.uuid4())}).status_code == 404
    assert client.post(API, json={**NEW, "against_id": str(uuid.uuid4())}).status_code == 404
    assert len(case.tables["complaints"]) == 2 and not case.tables.get("complaint_events")


def test_the_complainant_can_edit_an_open_complaint(client, as_profile, case):
    as_profile(id=TENANT, role="tenant")
    response = client.patch(f"{API}/{COMPLAINT}", json={
        "subject": "Heater still broken", "description": "The heater has now been broken for a month.",
        "evidence_urls": ["https://example.test/heater.jpg"],
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["subject"], body["description"], body["evidence_urls"]) == (
        "Heater still broken", "The heater has now been broken for a month.", ["https://example.test/heater.jpg"],
    )
    assert (body["status"], body["against_name"]) == ("open", "Oliver Grant")

    stored = _stored(case)
    assert stored["metadata"] == {"subject": "Heater still broken", "evidence_urls": ["https://example.test/heater.jpg"],
                                  "revision": 1}
    assert stored["description"] == "The heater has now been broken for a month."
    assert stored["status"] == "OPEN"
    [event] = events(case, COMPLAINT)
    assert (event["actor_user_id"], event["event_type"]) == (TENANT, "UPDATED")
    assert event["metadata"]["fields"] == ["description", "evidence_urls", "subject"]
    assert client.get(f"{API}/{COMPLAINT}").json()["subject"] == "Heater still broken"


def test_an_edit_keeps_to_the_categories_and_the_description_rule(client, as_profile, case):
    as_profile(id=TENANT, role="tenant")

    # Its older value ("maintenance") may stay; another the forms no longer offer may not be chosen.
    kept = client.patch(f"{API}/{COMPLAINT}", json={"category": "MAINTENANCE"})
    refused = client.patch(f"{API}/{COMPLAINT}", json={"category": "HARASSMENT"})
    short = client.patch(f"{API}/{COMPLAINT}", json={"description": "  too short   "})
    changed = client.patch(f"{API}/{COMPLAINT}", json={"category": "privacy", "severity": "LOW"})

    assert (kept.status_code, refused.status_code, short.status_code) == (200, 422, 422)
    assert short.json()["detail"] == "Complaint description must be between 10 and 3000 characters"
    assert changed.status_code == 200, changed.text
    assert (changed.json()["category"], changed.json()["category_label"], changed.json()["severity"]) == (
        "PRIVACY", "Privacy", "LOW")
    stored = _stored(case)
    assert (stored["category"], stored["severity"]) == ("PRIVACY", "LOW")
    assert [event["metadata"]["fields"] for event in events(case, COMPLAINT)] == [["category", "severity"]]


def test_the_respondent_can_respond_and_the_case_moves_to_review(client, as_profile, case):
    as_profile(id=OWNER, role="landlord")
    response = client.post(f"{API}/{COMPLAINT}/respond", json={"response": "A technician is booked for Friday."})
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["response"]) == ("under_review", "A technician is booked for Friday.")
    assert body["responded_at"] and body["complainant_name"] == "Tia Nguyen"
    assert body["updated_at"] == body["responded_at"]

    stored = _stored(case)
    assert stored["status"] == "IN_REVIEW"
    assert stored["metadata"]["response"] == "A technician is booked for Friday."
    assert stored["metadata"]["subject"] == "Broken heater"
    [event] = events(case, COMPLAINT)
    assert (event["actor_user_id"], event["event_type"], event["note"]) == (
        OWNER, "RESPONDED", "A technician is booked for Friday.",
    )
    assert (event["metadata"]["from_status"], event["metadata"]["to_status"]) == ("open", "under_review")

    [listed] = client.get(f"{API}/against-me").json()
    assert (listed["status"], listed["response"]) == ("under_review", "A technician is booked for Friday.")


def test_an_updated_response_replaces_the_first(client, as_profile, case):
    as_profile(id=OWNER, role="landlord")
    client.post(f"{API}/{COMPLAINT}/respond", json={"response": "Booked for Friday."})
    updated = client.post(f"{API}/{COMPLAINT}/respond", json={"response": "Fixed on Friday morning."})
    assert updated.status_code == 200, updated.text
    assert (updated.json()["status"], updated.json()["response"]) == ("under_review", "Fixed on Friday morning.")
    assert _stored(case)["status"] == "IN_REVIEW"
    assert [event["note"] for event in events(case, COMPLAINT)] == ["Booked for Friday.", "Fixed on Friday morning."]
    assert "from_status" not in events(case, COMPLAINT)[1]["metadata"]


def test_a_withdrawn_complaint_reads_back_as_withdrawn(client, as_profile, case):
    as_profile(id=TENANT, role="tenant")
    response = client.patch(f"{API}/{COMPLAINT}/status", json={"status": "dismissed", "resolution_note": None})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "dismissed"
    assert _instant(response.json()["resolved_at"]) == _instant(_stored(case)["resolved_at"])
    assert _stored(case)["status"] == "CLOSED"
    assert [c["status"] for c in client.get(API).json()] == ["dismissed"]
    [event] = events(case, COMPLAINT)
    assert (event["event_type"], event["metadata"]["to_status"]) == ("STATUS_CHANGED", "dismissed")

    as_profile(id=OWNER, role="landlord")
    assert [c["status"] for c in client.get(f"{API}/against-me").json()] == ["dismissed"]


def test_a_moderators_resolution_note_is_kept(client, as_profile, case):
    # An admin decides in the admin console (admin_complaints), which keeps the note as the outcome.
    as_profile(id=ADMIN, role="admin", raw={"id": ADMIN, "status": "ACTIVE"})
    response = client.post(f"/api/v1/admin/complaints/{COMPLAINT}/status",
                           json={"status": "RESOLVED", "note": "Heater replaced."})
    assert response.status_code == 200, response.text
    stored = _stored(case)
    assert stored["status"] == "RESOLVED" and stored["resolved_at"]
    assert stored["metadata"] == {"subject": "Broken heater", "resolution_note": "Heater replaced.", "revision": 1}
    [event] = events(case, COMPLAINT)
    assert (event["actor_user_id"], event["note"], event["metadata"]["from_status"]) == (ADMIN, "Heater replaced.", "OPEN")
    as_profile(id=TENANT, role="tenant")
    shown = client.get(f"{API}/{COMPLAINT}").json()
    assert (shown["status"], shown["resolution_note"]) == ("resolved", "Heater replaced.")
    assert _instant(shown["resolved_at"]) == _instant(stored["resolved_at"])


@pytest.mark.parametrize("account_status", ["ACTIVE", "PENDING_VERIFICATION"])
@pytest.mark.parametrize("change", [{"status": "resolved", "resolution_note": "Done."}, {"status": "dismissed"}])
def test_an_admin_never_decides_or_reads_a_complaint_through_the_parties_routes(client, as_profile, case,
                                                                              account_status, change):
    # The console checks the admin is active, needs a note, logs the decision and tells both parties.
    as_profile(id=ADMIN, role="admin", raw={"id": ADMIN, "status": account_status})

    changed = client.patch(f"{API}/{COMPLAINT}/status", json=change)
    read = client.get(f"{API}/{COMPLAINT}")

    assert (changed.status_code, read.status_code) == (403, 403)
    assert changed.json()["detail"] == "Change a complaint's status from the admin console, where the decision is recorded."
    stored = _stored(case)
    assert (stored["status"], stored["resolved_at"], stored["metadata"]) == ("OPEN", None, {"subject": "Broken heater"})
    assert events(case, COMPLAINT) == []
    assert case.tables.get("notifications", []) == []


def test_only_a_moderator_resolves_and_only_the_complainant_withdraws(client, as_profile, case):
    as_profile(id=TENANT, role="tenant")
    assert client.patch(f"{API}/{COMPLAINT}/status", json={"status": "resolved"}).status_code == 403
    as_profile(id=OWNER, role="landlord")
    assert client.patch(f"{API}/{COMPLAINT}/status", json={"status": "dismissed"}).status_code == 403
    assert _stored(case)["status"] == "OPEN" and not events(case, COMPLAINT)


def test_a_complaint_closed_outside_the_web_app_still_reads_as_resolved(client, as_profile, case):
    _stored(case)["status"] = "CLOSED"
    as_profile(id=TENANT, role="tenant")
    assert [c["status"] for c in client.get(API).json()] == ["resolved"]


def test_repairs_stay_out_of_the_complaint_pages(client, as_profile, case):
    as_profile(id=TENANT, role="tenant")
    assert [c["id"] for c in client.get(API).json()] == [COMPLAINT]
    for method, path, payload in [("get", f"{API}/{REPAIR}", None), ("patch", f"{API}/{REPAIR}", {"subject": "Pipe"}),
                                  ("patch", f"{API}/{REPAIR}/status", {"status": "dismissed"})]:
        assert client.request(method, path, json=payload).status_code == 404
    as_profile(id=OWNER, role="landlord")
    assert [c["id"] for c in client.get(f"{API}/against-me").json()] == [COMPLAINT]
    assert client.post(f"{API}/{REPAIR}/respond", json={"response": "On it."}).status_code == 404
    assert _stored(case, REPAIR)["status"] == "OPEN" and not case.tables.get("complaint_events")


def test_complaints_about_my_properties_reach_me_newest_first(client, as_profile, case):
    on_mine = "44444444-4444-4444-8444-444444444446"
    case.seed("complaints", [complaint(on_mine, TENANT, property_id=PROPERTY, lodged_at=LATER,
                                       metadata={"subject": "Noise"})])
    as_profile(id=OWNER, role="landlord")
    listed = client.get(f"{API}/against-me").json()
    assert [(c["id"], c["property_title"]) for c in listed] == [(on_mine, "Harbour flat"), (COMPLAINT, None)]
    assert client.post(f"{API}/{on_mine}/respond", json={"response": "Spoke to the neighbours."}).status_code == 200


@pytest.fixture
def every_status(case):
    """Besides the open complaint, one in each other stored state."""
    stored = [("in-review", "IN_REVIEW", {}), ("escalated", "ESCALATED", {}), ("resolved", "RESOLVED", {}),
              ("closed", "CLOSED", {}), ("withdrawn", "CLOSED", {"dismissed": True})]
    case.seed("complaints", [
        complaint(str(uuid.uuid5(uuid.NAMESPACE_URL, name)), TENANT, against_user_id=OWNER, status=status,
                  description="A complaint in another state.", metadata={"subject": name, **meta})
        for name, status, meta in stored
    ])
    return case


@pytest.mark.parametrize("path, user_id, role", [(API, TENANT, "tenant"), (f"{API}/against-me", OWNER, "landlord")])
@pytest.mark.parametrize("web_status, subjects", [
    ("open", {"Broken heater"}),
    ("under_review", {"in-review", "escalated"}),
    ("resolved", {"resolved", "closed"}),
    ("dismissed", {"withdrawn"}),
])
def test_the_status_filter_matches_the_status_each_complaint_shows(
    client, as_profile, every_status, path, user_id, role, web_status, subjects
):
    as_profile(id=user_id, role=role)
    assert len(client.get(path).json()) == 6
    response = client.get(path, params={"status": web_status})
    assert response.status_code == 200, response.text
    assert {c["subject"] for c in response.json()} == subjects
    assert {c["status"] for c in response.json()} == {web_status}


def test_a_timeline_entry_that_cannot_be_saved_does_not_fail_the_complaint(client, as_profile, case, monkeypatch,
                                                                           caplog):
    execute = FakeTableQuery.execute

    def failing(query):
        if query._name == "complaint_events":
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout"})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", failing)
    as_profile(id=TENANT, role="tenant")
    with caplog.at_level(logging.ERROR, logger="app.services.complaints"):
        response = client.post(API, json={**NEW, "against_id": OWNER})

    assert response.status_code == 201, response.text
    assert _stored(case, response.json()["id"])["description"] == NEW["description"]
    assert "complaint event LODGED" in caplog.text and "57014" in caplog.text
