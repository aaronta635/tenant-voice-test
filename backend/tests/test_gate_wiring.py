"""The verification gates at the actions they guard (tracker R18), by direct requests on the strict fake.

services/gates.py decides (tests/test_gates.py); this checks that every
entry point asks it, with the caller's own token: a tenant applying, an
owner publishing a listing or confirming an AI assistant action, a provider
confirming or starting a booking, being assigned a repair or booking and
completing its visit, and going live. A pending or rejected account gets
that action's 403 and nothing is written; an approved one goes through.
Browsing and matching ask nothing. A suspended provider still signs in
(assumption #14) but gets no new work; they finish a booking in progress,
but not a repair's visit, which the shared functions take from an active
account only.

The other paid AI, an owner's assistant question, a tenant's AI order of
their matches and the provider assistant's chat turns and reranking, answers
the rule results with the refusal instead of a 403, and the model is never
asked. Confirming an action the owner assistant proposed is refused with 403.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services import bookings, maintenance, matching, owner_assistant, provider_recommendations
from tests.factories_bookings import booking, freeze_clock, open_week, rows, service, web_rows
from tests.factories_identity import account, verify
from tests.factories_matching import seed_home, tenant_profile
from tests.factories_provider_core import provider_profile
from tests.factories_reviews_complaints import complaint, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"


def uid(name: str) -> str:
    """A stable uuid for a readable test name."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:gate-wiring-tests:{name}"))


TESS, OLLY, PAT, CARL = uid("tess"), uid("olly"), uid("pat"), uid("carl")
FIX, ENQUIRY, CONFIRMED, WORKING = uid("fix"), uid("enquiry"), uid("confirmed"), uid("working")
REPAIR, ORDER = uid("repair"), uid("order")
# Noon on 15 January 2030 in Sydney, for the bookings and the repairs.
NOW_IN_SYDNEY = datetime(2030, 1, 15, 12)
REPAIRS_NOW = datetime(2030, 1, 15, 1, 0, tzinfo=timezone.utc)
TOMORROW, YESTERDAY = "2030-01-16", "2030-01-14"
VISIT = {"date": "2030-01-20", "time": "09:30", "duration_minutes": 60, "note": "I'll call first."}
UNVERIFIED = [("PENDING", "pending"), ("REJECTED", "rejected")]
DOCUMENTS = {
    "TENANT": "/tenant/id-verification",
    "LANDLORD": "/owner/profile/verification",
    "SERVICE_PROVIDER": "/dashboard/profile#verification-documents",
}
NEW_LISTING = {
    "title": "Harbour flat", "address": "1 Harbour Street", "suburb": "Wollongong", "state": "NSW",
    "postcode": "2500", "property_type": "Apartment", "bedrooms": 2, "bathrooms": 1, "price": 650,
}


@pytest.fixture(autouse=True)
def clocks(monkeypatch):
    freeze_clock(monkeypatch, bookings, NOW_IN_SYDNEY)
    monkeypatch.setattr(maintenance, "_now", lambda: REPAIRS_NOW)


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    """Matching never contacts the model here."""
    matching.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))
    yield
    matching.clear_caches()


def sign_in(db, user_id: str, role: str, verification: str = "APPROVED", **over) -> dict:
    """Bearer headers for an account of role with that verification; a provider gets its profile row too."""
    token = account(db, user_id, f"{user_id}@example.test", role, full_name=f"{role.title()} {user_id[:4]}",
                    verification_status=verification, **over)
    if role == "SERVICE_PROVIDER":
        db.seed("service_provider_profiles", [{
            **provider_profile(user_id, "Pat's Plumbing", slug="pats-plumbing", published=False),
            "verification_status": verification,
        }])
    return {"Authorization": f"Bearer {token}"}


def refused(response, action: str, status: str, documents_href: str | None) -> dict:
    assert response.status_code == 403, response.text
    detail = response.json()["detail"]
    assert (detail["code"], detail["action"], detail["status"], detail["documents_href"]) == (
        "verification_required", action, status, documents_href,
    )
    return detail


def listing_status(db, listing_id: str) -> str:
    return next(row for row in db.tables["listings"] if row["id"] == listing_id)["status"]


