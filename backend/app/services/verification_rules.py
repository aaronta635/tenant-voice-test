"""Which documents each role may keep, and which ones its verification needs (tracker R15, R17).

The one rule table for the documents panel, the provider credentials and
the admin review. Types are ProfileDocumentType values
(profile_documents.document_type), and a person keeps one document of each:
the table is UNIQUE (user_id, document_type), so a new document of a type
they already have replaces theirs (documents.upload).

What verification needs is what review_profile_document, the shared function
that decides a document, counts (docs/verification.md): an approved
document of each required type of the account's users.primary_role.

- TENANT: a passport, a driver licence and a Medicare card;
- LANDLORD: a government photo ID and proof of property ownership;
- SERVICE_PROVIDER: a government photo ID, a trade licence and public
  liability insurance.

Agents and staff have no requirements: the shared functions review the
three roles above only. users.verification_status is the functions' to set
(account_verification); this module states what they count and how far a
person's documents meet it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from app.services.maps_provider_core import CREDENTIAL_DOCUMENT_TYPES, web_document_status

GROUP_LABELS = {
    "identity": "Identity",
    "financial": "Financial",
    "address": "Address",
    "rental": "Rental history",
    "property": "Property",
    "business": "Business",
    "background": "Background checks",
    "other": "Other",
}


@dataclass(frozen=True)
class DocumentType:
    label: str
    description: str
    group: str


DOCUMENT_TYPES = {
    "PASSPORT": DocumentType("Passport", "A current passport showing your full name and photo.", "identity"),
    "DRIVERS_LICENCE": DocumentType(
        "Driver licence", "A current driver licence, front and back in one file.", "identity"
    ),
    "GOVERNMENT_PHOTO_ID": DocumentType(
        "Government photo ID",
        "A current government-issued photo ID, such as a driver licence, passport or NSW Photo Card.",
        "identity",
    ),
    "MEDICARE_CARD": DocumentType("Medicare card", "Your current Medicare card.", "identity"),
    "BANK_STATEMENT": DocumentType(
        "Bank statement", "A recent statement showing regular income or savings.", "financial"
    ),
    "CENTRELINK_STATEMENT": DocumentType(
        "Centrelink statement", "A recent income statement from Services Australia.", "financial"
    ),
    "UTILITY_BILL": DocumentType("Utility bill", "A bill in your name from the past 3 months.", "address"),
    "RENT_LEDGER": DocumentType("Rent ledger", "The rent ledger of your current or last tenancy.", "rental"),
    "RENT_RECEIPT": DocumentType("Rent receipt", "A recent receipt for rent you paid.", "rental"),
    "WRITTEN_REFERENCE": DocumentType(
        "Written reference", "A reference from a past landlord, agent or employer.", "rental"
    ),
    "PROOF_OF_PROPERTY_OWNERSHIP": DocumentType(
        "Proof of ownership", "A rates notice, title search or contract of sale in your name.", "property"
    ),
    "PROPERTY_MANAGEMENT_AUTHORITY": DocumentType(
        "Management authority", "An agency agreement or the owner's written authority to manage the property.",
        "property",
    ),
    "TRADE_LICENCE": DocumentType("Trade licence", "The current licence your trade or service needs.", "business"),
    "PUBLIC_LIABILITY_INSURANCE": DocumentType(
        "Public liability insurance", "A current certificate of currency for your policy.", "business"
    ),
    "POLICE_CHECK": DocumentType("Police check", "A national police check from the past 12 months.", "background"),
    # One slot, as every type has: the web's payslips and contracts share it.
    "OTHER": DocumentType(
        "Other document (for example a payslip or contract)",
        "One more document that supports your profile, with a short name. A new one replaces it.",
        "other",
    ),
}

# A tenant's verification needs a passport and a driver licence by name. A
# landlord's or provider's photo ID counts only as a GOVERNMENT_PHOTO_ID, which
# takes any government photo ID, so their documents panel offers that one.
NAMED_PHOTO_IDS = ("PASSPORT", "DRIVERS_LICENCE")

# The types each web role may keep, in the order the documents panel shows them.
ROLE_DOCUMENT_TYPES: dict[str, tuple[str, ...]] = {
    "tenant": (
        "PASSPORT", "DRIVERS_LICENCE", "GOVERNMENT_PHOTO_ID", "MEDICARE_CARD",
        "BANK_STATEMENT", "CENTRELINK_STATEMENT", "UTILITY_BILL",
        "RENT_LEDGER", "RENT_RECEIPT", "WRITTEN_REFERENCE", "POLICE_CHECK", "OTHER",
    ),
    "landlord": ("GOVERNMENT_PHOTO_ID", "PROOF_OF_PROPERTY_OWNERSHIP", "PROPERTY_MANAGEMENT_AUTHORITY", "OTHER"),
    # The provider credentials, as maps_provider_core reads them, but for the
    # mobile app's named photo IDs, which read as the provider page's ID.
    "service_provider": tuple(
        sorted(
            (value for value in CREDENTIAL_DOCUMENT_TYPES if value not in NAMED_PHOTO_IDS),
            key=lambda value: list(DOCUMENT_TYPES).index(value),
        )
    ),
}

# Types a role was offered before (the earlier panel took a landlord's passport or licence, which count no
# more): a person who holds one still sees, opens, replaces and deletes it, but cannot upload a new one.
EARLIER_DOCUMENT_TYPES: dict[str, tuple[str, ...]] = {
    "landlord": NAMED_PHOTO_IDS,
    "service_provider": NAMED_PHOTO_IDS,
}


# review_profile_document's v_required_types, by users.primary_role.
REQUIRED_TYPES: dict[str, tuple[str, ...]] = {
    "TENANT": ("PASSPORT", "DRIVERS_LICENCE", "MEDICARE_CARD"),
    "LANDLORD": ("GOVERNMENT_PHOTO_ID", "PROOF_OF_PROPERTY_OWNERSHIP"),
    "SERVICE_PROVIDER": ("GOVERNMENT_PHOTO_ID", "TRADE_LICENCE", "PUBLIC_LIABILITY_INSURANCE"),
}


@dataclass(frozen=True)
class Requirement:
    key: str
    label: str
    # The document types that meet it: one, as the shared function counts them.
    any_of: tuple[str, ...]


def _requirement(document_type: str) -> Requirement:
    key, label = {
        "GOVERNMENT_PHOTO_ID": ("photo_id", "Photo ID"),
        "PROOF_OF_PROPERTY_OWNERSHIP": ("proof_of_ownership", "Proof of ownership"),
        "PUBLIC_LIABILITY_INSURANCE": ("public_liability", "Public liability insurance"),
    }.get(document_type, (document_type.lower(), DOCUMENT_TYPES[document_type].label))
    return Requirement(key, label, (document_type,))


ROLE_REQUIREMENTS: dict[str, tuple[Requirement, ...]] = {
    role: tuple(_requirement(document_type) for document_type in types) for role, types in REQUIRED_TYPES.items()
}


def allowed_types(role: str) -> tuple[str, ...]:
    """The document types a web role may keep; none for staff and unknown roles."""
    return ROLE_DOCUMENT_TYPES.get(role, ())


def kept_types(role: str) -> tuple[str, ...]:
    """The types a web role may hold: those it may upload (allowed_types), then the earlier ones it may keep."""
    allowed = allowed_types(role)
    return allowed + tuple(value for value in EARLIER_DOCUMENT_TYPES.get(role, ()) if value not in allowed)


def requirements(primary_role: str | None) -> tuple[Requirement, ...]:
    """What an account's verification needs, by its users.primary_role; none for agents and staff."""
    return ROLE_REQUIREMENTS.get(primary_role or "", ())


