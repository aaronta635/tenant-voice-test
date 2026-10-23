"""How complete a tenant's renter profile is. This is the only place it is worked out (R14, R19).

The rows are those of the reference's Rental Profile page
(output/references/onboarding/profile-completion.md) without its optional
ones: the eight required rows share 70 % of the score and the seven
boosters 30 %, rounded half up. Every required row done is "ready" (the
reference's Ready to share), four or more "almost_ready" and fewer
"started".

A row is done from what the server holds: the users row, the tenant's
details (profiles.tenant_details), their profile_documents and the property
reviews they wrote. A document counts once uploaded, until a reviewer
rejects it. A person keeps one document of each type, so a payslip and an
employment contract share the one OTHER document (the documents panel's
"Other document (for example a payslip or contract)"): the reference's
Payslips and Employment contract rows are one booster here, done once that
document is marked as either (metadata.web_type, documents.KINDS). Its key
stays payslips, which the completion page places. The reference scorecards
are not built yet (R43), so their rows are unavailable and never done:
until they are, the score stops short of 100. profiles.py stores the score
in tenant_profiles.completion_score.
"""

import math
from dataclasses import dataclass
from fractions import Fraction

REQUIRED_SHARE = 70
BOOSTER_SHARE = 30
# Required rows done for "almost_ready"; all of them make "ready".
ALMOST_READY = 4

PRIMARY_ID_TYPES = frozenset({"PASSPORT", "DRIVERS_LICENCE", "GOVERNMENT_PHOTO_ID"})
IDENTITY_TYPES = PRIMARY_ID_TYPES | {"MEDICARE_CARD", "BIRTH_CERTIFICATE", "VEHICLE_REGISTRATION"}
ADDRESS_PROOF_TYPES = frozenset({"UTILITY_BILL", "BANK_STATEMENT", "RENT_LEDGER", "RENT_RECEIPT"})
INCOME_TYPES = frozenset({"BANK_STATEMENT", "CENTRELINK_STATEMENT"})
# profile_documents.metadata.web_type of the OTHER document.
PAYSLIP = "payslip"
EMPLOYMENT_CONTRACT = "employment_contract"
# Employment types that come with an employer (or, self-employed, a business).
WORKING_TYPES = frozenset({"full_time", "part_time", "self_employed", "contractor", "working_holiday"})


@dataclass(frozen=True)
class Item:
    key: str
    label: str
    description: str
    kind: str  # "required" or "booster"
    available: bool = True


ITEMS = (
    Item("personal_details", "Personal details", "Your full name and a phone number.", "required"),
    Item("employment", "Employment", "Your employment type, and your employer if you work.", "required"),
    Item("primary_id", "Primary ID document", "A passport, driver licence or photo ID.", "required"),
    Item("secondary_id", "Secondary ID document", "A second identity document, such as a Medicare card.",
         "required"),
    Item("proof_of_address", "Proof of address", "A utility bill, bank statement or rent ledger.", "required"),
    Item("rental_history", "Rental history", "At least one address you have rented.", "required"),
    Item("property_preferences", "Property preferences", "The property types, suburbs and weekly budget you want.",
         "required"),
    Item("availability", "Availability", "The date you can move in.", "required"),
    Item("income_documents", "Income documents", "Payslips, bank statements, a Centrelink statement or a contract.",
         "booster"),
    Item("payslips", "Payslip or employment contract",
         "Your other document, marked as a recent payslip or your employment contract.", "booster"),
    Item("bank_statements", "Bank statements", "Statements that show a steady income.", "booster"),
    Item("owner_reference", "Owner or agent reference", "A scorecard from a previous owner or agent.", "booster",
         available=False),
    Item("employer_reference", "Employer reference", "A scorecard from your current employer.", "booster",
         available=False),
    Item("property_review", "Review a previous rental", "Your experience of a property you rented.", "booster"),
    Item("received_references", "Received tenant references", "Verified scorecards from owners or agents.",
         "booster", available=False),
)


def completion(user: dict, tenant: dict, documents: list[dict], reviewed_a_property: bool) -> dict:
    """The tenant's completion as ProfileCompletionOut.

    user is the users row, tenant the details as profiles.tenant_details()
    reads them, and documents the tenant's profile_documents rows (their
    document_type, review_status and web_type).
    """
    done = _done(user, tenant, _uploaded(documents), reviewed_a_property)
    items = [
        {
            "key": item.key,
            "label": item.label,
            "description": item.description,
            "kind": item.kind,
            "done": item.available and done[item.key],
            "available": item.available,
        }
        for item in ITEMS
    ]
    required = [item for item in items if item["kind"] == "required"]
    boosters = [item for item in items if item["kind"] == "booster"]
    required_done = sum(item["done"] for item in required)
    boosters_done = sum(item["done"] for item in boosters)
    share = Fraction(REQUIRED_SHARE * required_done, len(required)) + Fraction(BOOSTER_SHARE * boosters_done,
                                                                              len(boosters))
    if required_done == len(required):
        status = "ready"
    elif required_done >= ALMOST_READY:
        status = "almost_ready"
    else:
        status = "started"
    return {
        "score": math.floor(share + Fraction(1, 2)),
        "status": status,
        "required_done": required_done,
        "required_total": len(required),
        "boosters_done": boosters_done,
        "boosters_total": len(boosters),
        "items": items,
        "missing": [item["key"] for item in items if item["available"] and not item["done"]],
    }


def _uploaded(documents: list[dict]) -> list[tuple[str, str | None]]:
    """(document_type, web_type) of each document a reviewer has not rejected."""
    return [
        (row.get("document_type"), row.get("web_type"))
        for row in documents
        if row.get("review_status") != "REJECTED"
    ]


def _done(user: dict, tenant: dict, documents: list[tuple[str, str | None]], reviewed_a_property: bool) -> dict:
    types = {document_type for document_type, _ in documents}
    web_types = {web_type for document_type, web_type in documents if document_type == "OTHER"}
    employment = tenant["employment"]
    working = set(employment["types"]) & WORKING_TYPES
    preferences = tenant["rental_preferences"]
    primary_id = bool(types & PRIMARY_ID_TYPES)
    return {
        "personal_details": _filled(user.get("full_name")) and _filled(user.get("phone")),
        "employment": bool(employment["types"]) and (not working or _filled(employment["employer"])),
        "primary_id": primary_id,
        "secondary_id": primary_id and len(types & IDENTITY_TYPES) >= 2,
        "proof_of_address": bool(types & ADDRESS_PROOF_TYPES),
        "rental_history": bool(tenant["rental_history"]),
        "property_preferences": bool(preferences["property_types"])
        and bool(tenant["preferred_locations"])
        and tenant["budget_max"] is not None,
        "availability": tenant["move_in_date"] is not None,
        "income_documents": bool(types & INCOME_TYPES) or bool(web_types & {PAYSLIP, EMPLOYMENT_CONTRACT}),
        "payslips": bool(web_types & {PAYSLIP, EMPLOYMENT_CONTRACT}),
        "bank_statements": "BANK_STATEMENT" in types,
        "owner_reference": False,
        "employer_reference": False,
        "property_review": reviewed_a_property,
        "received_references": False,
    }


def _filled(value) -> bool:
    return isinstance(value, str) and bool(value.strip())
