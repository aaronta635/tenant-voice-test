"""Verification gates (tracker R18): only an active, verified account applies, publishes, uses paid AI or takes new work.

A gate reads the account again at each check, so whatever the request read
at its start, a suspension or a document back in review counts at the next
check. Anything but ACTIVE with an approved verification fails closed with
403 and an object detail: code, action, status, a sentence in the action's
words and the role's documents page. A provider's profile verification must
be approved too. A check on someone the caller hands work to never says why
that account is refused.
"""

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.deps import CurrentProfile, get_current_profile
from app.services import gates
from tests.factories import NOW
from tests.factories_identity import account, users_row
from tests.factories_provider_core import provider_profile

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a2000000-0000-4000-8000-000000000001"
TESS = "b2000000-0000-4000-8000-000000000001"
PAT = "b2000000-0000-4000-8000-000000000002"
NOBODY = "b2000000-0000-4000-8000-0000000000ff"
MISSING = object()

# Each action in the words its refusal uses.
DOING = {
    "apply": "apply for rentals",
    "publish_listing": "publish listings",
    "paid_ai": "use AI features",
    "accept_booking": "accept bookings",
    "receive_repairs": "take on repairs",
    "go_live": "go live on the marketplace",
}
DOCUMENTS = {
    "TENANT": "/tenant/id-verification",
    "LANDLORD": "/owner/profile/verification",
    "AGENT": "/owner/profile/verification",
    "SERVICE_PROVIDER": "/dashboard/profile#verification-documents",
}


def seed(db, user_id=TESS, primary_role="TENANT", profile=MISSING, **over):
    """A users row, and for profile= a provider's service_provider_profiles row with that verification_status."""
    db.seed("users", [users_row(user_id, f"{user_id}@example.test", primary_role, **over)])
    if profile is not MISSING:
        db.seed("service_provider_profiles", [{**provider_profile(user_id), "verification_status": profile}])


def me(user_id=TESS, role="tenant", **raw):
    """The caller as get_current_profile builds it; raw is what the request read at its start."""
    return CurrentProfile(id=user_id, role=role, full_name="Tess", raw={"id": user_id, **raw})


def refusal(current, action):
    with pytest.raises(HTTPException) as refused:
        gates.require_verified(current, action)
    assert refused.value.status_code == 403
    return refused.value.detail


def user(db, user_id):
    return next(row for row in db.tables["users"] if row["id"] == user_id)


# ---------------------------------------------------------------------------
# Every action against every account state
# ---------------------------------------------------------------------------
ACCOUNTS = [
    # (users row values, the status a refusal gives; None: the gate lets it through)
    ({"status": "ACTIVE", "verification_status": "APPROVED"}, None),
    # The other verified value the badge accepts, in any case.
    ({"status": "ACTIVE", "verification_status": "VERIFIED"}, None),
    ({"status": "ACTIVE", "verification_status": " approved "}, None),
    ({"status": "ACTIVE", "verification_status": "PENDING"}, "pending"),
    ({"status": "ACTIVE", "verification_status": "pending"}, "pending"),
    ({"status": "ACTIVE", "verification_status": "REJECTED"}, "rejected"),
    # A value the web does not know fails closed.
    ({"status": "ACTIVE", "verification_status": "IN_REVIEW"}, "unknown"),
    ({"status": "ACTIVE", "verification_status": ""}, "unknown"),
    # The account's own status comes before its verification.
    ({"status": "SUSPENDED", "verification_status": "APPROVED"}, "suspended"),
    ({"status": "SUSPENDED", "verification_status": "PENDING"}, "suspended"),
    ({"status": "DEACTIVATED", "verification_status": "APPROVED"}, "inactive"),
    ({"status": "PENDING_VERIFICATION", "verification_status": "APPROVED"}, "inactive"),
    ({"status": "ACTIVE", "verification_status": "APPROVED", "deleted_at": NOW}, "inactive"),
]


