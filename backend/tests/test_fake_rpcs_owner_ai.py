"""The owner assistant's stand-ins (tests/fake_rpcs/fb_owner_ai.py) do what the functions' bodies do.

Each call runs as the owner, through user_client, as the backend calls them.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from postgrest.exceptions import APIError

from app.core.supabase import user_client
from tests.factories import NOW
from tests.factories_identity import account

OLLY, OTTO, TESS = (str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:owner-ai-stand-ins:{n}")) for n in ("olly", "otto", "tess"))
LISTING, PROPERTY, OTHER = (str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:owner-ai-stand-ins:{n}"))
                            for n in ("listing", "property", "other-listing"))
LATER = "2030-11-02T09:30:00+11:00"


@pytest.fixture
def owner(fake_db):
    """Olly's client: an owner with one listing and Tess, an approved tenant; Otto owns another listing."""
    token = account(fake_db, OLLY, "olly@example.test", "LANDLORD")
    account(fake_db, OTTO, "otto@example.test", "LANDLORD")
    account(fake_db, TESS, "tess@example.test", "TENANT", full_name="Tess Tenant")
    for property_id, listing_id, owner_id in ((PROPERTY, LISTING, OLLY), (str(uuid.uuid4()), OTHER, OTTO)):
        fake_db.seed("properties", [{"id": property_id, "owner_user_id": owner_id, "address_line_1": "1 Lane",
                                     "suburb": "Newtown", "state": "NSW", "postcode": "2042", "updated_at": NOW}])
        fake_db.seed("listings", [{"id": listing_id, "property_id": property_id, "created_by_user_id": owner_id,
                                   "title": f"Home of {owner_id[:4]}", "weekly_rent": 650, "status": "PUBLISHED",
                                   "updated_at": NOW}])
    fake_db.seed("rental_applications", [{"id": str(uuid.uuid4()), "listing_id": LISTING, "applicant_user_id": TESS,
                                          "status": "APPROVED", "offer_weekly_rent": 650, "updated_at": NOW}])
    return user_client(token)


def call(client, name, **params):
    return client.rpc(name, params).execute().data


def refused(client, name, **params) -> APIError:
    with pytest.raises(APIError) as caught:
        call(client, name, **params)
    return caught.value


def act(client, operation, payload, request=None, confirmed=True):
    return call(client, "mobile_owner_assistant_action", p_request=request or str(uuid.uuid4()),
                p_operation=operation, p_payload=payload, p_confirmed=confirmed)


def charge(amount=650):
    return {"listingId": LISTING, "kind": "charge", "title": "Rent", "recipientId": TESS,
            "data": {"amount": amount, "dueDate": "2030-11-01"}}


def test_only_an_active_owner_runs_them(fake_db, owner):
    tenant = user_client(account(fake_db, str(uuid.uuid4()), "tom@example.test", "TENANT"))

    error = refused(tenant, "mobile_owner_assistant_context")

    assert (error.code, error.message) == ("42501", "Active owner access is required.")


def test_reserve_counts_the_requests_and_hands_back_an_answered_one(fake_db, owner):
    request = str(uuid.uuid4())

    assert call(owner, "mobile_owner_assistant_reserve", p_request=request) == {"cached": False}
    busy = refused(owner, "mobile_owner_assistant_reserve", p_request=request)
    call(owner, "mobile_owner_assistant_finish", p_request=request, p_question="Q?", p_result={"reply": "A."})
    call(owner, "mobile_owner_assistant_finish", p_request=request, p_question="Again?", p_result={"reply": "B."})

    assert busy.message == "This AI request is already being processed. Try a new request after waiting."
    assert call(owner, "mobile_owner_assistant_reserve", p_request=request) == {"cached": True, "result": {"reply": "A."}}
    assert [(t["question"], t["reply"]) for t in call(owner, "mobile_owner_assistant_history")] == [("Q?", "A.")]
    action = str(uuid.uuid4())
    act(owner, "set_dashboard_preferences", {"hiddenCards": ["reviews"]}, request=action)
    assert refused(owner, "mobile_owner_assistant_reserve", p_request=action).message == "Request ID is already in use"


def test_reserve_allows_ten_chats_a_minute(fake_db, owner):
    for _ in range(10):
        call(owner, "mobile_owner_assistant_reserve", p_request=str(uuid.uuid4()))

    error = refused(owner, "mobile_owner_assistant_reserve", p_request=str(uuid.uuid4()))

    assert error.message == "AI request limit reached. Please wait before asking again."


