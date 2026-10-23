"""The shared database's triggers, as the strict fake runs them with the catalog rules on (tests/fake_triggers.py).

Each trigger has a case it lets through and one it refuses (or, for a
notice, one it sends and one it does not), written from its function's body
in output/shared-catalog/functions.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from tests.factories_catalog import (
    AGREEMENT, APPLICATION, DOCUMENT, LISTING, NOW, OTHER_LISTING, OWNER, OWNER_SIGNATURE, PROPERTY, SHA, SIGNATURE,
    TENANT, agreement, fails, home, lease_document, listing, owner_signature, tenant_signature, user,
)

MANAGER = "a1000000-0000-4000-8000-000000000003"
ADMIN = "a1000000-0000-4000-8000-000000000004"
SECOND_DOCUMENT = "f3000000-0000-4000-8000-000000000002"
EVIDENCE_PATH = f"{AGREEMENT}/lease-with-signing-evidence.pdf"


@pytest.fixture
def db(fake_db):
    fake_db.catalog_rules = True
    return fake_db


@pytest.fixture
def lease(db):
    """A home with the owner's draft rent agreement for the tenant."""
    home(db)
    db.seed("rent_agreements", [agreement()])
    return db


def _notices(db, user_id=None) -> list[tuple[str, str]]:
    return [(row["title"], row["link"]) for row in db.tables.get("notifications", [])
            if user_id is None or row["user_id"] == user_id]


def _signed(db) -> None:
    """The tenant and then the owner sign the agreement's only PDF."""
    db.table("tenant_lease_documents").insert(lease_document()).execute()
    db.table("tenant_lease_signatures").insert(tenant_signature()).execute()
    db.table("rent_agreement_owner_signatures").insert(owner_signature()).execute()


def _agreement_row(db) -> dict:
    return db.tables["rent_agreements"][0]


# -- listings and applications ------------------------------------------------------
def test_a_listing_moves_only_along_its_lifecycle(db):
    home(db)
    listings = db.table

    listings("listings").update({"status": "PAUSED"}).eq("id", LISTING).execute()
    listings("listings").update({"status": "PAUSED", "title": "Same status"}).eq("id", LISTING).execute()

    fails("22023", listings("listings").update({"status": "DRAFT"}).eq("id", LISTING),
          "Invalid listing status transition: PAUSED -> DRAFT")
    assert db.tables["listings"][0]["status"] == "PAUSED"


def test_an_application_moves_only_along_its_lifecycle(db):
    home(db)
    applications = db.table

    for status in ("UNDER_REVIEW", "WITHDRAWN"):
        applications("rental_applications").update({"status": status}).eq("id", APPLICATION).execute()
    fails("22023", applications("rental_applications").update({"status": "APPROVED"}).eq("id", APPLICATION),
          "Invalid application status transition: WITHDRAWN -> APPROVED")
    applications("rental_applications").update({"status": "SUBMITTED"}).eq("id", APPLICATION).execute()


def test_an_approval_needs_its_listing_leased_when_the_request_commits(db):
    home(db)

    fails("23514", db.table("rental_applications").update({"status": "APPROVED"}).eq("id", APPLICATION),
          "An approved application requires a leased or archived listing")
    assert db.tables["rental_applications"][0]["status"] == "SUBMITTED"  # the request is undone

    with db.strict.transaction():  # one request, as review_rental_application runs both
        db.table("rental_applications").update({"status": "APPROVED"}).eq("id", APPLICATION).execute()
        db.table("listings").update({"status": "LEASED"}).eq("id", LISTING).execute()
    assert (db.tables["rental_applications"][0]["status"], db.tables["listings"][0]["status"]) == (
        "APPROVED", "LEASED")


def test_a_leased_listing_needs_exactly_one_approved_application(db):
    home(db)

    fails("23514", db.table("listings").update({"status": "LEASED"}).eq("id", LISTING),
          "A leased listing must have exactly one approved application")
    fails("23514", db.table("listings").insert(listing(OTHER_LISTING, status="LEASED")),
          "A leased listing must have exactly one approved application")
    db.table("listings").insert(listing(OTHER_LISTING, status="DRAFT")).execute()


