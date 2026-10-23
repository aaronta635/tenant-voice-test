"""The owner AI assistant (tracker R29-R31) by direct requests on the strict fake.

The assistant's functions run as the owner, through the stand-ins in
tests/fake_rpcs/fb_owner_ai.py. The model is a stub: no test sends a request.
"""

import copy
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
from postgrest.exceptions import APIError
from pydantic import SecretStr

from app.core.config import settings
from app.services import owner_assistant
from tests import fake_rpcs
from tests.factories import NOW
from tests.factories_identity import account
from tests.fake_supabase import api_error

API = "/api/v1/me/owner-assistant"
LATER = "2030-11-02T09:30:00+11:00"


def uid(name: str) -> str:
    """A stable uuid for a readable test name."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:owner-assistant-tests:{name}"))


OLLY, OTTO, TESS, TOM, PAT = uid("olly"), uid("otto"), uid("tess"), uid("tom"), uid("pat")
APPLICATION, WAITING = uid("application-approved"), uid("application-waiting")
REPAIR = uid("repair")
LABEL = "Applicant " + WAITING[-6:]


def sign_in(db, user_id: str, role: str = "LANDLORD", verification: str = "APPROVED", **over) -> dict:
    token = account(db, user_id, f"{user_id[:8]}@example.test", role, verification_status=verification, **over)
    return {"Authorization": f"Bearer {token}"}


def home(db, owner_id: str, name: str, *, status: str = "PUBLISHED", rent: float = 650,
         suburb: str = "Newtown") -> str:
    """A property of the owner's and its listing; returns the listing id."""
    property_id, listing_id = uid(f"property-{name}"), uid(f"listing-{name}")
    db.seed("properties", [{"id": property_id, "owner_user_id": owner_id, "address_line_1": "7 Private Lane",
                            "suburb": suburb, "state": "NSW", "postcode": "2042", "updated_at": NOW}])
    db.seed("listings", [{"id": listing_id, "property_id": property_id, "created_by_user_id": owner_id, "title": name,
                          "weekly_rent": rent, "status": status, "created_at": NOW, "updated_at": NOW}])
    return listing_id


def applicant(db, user_id: str, listing_id: str, application_id: str, status: str, name: str) -> None:
    account(db, user_id, f"{user_id[:8]}@tenant.test", "TENANT", full_name=name, phone="0412 345 678")
    db.seed("rental_applications", [{"id": application_id, "listing_id": listing_id, "applicant_user_id": user_id,
                                     "status": status, "offer_weekly_rent": 650, "submitted_at": NOW,
                                     "updated_at": NOW}])


def repair(db, listing_id: str, owner_id: str, tenant_id: str, *, status: str = "OPEN",
           description: str = "Water drips from the tap all night.") -> None:
    listing = next(row for row in db.tables["listings"] if row["id"] == listing_id)
    db.seed("complaints", [{"id": REPAIR, "reporter_user_id": tenant_id, "property_id": listing["property_id"],
                            "category": "PLUMBING", "description": description, "severity": "HIGH",
                            "lodged_at": NOW, "metadata": {"mobile": {"issueTitle": "Leaking tap"}}}])
    db.seed("maintenance_work_orders", [{"complaint_id": REPAIR, "listing_id": listing_id, "tenant_user_id": tenant_id,
                                         "landlord_user_id": owner_id, "status": status, "updated_at": NOW}])


@pytest.fixture
def olly(fake_db):
    """A verified owner with a listing, an approved tenant, a waiting applicant and an open repair."""
    headers = sign_in(fake_db, OLLY, full_name="Olly Owner")
    listing = home(fake_db, OLLY, "Harbour flat")
    applicant(fake_db, TESS, listing, APPLICATION, "APPROVED", "Tess Tenant")
    applicant(fake_db, TOM, listing, WAITING, "SUBMITTED", "Tom Hopeful")
    repair(fake_db, listing, OLLY, TESS)
    return SimpleNamespace(headers=headers, listing=listing)


@pytest.fixture
def no_model(monkeypatch):
    """No model key; the list holds every model call (there must be none)."""
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))
    calls = []
    monkeypatch.setattr(owner_assistant, "call_model", lambda payload: calls.append(payload) or {})
    return calls


@pytest.fixture
def model(monkeypatch):
    """A configured key and a stub model: it returns .answer, or raises it when it is an exception."""
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    stub = SimpleNamespace(answer={"reply": "You have one listing.", "action": None}, calls=[])

    def answer(payload):
        stub.calls.append(copy.deepcopy(payload))
        if isinstance(stub.answer, Exception):
            raise stub.answer
        return copy.deepcopy(stub.answer)

    monkeypatch.setattr(owner_assistant, "call_model", answer)
    return stub


def reminder(listing_id: str, **data) -> dict:
    return {"operation": "create_record", "payload": {
        "listingId": listing_id, "kind": "reminder", "title": "Smoke alarm check",
        "data": {"dueAt": LATER, "message": "Test the smoke alarms.", **data},
    }}


def ask(client, headers, question: str, request_id: str | None = None):
    body = {"question": question, **({"request_id": request_id} if request_id else {})}
    return client.post(f"{API}/messages", headers=headers, json=body)


def rows(db, table: str) -> list[dict]:
    return db.tables.get(table, [])


