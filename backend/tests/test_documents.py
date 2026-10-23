"""Private documents for tenants, landlords and providers (R15): upload, replace, share and delete.

The file goes to the private bucket, in the owner's {users.id} folder,
before its profile_documents row, so a storage failure leaves nothing that
reads as uploaded and a row that cannot be written takes its file with it.
A person keeps one document of each type (UNIQUE (user_id, document_type)):
an upload of a type they have replaces it. A new file sends the document
back to review; a deleted or replaced file goes from Storage, through the
deletion queue. Nobody reaches another person's documents.
"""

import pytest
from postgrest.exceptions import APIError

from app.services import documents
from tests import fake_supabase
from tests.factories import NOW
from tests.factories_documents import (
    BUCKET, GIF, PDF, PNG, document_row, queue_entries, stored_file,
)
from tests.factories_identity import fail_inserts, users_row
from tests.factories_provider_core import seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/documents"
TENANT = "e0000000-0000-4000-8000-000000000001"
LANDLORD = "e0000000-0000-4000-8000-000000000002"
OTHER_TENANT = "e0000000-0000-4000-8000-000000000003"
PROVIDER = "e0000000-0000-4000-8000-000000000004"
AGENT = "e0000000-0000-4000-8000-000000000005"
DOC = "d1000000-0000-4000-8000-000000000001"
OTHER_DOC = "d1000000-0000-4000-8000-000000000002"


@pytest.fixture
def people(strict_schema):
    strict_schema.seed("users", [
        users_row(TENANT, "tia@example.test", full_name="Tia Tenant"),
        users_row(LANDLORD, "leo@example.test", "LANDLORD", full_name="Leo Landlord"),
        users_row(OTHER_TENANT, "oli@example.test", full_name="Oli Other"),
    ])
    return strict_schema


@pytest.fixture
def as_tenant_user(people, as_profile):
    as_profile(id=TENANT, role="tenant")
    return people


def rows(db):
    return db.tables.get("profile_documents", [])


def row_of(db, document_id=DOC):
    return next(row for row in rows(db) if row["id"] == document_id)


def objects(db):
    return {path for bucket, path in db.storage.objects if bucket == BUCKET}


def upload(client, document_type="PASSPORT", name="Passport.pdf", data=PDF, content_type="application/pdf", **form):
    return client.post(
        API, data={"document_type": document_type, **form}, files={"file": (name, data, content_type)}
    )


def replace(client, document_id=DOC, name="Passport 2027.pdf", data=PDF):
    return client.put(f"{API}/{document_id}/file", files={"file": (name, data, "application/pdf")})


@pytest.fixture
def broken_storage(monkeypatch):
    """Storage refuses every new object, as when the bucket is unreachable."""

    def upload(self, path, data, options):
        raise ConnectionError("storage unreachable")

    monkeypatch.setattr(fake_supabase.FakeBucket, "upload", upload)


@pytest.fixture
def stuck_removals(monkeypatch):
    """Storage keeps every object it is asked to remove."""

    def remove(self, paths):
        raise ConnectionError("storage unreachable")

    monkeypatch.setattr(fake_supabase.FakeBucket, "remove", remove)


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
def test_an_upload_stores_the_file_then_a_pending_row(client, as_tenant_user):
    response = upload(client)

    assert response.status_code == 201, response.text
    body = response.json()
    [row] = rows(as_tenant_user)
    [path] = objects(as_tenant_user)
    assert path.startswith(f"{TENANT}/") and path.endswith("/Passport.pdf")
    assert (row["user_id"], row["document_type"], row["file_url"], row["review_status"], row["is_verified"]) == (
        TENANT, "PASSPORT", path, "PENDING", False)
    assert row["metadata"] == {"visibility": "private"}
    assert row["submitted_at"] > NOW and row["updated_at"] > NOW
    assert (body["id"], body["status"], body["file_name"], body["label"], body["visibility"]) == (
        row["id"], "pending", "Passport.pdf", "Passport", "private")
    assert (body["has_file"], body["can_open"]) == (True, True)


def test_a_storage_failure_never_shows_as_uploaded(client, as_tenant_user, broken_storage):
    response = upload(client)

    assert response.status_code == 502
    assert rows(as_tenant_user) == [] and objects(as_tenant_user) == set()
    listed = client.get(API).json()
    assert listed["documents"] == []
    assert listed["requirements"][0]["status"] == "missing"


