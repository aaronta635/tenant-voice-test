"""Credential filenames persist in private Storage keys without a schema change.

Keys start with the owner's users.id, as the bucket's policies read the
first folder: {users.id}/{32 hex}/{file name}.
"""

from io import BytesIO
import re
from types import SimpleNamespace
from urllib.parse import quote, unquote, urlparse

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.services import uploads


@pytest.fixture
def storage(monkeypatch):
    class Storage:
        objects = []
        signatures = []

        def from_(self, bucket):
            assert bucket == uploads.VERIFICATION_DOCUMENTS_BUCKET
            return self

        def upload(self, path, data, options):
            self.objects.append((path, data, options))

        def create_signed_url(self, path, expires_in):
            self.signatures.append((path, expires_in))
            return {"signedURL": f"https://storage.example.test/object/sign/private/{quote(path)}?token=test"}

    fake = Storage()
    monkeypatch.setattr(uploads, "get_supabase_client", lambda: SimpleNamespace(storage=fake))
    return fake


def pdf(filename):
    return UploadFile(BytesIO(b"%PDF-1.7\nTest credential"), filename=filename,
                      headers=Headers({"content-type": "application/pdf"}))


def test_credential_filename_survives_persisted_signed_url_and_repeated_names(storage):
    first = uploads.store_verification_document(pdf("Professional indemnity 2026.pdf"), "profile")
    second = uploads.store_verification_document(pdf("Professional indemnity 2026.pdf"), "profile")
    assert re.fullmatch(r"profile/[a-f0-9]{32}/Professional indemnity 2026\.pdf", first["path"])
    assert first["path"] != second["path"]
    # Every signed URL for the stored key, like this one, still names the file,
    # so the UI reads it back after a refresh without an in-memory filename.
    assert unquote(urlparse(first["url"]).path.split("/")[-1]) == "Professional indemnity 2026.pdf"
    # No scanner is configured in tests, so the object's metadata says it was not scanned.
    assert storage.objects[0][2] == {
        "content-type": "application/pdf", "upsert": "false", "metadata": {"virus_scan": "not_scanned"},
    }
    assert storage.signatures[0] == (first["path"], uploads.SIGNED_URL_TTL)


@pytest.mark.parametrize("original,expected", [
    ("../../private/Insurance.pdf", "Insurance.pdf"),
    (r"C:\Users\someone\ID scan.pdf", "ID scan.pdf"),
    ("Bảo hiểm.pdf", "Bao hiem.pdf"),
    ("Insurance#1?.pdf", "Insurance-1.pdf"),
    ("ID\x00scan.pdf", "ID-scan.pdf"),
    (None, "document.pdf"),
])
def test_filename_is_safe_and_readable_inside_unique_directory(storage, original, expected):
    stored = uploads.store_verification_document(pdf(original), "profile")
    parts = stored["path"].split("/")
    assert len(parts) == 3
    assert parts[0] == "profile" and re.fullmatch(r"[a-f0-9]{32}", parts[1])
    assert parts[-1] == expected
    assert all(part not in {".", ".."} for part in parts)
    assert "\x00" not in stored["path"] and "\\" not in stored["path"]


def test_sniffed_file_type_controls_extension_and_long_names_are_bounded(storage):
    file = UploadFile(BytesIO(b"\x89PNG\r\n\x1a\nimage"), filename="Identity.html",
                      headers=Headers({"content-type": "image/png"}))
    stored = uploads.store_verification_document(file, "profile")
    assert stored["path"].endswith("/Identity.png")
    long_name = uploads.store_verification_document(pdf("A" * 500 + ".pdf"), "profile")
    assert len(long_name["path"].split("/")[-1]) <= 164


def test_filename_does_not_bypass_content_validation(storage):
    file = UploadFile(BytesIO(b"<html>Not a PDF</html>"), filename="Insurance.pdf",
                      headers=Headers({"content-type": "application/pdf"}))
    with pytest.raises(HTTPException) as exc:
        uploads.store_verification_document(file, "profile")
    assert exc.value.status_code == 415
    assert not storage.objects


def test_message_attachment_naming_is_unchanged(fake_db):  # chat files go to their own bucket
    stored = uploads.store_message_attachment(pdf("Private original name.pdf"), "profile")
    assert re.fullmatch(r"profile/[a-f0-9]{32}\.pdf", stored["path"])


def test_a_file_in_the_owners_folder_or_the_webs_earlier_one_is_theirs():
    folder = uploads.verification_folder("b0000000-0000-4000-8000-000000000001")
    mine = f"{folder}/{'a' * 32}/ID.pdf"
    earlier = f"verification/{folder}/{'a' * 32}/ID.pdf"

    assert folder == "b0000000-0000-4000-8000-000000000001"
    assert uploads.owned_path(mine, uploads.VERIFICATION_DOCUMENTS_BUCKET, folder) == mine
    assert uploads.owned_path(earlier, uploads.VERIFICATION_DOCUMENTS_BUCKET, folder) == earlier
    # Someone else's folder, and the earlier layout in another bucket, are not.
    assert uploads.owned_path(f"verification/b1/{'a' * 32}/ID.pdf", uploads.VERIFICATION_DOCUMENTS_BUCKET, folder) is None
    assert uploads.owned_path(earlier, uploads.MESSAGE_ATTACHMENTS_BUCKET, folder) is None
