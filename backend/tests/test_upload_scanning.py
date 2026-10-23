"""Virus scanning of uploads (tracker assumption #22), against a fake clamd on a free port.

The fake speaks clamd's INSTREAM protocol: a zINSTREAM command, the file as
length-prefixed chunks, a zero length, then one NUL-terminated reply. It
reports the EICAR test string as infected. A scanned file's outcome is kept
in the stored object's metadata; without a scanner the file is stored as
not_scanned, and while one is configured nothing unscanned is stored.
"""

import socket
import socketserver
import struct
import threading

import pytest

from app.core.config import settings
from app.services import uploads
from tests.factories_identity import users_row
from tests.fake_supabase import FakeBucket

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c0000000-0000-4000-8000-000000000001"
PDF = b"%PDF-1.7\n"
PNG = b"\x89PNG\r\n\x1a\n"
EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
ATTACHMENT = "/api/v1/uploads/message-attachment"
DOCUMENTS = "/api/v1/me/documents"


def _read_exact(connection, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = connection.recv(size - len(data))
        if not chunk:
            raise ConnectionError("the client hung up")
        data += chunk
    return data


class _ClamdHandler(socketserver.BaseRequestHandler):
    def handle(self):
        server: FakeClamd = self.server  # type: ignore[assignment]
        command = b""
        while not command.endswith(b"\0"):
            command += _read_exact(self.request, 1)
        server.commands.append(command)
        if server.silent:
            server.release.wait(5)
            return
        stream, chunks = b"", 0
        while size := struct.unpack("!I", _read_exact(self.request, 4))[0]:
            stream += _read_exact(self.request, size)
            chunks += 1
        server.streams.append((stream, chunks))
        reply = server.reply or ("stream: Eicar-Test-Signature FOUND" if EICAR in stream else "stream: OK")
        self.request.sendall(reply.encode() + b"\0")


class FakeClamd(socketserver.ThreadingTCPServer):
    """clamd on 127.0.0.1 and a free port. reply replaces its answer; a silent one never answers."""

    daemon_threads = True

    def __init__(self, reply: str | None = None, silent: bool = False):
        super().__init__(("127.0.0.1", 0), _ClamdHandler)
        self.reply, self.silent = reply, silent
        self.commands: list[bytes] = []
        self.streams: list[tuple[bytes, int]] = []
        self.release = threading.Event()

    @property
    def port(self) -> int:
        return self.server_address[1]


@pytest.fixture
def clamd(monkeypatch):
    """Start a fake clamd and point the settings at it; clamd(reply=..., silent=...) for another kind."""
    servers = []

    def start(reply: str | None = None, silent: bool = False) -> FakeClamd:
        server = FakeClamd(reply, silent)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        monkeypatch.setattr(settings, "clamav_host", "127.0.0.1")
        monkeypatch.setattr(settings, "clamav_port", server.port)
        return server

    yield start
    for server in servers:
        server.release.set()
        server.shutdown()
        server.server_close()


@pytest.fixture
def stored_with(monkeypatch):
    """The options each upload sent to Storage, by (bucket, path)."""
    seen: dict[tuple[str, str], dict] = {}
    upload = FakeBucket.upload

    def recording(bucket, path, data, options):
        seen[(bucket._bucket, path)] = options
        return upload(bucket, path, data, options)

    monkeypatch.setattr(FakeBucket, "upload", recording)
    return seen


def _free_port() -> int:
    """A port nothing listens on: bound once to find it, then released."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _send(client, data: bytes, content_type: str = "application/pdf", name: str = "lease.pdf"):
    return client.post(ATTACHMENT, files={"file": (name, data, content_type)})


def test_without_a_scanner_a_file_is_stored_and_marked_not_scanned(client, fake_db, as_profile, stored_with, monkeypatch):
    def no_network(*_args, **_kwargs):
        raise AssertionError("scanning is off: no connection may be made")

    monkeypatch.setattr(uploads.socket, "create_connection", no_network)
    as_profile(id=MEI, role="tenant")

    response = _send(client, PDF + b"lease terms")

    assert response.status_code == 200, response.text
    path = response.json()["path"]
    assert fake_db.storage.objects == {("message-attachments", path): PDF + b"lease terms"}
    assert stored_with[("message-attachments", path)]["metadata"] == {"virus_scan": "not_scanned"}
    assert client.get("/api/v1/uploads/scanning").json() == {"enabled": False}


def test_a_clean_file_is_scanned_before_it_is_stored_with_the_result(client, fake_db, as_profile, clamd, stored_with):
    scanner = clamd()
    as_profile(id=MEI, role="tenant")

    response = _send(client, PNG + b"kitchen ceiling", "image/png", "leak.png")

    assert response.status_code == 200, response.text
    assert scanner.commands == [b"zINSTREAM\0"]
    assert [stream for stream, _ in scanner.streams] == [PNG + b"kitchen ceiling"]
    path = response.json()["path"]
    assert fake_db.storage.objects == {("message-attachments", path): PNG + b"kitchen ceiling"}
    record = stored_with[("message-attachments", path)]["metadata"]
    assert (record["virus_scan"], record["virus_scanner"]) == ("clean", "clamav")
    assert record["virus_scanned_at"]
    assert client.get("/api/v1/uploads/scanning").json() == {"enabled": True}


def test_a_large_file_reaches_the_scanner_whole_in_chunks(fake_db, clamd):
    scanner = clamd()
    data = PDF + bytes(range(256)) * 1024  # 256 KB: four chunks of 64 KB, and a bit

    record = uploads.scan(data)

    assert record["virus_scan"] == "clean"
    [(stream, chunks)] = scanner.streams
    assert stream == data and chunks == 5


def test_an_infected_file_is_refused_and_nothing_is_stored(client, fake_db, as_profile, clamd):
    clamd()
    as_profile(id=MEI, role="tenant")

    response = _send(client, PDF + EICAR)

    assert (response.status_code, response.json()["detail"]) == (422, "This file contains a virus, so it was not uploaded.")
    assert fake_db.storage.objects == {}


def test_an_infected_document_saves_no_row_either(client, fake_db, as_profile, clamd):
    clamd()
    fake_db.seed("users", [users_row(MEI, "mei@example.test")])
    as_profile(id=MEI, role="tenant")

    response = client.post(DOCUMENTS, data={"document_type": "PASSPORT"},
                           files={"file": ("passport.pdf", PDF + EICAR, "application/pdf")})

    assert (response.status_code, response.json()["detail"]) == (422, "This file contains a virus, so it was not uploaded.")
    assert fake_db.storage.objects == {}
    assert not fake_db.tables.get("profile_documents")


def test_a_scanner_that_is_down_refuses_the_upload(client, fake_db, as_profile, monkeypatch, caplog):
    monkeypatch.setattr(settings, "clamav_host", "127.0.0.1")
    monkeypatch.setattr(settings, "clamav_port", _free_port())
    as_profile(id=MEI, role="tenant")

    response = _send(client, PDF + b"lease terms")

    assert response.status_code == 503
    assert response.json()["detail"] == uploads.SCANNER_DOWN
    assert fake_db.storage.objects == {}
    assert "virus scanner could not be reached" in caplog.text


def test_a_scanner_that_never_answers_refuses_the_upload_after_its_timeout(client, fake_db, as_profile, clamd, monkeypatch):
    clamd(silent=True)
    monkeypatch.setattr(settings, "clamav_timeout_seconds", 0.2)
    as_profile(id=MEI, role="tenant")

    response = _send(client, PDF + b"lease terms")

    assert response.status_code == 503
    assert fake_db.storage.objects == {}


def test_a_scanner_error_refuses_the_upload_rather_than_storing_it_unscanned(client, fake_db, as_profile, clamd):
    clamd(reply="INSTREAM size limit exceeded. ERROR")
    as_profile(id=MEI, role="tenant")

    response = _send(client, PDF + b"lease terms")

    assert response.status_code == 503
    assert fake_db.storage.objects == {}


def test_the_scanning_state_needs_a_signed_in_member(client):
    assert client.get("/api/v1/uploads/scanning").status_code == 401
