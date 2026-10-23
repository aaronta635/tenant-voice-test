"""A credential file is uploaded before the credential is saved: a save that fails releases it.

Regression cover for review item #33: the provider check before the upload
passed, then the insert failed and the private file stayed in Storage with
nothing pointing to it. A released file is queued in
profile_document_deletion_queue, removed, and its entry marked deleted
(app.services.documents); a removal that fails stays queued for the mobile
side's cleanup. A file a saved credential still uses is never released, nor
is one outside the provider's own folder.
"""

import logging

import pytest
from postgrest.exceptions import APIError

from app.services import uploads
from app.services import verification_documents
from tests.factories_provider_core import credential_row, seed_provider
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA = "a0000000-0000-4000-8000-000000000001"
OTHER = "a0000000-0000-4000-8000-000000000002"
DOC = "d0000000-0000-4000-8000-000000000001"
BUCKET = uploads.VERIFICATION_DOCUMENTS_BUCKET
QUEUE = verification_documents.DELETION_QUEUE
API = "/api/v1"


@pytest.fixture
def shared_provider(strict_schema, as_profile):
    seed_provider(strict_schema, AMELIA, "Amelia Whitlock", business_name="Whitlock Property")
    as_profile(id=AMELIA, role="service_provider")
    return strict_schema


@pytest.fixture
def rejected_inserts(monkeypatch):
    """Fail every new credential row the way a foreign key does (23503)."""
    execute = FakeTableQuery.execute

    def _execute(query):
        if query._op == "insert" and query._name == "profile_documents":
            raise APIError({"code": "23503", "message": "violates foreign key constraint"})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", _execute)


def upload(client, name="Passport.pdf"):
    response = client.post(
        f"{API}/uploads/verification-document", files={"file": (name, b"%PDF-1.7\nID", "application/pdf")}
    )
    assert response.status_code == 200, response.text
    return response.json()


def queued(db):
    return [(row["bucket"], row["file_path"]) for row in db.tables.get(QUEUE, [])]


def removed(db, path):
    """Whether the file is gone from Storage and its queue entry says so."""
    entries = [row for row in db.tables.get(QUEUE, []) if row["file_path"] == path]
    return (BUCKET, path) not in db.storage.objects and bool(entries) and all(row["deleted_at"] for row in entries)


def saved_file(fake_db, owner, name):
    path = f"verification/{owner}/{'a' * 32}/{name}"
    fake_db.storage.objects[(BUCKET, path)] = b"%PDF-1.7"
    return path


def test_a_save_the_database_rejects_queues_its_upload(client, shared_provider, rejected_inserts):
    uploaded = upload(client)

    response = client.post(f"{API}/me/verification-documents", json={"type": "id", "document_url": uploaded["url"]})

    assert response.status_code == 400
    assert queued(shared_provider) == [(BUCKET, uploaded["path"])]
    assert shared_provider.tables[QUEUE][0]["reason"]
    assert removed(shared_provider, uploaded["path"])
    assert shared_provider.tables.get("profile_documents", []) == []


def test_a_credential_of_a_type_the_provider_has_replaces_theirs_and_its_file(client, shared_provider):
    """profile_documents is UNIQUE (user_id, document_type): the new credential takes the row, never a 23505."""
    kept = saved_file(shared_provider, AMELIA, "ID.pdf")
    shared_provider.seed("profile_documents", [credential_row(DOC, AMELIA, "id", file_url=kept)])
    uploaded = upload(client)

    response = client.post(f"{API}/me/verification-documents", json={"type": "id", "document_url": uploaded["path"]})

    assert response.status_code == 201, response.text
    [row] = shared_provider.tables["profile_documents"]
    assert (row["id"], row["file_url"], row["review_status"]) == (DOC, uploaded["path"], "PENDING")
    assert queued(shared_provider) == [(BUCKET, kept)]
    assert shared_provider.tables[QUEUE][0]["reason"] == "REPLACED"
    assert removed(shared_provider, kept)
    assert (BUCKET, uploaded["path"]) in shared_provider.storage.objects


