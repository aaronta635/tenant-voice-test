"""Rental applications on the shared tables (plan §3 a6), under the strict fake.

The shared functions make every status change (tests/fake_rpcs/fa_rental.py
runs their bodies): a tenant applies through submit_rental_application, the
property's LANDLORD owner decides through review_rental_application, and a
tenant withdraws through mobile_withdraw_application, run as the tenant.
Each change is stamped and kept in application_status_events.
"""

from datetime import timedelta

import pytest

from app.schemas.profiles import sydney_today
from app.services import property_applications
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
    user_row,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
MOVE_IN = (sydney_today() + timedelta(days=40)).isoformat()


@pytest.fixture
def listing(strict_schema):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema)
    return listing_id


def _seed_application(db, listing_id: str, **over) -> dict:
    row = application_row(listing_id, last_status_at=NOW, **over)
    db.seed("rental_applications", [row])
    return row


def _stored(db, application_id: str) -> dict:
    return next(row for row in db.tables["rental_applications"] if row["id"] == application_id)


def _events(db) -> list[tuple]:
    return [(row["application_id"], row["from_status"], row["to_status"], row["changed_by_user_id"])
            for row in db.tables.get("application_status_events", [])]


# -- applying -----------------------------------------------------------------------
def test_applying_writes_a_stamped_application_and_its_first_event(client, strict_schema, as_profile, listing):
    as_profile(id=TENANT, role="tenant")

    response = client.post(f"{API}/applications", json={
        "property_id": listing, "message": "Keen to apply", "annual_income": 90000, "has_pets": True,
    })

    assert response.status_code == 201, response.text
    [row] = strict_schema.tables["rental_applications"]
    assert (row["listing_id"], row["applicant_user_id"], row["status"]) == (listing, TENANT, "SUBMITTED")
    # offer_weekly_rent is NOT NULL: without an offer the tenant applies at the asking rent.
    assert (row["offer_weekly_rent"], row["message"]) == (650, "Keen to apply")
    # submit_rental_application's own keys, and what the tenant shared under the keys the mobile app reads.
    assert row["metadata"] == {
        "source": "listing_detail_apply", "submittedByRole": "TENANT",
        "mobile": {"hasPets": True, "annualIncome": 90000},
    }
    assert row["updated_at"] and row["submitted_at"] and row["last_status_at"]
    assert _events(strict_schema) == [(row["id"], None, "SUBMITTED", TENANT)]
    assert [name for name, _ in strict_schema.rpc_calls] == ["submit_rental_application"]
    body = response.json()
    assert (body["id"], body["status"], body["rent_offered"], body["property_id"]) == (row["id"], "new", 650, listing)
    assert (body["has_pets"], body["annual_income"]) == (True, 90000)


def test_an_offered_rent_is_kept(client, strict_schema, as_profile, listing):
    as_profile(id=TENANT, role="tenant")

    response = client.post(f"{API}/applications", json={"property_id": listing, "rent_offered": 620,
                                                        "move_in_date": MOVE_IN})

    assert response.status_code == 201, response.text
    [row] = strict_schema.tables["rental_applications"]
    assert (row["offer_weekly_rent"], row["metadata"]["mobile"]["moveInDate"]) == (620, MOVE_IN)
    assert (response.json()["rent_offered"], response.json()["move_in_date"]) == (620, MOVE_IN)


def test_the_mobile_reads_the_lease_term_applied_for(client, strict_schema, as_profile):
    # mobile_my_rental_history reads leaseDuration when the listing gives no term.
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, listing={"lease_term_months": 12})
    as_profile(id=TENANT, role="tenant")

    assert client.post(f"{API}/applications", json={"property_id": listing_id}).status_code == 201

    assert strict_schema.tables["rental_applications"][0]["metadata"]["mobile"] == {
        "hasPets": False, "leaseDuration": "12 months",
    }