# ---------------------------------------------------------------------------
# A tenant applying
# ---------------------------------------------------------------------------
@pytest.fixture
def home(strict_schema) -> str:
    sign_in(strict_schema, OLLY, "LANDLORD")
    return seed_home(strict_schema, OLLY, "Harbour flat", rent=600)


@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_tenant_cannot_apply(client, strict_schema, home, verification, status):
    tess = sign_in(strict_schema, TESS, "TENANT", verification)

    response = client.post(f"{API}/applications", headers=tess, json={"property_id": home})

    detail = refused(response, "apply", status, DOCUMENTS["TENANT"])
    assert "apply for rentals" in detail["message"]
    assert strict_schema.tables.get("rental_applications", []) == []
    assert rows(strict_schema, "notifications", user_id=OLLY) == []


def test_a_verified_tenant_applies(client, strict_schema, home):
    tess = sign_in(strict_schema, TESS, "TENANT")

    response = client.post(f"{API}/applications", headers=tess, json={"property_id": home})

    assert response.status_code == 201, response.text
    assert [row["applicant_user_id"] for row in strict_schema.tables["rental_applications"]] == [TESS]


def test_an_unverified_tenant_still_browses_and_gets_matches(client, strict_schema, home):
    tess = sign_in(strict_schema, TESS, "TENANT", "PENDING")
    strict_schema.seed("tenant_profiles", [tenant_profile(TESS, budget_max=650, locations=["Newtown"])])

    listings = client.get(f"{API}/properties", headers=tess)
    page = client.get(f"{API}/properties/{home}", headers=tess)
    providers = client.get(f"{API}/providers", headers=tess)
    matches = client.get(f"{API}/me/matches/properties", headers=tess)

    assert [listing["id"] for listing in listings.json()] == [home]
    assert (page.status_code, providers.status_code) == (200, 200)
    assert matches.status_code == 200, matches.text
    assert [item["listing"]["id"] for item in matches.json()["items"]] == [home]


# ---------------------------------------------------------------------------
# An owner publishing a listing
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_owner_cannot_publish_a_listing(client, strict_schema, verification, status):
    olly = sign_in(strict_schema, OLLY, "LANDLORD", verification)

    detail = refused(client.post(f"{API}/me/properties", headers=olly, json=NEW_LISTING),
                     "publish_listing", status, DOCUMENTS["LANDLORD"])

    assert "publish listings" in detail["message"]
    assert (strict_schema.tables.get("properties", []), strict_schema.tables.get("listings", [])) == ([], [])
    # Kept off the market it saves, and publishing it later asks again.
    kept = client.post(f"{API}/me/properties", headers=olly, json={**NEW_LISTING, "status": "off_market"})
    assert kept.status_code == 201, kept.text
    for change in ({"listing_status": "published"}, {"status": "available"}):
        refused(client.patch(f"{API}/me/properties/{kept.json()['id']}", headers=olly, json=change),
                "publish_listing", status, DOCUMENTS["LANDLORD"])
    assert listing_status(strict_schema, kept.json()["id"]) == "PAUSED"


@pytest.mark.parametrize("stored", ["PAUSED", "APPLICATIONS_CLOSED"])
def test_an_unverified_owner_cannot_put_a_listing_back_up_for_applications(client, strict_schema, stored):
    # A leased listing never goes back up: the status matrix refuses that (409) whoever asks.
    olly = sign_in(strict_schema, OLLY, "LANDLORD", "PENDING")
    listing_id = seed_home(strict_schema, OLLY, "Harbour flat", status=stored)

    refused(client.patch(f"{API}/me/properties/{listing_id}", headers=olly, json={"listing_status": "published"}),
            "publish_listing", "pending", DOCUMENTS["LANDLORD"])
    assert listing_status(strict_schema, listing_id) == stored
    # Taking a listing down needs no check.
    published = seed_home(strict_schema, OLLY, "Garden flat")
    paused = client.patch(f"{API}/me/properties/{published}", headers=olly, json={"listing_status": "paused"})
    assert paused.status_code == 200, paused.text