def test_a_row_that_cannot_be_written_takes_its_file_with_it(client, as_tenant_user, monkeypatch):
    fail_inserts(monkeypatch, "profile_documents")

    response = upload(client)

    assert response.status_code == 500
    assert rows(as_tenant_user) == []
    assert objects(as_tenant_user) == set()
    assert queue_entries(as_tenant_user) == []


def test_an_unsaved_file_storage_keeps_is_queued_for_the_cleanup(client, as_tenant_user, monkeypatch, stuck_removals):
    fail_inserts(monkeypatch, "profile_documents")

    response = upload(client)

    assert response.status_code == 500
    [path] = objects(as_tenant_user)
    [entry] = queue_entries(as_tenant_user)
    assert (entry["bucket"], entry["file_path"], entry["deleted_at"], entry["attempts"]) == (BUCKET, path, None, 1)
    assert "storage unreachable" in entry["last_error"]
    assert rows(as_tenant_user) == []


def test_each_role_uploads_only_its_own_document_types(client, people, as_profile):
    as_profile(id=LANDLORD, role="landlord")

    refused = upload(client, "BANK_STATEMENT")
    accepted = upload(client, "PROOF_OF_PROPERTY_OWNERSHIP", "Rates notice.pdf")

    assert refused.status_code == 400
    assert accepted.status_code == 201, accepted.text
    assert [row["document_type"] for row in rows(people)] == ["PROOF_OF_PROPERTY_OWNERSHIP"]
    assert len(objects(people)) == 1


def test_a_landlords_earlier_licence_is_still_listed_opened_replaced_and_deleted(client, people, as_profile):
    # The panel no longer offers a landlord a passport or licence (they count only as a government photo ID),
    # but one saved before stays theirs to see and remove.
    path = stored_file(people, LANDLORD, name="licence.pdf")
    people.seed("profile_documents", [document_row(DOC, LANDLORD, document_type="DRIVERS_LICENCE", file_url=path)])
    as_profile(id=LANDLORD, role="landlord")

    listed = client.get(API).json()
    [kept] = [item for item in listed["types"] if item["type"] == "DRIVERS_LICENCE"]
    assert (kept["kept_only"], kept["required"]) == (True, False)
    assert [item["type"] for item in listed["types"] if not item["kept_only"]] == [
        "GOVERNMENT_PHOTO_ID", "PROOF_OF_PROPERTY_OWNERSHIP", "PROPERTY_MANAGEMENT_AUTHORITY", "OTHER"]
    assert [document["id"] for document in listed["documents"]] == [DOC]
    assert client.get(f"{API}/{DOC}/link").status_code == 200
    # No new one of that type, but the one there takes a new file.
    assert upload(client, "DRIVERS_LICENCE").status_code == 400
    assert replace(client, name="Licence 2027.pdf").status_code == 200

    assert client.delete(f"{API}/{DOC}").status_code == 204
    assert rows(people) == []
    assert all(item["type"] != "DRIVERS_LICENCE" for item in client.get(API).json()["types"])


def test_an_upload_of_a_type_the_person_has_replaces_it(client, as_tenant_user):
    first = upload(client)
    first_file = rows(as_tenant_user)[0]["file_url"]
    row_of(as_tenant_user, first.json()["id"]).update(review_status="APPROVED", is_verified=True, verified_at=NOW)

    again = upload(client, name="Passport 2027.pdf")

    assert again.status_code == 201, again.text
    [row] = rows(as_tenant_user)
    assert (row["id"], again.json()["id"], again.json()["file_name"]) == (first.json()["id"], row["id"], "Passport 2027.pdf")
    assert (row["review_status"], row["is_verified"], row["verified_at"]) == ("PENDING", False, None)
    assert objects(as_tenant_user) == {row["file_url"]} and row["file_url"] != first_file
    [entry] = queue_entries(as_tenant_user)
    assert (entry["file_path"], entry["reason"]) == (first_file, "REPLACED")