def counted_types(primary_role: str | None) -> frozenset[str]:
    """The document types the account's verification counts."""
    return frozenset(REQUIRED_TYPES.get(primary_role or "", ()))


def requirement_status(requirement: Requirement, documents: Iterable[dict]) -> str:
    """missing, pending, verified or rejected: the best state of a document that could meet it.

    documents are profile_documents rows. An approved document meets the
    requirement; otherwise one waiting for review counts over a rejected one.
    """
    states = {web_document_status(row) for row in documents if row.get("document_type") in requirement.any_of}
    for state in ("verified", "pending", "rejected"):
        if state in states:
            return state
    return "missing"


def requirements_met(primary_role: str | None, documents: Iterable[dict]) -> bool:
    """Whether every required type of the account has an approved document."""
    rows = list(documents)
    needed = requirements(primary_role)
    return bool(needed) and all(requirement_status(requirement, rows) == "verified" for requirement in needed)


# ---------------------------------------------------------------------------
# users.verification_status (CHECK: PENDING, APPROVED or REJECTED)
# ---------------------------------------------------------------------------
# The verified badge (badges.is_verified) reads APPROVED.
PENDING = "PENDING"
APPROVED = "APPROVED"
REJECTED = "REJECTED"


def moment(value) -> datetime | None:
    """A stored timestamp as an aware datetime (UTC when it has no offset); None for anything else."""
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value))
        except (TypeError, ValueError):
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
