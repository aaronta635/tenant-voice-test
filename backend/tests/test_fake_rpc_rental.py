"""The rental stand-ins (tests/fake_rpcs/fa_rental.py) answer as their functions' bodies do.

Called directly, as the web calls them: the checks in their order, the
triggers their writes fire (nothing is written when one refuses), the
deferred listing and application consistency, and the ON DELETE rules a
property's delete applies.
"""

import pytest
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client, user_client
from tests.factories_rental import (
    MANAGER,
    NOW,
    OTHER_TENANT,
    OWNER,
    TENANT,
    application_row,
    new_id,
    review_row,
    seed_listing,
    seed_people,
    token_for,
)

LATER = "2026-10-23T00:00:00+00:00"


@pytest.fixture
def db(fake_db):
    seed_people(fake_db)
    return fake_db


def _call(name: str, **params):
    return get_supabase_client().rpc(name, params).execute().data


def _refused(name: str, code: str, message: str, **params) -> None:
    with pytest.raises(APIError) as caught:
        _call(name, **params)
    assert (caught.value.code, caught.value.message) == (code, message)


def _row(db, table: str, row_id: str) -> dict:
    return next(row for row in db.tables[table] if row["id"] == row_id)


def _transition(listing_id, owner=OWNER, status="PUBLISHED"):
    return {"p_listing_id": listing_id, "p_owner_user_id": owner, "p_status": status, "p_now": LATER}


# -- transition_listing_status ---------------------------------------------------------
def test_a_listing_moves_only_as_the_trigger_allows(db):
    listing_id, _ = seed_listing(db, status="LEASED")
    db.seed("rental_applications", [application_row(listing_id, status="APPROVED")])

    _refused("transition_listing_status", "22023", "Invalid listing status transition: LEASED -> PUBLISHED",
             **_transition(listing_id))
    assert _call("transition_listing_status", **_transition(listing_id, status="ARCHIVED")) == [
        {"listing_status": "ARCHIVED", "published_at": None, "updated_at": LATER},
    ]


def test_a_listing_is_leased_only_with_exactly_one_approved_application(db):
    listing_id, _ = seed_listing(db)

    _refused("transition_listing_status", "23514", "A leased listing must have exactly one approved application",
             **_transition(listing_id, status="LEASED"))
    assert _row(db, "listings", listing_id)["status"] == "PUBLISHED"


def test_only_the_properties_active_approved_landlord_publishes(db):
    mine, _ = seed_listing(db, status="PAUSED")
    agents, _ = seed_listing(db, owner=MANAGER, status="PAUSED")

    _refused("transition_listing_status", "42501", "Active landlord access is required", **_transition(agents, MANAGER))
    _refused("transition_listing_status", "42501", "Listing ownership could not be verified",
             **_transition(agents, OWNER))
    _refused("transition_listing_status", "22023", "Invalid listing status", **_transition(mine, status="SOLD"))
    _row(db, "users", OWNER)["verification_status"] = "PENDING"
    _refused("transition_listing_status", "42501", "Landlord verification is required", **_transition(mine))
    # Taking a listing down asks no verification.
    assert _call("transition_listing_status", **_transition(mine, status="APPLICATIONS_CLOSED"))[0]["listing_status"] == (
        "APPLICATIONS_CLOSED"
    )


# -- review_rental_application ---------------------------------------------------------
def _review(application_id, status, landlord=OWNER, note=None):
    return {"p_application_id": application_id, "p_landlord_id": landlord, "p_status": status, "p_note": note,
            "p_now": LATER}


def test_a_decision_the_function_refuses_writes_nothing(db):
    paused, _ = seed_listing(db, status="PAUSED")
    waiting = application_row(paused, last_status_at=NOW)
    db.seed("rental_applications", [waiting])

    _refused("review_rental_application", "22023", "Listing is not available for approval",
             **_review(waiting["id"], "APPROVED"))
    _refused("review_rental_application", "22023", "Invalid application status", **_review(waiting["id"], "WITHDRAWN"))
    _refused("review_rental_application", "42501", "Active landlord access is required",
             **_review(waiting["id"], "REJECTED", landlord=MANAGER))
    assert (_row(db, "rental_applications", waiting["id"])["status"], db.tables.get("notifications", [])) == (
        "SUBMITTED", [],
    )


def test_the_same_decision_again_changes_nothing(db):
    listing_id, _ = seed_listing(db)
    shortlisted = application_row(listing_id, status="SHORTLISTED", last_status_at=NOW)
    db.seed("rental_applications", [shortlisted])

    assert _call("review_rental_application", **_review(shortlisted["id"], "SHORTLISTED")) == [{
        "application_id": shortlisted["id"], "application_status": "SHORTLISTED", "listing_status": "PUBLISHED",
        "updated_at": NOW,
    }]
    assert db.tables.get("application_status_events", []) == []


def test_an_approved_application_cannot_be_changed(db):
    listing_id, _ = seed_listing(db, status="LEASED")
    approved = application_row(listing_id, status="APPROVED")
    db.seed("rental_applications", [approved])

    _refused("review_rental_application", "22023", "An approved application cannot be changed",
             **_review(approved["id"], "REJECTED"))