def test_only_the_owner_or_manager_of_the_property_creates_its_listing(db):
    home(db)
    db.seed("users", [user(MANAGER, primary_role="AGENT")])
    db.table("properties").update({"manager_user_id": MANAGER}).eq("id", PROPERTY).execute()

    fails("23514", db.table("listings").insert(listing(OTHER_LISTING, created_by_user_id=TENANT)),
          "Listing creator must own or manage the property")
    db.table("listings").insert(listing(OTHER_LISTING, created_by_user_id=MANAGER)).execute()
    db.table("properties").update({"manager_user_id": None}).eq("id", PROPERTY).execute()

    # The guard runs only for an update that sets property_id or created_by_user_id (UPDATE OF).
    db.table("listings").update({"title": "Renamed"}).eq("id", OTHER_LISTING).execute()
    fails("23514", db.table("listings").update({"created_by_user_id": MANAGER}).eq("id", OTHER_LISTING),
          "Listing creator must own or manage the property")


def test_a_conversation_names_an_application_of_its_own_listing(db):
    home(db)
    db.seed("listings", [listing(OTHER_LISTING)])

    def conversation(listing_id):
        return {"id": str(uuid.uuid4()), "conversation_type": "APPLICATION", "listing_id": listing_id,
                "application_id": APPLICATION, "updated_at": NOW}

    fails("23514", db.table("conversations").insert(conversation(OTHER_LISTING)),
          "Conversation application_id must belong to conversation listing_id")
    db.table("conversations").insert([conversation(LISTING), conversation(None)]).execute()


# -- roles ----------------------------------------------------------------------------
def test_a_new_user_gets_the_assignment_of_their_primary_role(db):
    db.table("users").insert(user(OWNER, primary_role="LANDLORD")).execute()

    assert [(row["user_id"], row["role"], row["is_primary"]) for row in db.tables["user_role_assignments"]] == [
        (OWNER, "LANDLORD", True)]


def test_changing_the_primary_role_trips_the_one_primary_index_as_on_the_live_database(db):
    # sync_primary_role_assignment adds the new primary assignment before it unmarks the old one.
    db.table("users").insert(user(OWNER)).execute()

    fails("23505", db.table("users").update({"primary_role": "LANDLORD"}).eq("id", OWNER),
          '"user_role_assignments_one_primary_per_user_key"')
    db.table("users").update({"primary_role": "TENANT", "full_name": "Same role"}).eq("id", OWNER).execute()

    assert db.tables["users"][0]["primary_role"] == "TENANT"
    assert [(row["role"], row["is_primary"]) for row in db.tables["user_role_assignments"]] == [("TENANT", True)]


def test_assignments_follow_the_users_primary_role(db):
    db.table("users").insert(user(OWNER)).execute()
    [primary] = db.tables["user_role_assignments"]
    extra = {"id": str(uuid.uuid4()), "user_id": OWNER, "role": "LANDLORD"}

    fails("23514", db.table("user_role_assignments").insert({**extra, "is_primary": True}),
          "Only the assignment matching users.primary_role can be primary")
    db.table("user_role_assignments").insert({**extra, "is_primary": False}).execute()
    fails("23514", db.table("user_role_assignments").update({"is_primary": False}).eq("id", primary["id"]),
          "The assignment matching users.primary_role must be primary")
    fails("23514", db.table("user_role_assignments").delete().eq("id", primary["id"]),
          "The assignment for a user primary role cannot be deleted")
    db.table("users").delete().eq("id", OWNER).execute()  # deleting the user takes its assignments along

    assert db.tables["user_role_assignments"] == []


# -- rent agreements and lease signing ----------------------------------------------------
def test_a_new_agreement_cannot_start_active(db):
    home(db)

    fails("P0001", db.table("rent_agreements").insert(agreement(status="ACTIVE", activated_at=NOW)),
          "New rental agreements cannot start as ACTIVE.")
    db.table("rent_agreements").insert(agreement()).execute()


def test_an_agreement_activates_once_both_parties_signed_the_latest_pdf_and_the_tenant_is_told(lease):
    activate = {"status": "ACTIVE", "activated_at": NOW}

    fails("P0001", lease.table("rent_agreements").update(activate).eq("id", AGREEMENT),
          "Cannot activate agreement without matching tenant and owner signatures.")
    _signed(lease)
    lease.table("rent_agreements").update(activate).eq("id", AGREEMENT).execute()
    # Ending and reactivating it tells nobody twice: the notice's unique index, ON CONFLICT DO NOTHING.
    lease.table("rent_agreements").update({"status": "ENDED"}).eq("id", AGREEMENT).execute()
    lease.table("rent_agreements").update({"status": "ACTIVE"}).eq("id", AGREEMENT).execute()

    assert _agreement_row(lease)["status"] == "ACTIVE"
    assert _notices(lease, TENANT) == [
        ("Lease document ready for review", f"/documents/lease-ready/{AGREEMENT}/{DOCUMENT}"),
        ("Rental agreement activated", f"/agreements/activated/{AGREEMENT}"),
    ]


