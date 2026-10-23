"""Verification gates: what only an active, verified account may do (tracker R18, assumptions #13, #14).

Browsing, searching and matching are open to everyone and never ask. These
actions do:

- apply: a tenant applies for a listing;
- publish_listing: a landlord publishes one;
- paid_ai: someone asks the paid model: an owner's assistant question, a
  tenant's AI order of their matches, the provider assistant's chat turns
  and AI reranking;
- accept_booking: a provider confirms a booking, or starts a confirmed one;
- receive_repairs: a provider is assigned a repair, or takes one on;
- go_live: a provider publishes their profile.

A gate reads the account again when it is asked, never the request's copy,
so a suspension, or a document that goes back to review, counts from the
next request on. Only an open users row with status ACTIVE whose
verification_status earns the verified badge (badges.is_verified) passes,
and a provider's service_provider_profiles.verification_status must too.
Anything else fails closed with 403: PENDING, REJECTED, a value the web does
not know, and a missing row.

The 403's detail is an object the web recognises (lib/verification-gate.ts)
and shows with VerificationRequired: code, action, status (why), a sentence
for the person and documents_href, their role's documents page. A suspended
or inactive account gets no link, since documents would not help.
refusal() gives the same detail without raising, for an endpoint that still
answers without the action: matching and the provider assistant keep their
rule results when the model is refused, and say why in their response.
require_verified_party() checks someone the caller hands work to, such as
the provider an owner assigns a repair: their account, and their role where
the work is a role's (a repair goes to a service provider only). It says
only whether they are verified or available, never why not.

The routes check the caller's role; the gates check the caller's account.
"""

from dataclasses import dataclass

from fastapi import HTTPException, status

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client
from app.services import badges, verification_rules
from app.services.maps_messaging import is_uuid
from app.services.shared_map import web_role

CODE = "verification_required"

# Where an account stands: APPROVED passes every gate; each other state is a reason it fails.
APPROVED = "approved"
PENDING = "pending"
REJECTED = "rejected"
UNKNOWN = "unknown"
SUSPENDED = "suspended"
INACTIVE = "inactive"
# The states that documents can change, so the refusal links to them.
VERIFICATION_STATES = frozenset({PENDING, REJECTED, UNKNOWN})
# A party check's status: never why another account is not verified or not active.
UNVERIFIED = "unverified"
UNAVAILABLE = "unavailable"

USER_COLUMNS = "id, primary_role, status, verification_status, deleted_at"
PROVIDER = "service_provider"


@dataclass(frozen=True)
class Action:
    # What the person may not do yet, after "you can't".
    own: str
    # The same for someone the caller hands it to, after "they can't".
    party: str
    # The web role someone the caller hands it to must have; None for any.
    party_role: str | None = None


ACTIONS = {
    "apply": Action("apply for rentals", "apply for rentals"),
    "publish_listing": Action("publish listings", "publish listings"),
    "paid_ai": Action("use AI features", "use AI features"),
    "accept_booking": Action("accept bookings", "accept bookings"),
    "receive_repairs": Action("take on repairs", "be assigned repairs", party_role=PROVIDER),
    "go_live": Action("go live on the marketplace", "go live on the marketplace"),
}

OWN_MESSAGES = {
    PENDING: "Your account needs to be verified before you can {doing}. "
    "Upload the documents it asks for, or wait for the review to finish.",
    REJECTED: "Your account needs to be verified before you can {doing}. "
    "A document was rejected: replace it to send it for review again.",
    UNKNOWN: "Your account needs to be verified before you can {doing}. "
    "We couldn't confirm its verification, so check your documents or contact support.",
    SUSPENDED: "Your account is suspended, so you can't {doing}. Contact support to restore it.",
    INACTIVE: "Your account isn't active, so you can't {doing}. Contact support to restore it.",
}
PARTY_MESSAGES = {
    UNVERIFIED: "This {who} isn't verified yet, so they can't {doing}.",
    UNAVAILABLE: "This {who} can't {doing} right now.",
}


@dataclass(frozen=True)
class Standing:
    # APPROVED, or why not: PENDING, REJECTED, UNKNOWN, SUSPENDED or INACTIVE.
    state: str
    # The users row's web role; None without a row.
    role: str | None


def _verification(value) -> str:
    """A verification_status as APPROVED, PENDING, REJECTED or UNKNOWN (a value the web does not know)."""
    if badges.is_verified(value):
        return APPROVED
    word = value.strip().upper() if isinstance(value, str) else None
    if word == verification_rules.PENDING:
        return PENDING
    if word == verification_rules.REJECTED:
        return REJECTED
    return UNKNOWN


