"""The shared schema's account rows: which ones a web account needs, and who may use one.

A person is one public.users row, plus a user_role_assignments row and a
profile row for their role (migration plan §3 a2). app.services.profiles
applies these rules when it provisions, claims and checks an account; the
users -> ProfileOut mapping itself is shared_map.flatten_user.
"""

from __future__ import annotations

import re

# The roles the web provisions itself (schemas.auth.REGISTERABLE_ROLES), with
# the profile table each needs. Agent and staff accounts are made by the
# mobile app or the rental web, which keep their rows.
PROFILE_TABLES = {
    "TENANT": "tenant_profiles",
    "LANDLORD": "landlord_profiles",
    "SERVICE_PROVIDER": "service_provider_profiles",
}

# Never handed to a self-service sign-in that claims a row by its email, as a
# primary role or as any role assignment.
STAFF_ROLES = frozenset({"ADMIN", "REGULATOR"})

# users.metadata key of a row a web sign-up made and has not finished: it has
# no auth user yet and holds nothing, so the next sign-in with its email takes
# it over (profiles.ensure_user_for_auth), and the key goes.
UNFINISHED_SIGNUP = "web_signup_unfinished"
# A row another app made is only taken over when claiming by email is on.
UNLINKED_ACCOUNT = (
    "An account with this email already exists but is not linked to a sign-in yet. Contact support to link it."
)
# users.email is unique (users_email_key): an address another account holds (another sign-in's, a closed
# account's, staff's) cannot get a second account.
EMAIL_TAKEN = "This email address belongs to another TenantVoice account. Sign in with it or contact support."

# users.status values (AccountStatus) that keep a person out, with what they are told.
BLOCKED_STATUSES = {
    "SUSPENDED": "This account is suspended. Contact support to restore access.",
    "DEACTIVATED": "This account has been deactivated.",
}
# users.deleted_at is set, as archive_user_for_reregistration does.
CLOSED_ACCOUNT = "This account has been closed."
# The roles a suspension leaves signed in (tracker assumption #14): a
# suspended provider still finishes the jobs in progress and reads past
# messages and invoices, while the marketplace hides them (service_providers)
# and gates.require_verified refuses them new bookings, repairs and going live.
SIGNED_IN_WHEN_SUSPENDED = frozenset({"SERVICE_PROVIDER"})

_LIKE_SPECIAL = re.compile(r"([\\%_])")


def profile_row(role: str, user_id: str) -> dict:
    """A new profile row for a role of PROFILE_TABLES, before stamp_insert().

    Columns with a default are left to it. verification_status has none on
    these tables, so it starts as PENDING, like users.verification_status.
    """
    if role == "TENANT":
        return {"user_id": user_id}
    if role == "SERVICE_PROVIDER":
        # Private until the provider publishes it from onboarding.
        return {"user_id": user_id, "verification_status": "PENDING", "metadata": {"is_published": False}}
    return {"user_id": user_id, "verification_status": "PENDING"}


def account_block(user: dict) -> str | None:
    """Why this users row may not sign in to the web, or None when it may."""
    if user.get("deleted_at"):
        return CLOSED_ACCOUNT
    if user.get("status") == "SUSPENDED" and user.get("primary_role") in SIGNED_IN_WHEN_SUSPENDED:
        return None
    return BLOCKED_STATUSES.get(user.get("status"))


def unfinished_signup(user: dict) -> bool:
    """Whether a users row is one a web sign-up made and has not finished (UNFINISHED_SIGNUP)."""
    meta = user.get("metadata") if isinstance(user.get("metadata"), dict) else {}
    return meta.get(UNFINISHED_SIGNUP) is True


def normalized_email(email: str | None) -> str:
    return (email or "").strip().lower()


def ilike_exact(value: str) -> str:
    """An ilike pattern that matches value alone: its \\, % and _ are escaped.

    PostgREST also reads * as %, with no way to escape it, so a * matches any
    one character here. Callers compare the rows that come back (same_email).
    """
    return _LIKE_SPECIAL.sub(r"\\\1", value).replace("*", "_")


def same_email(stored: str | None, email: str) -> bool:
    """Whether a stored address is email, ignoring case: the mobile app may keep either."""
    return normalized_email(stored) == normalized_email(email)