def test_an_upload_over_the_mobile_apps_document_keeps_its_keys_and_resets_its_review(client, as_tenant_user):
    as_tenant_user.seed("profile_documents", [document_row(
        DOC, TENANT, "MEDICARE_CARD", status="verified", file_url=f"{TENANT}/medicare.jpg",
        metadata={"source": "mobile", "reviewStatus": "APPROVED", "reviewedAt": NOW, "rejectionReason": None},
    )])

    response = upload(client, "MEDICARE_CARD", "Medicare.pdf")

    assert response.status_code == 201, response.text
    [row] = rows(as_tenant_user)
    assert row["id"] == DOC and row["review_status"] == "PENDING"
    # Its review keys, as review_profile_document left them, say it is in review again.
    assert row["metadata"] == {"source": "mobile", "visibility": "private", "reviewStatus": "PENDING",
                               "reviewedAt": None, "rejectionReason": None}


def test_an_upload_racing_another_of_the_same_type_replaces_it(client, as_tenant_user, monkeypatch):
    """The unique index refuses the second insert (23505): that upload replaces the first instead."""
    old = stored_file(as_tenant_user, TENANT, directory="b" * 32)
    as_tenant_user.seed("profile_documents", [document_row(DOC, TENANT, file_url=old)])
    rows_of = documents._rows_of
    reads = []

    def _first_read_misses_it(user_id, types):
        reads.append(types)
        return [] if len(reads) == 1 else rows_of(user_id, types)

    monkeypatch.setattr(documents, "_rows_of", _first_read_misses_it)
    fail_inserts(monkeypatch, "profile_documents", code="23505")

    response = upload(client, name="Passport 2027.pdf")

    assert response.status_code == 201, response.text
    [row] = rows(as_tenant_user)
    assert (row["id"], response.json()["file_name"]) == (DOC, "Passport 2027.pdf")
    assert old not in objects(as_tenant_user)


def test_the_other_document_is_one_slot_a_new_one_replaces_with_its_own_name(client, as_tenant_user):
    first = upload(client, "OTHER", "Payslip.pdf", label="  Payslip   March ")
    second = upload(client, "OTHER", "Contract.png", PNG, "image/png", label="Employment contract")

    assert (first.status_code, second.status_code) == (201, 201)
    assert (first.json()["label"], second.json()["label"]) == ("Payslip March", "Employment contract")
    [row] = rows(as_tenant_user)
    assert row["metadata"]["label"] == "Employment contract"
    unnamed = upload(client, "OTHER", "Note.pdf")
    assert unnamed.json()["label"] == "Other document (for example a payslip or contract)"
    assert "label" not in rows(as_tenant_user)[0]["metadata"]


def test_a_tenant_marks_the_other_document_as_a_payslip_or_a_contract(client, as_tenant_user):
    payslip = upload(client, "OTHER", "March.pdf", kind="payslip")
    # Without a name of its own, a marked document is named after what it is.
    assert (payslip.status_code, payslip.json()["kind"], payslip.json()["label"]) == (201, "payslip", "Payslip")

    contract = upload(client, "OTHER", "Offer.pdf", kind="employment_contract", label="Letter of offer")
    assert (contract.status_code, contract.json()["kind"], contract.json()["label"]) == (
        201, "employment_contract", "Letter of offer")
    assert [row["metadata"]["web_type"] for row in rows(as_tenant_user)] == ["employment_contract"]
    # A new document without a mark is no longer the contract.
    unmarked = upload(client, "OTHER", "Something.pdf")
    assert unmarked.json()["kind"] is None and "web_type" not in rows(as_tenant_user)[0]["metadata"]


def test_only_a_tenants_other_document_is_marked_and_nothing_is_stored_otherwise(client, people, as_profile):
    as_profile(id=TENANT, role="tenant")
    passport = upload(client, kind="payslip")
    unknown = upload(client, "OTHER", kind="tax_return")
    as_profile(id=LANDLORD, role="landlord")
    landlord = upload(client, "OTHER", kind="payslip")

    assert (passport.status_code, unknown.status_code, landlord.status_code) == (400, 422, 400)
    assert "Only a tenant's other document" in passport.json()["detail"]
    assert rows(people) == [] and objects(people) == set()


def test_a_file_the_bucket_refuses_stores_nothing(client, as_tenant_user):
    response = upload(client, name="Animation.gif", data=GIF, content_type="image/gif")

    assert response.status_code == 415
    assert rows(as_tenant_user) == [] and objects(as_tenant_user) == set()