# A draft or a leased listing is never closed to applications: the status matrix refuses that (409).
@pytest.mark.parametrize("stored", ["PAUSED"])
@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_owner_cannot_show_a_listing_by_closing_its_applications(
    client, strict_schema, stored, verification, status,
):
    # Closed to applications, a listing is public: moving one there from out of view is publishing it.
    olly = sign_in(strict_schema, OLLY, "LANDLORD", verification)
    listing_id = seed_home(strict_schema, OLLY, "Harbour flat", status=stored)

    refused(client.patch(f"{API}/me/properties/{listing_id}", headers=olly, json={"listing_status": "applications_closed"}),
            "publish_listing", status, DOCUMENTS["LANDLORD"])

    assert listing_status(strict_schema, listing_id) == stored
    assert client.get(f"{API}/properties/{listing_id}").status_code == 404
    assert listing_id not in [listing["id"] for listing in client.get(f"{API}/properties").json()]


def test_an_unverified_owner_still_closes_applications_on_a_published_listing(client, strict_schema):
    olly = sign_in(strict_schema, OLLY, "LANDLORD", "PENDING")
    listing_id = seed_home(strict_schema, OLLY, "Harbour flat")

    closed = client.patch(f"{API}/me/properties/{listing_id}", headers=olly,
                          json={"listing_status": "applications_closed"})

    assert closed.status_code == 200, closed.text
    assert listing_status(strict_schema, listing_id) == "APPLICATIONS_CLOSED"


def test_a_verified_owner_closes_applications_on_a_listing_out_of_view(client, strict_schema):
    olly = sign_in(strict_schema, OLLY, "LANDLORD")
    listing_id = seed_home(strict_schema, OLLY, "Harbour flat", status="PAUSED")

    closed = client.patch(f"{API}/me/properties/{listing_id}", headers=olly,
                          json={"listing_status": "applications_closed"})

    assert closed.status_code == 200, closed.text
    assert listing_status(strict_schema, listing_id) == "APPLICATIONS_CLOSED"
    assert client.get(f"{API}/properties/{listing_id}").status_code == 200


def test_a_verified_owner_publishes(client, strict_schema):
    olly = sign_in(strict_schema, OLLY, "LANDLORD")

    created = client.post(f"{API}/me/properties", headers=olly, json=NEW_LISTING)
    paused = seed_home(strict_schema, OLLY, "Garden flat", status="PAUSED")
    republished = client.patch(f"{API}/me/properties/{paused}", headers=olly, json={"listing_status": "published"})

    assert (created.status_code, republished.status_code) == (201, 200), (created.text, republished.text)
    assert listing_status(strict_schema, created.json()["id"]) == listing_status(strict_schema, paused) == "PUBLISHED"


# ---------------------------------------------------------------------------
# An owner asking the AI assistant, and confirming what it proposes
# ---------------------------------------------------------------------------
@pytest.fixture
def assistant(monkeypatch):
    """A configured key and a stub in place of the assistant's model; the list holds each call made."""
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []
    monkeypatch.setattr(owner_assistant, "call_model",
                        lambda payload: calls.append(payload) or {"reply": "One listing.", "action": None})
    return calls


@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_owner_gets_the_assistants_rule_answer_and_cannot_confirm(client, strict_schema, assistant,
                                                                                verification, status):
    olly = sign_in(strict_schema, OLLY, "LANDLORD", verification)

    workspace = client.get(f"{API}/me/owner-assistant", headers=olly)
    answer = client.post(f"{API}/me/owner-assistant/messages", headers=olly, json={"question": "Any repairs?"})
    detail = refused(client.post(f"{API}/me/owner-assistant/messages/{uid('chat')}/confirm", headers=olly),
                     "paid_ai", status, DOCUMENTS["LANDLORD"])

    assert (workspace.status_code, answer.status_code) == (200, 200), (workspace.text, answer.text)
    assert (answer.json()["source"], answer.json()["ai_status"]) == ("rules", "verification_required")
    assert answer.json()["verification"]["status"] == status
    assert "use AI features" in detail["message"]
    assert assistant == []
    assert "mobile_owner_assistant_action" not in [name for name, _ in strict_schema.rpc_calls]


