"""Reading a listing's link (R32) goes only where a browser on the open internet could (services/listing_import.py).

Every request here runs on FakeWeb (tests/factories_listing_import.py): DNS
and the sockets under httpcore are fake, so each test sees the lookups, the
address each connection went to, its TLS name and the request, and nothing
leaves the machine. Refused links make no connection at all.
"""

import concurrent.futures
import threading

import pytest

from app.services import listing_import
from tests.factories_listing_import import (
    OTHER_PUBLIC, PUBLIC, PUBLIC_V6, FakeWeb, Reply, gzipped, html, redirect,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

URL = "/api/v1/me/listing-imports/url"
OWNER = "d4444444-4444-4444-8444-444444444444"
OTHER_OWNER = "d4444444-4444-4444-8444-444444444445"
LISTING = """<!doctype html><html><head><title>Harbour flat</title>
<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Apartment", "name": "Harbour flat",
 "numberOfBedrooms": 2, "address": {"@type": "PostalAddress", "streetAddress": "1 Harbour Street",
 "addressLocality": "Wollongong", "addressRegion": "NSW", "postalCode": "2500"}}</script></head>
<body><p>$650 per week</p></body></html>"""


@pytest.fixture(autouse=True)
def web(monkeypatch) -> FakeWeb:
    return FakeWeb().install(monkeypatch)


@pytest.fixture(autouse=True)
def owner(as_profile):
    return as_profile(id=OWNER, role="landlord", full_name="Olly Owner")


@pytest.fixture(autouse=True)
def lookups_end_with_the_test():
    """A lookup a test leaves hanging ends with it, so the next test's owner has none running."""
    yield
    concurrent.futures.wait(list(listing_import._lookups.values()), timeout=5)
    listing_import.clear_caches()


def hanging_lookups(monkeypatch, web: FakeWeb, released: threading.Event) -> None:
    """hangs.example never answers until released; every other name is FakeWeb's."""
    answer = web._lookup
    monkeypatch.setattr(listing_import, "_getaddrinfo",
                        lambda host, port: released.wait(5) and [PUBLIC] if host == "hangs.example" else answer(host, port))
    monkeypatch.setattr(listing_import, "CONNECT_TIMEOUT", 0.05)


def read(client, url: str):
    return client.post(URL, json={"url": url})


def refused(response, code: str, status: int) -> dict:
    assert response.status_code == status, response.text
    detail = response.json()["detail"]
    assert detail["code"] == code, detail
    assert detail["message"]
    return detail


def connected(web: FakeWeb) -> list[str]:
    return [connection["address"] for connection in web.connections]


# ---------------------------------------------------------------------------
# A public page
# ---------------------------------------------------------------------------
def test_a_public_page_is_read_from_the_address_that_was_checked(client, web):
    web.site("listings.example", html(LISTING))

    response = read(client, "https://listings.example/homes/1?ref=share#photos")

    assert response.status_code == 200, response.text
    assert response.json()["fields"]["title"]["value"] == "Harbour flat"
    assert web.lookups == ["listings.example"]
    [sent] = web.requests
    assert (sent["address"], sent["port"]) == (PUBLIC, 443)
    # The link's host goes in Host and in TLS, whose certificate is checked against it; the fragment stays here.
    assert sent["sni"] == "listings.example"
    assert sent["headers"]["host"] == "listings.example"
    assert sent["line"] == "GET /homes/1?ref=share HTTP/1.1"
    assert sent["headers"]["accept-encoding"] == "identity"
    assert web.connections[0]["timeout"] <= listing_import.CONNECT_TIMEOUT


@pytest.mark.parametrize("url, port, host", [
    ("http://listings.example/home", 80, "listings.example"),
    ("http://listings.example:80/home", 80, "listings.example"),
    ("https://listings.example:443/home", 443, "listings.example"),
    ("http://listings.example:443/home", 443, "listings.example:443"),
])
def test_the_standard_web_ports_are_read(client, web, url, port, host):
    web.site("listings.example", html(LISTING), port=port)

    response = read(client, url)

    assert response.status_code == 200, response.text
    assert (web.requests[0]["port"], web.requests[0]["headers"]["host"]) == (port, host)


def test_an_international_name_is_looked_up_and_sent_as_ascii(client, web):
    web.site("xn--bcher-kva.example", html(LISTING))

    assert read(client, "https://bücher.example/home").status_code == 200
    assert web.lookups == ["xn--bcher-kva.example"]
    assert web.requests[0]["headers"]["host"] == "xn--bcher-kva.example"


def test_a_public_ipv6_address_is_read(client, web):
    web.site("listings.example", html(LISTING), address=PUBLIC_V6)

    assert read(client, "https://listings.example/home").status_code == 200
    assert connected(web) == [PUBLIC_V6]


def test_an_ipv4_mapped_public_address_is_read_as_its_ipv4_address(client, web):
    web.name("listings.example", f"::ffff:{PUBLIC}")
    web.serve(PUBLIC, html(LISTING))

    assert read(client, "https://listings.example/home").status_code == 200
    assert connected(web) == [PUBLIC]


def test_a_public_ip_address_in_the_link_is_read_without_a_lookup(client, web):
    web.serve(PUBLIC, html(LISTING))

    assert read(client, f"https://{PUBLIC}/home").status_code == 200
    assert web.lookups == []
    assert connected(web) == [PUBLIC]
    assert web.requests[0]["headers"]["host"] == PUBLIC


def test_the_next_address_is_tried_when_one_refuses(client, web):
    web.name("listings.example", PUBLIC, OTHER_PUBLIC)
    web.serve(PUBLIC, Reply(refuse=True))
    web.serve(OTHER_PUBLIC, html(LISTING))

    assert read(client, "https://listings.example/home").status_code == 200
    assert connected(web) == [PUBLIC, OTHER_PUBLIC]


# ---------------------------------------------------------------------------
# Links that are never read
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("url", [
    "ftp://listings.example/home", "file:///etc/passwd", "gopher://listings.example/", "javascript:alert(1)",
    "data:text/html,<p>3 bed</p>", "listings.example/home", "//listings.example/home", "https://", "http://exa mple.com/",
])
def test_only_web_links_are_read(client, web, url):
    refused(read(client, url), "invalid_url", 422)
    assert web.lookups == [] and web.connections == []


def test_a_link_with_a_user_name_or_password_is_refused(client, web):
    web.site("listings.example", html(LISTING))

    detail = refused(read(client, "https://owner:secret@listings.example/home"), "invalid_url", 422)

    assert "user name or password" in detail["message"]
    assert web.connections == []


@pytest.mark.parametrize("url", [
    "http://listings.example:8080/", "https://listings.example:8443/", "http://listings.example:22/",
    "http://listings.example:6379/", "https://listings.example:0/", "http://listings.example:25/",
])
def test_other_ports_are_refused(client, web, url):
    web.site("listings.example", html(LISTING))

    refused(read(client, url), "port_not_allowed", 422)
    assert web.lookups == [] and web.connections == []


NOT_PUBLIC = [
    "127.0.0.1", "127.255.0.9", "10.0.0.5", "172.16.3.4", "172.31.255.1", "192.168.1.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "198.18.0.1",
    "192.0.2.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "fec0::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.0.1", "::127.0.0.1",
    "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "100::1",
]


@pytest.mark.parametrize("address", NOT_PUBLIC)
def test_a_name_that_resolves_to_a_private_or_special_address_is_never_connected_to(client, web, address):
    web.site("listings.example", html(LISTING), address=address)

    detail = refused(read(client, "https://listings.example/home"), "address_not_allowed", 422)

    assert "private or local network address" in detail["message"]
    assert web.connections == []


@pytest.mark.parametrize("address", ["10.0.0.1", "::ffff:127.0.0.1", "fd00::1"])
def test_one_private_address_among_public_ones_refuses_the_link(client, web, address):
    web.name("listings.example", PUBLIC, address)
    web.serve(PUBLIC, html(LISTING))

    refused(read(client, "https://listings.example/home"), "address_not_allowed", 422)
    assert web.connections == []


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://127.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
    "http://2130706433/", "http://0x7f.1/", "http://017700000001/", "http://0x7f000001/", "http://10.1/",
    "http://169.254.169.254/latest/meta-data/", "http://[fe80::1]/", "http://0/", "http://0.0.0.0/",
])
def test_an_ip_address_in_the_link_is_checked_in_any_form(client, web, url):
    detail = refused(read(client, url), "address_not_allowed", 422)

    assert "points to a private or local network address" in detail["message"]
    assert web.lookups == [] and web.connections == []