def test_a_signed_agreement_keeps_its_terms_and_its_row(lease):
    agreements = lease.table

    agreements("rent_agreements").update({"rent_amount": 650}).eq("id", AGREEMENT).execute()  # not signed yet
    lease.table("tenant_lease_documents").insert(lease_document()).execute()
    lease.table("tenant_lease_signatures").insert(tenant_signature()).execute()

    fails("P0001", agreements("rent_agreements").update({"rent_amount": 700}).eq("id", AGREEMENT),
          "Agreed rental terms cannot change after signing")
    agreements("rent_agreements").update({"rent_amount": "650.00", "tenant_confirmed_at": NOW}).eq(
        "id", AGREEMENT).execute()  # the same amount, as numeric compares it
    fails("P0001", agreements("rent_agreements").delete().eq("id", AGREEMENT),
          "A signed rental agreement cannot be deleted")


def test_lease_documents_are_added_before_signing_and_never_changed(lease):
    documents = lease.table
    documents("tenant_lease_documents").insert(lease_document()).execute()

    fails("P0001", documents("tenant_lease_documents").update({"original_filename": "x.pdf"}).eq("id", DOCUMENT),
          "Lease document records cannot be edited or deleted")
    fails("P0001", documents("tenant_lease_documents").delete().eq("id", DOCUMENT),
          "Lease document records cannot be edited or deleted")
    fails("P0001", documents("tenant_lease_documents").insert(lease_document(
        SECOND_DOCUMENT, agreement_id="e1000000-0000-4000-8000-0000000000ff")), "Rental agreement not found")
    lease.table("tenant_lease_signatures").insert(tenant_signature()).execute()
    fails("P0001", documents("tenant_lease_documents").insert(lease_document(SECOND_DOCUMENT, name="v2.pdf")),
          "Cannot register documents after lease signing")


def test_the_tenant_signs_the_latest_pdf_and_the_owner_is_told(lease):
    lease.table("tenant_lease_documents").insert(lease_document()).execute()
    lease.table("tenant_lease_documents").insert(lease_document(SECOND_DOCUMENT, name="v2.pdf")).execute()
    signatures = lease.table

    fails("P0001", signatures("tenant_lease_signatures").insert(tenant_signature()),
          "Lease document has changed; review the latest PDF")
    fails("P0001", signatures("tenant_lease_signatures").insert(
        tenant_signature(SECOND_DOCUMENT, "v2.pdf", signer_user_id=OWNER)), "Signer is not the agreement tenant")
    signatures("tenant_lease_signatures").insert(tenant_signature(SECOND_DOCUMENT, "v2.pdf")).execute()
    fails("P0001", signatures("tenant_lease_signatures").update({"signer_name": "Someone"}).eq("id", SIGNATURE),
          "Recorded signatures cannot be edited or deleted")

    assert _notices(lease, OWNER) == [("Tenant electronically signed a lease",
                                       f"/applications/lease-signed/{AGREEMENT}")]


def test_only_a_draft_agreement_is_signed(db):
    home(db)
    db.seed("rent_agreements", [agreement(status="CANCELLED")])
    db.table("tenant_lease_documents").insert(lease_document()).execute()

    fails("P0001", db.table("tenant_lease_signatures").insert(tenant_signature()),
          "Only draft agreements can be signed")
    assert _notices(db) == []  # nor is the tenant told of a PDF for an agreement past its draft


def test_the_owner_signs_after_the_tenant_and_the_same_pdf(lease):
    lease.table("tenant_lease_documents").insert(lease_document()).execute()
    owners = lease.table

    fails("P0001", owners("rent_agreement_owner_signatures").insert(owner_signature()),
          "Tenant must sign before the owner")
    lease.table("tenant_lease_signatures").insert(tenant_signature()).execute()
    fails("P0001", owners("rent_agreement_owner_signatures").insert(owner_signature(document_sha256="b" * 64)),
          "Owner and tenant signatures must reference the same PDF")
    fails("P0001", owners("rent_agreement_owner_signatures").insert(owner_signature(owner_user_id=TENANT)),
          "Signer is not the agreement owner")
    lease.table("users").update({"status": "SUSPENDED"}).eq("id", OWNER).execute()
    fails("P0001", owners("rent_agreement_owner_signatures").insert(owner_signature()),
          "Active owner account required")
    lease.table("users").update({"status": "ACTIVE"}).eq("id", OWNER).execute()
    owners("rent_agreement_owner_signatures").insert(owner_signature()).execute()

    fails("P0001", owners("rent_agreement_owner_signatures").delete().eq("id", OWNER_SIGNATURE),
          "Recorded owner signatures cannot be edited or deleted")


