"""What a tenant shares when applying, and who sees it (R25), under the strict fake.

A tenant applies with the details they choose and the documents they marked
shareable. The listing's owner or manager sees the application under that
listing, with the applicant's badge and rating, and opens a shared document
through a short-lived link while the application is open or approved.
Nobody else reads or decides it.
"""

from datetime import timedelta

import pytest

from app.main import app
from app.schemas.profiles import sydney_today
from app.services import documents, property_applications
from tests.factories_documents import BUCKET, document_row, stored_file
from tests.factories_identity import verify
from tests.factories_rental import (
    MANAGER,
    NOW,
    OTHER_TENANT,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    new_id,
    seed_listing,
    seed_people,
    token_for,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
MOVE_IN = (sydney_today() + timedelta(days=30)).isoformat()


@pytest.fixture
def listing(strict_schema):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, prop={"manager_user_id": MANAGER})
    return listing_id


def _document(db, owner: str = TENANT, *, shared: bool = True, on_file: bool = True, **over) -> dict:
    """A profile document of owner's, marked shareable with landlords unless shared is False."""
    document_id = new_id()
    path = stored_file(db, owner, name=f"{document_id[:8]}.pdf") if on_file else "mobile/elsewhere.pdf"
    over.setdefault("metadata", {"visibility": "applications" if shared else "private"})
    row = document_row(document_id, owner, file_url=path, **over)
    db.seed(documents.TABLE, [row])
    return row


def _apply(client, as_profile, listing: str, **fields):
    as_profile(id=TENANT, role="tenant")
    return client.post(f"{API}/applications", json={"property_id": listing, **fields})


def _owner_view(client, as_profile, listing: str, owner: str = OWNER) -> list[dict]:
    as_profile(id=owner, role="landlord")
    response = client.get(f"{API}/properties/{listing}/applications")
    assert response.status_code == 200, response.text
    return response.json()


# -- applying and seeing it under the property ---------------------------------------
def test_a_tenant_applies_and_the_owner_sees_it_under_that_property(client, strict_schema, as_profile, listing):
    other_listing, _ = seed_listing(strict_schema)

    response = _apply(client, as_profile, listing, move_in_date=MOVE_IN, occupants=2, has_pets=True,
                      pets="  One   old cat ", about="Nurse at the local hospital.\nQuiet, no smoking.",
                      rent_offered=640, message="Can move in early.")

    assert response.status_code == 201, response.text
    [shown] = _owner_view(client, as_profile, listing)
    assert (shown["id"], shown["property_id"], shown["tenant_id"]) == (response.json()["id"], listing, TENANT)
    assert (shown["tenant_name"], shown["stage"], shown["status"]) == ("Tanya Tenant", "submitted", "new")
    assert (shown["move_in_date"], shown["occupants"], shown["rent_offered"]) == (MOVE_IN, 2, 640)
    assert (shown["has_pets"], shown["pets"]) == (True, "One old cat")
    assert shown["about"] == "Nurse at the local hospital.\nQuiet, no smoking."
    assert shown["message"] == "Can move in early."
    assert _owner_view(client, as_profile, other_listing) == []
    # The manager decides as the owner does.
    assert [row["id"] for row in _owner_view(client, as_profile, listing, owner=MANAGER)] == [shown["id"]]


def test_the_owner_never_gets_the_applicants_phone_or_email(client, strict_schema, as_profile, listing):
    tenant = next(user for user in strict_schema.tables["users"] if user["id"] == TENANT)
    tenant.update(phone="0400 111 222")
    assert _apply(client, as_profile, listing).status_code == 201

    for owner in (OWNER, MANAGER):
        as_profile(id=owner, role="landlord")
        response = client.get(f"{API}/properties/{listing}/applications")
        assert response.status_code == 200, response.text
        assert "0400 111 222" not in response.text and tenant["email"] not in response.text
        assert response.json()[0]["tenant_phone"] is None


def test_the_owner_sees_the_applicants_verified_badge_and_rating(client, strict_schema, as_profile, listing):
    for user in strict_schema.tables["users"]:
        if user["id"] == TENANT:
            user["verification_status"] = "APPROVED"
    strict_schema.seed("reviews", [
        {"id": new_id(), "reviewer_user_id": OWNER, "reviewed_user_id": TENANT, "rating": rating,
         "landlord_rating": rating, "status": status, "updated_at": NOW}
        for rating, status in ((5, "PUBLISHED"), (4, "PUBLISHED"), (1, "HIDDEN"))
    ])
    assert _apply(client, as_profile, listing).status_code == 201

    [shown] = _owner_view(client, as_profile, listing)

    assert (shown["tenant_verified"], shown["tenant_rating_avg"], shown["tenant_review_count"]) == (True, 4.5, 2)