def test_a_verified_owner_asks_the_assistants_model(client, strict_schema, assistant):
    olly = sign_in(strict_schema, OLLY, "LANDLORD")

    response = client.post(f"{API}/me/owner-assistant/messages", headers=olly, json={"question": "Any repairs?"})

    assert response.status_code == 200, response.text
    assert (response.json()["source"], response.json()["reply"]) == ("ai", "One listing.")
    assert len(assistant) == 1
    assert [name for name, _ in strict_schema.rpc_calls][-1] == "mobile_owner_assistant_finish"


# ---------------------------------------------------------------------------
# The paid AI elsewhere: a tenant's AI order, the provider assistant's turns and reranking
# ---------------------------------------------------------------------------
@pytest.fixture
def model(monkeypatch):
    """A configured key and a stub in place of each model call; the list names each call made."""
    provider_recommendations.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []

    def order_matches(payload):
        calls.append("order matches")
        return {"recommendations": [
            {"listing_id": listing["listing_id"], "reason_codes": [fact["code"] for fact in listing["facts"][:1]]}
            for listing in payload["listings"]
        ]}

    def rerank(payload):
        calls.append("rerank")
        return {"recommendations": [
            {"candidate_id": candidate["candidate_id"], "reason_codes": [candidate["evidence"][0]["code"]]}
            for candidate in payload["candidates"][:payload["limit"]]
        ]}

    def chat_turn(_payload):
        calls.append("chat")
        return {"action": "ask", "reply": "Which area should I focus on?", "quick_replies": [],
                "criteria": {"role": "landlord", "location": None, "service_ids": [], "new_only": False}}

    monkeypatch.setattr(matching, "call_model", order_matches)
    monkeypatch.setattr(provider_recommendations, "call_deepseek", rerank)
    monkeypatch.setattr(provider_recommendations, "call_chat_model", chat_turn)
    yield calls
    provider_recommendations.clear_caches()


def ai_refused(body: dict, status: str, documents_href: str | None) -> None:
    """The rule results came back, with the paid AI's refusal where the model's answer would be."""
    detail = body["verification"]
    assert (body["source"], body["ai_status"]) == ("rules", "verification_required")
    assert (detail["code"], detail["action"], detail["status"], detail["documents_href"]) == (
        "verification_required", "paid_ai", status, documents_href,
    )
    assert "use AI features" in detail["message"]


ASSISTANT = f"{API}/me/recommendations/provider"
SAY = {"messages": [{"role": "user", "content": "Landlords near me"}]}


@pytest.mark.parametrize("verification, account_status, status, documents_href", [
    ("PENDING", "ACTIVE", "pending", DOCUMENTS["TENANT"]),
    ("REJECTED", "ACTIVE", "rejected", DOCUMENTS["TENANT"]),
    ("APPROVED", "PENDING_VERIFICATION", "inactive", None),
])
def test_a_tenant_who_cannot_use_the_paid_ai_keeps_the_rule_order(
    client, strict_schema, home, model, verification, account_status, status, documents_href,
):
    tess = sign_in(strict_schema, TESS, "TENANT", verification, status=account_status)
    strict_schema.seed("tenant_profiles", [tenant_profile(TESS, budget_max=650, locations=["Newtown"])])

    shown = client.get(f"{API}/me/matches/properties", headers=tess)
    refined = client.post(f"{API}/me/matches/properties/refine", headers=tess)

    assert (shown.status_code, refined.status_code) == (200, 200), (shown.text, refined.text)
    assert [item["listing"]["id"] for item in shown.json()["items"]] == [home]
    assert [item["listing"]["id"] for item in refined.json()["items"]] == [home]
    ai_refused(refined.json(), status, documents_href)
    assert model == []
    assert [row["source"] for row in rows(strict_schema, "recommendations", target_user_id=TESS)] == ["RULE_ENGINE"]