def test_finish_keeps_thirty_days_of_turns(fake_db, owner):
    old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    fake_db.seed("owner_assistant_turns", [{"owner_user_id": OLLY, "question": "Old?", "reply": "Old.", "created_at": old}])
    request = str(uuid.uuid4())
    call(owner, "mobile_owner_assistant_reserve", p_request=request)

    call(owner, "mobile_owner_assistant_finish", p_request=request, p_question="New?", p_result={"reply": "New."})

    assert [t["question"] for t in fake_db.tables["owner_assistant_turns"]] == ["New?"]


def test_the_context_holds_the_owners_records_with_anonymised_applicants(fake_db, owner):
    context = call(owner, "mobile_owner_assistant_context")

    assert [row["id"] for row in context["properties"]] == [LISTING]
    [application] = context["applications"]
    assert application["applicantLabel"] == "Applicant " + application["id"][-6:]
    assert context["recipients"][0]["displayName"] == "Tess Tenant"
    assert context["workspace"]["integrations"] == {"onlinePayments": False, "digitalSigning": False, "doorAccess": False}


def test_an_action_is_saved_once_per_request_id(fake_db, owner):
    request = str(uuid.uuid4())

    first = act(owner, "create_record", charge(), request=request)
    again = act(owner, "create_record", charge(), request=request)
    changed = refused(owner, "mobile_owner_assistant_action", p_request=request, p_operation="create_record",
                      p_payload=charge(600), p_confirmed=True)

    assert again == first
    assert (first["message"], first["record"]["status"], first["record"]["payload"]["currency"]) == (
        "Charge saved.", "recorded", "AUD")
    assert changed.message == "This request ID was already used for different details."
    assert len(fake_db.tables["owner_assistant_records"]) == 1


def test_a_failed_action_undoes_its_request_row(fake_db, owner):
    error = refused(owner, "mobile_owner_assistant_action", p_request=str(uuid.uuid4()), p_operation="create_record",
                    p_payload=charge(), p_confirmed=False)

    assert error.message == "Review financial records before confirming."
    assert fake_db.tables.get("owner_assistant_requests", []) == []
    assert fake_db.tables.get("owner_assistant_records", []) == []


@pytest.mark.parametrize("payload, code, message", [
    ({**charge(), "listingId": OTHER}, "42501", "You can only change records for your own property."),
    ({**charge(), "recipientId": OLLY}, "P0001", "Choose a tenant with an approved application for this listing."),
    ({**charge(), "data": {"amount": 10.555, "dueDate": "2030-11-01"}}, "P0001",
     "Amount must be positive AUD with at most two decimal places."),
    ({**charge(), "data": {"amount": 650, "dueDate": "1 Nov"}}, "P0001", "Use YYYY-MM-DD dates"),
    ({"listingId": LISTING, "kind": "reminder", "title": "Late", "data": {"dueAt": "2020-01-01T00:00:00Z"}}, "P0001",
     "Choose a reminder time"),
    ({"listingId": LISTING, "kind": "deed", "title": "Deed"}, "P0001", "Unknown management record"),
])
def test_a_record_follows_the_functions_checks(fake_db, owner, payload, code, message):
    error = refused(owner, "mobile_owner_assistant_action", p_request=str(uuid.uuid4()), p_operation="create_record",
                    p_payload=payload, p_confirmed=True)

    assert (error.code, error.message) == (code, message)


def test_payments_stay_within_their_charge_and_an_inspection_adds_a_reminder(fake_db, owner):
    charged = act(owner, "create_record", charge())["record"]
    payment = {"listingId": LISTING, "kind": "payment", "title": "Paid", "recipientId": TESS,
               "data": {"amount": 650, "date": "2026-10-01", "chargeId": charged["id"]}}
    act(owner, "create_record", payment)
    over = refused(owner, "mobile_owner_assistant_action", p_request=str(uuid.uuid4()), p_operation="create_record",
                   p_payload={**payment, "data": {**payment["data"], "amount": 1}}, p_confirmed=True)
    inspection = act(owner, "create_record", {"listingId": LISTING, "kind": "inspection", "title": "Routine",
                                              "data": {"startsAt": LATER, "durationMinutes": 30, "mode": "in_person"}})

    assert over.message == "Payment exceeds the remaining rent charge"
    reminder = fake_db.tables["owner_assistant_records"][-1]
    assert (reminder["kind"], reminder["title"], reminder["payload"]["inspectionId"]) == (
        "reminder", "Inspection reminder", inspection["record"]["id"])
    assert reminder["payload"]["dueAt"] == "2030-11-01T21:30:00+00:00"