def test_only_tenants_share_documents_with_the_owners_they_apply_to(client, people, as_profile):
    as_profile(id=TENANT, role="tenant")
    shared = upload(client, visibility="applications")
    as_profile(id=LANDLORD, role="landlord")
    refused = upload(client, visibility="applications")
    unknown = upload(client, visibility="everyone")

    assert shared.status_code == 201 and shared.json()["visibility"] == "applications"
    assert refused.status_code == 400 and unknown.status_code == 422
    assert [row["user_id"] for row in rows(people)] == [TENANT]


# ---------------------------------------------------------------------------
# Replace
# ---------------------------------------------------------------------------
@pytest.fixture
def approved_passport(as_tenant_user):
    old = stored_file(as_tenant_user, TENANT)
    as_tenant_user.seed("profile_documents", [document_row(
        DOC, TENANT, status="verified", file_url=old, verified_by_user_id=LANDLORD,
        metadata={"visibility": "applications", "mobile_note": "kept"},
    )])
    return old


def test_a_new_file_sends_an_approved_document_back_to_review_and_removes_the_old_file(
    client, as_tenant_user, approved_passport,
):
    response = replace(client)

    assert response.status_code == 200, response.text
    row = row_of(as_tenant_user)
    assert (row["review_status"], row["is_verified"], row["verified_by_user_id"], row["verified_at"],
            row["rejection_reason"]) == ("PENDING", False, None, None, None)
    assert row["submitted_at"] > NOW and row["file_url"] != approved_passport
    assert row["metadata"] == {"visibility": "applications", "mobile_note": "kept"}
    assert objects(as_tenant_user) == {row["file_url"]}
    [entry] = queue_entries(as_tenant_user)
    assert (entry["file_path"], entry["reason"]) == (approved_passport, "REPLACED")
    # mark_profile_document_object_deleted: removed, and counted as an attempt.
    assert entry["deleted_at"] and entry["attempts"] == 1
    assert ("mark_profile_document_object_deleted", {"p_file_path": approved_passport, "p_now": entry["deleted_at"]}) in (
        as_tenant_user.rpc_calls)
    assert (response.json()["status"], response.json()["file_name"]) == ("pending", "Passport 2027.pdf")


def test_a_rejected_document_returns_to_review_without_its_reason(client, as_tenant_user):
    old = stored_file(as_tenant_user, TENANT)
    as_tenant_user.seed("profile_documents", [document_row(DOC, TENANT, status="rejected", file_url=old)])
    assert client.get(API).json()["documents"][0]["rejection_reason"] == "The photo is blurred."

    response = replace(client)

    assert response.status_code == 200
    assert (response.json()["status"], response.json()["rejection_reason"]) == ("pending", None)
    assert row_of(as_tenant_user)["rejection_reason"] is None


def test_a_replacement_storage_refuses_keeps_the_document_as_it_was(
    client, as_tenant_user, approved_passport, broken_storage,
):
    before = dict(row_of(as_tenant_user))

    response = replace(client)

    assert response.status_code == 502
    assert row_of(as_tenant_user) == before
    assert objects(as_tenant_user) == {approved_passport}


def test_a_replacement_the_database_refuses_removes_the_new_file(
    client, as_tenant_user, approved_passport, monkeypatch,
):
    before = dict(row_of(as_tenant_user))
    execute = fake_supabase.FakeTableQuery.execute

    def _execute(query):
        if query._op == "update" and query._name == "profile_documents":
            raise APIError({"code": "57014", "message": "statement timeout"})
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", _execute)
    response = replace(client)

    assert response.status_code == 500
    assert row_of(as_tenant_user) == before
    assert objects(as_tenant_user) == {approved_passport}


def test_a_document_replaced_meanwhile_keeps_the_other_replacement(client, as_tenant_user, approved_passport, monkeypatch):
    """Two replacements of one version: the second finds a new file there and stores nothing."""
    newer = stored_file(as_tenant_user, TENANT, "Passport newer.pdf", "b" * 32)
    update_row = documents.update_row

    def _replaced_first(document_id, user_id, changes, **options):
        row_of(as_tenant_user)["file_url"] = newer
        return update_row(document_id, user_id, changes, **options)

    monkeypatch.setattr(documents, "update_row", _replaced_first)
    response = replace(client)

    assert response.status_code == 409
    assert row_of(as_tenant_user)["file_url"] == newer
    assert objects(as_tenant_user) == {approved_passport, newer}