def test_a_verified_tenant_has_the_model_order_their_matches(client, strict_schema, home, model):
    tess = sign_in(strict_schema, TESS, "TENANT")
    strict_schema.seed("tenant_profiles", [tenant_profile(TESS, budget_max=650, locations=["Newtown"])])

    refined = client.post(f"{API}/me/matches/properties/refine", headers=tess).json()

    assert (refined["source"], refined["ai_status"], refined["verification"]) == ("ai", "applied", None)
    assert model == ["order matches"]


@pytest.mark.parametrize("verification, account_status, status, documents_href", [
    ("PENDING", "ACTIVE", "pending", DOCUMENTS["SERVICE_PROVIDER"]),
    ("REJECTED", "ACTIVE", "rejected", DOCUMENTS["SERVICE_PROVIDER"]),
    ("APPROVED", "SUSPENDED", "suspended", None),
])
def test_a_provider_who_cannot_use_the_paid_ai_keeps_profile_matches_and_guided_questions(
    client, strict_schema, model, verification, account_status, status, documents_href,
):
    sign_in(strict_schema, OLLY, "LANDLORD")
    pat = sign_in(strict_schema, PAT, "SERVICE_PROVIDER", verification, status=account_status)

    shown = client.get(ASSISTANT, headers=pat)
    searched = client.post(f"{ASSISTANT}/analyze", headers=pat, json={})
    turn = client.post(f"{ASSISTANT}/chat", headers=pat, json=SAY)

    assert (shown.status_code, searched.status_code, turn.status_code) == (200, 200, 200), (searched.text, turn.text)
    assert [item["id"] for item in searched.json()["items"]] == [item["id"] for item in shown.json()["items"]] == [OLLY]
    ai_refused(searched.json(), status, documents_href)
    # The guided questions answer in the model's place.
    ai_refused(turn.json(), status, documents_href)
    assert (turn.json()["state"], turn.json()["missing"]) == ("ask", ["location"])
    assert model == []


def test_a_verified_provider_has_the_model_rerank_and_chat(client, strict_schema, model):
    sign_in(strict_schema, OLLY, "LANDLORD")
    pat = sign_in(strict_schema, PAT, "SERVICE_PROVIDER")

    searched = client.post(f"{ASSISTANT}/analyze", headers=pat, json={}).json()
    turn = client.post(f"{ASSISTANT}/chat", headers=pat, json=SAY).json()

    assert (searched["source"], searched["ai_status"], searched["verification"]) == ("deepseek", "applied", None)
    assert (turn["source"], turn["ai_status"], turn["verification"]) == ("deepseek", "applied", None)
    assert model == ["rerank", "chat"]


def test_a_provider_back_in_review_gets_no_cached_ai_answer_either(client, strict_schema, model):
    sign_in(strict_schema, OLLY, "LANDLORD")
    pat = sign_in(strict_schema, PAT, "SERVICE_PROVIDER")
    assert client.post(f"{ASSISTANT}/analyze", headers=pat, json={}).json()["source"] == "deepseek"

    # A document goes back to review: the same search is answered from the profile, not the cached AI order.
    verify(strict_schema, PAT, status="PENDING")
    again = client.post(f"{ASSISTANT}/analyze", headers=pat, json={}).json()

    ai_refused(again, "pending", DOCUMENTS["SERVICE_PROVIDER"])
    assert (again["cached"], model) == (False, ["rerank"])


# ---------------------------------------------------------------------------
# A provider confirming and starting bookings
# ---------------------------------------------------------------------------
@pytest.fixture
def jobs(strict_schema):
    """Carl's enquiry for tomorrow, a confirmed job from yesterday not started yet, and one in progress."""
    sign_in(strict_schema, CARL, "TENANT")
    strict_schema.seed("mobile_provider_services", [service(FIX, PAT, "Fix a tap", price=150)])
    strict_schema.seed("provider_availability", open_week(PAT), schema="web")
    job = {"service_id": FIX, "price": 150, "property_suburb": "Newtown"}
    strict_schema.seed("bookings", [
        booking(ENQUIRY, CARL, PAT, "new_enquiry", **job, scheduled_date=TOMORROW, scheduled_time="10:00:00"),
        booking(CONFIRMED, CARL, PAT, "confirmed", **job, scheduled_date=YESTERDAY, scheduled_time="10:00:00"),
        booking(WORKING, CARL, PAT, "in_progress", **job, scheduled_date=YESTERDAY, scheduled_time="14:00:00"),
    ], schema="web")
    return strict_schema


