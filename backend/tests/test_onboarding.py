"""Onboarding for every role (R19), by direct API calls on the strict fake.

The tenant and landlord wizards save each step's answers through
/profiles/me and /me/documents, then the step to resume at through
/me/onboarding: users.metadata.onboarding.<role> = {step, completed_at}.
A provider's wizard saves through the provider workspace's own endpoints.
Each role signs up, walks through to the end and finds everything saved from
another browser; "Save & close" and a skip keep the step, so the wizard
resumes there. Only tenants and landlords have the key, each their own, and
a save merges into metadata the mobile app writes too.
"""

import itertools
from datetime import timedelta

import pytest

from app.schemas.profiles import sydney_today
from app.services import onboarding, profiles, public_profiles
from tests.factories import NOW
from tests.factories_documents import PDF
from tests.factories_identity import account, users_row, verify

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
URL = f"{API}/me/onboarding"
PROFILE = f"{API}/profiles/me"
TIA = "c0000000-0000-4000-8000-0000000000c1"
LEO = "c0000000-0000-4000-8000-0000000000c2"
MOVE_IN = (sydney_today() + timedelta(days=30)).isoformat()
NOT_STARTED = {"step": None, "completed_at": None}


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def sign_up(client, role: str, email: str, full_name: str) -> tuple[dict, str]:
    """A new account through the sign-up form's request; its headers and users.id."""
    response = client.post(f"{API}/auth/register", json={
        "email": email, "password": "password123", "full_name": full_name, "role": role,
    })
    assert response.status_code == 201, response.text
    return bearer(response.json()["access_token"]), response.json()["profile"]["id"]


def sign_in(client, email: str) -> dict:
    """Another browser: nothing shared with the first but the account."""
    response = client.post(f"{API}/auth/login", json={"email": email, "password": "password123"})
    assert response.status_code == 200, response.text
    return bearer(response.json()["access_token"])


def upload(client, headers: dict, document_type: str, name: str) -> None:
    response = client.post(f"{API}/me/documents", headers=headers, data={"document_type": document_type},
                           files={"file": (name, PDF, "application/pdf")})
    assert response.status_code == 201, response.text


def walk(client, headers: dict, steps: list[tuple[str, object]]) -> None:
    """Continue from each step to the next as the wizard does: the step's answers, then the step to resume at.

    Answers are a profile patch, or a function that saves them (an upload).
    """
    for (_step, answers), (following, _next_answers) in zip(steps, steps[1:]):
        if callable(answers):
            answers()
        elif answers is not None:
            saved = client.patch(PROFILE, headers=headers, json=answers)
            assert saved.status_code == 200, saved.text
        moved = client.put(URL, headers=headers, json={"step": following})
        assert moved.status_code == 200, moved.text
        assert moved.json()["step"] == following


def users(db) -> dict:
    return {row["id"]: row for row in db.tables["users"]}


@pytest.fixture(autouse=True)
def fresh_public_profiles(monkeypatch):
    """Public profiles read a cached scan of members; every read here sees the latest rows."""
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)


@pytest.fixture
def tia(strict_schema):
    """A signed-up tenant who has not started onboarding; returns her headers."""
    token = account(strict_schema, TIA, "tia@example.test", full_name="Tia Tenant")
    return bearer(token)


