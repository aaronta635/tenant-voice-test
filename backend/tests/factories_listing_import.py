"""A fake internet and small PDFs for the listing import (services/listing_import.py).

FakeWeb stands in for DNS and for the sockets under httpcore: the import
resolves names through it and opens its connections and TLS on it. A test
scripts what each name resolves to and what each address answers, and sees
every lookup, the address and port each connection went to, its connect
timeout, the TLS server name and the request bytes. Nothing leaves the
machine: an address with no reply scripted refuses the connection. Its clock
is the import's, so an answer can take its time without a test waiting.
"""

import gzip
import socket
from dataclasses import dataclass, field

import httpcore

from app.services import listing_import

PUBLIC = "93.184.216.34"
PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"
OTHER_PUBLIC = "151.101.1.69"


@dataclass
class Reply:
    status: int = 200
    headers: dict[str, str] = field(default_factory=lambda: {"Content-Type": "text/html; charset=utf-8"})
    body: bytes = b""
    # The status line and headers come after `wait` seconds on the clock.
    wait: float = 0.0
    # The body sent in these pieces, each taking `seconds`; else at once.
    chunks: list[bytes] | None = None
    seconds: float = 0.0
    # False: no Content-Length, the body ends when the connection closes.
    length: bool = True
    # The connection is refused, or never opens in time, instead of answering.
    refuse: bool = False
    hang: bool = False


def html(body: str, **headers: str) -> Reply:
    return Reply(body=body.encode("utf-8"), headers={"Content-Type": "text/html; charset=utf-8", **headers})


def redirect(location: str, status: int = 302) -> Reply:
    return Reply(status=status, headers={"Location": location, "Content-Type": "text/html"})


def gzipped(body: bytes, **headers: str) -> Reply:
    return Reply(body=gzip.compress(body), headers={"Content-Type": "text/html", "Content-Encoding": "gzip", **headers})


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class FakeWeb(httpcore.NetworkBackend):
    def __init__(self):
        # host -> addresses, or a function answering each lookup in turn (for rebinding).
        self.dns: dict[str, object] = {}
        self.replies: dict[tuple[str, int], list[Reply]] = {}
        self.lookups: list[str] = []
        self.connections: list[dict] = []
        self.clock = FakeClock()

    def install(self, monkeypatch) -> "FakeWeb":
        monkeypatch.setattr(listing_import, "_getaddrinfo", self._lookup)
        monkeypatch.setattr(listing_import, "_network_backend", lambda: self)
        monkeypatch.setattr(listing_import, "_clock", self.clock)
        return self

    def name(self, host: str, *addresses: str) -> None:
        self.dns[host] = list(addresses)

    def serve(self, address: str, *replies: Reply, port: int = 443) -> None:
        """What the address answers, a reply per connection in turn; the last one answers again."""
        self.replies[(address, port)] = list(replies)

    def site(self, host: str, *replies: Reply, address: str = PUBLIC, port: int = 443) -> None:
        self.name(host, address)
        self.serve(address, *replies, port=port)

    def _lookup(self, host: str, port: int) -> list[str]:
        self.lookups.append(host)
        answer = self.dns.get(host)
        if answer is None:
            raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")
        return list(answer(len([name for name in self.lookups if name == host])) if callable(answer) else answer)

    # httpcore.NetworkBackend
    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        connection = {"address": host, "port": port, "timeout": timeout, "sni": None, "request": b""}
        self.connections.append(connection)
        queue = self.replies.get((host, port))
        if not queue:
            raise httpcore.ConnectError("nothing answers on that address")
        reply = queue.pop(0) if len(queue) > 1 else queue[0]
        if reply.refuse:
            raise httpcore.ConnectError("connection refused")
        if reply.hang:
            raise httpcore.ConnectTimeout("timed out")
        return FakeStream(self, connection, reply)

    def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise AssertionError("the import never opens a unix socket")

    def sleep(self, seconds):
        self.clock.now += seconds

    @property
    def requests(self) -> list[dict]:
        """Each request sent: its address, port, TLS name, request line and headers (lower-case names)."""
        sent = []
        for connection in self.connections:
            if not connection["request"]:
                continue
            head = connection["request"].split(b"\r\n\r\n", 1)[0].decode("latin-1").split("\r\n")
            headers = dict(line.split(": ", 1) for line in head[1:])
            sent.append({"address": connection["address"], "port": connection["port"], "sni": connection["sni"],
                         "line": head[0], "headers": {name.lower(): value for name, value in headers.items()}})
        return sent


class FakeStream(httpcore.NetworkStream):
    def __init__(self, web: FakeWeb, connection: dict, reply: Reply):
        self._web = web
        self._connection = connection
        self._reply = reply
        pieces = reply.chunks if reply.chunks is not None else [reply.body]
        headers = dict(reply.headers)
        if reply.length:
            headers["Content-Length"] = str(sum(len(piece) for piece in pieces))
        else:
            headers["Connection"] = "close"
        head = f"HTTP/1.1 {reply.status} Reply\r\n" + "".join(f"{name}: {value}\r\n" for name, value in headers.items())
        self._pieces = [(head.encode("latin-1") + b"\r\n", reply.wait)] + [(piece, reply.seconds) for piece in pieces if piece]

    def read(self, max_bytes, timeout=None):
        if not self._pieces:
            return b""
        piece, seconds = self._pieces[0]
        if len(piece) > max_bytes:
            self._pieces[0] = (piece[max_bytes:], 0.0)
            piece = piece[:max_bytes]
        else:
            self._pieces.pop(0)
        self._web.clock.now += seconds
        return piece

    def write(self, buffer, timeout=None):
        self._connection["request"] += buffer

    def close(self):
        pass

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self._connection["sni"] = server_hostname
        return self

    def get_extra_info(self, info):
        return None


def pdf_bytes(*pages: list[str], title: str | None = None) -> bytes:
    """A small PDF whose pages show these lines in Helvetica, as a listing printed to PDF does."""

    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for lines in pages:
        content = "BT /F1 11 Tf 14 TL 72 760 Td " + " ".join(f"({escape(line)}) Tj T*" for line in lines) + " ET"
        objects.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                       f"/Resources << /Font << /F1 3 0 R >> >> /Contents {len(objects)} 0 R >>")
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    if title is not None:
        objects.append(f"<< /Title ({escape(title)}) >>")
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    start = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    info = f" /Info {len(objects)} 0 R" if title is not None else ""
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R{info} >>\nstartxref\n{start}\n%%EOF\n".encode()
    return out