def rpc_names(db) -> list[str]:
    return [name for name, _ in db.rpc_calls]


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------
def test_without_a_model_key_the_rules_answer_from_the_records_and_the_turn_is_saved(client, fake_db, olly, no_model):
    response = ask(client, olly.headers, "How many listings do I have, and any repairs?")

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["source"], body["ai_status"], body["action"]) == ("rules", "not_configured", None)
    assert body["reply"].startswith(owner_assistant.RULES_LABEL)
    assert "You have 1 listing: 1 published." in body["reply"]
    assert "1 repair is open: 'Leaking tap' at Harbour flat (open, high priority" in body["reply"]
    assert no_model == []
    assert rpc_names(fake_db) == ["mobile_owner_assistant_reserve", "mobile_owner_assistant_context",
                                  "mobile_owner_assistant_finish"]
    [turn] = rows(fake_db, "owner_assistant_turns")
    assert (turn["chat_request_id"], turn["reply"]) == (body["request_id"], body["reply"])
    history = client.get(API, headers=olly.headers).json()
    assert [(t["question"], t["reply"]) for t in history["history"]] == [(body["question"], body["reply"])]
    assert history["ai_status"] == "not_configured"


def test_the_rules_cover_rent_applications_and_listing_interest(client, fake_db, olly, no_model):
    fake_db.seed("listing_favorites", [{"user_id": TOM, "listing_id": olly.listing}])
    fake_db.seed("owner_assistant_records", [
        {"id": uid("charge"), "owner_user_id": OLLY, "listing_id": olly.listing, "recipient_user_id": TESS,
         "kind": "charge", "title": "Rent 1-7 Oct", "status": "recorded",
         "payload": {"amount": 650, "dueDate": "2026-10-01", "currency": "AUD"}, "created_at": NOW, "updated_at": NOW},
        {"id": uid("payment"), "owner_user_id": OLLY, "listing_id": olly.listing, "recipient_user_id": TESS,
         "kind": "payment", "title": "Part payment", "status": "recorded",
         "payload": {"amount": 200, "date": "2026-10-02", "chargeId": uid("charge")}, "created_at": NOW, "updated_at": NOW},
    ])

    rent = ask(client, olly.headers, "Is any rent overdue?").json()["reply"]
    applications = ask(client, olly.headers, "Compare my applications").json()["reply"]
    interest = ask(client, olly.headers, "Which listing performs best? Favourites?").json()["reply"]

    assert "The rent ledger has no charges for your active tenancies yet." in rent
    assert "1 charge, $650 charged, $200 paid and $450 outstanding" in rent
    assert "Overdue: 'Rent 1-7 Oct' at Harbour flat, $450 due 1 Oct 2026" in rent
    assert "2 applications: 1 approved, 1 submitted." in applications
    assert f"The longest waiting is {LABEL}" in applications
    assert "never chooses an applicant" in applications
    assert "Tom" not in applications
    assert "Harbour flat (published): 1 favourite, 2 applications" in interest


def ledger_charge(db, listing_id: str, due: str = "2026-10-02", amount: int = 650) -> None:
    """An ACTIVE weekly tenancy of Tess's with one ISSUED charge and no receipt (the R27 rent ledger).

    The charge is the week from its due date: a period ends after it starts (valid_rent_period).
    """
    agreement = uid("agreement")
    db.seed("rent_agreements", [{"id": agreement, "application_id": APPLICATION, "listing_id": listing_id,
                                 "tenant_user_id": TESS, "owner_user_id": OLLY, "rent_amount": amount,
                                 "rent_frequency": "WEEKLY", "start_date": due, "first_due_date": due,
                                 "status": "ACTIVE", "activated_at": NOW}])
    week_end = (date.fromisoformat(due) + timedelta(days=6)).isoformat()
    db.seed("rent_charges", [{"id": uid(f"ledger-charge-{due}"), "agreement_id": agreement, "period_start": due,
                              "period_end": week_end, "due_date": due, "amount_due": amount, "status": "ISSUED",
                              "issued_at": NOW}])


def test_rent_answers_come_from_the_owners_rent_ledger(client, fake_db, olly, no_model):
    ledger_charge(fake_db, olly.listing)

    reply = ask(client, olly.headers, "Is any rent overdue?").json()["reply"]

    assert ("Rent ledger (your active tenancies): 1 charge, $650 due, $0 received and $650 outstanding. "
            "Overdue: Harbour flat, $650 due 2 Oct 2026.") in reply
    assert "No rent charges are recorded" not in reply


def test_the_model_reads_the_rent_ledger_without_tenant_names(client, fake_db, olly, model):
    ledger_charge(fake_db, olly.listing)

    ask(client, olly.headers, "Is any rent overdue?")

    [payload] = model.calls
    assert (payload["rent"]["charges"], payload["rent"]["overdue"]) == (1, 650)
    assert payload["rent"]["overdueCharges"] == [{"chargeId": uid("ledger-charge-2026-10-02"), "listingId": olly.listing,
                                                  "listingTitle": "Harbour flat", "dueDate": "2026-10-02",
                                                  "outstanding": 650}]
    assert payload["assistantRent"]["charges"] == 0
    assert "Tess" not in json.dumps(payload)