# ---------------------------------------------------------------------------
# Details and delete
# ---------------------------------------------------------------------------
def test_sharing_a_document_keeps_its_review_and_the_mobile_apps_metadata(client, as_tenant_user, approved_passport):
    response = client.patch(f"{API}/{DOC}", json={"visibility": "private"})

    assert response.status_code == 200, response.text
    row = row_of(as_tenant_user)
    assert row["metadata"] == {"visibility": "private", "mobile_note": "kept"}
    assert (row["review_status"], response.json()["status"], response.json()["visibility"]) == (
        "APPROVED", "verified", "private")


def test_marking_a_document_as_a_payslip_keeps_its_review_and_the_mobile_apps_metadata(client, as_tenant_user):
    as_tenant_user.seed("profile_documents", [document_row(
        DOC, TENANT, "OTHER", status="verified", metadata={"visibility": "private", "label": "March pay", "note": "kept"},
    )])

    marked = client.patch(f"{API}/{DOC}", json={"kind": "payslip"})
    marked_row = dict(row_of(as_tenant_user)["metadata"])
    cleared = client.patch(f"{API}/{DOC}", json={"kind": None})

    assert marked.status_code == 200, marked.text
    assert (marked.json()["kind"], marked.json()["label"], marked.json()["status"]) == ("payslip", "March pay", "verified")
    assert marked_row == {"visibility": "private", "label": "March pay", "note": "kept", "web_type": "payslip"}
    assert cleared.json()["kind"] is None
    assert row_of(as_tenant_user)["metadata"] == {"visibility": "private", "label": "March pay", "note": "kept"}
    assert row_of(as_tenant_user)["review_status"] == "APPROVED"


def test_a_passport_cannot_be_marked_as_a_payslip(client, as_tenant_user, approved_passport):
    response = client.patch(f"{API}/{DOC}", json={"kind": "payslip"})

    assert response.status_code == 400
    assert "web_type" not in row_of(as_tenant_user)["metadata"]


def test_deleting_a_document_removes_its_row_and_its_file(client, as_tenant_user, approved_passport):
    response = client.delete(f"{API}/{DOC}")

    assert response.status_code == 204
    assert rows(as_tenant_user) == [] and objects(as_tenant_user) == set()
    [entry] = queue_entries(as_tenant_user)
    assert (entry["file_path"], entry["reason"]) == (approved_passport, "USER_DELETED")
    assert entry["deleted_at"]
    assert client.delete(f"{API}/{DOC}").status_code == 404


def test_a_file_storage_cannot_remove_stays_queued(client, as_tenant_user, approved_passport, stuck_removals):
    assert client.delete(f"{API}/{DOC}").status_code == 204

    [entry] = queue_entries(as_tenant_user)
    assert (entry["file_path"], entry["deleted_at"], entry["attempts"]) == (approved_passport, None, 1)
    assert objects(as_tenant_user) == {approved_passport}


def test_a_document_the_database_keeps_is_a_conflict(client, as_tenant_user, approved_passport, monkeypatch):
    """The review events' foreign key is ON DELETE SET NULL, so this is for a database that keeps it anyway."""
    execute = fake_supabase.FakeTableQuery.execute

    def _execute(query):
        if query._op == "delete" and query._name == "profile_documents":
            raise APIError({"code": "23503", "message": "still referenced"})
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", _execute)
    response = client.delete(f"{API}/{DOC}")

    assert response.status_code == 409
    assert len(rows(as_tenant_user)) == 1 and objects(as_tenant_user) == {approved_passport}


def test_a_file_another_document_still_uses_stays(client, as_tenant_user):
    shared = stored_file(as_tenant_user, TENANT)
    as_tenant_user.seed("profile_documents", [
        document_row(DOC, TENANT, "OTHER", file_url=shared),
        document_row(OTHER_DOC, TENANT, "BANK_STATEMENT", file_url=shared),
    ])

    assert client.delete(f"{API}/{DOC}").status_code == 204

    assert objects(as_tenant_user) == {shared}
    assert queue_entries(as_tenant_user) == []


def test_a_file_the_mobile_apps_verification_documents_name_stays(client, as_tenant_user):
    shared = stored_file(as_tenant_user, TENANT)
    as_tenant_user.seed("profile_documents", [document_row(DOC, TENANT, file_url=shared)])
    next(row for row in as_tenant_user.tables["users"] if row["id"] == TENANT)["metadata"] = {
        "mobile": {"verificationDocuments": {"passport": {"name": "Passport", "storagePath": shared}}},
    }

    assert client.delete(f"{API}/{DOC}").status_code == 204

    assert objects(as_tenant_user) == {shared}
    assert queue_entries(as_tenant_user) == []