def test_saving_a_credential_with_its_own_file_again_keeps_the_file_and_its_review(client, shared_provider):
    kept = saved_file(shared_provider, AMELIA, "ID.pdf")
    shared_provider.seed("profile_documents", [credential_row(DOC, AMELIA, "id", file_url=kept)])

    response = client.post(f"{API}/me/verification-documents",
                           json={"type": "id", "label": "Licence", "document_url": kept})

    assert response.status_code == 201, response.text
    assert (response.json()["status"], response.json()["label"]) == ("verified", "Licence")
    assert queued(shared_provider) == []
    assert (BUCKET, kept) in shared_provider.storage.objects


def test_a_file_outside_the_providers_folder_is_never_queued(client, shared_provider):
    elsewhere = saved_file(shared_provider, OTHER, "Insurance.pdf")

    response = client.post(f"{API}/me/verification-documents", json={"type": "insurance", "document_url": elsewhere})

    assert response.status_code == 400
    assert queued(shared_provider) == []


def test_replacing_the_file_of_a_credential_that_is_gone_queues_the_upload(client, shared_provider):
    uploaded = upload(client)

    gone = "f0000000-0000-4000-8000-000000000000"
    response = client.patch(f"{API}/me/verification-documents/{gone}", json={"document_url": uploaded["path"]})

    assert response.status_code == 404
    assert queued(shared_provider) == [(BUCKET, uploaded["path"])]


def test_a_saved_credential_keeps_its_upload(client, shared_provider):
    uploaded = upload(client)

    response = client.post(f"{API}/me/verification-documents", json={"type": "id", "document_url": uploaded["path"]})

    assert response.status_code == 201, response.text
    assert queued(shared_provider) == []


def test_a_replaced_or_deleted_credentials_old_file_is_queued(client, shared_provider):
    first, second = upload(client, "Licence.pdf"), upload(client, "Licence 2027.pdf")
    created = client.post(f"{API}/me/verification-documents", json={"type": "licence", "document_url": first["path"]})

    replaced = client.patch(f"{API}/me/verification-documents/{created.json()['id']}",
                            json={"document_url": second["path"]})
    assert replaced.status_code == 200, replaced.text
    assert queued(shared_provider) == [(BUCKET, first["path"])]
    assert removed(shared_provider, first["path"])
    assert (BUCKET, second["path"]) in shared_provider.storage.objects

    assert client.delete(f"{API}/me/verification-documents/{created.json()['id']}").status_code == 204
    assert queued(shared_provider) == [(BUCKET, first["path"]), (BUCKET, second["path"])]
    assert removed(shared_provider, second["path"])


def test_an_upload_stays_when_its_use_cannot_be_checked(client, shared_provider, monkeypatch, caplog):
    execute = FakeTableQuery.execute
    failed = []

    def _execute(query):
        if query._name == "profile_documents" and (query._op == "insert" or failed):
            failed.append(query._op)
            raise APIError({"code": "XX000", "message": "connection lost"})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", _execute)
    uploaded = upload(client)

    with caplog.at_level(logging.ERROR, logger="app.services.documents"):
        response = client.post(f"{API}/me/verification-documents", json={"type": "id", "document_url": uploaded["path"]})

    assert response.status_code == 500
    assert failed == ["insert", "select"]
    assert queued(shared_provider) == []
    assert (BUCKET, uploaded["path"]) in shared_provider.storage.objects
    assert "could not check whether a document file is still in use" in caplog.text


def test_a_failed_queueing_still_removes_the_file_and_reports_the_failed_save(client, shared_provider, monkeypatch):
    uploaded = upload(client)
    execute = FakeTableQuery.execute

    def _execute(query):
        if query._name == QUEUE:
            raise ConnectionError("database unreachable")
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", _execute)
    gone = "f0000000-0000-4000-8000-000000000000"
    response = client.patch(f"{API}/me/verification-documents/{gone}", json={"document_url": uploaded["path"]})

    assert response.status_code == 404
    assert (BUCKET, uploaded["path"]) not in shared_provider.storage.objects


def test_a_provider_without_a_profile_cannot_store_a_credential_file(client, strict_schema, as_profile):
    as_profile(id=AMELIA, role="service_provider")
    response = client.post(
        f"{API}/uploads/verification-document", files={"file": ("ID.pdf", b"%PDF-1.7\nID", "application/pdf")}
    )
    assert response.status_code == 404
    assert not strict_schema.storage.objects

    as_profile(id=OTHER, role="tenant")  # the check is for providers only
    assert upload(client)["path"].startswith(f"{OTHER}/")