def test_the_owner_sees_what_a_mobile_applicant_shared(client, strict_schema, as_profile, listing):
    # mobile_submit_application keeps the app's details in metadata.mobile, a date as YYYY-MM-DD or DD/MM/YYYY.
    for applicant, move_in in ((TENANT, "2030-03-01"), (OTHER_TENANT, "15/04/2030")):
        _seed_application(strict_schema, listing, applicant=applicant, metadata={"mobile": {
            "moveInDate": move_in, "leaseDuration": "6 months", "occupants": 2, "hasPets": True, "pets": "A cat",
        }})
    _seed_application(strict_schema, listing, applicant=STRANGER, metadata={"mobile": {
        "moveInDate": "soon", "occupants": "two", "hasPets": "yes", "annualIncome": True,
    }})
    as_profile(id=OWNER, role="landlord")

    response = client.get(f"{API}/properties/{listing}/applications")

    assert response.status_code == 200, response.text
    shown = {row["tenant_id"]: row for row in response.json()}
    assert [(shown[who]["move_in_date"], shown[who]["occupants"], shown[who]["has_pets"], shown[who]["pets"])
            for who in (TENANT, OTHER_TENANT)] == [("2030-03-01", 2, True, "A cat"), ("2030-04-15", 2, True, "A cat")]
    # Values the web cannot read as its own are left out, never a failed list.
    odd = shown[STRANGER]
    assert (odd["move_in_date"], odd["occupants"], odd["has_pets"], odd["annual_income"]) == (None, None, False, None)


@pytest.mark.parametrize("status", ["APPLICATIONS_CLOSED", "PAUSED", "DRAFT", "LEASED", "ARCHIVED"])
def test_only_a_published_listing_takes_applications(client, strict_schema, as_profile, status):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, status=status)
    as_profile(id=TENANT, role="tenant")

    response = client.post(f"{API}/applications", json={"property_id": listing_id})

    assert response.status_code == 404
    assert not strict_schema.tables.get("rental_applications")


def test_applying_twice_is_a_conflict(client, strict_schema, as_profile, listing):
    as_profile(id=TENANT, role="tenant")
    assert client.post(f"{API}/applications", json={"property_id": listing}).status_code == 201

    assert client.post(f"{API}/applications", json={"property_id": listing}).status_code == 409
    assert len(strict_schema.tables["rental_applications"]) == 1


@pytest.mark.parametrize("status", ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED"])
def test_an_open_or_approved_application_blocks_another(client, strict_schema, as_profile, listing, status):
    application = _seed_application(strict_schema, listing, status=status)
    as_profile(id=TENANT, role="tenant")

    response = client.post(f"{API}/applications", json={"property_id": listing})

    assert (response.status_code, response.json()["detail"]) == (409, "You have already applied to this property")
    assert _stored(strict_schema, application["id"])["updated_at"] == NOW
    assert strict_schema.rpc_calls == []


@pytest.mark.parametrize("status", ["REJECTED", "WITHDRAWN", "EXPIRED"])
def test_a_closed_application_is_sent_again_as_new(client, strict_schema, as_profile, listing, status):
    # submit_rental_application reuses the row (one per tenant and listing) and replaces its metadata.
    application = _seed_application(strict_schema, listing, status=status,
                                    metadata={"mobile": {"moveInDate": "2026-02-01"}, "tenant_score": 3})
    as_profile(id=TENANT, role="tenant")

    response = client.post(f"{API}/applications", json={"property_id": listing, "rent_offered": 600,
                                                        "move_in_date": MOVE_IN, "message": "Trying again"})

    assert response.status_code == 201, response.text
    [row] = strict_schema.tables["rental_applications"]
    assert (row["id"], row["status"], row["offer_weekly_rent"], row["message"]) == (
        application["id"], "SUBMITTED", 600, "Trying again",
    )
    assert row["metadata"] == {"source": "listing_detail_apply", "resubmittedAt": row["submitted_at"],
                               "mobile": {"moveInDate": MOVE_IN, "hasPets": False}}
    assert _events(strict_schema) == [(row["id"], status, "SUBMITTED", TENANT)]
    assert [(n["title"], n["body"]) for n in strict_schema.tables["notifications"] if n["user_id"] == OWNER] == [
        ("Application resubmitted", "Tanya Tenant resubmitted an application for Harbour flat."),
    ]
    assert (response.json()["id"], response.json()["stage"], response.json()["tenant_score"]) == (
        application["id"], "submitted", None,
    )


def test_an_owner_cannot_apply_to_their_own_listing(client, strict_schema, as_profile):
    # The listing's owner holds a tenant account too: submit_rental_application refuses them (42501).
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, owner=TENANT)
    as_profile(id=TENANT, role="tenant")

    response = client.post(f"{API}/applications", json={"property_id": listing_id})

    assert (response.status_code, response.json()["detail"]) == (403, "You cannot apply to your own listing")
    assert not strict_schema.tables.get("rental_applications")


