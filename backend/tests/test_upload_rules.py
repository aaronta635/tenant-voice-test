"""Each shared Storage bucket's own size limit and file types.

Regression cover: every upload allowed 5 MB and GIF, but the shared
profile-documents bucket refuses GIF, so a GIF credential passed validation
and the upload then answered 502. Chat attachments have a bucket of their own
(message-attachments), which takes GIF. A bucket with no rules was a bare
KeyError, so every chat upload answered 500 once that bucket was added.
"""

from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.services import uploads

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c0000000-0000-4000-8000-000000000001"
MB = 1024 * 1024
GIF = b"GIF89a" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n"
PDF = b"%PDF-1.7\n"


def _file(data: bytes, content_type: str, name: str = "file") -> UploadFile:
    return UploadFile(BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


def _sized(head: bytes, size: int) -> bytes:
    return head + b"\x00" * (size - len(head))


def _error(bucket: str, data: bytes, content_type: str) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        uploads.store(_file(data, content_type), bucket, prefix=MEI)
    return caught.value


def test_a_gif_is_refused_for_profile_documents_before_it_reaches_storage(client, fake_db, as_profile):
    as_profile(id=MEI, role="tenant")

    response = client.post("/api/v1/uploads/verification-document", files={"file": ("photo.gif", GIF, "image/gif")})

    assert (response.status_code, response.json()["detail"]) == (
        415, "Unsupported file type. Allowed: application/pdf, image/jpeg, image/png, image/webp")
    assert fake_db.storage.objects == {}


def test_a_gif_named_as_a_png_is_refused_too(client, fake_db, as_profile):
    as_profile(id=MEI, role="tenant")

    response = client.post("/api/v1/uploads/verification-document", files={"file": ("photo.png", GIF, "image/png")})

    assert response.status_code == 415
    assert fake_db.storage.objects == {}


def test_a_chat_gif_is_stored_in_the_message_attachments_bucket(client, fake_db, as_profile):
    as_profile(id=MEI, role="tenant")

    response = client.post("/api/v1/uploads/message-attachment", files={"file": ("photo.gif", GIF, "image/gif")})

    assert response.status_code == 200, response.text
    path = response.json()["path"]
    assert path.startswith(f"{MEI}/") and path.endswith(".gif")
    assert fake_db.storage.objects == {("message-attachments", path): GIF}


def test_a_bucket_without_rules_is_named_rather_than_a_bare_key_error(fake_db):
    with pytest.raises(ValueError, match="no rules for the 'avatars' bucket"):
        uploads.store(_file(PNG, "image/png"), "avatars", prefix=MEI)
    assert fake_db.storage.objects == {}


@pytest.mark.parametrize("bucket, limit", [
    ("profile-documents", 5),
    ("message-attachments", 5),
    ("property-images", 3),
    ("provider-portfolios", 10),
])
def test_each_bucket_takes_files_up_to_its_own_limit(fake_db, bucket, limit):
    stored = uploads.store(_file(_sized(PNG, limit * MB), "image/png"), bucket, prefix=MEI)
    assert (stored["size"], stored["content_type"]) == (limit * MB, "image/png")
    assert (bucket, stored["path"]) in fake_db.storage.objects

    error = _error(bucket, _sized(PNG, limit * MB + 1), "image/png")
    assert (error.status_code, error.detail) == (413, f"File is too large (max {limit} MB)")


@pytest.mark.parametrize("bucket, data, content_type, accepted", [
    ("profile-documents", PDF, "application/pdf", True),
    ("profile-documents", GIF, "image/gif", False),
    ("message-attachments", GIF, "image/gif", True),
    ("message-attachments", PDF, "application/pdf", True),
    ("property-images", GIF, "image/gif", True),
    ("property-images", PDF, "application/pdf", False),
    ("provider-portfolios", PNG, "image/png", True),
    ("provider-portfolios", GIF, "image/gif", False),
    ("provider-portfolios", PDF, "application/pdf", False),
])
def test_each_bucket_takes_only_its_own_types(fake_db, bucket, data, content_type, accepted):
    if accepted:
        stored = uploads.store(_file(data, content_type), bucket, prefix=MEI)
        assert stored["path"].endswith(uploads.EXTENSIONS[content_type])
        return
    error = _error(bucket, data, content_type)
    allowed = ", ".join(sorted(uploads.BUCKETS[bucket].content_types))
    assert (error.status_code, error.detail) == (415, f"Unsupported file type. Allowed: {allowed}")
    assert fake_db.storage.objects == {}


@pytest.mark.parametrize("bucket, public", [
    ("profile-documents", False),
    ("message-attachments", False),
    ("property-images", True),
    ("provider-portfolios", True),
])
def test_a_public_bucket_returns_its_permanent_url_and_a_private_one_a_signed_url(fake_db, bucket, public):
    stored = uploads.store(_file(PNG, "image/png"), bucket, prefix=MEI)

    if public:
        assert stored["url"] == uploads.public_url(bucket, stored["path"])
        assert fake_db.storage.signatures == []
    else:
        assert stored["url"].startswith(f"http://supabase.invalid/storage/v1/object/sign/{bucket}/{stored['path']}?")
        assert [signed[:2] for signed in fake_db.storage.signatures] == [(bucket, stored["path"])]
