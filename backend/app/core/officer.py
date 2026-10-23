"""The server-side officer check every /housing route depends on (tracker R41, assumption #8).

An officer is a users row whose primary_role is REGULATOR, which the identity
port maps to the web role officer (shared_map.DB_TO_WEB_ROLE). As for admins
(core/admin.py), get_current_profile reads that row again on every request,
so a role taken away stops working at once; the token's user_metadata, which
its holder can edit, never counts. An officer account that is not ACTIVE is
refused too: get_current_profile already stops a suspended, deactivated or
closed one, and this also stops one that is still PENDING_VERIFICATION.

Admins are refused like every other role. They prepare referrals in the admin
console and do not see the officer-only views, although the shared
mobile_require_housing_officer() lets an ADMIN through as well. Past the web's
own check, every /housing request also runs mobile_require_housing_officer()
as the officer, through their JWT, so a rule the database owner tightens there
holds on the web at once (assumption #8): its refusal is 403 with its message.
"""

from fastapi import Depends, HTTPException, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile, get_current_profile
from app.core.supabase import user_client

OFFICER_ROLE = "officer"
NOT_AN_OFFICER = "The Housing Portal is for authorised housing officers."
INACTIVE_OFFICER = "This officer account is not active. Ask the TenantVoice team to restore it."


def get_current_officer(current: CurrentProfile = Depends(get_current_profile)) -> CurrentProfile:
    if current.role != OFFICER_ROLE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_AN_OFFICER)
    if current.raw.get("status") != "ACTIVE" or current.raw.get("deleted_at"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, INACTIVE_OFFICER)
    try:
        user_client(current.access_token).rpc("mobile_require_housing_officer", {}).execute()
    except APIError as exc:
        if getattr(exc, "code", None) == "42501":
            raise HTTPException(status.HTTP_403_FORBIDDEN, exc.message or NOT_AN_OFFICER) from exc
        raise
    return current
