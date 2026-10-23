"""Each account's verification, on the shared database's functions (tracker R17, docs/verification.md).

users.verification_status is PENDING, APPROVED or REJECTED, and the shared
functions set it, so both apps keep one rule:

- review_profile_document, at an admin's decision on a document
  (documents.review): an APPROVED account stays APPROVED; otherwise it is
  APPROVED once every type its role requires (verification_rules) has an
  approved document, REJECTED while one of them is rejected, else PENDING;
- review_user_verification, an admin's decision on the account itself
  (decide()), for a PENDING account only; approving a provider needs a
  service area and categories on its profile.

Both keep landlord_profiles and service_provider_profiles.verification_status
equal to the account's, notify the person and record the deciding admin in
approved_by_user_id, for a rejection of the account too.

The web adds one rule of its own (apply_rule): when the person replaces or
deletes a document of a type their verification requires (an upload of a
type they already have replaces it), an APPROVED or REJECTED account goes
back to PENDING, with its approval and reason cleared, and its profile row
with it. The next decision sets it again. That is this module's only write
of users, and it applies only while the account is as it was read.
"""

import logging
from collections.abc import Iterable
from datetime import datetime, timezone

from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client
from app.services import _common, badges, verification_rules
from app.services.shared_map import stamp_update

USERS = "users"
PROVIDER_PROFILES = "service_provider_profiles"
LANDLORD_PROFILES = "landlord_profiles"
DOCUMENTS = "profile_documents"
# The profile row each reviewed role keeps its verification_status on, as the functions update it.
ROLE_PROFILES = {"LANDLORD": LANDLORD_PROFILES, "SERVICE_PROVIDER": PROVIDER_PROFILES}
# A reset that finds the account changed reads it again, this many times at most.
ATTEMPTS = 3
ACCOUNT_COLUMNS = (
    "id, email, full_name, primary_role, verification_status, approved_by_user_id, approved_at, "
    "rejection_reason, metadata, updated_at, deleted_at"
)
DOCUMENT_COLUMNS = (
    "id, user_id, document_type, review_status, is_verified, rejection_reason, verified_by_user_id, "
    "verified_at, submitted_at, updated_at"
)
# How a shared function's error reaches the browser: its code's status, with its own message.
FUNCTION_ERRORS = {"42501": 403, "P0002": 404, "23505": 409, "22023": 422, "23514": 422}

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def raise_function_error(exc: APIError):
    """Raise a shared function's refusal as HTTP (FUNCTION_ERRORS), passing its message; anything else as it is."""
    code = FUNCTION_ERRORS.get(str(exc.code))
    if code is None:
        raise exc
    raise HTTPException(code, exc.message or "The database refused this change.") from exc


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def account(user_id: str) -> dict | None:
    """The users row's verification columns, with what the rule needs to know about the account."""
    rows = get_supabase_client().table(USERS).select(ACCOUNT_COLUMNS).eq("id", user_id).limit(1).execute().data
    return rows[0] if rows else None


def documents_of(user_ids: Iterable[str]) -> dict[str, list[dict]]:
    """Every document of these accounts, whatever its type, by account."""
    rows = _common.select_in(
        lambda: get_supabase_client().table(DOCUMENTS).select(DOCUMENT_COLUMNS).order("id"), "user_id", user_ids
    )
    found: dict[str, list[dict]] = {}
    for row in rows:
        found.setdefault(row["user_id"], []).append(row)
    return found


def provider_profiles(user_ids: Iterable[str]) -> dict[str, dict]:
    """The service_provider_profiles rows of these accounts that have one, by account."""
    rows = _common.select_in(
        lambda: get_supabase_client()
        .table(PROVIDER_PROFILES)
        .select("user_id, service_categories, service_area, verification_status")
        .order("user_id"),
        "user_id",
        user_ids,
    )
    return {row["user_id"]: row for row in rows}


def provider_ready(profile: dict | None) -> bool:
    """Whether review_user_verification would approve this provider: a service area and at least one category."""
    profile = profile or {}
    categories = profile.get("service_categories")
    return bool((profile.get("service_area") or "").strip()) and isinstance(categories, list) and bool(categories)