def test_a_receipt_needs_the_action_its_chat_proposed(fake_db, owner):
    chat, action = str(uuid.uuid4()), str(uuid.uuid4())
    call(owner, "mobile_owner_assistant_reserve", p_request=chat)
    call(owner, "mobile_owner_assistant_finish", p_request=chat, p_question="Hide reviews?", p_result={
        "reply": "Ready.", "action": {"operation": "set_dashboard_preferences", "payload": {"hiddenCards": ["reviews"]}}})

    missing = refused(owner, "mobile_owner_assistant_receipt", p_chat_request=chat, p_action_request=action)
    act(owner, "set_dashboard_preferences", {"hiddenCards": ["network"]}, request=action)
    other = refused(owner, "mobile_owner_assistant_receipt", p_chat_request=chat, p_action_request=action)
    matching = str(uuid.uuid4())
    act(owner, "set_dashboard_preferences", {"hiddenCards": ["reviews"]}, request=matching)
    call(owner, "mobile_owner_assistant_receipt", p_chat_request=chat, p_action_request=matching)

    assert missing.message == "An executed action receipt is required"
    assert other.message == "Receipt does not match the assistant action"
    assert fake_db.tables["owner_assistant_turns"][0]["reply"] == f"Dashboard preferences updated. Receipt: {matching}"
    users = {row["id"]: row for row in fake_db.tables["users"]}
    assert users[OLLY]["metadata"]["mobile"]["ownerDashboardHiddenCards"] == ["reviews"]


def test_a_call_the_action_makes_with_no_stand_in_fails_loudly(fake_db, owner):
    with pytest.raises(NotImplementedError, match="mobile_update_property"):
        act(owner, "publish_listing", {"listingId": LISTING})


def test_the_provider_search_lists_verified_public_providers_best_rated_first(fake_db, owner):
    for name, rating, public in (("Good", 5, True), ("Fair", 3, True), ("Hidden", 5, False)):
        user_id = str(uuid.uuid4())
        account(fake_db, user_id, f"{name}@trade.test", "SERVICE_PROVIDER", verification_status="APPROVED",
                metadata={"mobile": {"privacySettings": {"publicProfile": public}}})
        fake_db.seed("service_provider_profiles", [{"user_id": user_id, "company_name": name, "updated_at": NOW,
                                                    "service_categories": ["PLUMBING"], "service_area": "Newtown"}])
        fake_db.seed("reviews", [{"id": str(uuid.uuid4()), "reviewer_user_id": TESS, "reviewed_user_id": user_id,
                                  "rating": rating, "landlord_rating": rating, "updated_at": NOW}])

    found = call(owner, "mobile_owner_provider_search", p_filters={"category": "plumbing", "location": "newtown"})

    assert [(row["name"], row["rating"]) for row in found] == [("Good", 5), ("Fair", 3)]
    assert call(owner, "mobile_owner_provider_search", p_filters={"category": "ELECTRICAL"}) == []


def test_text_loses_only_its_spaces_as_sql_trim_does(fake_db, owner):
    """trim() takes off spaces only, so a tab or a line break is kept and counts."""
    reminder = act(owner, "create_record", {"listingId": LISTING, "kind": "reminder", "title": "\tRent due ",
                                            "data": {"dueAt": LATER, "message": "Pay the rent"}})["record"]
    lease = act(owner, "create_record", {"listingId": LISTING, "kind": "lease", "title": "Lease", "recipientId": TESS,
                                         "data": {"text": "x" * 19 + "\n"}})["record"]
    inspection = act(owner, "create_record", {"listingId": LISTING, "kind": "inspection", "title": "Routine",
                                              "data": {"startsAt": LATER, "durationMinutes": 30, "mode": "in_person"}})
    done = act(owner, "update_record", {"recordId": inspection["record"]["id"], "data": {"report": "\nAll fine."}})
    home = act(owner, "create_listing", {"title": "\tGarden flat ", "price": 500, "address": " 2 Lane ",
                                         "suburb": "Newtown", "state": "", "propertyType": "\tflat"})

    assert reminder["title"] == "\tRent due"
    assert lease["payload"]["text"] == "x" * 19 + "\n"
    assert done["record"]["payload"]["report"] == "\nAll fine."
    # coalesce(state, 'NSW') keeps an empty state; "\tflat" is no type mobile_property_type_from_app knows.
    assert (home["title"], home["state"], home["propertyType"]) == ("\tGarden flat", "", "other")


def test_a_provider_with_an_empty_company_name_is_named_as_coalesce_does(fake_db, owner):
    """coalesce(sp.company_name, u.full_name, ...) keeps an empty company name: the web then says "Service provider"."""
    provider = str(uuid.uuid4())
    account(fake_db, provider, "pat@trade.test", "SERVICE_PROVIDER", verification_status="APPROVED",
            full_name="Pat Person")
    fake_db.seed("service_provider_profiles", [{"user_id": provider, "company_name": "", "updated_at": NOW}])

    [found] = call(owner, "mobile_owner_provider_search", p_filters={})

    assert (found["id"], found["name"]) == (provider, "")