def test_a_charge_the_assistant_records_says_the_ledger_will_not_show_it(client, fake_db, olly, model):
    model.answer = {"reply": "Ready to record it.", "action": {"operation": "create_record", "payload": {
        "listingId": olly.listing, "kind": "charge", "title": "Rent 1-7 Nov", "recipientId": TESS,
        "data": {"amount": 650, "dueDate": "2030-11-01"}}}}

    notes = ask(client, olly.headers, "Record Tess's rent for next week").json()["action"]["preview"]["notes"]

    assert "It stays in the assistant's records: the rent ledger does not show it." in notes


def test_the_model_answers_from_records_without_tenant_names_addresses_or_contact_details(client, fake_db, model):
    headers = sign_in(fake_db, OLLY)
    listing = home(fake_db, OLLY, "Harbour flat")
    applicant(fake_db, TESS, listing, APPLICATION, "APPROVED", "Tess Tenant")
    repair(fake_db, listing, OLLY, TESS, description="Tess here: call me on 0412 345 678 or tess@tenant.test about the tap.")
    model.answer = {"reply": "One repair is open: the leaking tap at Harbour flat.", "action": None}

    response = ask(client, headers, "Any repairs? Text me on 0400 111 222.")

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["source"], body["ai_status"], body["reply"]) == ("ai", "applied", model.answer["reply"])
    sent = json.dumps(model.calls)
    for private in ("Tess", "0412 345 678", "tess@tenant.test", "7 Private Lane", f"{TESS[:8]}@tenant.test"):
        assert private not in sent
    [payload] = model.calls
    assert payload["question"] == "Any repairs? Text me on [phone]."
    assert payload["repairs"][0]["description"] == "[tenant] here: call me on [phone] or [email] about the tap."
    assert payload["tenants"] == [{"recipientId": TESS, "applicant": "Applicant " + APPLICATION[-6:],
                                   "listingId": listing, "approved": True}]
    assert set(payload["operations"]) == set(owner_assistant.OPERATIONS)


def test_a_large_portfolio_still_reaches_the_model_within_its_input_limit(client, fake_db, olly, model):
    """15 listings, 40 applications, 12 repairs and 25 records measured 38 kB; the client refuses over 32 kB."""
    context = {
        "ownerId": OLLY, "recipients": [],
        "properties": [{"id": uid(f"l{i}"), "title": f"Flat {i} with a long descriptive title for the listing",
                        "suburb": "Newtown", "state": "NSW", "rent": 650, "status": "PUBLISHED", "createdAt": NOW,
                        "updatedAt": NOW, "publishedAt": NOW, "favorites": 3, "applicationCount": 4} for i in range(15)],
        "applications": [{"id": uid(f"a{i}"), "listingId": uid(f"l{i % 15}"), "applicantLabel": f"Applicant {i:06x}",
                          "status": "SUBMITTED", "submittedAt": NOW} for i in range(40)],
        "complaints": [{"id": uid(f"c{i}"), "listingId": uid(f"l{i}"), "title": "Leaking tap in the bathroom",
                        "description": "Water drips from the tap all night. " * 22, "category": "PLUMBING",
                        "severity": "HIGH", "status": "OPEN", "lodgedAt": NOW, "appointmentAt": None} for i in range(12)],
        "workspace": {"records": [{"id": uid(f"r{i}"), "listing_id": uid(f"l{i % 15}"), "recipient_user_id": None,
                                   "kind": "reminder", "title": f"Reminder number {i} about the smoke alarms",
                                   "status": "pending", "created_at": NOW,
                                   "payload": {"dueAt": LATER, "message": "x" * 200}} for i in range(25)]},
    }
    fake_db.rpc_results["mobile_owner_assistant_context"] = context
    limit = owner_assistant.provider_recommendations.MAX_INPUT_BYTES

    body = ask(client, olly.headers, "How are my listings doing?").json()

    assert (body["source"], body["ai_status"]) == ("ai", "applied")
    [payload] = model.calls
    assert len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) <= limit
    assert "Some lists were cut to fit" in payload["shortened"]
    assert len(payload["listings"]) == 15  # cut last


def test_street_addresses_in_free_text_do_not_reach_the_model(client, fake_db, model):
    headers = sign_in(fake_db, OLLY)
    listing = home(fake_db, OLLY, "Harbour flat")
    applicant(fake_db, TESS, listing, APPLICATION, "APPROVED", "Tess Tenant")
    repair(fake_db, listing, OLLY, TESS, description="The tap at Unit 4/12 Smith Street, Newtown leaks, as at 7 private lane.")

    ask(client, headers, "Is the repair at 7 Private Lane done? And 3A Harbour Rd?")

    [payload] = model.calls
    assert payload["repairs"][0]["description"] == "The tap at [address], Newtown leaks, as at [address]."
    assert payload["question"] == "Is the repair at [address] done? And [address]?"
    assert "Smith Street" not in json.dumps(payload) and "Private Lane" not in json.dumps(payload)


def test_an_unverified_owner_gets_the_rules_answer_and_the_refusal_without_the_model(client, fake_db, model):
    headers = sign_in(fake_db, OLLY, verification="PENDING")
    home(fake_db, OLLY, "Harbour flat")

    response = ask(client, headers, "How many listings do I have?")

    body = response.json()
    assert response.status_code == 200, response.text
    assert (body["source"], body["ai_status"]) == ("rules", "verification_required")
    assert body["verification"]["code"] == "verification_required"
    assert model.calls == []
    assert client.get(API, headers=headers).json()["ai_status"] == "verification_required"


