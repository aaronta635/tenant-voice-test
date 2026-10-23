"""/auth/forgot-password and /auth/reset-password: self-serve recovery (A16).

Supabase Auth is never contacted: the recovery email goes to a stand-in (or,
in one test, to the real supabase-py client over an httpx mock transport),
and get_user, update_user_by_id and sign_out run on the in-memory fake.
"""

import base64
import json
import logging
import time
import uuid
from types import SimpleNamespace

import httpx
import pytest
from supabase_auth.errors import AuthApiError, AuthRetryableError, AuthUnknownError, AuthWeakPasswordError

from app.core.config import settings
from app.schemas.auth import RegisterIn
from app.schemas.password_reset import ResetPasswordIn
from app.services import password_reset

pytestmark = pytest.mark.usefixtures("strict_schema")

FORGOT = "/api/v1/auth/forgot-password"
RESET = "/api/v1/auth/reset-password"


@pytest.fixture(autouse=True)
def fresh_limits():
    password_reset.clear_limits()
    yield
    password_reset.clear_limits()


@pytest.fixture
def mailer(monkeypatch, fake_db):
    """Supabase Auth's recover endpoint: emails only addresses with an account, like the real one."""
    mail = SimpleNamespace(requests=[], sent_to=[], options=[], error=None)

    def reset_password_for_email(email, options):
        mail.requests.append((email, options))
        if mail.error is not None:
            raise mail.error
        if any(user["email"] == email for user in fake_db.users):
            mail.sent_to.append(email)

    def create_client(url, key, options=None):
        mail.options.append(options)
        return SimpleNamespace(auth=SimpleNamespace(reset_password_for_email=reset_password_for_email))

    monkeypatch.setattr(password_reset, "create_client", create_client)
    return mail


@pytest.fixture
def auth_admin(monkeypatch, fake_db):
    """The admin calls a reset makes, which the fake has no use for elsewhere."""
    admin = SimpleNamespace(updates=[], sign_outs=[], update_error=None, sign_out_error=None)

    def update_user_by_id(uid, attributes):
        admin.updates.append((uid, attributes))
        if admin.update_error is not None:
            raise admin.update_error
        return SimpleNamespace(user=SimpleNamespace(id=uid))

    def sign_out(jwt, scope="global"):
        admin.sign_outs.append((jwt, scope))
        if admin.sign_out_error is not None:
            raise admin.sign_out_error

    monkeypatch.setattr(fake_db.auth.admin, "update_user_by_id", update_user_by_id, raising=False)
    monkeypatch.setattr(fake_db.auth.admin, "sign_out", sign_out, raising=False)
    return admin