# -- each role, from sign-up to the end ---------------------------------------------
def test_a_tenant_signs_up_completes_every_step_and_finds_it_all_saved(client, fake_db):
    headers, tenant_id = sign_up(client, "tenant", "mei@example.test", "Mei Lin")
    assert client.get(URL, headers=headers).json() == {"role": "tenant", **NOT_STARTED}

    walk(client, headers, [
        ("welcome", None),
        ("personal", {"phone": "0400 111 222", "location": "Newtown", "state": "NSW"}),
        ("household", {"tenant": {"household_size": 2, "has_pets": True, "household": {
            "members": [{"name": "Sam Lin", "age": 31, "relationship": "Partner"}], "pets": "One cat"}}}),
        ("locations", {"tenant": {"preferred_locations": ["Newtown", "Glebe", "Enmore"]}}),
        ("budget", {"tenant": {"budget_min": 450, "budget_max": 700, "move_in_date": MOVE_IN}}),
        ("property", {"tenant": {"rental_preferences": {"property_types": ["apartment"], "bedrooms_min": 2}}}),
        ("employment", {"tenant": {"employment": {"types": ["full_time"], "employer": "RPA", "job_title": "Nurse"}}}),
        ("qualities", {"tenant": {"qualities": {"tags": ["reliable_rent", "long_term_stay"]}}}),
        ("about", {"tenant": {"about_me": "Quiet nurse who keeps a tidy home."}}),
        ("history", {"tenant": {"rental_history": [{
            "address": "12/55 Martin Place", "suburb": "Sydney", "state": "NSW", "start_date": "2021-02-01",
            "current": True, "weekly_rent": 650, "bond_returned": "pending"}]}}),
        ("documents", lambda: upload(client, headers, "PASSPORT", "Passport.pdf")),
        ("emergency", {"tenant": {"emergency_contact": {"name": "Ines Lin", "phone": "0411 222 333"}}}),
        ("preview", None),
        ("publish", None),
    ])
    # The preview step shows the public card the API builds; the last step keeps it listed and finishes.
    card = client.get(f"{API}/public/profiles/{tenant_id}")
    assert (card.status_code, card.json()["display_name"]) == (200, "Mei L."), card.text
    finished = client.put(URL, headers=headers, json={"step": "publish", "completed": True})
    assert finished.status_code == 200, finished.text
    assert finished.json()["completed_at"] is not None

    again = sign_in(client, "mei@example.test")
    assert client.get(URL, headers=again).json() == finished.json()
    me = client.get(PROFILE, headers=again).json()
    assert (me["phone"], me["location"], me["tenant"]["budget_max"]) == ("0400 111 222", "Newtown", 700)
    assert me["tenant"]["employment"]["employer"] == "RPA"
    assert me["tenant"]["rental_history"][0]["address"] == "12/55 Martin Place"
    done = {item["key"] for item in me["completion"]["items"] if item["done"]}
    assert {"personal_details", "employment", "primary_id", "rental_history", "property_preferences",
            "availability"} <= done
    assert users(fake_db)[tenant_id]["metadata"]["onboarding"] == {
        "tenant": {"step": "publish", "completed_at": finished.json()["completed_at"].replace("Z", "+00:00")},
    }


def test_a_landlord_signs_up_completes_every_step_and_can_stay_out_of_search(client, fake_db):
    headers, landlord_id = sign_up(client, "landlord", "leo@example.test", "Leo Landlord")
    assert client.get(URL, headers=headers).json() == {"role": "landlord", **NOT_STARTED}

    def documents():
        upload(client, headers, "GOVERNMENT_PHOTO_ID", "Licence.pdf")
        upload(client, headers, "PROOF_OF_PROPERTY_OWNERSHIP", "Rates notice.pdf")

    walk(client, headers, [
        ("welcome", None),
        ("personal", {"phone": "0400 333 444", "location": "Marrickville", "state": "NSW"}),
        ("business", {"landlord": {"agency_name": "Harbour Homes", "license_number": "20012345",
                                   "portfolio_size": 3}}),
        ("about", {"landlord": {"bio": "Family-run rentals in the inner west."}}),
        ("documents", documents),
        ("preview", None),
        ("publish", None),
    ])
    # The last step: kept out of profile search, then finished.
    hidden = client.patch(PROFILE, headers=headers, json={"settings": {"privacy": {"public_profile": False}}})
    assert hidden.status_code == 200, hidden.text
    finished = client.put(URL, headers=headers, json={"step": "publish", "completed": True})
    assert finished.status_code == 200, finished.text

    again = sign_in(client, "leo@example.test")
    progress = client.get(URL, headers=again).json()
    assert (progress["role"], progress["step"], progress["completed_at"] is not None) == ("landlord", "publish", True)
    me = client.get(PROFILE, headers=again).json()
    assert me["landlord"] == {"agency_name": "Harbour Homes", "license_number": "20012345", "portfolio_size": 3,
                              "bio": "Family-run rentals in the inner west."}
    assert me["settings"]["privacy"]["public_profile"] is False
    checklist = client.get(f"{API}/me/documents", headers=again).json()
    assert [item["status"] for item in checklist["requirements"]] == ["pending", "pending"]
    assert client.get(f"{API}/public/profiles/{landlord_id}").status_code == 404