# -- the owner's side ------------------------------------------------------------------
@pytest.mark.parametrize(
    ("web", "shared"),
    [("new", {"SUBMITTED"}), ("reviewing", {"UNDER_REVIEW", "SHORTLISTED"}), ("approved", {"APPROVED"}),
     ("declined", {"REJECTED", "WITHDRAWN", "EXPIRED"})],
)
def test_owners_filter_applications_through_every_shared_status(client, strict_schema, as_profile, listing,
                                                                web, shared):
    # A tenant applies to a listing once (rental_applications_listing_id_applicant_user_id_key): one applicant
    # per status.
    statuses = ("SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED")
    applicants = {status: new_id() for status in statuses}
    strict_schema.seed("users", [user_row(id, f"{status.title()} Tenant") for status, id in applicants.items()])
    ids = {status: _seed_application(strict_schema, listing, status=status, applicant=applicants[status])["id"]
           for status in statuses}
    as_profile(id=OWNER, role="landlord")

    response = client.get(f"{API}/properties/{listing}/applications", params={"status": web})

    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {ids[status] for status in shared}
    assert {(row["status"], row["tenant_name"]) for row in response.json()} == {
        (web, f"{status.title()} Tenant") for status in shared}


def test_an_unknown_application_filter_is_a_bad_request(client, as_profile, listing):
    as_profile(id=OWNER, role="landlord")

    assert client.get(f"{API}/properties/{listing}/applications", params={"status": "pending"}).status_code == 400


def test_only_the_propertys_landlord_owner_decides(client, strict_schema, as_profile):
    # review_rental_application takes the property's owner, an active LANDLORD: the agent who manages
    # it is refused, and the listing's creator who owns nothing does not find it.
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, prop={"manager_user_id": MANAGER},
                                 listing={"created_by_user_id": STRANGER})
    application = _seed_application(strict_schema, listing_id)

    as_profile(id=STRANGER, role="landlord")
    assert client.get(f"{API}/properties/{listing_id}/applications").status_code == 404
    assert client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"}).status_code == 404

    as_profile(id=MANAGER, role="landlord")
    assert [row["id"] for row in client.get(f"{API}/properties/{listing_id}/applications").json()] == [
        application["id"]
    ]
    for body in ({"status": "reviewing"}, {"shortlisted": True}, {"status": "approved"}):
        response = client.patch(f"{API}/applications/{application['id']}", json=body)
        assert (response.status_code, response.json()["detail"]) == (403, "Active landlord access is required")
    assert _stored(strict_schema, application["id"])["status"] == "SUBMITTED"

    as_profile(id=OWNER, role="landlord")
    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"})
    assert (response.status_code, response.json()["status"]) == (200, "approved")
    assert [event[2:] for event in _events(strict_schema)] == [("APPROVED", OWNER)]


def test_a_landlord_managing_someone_elses_property_cannot_decide(client, strict_schema, as_profile):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, owner=STRANGER, prop={"manager_user_id": OWNER})
    application = _seed_application(strict_schema, listing_id)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "declined"})

    assert (response.status_code, response.json()["detail"]) == (403, "Application ownership could not be verified")
    assert _events(strict_schema) == []


def test_an_agent_owning_the_property_cannot_decide(client, strict_schema, as_profile):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, owner=MANAGER)
    application = _seed_application(strict_schema, listing_id)
    as_profile(id=MANAGER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"shortlisted": True})

    assert (response.status_code, response.json()["detail"]) == (403, "Active landlord access is required")
    assert _stored(strict_schema, application["id"])["status"] == "SUBMITTED"


def test_a_decision_stamps_the_application_and_records_the_step(client, strict_schema, as_profile, listing):
    application = _seed_application(strict_schema, listing)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"})

    assert response.status_code == 200, response.text
    stored = _stored(strict_schema, application["id"])
    assert stored["status"] == "APPROVED"
    assert stored["updated_at"] != NOW and stored["last_status_at"] != NOW
    assert _events(strict_schema) == [(application["id"], "SUBMITTED", "APPROVED", OWNER)]
    assert (response.json()["status"], response.json()["tenant_name"]) == ("approved", "Tanya Tenant")
    assert [(name, params["p_landlord_id"], params["p_status"]) for name, params in strict_schema.rpc_calls] == [
        ("review_rental_application", OWNER, "APPROVED"),
    ]


