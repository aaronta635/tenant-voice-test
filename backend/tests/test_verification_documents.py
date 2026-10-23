"""Provider credentials as shared profile_documents rows (migration plan §3 b2).

Required files, one per document type (a new one replaces the old: the
table is UNIQUE (user_id, document_type)), re-review on a new file, and the
mapping of the web's types and statuses onto the mobile app's.
"""

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.services import verification_documents as documents
from tests import fake_supabase
from tests.factories import NOW
from tests.factories_provider_core import credential_row, seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

OWNER = "a0000000-0000-4000-8000-000000000001"
DOC = "d0000000-0000-4000-8000-000000000001"
MOBILE_DOC = "d0000000-0000-4000-8000-000000000002"
FILE = f"{OWNER}/{'a' * 32}/Licence.pdf"
# Where the web stored a file before keys started with the owner's users.id.
EARLIER_FILE = f"verification/{OWNER}/{'a' * 32}/Licence.pdf"


@pytest.fixture
def provider(strict_schema):
    seed_provider(strict_schema, OWNER)
    return strict_schema


def _row(db, document_id=DOC):
    return next(row for row in db.tables["profile_documents"] if row["id"] == document_id)


def test_a_credential_is_saved_as_a_pending_profile_document(provider):
    created = documents.create_document(OWNER, OWNER, {"type": "licence", "label": "Builder", "document_url": FILE})

    row = _row(provider, created["id"])
    assert (row["user_id"], row["document_type"], row["file_url"]) == (OWNER, "TRADE_LICENCE", FILE)
    assert (row["review_status"], row["is_verified"], row["metadata"]) == (
        "PENDING", False, {"web_type": "licence", "label": "Builder"},
    )
    assert (created["type"], created["status"], created["label"], created["provider_id"]) == (
        "licence", "pending", "Builder", OWNER,
    )


def test_credentials_other_than_abn_need_a_file(provider):
    with pytest.raises(HTTPException) as exc:
        documents.create_document(OWNER, OWNER, {"type": "licence", "label": "Licence"})
    assert exc.value.status_code == 400

    abn = documents.create_document(OWNER, OWNER, {"type": "abn", "label": "ABN"})
    row = _row(provider, abn["id"])
    assert (abn["type"], abn["document_url"]) == ("abn", None)
    assert (row["document_type"], row["file_url"], row["metadata"]["web_type"]) == ("OTHER", "", "abn")


def test_one_credential_per_document_type_a_new_one_replaces_it(provider):
    provider.seed("profile_documents", [credential_row(DOC, OWNER, "id")])

    replaced = documents.create_document(OWNER, OWNER, {"type": "id", "document_url": f"{OWNER}/{'b' * 32}/ID.pdf"})

    assert (replaced["id"], replaced["status"], replaced["label"]) == (DOC, "pending", None)
    [row] = provider.tables["profile_documents"]
    assert (row["file_url"], row["review_status"], row["metadata"]) == (
        f"{OWNER}/{'b' * 32}/ID.pdf", "PENDING", {"web_type": "id"})


def test_an_abn_and_an_other_credential_share_the_one_other_document(provider):
    documents.create_document(OWNER, OWNER, {"type": "abn", "label": "ABN"})
    other = documents.create_document(OWNER, OWNER, {"type": "other", "label": "Working with children check",
                                                     "document_url": FILE})

    [row] = [row for row in provider.tables["profile_documents"] if row["document_type"] == "OTHER"]
    assert (row["id"], row["file_url"], row["metadata"]) == (
        other["id"], FILE, {"web_type": "other", "label": "Working with children check"})
    assert [doc["type"] for doc in documents.list_my_documents(OWNER, OWNER)] == ["other"]


def test_a_file_the_web_stored_before_the_users_id_folders_is_still_the_providers(provider):
    created = documents.create_document(OWNER, OWNER, {"type": "licence", "document_url": EARLIER_FILE})

    assert created["document_url"] is None  # not in Storage here, so no link; but accepted as theirs
    assert provider.tables["profile_documents"][0]["file_url"] == EARLIER_FILE


