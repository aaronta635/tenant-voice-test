"""An application's history, the owner's notes and the tenant's list (R25), under the strict fake.

Every status change is an application_status_events row; the owner's note
goes with the decision, into the history the applicant reads. The notices
are the shared functions' (review_rental_application,
submit_rental_application), which link to the mobile app's page. The
tenant's list names the real listing, even one that is no longer advertised.
"""

import pytest

from tests.factories_rental import (
    MANAGER,
    NOW,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    media_row,
    new_id,
    seed_listing,
    seed_people,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
ADMIN = "c6666666-6666-4666-8666-666666666666"


@pytest.fixture
def listing(strict_schema):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, prop={"manager_user_id": MANAGER})
    return listing_id


@pytest.fixture
def application(client, as_profile, listing) -> str:
    as_profile(id=TENANT, role="tenant")
    response = client.post(f"{API}/applications", json={"property_id": listing})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _decide(client, as_profile, application_id: str, by: str = OWNER, **body):
    as_profile(id=by, role="landlord")
    return client.patch(f"{API}/applications/{application_id}", json=body)


def _notices(db, user_id: str) -> list[tuple]:
    return [(row["title"], row["body"], row["link"], row["category"])
            for row in db.tables.get("notifications", []) if row["user_id"] == user_id]


def test_each_step_is_kept_with_who_made_it_and_the_note(client, strict_schema, as_profile, application):
    assert _decide(client, as_profile, application, shortlisted=True).status_code == 200
    response = _decide(client, as_profile, application, status="approved", note="  Welcome! Keys on Friday.  ")

    assert response.status_code == 200, response.text
    assert [(step["from_stage"], step["to_stage"], step["by"], step["note"]) for step in response.json()["history"]] == [
        (None, "submitted", "applicant", None),
        ("submitted", "shortlisted", "landlord", None),
        ("shortlisted", "approved", "landlord", "Welcome! Keys on Friday."),
    ]
    events = strict_schema.tables["application_status_events"]
    assert [(row["to_status"], row["changed_by_user_id"], row["note"]) for row in events] == [
        ("SUBMITTED", TENANT, None), ("SHORTLISTED", OWNER, None), ("APPROVED", OWNER, "Welcome! Keys on Friday."),
    ]


def test_the_owner_reads_the_history_on_the_listings_applications(client, as_profile, listing, application):
    _decide(client, as_profile, application, status="declined", note="We chose a family.")

    [shown] = client.get(f"{API}/properties/{listing}/applications").json()

    assert [step["to_stage"] for step in shown["history"]] == ["submitted", "declined"]
    assert (shown["stage"], shown["status"], shown["can_withdraw"]) == ("declined", "declined", False)


def test_a_step_someone_else_made_is_not_put_on_the_applicant_or_landlord(client, strict_schema, as_profile, listing,
                                                                           application):
    strict_schema.seed("users", [{"id": ADMIN, "email": "admin@example.test", "primary_role": "ADMIN",
                                  "updated_at": NOW}])
    strict_schema.seed("application_status_events", [
        {"application_id": application, "from_status": "SUBMITTED", "to_status": "UNDER_REVIEW",
         "changed_by_user_id": ADMIN, "created_at": "2030-01-01T00:00:00+00:00"},
        {"application_id": application, "from_status": "UNDER_REVIEW", "to_status": "EXPIRED",
         "changed_by_user_id": None, "created_at": "2030-01-02T00:00:00+00:00"},
    ])
    as_profile(id=OWNER, role="landlord")

    [shown] = client.get(f"{API}/properties/{listing}/applications").json()

    assert [(step["to_stage"], step["by"]) for step in shown["history"]] == [
        ("submitted", "applicant"), ("under_review", None), ("expired", None),
    ]


def test_a_decision_and_its_note_reach_the_applicant(client, strict_schema, as_profile, application):
    _decide(client, as_profile, application, status="declined", note="We chose a family with a longer lease.")

    assert _notices(strict_schema, TENANT) == [(
        "Application status updated", "Harbour flat is now rejected.", "/admin/applications", "system",
    )]
    as_profile(id=TENANT, role="tenant")
    [mine] = client.get(f"{API}/applications").json()
    assert mine["history"][-1]["note"] == "We chose a family with a longer lease."


@pytest.mark.parametrize(
    ("body", "said"),
    [({"status": "approved"}, "Harbour flat is now approved."),
     ({"shortlisted": True}, "Harbour flat is now shortlisted."),
     ({"status": "reviewing"}, "Harbour flat is now under review.")],
)
def test_every_decision_tells_the_applicant(client, strict_schema, as_profile, application, body, said):
    assert _decide(client, as_profile, application, **body).status_code == 200

    assert _notices(strict_schema, TENANT) == [("Application status updated", said, "/admin/applications", "system")]


def test_a_note_goes_only_with_a_decision(client, strict_schema, as_profile, application):
    response = _decide(client, as_profile, application, note="Thinking about it")

    assert response.status_code == 422
    assert [row["to_status"] for row in strict_schema.tables["application_status_events"]] == ["SUBMITTED"]
    assert _notices(strict_schema, TENANT) == []