def booking_status(db, booking_id: str) -> str:
    return web_rows(db, "bookings", id=booking_id)[0]["status"]


@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_provider_cannot_confirm_or_start_a_booking(client, jobs, verification, status):
    pat = sign_in(jobs, PAT, "SERVICE_PROVIDER", verification)

    detail = refused(client.patch(f"{API}/bookings/{ENQUIRY}", headers=pat, json={"status": "confirmed"}),
                     "accept_booking", status, DOCUMENTS["SERVICE_PROVIDER"])
    refused(client.patch(f"{API}/bookings/{CONFIRMED}", headers=pat, json={"status": "in_progress"}),
            "accept_booking", status, DOCUMENTS["SERVICE_PROVIDER"])

    assert "accept bookings" in detail["message"]
    assert (booking_status(jobs, ENQUIRY), booking_status(jobs, CONFIRMED)) == ("new_enquiry", "confirmed")
    assert web_rows(jobs, "invoices") == []
    assert rows(jobs, "notifications", user_id=CARL) == []


def test_a_verified_provider_confirms_and_starts_bookings(client, jobs):
    pat = sign_in(jobs, PAT, "SERVICE_PROVIDER")

    confirmed = client.patch(f"{API}/bookings/{ENQUIRY}", headers=pat, json={"status": "confirmed"})
    started = client.patch(f"{API}/bookings/{CONFIRMED}", headers=pat, json={"status": "in_progress"})

    assert (confirmed.status_code, started.status_code) == (200, 200), (confirmed.text, started.text)
    assert (booking_status(jobs, ENQUIRY), booking_status(jobs, CONFIRMED)) == ("confirmed", "in_progress")
    assert [invoice["booking_id"] for invoice in web_rows(jobs, "invoices")] == [ENQUIRY]


def test_a_suspended_provider_takes_no_new_booking_but_finishes_the_job_in_progress(client, jobs):
    pat = sign_in(jobs, PAT, "SERVICE_PROVIDER", status="SUSPENDED")

    refused(client.patch(f"{API}/bookings/{ENQUIRY}", headers=pat, json={"status": "confirmed"}),
            "accept_booking", "suspended", None)
    refused(client.patch(f"{API}/bookings/{CONFIRMED}", headers=pat, json={"status": "in_progress"}),
            "accept_booking", "suspended", None)
    finished = client.patch(f"{API}/bookings/{WORKING}", headers=pat,
                            json={"status": "completed", "completion_report": "Washer replaced."})

    assert finished.status_code == 200, finished.text
    assert [booking_status(jobs, job) for job in (ENQUIRY, CONFIRMED, WORKING)] == [
        "new_enquiry", "confirmed", "completed",
    ]
    assert web_rows(jobs, "invoices", booking_id=ENQUIRY) == []


# ---------------------------------------------------------------------------
# Repairs: an owner assigning a provider, and the provider taking the job on
# ---------------------------------------------------------------------------
HOME = "Harbour flat"


@pytest.fixture
def repair(strict_schema):
    """Tess's burst pipe at Olly's flat; the work order is the test's to shape (order())."""
    sign_in(strict_schema, TESS, "TENANT")
    listing_id = seed_home(strict_schema, OLLY, HOME)
    property_id = next(row for row in strict_schema.tables["listings"] if row["id"] == listing_id)["property_id"]
    strict_schema.seed("complaints", [complaint(
        REPAIR, TESS, description="Water coming through the kitchen ceiling.", against_user_id=OLLY,
        property_id=property_id, category="plumbing", severity="HIGH", metadata={"subject": "Burst pipe"},
    )])
    return strict_schema


def order(db, status: str = "OPEN", worker: str | None = None, **over) -> None:
    listing_id = next(row for row in db.tables["listings"] if row["title"] == HOME)["id"]
    db.seed("maintenance_work_orders", [work_order(
        ORDER, REPAIR, TESS, listing_id=listing_id, landlord_user_id=OLLY, assigned_worker_id=worker,
        status=status, **over,
    )])


