"""The verification functions' stand-ins answer as their bodies do (output/shared-catalog/functions)."""

import pytest
from postgrest.exceptions import APIError

from app.core import supabase as supabase_module
from app.core.supabase import user_client
from tests.factories import NOW
from tests.factories_documents import document_row
from tests.factories_identity import account, users_row
from tests.factories_provider_core import seed_provider

ADMIN = "a4000000-0000-4000-8000-000000000001"
TENANT = "b4000000-0000-4000-8000-000000000001"
LANDLORD = "b4000000-0000-4000-8000-000000000002"
PROVIDER = "b4000000-0000-4000-8000-000000000003"
DOC = "d4000000-0000-4000-8000-000000000001"
LATER = "2026-10-23T01:00:00+00:00"


@pytest.fixture
def db(fake_db):
    fake_db.seed("users", [
        users_row(ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin"),
        users_row(TENANT, "tia@example.test", full_name="Tia Tenant"),
        users_row(LANDLORD, "leo@example.test", "LANDLORD", full_name="Leo Landlord"),
    ])
    return fake_db


def rpc(name, **params):
    return supabase_module.get_supabase_client().rpc(name, params).execute().data


def review(document_id=DOC, reviewer=ADMIN, status="APPROVED", reason=None):
    return rpc("review_profile_document", p_document_id=document_id, p_reviewer_id=reviewer, p_status=status,
               p_rejection_reason=reason, p_now=LATER)


def refused(call) -> tuple[str, str]:
    with pytest.raises(APIError) as caught:
        call()
    return caught.value.code, caught.value.message


def users(db, user_id):
    return next(row for row in db.tables["users"] if row["id"] == user_id)


# -- review_profile_document ----------------------------------------------------------------
def test_review_profile_document_checks_in_the_functions_order(db):
    db.seed("profile_documents", [document_row(DOC, TENANT), document_row(
        "d4000000-0000-4000-8000-000000000002", ADMIN)])

    assert refused(lambda: review(reviewer=TENANT)) == ("42501", "Administrator access is required")
    assert refused(lambda: review(status="MAYBE")) == ("22023", "Invalid document review status")
    assert refused(lambda: review(status="REJECTED", reason="  ")) == ("22023", "Rejection reason is required")
    assert refused(lambda: review("d4000000-0000-4000-8000-000000000009")) == ("P0002", "Profile document not found")
    assert refused(lambda: review("d4000000-0000-4000-8000-000000000002")) == ("22023", "User role is not reviewable")
    review()
    assert refused(review) == ("23505", "Document has already been reviewed")


def test_review_profile_document_counts_the_roles_required_types_and_returns_its_row(db):
    db.seed("profile_documents", [
        document_row(DOC, TENANT, "PASSPORT"),
        document_row("d4000000-0000-4000-8000-000000000002", TENANT, "DRIVERS_LICENCE", "verified"),
        document_row("d4000000-0000-4000-8000-000000000003", TENANT, "MEDICARE_CARD", "verified"),
    ])

    assert review() == [{"document_id": DOC, "user_id": TENANT, "review_status": "APPROVED",
                         "account_verification_status": "APPROVED", "reviewed_at": LATER}]
    account_row = users(db, TENANT)
    assert (account_row["verification_status"], account_row["approved_by_user_id"], account_row["approved_at"]) == (
        "APPROVED", ADMIN, LATER)
    [notice] = db.tables["notifications"]
    assert (notice["title"], notice["body"], notice["link"], notice["category"], notice["created_at"]) == (
        "Verification document reviewed", "Your Passport was approved.", "/admin/profile", "system", LATER)


def test_a_rejection_rejects_the_account_and_names_the_type_as_initcap_does(db):
    db.seed("profile_documents", [document_row(DOC, TENANT, "DRIVERS_LICENCE")])

    [result] = review(status="REJECTED", reason="  Blurred photo  ")

    assert result["account_verification_status"] == "REJECTED"
    document = db.tables["profile_documents"][0]
    assert (document["rejection_reason"], document["verified_by_user_id"], document["verified_at"]) == (
        "Blurred photo", ADMIN, LATER)
    assert document["metadata"] == {"visibility": "private", "reviewStatus": "REJECTED",
                                    "rejectionReason": "Blurred photo", "reviewedAt": LATER}
    assert (users(db, TENANT)["rejection_reason"], users(db, TENANT)["approved_by_user_id"]) == ("Blurred photo", None)
    assert db.tables["notifications"][0]["body"] == "Your Drivers Licence was rejected: Blurred photo"


def test_an_approved_account_stays_approved_and_a_landlords_profile_follows(db):
    db.seed("landlord_profiles", [{"user_id": LANDLORD, "verification_status": "PENDING", "updated_at": NOW}])
    users(db, LANDLORD).update(verification_status="APPROVED", approved_at=NOW)
    db.seed("profile_documents", [document_row(DOC, LANDLORD, "GOVERNMENT_PHOTO_ID")])

    [result] = review(status="REJECTED", reason="Expired")

    assert result["account_verification_status"] == "APPROVED"
    # approved_at keeps the first approval; approved_by names this reviewer.
    assert (users(db, LANDLORD)["approved_at"], users(db, LANDLORD)["approved_by_user_id"]) == (NOW, ADMIN)
    assert db.tables["landlord_profiles"][0]["verification_status"] == "APPROVED"


def test_any_other_role_counts_a_providers_types(db):
    seed_provider(db, PROVIDER)
    db.seed("profile_documents", [document_row(DOC, PROVIDER, "GOVERNMENT_PHOTO_ID")])

    assert review()[0]["account_verification_status"] == "PENDING"
    assert db.tables["service_provider_profiles"][0]["verification_status"] == "PENDING"


# -- review_user_verification ---------------------------------------------------------------
def decide(user_id=TENANT, status="APPROVED", reason=None, reviewer=ADMIN):
    return rpc("review_user_verification", p_user_id=user_id, p_reviewer_id=reviewer, p_status=status,
               p_rejection_reason=reason, p_now=LATER)


def test_review_user_verification_decides_a_pending_account_once(db):
    assert refused(lambda: decide(reviewer=TENANT)) == ("42501", "Administrator access is required")
    assert refused(lambda: decide(status="REJECTED")) == ("22023", "Rejection reason is required")
    assert refused(lambda: decide("b4000000-0000-4000-8000-000000000009")) == ("P0002", "User not found")
    assert refused(lambda: decide(ADMIN)) == ("22023", "User role is not reviewable")

    assert decide(status="REJECTED", reason=" Names differ ") is None

    account_row = users(db, TENANT)
    assert (account_row["verification_status"], account_row["rejection_reason"], account_row["approved_by_user_id"],
            account_row["approved_at"]) == ("REJECTED", "Names differ", ADMIN, None)
    assert db.tables["notifications"][0]["body"] == "Your TenantVoice account verification was rejected: Names differ"
    assert refused(decide) == ("23505", "Verification request already reviewed")


def test_a_provider_is_approved_with_a_service_area_and_categories_only(db):
    seed_provider(db, PROVIDER, category="cleaner")
    expected = ("22023", "Worker service area and categories are required before approval")
    assert refused(lambda: decide(PROVIDER)) == expected
    db.tables["service_provider_profiles"][0].update(service_area="Inner West", service_categories=[])
    assert refused(lambda: decide(PROVIDER)) == expected
    db.tables["service_provider_profiles"][0]["service_categories"] = ["cleaner"]

    decide(PROVIDER)

    assert db.tables["service_provider_profiles"][0]["verification_status"] == "APPROVED"


# -- mobile_admin_verification_queue ---------------------------------------------------------
def test_the_mobile_queue_needs_an_admins_token(db):
    token = account(db, "b4000000-0000-4000-8000-000000000005", "tom@example.test")

    with pytest.raises(APIError) as caught:
        user_client(token).rpc("mobile_admin_verification_queue", {}).execute()

    assert (caught.value.code, caught.value.message) == ("42501", "You need admin privileges to access this page.")


def test_the_mobile_queue_lists_unapproved_members_rejected_first_with_their_documents(db):
    token = account(db, "a4000000-0000-4000-8000-000000000002", "otto@example.test", "ADMIN")
    users(db, TENANT)["metadata"] = {"mobile": {
        "verificationDocuments": {"proof_of_age": {"storagePath": f"{TENANT}/age.jpg", "url": ""}, "note": 1},
        "personalDetails": {"suburb": "Newtown"},
    }}
    users(db, LANDLORD).update(verification_status="REJECTED", updated_at="2025-01-01T00:00:00+00:00")
    db.seed("users", [users_row("b4000000-0000-4000-8000-000000000006", "pam@example.test",
                                verification_status="APPROVED")])

    listed = user_client(token).rpc("mobile_admin_verification_queue", {}).execute().data

    assert [entry["id"] for entry in listed] == [LANDLORD, TENANT]
    tenant = listed[1]
    assert (tenant["name"], tenant["role"], tenant["subtitle"], tenant["documentCount"]) == (
        "Tia Tenant", "tenant", "Newtown", 2)
    assert tenant["documents"] == [{"key": "proof_of_age", "name": "Proof Of Age", "storagePath": f"{TENANT}/age.jpg"}]
    # Without the app's own time, the row's updated_at as Postgres prints it.
    assert tenant["submittedAt"] == "2026-01-01 00:00:00+00"
    assert listed[0]["subtitle"] == "leo@example.test"


# -- mark_profile_document_object_deleted -----------------------------------------------------
def test_marking_a_queued_file_deleted_counts_the_attempt_once(db):
    db.seed("profile_document_deletion_queue", [
        {"file_path": "x/a.pdf", "reason": "REPLACED", "attempts": 1, "last_error": "timeout"},
        {"file_path": "x/b.pdf", "reason": "REPLACED", "deleted_at": NOW, "attempts": 1},
    ])

    rpc("mark_profile_document_object_deleted", p_file_path="x/a.pdf", p_now=LATER)
    rpc("mark_profile_document_object_deleted", p_file_path="x/b.pdf", p_now=LATER)

    first, second = db.tables["profile_document_deletion_queue"]
    assert (first["deleted_at"], first["attempts"], first["last_error"]) == (LATER, 2, None)
    assert (second["deleted_at"], second["attempts"]) == (NOW, 1)