@pytest.mark.parametrize("answer", [
    {"reply": "Done.", "action": {"operation": "delete_everything", "payload": {}}},
    {"reply": "Here it is.", "action": {"operation": "create_record", "payload": {"listingId": "not-a-uuid"}}},
    {"reply": "Draft below.", "action": {"operation": "create_listing", "payload": {
        "title": "Flat", "price": 500, "address": "1 Way", "suburb": "Ryde", "sneaky": True}}},
    {"reply": "Publishing it.", "action": {"operation": "create_listing", "payload": {
        "title": "Flat", "price": 500, "address": "1 Way", "suburb": "Ryde", "publish": True}}},
    {"reply": "I have created the reminder for you.", "action": None},
    {"reply": "Done: your smoke alarm reminder has been set for Saturday.", "action": None},
    {"reply": "Your smoke alarm reminder has now been scheduled.", "action": None},
    {"reply": "The listing is now published.", "action": None},
    {"reply": f"I recommend {LABEL}, the best choice.", "action": None},
    {"reply": "Approve them.", "action": {"operation": "application_decision", "payload": {
        "applicationId": WAITING, "decision": "approved"}}},
    {"answer": "no reply key"},
    ["not", "an", "object"],
    httpx.ConnectTimeout("the model timed out"),
    ValueError("Incomplete model response"),
], ids=["unknown operation", "bad id", "extra key", "published listing", "claims an action", "says done",
        "claims it in the passive", "claims a new state", "chooses an applicant",
        "decision the owner did not make", "wrong shape", "not an object", "timeout", "incomplete"])
def test_invalid_or_unknown_model_output_fails_safely(client, fake_db, olly, model, answer):
    model.answer = answer

    response = ask(client, olly.headers, "Remind me to check the smoke alarms")

    body = response.json()
    assert response.status_code == 200, response.text
    assert (body["source"], body["ai_status"], body["action"]) == ("rules", "unavailable", None)
    assert body["reply"].startswith(owner_assistant.RULES_LABEL)
    assert len(model.calls) == 1
    assert rows(fake_db, "owner_assistant_records") == []
    [request] = rows(fake_db, "owner_assistant_requests")
    assert request["result"] == {"reply": body["reply"]}


def test_booking_a_repair_visit_is_never_offered_as_an_owner_cannot_confirm_it(client, fake_db, olly, model):
    # mobile_schedule_repair runs update_maintenance_work_order(..., 'schedule'): the assigned provider's step.
    model.answer = {"reply": "Ready to book the plumber.", "action": {"operation": "schedule_maintenance", "payload": {
        "complaintId": REPAIR, "startsAt": LATER, "durationMinutes": 60}}}

    body = ask(client, olly.headers, "Book the plumber for the leaking tap on Saturday").json()

    assert (body["source"], body["action"]) == ("rules", None)
    assert "schedule_maintenance" not in model.calls[0]["operations"]
    assert "schedule_maintenance" not in owner_assistant.SCHEMAS


def test_another_owners_listing_in_a_proposal_fails_safely(client, fake_db, olly, model):
    otto = sign_in(fake_db, OTTO)
    home(fake_db, OTTO, "Otto's house")
    model.answer = {"reply": "A reminder is ready for you to confirm.", "action": reminder(olly.listing)}

    body = ask(client, otto, "Remind me about the smoke alarms").json()

    assert (body["source"], body["action"]) == ("rules", None)
    assert rows(fake_db, "owner_assistant_records") == []


def test_a_decision_the_owner_names_is_proposed_for_that_applicant(client, fake_db, olly, model):
    model.answer = {"reply": "This marks the application approved once you confirm.", "action": {
        "operation": "application_decision", "payload": {"applicationId": WAITING, "decision": "approved"}}}

    body = ask(client, olly.headers, f"Approve {LABEL}").json()

    assert body["source"] == "ai"
    assert body["action"]["preview"]["title"] == f"Mark {LABEL} as approved"
    assert {"label": "Application", "value": f"{LABEL} for Harbour flat"} in body["action"]["preview"]["changes"]


def test_an_approval_preview_names_the_lease_and_the_applications_it_rejects(client, fake_db, olly, model):
    applicant(fake_db, uid("tina"), olly.listing, uid("application-other"), "UNDER_REVIEW", "Tina Hopeful")
    model.answer = {"reply": "This approves the application once you confirm.", "action": {
        "operation": "application_decision", "payload": {"applicationId": WAITING, "decision": "approved"}}}

    preview = ask(client, olly.headers, f"Approve {LABEL}").json()["action"]["preview"]

    assert {"label": "Listing status", "value": "Leased (now published)"} in preview["changes"]
    assert {"label": "Other applications", "value": "1 waiting application on this listing: rejected, and its "
                                                    "applicant told the home is no longer available"} in preview["changes"]
    assert "Approving leases the home: it stops taking applications." in preview["notes"]


@pytest.mark.parametrize("question, decision, application_status, listing_status", [
    (f"Approve {LABEL}", "approved", "SUBMITTED", "PAUSED"),
    (f"Shortlist {LABEL}", "shortlisted", "SHORTLISTED", "PUBLISHED"),
], ids=["listing not open for approval", "the status it has"])
def test_a_decision_the_database_would_refuse_or_ignore_is_not_proposed(client, fake_db, olly, model, question,
                                                                       decision, application_status, listing_status):
    next(row for row in fake_db.tables["rental_applications"] if row["id"] == WAITING)["status"] = application_status
    next(row for row in fake_db.tables["listings"] if row["id"] == olly.listing)["status"] = listing_status
    model.answer = {"reply": "Ready once you confirm.", "action": {
        "operation": "application_decision", "payload": {"applicationId": WAITING, "decision": decision}}}

    body = ask(client, olly.headers, question).json()

    assert (body["source"], body["action"]) == ("rules", None)


