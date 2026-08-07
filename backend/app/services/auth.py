import logging

from fastapi import HTTPException, status

from app.core.supabase import create_supabase_client, get_supabase_client
from app.schemas.auth import REGISTERABLE_ROLES
from app.services import profiles as profiles_service

logger = logging.getLogger(__name__)


def _profile_for(user_id: str) -> dict:
    try:
        return profiles_service.get_profile(user_id)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Profile was not created for this account",
            ) from exc
        raise


def _session_dict(session, user_id: str) -> dict:
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "token_type": "bearer",
        "expires_at": session.expires_at,
        "profile": _profile_for(user_id),
    }


def register(email: str, password: str, full_name: str, role: str) -> dict:
    if role not in REGISTERABLE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of {REGISTERABLE_ROLES}")

    supabase = get_supabase_client()

    # Create a confirmed auth user with the service-role (admin) client. The
    # public.handle_new_user() trigger reads full_name + role from user_metadata
    # and inserts the matching public.profiles row automatically.
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
        # The user-facing message is deliberately generic; log the real cause so
        # a failing signup is diagnosable from the server log.
        logger.warning("auth.register failed for %s: %s", email, exc, exc_info=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _clean_auth_error(exc)) from exc

    if created is None or created.user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not create account")

    # Immediately sign the new user in so the client receives a usable session.
    return login(email, password)


def login(email: str, password: str) -> dict:
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

    return _session_dict(response.session, response.user.id)


def _clean_auth_error(exc: Exception) -> str:
    message = str(exc)
    lowered = message.lower()
    if "already" in lowered or "registered" in lowered or "exists" in lowered:
        return "An account with this email already exists"
    if "password" in lowered:
        return "Password does not meet the minimum requirements"
    return "Could not create account"
