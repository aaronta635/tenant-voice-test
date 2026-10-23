from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.supabase import get_supabase_client

bearer_scheme = HTTPBearer(auto_error=False)
# Set on an answer to an optional sign-in whose token the API refused, so the
# web refreshes the session and asks again rather than show a member the
# signed-out page (lib/api.ts). The CORS middleware exposes it (main.py).
SESSION_EXPIRED_HEADER = "X-Session-Expired"


class CurrentProfile:
    def __init__(self, id: str, role: str, full_name: str, raw: dict, access_token: str | None = None):
        self.id = id
        self.role = role
        self.full_name = full_name
        self.raw = raw
        # The caller's bearer JWT, for user_client(): RPCs that read auth.uid().
        self.access_token = access_token


def get_current_profile(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentProfile:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    supabase = get_supabase_client()
    try:
        user_response = supabase.auth.get_user(credentials.credentials)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    if user_response is None or user_response.user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    from app.services.profiles import get_account_by_auth_id
    from app.services.shared_map import flatten_user

    # 403 for a deactivated or closed account, and a suspended one unless it is a
    # provider's (maps_identity.account_block): its token stays valid. The gates
    # (services/gates.py) keep new work from a suspended provider.
    user = get_account_by_auth_id(user_response.user.id)
    if not user:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No profile found for this account")

    profile = flatten_user(user)
    current = CurrentProfile(
        id=profile["id"],
        role=profile["role"],
        full_name=profile["full_name"],
        raw={**user, **profile},
        access_token=credentials.credentials,
    )
    # Stash the actor so AuditMiddleware can attribute the request without
    # validating the token a second time.
    request.state.actor_id = current.id
    request.state.actor_role = current.role
    return current


def require_role(*roles: str):
    def _dependency(profile: CurrentProfile = Depends(get_current_profile)) -> CurrentProfile:
        if profile.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this resource")
        return profile

    return _dependency


def get_optional_profile(
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentProfile | None:
    """The caller, or None: signed out, or a token or account the API refuses.

    A refused token (401: expired or invalid) also sets SESSION_EXPIRED_HEADER,
    so the web can refresh it; a refused account (403) does not.
    """
    if credentials is None:
        return None
    try:
        return get_current_profile(request, credentials)
    except HTTPException as refused:
        if refused.status_code == status.HTTP_401_UNAUTHORIZED:
            response.headers[SESSION_EXPIRED_HEADER] = "1"
        return None