def test_swapping_the_file_sends_a_verified_credential_back_to_review(provider):
    provider.seed("profile_documents", [credential_row(
        DOC, OWNER, "insurance", verified_by_user_id=OWNER, rejection_reason="old note",
    )])

    updated = documents.update_document(DOC, OWNER, OWNER, {"document_url": f"{OWNER}/b2/Insurance 2027.pdf"})

    assert (updated["status"], updated["verified_at"]) == ("pending", None)
    row = _row(provider)
    assert (row["review_status"], row["is_verified"], row["verified_by_user_id"], row["rejection_reason"]) == (
        "PENDING", False, None, None,
    )
    assert row["updated_at"] != NOW


def test_a_label_edit_merges_metadata_and_keeps_the_review(provider):
    provider.seed("profile_documents", [credential_row(DOC, OWNER, "insurance", metadata={"web_type": "insurance",
                                                                                         "mobile_note": "kept"})])

    updated = documents.update_document(DOC, OWNER, OWNER, {"label": "Public liability", "document_url": None})

    assert (updated["label"], updated["status"]) == ("Public liability", "verified")
    assert _row(provider)["metadata"] == {"web_type": "insurance", "mobile_note": "kept", "label": "Public liability"}


def test_the_mobile_apps_documents_read_as_web_credentials(provider):
    provider.seed("profile_documents", [
        credential_row(DOC, OWNER, "id", document_type="PASSPORT", metadata=None, review_status="PENDING",
                       is_verified=True),  # verified before review_status existed
        credential_row(MOBILE_DOC, OWNER, "other", document_type="POLICE_CHECK", status="rejected"),
        credential_row("d0000000-0000-4000-8000-000000000003", OWNER, "other", document_type="BANK_STATEMENT"),
    ])

    listed = {doc["id"]: (doc["type"], doc["status"]) for doc in documents.list_my_documents(OWNER, OWNER)}

    # A tenancy paper is not a provider credential.
    assert listed == {DOC: ("id", "verified"), MOBILE_DOC: ("other", "rejected")}


@pytest.mark.parametrize("document_type", ["BANK_STATEMENT", "MEDICARE_CARD"])
def test_a_users_other_documents_cannot_be_edited_or_deleted_as_credentials(provider, document_type):
    # A tenancy or identity paper the mobile app keeps for the same account.
    provider.seed("profile_documents", [credential_row(DOC, OWNER, "other", document_type=document_type,
                                                       file_url=FILE, metadata={"note": "mobile"})])
    before = dict(_row(provider))
    upload = f"{OWNER}/{'c' * 32}/New.pdf"

    for change in ({"label": "x"}, {"document_url": upload}):
        with pytest.raises(HTTPException) as exc:
            documents.update_document(DOC, OWNER, OWNER, change)
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        documents.delete_document(DOC, OWNER, OWNER)
    assert exc.value.status_code == 404

    assert provider.tables["profile_documents"] == [before]
    # Only the upload that was never saved goes; the paper's own file stays.
    assert [row["file_path"] for row in provider.tables["profile_document_deletion_queue"]] == [upload]


def test_deleting_a_credential_removes_its_row(provider):
    provider.seed("profile_documents", [credential_row(DOC, OWNER, "licence", file_url=FILE)])
    documents.delete_document(DOC, OWNER, OWNER)
    assert provider.tables["profile_documents"] == []
    with pytest.raises(HTTPException) as exc:
        documents.delete_document(DOC, OWNER, OWNER)
    assert exc.value.status_code == 404


def test_an_approved_credential_can_be_deleted(provider):
    """Its review events stay: their foreign key to the document is ON DELETE SET NULL."""
    provider.seed("profile_documents", [credential_row(DOC, OWNER, "licence", file_url=FILE)])

    documents.delete_document(DOC, OWNER, OWNER)

    assert provider.tables["profile_documents"] == []


def test_a_credential_the_database_keeps_is_a_conflict(provider, monkeypatch):
    provider.seed("profile_documents", [credential_row(DOC, OWNER, "licence")])
    execute = fake_supabase.FakeTableQuery.execute

    def _execute(query):
        if query._op == "delete" and query._name == "profile_documents":
            raise APIError({"code": "23503", "message": "still referenced"})
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", _execute)
    with pytest.raises(HTTPException) as exc:
        documents.delete_document(DOC, OWNER, OWNER)

    assert exc.value.status_code == 409
    assert len(provider.tables["profile_documents"]) == 1
