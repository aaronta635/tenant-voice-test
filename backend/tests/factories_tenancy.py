"""Shared-schema rows for the lease tests (R26): the parties with sign-in tokens, and an approved application.

The lease functions read the caller from their token (current_app_user_id()),
so each person has an auth user id and a token in fake_db.tokens; as_party()
signs a request in as them with that token.
"""

from tests.factories_rental import (
    MANAGER,
    NOW,
    OTHER_TENANT,
    OWNER,
    PEOPLE,
    STRANGER,
    TENANT,
    application_row,
    listing_row,
    property_row,
    user_row,
)

PROVIDER = "c6666666-6666-4666-8666-666666666666"
ADMIN = "c7777777-7777-4777-8777-777777777777"
PEOPLE_WITH_STAFF = {**PEOPLE, PROVIDER: ("Pat Provider", "SERVICE_PROVIDER"), ADMIN: ("Ada Admin", "ADMIN")}
# Each person's auth user, and the token that signs them in.
AUTH = {person: f"a{person[1:]}" for person in PEOPLE_WITH_STAFF}
TOKEN = {person: f"jwt-{person[:8]}" for person in PEOPLE_WITH_STAFF}
WEB_ROLE = {"LANDLORD": "landlord", "AGENT": "landlord", "TENANT": "tenant", "SERVICE_PROVIDER": "service_provider",
            "ADMIN": "admin"}

__all__ = ["ADMIN", "AUTH", "MANAGER", "NOW", "OTHER_TENANT", "OWNER", "PROVIDER", "STRANGER", "TENANT", "TOKEN",
           "as_party", "seed_approved", "seed_parties"]


def seed_parties(db) -> None:
    """Everyone, ACTIVE and verified, each with an auth user and a token."""
    db.seed("users", [
        user_row(person, name, role, auth_user_id=AUTH[person], status="ACTIVE", verification_status="APPROVED")
        for person, (name, role) in PEOPLE_WITH_STAFF.items()
    ])
    for person in PEOPLE_WITH_STAFF:
        db.tokens[TOKEN[person]] = AUTH[person]


def as_party(as_profile, person: str):
    """Sign the next requests in as person, with their own token."""
    name, role = PEOPLE_WITH_STAFF[person]
    return as_profile(id=person, role=WEB_ROLE[role], full_name=name, access_token=TOKEN[person])


def seed_approved(db, owner: str = OWNER, tenant: str = TENANT, manager: str | None = MANAGER) -> dict:
    """A leased listing of owner's, managed by manager, with tenant's approved application.

    review_rental_application leaves an approved application's listing LEASED.
    Returns the ids: application, listing and property.
    """
    prop = property_row(owner, manager_user_id=manager, address_line_1="12 Harbour Street", address_line_2="Unit 4")
    listing = listing_row(prop["id"], owner, "LEASED", title="Harbour flat", bond_amount=2600, lease_term_months=12,
                          available_from="2026-11-01")
    application = application_row(listing["id"], tenant, "APPROVED", last_status_at=NOW,
                                  metadata={"applicant_snapshot": {"move_in_date": "2026-11-15"}})
    db.seed("properties", [prop])
    db.seed("listings", [listing])
    db.seed("rental_applications", [application])
    return {"application": application["id"], "listing": listing["id"], "property": prop["id"]}
