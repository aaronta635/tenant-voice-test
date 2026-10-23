import logging

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.supabase import create_supabase_client, get_supabase_client
from app.schemas.auth import REGISTERABLE_ROLES
from app.services import audit
from app.services import profiles as profiles_service
from app.services.shared_map import flatten_user

logger = logging.getLogger(__name__)


def _profile_for_auth(auth_user_id: str) -> dict:
    try:
        return profiles_service.get_profile_by_auth_id(auth_user_id)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Profile was not created for this account",
            ) from exc
        raise


def _session_dict(session, user_id: str, profile: dict | None = None) -> dict:
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "token_type": "bearer",
        "expires_at": session.expires_at,
        "profile": profile if profile is not None else _profile_for_auth(user_id),
    }


def _auth_email(auth_user, typed: str) -> str:
    """The auth user's own address (sign-in ignores the case it was typed in), else the typed one."""
    return getattr(auth_user, "email", None) or typed


def register(email: str, password: str, full_name: str, role: str) -> dict:
    if role not in REGISTERABLE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of {REGISTERABLE_ROLES}")

    supabase = get_supabase_client()

    try:
        created = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"full_name": full_name, "role": role},
            }
        )
    except Exception as exc:  # gotrue raises on duplicate email / weak password
        logger.warning("auth.register failed for %s: %s", email, exc, exc_info=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _clean_auth_error(exc)) from exc

    if created is None or created.user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not create account")

    try:
        # Never another app's row by its email: email_confirm=True above means
        # nothing proved the address is this person's.
        app_user = profiles_service.ensure_user_for_auth(
            created.user.id, _auth_email(created.user, email), full_name, role, may_claim=False
        )
    except Exception:
        # An auth user with no account would keep the address taken: registering
        # again would say it exists, and signing in would fail.
        _delete_auth_user(created.user.id)
        raise
    audit.record(app_user["id"], "auth.registered", "profile", app_user["id"], {"role": role})

    # Immediately sign the new user in so the client receives a usable session.
    return login(email, password)


def _delete_auth_user(auth_user_id: str) -> None:
    """Remove an auth user a failed registration made. Never raises: the
    registration's own error is the one the caller needs."""
    try:
        get_supabase_client().auth.admin.delete_user(auth_user_id)
    except Exception as exc:
        logger.error("could not delete auth user %s after a failed registration: %s", auth_user_id, exc)


def login(email: str, password: str, role: str | None = None) -> dict:
    """Sign in, optionally asserting the account holds the role the user picked.

    The role selector on the login form is a real constraint, not decoration:
    signing in as "Client" with a landlord's address must fail rather than
    silently hand back a landlord session.
    """
    if role is not None and role not in REGISTERABLE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of {REGISTERABLE_ROLES}")

    # Throwaway client: signing in mutates the client's auth header, which would
    # downgrade the shared service-role client. See create_supabase_client().
    supabase = create_supabase_client()
    try:
        response = supabase.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as exc:
        logger.warning("auth.login failed for %s: %s", email, exc, exc_info=True)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password") from exc

    if response is None or response.session is None or response.user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    # user_metadata is editable by the account holder (and settable by anyone
    # signing up with the public anon key), so it can never grant admin/officer.
    meta = getattr(response.user, "user_metadata", None) or {}
    if not isinstance(meta, dict):
        meta = {}
    inferred_role = meta.get("role") if meta.get("role") in REGISTERABLE_ROLES else "tenant"
    inferred_name = meta.get("full_name") or email.split("@")[0]
    # Every sign-in checks the account: a first web sign-in (say, of a mobile
    # account) gets its rows, a half-made account is completed, and a
    # deactivated or closed one gets 403, as does a suspended one other than a
    # provider's (maps_identity.account_block).
    user = profiles_service.ensure_user_for_auth(
        response.user.id, _auth_email(response.user, email), inferred_name, inferred_role,
        may_claim=settings.claim_accounts_by_email,
    )
    profile = flatten_user(user)

    if role is not None and profile["role"] != role:
        audit.record(
            profile["id"],
            "auth.role_mismatch",
            "profile",
            profile["id"],
            {"attempted_role": role, "actual_role": profile["role"]},
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account is not registered for that role. Choose the correct account type.",
        )

    audit.record(profile["id"], "auth.logged_in", "profile", profile["id"], {"role": profile["role"]})
    return _session_dict(response.session, response.user.id, profile)


def refresh(refresh_token: str) -> dict:
    """Exchange a refresh token for a new access session.

    A deactivated or closed account, or a suspended one other than a
    provider's, gets 403 here as well, so its session cannot be renewed.
    """
    supabase = create_supabase_client()
    try:
        response = supabase.auth.refresh_session(refresh_token)
    except Exception as exc:
        logger.warning("auth.refresh failed: %s", exc, exc_info=True)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc

    if response is None or response.session is None or response.user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    return _session_dict(response.session, response.user.id)


def _clean_auth_error(exc: Exception) -> str:
    message = str(exc)
    lowered = message.lower()
    if "already" in lowered or "registered" in lowered or "exists" in lowered:
        return "An account with this email already exists"
    if "password" in lowered:
        return "Password does not meet the minimum requirements"
    return "Could not create account"