def test_a_dotted_octal_address_is_no_link_at_all(client, web):
    # httpx refuses an octet of more than three digits before any lookup.
    refused(read(client, "http://0177.0.0.1/"), "invalid_url", 422)
    assert web.lookups == [] and web.connections == []


def test_a_name_resolving_to_localhost_is_refused(client, web):
    web.name("localhost", "127.0.0.1", "::1")

    refused(read(client, "http://localhost/"), "address_not_allowed", 422)
    assert web.connections == []


# ---------------------------------------------------------------------------
# Redirects
# ---------------------------------------------------------------------------
def test_redirects_are_followed_each_checked_from_the_start(client, web):
    web.site("short.example", redirect("https://listings.example/home/1", 301), address=OTHER_PUBLIC)
    web.site("listings.example", redirect("/home/2", 307), html(LISTING))

    response = read(client, "https://short.example/x")

    assert response.status_code == 200, response.text
    assert response.json()["source_url"] == "https://listings.example/home/2"
    assert response.json()["source_label"] == "listings.example"
    assert web.lookups == ["short.example", "listings.example", "listings.example"]
    assert [(sent["address"], sent["headers"]["host"], sent["line"]) for sent in web.requests] == [
        (OTHER_PUBLIC, "short.example", "GET /x HTTP/1.1"),
        (PUBLIC, "listings.example", "GET /home/1 HTTP/1.1"),
        (PUBLIC, "listings.example", "GET /home/2 HTTP/1.1"),
    ]