def test_signing_evidence_needs_the_active_agreements_signatures_and_its_pdf_in_storage(lease):
    _signed(lease)
    lease.table("rent_agreements").update({"status": "ACTIVE", "activated_at": NOW}).eq("id", AGREEMENT).execute()
    evidence = {"agreement_id": AGREEMENT, "source_document_id": DOCUMENT, "tenant_signature_id": SIGNATURE,
                "owner_signature_id": OWNER_SIGNATURE, "storage_path": EVIDENCE_PATH, "source_pdf_sha256": SHA,
                "evidence_pdf_sha256": "c" * 64}
    files = lease.table

    fails("P0001", files("tenant_lease_signature_evidence_files").insert({**evidence, "source_pdf_sha256": "d" * 64}),
          "Agreement and electronic signing evidence do not match")
    fails("P0001", files("tenant_lease_signature_evidence_files").insert(evidence),
          "Generated evidence PDF is not present in Storage")
    lease.storage.from_("tenant-lease-signing-evidence").upload(EVIDENCE_PATH, b"%PDF-1.7", {})
    files("tenant_lease_signature_evidence_files").insert(evidence).execute()


def test_the_tenant_is_told_of_each_pdf_of_an_unsigned_draft(lease):
    lease.table("tenant_lease_documents").insert(lease_document()).execute()
    lease.table("tenant_lease_documents").insert(lease_document(SECOND_DOCUMENT, name="v2.pdf")).execute()

    assert _notices(lease, TENANT) == [
        ("Lease document ready for review", f"/documents/lease-ready/{AGREEMENT}/{DOCUMENT}"),
        ("Lease document ready for review", f"/documents/lease-ready/{AGREEMENT}/{SECOND_DOCUMENT}"),
    ]


# -- rent payments ------------------------------------------------------------------------------
def test_both_parties_are_told_once_of_a_verified_stripe_payment(lease):
    charge = "f6000000-0000-4000-8000-000000000001"
    lease.seed("rent_charges", [{"id": charge, "agreement_id": AGREEMENT, "period_start": "2026-02-01",
                                 "period_end": "2026-02-08", "due_date": "2026-02-01", "amount_due": 600}])
    payments = lease.table
    [stripe] = payments("rent_payments").insert({"charge_id": charge, "amount": 600,
                                                 "provider": "STRIPE"}).execute().data
    payments("rent_payments").insert({"charge_id": charge, "amount": 50, "provider": "MANUAL", "status": "SUCCEEDED",
                                      "verified_at": NOW}).execute()
    assert _notices(lease) == []  # pending, or not Stripe's

    payments("rent_payments").update({"status": "SUCCEEDED", "verified_at": NOW}).eq("id", stripe["id"]).execute()
    payments("rent_payments").update({"verified_at": "2026-01-02T00:00:00+00:00"}).eq("id", stripe["id"]).execute()

    link = f"/payments/verified/{stripe['id']}"
    assert _notices(lease) == [("Rent payment confirmed", link), ("Rent payment received", link)]
    assert {row["body"] for row in lease.tables["notifications"]} == {
        "Stripe payment of A$600.00 has been verified for your rental agreement."}


# -- complaints and red flags -------------------------------------------------------------------
def _complaint(db, property_id=PROPERTY) -> dict:
    return db.table("complaints").insert({"id": str(uuid.uuid4()), "reporter_user_id": TENANT,
                                          "property_id": property_id, "category": "MAINTENANCE",
                                          "description": "The heater is broken."}).execute().data[0]


def _rule(id, **over) -> dict:
    return {"id": id, "rule_key": id, "name": f"Rule {id[:2]}", "threshold_count": 2, "window_days": 30,
            "trigger_mode": "WINDOW", "updated_at": NOW, **over}