def test_approving_leases_the_listing_and_declines_the_other_open_applications(client, strict_schema, as_profile,
                                                                               listing):
    chosen = _seed_application(strict_schema, listing, status="SHORTLISTED")
    waiting = _seed_application(strict_schema, listing, applicant=OTHER_TENANT)
    withdrawn = _seed_application(strict_schema, listing, applicant=STRANGER, status="WITHDRAWN")
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{chosen['id']}", json={"status": "approved", "note": "Welcome!"})

    assert response.status_code == 200, response.text
    assert [_stored(strict_schema, row["id"])["status"] for row in (chosen, waiting, withdrawn)] == [
        "APPROVED", "REJECTED", "WITHDRAWN",
    ]
    assert next(row for row in strict_schema.tables["listings"] if row["id"] == listing)["status"] == "LEASED"
    assert _events(strict_schema) == [
        (chosen["id"], "SHORTLISTED", "APPROVED", OWNER), (waiting["id"], "SUBMITTED", "REJECTED", OWNER),
    ]
    assert {(n["user_id"], n["body"]) for n in strict_schema.tables["notifications"]} == {
        (TENANT, "Harbour flat is now approved."), (OTHER_TENANT, "Harbour flat is no longer available."),
    }
    # The listing is leased now: its page leaves the catalogue and nobody new applies.
    assert client.get(f"{API}/me/properties/{listing}").json()["listing_status"] == "leased"


@pytest.mark.parametrize(
    ("listing_status", "detail"),
    [("PAUSED", "Publish the listing again before approving an application for it."),
     ("DRAFT", "Publish the listing again before approving an application for it.")],
)
def test_an_application_is_approved_only_on_a_listing_open_or_closed_to_applications(
    client, strict_schema, as_profile, listing_status, detail,
):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, status=listing_status)
    application = _seed_application(strict_schema, listing_id)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"})

    assert (response.status_code, response.json()["detail"]) == (409, detail)
    assert _stored(strict_schema, application["id"])["status"] == "SUBMITTED"
    assert strict_schema.rpc_calls == []


def test_an_application_on_a_listing_closed_to_applications_is_approved(client, strict_schema, as_profile):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, status="APPLICATIONS_CLOSED")
    application = _seed_application(strict_schema, listing_id)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"})

    assert response.status_code == 200, response.text
    assert next(row for row in strict_schema.tables["listings"] if row["id"] == listing_id)["status"] == "LEASED"


@pytest.mark.parametrize(
    ("status", "body", "detail"),
    [("APPROVED", {"status": "declined"}, "This application was approved, so it can no longer be changed."),
     ("UNDER_REVIEW", {"status": "new"}, "An application can't go back to new once it has been looked at.")],
)
def test_a_move_the_database_refuses_is_refused_first(client, strict_schema, as_profile, status, body, detail):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, status="LEASED" if status == "APPROVED" else "PUBLISHED")
    application = _seed_application(strict_schema, listing_id, status=status)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json=body)

    assert (response.status_code, response.json()["detail"]) == (409, detail)
    assert _stored(strict_schema, application["id"])["status"] == status
    assert strict_schema.rpc_calls == []


def test_reviewing_keeps_a_shortlisted_application_shortlisted(client, strict_schema, as_profile, listing):
    application = _seed_application(strict_schema, listing, status="SHORTLISTED")
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "reviewing"})

    assert (response.status_code, response.json()["shortlisted"]) == (200, True)
    assert _stored(strict_schema, application["id"])["status"] == "SHORTLISTED"
    assert _stored(strict_schema, application["id"])["updated_at"] == NOW
    assert _events(strict_schema) == []


def test_shortlisting_an_application(client, strict_schema, as_profile, listing):
    application = _seed_application(strict_schema, listing, status="UNDER_REVIEW")
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"shortlisted": True})

    assert (response.status_code, response.json()["status"], response.json()["shortlisted"]) == (200, "reviewing", True)
    assert _events(strict_schema) == [(application["id"], "UNDER_REVIEW", "SHORTLISTED", OWNER)]


@pytest.mark.parametrize("status", ["WITHDRAWN", "EXPIRED"])
def test_an_application_the_tenant_or_time_closed_cannot_be_decided(client, strict_schema, as_profile, listing, status):
    application = _seed_application(strict_schema, listing, status=status)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"})

    assert response.status_code == 409
    assert _stored(strict_schema, application["id"])["status"] == status
    assert _events(strict_schema) == []