def test_a_provider_signs_up_and_every_wizard_step_saves_on_the_shared_tables(client, fake_db):
    """The provider wizard's requests in its order (dashboard/onboarding/page.tsx), ending published.

    Going live needs a verified provider (services/gates.py): the wizard's last
    step is refused while the documents are in review, and works once an
    admin has approved the account.
    """
    headers, provider_id = sign_up(client, "service_provider", "nina@example.test", "Nina New")
    mine = client.get(f"{API}/me/provider", headers=headers)
    assert (mine.status_code, mine.json()["category"], mine.json()["is_published"]) == (200, None, False)

    steps = [
        # 1: category; 2: a priced service; 3: the service area; 4: a credential; 5: the public profile.
        ("patch", "/me/provider", {"category": "cleaner"}),
        ("post", "/me/services", {"title": "Bond clean", "price": 300, "pricing_type": "flat", "is_active": True,
                                  "description": "Bond-back cleans for apartments."}),
        ("patch", "/profiles/me", {"location": "Parramatta", "state": "NSW"}),
        ("patch", "/me/provider", {"service_radius_km": 20}),
        ("post", "/me/verification-documents", {"type": "abn", "label": "ABN registration", "document_url": None}),
        ("patch", "/me/provider", {"business_name": "Nina Cleans", "bio": "Ten years of bond cleans.",
                                   "headline": "Bond cleans", "tagline": "Bond cleans"}),
    ]
    for method, path, body in steps:
        response = getattr(client, method)(f"{API}{path}", headers=headers, json=body)
        assert response.status_code in (200, 201), f"{method} {path}: {response.text}"
        assert client.get(f"{API}/me/provider", headers=headers).status_code == 200
    # 6: go live, refused while the documents are in review; nothing is published.
    live = {"business_name": "Nina Cleans", "bio": "Ten years of bond cleans.", "headline": "Bond cleans",
            "tagline": "Bond cleans", "is_published": True}
    refused = client.patch(f"{API}/me/provider", headers=headers, json=live)
    assert refused.status_code == 403, refused.text
    assert (refused.json()["detail"]["action"], refused.json()["detail"]["status"]) == ("go_live", "pending")
    assert client.get(f"{API}/me/provider", headers=headers).json()["is_published"] is False
    # Step 4 again, with a file: the credentials component stores it, then saves the credential.
    stored = client.post(f"{API}/uploads/verification-document", headers=headers,
                         files={"file": ("Licence.pdf", PDF, "application/pdf")})
    assert stored.status_code == 200, stored.text
    credential = client.post(f"{API}/me/verification-documents", headers=headers,
                             json={"type": "id", "label": "Government ID", "document_url": stored.json()["path"]})
    assert credential.status_code == 201, credential.text
    # An admin approves the account, and step 6 goes through.
    verify(fake_db, provider_id)
    published = client.patch(f"{API}/me/provider", headers=headers, json=live)
    assert published.status_code == 200, published.text

    again = sign_in(client, "nina@example.test")
    mine = client.get(f"{API}/me/provider", headers=again).json()
    assert (mine["category"], mine["business_name"], mine["service_radius_km"], mine["is_published"]) == (
        "cleaner", "Nina Cleans", 20, True,
    )
    assert mine["profile_completion"] == 100
    assert [service["title"] for service in client.get(f"{API}/me/services", headers=again).json()] == ["Bond clean"]
    documents = client.get(f"{API}/me/verification-documents", headers=again).json()
    assert sorted((document["type"], document["status"]) for document in documents) == [("abn", "pending"), ("id", "pending")]
    assert {row["document_type"] for row in fake_db.tables["profile_documents"]} == {"OTHER", "GOVERNMENT_PHOTO_ID"}
    assert client.get(f"{API}/me/onboarding", headers=again).status_code == 403
    assert [provider["id"] for provider in client.get(f"{API}/providers").json()] == [provider_id]


# -- resuming -------------------------------------------------------------------------
def test_save_and_close_keeps_the_answers_and_the_step_for_another_browser(client, fake_db):
    headers, _ = sign_up(client, "tenant", "mei@example.test", "Mei Lin")
    client.put(URL, headers=headers, json={"step": "personal"})
    # On the budget step: Save & close saves its answers, then the step itself.
    client.patch(PROFILE, headers=headers, json={"tenant": {"budget_min": 400, "budget_max": 600}})
    closed = client.put(URL, headers=headers, json={"step": "budget"})
    assert closed.json() == {"role": "tenant", "step": "budget", "completed_at": None}

    again = sign_in(client, "mei@example.test")
    assert client.get(URL, headers=again).json() == {"role": "tenant", "step": "budget", "completed_at": None}
    assert client.get(PROFILE, headers=again).json()["tenant"]["budget_max"] == 600