@pytest.mark.parametrize("location", [
    "http://127.0.0.1/admin", "http://[::ffff:10.0.0.1]/", "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", "https://internal.example/",
])
def test_a_redirect_to_a_private_address_is_refused(client, web, location):
    web.site("listings.example", redirect(location))
    web.name("internal.example", "10.1.2.3")

    detail = refused(read(client, "https://listings.example/home"), "address_not_allowed", 422)

    assert "redirects to a private or local network address" in detail["message"]
    assert connected(web) == [PUBLIC]


@pytest.mark.parametrize("location, code", [
    ("http://listings.example:8080/home", "port_not_allowed"),
    ("file:///etc/passwd", "invalid_url"),
    ("ftp://listings.example/home", "invalid_url"),
    ("https://user:pw@listings.example/home", "invalid_url"),
])
def test_a_redirect_to_another_port_or_scheme_is_refused(client, web, location, code):
    web.site("listings.example", redirect(location))

    refused(read(client, "https://listings.example/home"), code, 422)
    assert connected(web) == [PUBLIC]


def test_three_redirects_are_followed_and_a_fourth_is_refused(client, web):
    web.site("listings.example", redirect("/1"), redirect("/2"), redirect("/3"), html(LISTING))
    assert read(client, "https://listings.example/0").status_code == 200

    web.connections.clear()
    web.serve(PUBLIC, redirect("/1"), redirect("/2"), redirect("/3"), redirect("/4"), html(LISTING))
    detail = refused(read(client, "https://listings.example/0"), "too_many_redirects", 422)

    assert "redirects too many times" in detail["message"]
    assert len(web.connections) == 4