# users_verification_status_check holds users.verification_status to these. The gate reads any other
# spelling (one stored before the CHECK, say) the same way, so such a value is put on the stored row
# after a seed the CHECK accepts.
CHECKED_STATUSES = {"PENDING", "APPROVED", "REJECTED"}


def seed_account(db, over):
    value = over.get("verification_status")
    if value is None or value in CHECKED_STATUSES:
        seed(db, **over)
        return
    seed(db, **{**over, "verification_status": "PENDING"})
    user(db, TESS)["verification_status"] = value


@pytest.mark.parametrize("action", list(DOING))
@pytest.mark.parametrize("over, refused", ACCOUNTS)
def test_every_action_passes_only_an_active_verified_account(strict_schema, action, over, refused):
    seed_account(strict_schema, over)

    if refused is None:
        assert gates.require_verified(me(), action) is None
        assert gates.refusal(me(), action) is None
        return
    detail = refusal(me(), action)
    assert (detail["code"], detail["action"], detail["status"]) == ("verification_required", action, refused)
    assert DOING[action] in detail["message"]
    # Documents can only help while the verification is what stands in the way.
    linked = refused in ("pending", "rejected", "unknown")
    assert detail["documents_href"] == ("/tenant/id-verification" if linked else None)
    # The same detail without a raise, for a response that answers without the action.
    assert gates.refusal(me(), action) == detail


@pytest.mark.parametrize("action", list(DOING))
def test_an_account_without_a_users_row_fails_closed(action):
    detail = refusal(me(NOBODY), action)

    assert (detail["status"], detail["documents_href"]) == ("unknown", "/tenant/id-verification")
    assert DOING[action] in detail["message"]


@pytest.mark.parametrize("action", list(DOING))
@pytest.mark.parametrize("account_status, profile_status, refused", [
    ("APPROVED", "APPROVED", None),
    # The profile must agree with the account.
    ("APPROVED", "PENDING", "pending"),
    ("APPROVED", "REJECTED", "rejected"),
    ("APPROVED", None, "unknown"),
    ("APPROVED", "SOMETHING_ELSE", "unknown"),
    ("APPROVED", MISSING, "unknown"),
    # The account's own verification comes first.
    ("PENDING", "APPROVED", "pending"),
    ("REJECTED", "PENDING", "rejected"),
])
def test_a_providers_profile_verification_must_be_approved_too(
    strict_schema, action, account_status, profile_status, refused
):
    seed(strict_schema, PAT, "SERVICE_PROVIDER", profile=profile_status, verification_status=account_status)
    provider = me(PAT, "service_provider")

    if refused is None:
        assert gates.require_verified(provider, action) is None
        return
    detail = refusal(provider, action)
    assert (detail["status"], detail["documents_href"]) == (refused, "/dashboard/profile#verification-documents")


def test_each_refusal_says_what_to_do_about_it(strict_schema):
    seed(strict_schema, verification_status="PENDING")
    assert refusal(me(), "apply")["message"] == (
        "Your account needs to be verified before you can apply for rentals. "
        "Upload the documents it asks for, or wait for the review to finish."
    )
    user(strict_schema, TESS)["verification_status"] = "REJECTED"
    assert refusal(me(), "apply")["message"] == (
        "Your account needs to be verified before you can apply for rentals. "
        "A document was rejected: replace it to send it for review again."
    )
    user(strict_schema, TESS)["verification_status"] = "ON_HOLD"
    assert refusal(me(), "apply")["message"] == (
        "Your account needs to be verified before you can apply for rentals. "
        "We couldn't confirm its verification, so check your documents or contact support."
    )
    user(strict_schema, TESS)["status"] = "SUSPENDED"
    assert refusal(me(), "apply")["message"] == (
        "Your account is suspended, so you can't apply for rentals. Contact support to restore it."
    )
    user(strict_schema, TESS)["status"] = "DEACTIVATED"
    assert refusal(me(), "apply")["message"] == (
        "Your account isn't active, so you can't apply for rentals. Contact support to restore it."
    )


