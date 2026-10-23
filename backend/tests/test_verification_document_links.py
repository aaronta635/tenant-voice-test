"""Credentials keep their Storage key and get a fresh signed link whenever they are read."""

import time
from types import SimpleNamespace

import pytest

from app.services import uploads
from tests.factories_provider_core import credential_row, seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA = "a0000000-0000-4000-8000-000000000001"
OTHER = "a0000000-0000-4000-8000-000000000002"
BUCKET = uploads.VERIFICATION_DOCUMENTS_BUCKET


def doc_id(n: int) -> str:
    return f"d0000000-0000-4000-8000-{n:012d}"


@pytest.fixture
def shared_provider(strict_schema, as_profile):
    seed_provider(strict_schema, AMELIA, "Amelia Whitlock", business_name="Whitlock Property")
    as_profile(id=AMELIA, role="service_provider")
    return strict_schema


def days_later(monkeypatch, days):
    """Move the clock that decides when a signed link is signed again."""
    now = time.monotonic() + days * 24 * 60 * 60
    monkeypatch.setattr(uploads, "time", SimpleNamespace(monotonic=lambda: now))


def saved_file(fake_db, name):
    path = f"verification/{AMELIA}/{'a' * 32}/{name}"
    fake_db.storage.objects[(BUCKET, path)] = b"%PDF-1.7"
    return path


def test_a_credential_keeps_its_file_key_and_links_with_a_fresh_url(client, shared_provider, monkeypatch):
    uploaded = client.post(
        "/api/v1/uploads/verification-document",
        files={"file": ("Insurance 2026.pdf", b"%PDF-1.7\nInsurance", "application/pdf")},
    ).json()

    created = client.post(
        "/api/v1/me/verification-documents",
        json={"type": "insurance", "label": "Insurance", "document_url": uploaded["url"]},
    )
    assert created.status_code == 201, created.text
    assert [row["file_url"] for row in shared_provider.tables["profile_documents"]] == [uploaded["path"]]

    days_later(monkeypatch, 8)
    [listed] = client.get("/api/v1/me/verification-documents").json()

    assert listed["document_url"] not in (uploaded["url"], created.json()["document_url"])
    assert uploads.stored_path(listed["document_url"], BUCKET) == uploaded["path"]
    assert shared_provider.storage.signatures[-1] == (BUCKET, uploaded["path"], uploads.SIGNED_URL_TTL)


def test_credentials_saved_before_keys_were_stored_are_signed_again(client, shared_provider):
    licence = saved_file(shared_provider, "Licence.pdf")
    stale_link = shared_provider.storage.signed_url(BUCKET, licence)
    shared_provider.seed("profile_documents", [
        credential_row(doc_id(1), AMELIA, "licence", file_url=stale_link),
        credential_row(doc_id(2), AMELIA, "insurance", file_url=f"verification/{AMELIA}/{'b' * 32}/Deleted.pdf"),
        credential_row(doc_id(3), AMELIA, "id", file_url="https://example.test/doc.pdf"),
    ])

    response = client.get("/api/v1/me/verification-documents")

    assert response.status_code == 200, response.text
    links = {doc["type"]: doc["document_url"] for doc in response.json()}
    assert links["licence"] != stale_link
    assert uploads.stored_path(links["licence"], BUCKET) == licence
    assert links["insurance"] is None
    assert links["id"] == "https://example.test/doc.pdf"


def test_a_credential_file_must_be_the_providers_own_upload(client, shared_provider):
    elsewhere = saved_file(shared_provider, "Insurance.pdf").replace(AMELIA, OTHER)
    for reference in (
        "https://files.example.test/insurance.pdf",
        elsewhere,
        shared_provider.storage.signed_url(BUCKET, elsewhere),
        f"{OTHER}/{'c' * 32}/Insurance.pdf",
        f"{AMELIA}/../{OTHER}/{'c' * 32}/Insurance.pdf",
        f"verification/{AMELIA}/../{OTHER}/{'c' * 32}/Insurance.pdf",
    ):
        response = client.post(
            "/api/v1/me/verification-documents", json={"type": "insurance", "document_url": reference}
        )
        assert response.status_code == 400, reference
    assert shared_provider.tables.get("profile_documents", []) == []


def test_saving_the_listed_link_again_keeps_the_review(client, shared_provider):
    insurance = saved_file(shared_provider, "Insurance.pdf")
    shared_provider.seed("profile_documents", [credential_row(doc_id(1), AMELIA, "insurance", file_url=insurance)])
    [listed] = client.get("/api/v1/me/verification-documents").json()

    response = client.patch(
        f"/api/v1/me/verification-documents/{listed['id']}",
        json={"label": "Public liability", "document_url": listed["document_url"]},
    )

    assert response.status_code == 200, response.text
    assert (response.json()["label"], response.json()["status"]) == ("Public liability", "verified")
    assert [row["file_url"] for row in shared_provider.tables["profile_documents"]] == [insurance]
