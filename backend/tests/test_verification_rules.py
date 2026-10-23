"""The rule table of documents per role and what verification needs, as review_profile_document counts it."""

import pytest

from app.db import schema
from app.services import verification_rules as rules
from app.services.maps_provider_core import CREDENTIAL_DOCUMENT_TYPES
from tests.fake_rpcs import fa_verification

DOCUMENT_TYPES = set(schema.enum_values("profile_documents", "document_type"))


def doc(document_type, review_status="PENDING", **over):
    return {"document_type": document_type, "review_status": review_status, "is_verified": False, **over}


def test_every_type_the_table_names_is_a_shared_document_type():
    named = set(rules.DOCUMENT_TYPES) | {t for types in rules.ROLE_DOCUMENT_TYPES.values() for t in types}
    named |= {t for types in rules.REQUIRED_TYPES.values() for t in types}
    assert named <= DOCUMENT_TYPES
    assert set(rules.GROUP_LABELS) == {info.group for info in rules.DOCUMENT_TYPES.values()}


def test_the_required_types_are_the_ones_review_profile_document_counts():
    """The stand-in is written from the function's body: both apps count the same documents."""
    assert rules.REQUIRED_TYPES == {
        **fa_verification.REQUIRED_TYPES, "SERVICE_PROVIDER": fa_verification.OTHER_REQUIRED_TYPES,
    }
    assert set(rules.REQUIRED_TYPES) == set(fa_verification.REVIEWABLE_ROLES)


def test_each_role_keeps_the_agreed_types():
    assert set(rules.allowed_types("tenant")) == {
        "GOVERNMENT_PHOTO_ID", "PASSPORT", "DRIVERS_LICENCE", "MEDICARE_CARD", "BANK_STATEMENT",
        "CENTRELINK_STATEMENT", "UTILITY_BILL", "RENT_LEDGER", "RENT_RECEIPT", "WRITTEN_REFERENCE",
        "POLICE_CHECK", "OTHER",
    }
    # A landlord's and a provider's photo ID counts as a government photo ID only, so that is the one offered.
    assert rules.allowed_types("landlord") == (
        "GOVERNMENT_PHOTO_ID", "PROOF_OF_PROPERTY_OWNERSHIP", "PROPERTY_MANAGEMENT_AUTHORITY", "OTHER",
    )
    assert set(rules.allowed_types("service_provider")) == set(CREDENTIAL_DOCUMENT_TYPES) - {
        "PASSPORT", "DRIVERS_LICENCE"}
    for role in ("admin", "officer", "unknown"):
        assert rules.allowed_types(role) == ()


@pytest.mark.parametrize("role, primary_role", [
    ("tenant", "TENANT"), ("landlord", "LANDLORD"), ("service_provider", "SERVICE_PROVIDER"),
])
def test_every_required_type_is_one_its_role_keeps(role, primary_role):
    assert rules.counted_types(primary_role) <= set(rules.allowed_types(role))


def test_the_other_document_is_one_slot_for_a_payslip_or_a_contract():
    assert rules.DOCUMENT_TYPES["OTHER"].label == "Other document (for example a payslip or contract)"


def test_the_requirements_per_role():
    assert [(r.key, r.label, r.any_of) for r in rules.requirements("TENANT")] == [
        ("passport", "Passport", ("PASSPORT",)),
        ("drivers_licence", "Driver licence", ("DRIVERS_LICENCE",)),
        ("medicare_card", "Medicare card", ("MEDICARE_CARD",)),
    ]
    assert [r.key for r in rules.requirements("LANDLORD")] == ["photo_id", "proof_of_ownership"]
    # Every provider needs a trade licence, whatever its category.
    assert [r.key for r in rules.requirements("SERVICE_PROVIDER")] == [
        "photo_id", "trade_licence", "public_liability"]
    # The shared functions review no other role.
    for primary_role in ("AGENT", "ADMIN", "REGULATOR", None):
        assert rules.requirements(primary_role) == ()
        assert rules.counted_types(primary_role) == frozenset()


def test_an_approved_document_meets_a_requirement_before_one_in_review_or_rejected():
    status = rules.requirement_status
    [passport, *_] = rules.requirements("TENANT")
    assert status(passport, []) == "missing"
    assert status(passport, [doc("DRIVERS_LICENCE", "APPROVED")]) == "missing"
    assert status(passport, [doc("PASSPORT", "REJECTED")]) == "rejected"
    assert status(passport, [doc("PASSPORT")]) == "pending"
    assert status(passport, [doc("PASSPORT", "APPROVED")]) == "verified"
    # A row verified before review_status existed counts as approved.
    assert status(passport, [doc("PASSPORT", is_verified=True)]) == "verified"


def test_an_account_meets_its_requirements_only_with_every_required_type_approved():
    met = rules.requirements_met
    tenant = [doc("PASSPORT", "APPROVED"), doc("DRIVERS_LICENCE", "APPROVED"), doc("MEDICARE_CARD", "APPROVED")]
    assert met("TENANT", tenant)
    assert not met("TENANT", tenant[:2])
    assert not met("TENANT", [*tenant[:2], doc("MEDICARE_CARD")])
    # A landlord's passport is not the government photo ID the function counts.
    assert not met("LANDLORD", [doc("PASSPORT", "APPROVED"), doc("PROOF_OF_PROPERTY_OWNERSHIP", "APPROVED")])
    assert met("LANDLORD", [doc("GOVERNMENT_PHOTO_ID", "APPROVED"), doc("PROOF_OF_PROPERTY_OWNERSHIP", "APPROVED")])
    # A role with no requirements is never met.
    assert not met("AGENT", tenant)