def test_a_redirect_loop_stops_at_the_limit(client, web):
    web.site("listings.example", redirect("https://listings.example/home"))

    refused(read(client, "https://listings.example/home"), "too_many_redirects", 422)
    assert len(web.connections) == 1 + listing_import.MAX_REDIRECTS


def test_the_checked_address_is_the_one_connected_to_whatever_dns_answers_next(client, web):
    """DNS rebinding: the name is looked up once per request, and that answer is the one used."""
    web.dns["listings.example"] = lambda nth: [PUBLIC] if nth == 1 else ["127.0.0.1"]
    web.serve(PUBLIC, html(LISTING))
    web.serve("127.0.0.1", html("<p>internal admin</p>"))

    response = read(client, "https://listings.example/home")

    assert response.status_code == 200
    assert web.lookups == ["listings.example"]
    assert connected(web) == [PUBLIC]


def test_a_rebinding_name_is_caught_at_the_redirect_that_looks_it_up_again(client, web):
    web.dns["listings.example"] = lambda nth: [PUBLIC] if nth == 1 else ["127.0.0.1"]
    web.serve(PUBLIC, redirect("/home/2"))
    web.serve("127.0.0.1", html(LISTING))

    refused(read(client, "https://listings.example/home"), "address_not_allowed", 422)
    assert connected(web) == [PUBLIC]


def test_the_backend_connects_to_no_address_but_the_checked_one(web):
    backend = listing_import._PinnedBackend(web, PUBLIC, deadline=web.clock() + 5)

    with pytest.raises(listing_import.httpcore.ConnectError):
        backend.connect_tcp("127.0.0.1", 443)
    assert web.connections == []


# ---------------------------------------------------------------------------
# Sites that refuse to be read
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("url, site", [
    ("https://www.realestate.com.au/property-apartment-nsw-newtown-1", "realestate.com.au"),
    ("https://realestate.com.au/x", "realestate.com.au"),
    ("http://m.realestate.com.au/x", "realestate.com.au"),
    ("https://www.domain.com.au/5-18-wilson-street-newtown-nsw-2042-1", "Domain"),
    ("https://DOMAIN.com.au./x", "Domain"),
])
def test_sites_that_refuse_reading_are_never_fetched_and_a_labelled_sample_is_offered(client, web, url, site):
    detail = refused(read(client, url), "blocked", 422)

    assert detail["message"].startswith(f"{site} doesn't let other sites read its listings.")
    assert "PDF" in detail["message"] and "type the details" in detail["message"]
    sample = detail["sample"]
    assert (sample["kind"], sample["demo"], sample["source_label"]) == ("sample", True, "Sample listing")
    assert "sample listing" in sample["fields"]["description"]["value"]
    assert web.lookups == [] and web.connections == []


def test_a_name_that_only_ends_like_a_refusing_site_is_read(client, web):
    web.site("notrealestate.com.au", html(LISTING))

    assert read(client, "https://notrealestate.com.au/home").status_code == 200


def test_a_redirect_to_a_site_that_refuses_reading_is_not_followed(client, web):
    web.site("short.example", redirect("https://www.domain.com.au/listing-1"))

    refused(read(client, "https://short.example/x"), "blocked", 422)
    assert web.lookups == ["short.example"]


@pytest.mark.parametrize("status", [401, 403, 429, 451])
def test_a_site_refusing_the_request_is_told_apart_and_offers_the_sample(client, web, status):
    web.site("listings.example", Reply(status=status, body=b"<p>Forbidden</p>"))

    detail = refused(read(client, "https://listings.example/home"), "blocked", 422)

    assert detail["message"].startswith("That site refused to share the page with TenantVoice.")
    assert detail["sample"]["demo"] is True


def test_a_bot_check_page_is_a_refusal(client, web):
    web.site("listings.example", html(
        "<html><head><title>Just a moment...</title></head><body>"
        "<div id='cf-chl-widget'></div><p>Checking your browser before accessing the site.</p></body></html>"
    ))

    refused(read(client, "https://listings.example/home"), "blocked", 422)


