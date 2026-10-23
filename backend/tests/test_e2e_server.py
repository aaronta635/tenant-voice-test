"""The browser journeys' API (scripts/e2e_server.py) and its demo dataset (scripts/e2e_seed.py).

The server must never reach a real Supabase project or the developer's own
app, so its refusals come first. Then its fake Auth and Storage, and the
dataset, through the routes a browser calls: every role signs in with the
demo password, and the rows each journey starts from are there.
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from scripts import e2e_seed, e2e_server
from tests import fake_supabase

BACKEND = Path(__file__).resolve().parents[1]
MEMBERS = ("tenant", "applicant", "tenant_pending", "landlord", "landlord_pending", "agent", "provider",
           "provider_pending")


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def e2e(monkeypatch):
    """The E2E server's app on a fake of its own, wired as main() wires it; every patch goes after the test."""
    import importlib

    from app.core import supabase as supabase_module
    from app.services import listing_import, password_reset

    monkeypatch.setattr(supabase_module, "create_client", supabase_module.create_client)
    monkeypatch.setattr(password_reset, "create_client", password_reset.create_client)
    monkeypatch.setattr(listing_import, "_getaddrinfo", listing_import._getaddrinfo)
    monkeypatch.setattr(listing_import, "_network_backend", listing_import._network_backend)
    for module_name, name in e2e_server.SERVICE_CACHES:
        module = importlib.import_module(module_name)
        monkeypatch.setattr(module, name, type(getattr(module, name))())
    for module_name, name in e2e_server.SERVICE_RESETS:
        getattr(importlib.import_module(module_name), name)()
    clients = e2e_server.Clients()
    e2e_server.install(clients)
    with TestClient(e2e_server.build_app(clients, e2e_seed.seed)) as client:
        yield SimpleNamespace(client=client, clients=clients, fixtures=client.get("/e2e/fixtures").json())
    e2e_server.forget_clients()


def sign_in(e2e, key: str, password: str | None = None) -> str:
    account = e2e.fixtures["accounts"][key]
    response = e2e.client.post("/api/v1/auth/login", json={
        "email": account["email"], "password": password or e2e.fixtures["password"]})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("port", [3000, 8000])
def test_the_developers_own_ports_are_refused(port):
    with pytest.raises(SystemExit, match=f"Port {port}"):
        e2e_server.check_port(port)


def test_a_port_is_one_a_server_may_take():
    with pytest.raises(SystemExit):
        e2e_server.check_port(80)
    assert e2e_server.check_port(8123) == 8123


@pytest.mark.parametrize("environ", [
    {"SUPABASE_URL": "https://abcdefghij.supabase.co"},
    {"NEXT_PUBLIC_SUPABASE_URL": "https://abcdefghij.supabase.co"},
    {"SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiJ9.a-real-looking.key"},
    {"SUPABASE_ANON_KEY": "sb_publishable_realkey"},
    {"SUPABASE_DB_PASSWORD": "correct-horse"},
])
def test_a_real_supabase_project_or_key_stops_the_server(environ):
    with pytest.raises(SystemExit) as refused:
        e2e_server.check_environment(environ)
    [(name, value)] = environ.items()
    # The message names the variable, never its value.
    assert name in str(refused.value)
    assert value not in str(refused.value) and "abcdefghij" not in str(refused.value)


def test_local_fake_and_empty_supabase_values_pass():
    e2e_server.check_environment({
        "SUPABASE_URL": "http://127.0.0.1:8123", "SUPABASE_SERVICE_ROLE_KEY": e2e_server.FAKE_SERVICE_ROLE_KEY,
        "SUPABASE_ANON_KEY": "", "PATH": "/usr/bin", "SOME_OTHER_URL": "https://example.com",
    })
    e2e_server.check_environment({"SUPABASE_URL": "http://supabase.invalid"})


@pytest.mark.parametrize("argv, message", [
    (["--port", "8000"], "Port 8000"),
    (["--port", "8123", "--frontend-origin", "http://127.0.0.1:3000"], "never uses 3000"),
    (["--port", "8123", "--frontend-origin", "https://tenantvoice.example.com"], "not on this machine"),
])
def test_main_refuses_a_port_or_origin_before_anything_starts(argv, message):
    with pytest.raises(SystemExit, match=message):
        e2e_server.main(argv)


