"""Self-serve password reset through Supabase Auth's recovery emails (A16).

1. POST /auth/forgot-password asks Supabase Auth to email a recovery link.
   The answer is the same whether or not the address has an account, and the
   email request runs after the response, so its timing does not tell either.
2. The link opens Supabase's verify endpoint, which starts a short recovery
   session and redirects to <frontend_url>/reset-password with that session's
   access token in the URL fragment, or with error_code=otp_expired once the
   link has expired or been used.
3. POST /auth/reset-password checks the token with Supabase Auth, accepts
   only a recent recovery session, sets the new password through the admin
   API, which ends every session of the account, and makes sure of that with
   a global sign-out.

This module never logs an email, IP address, token or password: failures
name a keyed fingerprint of the address, or the auth user id.
"""

import base64
import hashlib
import hmac
import json
import logging
import math
import secrets
from threading import Lock
import time

from fastapi import HTTPException, status
from supabase import AuthApiError, AuthRetryableError, AuthUnknownError, Client, ClientOptions, create_client

from app.core.config import settings
from app.core.supabase import get_supabase_client
from app.services import audit
from app.services import profiles as profiles_service

logger = logging.getLogger(__name__)

REQUEST_ACCEPTED = (
    "If an account exists for that email, a link to reset the password is on its way. "
    "Check your inbox and spam folder."
)
TOO_MANY_REQUESTS = "Too many reset requests. Wait a while, then try again."
INVALID_LINK = "This reset link has expired or was already used. Request a new link."
WEAK_PASSWORD = "Password does not meet the minimum requirements. Choose a longer or less common password."
# Supabase Auth refuses a password over 72 bytes with validation_failed.
PASSWORD_REFUSED = "This password can't be used. Choose a different one of at most 72 characters."
UPDATE_FAILED = "Could not update the password right now. Please try again."
PASSWORD_UPDATED = "Password updated. Sign in with your new password."

# In-process limits on reset emails, on top of Supabase's own email limits.
# Each worker process counts on its own. The client address is the socket's
# unless uvicorn trusts a proxy's forwarded headers (docs/password-reset.md).
REQUEST_WINDOW_SECONDS = 3600
REQUESTS_PER_EMAIL = 5
REQUESTS_PER_CLIENT = 10
_requests: dict[str, list[float]] = {}
_lock = Lock()

# Authentication methods of a session that proved control of the mailbox:
# Supabase records "otp" for a link opened in the implicit flow and
# "recovery" for one exchanged as a PKCE code.
RECOVERY_METHODS = {"recovery", "otp"}
# How long after opening the link the session may still set a password. The
# method keeps its timestamp when a session is refreshed.
RECOVERY_MAX_AGE_SECONDS = 3600

# Per process, so fingerprints tie log lines and rate limits to one address or
# client without keeping it, and mean nothing outside this process.
_FINGERPRINT_KEY = secrets.token_bytes(32)


def _fingerprint(value: str) -> str:
    return hmac.new(_FINGERPRINT_KEY, value.encode(), hashlib.sha256).hexdigest()[:16]


def clear_limits() -> None:
    with _lock:
        _requests.clear()


def claim_request(email: str, client_host: str | None) -> None:
    """Count one reset request for this address and this client, or refuse with 429.

    Unknown addresses count like known ones, so a refusal says nothing about
    whether an account exists.
    """
    limits = {f"email:{_fingerprint(email.lower())}": REQUESTS_PER_EMAIL}
    if client_host:
        limits[f"client:{_fingerprint(client_host)}"] = REQUESTS_PER_CLIENT
    now = time.monotonic()
    with _lock:
        for key, stamps in list(_requests.items()):
            if not stamps or now - stamps[-1] >= REQUEST_WINDOW_SECONDS:
                del _requests[key]
        recent = {key: [stamp for stamp in _requests.get(key, []) if now - stamp < REQUEST_WINDOW_SECONDS]
                  for key in limits}
        full = [stamps for key, stamps in recent.items() if len(stamps) >= limits[key]]
        if full:
            wait = max(REQUEST_WINDOW_SECONDS - (now - stamps[0]) for stamps in full)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                TOO_MANY_REQUESTS,
                headers={"Retry-After": str(max(1, math.ceil(wait)))},
            )
        for key, stamps in recent.items():
            _requests[key] = stamps + [now]


def reset_page_url() -> str:
    """Where the emailed link lands. Supabase Auth must list it under Redirect URLs."""
    return f"{settings.frontend_url.rstrip('/')}/reset-password"


def _recovery_client() -> Client:
    """A throwaway client whose recovery links carry the session, not a code.

    ClientOptions defaults to the PKCE flow. Under PKCE a reset request sends
    a code challenge and keeps the verifier in the requesting client's memory,
    and the emailed link comes back with ?code=..., which only that verifier
    can exchange for a session. This client is gone by the time the user
    clicks, and the browser never had the verifier, so such a link could not
    work. In the implicit flow Supabase puts the recovery session's access
    token in the redirect's fragment (#access_token=...&type=recovery), which
    the reset page reads. supabase_auth 2.31 sends no challenge from
    reset_password_for_email in either flow; naming the flow keeps the links
    working if a later version starts to.

    Fresh and uncached for the same reason as create_supabase_client().
    """
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=ClientOptions(flow_type="implicit"),
    )