def test_a_decision_never_overwrites_a_withdrawal_made_meanwhile(client, strict_schema, as_profile, listing,
                                                                    monkeypatch):
    application = _seed_application(strict_schema, listing)
    owned_listing = property_applications.owned_listing

    def withdrawn_after_the_read(*args):
        # The owner's page read the application; the tenant withdraws before the decision is written.
        _stored(strict_schema, application["id"])["status"] = "WITHDRAWN"
        return owned_listing(*args)

    monkeypatch.setattr(property_applications, "owned_listing", withdrawn_after_the_read)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"status": "approved"})

    assert response.status_code == 409
    assert _stored(strict_schema, application["id"])["status"] == "WITHDRAWN"
    assert _events(strict_schema) == []


def test_a_tenant_score_is_merged_into_the_metadata(client, strict_schema, as_profile, listing):
    application = _seed_application(strict_schema, listing, metadata={"annual_income": 80000, "has_pets": False})
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/applications/{application['id']}", json={"tenant_score": 8.5})

    assert (response.status_code, response.json()["tenant_score"]) == (200, 8.5)
    stored = _stored(strict_schema, application["id"])
    assert stored["metadata"] == {"annual_income": 80000, "has_pets": False, "tenant_score": 8.5}
    assert (stored["status"], stored["last_status_at"], stored["updated_at"] != NOW) == ("SUBMITTED", NOW, True)
    assert _events(strict_schema) == []


# -- withdrawing ------------------------------------------------------------------------
def _as_tenant(as_profile, tenant: str = TENANT):
    """The tenant, with the token mobile_withdraw_application runs as."""
    as_profile(id=tenant, role="tenant", access_token=token_for(tenant))


@pytest.mark.parametrize("status", ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"])
def test_a_tenant_withdraws_until_the_owner_decides(client, strict_schema, as_profile, listing, status):
    application = _seed_application(strict_schema, listing, status=status)
    _as_tenant(as_profile)

    assert client.delete(f"{API}/applications/{application['id']}").status_code == 204

    stored = _stored(strict_schema, application["id"])
    assert stored["status"] == "WITHDRAWN"
    assert stored["updated_at"] != NOW and stored["last_status_at"] != NOW
    assert _events(strict_schema) == [(application["id"], status, "WITHDRAWN", TENANT)]
    assert [(n["user_id"], n["title"], n["body"]) for n in strict_schema.tables["notifications"]] == [
        (OWNER, "Application withdrawn", "Tanya Tenant withdrew their application for Harbour flat."),
    ]
    # It runs as the tenant, as the mobile app runs it.
    assert strict_schema.rpc_callers == [("mobile_withdraw_application", TENANT)]
    assert client.get(f"{API}/applications").json()[0]["status"] == "declined"


@pytest.mark.parametrize("status", ["APPROVED", "REJECTED", "EXPIRED"])
def test_a_decided_application_cannot_be_withdrawn(client, strict_schema, as_profile, status):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, status="LEASED" if status == "APPROVED" else "PUBLISHED")
    application = _seed_application(strict_schema, listing_id, status=status)
    _as_tenant(as_profile)

    response = client.delete(f"{API}/applications/{application['id']}")

    assert (response.status_code, response.json()["detail"]) == (422, "This application can no longer be withdrawn.")
    assert _stored(strict_schema, application["id"])["status"] == status
    assert _events(strict_schema) == []


def test_withdrawing_twice_changes_nothing(client, strict_schema, as_profile, listing):
    application = _seed_application(strict_schema, listing, status="WITHDRAWN")
    _as_tenant(as_profile)

    assert client.delete(f"{API}/applications/{application['id']}").status_code == 204
    assert _stored(strict_schema, application["id"])["updated_at"] == NOW
    assert _events(strict_schema) == []


def test_only_the_applicant_can_withdraw(client, strict_schema, as_profile, listing):
    application = _seed_application(strict_schema, listing)
    _as_tenant(as_profile, OTHER_TENANT)

    response = client.delete(f"{API}/applications/{application['id']}")

    assert (response.status_code, response.json()["detail"]) == (403, "You can only withdraw your own applications.")
    assert _stored(strict_schema, application["id"])["status"] == "SUBMITTED"


def test_a_malformed_application_id_is_not_found(client, strict_schema, as_profile, listing):
    _as_tenant(as_profile)

    assert client.delete(f"{API}/applications/not-an-id").status_code == 404
    assert strict_schema.rpc_calls == []