def _account(user_id: str) -> dict | None:
    if not is_uuid(user_id):
        return None
    rows = get_supabase_client().table("users").select(USER_COLUMNS).eq("id", user_id).limit(1).execute().data
    return rows[0] if rows else None


def _provider_verification(user_id: str):
    rows = (
        get_supabase_client()
        .table("service_provider_profiles")
        .select("verification_status")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    return rows[0].get("verification_status") if rows else None


def verification_state(user: dict) -> str:
    """A users row's verification alone, whatever its status: APPROVED, PENDING, REJECTED or UNKNOWN.

    A provider's profile verification, read now, must be approved too. For a
    check that decides the account's status itself, such as an admin
    enabling a suspended provider (admin_providers.enable_lock).
    """
    state = _verification(user.get("verification_status"))
    if state == APPROVED and web_role(user.get("primary_role")) == PROVIDER:
        state = _verification(_provider_verification(user["id"]))
    return state


def standing(user_id: str) -> Standing:
    """Where an account stands for the gates, read now.

    The account's own status comes first: SUSPENDED, or INACTIVE for any
    other status than ACTIVE and for a closed row. Then its verification,
    and a provider's profile verification after an approved account. An id
    without a users row is UNKNOWN.
    """
    user = _account(user_id)
    if user is None:
        return Standing(UNKNOWN, None)
    role = web_role(user.get("primary_role"))
    if user.get("deleted_at"):
        return Standing(INACTIVE, role)
    if user.get("status") == "SUSPENDED":
        return Standing(SUSPENDED, role)
    if user.get("status") != "ACTIVE":
        return Standing(INACTIVE, role)
    return Standing(verification_state(user), role)


def _action(action: str) -> Action:
    if action not in ACTIONS:
        # A caller's mistake, not a person's state: never let it pass unseen.
        raise ValueError(f"unknown gated action {action!r}")
    return ACTIONS[action]


def _documents_href(role: str | None) -> str | None:
    # Imported on use: admin_verification imports admin_users, which imports a module that imports this one.
    from app.services.admin_verification import DOCUMENTS_PATH

    return DOCUMENTS_PATH.get(role or "")


def _refused(detail: dict) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, {"code": CODE, **detail})


def refusal(current: CurrentProfile | str, action: str) -> dict | None:
    """Why the caller's account, read now, may not take this action (ACTIONS); None when it may.

    current is the caller, or their users.id where a service has only that;
    never someone else's (require_verified_party). The detail says why
    (status), in the action's words (message), and links to the documents
    page of the caller's role while documents can change it (documents_href;
    None otherwise). It is require_verified()'s 403 detail, for a response
    that carries it instead.
    """
    doing = _action(action).own
    user_id, role = (current, None) if isinstance(current, str) else (current.id, current.role)
    found = standing(user_id)
    if found.state == APPROVED:
        return None
    return {
        "code": CODE,
        "action": action,
        "status": found.state,
        "message": OWN_MESSAGES[found.state].format(doing=doing),
        "documents_href": _documents_href(found.role or role) if found.state in VERIFICATION_STATES else None,
    }


def require_verified(current: CurrentProfile | str, action: str) -> None:
    """403 unless the caller's account, read now, may take this action; the detail is refusal()'s."""
    detail = refusal(current, action)
    if detail:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail)


def require_verified_party(user_id: str, action: str) -> None:
    """403 unless the account the caller hands this action to, read now, may take it.

    For work one person gives another, such as an owner assigning a repair
    to a provider (receive_repairs). An account of another role than the
    work's (Action.party_role) is UNAVAILABLE, whatever its verification.
    The detail's status is UNVERIFIED or UNAVAILABLE and its message
    neutral: whether that account was rejected or suspended is not the
    caller's to know. It has no documents link.
    """
    act = _action(action)
    found = standing(user_id)
    takes_it = act.party_role is None or found.role == act.party_role
    if found.state == APPROVED and takes_it:
        return
    reason = UNVERIFIED if takes_it and found.state in VERIFICATION_STATES and found.role else UNAVAILABLE
    who = "provider" if found.role == PROVIDER else "member"
    raise _refused({
        "action": action,
        "status": reason,
        "message": PARTY_MESSAGES[reason].format(who=who, doing=act.party),
        "documents_href": None,
    })