def test_an_unverified_applicant_without_reviews_has_no_badge_or_rating(client, strict_schema, as_profile, listing):
    assert _apply(client, as_profile, listing).status_code == 201
    # Only a verified tenant applies (R18); their ID went back to review since, and the badge with it.
    verify(strict_schema, TENANT, status="PENDING")

    [shown] = _owner_view(client, as_profile, listing)

    assert (shown["tenant_verified"], shown["tenant_rating_avg"], shown["tenant_review_count"]) == (False, None, 0)


def test_an_about_line_as_long_as_the_profiles_goes_with_the_application(client, strict_schema, as_profile,
                                                                          listing):
    # The apply form fills it from the profile's About me, which keeps up to 2,000 characters.
    long_about = "Quiet, tidy and reliable. " * 76
    assert len(long_about.strip()) <= 2000 < len(long_about.strip()) + 30

    response = _apply(client, as_profile, listing, about=long_about.strip())

    assert response.status_code == 201, response.text
    assert response.json()["about"] == long_about.strip()


def test_two_applications_sent_at_once_leave_one(client, strict_schema, as_profile, listing, monkeypatch):
    # The other request's application landed between this one's check and its call: the function
    # answers with that application and changes nothing, and this request adds nothing to it.
    passport = _document(strict_schema)
    other = application_row(listing, TENANT, created_at="2025-12-31T00:00:00+00:00", metadata={"mobile": {"occupants": 2}})
    strict_schema.seed("rental_applications", [other])
    monkeypatch.setattr(property_applications, "_application_for", lambda listing_id, tenant_id: None)

    response = _apply(client, as_profile, listing, document_ids=[passport["id"]], occupants=4)

    assert (response.status_code, response.json()["detail"]) == (409, "You have already applied to this property")
    [kept] = strict_schema.tables["rental_applications"]
    assert (kept["id"], kept["metadata"], kept["updated_at"]) == (other["id"], {"mobile": {"occupants": 2}}, NOW)
    assert strict_schema.tables.get("application_documents", []) == []
    assert strict_schema.tables.get("application_status_events", []) == []
    assert [row for row in strict_schema.tables.get("notifications", []) if row["user_id"] == OWNER] == []


@pytest.mark.parametrize("status", ["REJECTED", "WITHDRAWN"])
def test_an_application_sent_again_goes_with_only_the_documents_chosen_now(client, strict_schema, as_profile,
                                                                         listing, status):
    passport = _document(strict_schema)
    licence = _document(strict_schema, document_type="DRIVERS_LICENCE")
    first = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    strict_schema.tables["rental_applications"][0]["status"] = status

    # Sent again with no documents: the passport it went with before stays back.
    again = _apply(client, as_profile, listing)
    assert (again.status_code, again.json()["id"]) == (201, first["id"]), again.text
    assert strict_schema.tables.get("application_documents", []) == []
    assert _owner_view(client, as_profile, listing)[0]["documents"] == []

    # And again with another document: that one alone.
    strict_schema.tables["rental_applications"][0]["status"] = status
    third = _apply(client, as_profile, listing, document_ids=[licence["id"]])
    assert third.status_code == 201, third.text
    assert [row["metadata"] for row in strict_schema.tables["application_documents"]] == [
        {"profile_document_id": licence["id"]}]
    [shown] = _owner_view(client, as_profile, listing)
    assert [doc["document_type"] for doc in shown["documents"]] == ["DRIVERS_LICENCE"]