def test_applying_tells_the_owner_and_the_manager_where_to_find_it(client, strict_schema, listing, application):
    # submit_rental_application tells the owner; the web tells the manager, whom it does not.
    assert _notices(strict_schema, OWNER) == [(
        "New rental application", "Tanya Tenant applied for Harbour flat.", "/admin/applications", "system",
    )]
    assert _notices(strict_schema, MANAGER) == [(
        "New application for Harbour flat", "Tanya Tenant applied.",
        f"/owner/properties/{listing}?tab=applications", "project",
    )]
    assert _notices(strict_schema, STRANGER) == []


def test_an_owner_who_manages_their_own_property_gets_the_one_notice(client, strict_schema, as_profile):
    # submit_rental_application tells the owner; the web's manager notice would be a second one for them.
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, prop={"manager_user_id": OWNER})
    as_profile(id=TENANT, role="tenant")

    assert client.post(f"{API}/applications", json={"property_id": listing_id}).status_code == 201

    assert [title for title, *_ in _notices(strict_schema, OWNER)] == ["New rental application"]


def test_an_application_sent_again_tells_the_manager_it_was_resubmitted(client, strict_schema, as_profile,
                                                                        listing, application):
    _decide(client, as_profile, application, status="declined")
    as_profile(id=TENANT, role="tenant")

    assert client.post(f"{API}/applications", json={"property_id": listing}).status_code == 201

    assert _notices(strict_schema, MANAGER)[-1][:2] == ("Application resubmitted for Harbour flat",
                                                        "Tanya Tenant applied again.")


# -- the tenant's list ----------------------------------------------------------------
def test_the_tenants_list_names_the_real_listing_even_once_it_is_leased(client, strict_schema, as_profile):
    seed_people(strict_schema)
    advertised, _ = seed_listing(strict_schema, listing={"title": "Harbour flat"})
    leased, leased_prop = seed_listing(strict_schema, status="LEASED", listing={"title": "Garden cottage"},
                                       prop={"suburb": "Newtown", "state": "NSW"})
    strict_schema.seed("property_media", [media_row(leased_prop, "https://cdn.example.test/cottage.jpg", 0, True)])
    strict_schema.seed("rental_applications", [
        application_row(advertised, created_at="2026-02-01T00:00:00+00:00"),
        application_row(leased, status="APPROVED", created_at="2026-01-01T00:00:00+00:00"),
    ])
    as_profile(id=TENANT, role="tenant")

    response = client.get(f"{API}/applications")

    assert response.status_code == 200, response.text
    assert [app["listing"] for app in response.json()] == [
        {"id": advertised, "title": "Harbour flat", "suburb": "Wollongong", "state": "NSW", "photo_url": None,
         "weekly_rent": 650.0, "is_public": True},
        {"id": leased, "title": "Garden cottage", "suburb": "Newtown", "state": "NSW",
         "photo_url": "https://cdn.example.test/cottage.jpg", "weekly_rent": 650.0, "is_public": False},
    ]


@pytest.mark.parametrize(
    ("status", "stage", "can_withdraw"),
    [("SUBMITTED", "submitted", True), ("UNDER_REVIEW", "under_review", True), ("SHORTLISTED", "shortlisted", True),
     ("APPROVED", "approved", False), ("REJECTED", "declined", False), ("WITHDRAWN", "withdrawn", False),
     ("EXPIRED", "expired", False)],
)
def test_withdraw_is_offered_only_while_the_owner_has_not_decided(client, strict_schema, as_profile, listing,
                                                                    status, stage, can_withdraw):
    strict_schema.seed("rental_applications", [application_row(listing, status=status)])
    as_profile(id=TENANT, role="tenant")

    [mine] = client.get(f"{API}/applications").json()

    assert (mine["stage"], mine["can_withdraw"]) == (stage, can_withdraw)


def test_an_application_saved_before_metadata_mobile_still_shows_what_it_kept(client, strict_schema, as_profile,
                                                                               listing):
    strict_schema.seed("rental_applications", [application_row(listing, id=new_id(), metadata={"applicant_snapshot": {
        "move_in_date": "2026-03-01", "occupants": 2, "has_pets": True, "pets": "A dog", "about": "Quiet",
        "annual_income": 80000,
    }})])
    as_profile(id=OWNER, role="landlord")

    [shown] = client.get(f"{API}/properties/{listing}/applications").json()

    assert (shown["move_in_date"], shown["occupants"], shown["has_pets"], shown["pets"], shown["about"]) == (
        "2026-03-01", 2, True, "A dog", "Quiet",
    )
    assert shown["annual_income"] == 80000


def test_an_application_saved_before_the_snapshot_still_shows_what_it_kept(client, strict_schema, as_profile,
                                                                            listing):
    strict_schema.seed("rental_applications", [application_row(listing, id=new_id(), metadata={
        "annual_income": 80000, "move_in_date": "2026-03-01", "has_pets": True, "tenant_score": 7,
    })])
    as_profile(id=OWNER, role="landlord")

    [shown] = client.get(f"{API}/properties/{listing}/applications").json()

    assert (shown["annual_income"], shown["move_in_date"], shown["has_pets"]) == (80000, "2026-03-01", True)
    assert (shown["occupants"], shown["pets"], shown["about"], shown["tenant_score"]) == (None, None, None, 7)