@pytest.mark.parametrize("primary_role, current_role, href", [
    *[(role, role.lower(), href) for role, href in DOCUMENTS.items()],
    # Staff keep no documents, so there is nothing to link to.
    ("ADMIN", "admin", None),
    ("REGULATOR", "officer", None),
])
def test_the_refusal_links_to_the_documents_page_of_the_accounts_role(strict_schema, primary_role, current_role, href):
    seed(strict_schema, primary_role=primary_role, verification_status="PENDING")

    assert refusal(me(role=current_role), "publish_listing")["documents_href"] == href


def test_a_service_with_only_the_callers_id_asks_the_same_gate(strict_schema):
    seed(strict_schema, verification_status="PENDING")

    assert (refusal(TESS, "apply")["status"], refusal(TESS, "apply")["documents_href"]) == (
        "pending", "/tenant/id-verification")
    user(strict_schema, TESS)["verification_status"] = "APPROVED"
    assert gates.require_verified(TESS, "apply") is None
    # No users row, and no request role to go by either: no link.
    assert refusal(NOBODY, "apply")["documents_href"] is None


def test_an_unknown_action_is_a_mistake_never_a_pass(strict_schema):
    seed(strict_schema, verification_status="APPROVED")

    with pytest.raises(ValueError, match="unknown gated action 'book_inspection'"):
        gates.require_verified(me(), "book_inspection")
    with pytest.raises(ValueError):
        gates.require_verified_party(TESS, "book_inspection")


# ---------------------------------------------------------------------------
# A fresh read at every check
# ---------------------------------------------------------------------------
def test_a_change_counts_from_the_next_check_whatever_the_request_read(strict_schema):
    seed(strict_schema, PAT, "SERVICE_PROVIDER", profile="APPROVED", verification_status="APPROVED")
    # What the request read when it started, which the gate never trusts.
    provider = me(PAT, "service_provider", status="ACTIVE", verification_status="APPROVED")
    assert gates.require_verified(provider, "accept_booking") is None

    # A replaced document sends the account back to review (account_verification keeps the two equal).
    user(strict_schema, PAT)["verification_status"] = "PENDING"
    assert refusal(provider, "accept_booking")["status"] == "pending"

    user(strict_schema, PAT)["verification_status"] = "APPROVED"
    assert gates.require_verified(provider, "accept_booking") is None

    user(strict_schema, PAT)["status"] = "SUSPENDED"
    assert refusal(provider, "accept_booking")["status"] == "suspended"

    # And the other way: a stale refusal never sticks either.
    stale = me(PAT, "service_provider", status="SUSPENDED", verification_status="PENDING")
    user(strict_schema, PAT)["status"] = "ACTIVE"
    assert gates.require_verified(stale, "accept_booking") is None


def gated_app() -> FastAPI:
    """Routes that ask one gate each, as the integrated services will, behind the real token check."""
    app = FastAPI()

    @app.post("/gated/{action}")
    def gated(action: str, current: CurrentProfile = Depends(get_current_profile)):
        gates.require_verified(current, action)
        return {"done": action}

    return app