def test_two_applications_sent_again_at_once_leave_the_first_ones_details(client, strict_schema, as_profile,
                                                                         listing, monkeypatch):
    # Both read the declined application; the other request sent it again first, so the function answers
    # with that application unchanged and this request adds nothing to it.
    passport = _document(strict_schema)
    licence = _document(strict_schema, document_type="DRIVERS_LICENCE")
    first = _apply(client, as_profile, listing, document_ids=[passport["id"]], occupants=2).json()
    [stored] = strict_schema.tables["rental_applications"]
    stored["submitted_at"] = "2025-12-31T00:00:00+00:00"
    before = {key: (dict(value) if isinstance(value, dict) else value) for key, value in stored.items()}
    documents_before = [dict(row) for row in strict_schema.tables["application_documents"]]
    events_before = len(strict_schema.tables.get("application_status_events", []))
    notices_before = len(strict_schema.tables.get("notifications", []))
    monkeypatch.setattr(property_applications, "_application_for",
                        lambda listing_id, tenant_id: {**stored, "status": "REJECTED"})

    response = _apply(client, as_profile, listing, document_ids=[licence["id"]], occupants=4)

    assert (response.status_code, response.json()["detail"]) == (409, "You have already applied to this property")
    [kept] = strict_schema.tables["rental_applications"]
    assert (kept["id"], kept["metadata"], kept["submitted_at"]) == (first["id"], before["metadata"],
                                                                    before["submitted_at"])
    assert strict_schema.tables["application_documents"] == documents_before
    assert len(strict_schema.tables.get("application_status_events", [])) == events_before
    assert len(strict_schema.tables.get("notifications", [])) == notices_before


def test_the_server_copies_nothing_from_the_tenants_profile(client, strict_schema, as_profile, listing):
    # The apply form prefills from the profile in the browser; what the tenant sends is all that is shared.
    strict_schema.seed("tenant_profiles", [{
        "user_id": TENANT, "about_me": "Profile about", "budget_max": 600, "household_size": 4, "has_pets": True,
        "move_in_date": MOVE_IN, "metadata": {"household": {"pets": "A dog"}}, "updated_at": NOW,
    }])

    response = _apply(client, as_profile, listing)

    assert response.status_code == 201, response.text
    [row] = strict_schema.tables["rental_applications"]
    assert row["metadata"]["mobile"] == {"hasPets": False}
    assert row["offer_weekly_rent"] == 650
    body = response.json()
    assert (body["occupants"], body["has_pets"], body["about"], body["move_in_date"]) == (None, False, None, None)


def test_pet_details_are_kept_only_with_pets(client, strict_schema, as_profile, listing):
    response = _apply(client, as_profile, listing, has_pets=False, pets="A dog")

    assert response.status_code == 201, response.text
    assert strict_schema.tables["rental_applications"][0]["metadata"]["mobile"] == {"hasPets": False}
    assert response.json()["pets"] is None


@pytest.mark.parametrize(
    "fields",
    [
        {"move_in_date": (sydney_today() - timedelta(days=1)).isoformat()},
        {"occupants": 0},
        {"rent_offered": 0},
        # Longer than a profile's About me may be (schemas/profiles.About).
        {"about": "x" * 2001},
        {"household_size": 3},
        {"document_ids": [new_id() for _ in range(11)]},
    ],
)
def test_an_application_outside_the_rules_is_refused_and_writes_nothing(client, strict_schema, as_profile,
                                                                         listing, fields):
    response = _apply(client, as_profile, listing, **fields)

    assert response.status_code == 422, response.text
    assert not strict_schema.tables.get("rental_applications")


# -- shared documents ----------------------------------------------------------------
def test_documents_marked_shareable_go_with_the_application(client, strict_schema, as_profile, listing):
    passport = _document(strict_schema, document_type="PASSPORT", status="verified")
    payslip = _document(strict_schema, document_type="OTHER", metadata={
        "visibility": "applications", "web_type": "payslip",
    })

    response = _apply(client, as_profile, listing, document_ids=[passport["id"], payslip["id"], passport["id"]])

    assert response.status_code == 201, response.text
    rows = strict_schema.tables["application_documents"]
    assert [(row["document_type"], row["file_url"], row["metadata"]) for row in rows] == [
        ("PASSPORT", passport["file_url"], {"profile_document_id": passport["id"]}),
        ("OTHER", payslip["file_url"], {"profile_document_id": payslip["id"]}),
    ]
    assert {(row["application_id"], row["status"]) for row in rows} == {(response.json()["id"], "UPLOADED")}
    assert all(row["id"] and row["updated_at"] for row in rows)
    [shown] = _owner_view(client, as_profile, listing)
    assert [(doc["label"], doc["verified"], doc["shared"]) for doc in shown["documents"]] == [
        ("Passport", True, True), ("Payslip", False, True),
    ]