def test_a_skip_from_the_welcome_step_counts_as_started_but_not_finished(client, tia):
    skipped = client.put(URL, headers=tia, json={"step": "welcome"})

    assert skipped.status_code == 200, skipped.text
    assert client.get(URL, headers=tia).json() == {"role": "tenant", "step": "welcome", "completed_at": None}


def test_finishing_is_kept_when_the_steps_are_gone_through_again(client, fake_db, tia):
    first = client.put(URL, headers=tia, json={"step": "publish", "completed": True}).json()
    revisited = client.put(URL, headers=tia, json={"step": "budget"}).json()
    finished_again = client.put(URL, headers=tia, json={"step": "publish", "completed": True}).json()

    assert first["completed_at"] is not None
    assert revisited == {"role": "tenant", "step": "budget", "completed_at": first["completed_at"]}
    assert finished_again == {**first, "step": "publish"}


def test_a_save_that_changes_nothing_writes_nothing(client, fake_db, tia):
    client.put(URL, headers=tia, json={"step": "budget"})
    stamped = users(fake_db)[TIA]["updated_at"]

    again = client.put(URL, headers=tia, json={"step": "budget"})

    assert again.json()["step"] == "budget"
    assert users(fake_db)[TIA]["updated_at"] == stamped


# -- who may -----------------------------------------------------------------------------
@pytest.mark.parametrize("method", ["get", "put"])
def test_a_signed_out_visitor_is_refused(client, fake_db, method):
    response = getattr(client, method)(URL, json={"step": "personal"}) if method == "put" else client.get(URL)
    assert response.status_code == 401


@pytest.mark.parametrize("primary_role", ["SERVICE_PROVIDER", "ADMIN", "REGULATOR"])
def test_providers_and_staff_are_refused_and_nothing_is_written(client, strict_schema, primary_role):
    token = account(strict_schema, LEO, "leo@example.test", primary_role)

    read = client.get(URL, headers=bearer(token))
    saved = client.put(URL, headers=bearer(token), json={"step": "personal"})

    assert (read.status_code, saved.status_code) == (403, 403)
    assert users(strict_schema)[LEO]["metadata"] == {}
    assert users(strict_schema)[LEO]["updated_at"] == NOW


def test_a_suspended_member_is_refused(client, strict_schema):
    token = account(strict_schema, TIA, "tia@example.test", status="SUSPENDED")

    assert client.put(URL, headers=bearer(token), json={"step": "personal"}).status_code == 403
    assert users(strict_schema)[TIA]["metadata"] == {}


def test_an_agent_keeps_a_landlords_place(client, strict_schema):
    token = account(strict_schema, LEO, "leo@example.test", "AGENT")

    saved = client.put(URL, headers=bearer(token), json={"step": "business"})

    assert saved.json() == {"role": "landlord", "step": "business", "completed_at": None}
    assert users(strict_schema)[LEO]["metadata"] == {"onboarding": {"landlord": {"step": "business"}}}


def test_each_member_saves_only_their_own_place(client, strict_schema, tia):
    other = account(strict_schema, LEO, "leo@example.test", "LANDLORD")

    client.put(URL, headers=tia, json={"step": "budget"})
    client.put(URL, headers=bearer(other), json={"step": "about"})

    assert users(strict_schema)[TIA]["metadata"] == {"onboarding": {"tenant": {"step": "budget"}}}
    assert users(strict_schema)[LEO]["metadata"] == {"onboarding": {"landlord": {"step": "about"}}}
    assert client.get(URL, headers=tia).json()["step"] == "budget"


# -- what is stored ------------------------------------------------------------------------
def test_a_save_merges_into_metadata_and_keeps_every_other_key(client, strict_schema):
    stored = {
        "location": "Newtown", "privacy": {"public_profile": False},
        "mobile_app": {"theme": "dark"},
        "onboarding": {"landlord": {"step": "about"}, "mobile_flow": {"done": True},
                       "tenant": {"step": "budget", "seen_tips": None}},
    }
    token = account(strict_schema, TIA, "tia@example.test", metadata=stored)

    saved = client.put(URL, headers=bearer(token), json={"step": "property", "completed": True})

    assert saved.status_code == 200, saved.text
    metadata = users(strict_schema)[TIA]["metadata"]
    completed_at = metadata["onboarding"]["tenant"].pop("completed_at")
    assert metadata == {**stored, "onboarding": {**stored["onboarding"],
                                                 "tenant": {"step": "property", "seen_tips": None}}}
    assert saved.json()["completed_at"].startswith(completed_at[:19])
    assert users(strict_schema)[TIA]["updated_at"] != NOW