def test_a_challenge_header_is_a_refusal(client, web):
    web.site("listings.example", html(LISTING, **{"cf-mitigated": "challenge"}))

    refused(read(client, "https://listings.example/home"), "blocked", 422)


def test_a_listing_with_a_captcha_on_its_contact_form_is_still_read(client, web):
    web.site("listings.example", html(LISTING.replace(
        "</body>", "<form><script src='https://www.google.com/recaptcha/api.js'></script>"
        "<p>This site is protected by reCAPTCHA.</p></form></body>")))

    assert read(client, "https://listings.example/home").status_code == 200


# ---------------------------------------------------------------------------
# Time limits
# ---------------------------------------------------------------------------
def test_a_connection_that_never_opens_times_out(client, web):
    web.site("listings.example", Reply(hang=True))

    detail = refused(read(client, "https://listings.example/home"), "timeout", 504)

    assert "took too long" in detail["message"]


def test_a_page_that_trickles_in_stops_at_the_total_time_limit(client, web):
    web.site("listings.example", Reply(chunks=[b"<p>3 bed</p>" * 10] * 20, seconds=3, length=False))

    refused(read(client, "https://listings.example/home"), "timeout", 504)
    # Each read waits at most until the deadline: no more than one 3-second piece past it.
    assert web.clock.now <= 1000 + listing_import.TOTAL_TIMEOUT + 3


@pytest.mark.parametrize("body", [b"", LISTING.encode()])
def test_a_site_that_answers_after_the_time_limit_is_a_timeout(client, web, body):
    web.site("listings.example", Reply(body=body, wait=11))

    refused(read(client, "https://listings.example/home"), "timeout", 504)


def test_the_time_limit_covers_every_redirect(client, web):
    slow = Reply(status=302, headers={"Location": "/next"}, wait=4)
    web.site("listings.example", slow, slow, slow, html(LISTING))

    refused(read(client, "https://listings.example/home"), "timeout", 504)
    assert len(web.connections) == 3


def test_a_lookup_that_hangs_times_out(client, web, monkeypatch):
    released = threading.Event()
    monkeypatch.setattr(listing_import, "_getaddrinfo", lambda host, port: released.wait(5) and [PUBLIC])
    monkeypatch.setattr(listing_import, "CONNECT_TIMEOUT", 0.05)
    try:
        refused(read(client, "https://listings.example/home"), "timeout", 504)
    finally:
        released.set()
    assert web.connections == []


def test_lookups_one_owner_leaves_hanging_never_hold_up_another_owners_import(client, web, monkeypatch, as_profile):
    released = threading.Event()
    hanging_lookups(monkeypatch, web, released)
    web.site("listings.example", html(LISTING))
    try:
        refused(read(client, "https://hangs.example/home"), "timeout", 504)
        # Their lookup still runs, so they start no other one, and nothing queues behind it.
        for _ in range(3):
            assert "still being looked up" in refused(read(client, "https://hangs.example/home"), "busy", 429)["message"]

        as_profile(id=OTHER_OWNER, role="landlord", full_name="Ola Owner")
        response = read(client, "https://listings.example/home")
    finally:
        released.set()

    assert response.status_code == 200, response.text
    assert web.lookups == ["listings.example"]


def test_an_import_is_busy_rather_than_queued_when_every_lookup_thread_is_taken(client, web, monkeypatch, as_profile):
    released = threading.Event()
    hanging_lookups(monkeypatch, web, released)
    monkeypatch.setattr(listing_import, "RESOLVER_THREADS", 1)
    web.site("listings.example", html(LISTING))
    try:
        refused(read(client, "https://hangs.example/home"), "timeout", 504)
        as_profile(id=OTHER_OWNER, role="landlord", full_name="Ola Owner")

        detail = refused(read(client, "https://listings.example/home"), "busy", 429)
    finally:
        released.set()

    assert "Too many imports" in detail["message"]
    assert web.lookups == [] and web.connections == []