# -- submit_rental_application ---------------------------------------------------------
def _submit(listing_id, applicant=TENANT, offer=650):
    return {"p_application_id": new_id(), "p_listing_id": listing_id, "p_applicant_id": applicant,
            "p_offer_weekly_rent": offer, "p_message": None, "p_role": "TENANT", "p_now": LATER}


def test_an_application_is_refused_where_the_function_refuses_it(db):
    listing_id, _ = seed_listing(db)
    paused, _ = seed_listing(db, status="PAUSED")

    _refused("submit_rental_application", "22023", "Listing is not open for applications", **_submit(paused))
    _refused("submit_rental_application", "42501", "You cannot apply to your own listing", **_submit(listing_id, OWNER))
    _refused("submit_rental_application", "23514", 'new row for relation "rental_applications" violates check '
             'constraint "rental_applications_offer_weekly_rent_positive_check"', **_submit(listing_id, offer=0))
    assert db.tables.get("rental_applications", []) == []


def test_an_open_application_is_answered_as_it_is(db):
    listing_id, _ = seed_listing(db)
    open_one = application_row(listing_id, status="UNDER_REVIEW")
    db.seed("rental_applications", [open_one])

    assert _call("submit_rental_application", **_submit(listing_id)) == [
        {"application_id": open_one["id"], "application_status": "UNDER_REVIEW"},
    ]
    assert (_row(db, "rental_applications", open_one["id"])["updated_at"], db.tables.get("notifications", [])) == (
        NOW, [],
    )


# -- deletes -----------------------------------------------------------------------------
def test_a_propertys_delete_applies_each_foreign_keys_rule(db):
    listing_id, prop_id = seed_listing(db)
    application = application_row(listing_id)
    db.seed("rental_applications", [application])
    db.seed("application_status_events", [{"application_id": application["id"], "to_status": "SUBMITTED"}])
    db.seed("listing_favorites", [{"id": new_id(), "user_id": TENANT, "listing_id": listing_id}])
    thread = {"id": new_id(), "conversation_type": "APPLICATION", "listing_id": listing_id,
              "application_id": application["id"], "updated_at": NOW}
    db.seed("conversations", [thread])
    db.seed("reviews", [review_row(prop_id, 4)])

    assert _call("delete_owned_unrented_property", p_listing_id=listing_id, p_owner_user_id=OWNER) == [
        {"property_id": prop_id, "deleted_media": []},
    ]

    for table in ("properties", "listings", "rental_applications", "application_status_events", "listing_favorites"):
        assert db.tables[table] == [], table
    # SET NULL keeps the thread and the review, apart from the property.
    assert (_row(db, "conversations", thread["id"])["listing_id"], db.tables["conversations"][0]["application_id"]) == (
        None, None,
    )
    assert db.tables["reviews"][0]["property_id"] is None


def test_a_row_that_still_points_at_the_listing_stops_the_whole_delete(db):
    listing_id, prop_id = seed_listing(db)
    db.seed("owner_assistant_records", [{"id": new_id(), "owner_user_id": OWNER, "listing_id": listing_id,
                                         "kind": "proposal", "title": "Draft", "payload": {}}])
    db.seed("listing_favorites", [{"id": new_id(), "user_id": TENANT, "listing_id": listing_id}])

    with pytest.raises(APIError) as caught:
        _call("delete_owned_unrented_property", p_listing_id=listing_id, p_owner_user_id=OWNER)

    assert caught.value.code == "23503"
    assert ([row["id"] for row in db.tables["properties"]], len(db.tables["listing_favorites"])) == ([prop_id], 1)


def test_only_a_draft_without_applications_is_deleted_alone(db):
    published, _ = seed_listing(db)
    draft, prop_id = seed_listing(db, status="DRAFT")

    _refused("delete_owned_draft_listing", "22023",
             "Only a draft listing can be deleted; archive active or historical listings instead",
             p_listing_id=published, p_owner_user_id=OWNER)
    _refused("delete_owned_draft_listing", "42501", "Listing ownership could not be verified",
             p_listing_id=draft, p_owner_user_id=MANAGER)
    _call("delete_owned_draft_listing", p_listing_id=draft, p_owner_user_id=OWNER)
    assert draft not in {row["id"] for row in db.tables["listings"]}
    assert prop_id in {row["id"] for row in db.tables["properties"]}


# -- mobile_withdraw_application -------------------------------------------------------
def test_a_withdrawal_runs_as_the_signed_in_tenant(db):
    listing_id, _ = seed_listing(db)
    application = application_row(listing_id)
    db.seed("rental_applications", [application])

    with pytest.raises(APIError) as caught:
        _call("mobile_withdraw_application", p_application_id=application["id"])
    assert (caught.value.code, caught.value.message) == ("42501", "Please sign in first.")

    with pytest.raises(APIError) as caught:
        user_client(token_for(OTHER_TENANT)).rpc(
            "mobile_withdraw_application", {"p_application_id": application["id"]}).execute()
    assert caught.value.message == "You can only withdraw your own applications."

    shown = user_client(token_for(TENANT)).rpc(
        "mobile_withdraw_application", {"p_application_id": application["id"]}).execute().data
    assert (shown["id"], shown["status"], shown["applicationStatus"], shown["propertyAddress"]) == (
        application["id"], "Withdrawn", "WITHDRAWN", "Wollongong, NSW, 2500",
    )
