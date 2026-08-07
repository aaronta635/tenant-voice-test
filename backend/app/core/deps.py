from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.supabase import get_supabase_client

bearer_scheme = HTTPBearer(auto_error=False)


class CurrentProfile:
    def __init__(self, id: str, role: str, full_name: str, raw: dict):
        self.id = id
        self.role = role
        self.full_name = full_name
        self.raw = raw


def get_current_profile(
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

    user_id = user_response.user.id
    result = supabase.table("profiles").select("*").eq("id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No profile found for this account")

    profile = result.data[0]
    return CurrentProfile(id=profile["id"], role=profile["role"], full_name=profile["full_name"], raw=profile)


def require_role(*roles: str):
    def _dependency(profile: CurrentProfile = Depends(get_current_profile)) -> CurrentProfile:
        if profile.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this resource")
        return profile

    return _dependency


def get_optional_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentProfile | None:
    if credentials is None:
        return None
    try:
        return get_current_profile(credentials)
    except HTTPException:
        return None