def test_the_server_refuses_to_start_on_a_real_project():
    """As a script, with a project URL in its environment: it exits before it imports the app or binds a port."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = {"PATH": os.environ.get("PATH", ""), "SUPABASE_URL": "https://abcdefghij.supabase.co"}
    result = subprocess.run([sys.executable, "-m", "scripts.e2e_server", "--port", str(port)], cwd=BACKEND,
                            env=environment, capture_output=True, text=True, timeout=60)
    assert result.returncode != 0
    assert "SUPABASE_URL names a Supabase project" in result.stderr
    assert "abcdefghij" not in result.stdout + result.stderr
    assert "TenantVoice E2E API on" not in result.stdout


def test_the_settings_are_made_in_a_folder_without_a_dot_env(tmp_path, monkeypatch):
    from app.core.config import Settings

    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)
    (tmp_path / ".env").write_text("DEEPSEEK_MODEL=read-from-a-dot-env\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert Settings().deepseek_model == "read-from-a-dot-env"

    with e2e_server.away_from_backend_folder() as folder:
        assert Path.cwd().resolve() == folder.resolve() and not any(folder.iterdir())
        assert Settings().deepseek_model == "deepseek-flash"

    assert Path.cwd().resolve() == tmp_path.resolve() and not folder.exists()


def test_the_server_connects_to_nothing_outside_this_machine(monkeypatch):
    for name in ("connect", "connect_ex"):
        monkeypatch.setattr(socket.socket, name, getattr(socket.socket, name))
    monkeypatch.setattr(socket, "getaddrinfo", socket.getaddrinfo)

    e2e_server.refuse_outbound()

    with socket.socket() as outside, pytest.raises(ConnectionRefusedError):
        outside.connect(("203.0.113.7", 443))
    # Names that can never resolve (.invalid): were the guard broken, nothing real would be looked up or reached.
    with pytest.raises(socket.gaierror):
        socket.getaddrinfo("api.example.invalid", 443)
    with pytest.raises(OSError):
        socket.create_connection(("api.example.invalid", 443), timeout=1)
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        with socket.create_connection(server.getsockname(), timeout=1):
            pass


# ---------------------------------------------------------------------------
# Auth and Storage
# ---------------------------------------------------------------------------
def test_the_servers_fake_enforces_the_shared_catalogs_rules_without_the_tests_switch(monkeypatch):
    # The server never imports tests/conftest.py, so the fake's default (its CATALOG_RULES) would be off.
    monkeypatch.delitem(sys.modules, "tests.conftest", raising=False)

    db = e2e_server.E2ESupabase()

    assert db.catalog_rules
    assert not fake_supabase.FakeSupabase().catalog_rules


def test_sign_in_hands_out_a_jwt_shaped_token_the_fake_accepts():
    db = e2e_server.E2ESupabase()
    db.add_auth_user("person@e2e.test", "Pass-word-1")

    signed = db.auth.sign_in_with_password({"email": "Person@E2E.test", "password": "Pass-word-1"})

    token = signed.session.access_token
    claims = e2e_server.token_claims(token)
    assert token.count(".") == 2 and claims["sub"] == signed.user.id
    assert claims["exp"] == signed.session.expires_at > time.time()
    assert db.auth.get_user(token).user.id == signed.user.id
    with pytest.raises(Exception, match="Invalid login credentials"):
        db.auth.sign_in_with_password({"email": "person@e2e.test", "password": "wrong-password"})


def test_a_refresh_token_works_once_and_a_sign_out_ends_every_session():
    db = e2e_server.E2ESupabase()
    db.add_auth_user("person@e2e.test", "Pass-word-1")
    first = db.auth.sign_in_with_password({"email": "person@e2e.test", "password": "Pass-word-1"})

    renewed = db.auth.refresh_session(first.session.refresh_token)

    assert renewed.session.access_token != first.session.access_token
    with pytest.raises(Exception, match="Refresh Token"):
        db.auth.refresh_session(first.session.refresh_token)
    db.auth.admin.sign_out(renewed.session.access_token, "global")
    for token in (first.session.access_token, renewed.session.access_token):
        with pytest.raises(Exception):
            db.auth.get_user(token)


def test_an_expired_token_is_refused(monkeypatch):
    db = e2e_server.E2ESupabase()
    db.add_auth_user("person@e2e.test", "Pass-word-1")
    token, expires_at = db.mint(db.auth_user(email="person@e2e.test"), "password")
    monkeypatch.setattr(e2e_server.time, "time", lambda: expires_at + 1)

    with pytest.raises(Exception, match="expired"):
        db.auth.get_user(token)


def test_a_recovery_email_goes_to_the_outbox_for_a_known_address_only():
    db = e2e_server.E2ESupabase()
    db.add_auth_user("person@e2e.test", "Pass-word-1")

    db.auth.reset_password_for_email("nobody@e2e.test", {"redirect_to": "http://127.0.0.1:3123/reset-password"})
    db.auth.reset_password_for_email("person@e2e.test", {"redirect_to": "http://127.0.0.1:3123/reset-password"})

    [email] = db.outbox
    link = urlsplit(email["link"])
    fragment = parse_qs(link.fragment)
    assert email["to"] == "person@e2e.test" and link.path == "/reset-password"
    assert fragment["type"] == ["recovery"]
    assert e2e_server.token_claims(fragment["access_token"][0])["amr"][0]["method"] == "otp"


def test_a_signed_link_names_its_file_and_expires():
    storage = e2e_server.E2EStorage()
    storage.from_("profile-documents").upload("verification/u/a/Passport.pdf", b"%PDF-1.4", {"content-type": "application/pdf"})

    url = storage.from_("profile-documents").create_signed_url("verification/u/a/Passport.pdf", 60)["signedURL"]

    token = parse_qs(urlsplit(url).query)["token"][0]
    bucket, key, expires = storage.links[token]
    assert (bucket, key) == ("profile-documents", "verification/u/a/Passport.pdf")
    assert time.time() < expires <= time.time() + 60
    assert storage.content_type(bucket, key) == "application/pdf"


# ---------------------------------------------------------------------------
# The dataset, through the app's routes
# ---------------------------------------------------------------------------
def test_the_dataset_has_every_role_verified_and_pending(e2e):
    accounts = e2e.fixtures["accounts"]
    users = {row["id"]: row for row in e2e.clients.fake.tables["users"]}

    assert {users[account["id"]]["primary_role"] for account in accounts.values()} == {
        "TENANT", "LANDLORD", "AGENT", "SERVICE_PROVIDER", "ADMIN", "REGULATOR"}
    for account in accounts.values():
        assert (users[account["id"]]["verification_status"] == "APPROVED") == account["verified"], account["key"]
    for role in ("tenant", "landlord", "service_provider"):
        members = [account for account in accounts.values() if account["role"] == role]
        assert {account["verified"] for account in members} == {True, False}, role


@pytest.mark.parametrize("key", [*MEMBERS, "admin", "officer"])
def test_every_demo_account_signs_in_with_the_demo_password(e2e, key):
    token = sign_in(e2e, key)

    me = e2e.client.get("/api/v1/auth/me", headers=bearer(token))

    assert me.status_code == 200 and me.json()["id"] == e2e.fixtures["accounts"][key]["id"]


def test_only_the_admin_reaches_the_admin_api(e2e):
    for key in [*MEMBERS, "admin", "officer"]:
        response = e2e.client.get("/api/v1/admin/me", headers=bearer(sign_in(e2e, key)))
        assert response.status_code == (200 if key == "admin" else 403), key


def test_listings_are_published_with_photos_the_server_serves(e2e):
    listings = e2e.client.get("/api/v1/properties").json()

    # Approving Tara's application leased the Glebe studio (review_rental_application), which takes it off the list.
    leased = e2e.fixtures["listings"]["glebe"]["title"]
    assert {listing["title"] for listing in listings} == {
        item["title"] for item in e2e.fixtures["listings"].values()} - {leased}
    # The home over Tara's budget has no photo yet, so its card says "No photo yet".
    unphotographed = e2e.fixtures["listings"]["over_budget"]["id"]
    for listing in listings:
        assert listing["listing_status"] == "published"
        assert bool(listing["photo_urls"]) == (listing["id"] != unphotographed), listing["title"]
        for url in listing["photo_urls"]:
            photo = e2e.client.get(urlsplit(url).path)
            assert photo.status_code == 200 and photo.headers["content-type"] == "image/png"
            assert photo.content.startswith(b"\x89PNG")
    assert e2e.client.get("/storage/v1/object/public/profile-documents/anything.pdf").status_code == 400


def test_tara_waits_for_lenas_scorecard_and_may_still_ask_the_studios_agent(e2e):
    tara, lena = bearer(sign_in(e2e, "tenant")), bearer(sign_in(e2e, "landlord"))
    alex = e2e.fixtures["accounts"]["agent"]["id"]

    [waiting] = e2e.client.get("/api/v1/me/scorecard-requests", headers=lena).json()
    recipients = {entry["owner_id"]: entry for entry in
                  e2e.client.get("/api/v1/me/scorecard-requests/recipients", headers=tara).json()}

    assert (waiting["id"], waiting["status"], waiting["tenant_name"]) == (
        e2e.fixtures["scorecards"]["waiting"], "pending", "Tara Nguyen")
    assert recipients[e2e.fixtures["accounts"]["landlord"]["id"]]["pending_request_id"] == waiting["id"]
    assert recipients[alex]["property_id"] == e2e.fixtures["scorecards"]["property"]
    assert recipients[alex]["pending_request_id"] is None and recipients[alex]["owner_role_label"] == "Agent"


def test_the_import_reads_the_harness_listing_page_through_its_fake_network(e2e):
    lena = bearer(sign_in(e2e, "landlord"))
    page = e2e.fixtures["imports"]

    read = e2e.client.post("/api/v1/me/listing-imports/url", headers=lena, json={"url": page["listing"]})
    elsewhere = e2e.client.post("/api/v1/me/listing-imports/url", headers=lena, json={"url": "https://example.org/x"})

    assert read.status_code == 200, read.text
    fields = read.json()["fields"]
    assert (fields["title"]["value"], fields["suburb"]["value"], fields["postcode"]["value"]) == (
        page["title"], page["suburb"], page["postcode"])
    assert fields["price"]["value"] == 890 and fields["bedrooms"]["value"] == 3
    # Nothing else answers, and no lookup leaves the server.
    assert (elsewhere.status_code, elsewhere.json()["detail"]["code"]) == (502, "unreachable")


def test_a_private_document_opens_only_through_its_signed_link(e2e):
    admin = bearer(sign_in(e2e, "admin"))
    tom = e2e.fixtures["accounts"]["tenant_pending"]["id"]
    [document] = e2e.client.get(f"/api/v1/admin/verification/{tom}", headers=admin).json()["documents"]
    link = urlsplit(e2e.client.get(f"/api/v1/admin/documents/{document['id']}/link", headers=admin).json()["url"])

    opened = e2e.client.get(f"{link.path}?{link.query}")

    assert opened.status_code == 200 and opened.headers["content-type"] == "application/pdf"
    assert opened.content.startswith(b"%PDF-1.4")
    assert e2e.client.get(f"{link.path}?token=t0").status_code == 400
    assert e2e.client.get(link.path.replace("Tom", "Tim") + f"?{link.query}").status_code == 400


def test_each_journey_finds_the_rows_it_starts_from(e2e):
    fixtures = e2e.fixtures
    admin, provider, landlord, tenant = (bearer(sign_in(e2e, key)) for key in ("admin", "provider", "landlord", "tenant"))

    reported = e2e.client.get("/api/v1/admin/reviews", headers=admin).json()
    assert [item["id"] for item in reported["items"]] == [fixtures["reviews"]["reported"]]
    bookings = {item["id"]: item["status"] for item in e2e.client.get("/api/v1/bookings", headers=provider).json()}
    assert bookings == {fixtures["bookings"]["finished"]: "completed", fixtures["bookings"]["enquiry"]: "new_enquiry",
                        fixtures["bookings"]["confirmed"]: "confirmed"}
    [repair] = e2e.client.get("/api/v1/me/repairs", headers=provider).json()
    assert repair["id"] == fixtures["repairs"]["tap"] and repair["title"] == "Leaking kitchen tap"
    waiting = e2e.client.get(f"/api/v1/properties/{fixtures['listings']['newtown']['id']}/applications",
                             headers=landlord).json()
    assert [item["id"] for item in waiting] == [fixtures["applications"]["waiting"]]
    threads = e2e.client.get("/api/v1/conversations", headers=tenant).json()
    assert fixtures["conversations"]["rental"] in {thread["id"] for thread in threads}
    queue = e2e.client.get("/api/v1/admin/verification?role=landlord", headers=admin).json()
    assert [item["user_id"] for item in queue["items"]] == [fixtures["accounts"]["landlord_pending"]["id"]]
    # The complaints, not the repair, which the admin console leaves out.
    complaints = e2e.client.get("/api/v1/admin/complaints", headers=admin).json()
    assert {item["id"] for item in complaints["items"]} == set(fixtures["complaints"].values())


def test_the_public_profile_holds_none_of_the_tenants_private_values(e2e):
    tara = e2e.fixtures["accounts"]["tenant"]

    page = e2e.client.get(f"/api/v1/public/profiles/{tara['id']}").text

    assert e2e.fixtures["private"]["tenant"]
    assert [value for value in e2e.fixtures["private"]["tenant"] if value in page] == []


def test_a_reset_brings_back_a_fresh_dataset(e2e):
    old_token = sign_in(e2e, "tenant")
    e2e.client.post("/api/v1/applications", headers=bearer(old_token),
                    json={"property_id": e2e.fixtures["listings"]["newtown"]["id"], "occupants": 2})

    fresh = e2e.client.post("/e2e/reset").json()

    assert fresh["accounts"]["tenant"]["id"] != e2e.fixtures["accounts"]["tenant"]["id"]
    assert e2e.client.get("/api/v1/auth/me", headers=bearer(old_token)).status_code == 401
    assert e2e.client.get("/e2e/fixtures").json() == fresh
    landlord = bearer(sign_in(SimpleNamespace(client=e2e.client, fixtures=fresh), "landlord"))
    waiting = e2e.client.get(f"/api/v1/properties/{fresh['listings']['newtown']['id']}/applications", headers=landlord)
    assert [item["id"] for item in waiting.json()] == [fresh["applications"]["waiting"]]


def test_a_reset_lifts_the_limits_the_services_keep_between_requests(e2e):
    # Five reset emails an hour per address, and the demo emails are the same in every dataset:
    # without the reset lifting the count, a sixth visitor journey on one server is refused.
    email = e2e.fixtures["accounts"]["tenant"]["email"]
    for _ in range(5):
        assert e2e.client.post("/api/v1/auth/forgot-password", json={"email": email}).status_code == 202
    assert e2e.client.post("/api/v1/auth/forgot-password", json={"email": email}).status_code == 429

    assert e2e.client.post("/e2e/reset").status_code == 200

    assert e2e.client.post("/api/v1/auth/forgot-password", json={"email": email}).status_code == 202
    assert e2e_server.clear_service_caches() == []


def test_a_reset_email_reaches_the_outbox_and_its_link_sets_a_new_password(e2e):
    tara = e2e.fixtures["accounts"]["tenant"]
    assert e2e.client.post("/api/v1/auth/forgot-password", json={"email": "nobody@e2e.test"}).status_code == 202
    assert e2e.client.post("/api/v1/auth/forgot-password", json={"email": tara["email"]}).status_code == 202

    [email] = e2e.client.get("/e2e/outbox").json()
    token = parse_qs(urlsplit(email["link"]).fragment)["access_token"][0]
    reset = e2e.client.post("/api/v1/auth/reset-password", json={"access_token": token, "password": "Brand-new-pass-1"})

    assert email["to"] == tara["email"] and reset.status_code == 200
    sign_in(e2e, "tenant", "Brand-new-pass-1")
    old = e2e.client.post("/api/v1/auth/login", json={"email": tara["email"], "password": e2e.fixtures["password"]})
    assert old.status_code == 401