def stored_order(db) -> dict:
    return next(row for row in db.tables["maintenance_work_orders"] if row["id"] == ORDER)


@pytest.mark.parametrize("verification, account_status, status, message", [
    ("PENDING", "ACTIVE", "unverified", "This provider isn't verified yet, so they can't be assigned repairs."),
    ("REJECTED", "ACTIVE", "unverified", "This provider isn't verified yet, so they can't be assigned repairs."),
    ("APPROVED", "SUSPENDED", "unavailable", "This provider can't be assigned repairs right now."),
])
def test_an_owner_cannot_assign_a_repair_to_a_provider_who_cannot_take_it(
    client, repair, verification, account_status, status, message,
):
    olly = sign_in(repair, OLLY, "LANDLORD", "PENDING")
    sign_in(repair, PAT, "SERVICE_PROVIDER", verification, status=account_status)
    order(repair)

    response = client.post(f"{API}/maintenance/{ORDER}/assign", headers=olly, json={"provider_id": PAT})

    # The owner is told only that the provider cannot take it, never why.
    assert refused(response, "receive_repairs", status, None)["message"] == message
    assert (stored_order(repair)["assigned_worker_id"], stored_order(repair)["status"]) == (None, "OPEN")


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "ADMIN"])
def test_an_owner_cannot_assign_a_repair_to_someone_who_is_not_a_provider(client, repair, primary_role):
    # Verified and active, but a repair goes to a service provider only: anyone else has no repairs page.
    olly = sign_in(repair, OLLY, "LANDLORD")
    sign_in(repair, CARL, primary_role)
    order(repair)

    response = client.post(f"{API}/maintenance/{ORDER}/assign", headers=olly, json={"provider_id": CARL})

    assert refused(response, "receive_repairs", "unavailable", None)["message"] == (
        "This member can't be assigned repairs right now."
    )
    assert (stored_order(repair)["assigned_worker_id"], stored_order(repair)["status"]) == (None, "OPEN")
    # The tenant who reported it is no more a provider than anyone else.
    response = client.post(f"{API}/maintenance/{ORDER}/assign", headers=olly, json={"provider_id": TESS})
    refused(response, "receive_repairs", "unavailable", None)
    assert stored_order(repair)["assigned_worker_id"] is None


def test_an_owner_assigns_a_repair_to_a_verified_provider(client, repair):
    # Assigning is not the owner's gated action: their own verification does not matter.
    olly = sign_in(repair, OLLY, "LANDLORD", "PENDING")
    sign_in(repair, PAT, "SERVICE_PROVIDER")
    order(repair)

    response = client.post(f"{API}/maintenance/{ORDER}/assign", headers=olly, json={"provider_id": PAT})

    assert response.status_code == 200, response.text
    assert (stored_order(repair)["assigned_worker_id"], stored_order(repair)["status"]) == (PAT, "ASSIGNED")


@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_provider_cannot_book_the_first_visit(client, repair, verification, status):
    pat = sign_in(repair, PAT, "SERVICE_PROVIDER", verification)
    order(repair, "ASSIGNED", worker=PAT)

    refused(client.post(f"{API}/me/repairs/{ORDER}/schedule", headers=pat, json=VISIT),
            "receive_repairs", status, DOCUMENTS["SERVICE_PROVIDER"])

    assert (stored_order(repair)["status"], stored_order(repair)["appointment_at"]) == ("ASSIGNED", None)
    assert repair.tables.get("complaint_events", []) == []


@pytest.mark.parametrize("verification, status", UNVERIFIED)
def test_an_unverified_provider_neither_moves_nor_completes_a_visit(client, repair, verification, status):
    # update_maintenance_work_order takes both from an APPROVED provider only, so the gate asks first.
    pat = sign_in(repair, PAT, "SERVICE_PROVIDER", verification)
    order(repair, "SCHEDULED", worker=PAT, appointment_at=(REPAIRS_NOW - timedelta(hours=2)).isoformat())

    refused(client.post(f"{API}/me/repairs/{ORDER}/schedule", headers=pat, json=VISIT),
            "receive_repairs", status, DOCUMENTS["SERVICE_PROVIDER"])
    refused(client.post(f"{API}/me/repairs/{ORDER}/complete", headers=pat, json={"note": "Pipe replaced."}),
            "receive_repairs", status, DOCUMENTS["SERVICE_PROVIDER"])

    assert stored_order(repair)["status"] == "SCHEDULED"