def send_reset_email(email: str) -> None:
    """Ask Supabase Auth to email a recovery link. Never raises: the request has been answered.

    Supabase answers an unknown address as it does a known one and sends
    nothing, so a failure here is an outage or one of its own email limits.
    """
    try:
        _recovery_client().auth.reset_password_for_email(email, {"redirect_to": reset_page_url()})
    except Exception as exc:
        logger.warning(
            "password reset email for %s not sent: %s (status %s, code %s)",
            _fingerprint(email.lower()),
            type(exc).__name__,
            getattr(exc, "status", None),
            getattr(exc, "code", None),
        )


def _invalid_link() -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_LINK)


def _auth_unavailable(exc: Exception) -> bool:
    """Whether Supabase Auth failed to answer, rather than refused.

    supabase_auth raises AuthRetryableError for a network failure or a
    gateway error (502, 503, 504...), AuthUnknownError for an answer it cannot
    read, and AuthApiError with the answer's status otherwise.
    """
    if isinstance(exc, (AuthRetryableError, AuthUnknownError)):
        return True
    return isinstance(exc, AuthApiError) and exc.status >= 500


def _claims(access_token: str) -> dict:
    """The JWT's payload, unverified: read it only after Supabase Auth accepted the token."""
    try:
        payload = access_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _is_recent_recovery(claims: dict, auth_user_id: str) -> bool:
    """True for a session of this user that opened an emailed link within the last hour.

    A password sign-in or an OAuth session is refused: whoever holds such a
    token has not shown they can read the account's mailbox.
    """
    if claims.get("sub") != auth_user_id:
        return False
    now = time.time()
    for entry in claims.get("amr") or []:
        if not isinstance(entry, dict) or entry.get("method") not in RECOVERY_METHODS:
            continue
        stamp = entry.get("timestamp")
        if isinstance(stamp, (int, float)) and now - stamp <= RECOVERY_MAX_AGE_SECONDS:
            return True
    return False


def reset_password(access_token: str, password: str) -> None:
    """Set a new password for the account whose recovery session sent the token.

    Any token that is not a live, recent recovery session of its user
    (expired, already used, forged, or an ordinary sign-in) gets 400, so the
    page can offer a new link. A password Supabase Auth refuses, for its
    policy or its 72-byte limit, gets 422. When Supabase Auth cannot answer,
    the answer is 503: the link may still be good, and the page keeps it for
    another try.
    """
    supabase = get_supabase_client()
    try:
        response = supabase.auth.get_user(access_token)
    except Exception as exc:
        if _auth_unavailable(exc):
            logger.warning(
                "password reset could not check the token: %s (status %s)",
                type(exc).__name__,
                getattr(exc, "status", None),
            )
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UPDATE_FAILED) from exc
        logger.info("password reset refused: Supabase Auth did not accept the token (%s)", type(exc).__name__)
        raise _invalid_link() from exc
    user = getattr(response, "user", None)
    if user is None:
        raise _invalid_link()
    # Decoded only now: get_user has checked the token's signature and expiry.
    if not _is_recent_recovery(_claims(access_token), user.id):
        logger.info("password reset refused for auth user %s: not a recent recovery session", user.id)
        raise _invalid_link()

    try:
        supabase.auth.admin.update_user_by_id(user.id, {"password": password})
    except Exception as exc:
        if getattr(exc, "code", None) == "weak_password":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, WEAK_PASSWORD) from exc
        if isinstance(exc, AuthApiError) and 400 <= exc.status < 500:
            # Trying again cannot help: the user has to choose another password.
            logger.info("password reset for auth user %s refused the password (code %s)", user.id, exc.code)
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, PASSWORD_REFUSED) from exc
        logger.warning(
            "password reset for auth user %s failed: %s (status %s)",
            user.id,
            type(exc).__name__,
            getattr(exc, "status", None),
        )
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UPDATE_FAILED) from exc

    _end_sessions(supabase, access_token, user.id)
    _record_reset(user.id)


def _end_sessions(supabase: Client, access_token: str, auth_user_id: str) -> None:
    """Make sure the account is signed out everywhere, the recovery session included.

    A reset often follows a suspected break-in, and the link's token must not
    set a password twice. Supabase Auth's admin password update already ends
    every session, so this sign-out usually finds the token's session gone and
    is refused with 401, 403 or 404, as supabase-js also treats as signed out.
    The password has already changed, so any other failure is logged, not
    returned.
    """
    try:
        supabase.auth.admin.sign_out(access_token, "global")
    except Exception as exc:
        if isinstance(exc, AuthApiError) and exc.status in (401, 403, 404):
            logger.debug("sessions of auth user %s were already ended (code %s)", auth_user_id, exc.code)
            return
        logger.warning(
            "sessions of auth user %s not ended after a password reset: %s", auth_user_id, type(exc).__name__
        )


def _record_reset(auth_user_id: str) -> None:
    """Name the reset in the audit trail, which the middleware skips for signed-out requests."""
    try:
        user = profiles_service.get_user_by_auth_id(auth_user_id)
    except Exception:
        user = None
    actor_id = user["id"] if user else None
    audit.record(actor_id, "auth.password_reset", "profile" if actor_id else None, actor_id)
