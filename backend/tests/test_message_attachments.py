"""Attachments are the sender's own uploads, kept as Storage keys in message_attachments and signed when read.

Chat files live in their own private bucket, message-attachments
(supabase/shared/0003_storage.sql), apart from the identity documents in
profile-documents.
"""

import re
import time
from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError

from app.services import uploads
from tests.factories_messaging import attachment, connection, message, person, stored, uid
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c0000000-0000-4000-8000-000000000009"
SAM = "c0000000-0000-4000-8000-000000000002"
BUCKET = uploads.MESSAGE_ATTACHMENTS_BUCKET
PNG = b"\x89PNG\r\n\x1a\nphoto of the leak"


@pytest.fixture
def thread(client, strict_schema, as_profile):
    """A network thread between Mei (tenant) and Sam (landlord), opened by Mei."""
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(SAM, "LANDLORD", "Sam Okafor")])
    strict_schema.seed("connection_requests", [connection(MEI, SAM)])
    as_profile(id=MEI, role="tenant")
    return client.post("/api/v1/conversations/rental", json={"peer_id": SAM}).json()["id"]


def days_later(monkeypatch, days):
    """Move the clock that decides when a signed link is signed again."""
    now = time.monotonic() + days * 24 * 60 * 60
    monkeypatch.setattr(uploads, "time", SimpleNamespace(monotonic=lambda: now))


def saved_file(fake_db, owner, bucket=BUCKET):
    key = f"{owner}/{'a' * 32}.png"
    fake_db.storage.objects[(bucket, key)] = PNG
    return key


def seed_file_message(db, thread, sender, file_url, name):
    db.seed("messages", [message(thread, sender, None, "2025-12-31T10:00:00+00:00", id=uid(name),
                                 message_type="FILE")])
    db.seed("message_attachments", [attachment(uid(name), file_url)])


def test_chat_files_have_their_own_bucket_and_keep_the_uploaders_folder(client, strict_schema, thread):
    response = client.post(
        "/api/v1/uploads/message-attachment", files={"file": ("Private original name.png", PNG, "image/png")}
    )

    assert response.status_code == 200, response.text
    assert BUCKET == "message-attachments" != uploads.VERIFICATION_DOCUMENTS_BUCKET
    assert re.fullmatch(rf"{MEI}/[a-f0-9]{{32}}\.png", response.json()["path"])
    assert list(strict_schema.storage.objects) == [(BUCKET, response.json()["path"])]


def test_an_attachment_keeps_its_key_and_is_signed_again_when_read(client, strict_schema, as_profile, thread,
                                                                   monkeypatch):
    uploaded = client.post(
        "/api/v1/uploads/message-attachment", files={"file": ("leak.png", PNG, "image/png")}
    ).json()

    sent = client.post(f"/api/v1/conversations/{thread}/messages", json={"attachment_url": uploaded["url"]})
    assert sent.status_code == 201, sent.text
    [saved] = strict_schema.tables["messages"]
    assert (saved["message_type"], saved["content"], saved["sender_user_id"]) == ("FILE", None, MEI)
    [file] = strict_schema.tables["message_attachments"]
    assert (file["message_id"], file["file_url"], file["mime_type"]) == (saved["id"], uploaded["path"], "image/png")
    assert file["file_name"] == uploaded["path"].rsplit("/", 1)[-1]

    days_later(monkeypatch, 8)
    as_profile(id=SAM, role="landlord")
    [received] = client.get(f"/api/v1/conversations/{thread}/messages").json()

    assert received["attachment_url"] not in (uploaded["url"], sent.json()["attachment_url"])
    assert uploads.stored_path(received["attachment_url"], BUCKET) == uploaded["path"]
    assert strict_schema.storage.signatures[-1] == (BUCKET, uploaded["path"], uploads.SIGNED_URL_TTL)
    [inbox] = client.get("/api/v1/conversations").json()
    assert (inbox["last_message"], inbox["last_message_sender_id"]) == ("", MEI)  # "Sent an attachment"
    [notice] = strict_schema.tables["notifications"]
    assert (notice["user_id"], notice["body"]) == (SAM, "Sent an attachment")


def test_a_caption_goes_with_its_file(client, strict_schema, thread):
    key = saved_file(strict_schema, MEI)

    sent = client.post(f"/api/v1/conversations/{thread}/messages", json={"body": "The leak", "attachment_url": key})

    assert sent.status_code == 201, sent.text
    assert (sent.json()["body"], uploads.stored_path(sent.json()["attachment_url"], BUCKET)) == ("The leak", key)
    assert [(m["message_type"], m["content"]) for m in strict_schema.tables["messages"]] == [("FILE", "The leak")]


def test_an_attachment_must_be_the_senders_own_upload(client, strict_schema, thread):
    sams_photo = saved_file(strict_schema, SAM)
    for reference in (
        "https://attacker.example/track.png?u=sam",
        sams_photo,
        strict_schema.storage.signed_url(BUCKET, sams_photo),
        strict_schema.storage.signed_url(uploads.VERIFICATION_DOCUMENTS_BUCKET, f"{MEI}/{'b' * 32}.png"),
        f"verification/{MEI}/{'b' * 32}/ID.pdf",
        f"{MEI}/../{sams_photo}",
    ):
        response = client.post(f"/api/v1/conversations/{thread}/messages", json={"attachment_url": reference})
        assert response.status_code == 400, reference
    assert not strict_schema.tables.get("messages")
    assert not strict_schema.tables.get("message_attachments")


def test_attachments_kept_anywhere_else_are_never_shown(client, strict_schema, as_profile, thread):
    meis_photo = saved_file(strict_schema, MEI)
    seed_file_message(strict_schema, thread, MEI, strict_schema.storage.signed_url(BUCKET, meis_photo), "own-upload")
    seed_file_message(strict_schema, thread, MEI, "https://attacker.example/track.png?u=sam", "remote-image")
    seed_file_message(strict_schema, thread, MEI, saved_file(strict_schema, SAM), "someone-elses")
    seed_file_message(strict_schema, thread, MEI, f"chat/{MEI}/photo.png", "a-mobile-key")
    as_profile(id=SAM, role="landlord")

    response = client.get(f"/api/v1/conversations/{thread}/messages")

    assert response.status_code == 200, response.text
    links = {row["id"]: row["attachment_url"] for row in response.json()}
    assert uploads.stored_path(links[uid("own-upload")], BUCKET) == meis_photo
    assert [links[uid(name)] for name in ("remote-image", "someone-elses", "a-mobile-key")] == [None, None, None]


def test_polling_a_thread_keeps_the_same_attachment_links(client, strict_schema, thread):
    seed_file_message(strict_schema, thread, MEI, saved_file(strict_schema, MEI), "photo")

    first = client.get(f"/api/v1/conversations/{thread}/messages").json()
    second = client.get(f"/api/v1/conversations/{thread}/messages").json()

    assert first[0]["attachment_url"] and first[0]["attachment_url"] == second[0]["attachment_url"]
    assert len(strict_schema.storage.signatures) == 1


def test_a_file_message_whose_attachment_fails_is_not_left_empty(client, strict_schema, thread, monkeypatch):
    key = saved_file(strict_schema, MEI)
    execute = FakeTableQuery.execute

    def attachment_fails(query):
        if query._name == "message_attachments" and query._op == "insert":
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout",
                            "hint": None, "details": None})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", attachment_fails)

    assert client.post(f"/api/v1/conversations/{thread}/messages", json={"attachment_url": key}).status_code == 500
    assert stored(strict_schema, "messages") == []