def test_a_verified_provider_books_the_visit_and_marks_it_done(client, repair):
    sign_in(repair, OLLY, "LANDLORD")  # the owner the functions notify
    pat = sign_in(repair, PAT, "SERVICE_PROVIDER")
    order(repair, "ASSIGNED", worker=PAT)

    booked = client.post(f"{API}/me/repairs/{ORDER}/schedule", headers=pat, json=VISIT)
    stored_order(repair)["appointment_at"] = (REPAIRS_NOW - timedelta(hours=2)).isoformat()
    done = client.post(f"{API}/me/repairs/{ORDER}/complete", headers=pat, json={"note": "Pipe replaced."})

    assert (booked.status_code, done.status_code) == (200, 200), (booked.text, done.text)
    assert stored_order(repair)["status"] == "PENDING_TENANT_CONFIRMATION"


def test_a_suspended_provider_books_moves_and_completes_no_visit(client, repair):
    # The shared functions run as current_app_user_id(), which a suspended account has not: the
    # gate says so first (assumption #14 for repairs is the database's rule now).
    pat = sign_in(repair, PAT, "SERVICE_PROVIDER", status="SUSPENDED")
    order(repair, "ASSIGNED", worker=PAT)

    refused(client.post(f"{API}/me/repairs/{ORDER}/schedule", headers=pat, json=VISIT),
            "receive_repairs", "suspended", None)
    stored_order(repair).update(status="SCHEDULED", appointment_at=(REPAIRS_NOW - timedelta(hours=2)).isoformat())
    refused(client.post(f"{API}/me/repairs/{ORDER}/schedule", headers=pat, json=VISIT),
            "receive_repairs", "suspended", None)
    refused(client.post(f"{API}/me/repairs/{ORDER}/complete", headers=pat, json={"note": "Pipe replaced."}),
            "receive_repairs", "suspended", None)

    assert stored_order(repair)["status"] == "SCHEDULED"


# ---------------------------------------------------------------------------
# A provider going live
# ---------------------------------------------------------------------------
@pytest.fixture
def live_service(strict_schema):
    strict_schema.seed("mobile_provider_services", [service(FIX, PAT, "Fix a tap", price=150)])
    return strict_schema


def published(db) -> bool:
    profile = next(row for row in db.tables["service_provider_profiles"] if row["user_id"] == PAT)
    return profile["metadata"]["is_published"]


@pytest.mark.parametrize("verification, account_status, status, documents_href", [
    ("PENDING", "ACTIVE", "pending", DOCUMENTS["SERVICE_PROVIDER"]),
    ("REJECTED", "ACTIVE", "rejected", DOCUMENTS["SERVICE_PROVIDER"]),
    ("APPROVED", "SUSPENDED", "suspended", None),
])
def test_a_provider_who_cannot_take_work_cannot_go_live(
    client, live_service, verification, account_status, status, documents_href,
):
    pat = sign_in(live_service, PAT, "SERVICE_PROVIDER", verification, status=account_status)

    detail = refused(client.patch(f"{API}/me/provider", headers=pat, json={"is_published": True}),
                     "go_live", status, documents_href)

    assert "go live on the marketplace" in detail["message"]
    assert published(live_service) is False
    # The rest of the profile still saves.
    edited = client.patch(f"{API}/me/provider", headers=pat, json={"bio": "Twenty years of taps."})
    assert edited.status_code == 200, edited.text


def test_a_verified_provider_goes_live(client, live_service):
    pat = sign_in(live_service, PAT, "SERVICE_PROVIDER")

    response = client.patch(f"{API}/me/provider", headers=pat, json={"is_published": True})

    assert response.status_code == 200, response.text
    assert published(live_service) is True
    assert [provider["id"] for provider in client.get(f"{API}/providers").json()] == [PAT]