def _segment(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def session_token(fake_db, auth_user_id: str, methods=("otp",), age_seconds=60, sub=None) -> str:
    """A JWT like Supabase's for a session of this user, which the fake's get_user accepts."""
    now = int(time.time())
    claims = {
        "sub": sub or auth_user_id,
        "exp": now + 3600,
        "role": "authenticated",
        "session_id": str(uuid.uuid4()),
        "amr": [{"method": method, "timestamp": now - age_seconds} for method in methods],
    }
    token = f"{_segment({'alg': 'HS256', 'typ': 'JWT'})}.{_segment(claims)}.signature"
    fake_db.tokens[token] = auth_user_id
    return token


def raises(error: Exception):
    """A stand-in for a Supabase Auth call that fails with error."""

    def fail(*args, **kwargs):
        raise error

    return fail


def auth_user(fake_db, email="jon@demo.test") -> str:
    fake_db.add_auth_user(email, "old-password", full_name="Jon", role="tenant")
    return next(user["id"] for user in fake_db.users if user["email"] == email)


# ---------------------------------------------------------------------------
# Requesting a link
# ---------------------------------------------------------------------------
def test_known_and_unknown_addresses_get_the_same_answer(client, fake_db, mailer):
    auth_user(fake_db, "jon@demo.test")

    known = client.post(FORGOT, json={"email": "jon@demo.test"})
    unknown = client.post(FORGOT, json={"email": "nobody@demo.test"})

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json() == {"message": password_reset.REQUEST_ACCEPTED}
    assert [email for email, _ in mailer.requests] == ["jon@demo.test", "nobody@demo.test"]
    assert mailer.sent_to == ["jon@demo.test"]  # Supabase emailed only the account


@pytest.mark.parametrize(
    "error",
    [
        AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit"),
        AuthRetryableError("Server disconnected", 0),
        RuntimeError("unexpected"),
    ],
)
def test_supabase_errors_get_the_same_answer_and_log_no_address(client, mailer, caplog, error):
    mailer.error = error
    caplog.set_level(logging.DEBUG)

    response = client.post(FORGOT, json={"email": "Jon@Demo.test"})

    assert response.status_code == 202
    assert response.json() == {"message": password_reset.REQUEST_ACCEPTED}
    assert "not sent" in caplog.text
    assert "jon@demo.test" not in caplog.text.lower()


def test_the_link_opens_the_frontend_reset_page(client, mailer, monkeypatch):
    # Pinned: FRONTEND_URL may be set in the environment or backend/.env.
    monkeypatch.setattr(settings, "frontend_url", "http://localhost:3000")
    client.post(FORGOT, json={"email": "jon@demo.test"})
    monkeypatch.setattr(settings, "frontend_url", "https://tenantvoice.example/")
    client.post(FORGOT, json={"email": "jon@demo.test"})

    assert [options for _, options in mailer.requests] == [
        {"redirect_to": "http://localhost:3000/reset-password"},
        {"redirect_to": "https://tenantvoice.example/reset-password"},
    ]


def test_the_email_is_requested_in_the_implicit_flow(client, mailer):
    client.post(FORGOT, json={"email": "jon@demo.test"})

    (options,) = mailer.options
    assert options.flow_type == "implicit"


def test_the_recover_request_asks_for_a_link_that_carries_the_session(client, monkeypatch):
    """The real supabase-py client, over a mock transport: no request leaves the process."""
    seen: list[httpx.Request] = []
    transport = httpx.MockTransport(lambda request: seen.append(request) or httpx.Response(200, json={}))
    real_create_client = password_reset.create_client

    def offline_client(url, key, options):
        options.httpx_client = httpx.Client(transport=transport)
        return real_create_client(url, key, options=options)

    monkeypatch.setattr(password_reset, "create_client", offline_client)
    monkeypatch.setattr(settings, "frontend_url", "http://localhost:3000")

    assert client.post(FORGOT, json={"email": "jon@demo.test"}).status_code == 202

    (request,) = seen
    assert request.url.path == "/auth/v1/recover"
    assert request.url.params["redirect_to"] == "http://localhost:3000/reset-password"
    body = json.loads(request.content)
    assert body["email"] == "jon@demo.test"
    # No PKCE challenge: Supabase then redirects with #access_token, not ?code=.
    assert "code_challenge" not in body


def test_a_sixth_request_for_one_address_within_the_hour_gets_429(client, mailer):
    for _ in range(password_reset.REQUESTS_PER_EMAIL):
        assert client.post(FORGOT, json={"email": "jon@demo.test"}).status_code == 202

    refused = client.post(FORGOT, json={"email": "  JON@demo.test "})

    assert refused.status_code == 429
    assert refused.json() == {"detail": password_reset.TOO_MANY_REQUESTS}
    assert 0 < int(refused.headers["Retry-After"]) <= password_reset.REQUEST_WINDOW_SECONDS
    assert len(mailer.requests) == password_reset.REQUESTS_PER_EMAIL  # the refused one sent nothing


def test_one_client_is_limited_across_addresses(client, mailer):
    for number in range(password_reset.REQUESTS_PER_CLIENT):
        assert client.post(FORGOT, json={"email": f"person{number}@demo.test"}).status_code == 202

    assert client.post(FORGOT, json={"email": "someone-else@demo.test"}).status_code == 429
    assert len(mailer.requests) == password_reset.REQUESTS_PER_CLIENT


def test_requests_are_allowed_again_after_the_window(client, mailer, monkeypatch):
    clock = SimpleNamespace(now=1000.0)
    monkeypatch.setattr(password_reset, "time", SimpleNamespace(monotonic=lambda: clock.now, time=time.time))
    for _ in range(password_reset.REQUESTS_PER_EMAIL):
        client.post(FORGOT, json={"email": "jon@demo.test"})
    assert client.post(FORGOT, json={"email": "jon@demo.test"}).status_code == 429

    clock.now += password_reset.REQUEST_WINDOW_SECONDS

    assert client.post(FORGOT, json={"email": "jon@demo.test"}).status_code == 202


def test_a_malformed_address_is_refused_before_anything_is_counted(client, mailer):
    assert client.post(FORGOT, json={"email": "not-an-email"}).status_code == 422
    assert client.post(FORGOT, json={}).status_code == 422
    assert mailer.requests == []
    assert password_reset._requests == {}


# ---------------------------------------------------------------------------
# Setting the new password
# ---------------------------------------------------------------------------
def test_a_recovery_session_sets_the_new_password_and_ends_every_session(client, fake_db, auth_admin):
    user_id = auth_user(fake_db)
    token = session_token(fake_db, user_id, methods=("otp",))

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 200
    assert response.json() == {"message": password_reset.PASSWORD_UPDATED}
    assert auth_admin.updates == [(user_id, {"password": "new-password-1"})]
    assert auth_admin.sign_outs == [(token, "global")]


def test_a_link_exchanged_as_a_pkce_code_also_works(client, fake_db, auth_admin):
    user_id = auth_user(fake_db)
    token = session_token(fake_db, user_id, methods=("recovery",))

    assert client.post(RESET, json={"access_token": token, "password": "new-password-1"}).status_code == 200
    assert auth_admin.updates == [(user_id, {"password": "new-password-1"})]


def test_an_expired_or_unknown_token_asks_for_a_new_link(client, fake_db, auth_admin, monkeypatch):
    user_id = auth_user(fake_db)
    token = session_token(fake_db, user_id)
    del fake_db.tokens[token]  # Supabase Auth no longer accepts it
    decoded = []
    monkeypatch.setattr(password_reset, "_claims", lambda value: decoded.append(value) or {})

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 400
    assert response.json() == {"detail": password_reset.INVALID_LINK}
    assert "Request a new link" in password_reset.INVALID_LINK
    assert decoded == []  # the payload is read only after get_user accepted the token
    assert auth_admin.updates == []


@pytest.mark.parametrize(
    "error",
    [
        AuthRetryableError("Server disconnected", 0),
        AuthRetryableError("Bad gateway", 502),
        AuthApiError("Internal server error", 500, "unexpected_failure"),
        AuthUnknownError("An unreadable answer", ValueError("not json")),
    ],
)
def test_an_auth_outage_while_checking_the_link_keeps_it_for_another_try(
    client, fake_db, auth_admin, monkeypatch, caplog, error
):
    token = session_token(fake_db, auth_user(fake_db))
    monkeypatch.setattr(fake_db.auth, "get_user", raises(error))
    caplog.set_level(logging.DEBUG)

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    # Not 400: the page would drop the token and ask for a new email.
    assert response.status_code == 503
    assert response.json() == {"detail": password_reset.UPDATE_FAILED}
    assert auth_admin.updates == []
    assert "could not check the token" in caplog.text
    assert token not in caplog.text


@pytest.mark.parametrize("status_code, code", [(401, "bad_jwt"), (403, "session_not_found"), (404, "user_not_found")])
def test_a_token_supabase_auth_refuses_asks_for_a_new_link(client, fake_db, auth_admin, monkeypatch, status_code, code):
    token = session_token(fake_db, auth_user(fake_db))
    error = AuthApiError("invalid JWT", status_code, code)
    monkeypatch.setattr(fake_db.auth, "get_user", raises(error))

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 400
    assert response.json() == {"detail": password_reset.INVALID_LINK}
    assert auth_admin.updates == []


@pytest.mark.parametrize(
    "case",
    [
        {"methods": ("password",)},  # an ordinary sign-in
        {"methods": ("oauth",)},
        {"methods": ()},
        {"methods": ("otp",), "age_seconds": password_reset.RECOVERY_MAX_AGE_SECONDS + 60},  # a refreshed old link
        {"methods": ("otp",), "sub": "22222222-2222-2222-2222-222222222222"},  # someone else's claims
    ],
)
def test_a_session_that_is_not_a_recent_recovery_is_refused(client, fake_db, auth_admin, case):
    user_id = auth_user(fake_db)
    token = session_token(fake_db, user_id, **case)

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 400
    assert response.json() == {"detail": password_reset.INVALID_LINK}
    assert auth_admin.updates == []
    assert auth_admin.sign_outs == []


def test_a_token_without_readable_claims_is_refused(client, fake_db, auth_admin):
    token = fake_db.add_auth_user("jon@demo.test")  # accepted by get_user, but not a JWT

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 400
    assert auth_admin.updates == []


def test_the_new_password_follows_the_sign_up_rules(client, fake_db, auth_admin):
    assert ResetPasswordIn.model_fields["password"].metadata == RegisterIn.model_fields["password"].metadata
    token = session_token(fake_db, auth_user(fake_db))

    assert client.post(RESET, json={"access_token": token, "password": "short"}).status_code == 422
    assert client.post(RESET, json={"access_token": token}).status_code == 422
    assert client.post(RESET, json={"access_token": "", "password": "new-password-1"}).status_code == 422
    assert auth_admin.updates == []


def test_a_password_the_supabase_policy_refuses_gets_422(client, fake_db, auth_admin):
    token = session_token(fake_db, auth_user(fake_db))
    auth_admin.update_error = AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"])

    response = client.post(RESET, json={"access_token": token, "password": "password123"})

    assert response.status_code == 422
    assert response.json() == {"detail": password_reset.WEAK_PASSWORD}
    assert auth_admin.sign_outs == []


def test_a_password_over_supabase_auths_length_limit_gets_422_not_a_retry(client, fake_db, auth_admin, caplog):
    token = session_token(fake_db, auth_user(fake_db))
    # What supabase-py raises for GoTrue's "Password cannot be longer than 72 characters".
    auth_admin.update_error = AuthApiError("Password cannot be longer than 72 characters", 400, "validation_failed")
    caplog.set_level(logging.DEBUG)
    password = "a long passphrase " * 5

    response = client.post(RESET, json={"access_token": token, "password": password})

    assert response.status_code == 422
    assert response.json() == {"detail": password_reset.PASSWORD_REFUSED}
    assert "72 characters" in password_reset.PASSWORD_REFUSED
    assert auth_admin.sign_outs == []
    assert password not in caplog.text


def test_a_failed_update_is_503_and_the_logs_hold_no_token_or_password(client, fake_db, auth_admin, caplog):
    token = session_token(fake_db, auth_user(fake_db))
    auth_admin.update_error = AuthRetryableError("Server disconnected", 0)
    caplog.set_level(logging.DEBUG)

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 503
    assert response.json() == {"detail": password_reset.UPDATE_FAILED}
    assert "failed" in caplog.text
    assert token not in caplog.text
    assert "new-password-1" not in caplog.text


def test_the_reset_stands_when_ending_the_sessions_fails(client, fake_db, auth_admin, caplog):
    token = session_token(fake_db, auth_user(fake_db))
    auth_admin.sign_out_error = AuthRetryableError("Server disconnected", 0)
    caplog.set_level(logging.DEBUG)

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 200
    assert len(auth_admin.updates) == 1
    assert "not ended" in caplog.text
    assert token not in caplog.text


@pytest.mark.parametrize("status_code, code", [(403, "session_not_found"), (401, "bad_jwt"), (404, "user_not_found")])
def test_a_sign_out_that_finds_the_sessions_already_ended_is_no_warning(
    client, fake_db, auth_admin, caplog, status_code, code
):
    # The admin password update has already ended the token's session.
    token = session_token(fake_db, auth_user(fake_db))
    auth_admin.sign_out_error = AuthApiError("Session from session_id claim in JWT does not exist", status_code, code)
    caplog.set_level(logging.DEBUG, logger="app.services.password_reset")

    response = client.post(RESET, json={"access_token": token, "password": "new-password-1"})

    assert response.status_code == 200
    assert auth_admin.sign_outs == [(token, "global")]
    assert [record.levelname for record in caplog.records if "sessions of auth user" in record.getMessage()] == ["DEBUG"]
    assert "already ended" in caplog.text
    assert token not in caplog.text


def test_the_reset_is_named_in_the_audit_trail(client, fake_db, auth_admin, monkeypatch):
    user_id = auth_user(fake_db)
    app_user_id = "33333333-3333-3333-3333-333333333333"
    fake_db.seed(
        "users",
        [{"id": app_user_id, "auth_user_id": user_id, "email": "jon@demo.test", "updated_at": "2026-01-01T00:00:00+00:00"}],
    )
    recorded = []
    monkeypatch.setattr(password_reset.audit, "record", lambda *args, **kwargs: recorded.append(args))

    client.post(RESET, json={"access_token": session_token(fake_db, user_id), "password": "new-password-1"})

    assert recorded == [(app_user_id, "auth.password_reset", "profile", app_user_id)]
