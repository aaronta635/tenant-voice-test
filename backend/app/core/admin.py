"""The server-side admin check every /admin route depends on (tracker R16).

An admin is a users row whose primary_role is ADMIN, which the identity port
maps to the web role admin (shared_map.DB_TO_WEB_ROLE). get_current_profile
reads that row again on every request, so a role taken away stops working at
once; the token's user_metadata, which its holder can edit, never counts. An
admin account that is not ACTIVE is refused too: get_current_profile already
stops a suspended (only a provider signs in while suspended), deactivated or
closed one, and this also stops one that is still PENDING_VERIFICATION.
"""

from fastapi import Depends, HTTPException, status

from app.core.deps import CurrentProfile, get_current_profile

ADMIN_ROLE = "admin"
NOT_AN_ADMIN = "This area is for TenantVoice administrators."
INACTIVE_ADMIN = "This admin account is not active. Ask the TenantVoice team to restore it."


def get_current_admin(current: CurrentProfile = Depends(get_current_profile)) -> CurrentProfile:
    if current.role != ADMIN_ROLE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_AN_ADMIN)
    if current.raw.get("status") != "ACTIVE" or current.raw.get("deleted_at"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, INACTIVE_ADMIN)
    return current