def test_each_connection_is_given_the_connect_time_limit_at_most(client, web):
    web.site("listings.example", html(LISTING))

    read(client, "https://listings.example/home")

    assert 0 < web.connections[0]["timeout"] <= 5


def test_a_connection_waits_no_longer_than_the_time_left(web):
    web.serve(PUBLIC, html(LISTING))

    listing_import._PinnedBackend(web, PUBLIC, deadline=web.clock() + 2).connect_tcp(PUBLIC, 443, timeout=5)

    assert web.connections[0]["timeout"] == 2


def test_every_read_and_write_waits_no_longer_than_the_time_left(web):
    """A socket read that blocks ends by the deadline, not by its own timeout."""
    waits = []

    class Socket:
        def read(self, max_bytes, timeout=None):
            waits.append(("read", timeout))
            return b""

        def write(self, buffer, timeout=None):
            waits.append(("write", timeout))

        def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            waits.append(("tls", timeout))
            return self

    stream = listing_import._DeadlineStream(Socket(), deadline=web.clock() + 3)
    stream.read(100, timeout=10)
    stream.write(b"GET", timeout=None)
    stream.start_tls(None, "listings.example", timeout=8)
    assert waits == [("read", 3), ("write", 3), ("tls", 3)]

    web.clock.now += 3
    with pytest.raises(listing_import.httpcore.ReadTimeout):
        stream.read(100, timeout=10)
    with pytest.raises(listing_import.httpcore.WriteTimeout):
        stream.write(b"GET")
    assert len(waits) == 3


# ---------------------------------------------------------------------------
# Size and content limits
# ---------------------------------------------------------------------------
def test_a_page_declared_larger_than_2_mb_is_refused(client, web):
    web.site("listings.example", Reply(headers={"Content-Type": "text/html"}, body=b"x" * (2 * 1024 * 1024 + 1)))

    detail = refused(read(client, "https://listings.example/home"), "too_large", 413)

    assert "larger than 2 MB" in detail["message"]


def test_a_page_that_runs_past_2_mb_without_saying_so_is_cut_off(client, web):
    web.site("listings.example", Reply(chunks=[b"<p>" + b"x" * 65536 + b"</p>"] * 40, length=False))

    refused(read(client, "https://listings.example/home"), "too_large", 413)


def test_a_page_of_almost_2_mb_is_read(client, web):
    padding = "<p>" + "x" * 1024 + "</p>"
    page = LISTING.replace("<body>", "<body>" + padding * 1900)
    assert len(page.encode()) < 2 * 1024 * 1024
    web.site("listings.example", html(page))

    assert read(client, "https://listings.example/home").status_code == 200


def test_a_compressed_page_that_expands_past_2_mb_is_refused(client, web):
    bomb = gzipped(b"<p>" + b"0" * (3 * 1024 * 1024) + b"</p>")
    assert len(bomb.body) < 64 * 1024
    web.site("listings.example", bomb)

    refused(read(client, "https://listings.example/home"), "too_large", 413)


def test_a_compressed_page_within_the_limit_is_read(client, web):
    web.site("listings.example", gzipped(LISTING.encode()))

    assert read(client, "https://listings.example/home").json()["fields"]["title"]["value"] == "Harbour flat"


def test_an_encoding_we_cannot_read_is_refused(client, web):
    web.site("listings.example", Reply(headers={"Content-Type": "text/html", "Content-Encoding": "br"}, body=b"\x1b"))

    refused(read(client, "https://listings.example/home"), "unsupported_content", 415)


@pytest.mark.parametrize("content_type", [
    "application/pdf", "image/jpeg", "text/plain", "application/octet-stream", "text/javascript",
    "application/xml", "text/css", "video/mp4",
])
def test_only_html_or_json_pages_are_read(client, web, content_type):
    web.site("listings.example", Reply(headers={"Content-Type": content_type}, body=b"%PDF-1.4 3 bed"))

    refused(read(client, "https://listings.example/home"), "unsupported_content", 415)