@pytest.mark.parametrize(
    "kind",
    ["private", "someone else's", "not stored by the website", "unknown", "not an id"],
)
def test_only_documents_the_tenant_marked_shareable_can_be_attached(client, strict_schema, as_profile, listing, kind):
    shared = _document(strict_schema)
    # The tenant's second document is of another type: one per type (profile_documents_user_id_document_type_key).
    other = {
        "private": lambda: _document(strict_schema, shared=False, document_type="DRIVERS_LICENCE")["id"],
        "someone else's": lambda: _document(strict_schema, OTHER_TENANT)["id"],
        "not stored by the website": lambda: _document(strict_schema, on_file=False,
                                                       document_type="DRIVERS_LICENCE")["id"],
        "unknown": new_id,
        "not an id": lambda: "passport",
    }[kind]()

    response = _apply(client, as_profile, listing, document_ids=[shared["id"], other])

    assert (response.status_code, response.json()["detail"]) == (
        422, "Only documents you chose to share with landlords can go with an application.",
    )
    assert not strict_schema.tables.get("rental_applications")
    assert not strict_schema.tables.get("application_documents")


def test_a_failed_document_write_leaves_no_application(client, strict_schema, as_profile, listing, monkeypatch):
    from tests.factories_identity import fail_inserts

    passport = _document(strict_schema)
    fail_inserts(monkeypatch, "application_documents")

    response = _apply(client, as_profile, listing, document_ids=[passport["id"]])

    assert response.status_code == 500
    assert strict_schema.tables["rental_applications"] == []
    assert not strict_schema.tables.get("application_status_events")


def test_the_owner_opens_a_shared_document_through_a_link_that_works_for_minutes(client, strict_schema, as_profile,
                                                                                  listing):
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    [shown] = _owner_view(client, as_profile, listing)
    [attached] = shown["documents"]

    response = client.get(f"{API}/applications/{application['id']}/documents/{attached['id']}/link")

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["expires_in"] == documents.LINK_TTL == 300
    assert strict_schema.storage.signatures[-1] == (BUCKET, passport["file_url"], documents.LINK_TTL)
    trail = [entry for entry in strict_schema.schema_tables["web"]["audit_log"] if ":" not in entry["action"]]
    assert ("application.document_opened", OWNER, application["id"]) in {
        (entry["action"], entry["actor_id"], entry["entity_id"]) for entry in trail
    }


def test_a_document_the_tenant_made_private_again_is_no_longer_shown_or_opened(client, strict_schema, as_profile,
                                                                                listing):
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    [attached] = application["documents"]
    passport_row = next(row for row in strict_schema.tables[documents.TABLE] if row["id"] == passport["id"])
    passport_row["metadata"] = {"visibility": "private"}

    [shown] = _owner_view(client, as_profile, listing)

    assert shown["documents"] == []
    assert client.get(f"{API}/applications/{application['id']}/documents/{attached['id']}/link").status_code == 404
    # The tenant still sees what went with the application, marked as no longer shared.
    as_profile(id=TENANT, role="tenant")
    [mine] = client.get(f"{API}/applications").json()
    assert [(doc["label"], doc["shared"]) for doc in mine["documents"]] == [("Passport", False)]


@pytest.mark.parametrize("status", ["WITHDRAWN", "REJECTED", "EXPIRED"])
def test_documents_stop_being_shared_once_the_application_closes(client, strict_schema, as_profile, listing, status):
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    [attached] = application["documents"]
    strict_schema.tables["rental_applications"][0]["status"] = status

    [shown] = _owner_view(client, as_profile, listing)

    assert shown["documents"] == []
    assert client.get(f"{API}/applications/{application['id']}/documents/{attached['id']}/link").status_code == 404


@pytest.mark.parametrize("change", [{"status": "reviewing"}, {"status": "new"}, {"status": "approved"},
                                    {"shortlisted": True}])
def test_a_declined_application_stays_declined_and_shares_nothing_again(client, strict_schema, as_profile, listing,
                                                                        change):
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    [attached] = application["documents"]
    as_profile(id=OWNER, role="landlord")
    assert client.patch(f"{API}/applications/{application['id']}", json={"status": "declined"}).status_code == 200

    response = client.patch(f"{API}/applications/{application['id']}", json=change)

    assert response.status_code == 409
    assert strict_schema.tables["rental_applications"][0]["status"] == "REJECTED"
    assert client.get(f"{API}/applications/{application['id']}/documents/{attached['id']}/link").status_code == 404
    as_profile(id=TENANT, role="tenant")
    [mine] = client.get(f"{API}/applications").json()
    assert (mine["stage"], mine["can_withdraw"]) == ("declined", False)


def test_an_approved_application_keeps_its_documents_shared(client, strict_schema, as_profile, listing):
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    as_profile(id=OWNER, role="landlord")
    assert client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"}).status_code == 200

    [shown] = _owner_view(client, as_profile, listing)

    [attached] = shown["documents"]
    assert client.get(f"{API}/applications/{application['id']}/documents/{attached['id']}/link").status_code == 200