# ---------------------------------------------------------------------------
# Actions: preview, cancel, confirm
# ---------------------------------------------------------------------------
def test_a_proposed_action_is_a_preview_of_every_change_and_writes_nothing(client, fake_db, olly, model):
    model.answer = {"reply": "Here is a reminder to review.", "action": reminder(olly.listing)}

    response = ask(client, olly.headers, "Remind me to check the smoke alarms")

    assert response.status_code == 200, response.text
    action = response.json()["action"]
    assert action["operation"] == "create_record"
    assert action["payload"] == reminder(olly.listing)["payload"]
    assert action["preview"] == {
        "title": "Create a reminder for Harbour flat",
        "changes": [{"label": "Title", "value": "Smoke alarm check"}, {"label": "For", "value": "you"},
                    {"label": "Due", "value": "Sat 2 Nov 2030, 9:30 am (Sydney time)"},
                    {"label": "Message", "value": "Test the smoke alarms."}],
        "notes": [], "demo": "in-app reminder only; no email or SMS is sent",
    }
    # Nothing but the chat turn: the record waits for the owner's confirm (a cancel sends nothing).
    assert rows(fake_db, "owner_assistant_records") == []
    [request] = rows(fake_db, "owner_assistant_requests")
    assert request["operation"] == "ai_chat"
    assert request["result"]["action"] == reminder(olly.listing)


