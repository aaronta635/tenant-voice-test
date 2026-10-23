"""The account's verification around the shared functions (tracker R17, docs/verification.md).

review_profile_document and review_user_verification decide
users.verification_status. The web's own rule is the reset: a replaced or
deleted document of a type the account's role requires takes an approved
or rejected account back to PENDING with its approval cleared, and a
landlord's or provider's profile row follows. The reset never fails the
change that called it, and never overwrites an account that changed meanwhile.
"""

import pytest

from app.services import account_verification, documents, profiles
from tests.factories import NOW
from tests.factories_documents import PDF, document_row, stored_file
from tests.factories_identity import users_row
from tests.factories_provider_core import seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/documents"
ADMIN = "a3000000-0000-4000-8000-000000000001"
TENANT = "b3000000-0000-4000-8000-000000000001"
PROVIDER = "b3000000-0000-4000-8000-000000000002"
OFFICER = "b3000000-0000-4000-8000-000000000003"
LANDLORD = "b3000000-0000-4000-8000-000000000004"
AGENT = "b3000000-0000-4000-8000-000000000005"
PASSPORT = "d3000000-0000-4000-8000-000000000001"
LICENCE = "d3000000-0000-4000-8000-000000000002"
INSURANCE = "d3000000-0000-4000-8000-000000000003"
TRADE_LICENCE = "d3000000-0000-4000-8000-000000000004"
MEDICARE = "d3000000-0000-4000-8000-000000000005"
APPROVED_AT = "2026-02-01T00:00:00+00:00"