def test_a_file_queued_before_is_queued_again(client, as_tenant_user, approved_passport, monkeypatch):
    """The queue holds one entry per file (UNIQUE (file_path)): an earlier one is reset, as the shared functions do."""
    as_tenant_user.seed(documents.DELETION_QUEUE, [{
        "file_path": approved_passport, "reason": "ORPHANED", "deleted_at": NOW, "attempts": 2, "last_error": "x",
    }])
    fail_inserts(monkeypatch, documents.DELETION_QUEUE, code="23505")

    assert client.delete(f"{API}/{DOC}").status_code == 204

    [entry] = queue_entries(as_tenant_user)
    assert (entry["reason"], entry["attempts"], entry["last_error"]) == ("USER_DELETED", 1, None)
    assert entry["deleted_at"] and entry["deleted_at"] != NOW
    assert objects(as_tenant_user) == set()


# ---------------------------------------------------------------------------
# Whose documents
# ---------------------------------------------------------------------------
def test_nobody_reaches_another_persons_documents(client, people, as_profile):
    theirs = stored_file(people, OTHER_TENANT)
    people.seed("profile_documents", [document_row(DOC, OTHER_TENANT, file_url=theirs)])
    before = dict(row_of(people))
    as_profile(id=TENANT, role="tenant")

    assert client.get(API).json()["documents"] == []
    assert replace(client).status_code == 404
    assert client.patch(f"{API}/{DOC}", json={"visibility": "applications"}).status_code == 404
    assert client.delete(f"{API}/{DOC}").status_code == 404
    assert client.get(f"{API}/{DOC}/link").status_code == 404

    assert rows(people) == [before]
    assert objects(people) == {theirs}
    assert people.storage.signatures == []


def test_a_persons_documents_of_another_role_are_not_this_panels(client, people, as_profile):
    """A trade licence a mobile account keeps is not a tenant document: not listed, not deleted."""
    people.seed("profile_documents", [document_row(DOC, TENANT, "TRADE_LICENCE")])
    as_profile(id=TENANT, role="tenant")

    assert client.get(API).json()["documents"] == []
    assert client.delete(f"{API}/{DOC}").status_code == 404
    assert len(rows(people)) == 1


@pytest.mark.parametrize("role", ["admin", "officer"])
def test_staff_keep_no_documents_here(client, people, as_profile, role):
    as_profile(id=TENANT, role=role)

    assert client.get(API).status_code == 403
    assert upload(client).status_code == 403
    assert objects(people) == set()


# ---------------------------------------------------------------------------
# The checklist
# ---------------------------------------------------------------------------
def test_a_tenant_checklist_lists_its_types_and_what_verification_needs(client, as_tenant_user):
    as_tenant_user.seed("profile_documents", [
        document_row(DOC, TENANT, "DRIVERS_LICENCE", status="rejected"),
        document_row(OTHER_DOC, TENANT, "BANK_STATEMENT", status="verified"),
    ])

    body = client.get(API).json()

    assert body["role"] == "tenant" and body["can_share"] is True
    assert [item["type"] for item in body["types"]][:3] == ["PASSPORT", "DRIVERS_LICENCE", "GOVERNMENT_PHOTO_ID"]
    assert len(body["types"]) == 12
    assert not any(item["repeatable"] for item in body["types"])
    # What review_profile_document counts for a tenant.
    assert {item["type"] for item in body["types"] if item["required"]} == {
        "PASSPORT", "DRIVERS_LICENCE", "MEDICARE_CARD"}
    assert body["requirements"] == [
        {"key": "passport", "label": "Passport", "types": ["PASSPORT"], "status": "missing"},
        {"key": "drivers_licence", "label": "Driver licence", "types": ["DRIVERS_LICENCE"], "status": "rejected"},
        {"key": "medicare_card", "label": "Medicare card", "types": ["MEDICARE_CARD"], "status": "missing"},
    ]
    assert body["requirements_met"] is False
    statuses = {doc["document_type"]: (doc["status"], doc["rejection_reason"]) for doc in body["documents"]}
    assert statuses == {"DRIVERS_LICENCE": ("rejected", "The photo is blurred."), "BANK_STATEMENT": ("verified", None)}