@pytest.mark.parametrize("shape", [
    {"onboarding": "done"},
    {"onboarding": ["tenant"]},
    {"onboarding": {"tenant": "budget"}},
    {"onboarding": {"tenant": True}},
])
def test_a_place_another_app_stored_in_another_shape_is_never_overwritten(client, strict_schema, shape):
    token = account(strict_schema, TIA, "tia@example.test", metadata=shape)

    read = client.get(URL, headers=bearer(token))
    saved = client.put(URL, headers=bearer(token), json={"step": "budget"})

    assert read.json() == {"role": "tenant", **NOT_STARTED}
    assert (saved.status_code, saved.json()) == (409, {"detail": onboarding.ANOTHER_SHAPE})
    assert users(strict_schema)[TIA]["metadata"] == shape
    assert users(strict_schema)[TIA]["updated_at"] == NOW


def test_values_the_wizard_cannot_use_read_as_not_saved(client, strict_schema):
    token = account(strict_schema, TIA, "tia@example.test", metadata={
        "onboarding": {"tenant": {"step": "Rent & timing", "completed_at": "yesterday"}},
    })

    assert client.get(URL, headers=bearer(token)).json() == {"role": "tenant", **NOT_STARTED}
    saved = client.put(URL, headers=bearer(token), json={"step": "budget", "completed": True}).json()
    assert saved["step"] == "budget" and saved["completed_at"] is not None


@pytest.mark.parametrize("body", [
    {},
    {"step": ""},
    {"step": "Budget"},
    {"step": "rent timing"},
    {"step": "../budget"},
    {"step": "1-budget"},
    {"step": "b" * 41},
    {"step": 3},
    {"step": "budget", "completed": "yes"},
    {"step": "budget", "completed_at": "2026-01-01T00:00:00Z"},
])
def test_a_save_is_checked_before_anything_is_written(client, strict_schema, tia, body):
    response = client.put(URL, headers=tia, json=body)

    assert response.status_code == 422, response.text
    assert users(strict_schema)[TIA]["metadata"] == {}


def test_a_save_never_overwrites_a_change_made_since_its_read(client, strict_schema, tia, monkeypatch):
    """The mobile app writes the row between our read and our write: ours starts again from its row."""
    real_read = profiles.get_user_row
    reads = []

    def read_then_mobile_writes(user_id):
        row = real_read(user_id)
        reads.append(row)
        if len(reads) == 1:
            stored = users(strict_schema)[TIA]
            stored["metadata"] = {"mobile_written": True}
            stored["updated_at"] = "2026-01-01T00:00:05+00:00"
        return row

    monkeypatch.setattr(profiles, "get_user_row", read_then_mobile_writes)
    response = client.put(URL, headers=tia, json={"step": "budget"})

    assert response.status_code == 200, response.text
    assert users(strict_schema)[TIA]["metadata"] == {"mobile_written": True,
                                                     "onboarding": {"tenant": {"step": "budget"}}}
    assert len(reads) == 2


def test_a_save_that_keeps_losing_races_is_a_conflict(client, strict_schema, tia, monkeypatch):
    real_read = profiles.get_user_row
    seconds = itertools.count(10)

    def read_then_someone_writes(user_id):
        row = real_read(user_id)
        users(strict_schema)[TIA]["updated_at"] = f"2026-01-01T00:00:{next(seconds)}+00:00"
        return row

    monkeypatch.setattr(profiles, "get_user_row", read_then_someone_writes)
    response = client.put(URL, headers=tia, json={"step": "budget"})

    assert (response.status_code, response.json()) == (409, {"detail": profiles.CHANGED_ELSEWHERE})
    assert users(strict_schema)[TIA]["metadata"] == {}


def test_a_closed_account_has_no_place_to_save(strict_schema):
    strict_schema.seed("users", [users_row(TIA, "tia@example.test", deleted_at=NOW)])

    with pytest.raises(Exception) as refused:
        onboarding.save_progress(TIA, "tenant", "budget")

    assert getattr(refused.value, "status_code", None) == 404
    assert users(strict_schema)[TIA]["metadata"] == {}