def test_confirming_runs_the_saved_action_and_returns_the_record_and_the_receipt(client, fake_db, olly, model):
    model.answer = {"reply": "Here is a reminder to review.", "action": reminder(olly.listing)}
    chat = ask(client, olly.headers, "Remind me to check the smoke alarms").json()["request_id"]

    response = client.post(f"{API}/messages/{chat}/confirm", headers=olly.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    action_id = owner_assistant.action_request_id(OLLY, chat)
    [record] = rows(fake_db, "owner_assistant_records")
    assert (body["message"], body["receipt"], body["action_request_id"]) == ("Reminder saved.", action_id, action_id)
    assert body["record"]["id"] == record["id"]
    assert (record["kind"], record["status"], record["recipient_user_id"]) == ("reminder", "pending", OLLY)
    assert {"label": "Status", "value": "Pending"} in body["saved"]
    assert body["reply"] == f"Reminder saved. Receipt: {action_id}"
    [turn] = rows(fake_db, "owner_assistant_turns")
    assert turn["reply"] == body["reply"]
    action_call = next(params for name, params in fake_db.rpc_calls if name == "mobile_owner_assistant_action")
    assert action_call == {"p_request": action_id, "p_operation": "create_record",
                           "p_payload": reminder(olly.listing)["payload"], "p_confirmed": True}
    assert rpc_names(fake_db)[-1] == "mobile_owner_assistant_receipt"


def test_a_retried_confirm_returns_the_first_result_without_acting_twice(client, fake_db, olly, model):
    model.answer = {"reply": "Here is a reminder to review.", "action": reminder(olly.listing)}
    chat = ask(client, olly.headers, "Remind me to check the smoke alarms").json()["request_id"]

    first = client.post(f"{API}/messages/{chat}/confirm", headers=olly.headers).json()
    again = client.post(f"{API}/messages/{chat}/confirm", headers=olly.headers)

    assert again.status_code == 200, again.text
    assert again.json()["record"] == first["record"]
    assert len(rows(fake_db, "owner_assistant_records")) == 1


def test_a_confirmed_listing_draft_is_saved_and_shows_after_reload(client, fake_db, olly, model):
    model.answer = {"reply": "A draft is ready to review.", "action": {"operation": "create_listing", "payload": {
        "title": "Garden studio", "price": 480, "address": "2 Garden Row", "suburb": "Marrickville",
        "propertyType": "studio", "bedrooms": 1, "availableFrom": "2030-12-01", "publish": False}}}
    chat = ask(client, olly.headers, "Draft a listing for my garden studio").json()

    assert {"label": "Weekly rent", "value": "$480 a week"} in chat["action"]["preview"]["changes"]
    assert "publish" not in chat["action"]["payload"]
    confirmed = client.post(f"{API}/messages/{chat['request_id']}/confirm", headers=olly.headers)

    assert confirmed.status_code == 200, confirmed.text
    listing = confirmed.json()["record"]
    assert (listing["title"], listing["listingStatus"], listing["ownerId"]) == ("Garden studio", "DRAFT", OLLY)
    titles = {row["title"]: row["status"] for row in client.get(API, headers=olly.headers).json()["context"]["properties"]}
    assert titles == {"Harbour flat": "PUBLISHED", "Garden studio": "DRAFT"}


def test_an_out_of_date_suggestion_is_refused_and_changes_nothing(client, fake_db, olly, model):
    model.answer = {"reply": "Ready to mark it resolved.", "action": {
        "operation": "resolve_complaint", "payload": {"complaintId": REPAIR}}}
    chat = ask(client, olly.headers, "Mark the leaking tap resolved").json()["request_id"]
    fake_db.tables["maintenance_work_orders"][0]["status"] = "RESOLVED"

    response = client.post(f"{API}/messages/{chat}/confirm", headers=olly.headers)

    assert response.status_code == 409
    assert response.json()["detail"] == "This suggestion is out of date: the repair is resolved."
    assert "mobile_owner_assistant_action" not in rpc_names(fake_db)


def test_a_listing_edited_after_the_preview_is_not_overwritten_by_the_confirm(client, fake_db, olly, model):
    model.answer = {"reply": "Ready to raise the rent.", "action": {"operation": "update_property", "payload": {
        "listingId": olly.listing, "changes": {"price": 700}}}}
    chat = ask(client, olly.headers, "Raise the rent of Harbour flat to $700").json()
    assert {"label": "Weekly rent", "value": "$700 a week (now $650 a week)"} in chat["action"]["preview"]["changes"]
    assert "basis" not in chat["action"]
    listing = next(row for row in fake_db.tables["listings"] if row["id"] == olly.listing)
    listing.update(weekly_rent=680, updated_at=(datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat())
    fake_db.rpc_results["mobile_update_property"] = {"id": olly.listing, "title": "Harbour flat", "rent": 700}

    response = client.post(f"{API}/messages/{chat['request_id']}/confirm", headers=olly.headers)

    assert response.status_code == 409
    assert response.json()["detail"] == ("This suggestion is out of date: what it changes was edited after it was "
                                         "suggested. Ask again for a new one.")
    assert "mobile_owner_assistant_action" not in rpc_names(fake_db)
    assert listing["weekly_rent"] == 680


def test_a_failed_action_passes_its_message_through_and_writes_nothing(client, fake_db, olly, model, monkeypatch):
    def refuse(ctx, params):
        raise api_error("42501", "Repairs can only be logged for one of your homes with a current tenant.")

    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_owner_create_repair", refuse)
    model.answer = {"reply": "Ready to log it.", "action": {"operation": "create_maintenance", "payload": {
        "listingId": olly.listing, "issueTitle": "Broken heater", "description": "The heater does not turn on.",
        "category": "HVAC", "priority": "high"}}}
    chat = ask(client, olly.headers, "Log a repair for the heater").json()["request_id"]

    response = client.post(f"{API}/messages/{chat}/confirm", headers=olly.headers)

    assert response.status_code == 403
    assert response.json()["detail"] == "Repairs can only be logged for one of your homes with a current tenant."
    assert [r["operation"] for r in rows(fake_db, "owner_assistant_requests")] == ["ai_chat"]
    assert rows(fake_db, "owner_assistant_turns")[0]["reply"] == "Ready to log it."


def test_another_owner_cannot_confirm_an_answer_they_did_not_get(client, fake_db, olly, model):
    otto = sign_in(fake_db, OTTO)
    model.answer = {"reply": "Here is a reminder to review.", "action": reminder(olly.listing)}
    chat = ask(client, olly.headers, "Remind me to check the smoke alarms").json()["request_id"]

    response = client.post(f"{API}/messages/{chat}/confirm", headers=otto)

    assert response.status_code == 404
    assert rows(fake_db, "owner_assistant_records") == []


def test_confirming_needs_a_verified_owner_and_an_answer_with_an_action(client, fake_db, olly, model):
    chat = ask(client, olly.headers, "Any repairs?").json()["request_id"]
    pending = sign_in(fake_db, OTTO, verification="PENDING")

    assert client.post(f"{API}/messages/{chat}/confirm", headers=olly.headers).status_code == 404
    refused = client.post(f"{API}/messages/{uuid.uuid4()}/confirm", headers=pending)
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "verification_required"


@pytest.mark.parametrize("method, path", [("get", ""), ("post", "/messages"), ("post", f"/messages/{uid('x')}/confirm")])
def test_tenants_and_providers_cannot_use_the_owner_assistant(client, fake_db, method, path):
    for user_id, role in ((TESS, "TENANT"), (PAT, "SERVICE_PROVIDER")):
        headers = sign_in(fake_db, user_id, role)
        response = getattr(client, method)(f"{API}{path}", headers=headers,
                                           **({"json": {"question": "Hi"}} if method == "post" else {}))
        assert response.status_code == 403, (role, response.text)
    assert fake_db.rpc_calls == []


# ---------------------------------------------------------------------------
# Request ids and limits
# ---------------------------------------------------------------------------
def test_a_replayed_request_id_returns_the_saved_answer_without_asking_again(client, fake_db, olly, model):
    model.answer = {"reply": "Here is a reminder to review.", "action": reminder(olly.listing)}
    request_id = str(uuid.uuid4())

    first = ask(client, olly.headers, "Remind me to check the smoke alarms", request_id).json()
    again = ask(client, olly.headers, "Remind me to check the smoke alarms", request_id).json()

    assert (again["cached"], again["reply"], again["action"]) == (True, first["reply"], first["action"])
    assert len(model.calls) == 1
    assert len(rows(fake_db, "owner_assistant_turns")) == 1


def test_a_replayed_answer_keeps_its_question_and_the_provider_it_names(client, fake_db, olly, model):
    provider(fake_db, PAT, "Harbour Plumbing")
    model.answer = {"reply": "Ready to message them.", "action": {"operation": "send_proposal", "payload": {
        "listingId": olly.listing, "recipientId": PAT, "title": "Tap repair", "data": {"message": "Can you fix a tap?"}}}}
    request_id = str(uuid.uuid4())

    first = ask(client, olly.headers, "Message a plumber about the leaking tap in Newtown", request_id).json()
    again = ask(client, olly.headers, "Something else entirely", request_id).json()

    assert first["action"]["preview"]["changes"][0] == {"label": "To", "value": "Harbour Plumbing"}
    assert again["cached"] is True
    assert again["question"] == "Message a plumber about the leaking tap in Newtown"
    assert again["action"]["preview"] == first["action"]["preview"]
    assert len(model.calls) == 1


def test_the_databases_request_limit_answers_429_and_saves_nothing(client, fake_db, olly, no_model):
    now = datetime.now(timezone.utc)
    fake_db.seed("owner_assistant_requests", [{
        "owner_user_id": OLLY, "request_id": str(uuid.uuid4()), "operation": "ai_chat", "payload": {},
        "result": {"reply": "Earlier."}, "created_at": (now - timedelta(seconds=index)).isoformat(),
    } for index in range(10)])

    response = ask(client, olly.headers, "Any repairs?")

    assert response.status_code == 429
    assert response.json()["detail"] == "AI request limit reached. Please wait before asking again."
    assert len(rows(fake_db, "owner_assistant_requests")) == 10


# ---------------------------------------------------------------------------
# Provider suggestions (R31)
# ---------------------------------------------------------------------------
def provider(db, user_id: str, name: str, *, verification: str = "APPROVED", status: str = "ACTIVE",
             public: bool = True, rate: str | None = "95", ratings: tuple = (5, 4),
             published: bool | None = None, categories: tuple = ("PLUMBING",)) -> None:
    account(db, user_id, f"{user_id[:8]}@trade.test", "SERVICE_PROVIDER", verification_status=verification,
            status=status, metadata={"mobile": {"privacySettings": {"publicProfile": public}}})
    # The web's publish flag; a provider from the mobile app has none.
    flag = {} if published is None else {"is_published": published}
    # An admin's decision sets the account's and the profile's verification together.
    db.seed("service_provider_profiles", [{"user_id": user_id, "company_name": name, "service_categories": list(categories),
                                           "service_area": "Newtown, Enmore", "metadata": {"hourlyRate": rate, **flag},
                                           "verification_status": verification, "updated_at": NOW}])
    db.seed("reviews", [{"id": uid(f"review-{name}-{index}"), "reviewer_user_id": TESS, "reviewed_user_id": user_id,
                         "rating": rating, "landlord_rating": rating, "status": "PUBLISHED", "updated_at": NOW}
                        for index, rating in enumerate(ratings)])


def test_provider_suggestions_come_from_the_provider_search_with_their_facts(client, fake_db, olly, no_model):
    provider(fake_db, PAT, "Harbour Plumbing")
    provider(fake_db, uid("unverified"), "New Pipes", verification="PENDING")
    provider(fake_db, uid("private"), "Quiet Plumbing", public=False)
    provider(fake_db, uid("suspended"), "Gone Plumbing", status="SUSPENDED")

    body = ask(client, olly.headers, "Find a plumber for the leaking tap in Newtown").json()

    assert [p["name"] for p in body["providers"]] == ["Harbour Plumbing"]
    assert body["providers"][0]["reasons"] == ["Rated 4.5 from published reviews",
                                               "Works in Newtown, Enmore, which covers Newtown",
                                               "Offers plumbing work", "$95 an hour"]
    assert "1. Harbour Plumbing: Rated 4.5 from published reviews" in body["reply"]
    search = next(params for name, params in fake_db.rpc_calls if name == "mobile_owner_provider_search")
    assert search == {"p_filters": {"category": "PLUMBING", "location": "Newtown"}}


def test_a_provider_the_web_has_not_published_is_never_suggested(client, fake_db, olly, no_model):
    provider(fake_db, PAT, "Harbour Plumbing", published=True)
    provider(fake_db, uid("draft"), "Draft Plumbing", ratings=(5, 5), published=False)

    body = ask(client, olly.headers, "Find a plumber for the leaking tap in Newtown").json()

    assert [p["name"] for p in body["providers"]] == ["Harbour Plumbing"]
    assert "Draft Plumbing" not in body["reply"]


def test_a_failed_provider_search_says_so_rather_than_that_none_matches(client, fake_db, olly, no_model, monkeypatch):
    def timing_out(ctx, params):
        raise api_error("57014", "canceling statement due to statement timeout")

    fake_rpcs.handler("mobile_owner_provider_search")  # load the stand-ins before replacing one
    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_owner_provider_search", timing_out)

    body = ask(client, olly.headers, "Find a plumber for the leaking tap in Newtown").json()

    assert body["providers"] == []
    assert "The provider search is unavailable right now" in body["reply"]
    assert "No verified provider" not in body["reply"]


def test_the_model_is_told_when_the_provider_search_failed(client, fake_db, olly, model, monkeypatch):
    def timing_out(ctx, params):
        raise api_error("57014", "canceling statement due to statement timeout")

    fake_rpcs.handler("mobile_owner_provider_search")
    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_owner_provider_search", timing_out)
    model.answer = {"reply": "Harbour Plumbing can do it.", "action": {
        "operation": "assign_maintenance", "payload": {"complaintId": REPAIR, "providerId": PAT}}}

    body = ask(client, olly.headers, "Assign a plumber to the leaking tap").json()

    assert model.calls[0]["providerSearch"].startswith("unavailable right now")
    # Nothing was suggested, so no provider may be proposed.
    assert (body["source"], body["action"]) == ("rules", None)


def test_the_model_may_assign_only_a_suggested_provider(client, fake_db, olly, model):
    provider(fake_db, PAT, "Harbour Plumbing")
    model.answer = {"reply": "Harbour Plumbing is rated 4.5.", "action": {
        "operation": "assign_maintenance", "payload": {"complaintId": REPAIR, "providerId": PAT}}}

    suggested = ask(client, olly.headers, "Assign a plumber to the leaking tap").json()
    model.answer["action"]["payload"]["providerId"] = uid("someone else")
    other = ask(client, olly.headers, "Assign a plumber to the leaking tap").json()

    assert suggested["action"]["preview"]["changes"][1] == {"label": "Provider", "value": "Harbour Plumbing"}
    assert (other["source"], other["action"]) == ("rules", None)


def test_a_provider_whose_profile_is_not_verified_is_never_suggested_or_assigned(client, fake_db, olly, model):
    """The R18 gate of POST /maintenance/{id}/assign: the search and the database check only the users row."""
    provider(fake_db, PAT, "Harbour Plumbing")
    model.answer = {"reply": "Harbour Plumbing is rated 4.5.", "action": {
        "operation": "assign_maintenance", "payload": {"complaintId": REPAIR, "providerId": PAT}}}
    chat = ask(client, olly.headers, "Assign a plumber to the leaking tap").json()
    assert chat["action"]["operation"] == "assign_maintenance"

    # Since then, the provider's profile went back to review; the account is still approved.
    profile = next(row for row in rows(fake_db, "service_provider_profiles") if row["user_id"] == PAT)
    profile["verification_status"] = "PENDING"
    refused = client.post(f"{API}/messages/{chat['request_id']}/confirm", headers=olly.headers)
    again = ask(client, olly.headers, "Assign a plumber to the leaking tap").json()

    assert refused.status_code == 403
    assert (refused.json()["detail"]["action"], refused.json()["detail"]["status"]) == ("receive_repairs", "unverified")
    assert "mobile_owner_assistant_action" not in rpc_names(fake_db)
    assert rows(fake_db, "maintenance_work_orders")[0]["status"] == "OPEN"
    assert again["providers"] == [] and again["action"] is None


def test_a_provider_is_proposed_only_for_a_repair_it_can_take(client, fake_db, olly, model):
    provider(fake_db, PAT, "Spark Electrical", categories=("ELECTRICAL",))
    model.answer = {"reply": "Spark Electrical is rated 4.5.", "action": {
        "operation": "assign_maintenance", "payload": {"complaintId": REPAIR, "providerId": PAT}}}

    # The search follows the question's words, but the leaking tap is a PLUMBING repair.
    wrong_trade = ask(client, olly.headers, "Assign an electrician to the repair").json()
    provider(fake_db, uid("plumber"), "Harbour Plumbing")
    model.answer["action"]["payload"]["providerId"] = uid("plumber")
    fake_db.tables["maintenance_work_orders"][0]["status"] = "SCHEDULED"
    scheduled = ask(client, olly.headers, "Assign a plumber to the leaking tap").json()

    assert (wrong_trade["source"], wrong_trade["action"]) == ("rules", None)
    assert (scheduled["source"], scheduled["action"]) == ("rules", None)


def test_an_agent_is_never_offered_what_only_the_landlord_can_do(client, fake_db, model):
    headers = sign_in(fake_db, OTTO, role="AGENT")
    listing = home(fake_db, OTTO, "Agency flat", status="DRAFT")
    model.answer = {"reply": "Ready to publish it.", "action": {"operation": "publish_listing",
                                                                "payload": {"listingId": listing}}}

    body = ask(client, headers, "Publish the agency flat").json()

    assert (body["source"], body["action"]) == ("rules", None)
    offered = set(model.calls[0]["operations"])
    assert offered.isdisjoint(owner_assistant.LANDLORD_ONLY)
    assert {"create_record", "update_property", "send_proposal"} <= offered


# ---------------------------------------------------------------------------
# The database's errors
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("code, message, expected", [
    ("42501", "Active owner access is required.", 403),
    ("P0002", "Not found.", 404),
    ("23505", "Already there.", 409),
    ("22023", "Weekly rent must be more than 0.", 422),
    ("23514", "Listing creator must own or manage the property", 422),
    ("P0001", "AI request limit reached. Please wait before asking again.", 429),
    ("P0001", "This AI request is already being processed. Try a new request after waiting.", 409),
    ("P0001", "Choose a reminder time", 422),
])
def test_function_errors_keep_their_message_with_the_matching_status(code, message, expected):
    error = owner_assistant._http_error(APIError({"code": code, "message": message}))

    assert (error.status_code, error.detail) == (expected, message)


def test_other_database_failures_say_the_assistant_is_unavailable():
    error = owner_assistant._http_error(APIError({"code": "57014", "message": "canceling statement due to timeout"}))

    assert (error.status_code, error.detail) == (503, "The assistant is unavailable right now. Please try again.")