def test_only_a_tenants_other_documents_offer_the_payslip_and_contract_marks(client, people, as_profile):
    as_profile(id=TENANT, role="tenant")
    tenant = {item["type"]: item["kinds"] for item in client.get(API).json()["types"]}
    as_profile(id=LANDLORD, role="landlord")
    landlord = {item["type"]: item["kinds"] for item in client.get(API).json()["types"]}

    assert tenant["OTHER"] == [
        {"value": "payslip", "label": "Payslip"}, {"value": "employment_contract", "label": "Employment contract"},
    ]
    assert tenant["PASSPORT"] == [] and landlord["OTHER"] == []


def test_a_tenants_requirements_are_met_only_with_all_three_approved(client, as_tenant_user):
    as_tenant_user.seed("profile_documents", [
        document_row(DOC, TENANT, "PASSPORT", status="verified"),
        document_row(OTHER_DOC, TENANT, "DRIVERS_LICENCE", status="verified"),
        # Another photo ID is no Medicare card.
        document_row("d1000000-0000-4000-8000-000000000003", TENANT, "GOVERNMENT_PHOTO_ID", status="verified"),
    ])
    assert client.get(API).json()["requirements_met"] is False

    as_tenant_user.seed("profile_documents", [
        document_row("d1000000-0000-4000-8000-000000000004", TENANT, "MEDICARE_CARD", status="verified"),
    ])
    body = client.get(API).json()

    assert [item["status"] for item in body["requirements"]] == ["verified", "verified", "verified"]
    assert body["requirements_met"] is True


def test_a_landlord_needs_a_government_photo_id_and_proof_of_ownership(client, people, as_profile):
    people.seed("profile_documents", [
        document_row(DOC, LANDLORD, "GOVERNMENT_PHOTO_ID", status="verified"),
        # A management authority is not what the function counts.
        document_row(OTHER_DOC, LANDLORD, "PROPERTY_MANAGEMENT_AUTHORITY", status="verified"),
    ])
    as_profile(id=LANDLORD, role="landlord")

    body = client.get(API).json()

    assert body["can_share"] is False
    assert [(item["key"], item["label"], item["status"]) for item in body["requirements"]] == [
        ("photo_id", "Photo ID", "verified"), ("proof_of_ownership", "Proof of ownership", "missing")]
    assert {item["type"] for item in body["types"] if item["required"]} == {
        "GOVERNMENT_PHOTO_ID", "PROOF_OF_PROPERTY_OWNERSHIP"}
    assert body["requirements_met"] is False


def test_an_agents_documents_have_no_requirements(client, people, as_profile):
    """review_profile_document and review_user_verification review tenants, landlords and providers only."""
    people.seed("users", [users_row(AGENT, "ada@example.test", "AGENT")])
    as_profile(id=AGENT, role="landlord")

    body = client.get(API).json()

    assert (body["requirements"], body["requirements_met"]) == ([], False)
    assert not any(item["required"] for item in body["types"])


@pytest.mark.parametrize("category", ["tradie", "cleaner"])
def test_every_provider_needs_a_photo_id_a_trade_licence_and_insurance(client, strict_schema, as_profile, category):
    seed_provider(strict_schema, PROVIDER, category=category)
    as_profile(id=PROVIDER, role="service_provider")

    body = client.get(API).json()

    assert [item["key"] for item in body["requirements"]] == ["photo_id", "trade_licence", "public_liability"]
    assert "TRADE_LICENCE" in {item["type"] for item in body["types"]}


def test_a_provider_credential_saved_on_the_provider_page_lists_here_too(client, strict_schema, as_profile):
    seed_provider(strict_schema, PROVIDER)
    as_profile(id=PROVIDER, role="service_provider")
    stored = client.post(
        "/api/v1/uploads/verification-document", files={"file": ("Insurance.pdf", PDF, "application/pdf")}
    ).json()
    assert client.post("/api/v1/me/verification-documents",
                       json={"type": "insurance", "document_url": stored["path"]}).status_code == 201

    [listed] = client.get(API).json()["documents"]

    assert (listed["document_type"], listed["status"], listed["file_name"]) == (
        "PUBLIC_LIABILITY_INSURANCE", "pending", "Insurance.pdf")