@pytest.fixture
def people(strict_schema):
    strict_schema.seed("users", [
        users_row(ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin"),
        users_row(TENANT, "tia@example.test", full_name="Tia Tenant"),
        users_row(OFFICER, "olga@example.test", "REGULATOR", full_name="Olga Officer"),
    ])
    return strict_schema


def user(db, user_id=TENANT):
    return next(row for row in db.tables["users"] if row["id"] == user_id)


def profile(db, table="service_provider_profiles", user_id=PROVIDER):
    return next(row for row in db.tables[table] if row["user_id"] == user_id)


def approved(db, document_id, user_id, document_type, name):
    """An approved document the web stored, as an admin's decision leaves it."""
    path = stored_file(db, user_id, name, document_id.replace("-", ""))
    db.seed("profile_documents", [document_row(
        document_id, user_id, document_type, "verified", file_url=path, verified_by_user_id=ADMIN,
    )])
    return path


def approve_account(db, user_id=TENANT):
    user(db, user_id).update(verification_status="APPROVED", approved_by_user_id=ADMIN, approved_at=APPROVED_AT)


@pytest.fixture
def verified_tenant(people, as_profile):
    """A tenant whose passport, licence and Medicare card were approved, and so the account."""
    approved(people, PASSPORT, TENANT, "PASSPORT", "Passport.pdf")
    approved(people, LICENCE, TENANT, "DRIVERS_LICENCE", "Licence.pdf")
    approved(people, MEDICARE, TENANT, "MEDICARE_CARD", "Medicare.pdf")
    approve_account(people)
    as_profile(id=TENANT, role="tenant")
    return people


def upload(client, document_type="BANK_STATEMENT", name="Statement.pdf"):
    return client.post(API, data={"document_type": document_type}, files={"file": (name, PDF, "application/pdf")})


def replace(client, document_id=PASSPORT):
    return client.put(f"{API}/{document_id}/file", files={"file": ("New file.pdf", PDF, "application/pdf")})


@pytest.mark.parametrize("document_id", [PASSPORT, LICENCE, MEDICARE])
def test_a_replacement_of_a_required_document_resets_the_account(client, verified_tenant, document_id):
    response = replace(client, document_id)

    assert response.status_code == 200, response.text
    row = user(verified_tenant)
    assert (row["verification_status"], row["approved_by_user_id"], row["approved_at"], row["rejection_reason"]) == (
        "PENDING", None, None, None)
    assert row["updated_at"] > NOW
    listed = client.get(API).json()
    assert listed["account"] == {"status": "pending", "rejection_reason": None, "approved_at": None,
                                 "account_rejected": False}
    assert "pending" in [item["status"] for item in listed["requirements"]]


def test_an_upload_of_a_required_type_the_person_has_replaces_it_and_resets_the_account(client, verified_tenant):
    assert upload(client, "MEDICARE_CARD", "Medicare 2027.pdf").status_code == 201

    assert user(verified_tenant)["verification_status"] == "PENDING"


def test_deleting_a_required_document_resets_the_account(client, verified_tenant):
    assert client.delete(f"{API}/{PASSPORT}").status_code == 204

    row = user(verified_tenant)
    assert (row["verification_status"], row["approved_by_user_id"], row["approved_at"]) == ("PENDING", None, None)


def test_a_rejected_account_is_back_in_review_once_a_required_document_is_replaced(client, people, as_profile):
    approved(people, PASSPORT, TENANT, "PASSPORT", "Passport.pdf")
    user(people).update(verification_status="REJECTED", rejection_reason="The names do not match",
                        approved_by_user_id=ADMIN)
    as_profile(id=TENANT, role="tenant")
    assert client.get(API).json()["account"]["account_rejected"] is True

    assert replace(client).status_code == 200

    row = user(people)
    assert (row["verification_status"], row["rejection_reason"], row["approved_by_user_id"]) == ("PENDING", None, None)


def test_documents_no_requirement_counts_leave_an_approved_account_as_it_is(client, verified_tenant):
    # An upload, a new file and a delete, each of a document the tenant's verification does not require.
    statement = upload(client).json()["id"]
    assert replace(client, statement).status_code == 200
    assert client.delete(f"{API}/{statement}").status_code == 204

    row = user(verified_tenant)
    assert (row["verification_status"], row["approved_by_user_id"], row["approved_at"], row["updated_at"]) == (
        "APPROVED", ADMIN, APPROVED_AT, NOW)
    assert client.get(API).json()["account"] == {
        "status": "verified", "rejection_reason": None, "approved_at": "2026-02-01T00:00:00Z",
        "account_rejected": False,
    }


def test_a_new_document_of_a_type_the_person_had_not_writes_nothing_to_the_account(client, people, as_profile):
    approve_account(people)  # approved in the mobile app without a Medicare card
    as_profile(id=TENANT, role="tenant")

    assert upload(client, "MEDICARE_CARD", "Medicare.pdf").status_code == 201

    assert (user(people)["verification_status"], user(people)["updated_at"]) == ("APPROVED", NOW)


def test_a_landlords_management_authority_is_not_required_so_its_new_file_leaves_the_account(
    client, people, as_profile,
):
    people.seed("users", [users_row(LANDLORD, "leo@example.test", "LANDLORD")])
    approved(people, PASSPORT, LANDLORD, "PROPERTY_MANAGEMENT_AUTHORITY", "Authority.pdf")
    approve_account(people, LANDLORD)
    as_profile(id=LANDLORD, role="landlord")

    assert replace(client).status_code == 200

    assert user(people, LANDLORD)["verification_status"] == "APPROVED"


def test_a_landlords_profile_row_follows_a_reset(client, people, as_profile):
    people.seed("users", [users_row(LANDLORD, "leo@example.test", "LANDLORD")])
    people.seed("landlord_profiles", [{"user_id": LANDLORD, "verification_status": "APPROVED", "updated_at": NOW}])
    approved(people, PASSPORT, LANDLORD, "GOVERNMENT_PHOTO_ID", "ID.pdf")
    approved(people, LICENCE, LANDLORD, "PROOF_OF_PROPERTY_OWNERSHIP", "Rates.pdf")
    approve_account(people, LANDLORD)
    as_profile(id=LANDLORD, role="landlord")

    assert replace(client, LICENCE).status_code == 200

    assert user(people, LANDLORD)["verification_status"] == "PENDING"
    assert profile(people, "landlord_profiles", LANDLORD)["verification_status"] == "PENDING"


def test_a_providers_credential_replaced_on_its_page_resets_the_account_and_its_profile(client, people, as_profile):
    seed_provider(people, PROVIDER, category="cleaner")
    approved(people, LICENCE, PROVIDER, "GOVERNMENT_PHOTO_ID", "ID.pdf")
    approved(people, INSURANCE, PROVIDER, "PUBLIC_LIABILITY_INSURANCE", "Insurance.pdf")
    approved(people, TRADE_LICENCE, PROVIDER, "TRADE_LICENCE", "Licence.pdf")
    approve_account(people, PROVIDER)
    profile(people)["verification_status"] = "APPROVED"
    as_profile(id=PROVIDER, role="service_provider")
    stored = client.post(
        "/api/v1/uploads/verification-document", files={"file": ("Insurance 2027.pdf", PDF, "application/pdf")}
    ).json()

    response = client.patch(f"/api/v1/me/verification-documents/{INSURANCE}", json={"document_url": stored["path"]})

    assert response.status_code == 200, response.text
    assert (user(people, PROVIDER)["verification_status"], user(people, PROVIDER)["approved_at"]) == ("PENDING", None)
    assert profile(people)["verification_status"] == "PENDING"


@pytest.mark.parametrize(("before", "after"), [("cleaner", "tradie"), ("tradie", "cleaner")])
def test_a_providers_category_change_leaves_the_account_alone(client, people, as_profile, before, after):
    """Every provider needs a trade licence (review_profile_document), whatever its category."""
    seed_provider(people, PROVIDER, category=before)
    approve_account(people, PROVIDER)
    as_profile(id=PROVIDER, role="service_provider")

    response = client.patch("/api/v1/me/provider", json={"category": after})

    assert response.status_code == 200, response.text
    assert (user(people, PROVIDER)["verification_status"], user(people, PROVIDER)["updated_at"]) == ("APPROVED", NOW)


def test_staff_agents_closed_and_unknown_accounts_are_left_alone(people):
    people.seed("users", [users_row(AGENT, "agnes@example.test", "AGENT")])
    for user_id in (OFFICER, AGENT, TENANT):
        approve_account(people, user_id)
    user(people, TENANT)["deleted_at"] = NOW

    for user_id in (OFFICER, AGENT, TENANT, "f" * 8 + "-0000-4000-8000-000000000000"):
        assert account_verification.apply_rule(user_id, document_type="PASSPORT") is None
    assert {row["id"]: row["verification_status"] for row in people.tables["users"]} == {
        ADMIN: "PENDING", TENANT: "APPROVED", OFFICER: "APPROVED", AGENT: "APPROVED"}


def test_a_change_without_a_document_type_changes_nothing(people):
    approve_account(people)

    assert account_verification.apply_rule(TENANT) is None
    assert user(people)["verification_status"] == "APPROVED"


def test_the_reset_never_fails_the_change_that_called_it(client, verified_tenant, monkeypatch, caplog):
    def _unreachable(user_id):
        raise ConnectionError("database unreachable")

    monkeypatch.setattr(account_verification, "account", _unreachable)

    response = replace(client)

    assert response.status_code == 200
    assert f"could not reset the verification of account {TENANT}" in caplog.text


def test_an_account_that_changed_meanwhile_is_read_again_not_overwritten(people, monkeypatch):
    approve_account(people)
    write = account_verification._write
    calls = []

    def _renamed_first(user_row, changes):
        if not calls:
            # The person renames themselves between the reset's read and its write.
            user(people).update(full_name="Tia Renamed", updated_at="2026-03-01T00:00:00+00:00")
        calls.append(changes)
        return write(user_row, changes)

    monkeypatch.setattr(account_verification, "_write", _renamed_first)

    updated = account_verification.apply_rule(TENANT, document_type="PASSPORT")

    assert len(calls) == 2
    assert (updated["verification_status"], updated["full_name"]) == ("PENDING", "Tia Renamed")


def test_a_document_decision_is_review_profile_documents(people):
    """The web calls the function with the admin's users.id and writes no review or account row itself."""
    path = stored_file(people, TENANT)
    people.seed("profile_documents", [document_row(PASSPORT, TENANT, file_url=path)])
    reviewer = account_verification.account(ADMIN)

    decided, subject = documents.review(PASSPORT, reviewer, "APPROVED", "ignored for an approval", NOW)

    [call] = [params for name, params in people.rpc_calls if name == "review_profile_document"]
    assert {key: call[key] for key in ("p_document_id", "p_reviewer_id", "p_status", "p_rejection_reason")} == {
        "p_document_id": PASSPORT, "p_reviewer_id": ADMIN, "p_status": "APPROVED", "p_rejection_reason": None}
    assert (decided["review_status"], decided["verified_by_user_id"], subject["id"]) == ("APPROVED", ADMIN, TENANT)
    # One required document of three: the function keeps the account in review.
    assert user(people)["verification_status"] == "PENDING"


def test_a_profile_save_that_read_the_account_first_keeps_an_admins_rejection(people, monkeypatch):
    """Both write users: a save that read the row before the decision reads it again."""
    read = profiles.get_user_row
    reads = []

    def rejected_after_the_saves_read(user_id):
        row = read(user_id)
        reads.append(user_id)
        if len(reads) == 2:  # the write's own read, before its conditional update
            account_verification.decide(account_verification.account(TENANT), "REJECTED", ADMIN, "Checking a report")
        return row

    monkeypatch.setattr(profiles, "get_user_row", rejected_after_the_saves_read)

    profiles.update_my_profile(TENANT, {"settings": {"privacy": {"share_score": False}}})

    row = user(people)
    assert (row["verification_status"], row["rejection_reason"]) == ("REJECTED", "Checking a report")
    assert row["metadata"]["privacy"]["share_score"] is False