def test_a_complaint_reaching_a_rules_threshold_opens_one_red_flag_and_tells_the_active_admins(db):
    home(db)
    db.seed("users", [user(ADMIN, primary_role="ADMIN"),
                      user("a1000000-0000-4000-8000-000000000005", primary_role="ADMIN", status="SUSPENDED"),
                      user("a1000000-0000-4000-8000-000000000006", primary_role="ADMIN", deleted_at=NOW)])
    window = "1a000000-0000-4000-8000-000000000001"
    db.seed("red_flag_rules", [_rule(window), _rule("2a000000-0000-4000-8000-000000000001", is_active=False,
                                                    threshold_count=1)])

    _complaint(db)
    assert db.tables.get("red_flag_events", []) == []
    second = _complaint(db)
    _complaint(db)  # the flag is still open: no second one
    _complaint(db, property_id=None)

    [event] = db.tables["red_flag_events"]
    assert (event["rule_id"], event["property_id"], event["complaint_id"], event["status"]) == (
        window, PROPERTY, second["id"], "OPEN")
    lodged = datetime.fromisoformat(second["lodged_at"])
    assert (event["summary"], event["triggered_at"]) == ("Rule 1a: complaint threshold reached", second["lodged_at"])
    assert event["evidence"] == {
        "details": "2 complaints were recorded for this property within 30 days.", "complaintCount": 2,
        "thresholdCount": 2, "triggerMode": "WINDOW", "windowDays": 30,
        "windowStart": (lodged - timedelta(days=30)).isoformat(), "evaluatedAt": lodged.isoformat()}
    assert [(row["user_id"], row["body"], row["link"]) for row in db.tables["notifications"]] == [
        (ADMIN, "Rule 1a triggered after 2 complaints.", "/admin/red-flags")]


def test_a_resolved_flag_lets_the_next_breach_open_a_new_one(db):
    home(db)
    total = "3a000000-0000-4000-8000-000000000001"
    db.seed("red_flag_rules", [_rule(total, trigger_mode="TOTAL", threshold_count=1)])

    _complaint(db)
    db.table("red_flag_events").update({"status": "RESOLVED"}).eq("rule_id", total).execute()
    _complaint(db)

    assert [(row["status"], row["evidence"]["complaintCount"]) for row in db.tables["red_flag_events"]] == [
        ("RESOLVED", 1), ("OPEN", 2)]
    assert db.tables["red_flag_events"][1]["evidence"]["details"] == (
        "2 complaints have been recorded for this property in total.")


# -- the owner assistant's leases ------------------------------------------------------------------
@pytest.fixture
def signing(db):
    """An owner assistant lease record whose signing has been sent, and an idle one."""
    db.seed("users", [user(OWNER, primary_role="LANDLORD")])
    db.seed("owner_ai_accounts", [{"firebase_uid": "fb-owner", "user_id": OWNER}])
    db.seed("owner_bridge_records", [
        {"id": record, "firebase_uid": "fb-owner", "property_id": "p-1", "kind": "lease", "status": "draft",
         "payload": {"body": "The terms.", "applicationId": "app-1"}} for record in ("rec-sent", "rec-idle")])
    db.seed("owner_lease_signing_jobs", [{"id": str(uuid.uuid4()), "firebase_uid": "fb-owner",
                                          "record_id": "rec-sent", "test_mode": True, "state": "sent",
                                          "body_sha256": SHA, "manifest": {}, "signers": []}])
    return db


def test_a_lease_being_signed_keeps_its_terms(signing):
    records = signing.table

    fails("P0001", records("owner_bridge_records").update({"payload": {"body": "New terms.", "applicationId": "app-1"}})
          .eq("id", "rec-sent"), "agreement_locked_for_signing")
    fails("P0001", records("owner_bridge_records").delete().eq("id", "rec-sent"), "agreement_locked_for_signing")
    fails("P0001", records("owner_bridge_records").update({"status": "signed"}).eq("id", "rec-sent"),
          "agreement_locked_for_signing")
    records("owner_bridge_records").update({"payload": {"body": "Idle terms."}}).eq("id", "rec-idle").execute()

    signing.table("owner_lease_signing_jobs").update({"state": "complete"}).eq("record_id", "rec-sent").execute()
    records("owner_bridge_records").update({"status": "signed"}).eq("id", "rec-sent").execute()  # the completion


def test_a_lease_being_signed_keeps_its_documents(signing):
    def document(record):
        return {"id": str(uuid.uuid4()), "firebase_uid": "fb-owner", "record_id": record, "kind": "bylaws",
                "file_name": "bylaws.pdf", "object_path": f"{record}/bylaws.pdf", "size_bytes": 1024, "sha256": SHA}

    fails("P0001", signing.table("owner_lease_documents").insert(document("rec-sent")),
          "supporting_documents_locked_for_signing")
    signing.table("owner_lease_documents").insert(document("rec-idle")).execute()