def test_a_missing_file_is_a_bad_gateway_not_a_broken_link(client, strict_schema, as_profile, listing):
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    [attached] = application["documents"]
    strict_schema.storage.objects.pop((BUCKET, passport["file_url"]))
    as_profile(id=OWNER, role="landlord")

    assert client.get(f"{API}/applications/{application['id']}/documents/{attached['id']}/link").status_code == 502


# -- who may read and decide -------------------------------------------------------
@pytest.fixture
def applied(client, strict_schema, as_profile, listing):
    """Tanya's application with her shared passport: (application id, attached document id)."""
    passport = _document(strict_schema)
    application = _apply(client, as_profile, listing, document_ids=[passport["id"]]).json()
    return application["id"], application["documents"][0]["id"]


def test_another_owner_can_neither_read_decide_nor_open_documents(client, strict_schema, as_profile, listing, applied):
    application_id, document_id = applied
    as_profile(id=STRANGER, role="landlord")

    assert client.get(f"{API}/properties/{listing}/applications").status_code == 404
    assert client.patch(f"{API}/applications/{application_id}", json={"status": "approved"}).status_code == 404
    assert client.patch(f"{API}/applications/{application_id}", json={"shortlisted": True}).status_code == 404
    assert client.get(f"{API}/applications/{application_id}/documents/{document_id}/link").status_code == 404
    assert strict_schema.tables["rental_applications"][0]["status"] == "SUBMITTED"
    assert strict_schema.storage.signatures == []


@pytest.mark.parametrize("role", ["tenant", "service_provider"])
def test_only_landlords_read_and_decide_a_listings_applications(client, strict_schema, as_profile, listing, applied,
                                                                 role):
    application_id, document_id = applied
    as_profile(id=TENANT if role == "tenant" else OTHER_TENANT, role=role)

    assert client.get(f"{API}/properties/{listing}/applications").status_code == 403
    assert client.patch(f"{API}/applications/{application_id}", json={"status": "approved"}).status_code == 403
    assert client.get(f"{API}/applications/{application_id}/documents/{document_id}/link").status_code == 403
    assert strict_schema.tables["rental_applications"][0]["status"] == "SUBMITTED"


@pytest.mark.parametrize("role", ["landlord", "service_provider"])
def test_only_tenants_apply_list_and_withdraw(client, strict_schema, as_profile, listing, applied, role):
    application_id, _ = applied
    as_profile(id=OWNER, role=role)

    assert client.post(f"{API}/applications", json={"property_id": listing}).status_code == 403
    assert client.get(f"{API}/applications").status_code == 403
    assert client.delete(f"{API}/applications/{application_id}").status_code == 403
    assert len(strict_schema.tables["rental_applications"]) == 1


def test_signed_out_callers_reach_no_application_endpoint(client, listing, applied):
    application_id, document_id = applied
    app.dependency_overrides.clear()

    for method, path, body in (
        ("post", "/applications", {"property_id": listing}), ("get", "/applications", None),
        ("delete", f"/applications/{application_id}", None), ("get", f"/properties/{listing}/applications", None),
        ("patch", f"/applications/{application_id}", {"status": "approved"}),
        ("get", f"/applications/{application_id}/documents/{document_id}/link", None),
    ):
        kwargs = {"json": body} if body is not None else {}
        assert getattr(client, method)(f"{API}{path}", **kwargs).status_code == 401, (method, path)


def test_another_tenant_sees_none_of_the_application(client, strict_schema, as_profile, listing, applied):
    application_id, _ = applied
    as_profile(id=OTHER_TENANT, role="tenant", access_token=token_for(OTHER_TENANT))

    assert client.get(f"{API}/applications").json() == []
    # mobile_withdraw_application, run as them, finds no application of theirs.
    assert client.delete(f"{API}/applications/{application_id}").status_code == 403
    assert strict_schema.tables["rental_applications"][0]["status"] == "SUBMITTED"


def test_a_document_of_another_application_cannot_be_opened_through_this_one(client, strict_schema, as_profile,
                                                                              listing, applied):
    _, document_id = applied
    other = application_row(listing, OTHER_TENANT, last_status_at=NOW)
    strict_schema.seed("rental_applications", [other])
    as_profile(id=OWNER, role="landlord")

    assert client.get(f"{API}/applications/{other['id']}/documents/{document_id}/link").status_code == 404
    assert client.get(f"{API}/applications/not-an-id/documents/{document_id}/link").status_code == 404
