"""A private document opens only through a link signed for a few minutes, for its owner (R15).

Lists never carry a link: each opening asks for one, signed for
documents.LINK_TTL seconds and not cached. Only a file in the owner's own
folder opens here, {users.id}/ as the bucket's policies have it, or the
verification/{users.id}/ the web used before; admins open any file from the
admin console (test_admin_users).
"""

import pytest

from app.services import documents
from tests import fake_supabase
from tests.factories_documents import BUCKET, document_row, stored_file
from tests.factories_identity import users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

TENANT = "e0000000-0000-4000-8000-000000000001"
DOC = "d1000000-0000-4000-8000-000000000001"


@pytest.fixture
def tenant(strict_schema, as_profile):
    strict_schema.seed("users", [users_row(TENANT, "tia@example.test")])
    as_profile(id=TENANT, role="tenant")
    return strict_schema


def link(client, document_id=DOC):
    return client.get(f"/api/v1/me/documents/{document_id}/link")


def test_the_owner_opens_a_file_through_a_link_signed_for_minutes(client, tenant):
    path = stored_file(tenant, TENANT)
    tenant.seed("profile_documents", [document_row(DOC, TENANT, file_url=path)])

    first, second = link(client), link(client)

    assert first.status_code == 200, first.text
    assert first.headers["cache-control"] == "no-store"
    assert first.json()["expires_in"] == documents.LINK_TTL == 300
    assert first.json()["url"].startswith(f"http://supabase.invalid/storage/v1/object/sign/{BUCKET}/")
    # Each opening signs again: a link is never handed out twice.
    assert first.json()["url"] != second.json()["url"]
    assert tenant.storage.signatures == [(BUCKET, path, 300), (BUCKET, path, 300)]


def test_the_list_carries_no_link(client, tenant):
    tenant.seed("profile_documents", [document_row(DOC, TENANT, file_url=stored_file(tenant, TENANT))])

    [listed] = client.get("/api/v1/me/documents").json()["documents"]

    assert "url" not in str(listed).lower() and listed["can_open"] is True
    assert tenant.storage.signatures == []


@pytest.mark.parametrize("earlier", [False, True], ids=["users.id folder", "earlier verification folder"])
def test_a_file_the_web_stored_in_either_layout_opens(client, tenant, earlier):
    path = stored_file(tenant, TENANT, earlier=earlier)
    tenant.seed("profile_documents", [document_row(DOC, TENANT, file_url=path)])

    assert link(client).status_code == 200
    assert tenant.storage.signatures == [(BUCKET, path, 300)]


def test_a_file_the_mobile_app_stored_in_the_owners_folder_opens(client, tenant):
    path = f"{TENANT}/mobile-upload.pdf"
    tenant.storage.objects[(BUCKET, path)] = b"%PDF-1.7"
    tenant.seed("profile_documents", [document_row(DOC, TENANT, file_url=path)])

    assert link(client).status_code == 200
    listed = client.get("/api/v1/me/documents").json()["documents"][0]
    # The name is the web's own layout's only.
    assert (listed["can_open"], listed["file_name"]) == (True, None)


SOMEONE_ELSE = f"{'f' * 8}-0000-4000-8000-000000000009"


@pytest.mark.parametrize("file_url, code", [
    ("", 404),  # a document saved without a file
    (f"{SOMEONE_ELSE}/{'a' * 32}/Passport.pdf", 409),  # someone else's folder
    (f"verification/{SOMEONE_ELSE}/{'a' * 32}/Passport.pdf", 409),  # theirs in the earlier layout
    (f"{TENANT}/../{SOMEONE_ELSE}/{'a' * 32}/Passport.pdf", 409),  # a way out of the owner's folder
    ("https://files.example.test/passport.pdf", 409),  # a link outside the bucket
])
def test_only_a_file_in_the_owners_own_folder_opens(client, tenant, file_url, code):
    tenant.seed("profile_documents", [document_row(DOC, TENANT, file_url=file_url)])

    response = link(client)

    assert response.status_code == code
    assert tenant.storage.signatures == []
    listed = client.get("/api/v1/me/documents").json()["documents"][0]
    assert listed["can_open"] is False


def test_a_link_storage_cannot_sign_is_a_clear_failure(client, tenant, monkeypatch):
    tenant.seed("profile_documents", [document_row(DOC, TENANT, file_url=stored_file(tenant, TENANT))])

    def create_signed_url(self, path, expires_in):
        raise ConnectionError("storage unreachable")

    monkeypatch.setattr(fake_supabase.FakeBucket, "create_signed_url", create_signed_url)

    response = link(client)

    assert response.status_code == 502
    assert response.json()["detail"] == "Could not open the file. Please try again."