# ---------------------------------------------------------------------------
# As the web shows it
# ---------------------------------------------------------------------------
def web_status(verification_status: str | None) -> str:
    """verified, rejected or pending: users.verification_status as the web shows it."""
    if badges.is_verified(verification_status):
        return "verified"
    if isinstance(verification_status, str) and verification_status.strip().upper() == verification_rules.REJECTED:
        return "rejected"
    return "pending"


def account_out(user: dict) -> dict:
    """An account's verification as AccountVerificationOut.

    account_rejected tells an admin's rejection of the account itself from
    one a document decision made: review_user_verification records the
    admin in approved_by_user_id, and review_profile_document clears it on
    an account it rejects.
    """
    shown = web_status(user.get("verification_status"))
    return {
        "status": shown,
        "rejection_reason": user.get("rejection_reason") if shown == "rejected" else None,
        "approved_at": user.get("approved_at") if shown == "verified" else None,
        "account_rejected": shown == "rejected" and bool(user.get("approved_by_user_id")),
    }


# ---------------------------------------------------------------------------
# The web's reset
# ---------------------------------------------------------------------------
def _write(user: dict, changes: dict) -> dict | None:
    """The account after changes, or None when it changed since it was read."""
    rows = (
        get_supabase_client()
        .table(USERS)
        .update(stamp_update(USERS, changes))
        .eq("id", user["id"])
        .eq("verification_status", user.get("verification_status"))
        .eq("updated_at", user.get("updated_at"))
        .is_("deleted_at", "null")
        .execute()
        .data
    )
    return rows[0] if rows else None


def _sync_profile(user: dict, value: str) -> None:
    """Keep a landlord's or provider's profile row equal to the account, as the shared functions do."""
    table = ROLE_PROFILES.get(user.get("primary_role"))
    if table is None:
        return
    (
        get_supabase_client()
        .table(table)
        .update(stamp_update(table, {"verification_status": value}))
        .eq("user_id", user["id"])
        .execute()
    )


def apply_rule(user_id: str, *, document_type: str | None = None) -> dict | None:
    """The web's reset after the person replaced or deleted a document of document_type. Never raises.

    An APPROVED or REJECTED open account whose role requires that type goes
    back to PENDING; the users row after it, or None when nothing changed.
    A change without a document type (a provider's new category) changes
    nothing: what verification needs no longer depends on the category. The
    document change has already happened, so a failure is logged as an error.
    """
    if document_type is None:
        return None
    try:
        for _ in range(ATTEMPTS):
            user = account(user_id)
            if (
                user is None
                or user.get("deleted_at")
                or document_type not in verification_rules.counted_types(user.get("primary_role"))
                or user.get("verification_status") not in (verification_rules.APPROVED, verification_rules.REJECTED)
            ):
                return None
            updated = _write(user, {
                "verification_status": verification_rules.PENDING, "approved_by_user_id": None,
                "approved_at": None, "rejection_reason": None,
            })
            if updated is not None:
                _sync_profile(user, verification_rules.PENDING)
                return updated
        logger.error("account %s kept changing while its verification was reset; it stays as it is", user_id)
    except Exception:
        logger.exception("could not reset the verification of account %s", user_id)
    return None


# ---------------------------------------------------------------------------
# An admin's decision on the account itself
# ---------------------------------------------------------------------------
def decide(user: dict, decision: str, admin_id: str, reason: str | None = None) -> dict:
    """Approve or reject a PENDING account through review_user_verification; the users row after it.

    The function refuses an account already decided (409), a role it does
    not review and a provider without a service area and categories (422).
    """
    try:
        get_supabase_client().rpc("review_user_verification", {
            "p_user_id": user["id"],
            "p_reviewer_id": admin_id,
            "p_status": decision,
            "p_rejection_reason": reason,
            "p_now": _now(),
        }).execute()
    except APIError as exc:
        raise_function_error(exc)
    return account(user["id"]) or user