@pytest.mark.parametrize("primary_role, action", [
    ("TENANT", "apply"),
    ("LANDLORD", "publish_listing"),
    ("LANDLORD", "paid_ai"),
    ("SERVICE_PROVIDER", "accept_booking"),
    ("SERVICE_PROVIDER", "receive_repairs"),
    ("SERVICE_PROVIDER", "go_live"),
])
def test_a_direct_request_gets_the_refusal_as_an_object_detail(strict_schema, primary_role, action):
    token = account(strict_schema, TESS, "tess@example.test", primary_role, verification_status="PENDING")

    with TestClient(gated_app()) as http:
        response = http.post(f"/gated/{action}", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json() == {"detail": {
        "code": "verification_required",
        "action": action,
        "status": "pending",
        "message": f"Your account needs to be verified before you can {DOING[action]}. "
                   "Upload the documents it asks for, or wait for the review to finish.",
        "documents_href": DOCUMENTS[primary_role],
    }}


def test_an_admins_suspension_refuses_the_providers_next_request(client, strict_schema):
    seed(strict_schema, PAT, "SERVICE_PROVIDER", profile="APPROVED", verification_status="APPROVED")
    token = strict_schema.add_auth_user("pat@example.test")
    user(strict_schema, PAT)["auth_user_id"] = strict_schema.tokens[token]
    admin = account(strict_schema, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")
    provider = {"Authorization": f"Bearer {token}"}

    with TestClient(gated_app()) as http:
        assert http.post("/gated/accept_booking", headers=provider).json() == {"done": "accept_booking"}

        suspended = client.post(f"/api/v1/admin/users/{PAT}/status", json={"status": "SUSPENDED", "reason": "Fraud"},
                                headers={"Authorization": f"Bearer {admin}"})
        assert suspended.status_code == 200, suspended.text

        response = http.post("/gated/accept_booking", headers=provider)
    assert response.status_code == 403
    assert response.json()["detail"]["status"] == "suspended"
    assert response.json()["detail"]["documents_href"] is None


# ---------------------------------------------------------------------------
# Someone the caller hands work to
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("over, profile, refused, message", [
    ({"verification_status": "APPROVED"}, "APPROVED", None, None),
    ({"verification_status": "PENDING"}, "PENDING", "unverified",
     "This provider isn't verified yet, so they can't be assigned repairs."),
    # Rejected or not, the owner is told the same.
    ({"verification_status": "REJECTED"}, "REJECTED", "unverified",
     "This provider isn't verified yet, so they can't be assigned repairs."),
    ({"verification_status": "APPROVED"}, MISSING, "unverified",
     "This provider isn't verified yet, so they can't be assigned repairs."),
    # Never that the account is suspended or closed.
    ({"status": "SUSPENDED", "verification_status": "APPROVED"}, "APPROVED", "unavailable",
     "This provider can't be assigned repairs right now."),
    ({"status": "ACTIVE", "verification_status": "APPROVED", "deleted_at": NOW}, "APPROVED", "unavailable",
     "This provider can't be assigned repairs right now."),
])
def test_a_party_check_never_says_why_another_account_is_refused(strict_schema, over, profile, refused, message):
    seed(strict_schema, PAT, "SERVICE_PROVIDER", profile=profile, **over)

    if refused is None:
        assert gates.require_verified_party(PAT, "receive_repairs") is None
        return
    with pytest.raises(HTTPException) as caught:
        gates.require_verified_party(PAT, "receive_repairs")
    assert caught.value.status_code == 403
    assert caught.value.detail == {
        "code": "verification_required", "action": "receive_repairs", "status": refused, "message": message,
        "documents_href": None,
    }


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT", "ADMIN", "REGULATOR"])
@pytest.mark.parametrize("verification", ["APPROVED", "PENDING"])
def test_a_repair_goes_to_a_service_provider_only(strict_schema, primary_role, verification):
    # Whatever their verification, nobody else has a repairs page to take the job on.
    seed(strict_schema, TESS, primary_role, verification_status=verification)

    with pytest.raises(HTTPException) as caught:
        gates.require_verified_party(TESS, "receive_repairs")

    assert (caught.value.status_code, caught.value.detail["status"]) == (403, "unavailable")
    assert caught.value.detail["message"] == "This member can't be assigned repairs right now."


@pytest.mark.parametrize("reference", [NOBODY, "not-a-uuid", ""])
def test_a_party_check_on_an_unknown_id_fails_closed_without_a_database_error(reference):
    with pytest.raises(HTTPException) as caught:
        gates.require_verified_party(reference, "receive_repairs")

    assert (caught.value.status_code, caught.value.detail["status"]) == (403, "unavailable")
    assert caught.value.detail["message"] == "This member can't be assigned repairs right now."