def test_a_page_with_no_content_type_is_refused(client, web):
    web.site("listings.example", Reply(headers={}, body=LISTING.encode()))

    refused(read(client, "https://listings.example/home"), "unsupported_content", 415)


@pytest.mark.parametrize("content_type", ["application/xhtml+xml", "TEXT/HTML"])
def test_html_pages_are_read(client, web, content_type):
    web.site("listings.example", Reply(headers={"Content-Type": content_type}, body=LISTING.encode()))

    assert read(client, "https://listings.example/home").status_code == 200


@pytest.mark.parametrize("headers, meta", [
    ({"Content-Type": "text/html; charset=iso-8859-1"}, ""),
    ({"Content-Type": "text/html"}, '<meta charset="windows-1252">'),
])
def test_a_page_is_read_in_the_charset_it_names(client, web, headers, meta):
    page = LISTING.replace("Harbour flat", "Café flat").replace("<head>", f"<head>{meta}")
    web.site("listings.example", Reply(headers=headers, body=page.encode("latin-1")))

    assert read(client, "https://listings.example/home").json()["fields"]["title"]["value"] == "Café flat"


@pytest.mark.parametrize("charset", ["rot13", "base64", "hex", "zlib", "undefined", "idna"])
@pytest.mark.parametrize("where", ["header", "meta"])
def test_a_page_naming_a_charset_that_decodes_no_text_is_read_as_utf_8(client, web, charset, where):
    headers = {"Content-Type": f"text/html; charset={charset}" if where == "header" else "text/html"}
    meta = f'<meta charset="{charset}">' if where == "meta" else ""
    web.site("listings.example", Reply(headers=headers, body=LISTING.replace("<head>", f"<head>{meta}").encode()))

    response = read(client, "https://listings.example/home")

    assert response.status_code == 200, response.text
    assert response.json()["fields"]["title"]["value"] == "Harbour flat"


@pytest.mark.parametrize("content_type", ["application/ld+json", "application/json", "application/vnd.listing+json"])
def test_json_pages_are_read(client, web, content_type):
    body = LISTING.split('<script type="application/ld+json">')[1].split("</script>")[0]
    web.site("listings.example", Reply(headers={"Content-Type": content_type}, body=body.encode()))

    response = read(client, "https://listings.example/home.json")

    assert response.status_code == 200, response.text
    assert response.json()["fields"]["bedrooms"]["value"] == 2


# ---------------------------------------------------------------------------
# Sites that cannot be reached
# ---------------------------------------------------------------------------
def test_a_name_that_does_not_resolve_cannot_be_reached(client, web):
    refused(read(client, "https://nowhere.example/home"), "unreachable", 502)
    assert web.connections == []


def test_a_site_refusing_every_connection_cannot_be_reached(client, web):
    web.name("listings.example", PUBLIC, OTHER_PUBLIC)

    refused(read(client, "https://listings.example/home"), "unreachable", 502)
    assert connected(web) == [PUBLIC, OTHER_PUBLIC]


def test_a_missing_page_is_said_so(client, web):
    web.site("listings.example", Reply(status=404, body=b"<p>Not found</p>"))

    detail = refused(read(client, "https://listings.example/home"), "not_found", 422)

    assert "wasn't found" in detail["message"]


@pytest.mark.parametrize("status", [500, 502, 503])
def test_a_server_error_is_said_so(client, web, status):
    web.site("listings.example", Reply(status=status, body=b"oops"))

    detail = refused(read(client, "https://listings.example/home"), "unreachable", 502)

    assert f"({status})" in detail["message"]


def test_a_redirect_without_somewhere_to_go_is_not_followed(client, web):
    web.site("listings.example", Reply(status=302, headers={"Content-Type": "text/html"}, body=b""))

    refused(read(client, "https://listings.example/home"), "unreachable", 502)


def test_a_page_that_is_not_what_its_encoding_says_cannot_be_read(client, web):
    web.site("listings.example", Reply(headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
                                       body=b"<p>not compressed at all</p>"))

    refused(read(client, "https://listings.example/home"), "unsupported_content", 415)
