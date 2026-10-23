"""The lease functions' stand-ins and the lease tables' rules (tests/fake_rpcs/fb_tenancy.py), as their SQL has them.

Each test calls a stand-in through the caller's own client, or writes a table
with the rules installed, and checks what output/shared-catalog says the
database does: functions/<name>.sql, triggers.md, constraints.md, indexs.md
and the storage policies in policys.md.
"""

import pytest
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client, user_client
from tests.factories_tenancy import AUTH, OTHER_TENANT, OWNER, STRANGER, TENANT, TOKEN, seed_approved, seed_parties
from tests.fake_rpcs import fb_tenancy

AGREEMENT = "e0000000-0000-4000-8000-000000000001"
DOCUMENT = "e0000000-0000-4000-8000-000000000002"
SHA = "a" * 64


@pytest.fixture
def db(fake_db, monkeypatch):
    fb_tenancy.install(monkeypatch)
    seed_parties(fake_db)
    return fake_db


@pytest.fixture
def approved(db):
    return seed_approved(db)


def _call(db, person, name, **params):
    client = user_client(TOKEN[person]) if person else get_supabase_client()
    return client.rpc(name, params).execute().data


def _refused(call) -> APIError:
    with pytest.raises(APIError) as caught:
        call()
    return caught.value


def _agreement(db, approved, **over) -> dict:
    row = {"id": AGREEMENT, "application_id": approved["application"], "listing_id": approved["listing"],
           "tenant_user_id": TENANT, "owner_user_id": OWNER, "rent_amount": 650, "rent_frequency": "WEEKLY",
           "start_date": "2026-11-15", "first_due_date": "2026-11-15", "status": "DRAFT", **over}
    db.seed("rent_agreements", [row])
    return row


def _document(db, path=None, **over) -> dict:
    row = {"id": DOCUMENT, "agreement_id": AGREEMENT, "storage_path": path or f"{AGREEMENT}/lease.pdf",
           "original_filename": "lease.pdf", "uploaded_by_user_id": OWNER, **over}
    db.seed("tenant_lease_documents", [row])
    return row


def _tenant_signature(**over) -> dict:
    return {"agreement_id": AGREEMENT, "document_id": DOCUMENT, "signer_user_id": TENANT, "signer_name": "Tanya Tenant",
            "consent_text": "I have read the lease PDF and I agree to its terms.", "consent_version": "v1",
            "document_storage_path": f"{AGREEMENT}/lease.pdf", "document_sha256": SHA, **over}


def _owner_signature(tenant_signature_id: str, **over) -> dict:
    return {"agreement_id": AGREEMENT, "tenant_signature_id": tenant_signature_id, "document_id": DOCUMENT,
            "owner_user_id": OWNER, "signer_name": "Olivia Owner", "consent_text": "I have read the lease PDF the tenant signed and agree.",
            "consent_version": "v1", "document_storage_path": f"{AGREEMENT}/lease.pdf", "document_sha256": SHA, **over}


def _insert(db, table: str, row: dict) -> dict:
    return get_supabase_client().table(table).insert(row).execute().data[0]


def _signed(db, approved) -> tuple[dict, dict]:
    _agreement(db, approved, tenant_confirmed_at="2026-10-23T00:00:00+00:00")
    _document(db)
    tenant = _insert(db, "tenant_lease_signatures", _tenant_signature())
    return tenant, _insert(db, "rent_agreement_owner_signatures", _owner_signature(tenant["id"]))


# -- mobile_create_rent_agreement_draft ------------------------------------------------------
DRAFT = {"p_rent_amount": 650, "p_rent_frequency": " weekly ", "p_start_date": "2026-11-15",
         "p_first_due_date": "2026-11-15", "p_end_date": None}


def test_a_draft_takes_the_applicant_and_the_owner_from_the_application(db, approved):
    agreement_id = _call(db, OWNER, "mobile_create_rent_agreement_draft",
                         p_application_id=approved["application"], **DRAFT)

    [row] = db.tables["rent_agreements"]
    assert row["id"] == agreement_id
    assert (row["tenant_user_id"], row["owner_user_id"], row["rent_frequency"], row["status"], row["currency"]) == (
        TENANT, OWNER, "WEEKLY", "DRAFT", "AUD")


@pytest.mark.parametrize("change, message", [
    ({"p_rent_amount": 0}, "Enter a valid rent amount."),
    ({"p_rent_amount": 650.555}, "Enter a valid rent amount."),
    ({"p_rent_amount": 10_000_000_000}, "Enter a valid rent amount."),
    ({"p_rent_frequency": "DAILY"}, "Invalid rent frequency."),
    # trim() takes spaces only.
    ({"p_rent_frequency": "\tWEEKLY"}, "Invalid rent frequency."),
    ({"p_rent_frequency": "weekly\n"}, "Invalid rent frequency."),
    ({"p_start_date": None}, "Start date and first due date are required."),
    ({"p_end_date": "2026-11-01"}, "End date cannot precede start date."),
])
def test_a_draft_refuses_terms_as_the_function_does(db, approved, change, message):
    error = _refused(lambda: _call(db, OWNER, "mobile_create_rent_agreement_draft",
                                   p_application_id=approved["application"], **{**DRAFT, **change}))

    assert (error.code, error.message) == ("P0001", message)
    assert db.tables.get("rent_agreements", []) == []


@pytest.mark.parametrize("person, status", [(None, "APPROVED"), (STRANGER, "APPROVED"), (TENANT, "APPROVED"),
                                            (OWNER, "SHORTLISTED")])
def test_a_draft_is_only_the_owners_of_an_approved_application(db, approved, person, status):
    next(row for row in db.tables["rental_applications"])["status"] = status

    error = _refused(lambda: _call(db, person, "mobile_create_rent_agreement_draft",
                                   p_application_id=approved["application"], **DRAFT))

    assert error.message in ("Please sign in first.", "Approved application not available for this owner.")
    assert db.tables.get("rent_agreements", []) == []


def test_one_agreement_per_application(db, approved):
    _call(db, OWNER, "mobile_create_rent_agreement_draft", p_application_id=approved["application"], **DRAFT)

    error = _refused(lambda: _call(db, OWNER, "mobile_create_rent_agreement_draft",
                                   p_application_id=approved["application"], **DRAFT))

    assert error.code == "23505" and "rent_agreements_application_id_key" in error.message


# -- mobile_register_tenant_lease_document and the bucket -------------------------------------------
def _upload(db, person, path, data=b"%PDF-1.4", content_type="application/pdf"):
    storage = fb_tenancy.LeaseStorage(db, TOKEN[person] if person else None)
    return storage.storage.from_(fb_tenancy.BUCKET).upload(path, data, {"content-type": content_type, "upsert": "false"})


def test_registering_needs_a_pdf_the_caller_uploaded(db, approved):
    _agreement(db, approved)
    path = f"{AGREEMENT}/lease.pdf"
    _upload(db, OWNER, path)

    document_id = _call(db, OWNER, "mobile_register_tenant_lease_document", p_agreement_id=AGREEMENT,
                        p_storage_path=path, p_original_filename=" lease.pdf")

    [row] = db.tables["tenant_lease_documents"]
    assert (row["id"], row["original_filename"], row["uploaded_by_user_id"]) == (document_id, "lease.pdf", OWNER)
    assert fb_tenancy.object_meta(db)[(fb_tenancy.BUCKET, path)]["owner_id"] == AUTH[OWNER]
    # notify_tenant_after_lease_document_upload
    assert [(n["user_id"], n["link"]) for n in db.tables["notifications"]] == [
        (TENANT, f"/documents/lease-ready/{AGREEMENT}/{document_id}")]


@pytest.mark.parametrize("uploader", [None, OTHER_TENANT])
def test_a_pdf_someone_else_stored_is_not_registered(db, approved, uploader):
    _agreement(db, approved)
    path = f"{AGREEMENT}/lease.pdf"
    db.storage.objects[(fb_tenancy.BUCKET, path)] = b"%PDF-1.4"
    fb_tenancy.object_meta(db)[(fb_tenancy.BUCKET, path)] = {
        "owner_id": AUTH[uploader] if uploader else None, "mimetype": "application/pdf"}

    error = _refused(lambda: _call(db, OWNER, "mobile_register_tenant_lease_document", p_agreement_id=AGREEMENT,
                                   p_storage_path=path, p_original_filename="lease.pdf"))

    assert error.message == "Uploaded PDF was not found or is not authorised."


@pytest.mark.parametrize("path, filename, message", [
    (f"{AGREEMENT}/lease.txt", "lease.pdf", "Invalid lease document path."),
    (f"{AGREEMENT}/a/lease.pdf", "lease.pdf", "Invalid lease document path."),
    ("e0000000-0000-4000-8000-000000000009/lease.pdf", "lease.pdf", "Invalid lease document path."),
    (f"{AGREEMENT}/lease.pdf", "lease.doc", "Invalid PDF filename."),
    (f"{AGREEMENT}/lease.pdf", "a/lease.pdf", "Invalid PDF filename."),
    (f"{AGREEMENT}/lease.pdf", "   ", "Invalid PDF filename."),
    (f"{AGREEMENT}/lease.pdf", "x" * 197 + ".pdf", "Invalid PDF filename."),
    # ~* '\.pdf$' does not match before a final newline.
    (f"{AGREEMENT}/lease.pdf\n", "lease.pdf", "Invalid lease document path."),
    (f"{AGREEMENT}/lease.pdf", "lease.pdf\n", "Invalid PDF filename."),
])
def test_registering_checks_the_path_and_the_name(db, approved, path, filename, message):
    _agreement(db, approved)

    error = _refused(lambda: _call(db, OWNER, "mobile_register_tenant_lease_document", p_agreement_id=AGREEMENT,
                                   p_storage_path=path, p_original_filename=filename))

    assert error.message == message


@pytest.mark.parametrize("person, over", [
    (STRANGER, {}), (TENANT, {}), (OWNER, {"tenant_confirmed_at": "2026-10-23T00:00:00+00:00"}),
    (OWNER, {"status": "CANCELLED"}),
])
def test_only_the_owner_of_an_unconfirmed_draft_registers_a_pdf(db, approved, person, over):
    _agreement(db, approved, **over)

    error = _refused(lambda: _call(db, person, "mobile_register_tenant_lease_document", p_agreement_id=AGREEMENT,
                                   p_storage_path=f"{AGREEMENT}/lease.pdf", p_original_filename="lease.pdf"))

    assert error.message == "Agreement unavailable for document upload."


@pytest.mark.parametrize("person, path, over, allowed", [
    (OWNER, f"{AGREEMENT}/lease.pdf", {}, True),
    (None, f"{AGREEMENT}/lease.pdf", {"tenant_confirmed_at": "2026-10-23T00:00:00+00:00"}, True),
    (STRANGER, f"{AGREEMENT}/lease.pdf", {}, False),
    (OWNER, f"{AGREEMENT}/nested/lease.pdf", {}, False),
    (OWNER, f"{AGREEMENT}/lease.png", {}, False),
    (OWNER, f"{AGREEMENT}/lease.pdf", {"tenant_confirmed_at": "2026-10-23T00:00:00+00:00"}, False),
    (OWNER, f"{AGREEMENT}/lease.pdf", {"status": "ACTIVE", "activated_at": "2026-10-23T00:00:00+00:00"}, False),
])
def test_the_bucket_takes_a_pdf_only_from_the_owner_of_an_unconfirmed_draft(db, approved, person, path, over, allowed):
    _agreement(db, approved, **over)

    if allowed:
        _upload(db, person, path)
        assert (fb_tenancy.BUCKET, path) in db.storage.objects
    else:
        with pytest.raises(Exception, match="row-level security"):
            _upload(db, person, path)


def test_the_bucket_keeps_its_limits_and_never_overwrites(db, approved):
    _agreement(db, approved)
    path = f"{AGREEMENT}/lease.pdf"

    with pytest.raises(Exception, match="not supported"):
        _upload(db, OWNER, path, content_type="text/plain")
    with pytest.raises(Exception, match="maximum allowed size"):
        _upload(db, OWNER, path, data=b"0" * (10 * 1024 * 1024 + 1))
    _upload(db, OWNER, path)
    with pytest.raises(Exception, match="already exists"):
        _upload(db, OWNER, path, data=b"%PDF-1.4 other")
    assert fb_tenancy.LeaseStorage(db, TOKEN[OWNER]).storage.from_(fb_tenancy.BUCKET).remove([path]) == []


# -- mobile_tenant_confirm_rent_agreement -------------------------------------------------------
def test_the_tenant_confirms_once(db, approved):
    _agreement(db, approved)

    assert _call(db, TENANT, "mobile_tenant_confirm_rent_agreement", p_agreement_id=AGREEMENT) == AGREEMENT
    error = _refused(lambda: _call(db, TENANT, "mobile_tenant_confirm_rent_agreement", p_agreement_id=AGREEMENT))

    assert db.tables["rent_agreements"][0]["tenant_confirmed_at"] is not None
    assert error.message == "Agreement unavailable for confirmation."


@pytest.mark.parametrize("person, application_status", [(OWNER, "APPROVED"), (OTHER_TENANT, "APPROVED"),
                                                        (TENANT, "WITHDRAWN")])
def test_only_the_approved_applicant_confirms(db, approved, person, application_status):
    _agreement(db, approved)
    db.tables["rental_applications"][0]["status"] = application_status

    error = _refused(lambda: _call(db, person, "mobile_tenant_confirm_rent_agreement", p_agreement_id=AGREEMENT))

    assert error.message == "Agreement unavailable for confirmation."
    assert db.tables["rent_agreements"][0]["tenant_confirmed_at"] is None


# -- the signatures' guards -------------------------------------------------------------------
def test_a_tenant_signature_is_the_tenants_on_the_latest_pdf_of_a_draft(db, approved):
    _agreement(db, approved)
    _document(db)
    _document(db, path=f"{AGREEMENT}/newer.pdf", id="e0000000-0000-4000-8000-000000000003",
              created_at="2030-01-01T00:00:00+00:00")

    stale = _refused(lambda: _insert(db, "tenant_lease_signatures", _tenant_signature()))
    by_owner = _refused(lambda: _insert(db, "tenant_lease_signatures", _tenant_signature(signer_user_id=OWNER)))

    assert (stale.code, stale.message) == ("P0001", "Lease document has changed; review the latest PDF")
    assert by_owner.message == "Signer is not the agreement tenant"
    assert db.tables.get("tenant_lease_signatures", []) == []


@pytest.mark.parametrize("change, constraint", [
    ({"signer_name": " T "}, "tenant_lease_signatures_signer_name_check"),
    ({"document_sha256": "XYZ"}, "tenant_lease_signatures_document_sha256_check"),
    ({"signing_method": "DRAWN"}, "tenant_lease_signatures_signing_method_check"),
])
def test_a_tenant_signature_keeps_its_checks(db, approved, change, constraint):
    _agreement(db, approved)
    _document(db)

    error = _refused(lambda: _insert(db, "tenant_lease_signatures", _tenant_signature(**change)))

    assert (error.code, constraint in error.message) == ("23514", True)


def test_one_tenant_signature_per_agreement_and_none_to_edit(db, approved):
    _agreement(db, approved)
    _document(db)
    signature = _insert(db, "tenant_lease_signatures", _tenant_signature())

    again = _refused(lambda: _insert(db, "tenant_lease_signatures", _tenant_signature()))
    edit = _refused(lambda: get_supabase_client().table("tenant_lease_signatures").update(
        {"signer_name": "Someone Else"}).eq("id", signature["id"]).execute())

    assert again.code == "23505" and "one_tenant_signature_per_agreement" in again.message
    assert edit.message == "Recorded signatures cannot be edited or deleted"
    # notify_owner_after_tenant_lease_signature, once.
    assert [(n["user_id"], n["link"]) for n in db.tables["notifications"]] == [
        (OWNER, f"/applications/lease-signed/{AGREEMENT}")]


def test_no_pdf_is_registered_after_signing(db, approved):
    _agreement(db, approved)
    _document(db)
    _insert(db, "tenant_lease_signatures", _tenant_signature())

    error = _refused(lambda: _insert(db, "tenant_lease_documents", {
        "agreement_id": AGREEMENT, "storage_path": f"{AGREEMENT}/late.pdf", "original_filename": "late.pdf",
        "uploaded_by_user_id": OWNER}))

    assert error.message == "Cannot register documents after lease signing"


@pytest.mark.parametrize("change, message", [
    ({"document_sha256": "b" * 64}, "Owner and tenant signatures must reference the same PDF"),
    ({"owner_user_id": STRANGER}, "Signer is not the agreement owner"),
])
def test_the_owner_signs_the_tenants_pdf_or_nothing(db, approved, change, message):
    _agreement(db, approved)
    _document(db)
    tenant = _insert(db, "tenant_lease_signatures", _tenant_signature())

    error = _refused(lambda: _insert(db, "rent_agreement_owner_signatures", _owner_signature(tenant["id"], **change)))

    assert error.message == message


def test_the_owner_signs_after_the_tenant_with_a_consent_of_twenty_characters(db, approved):
    _agreement(db, approved)
    _document(db)

    early = _refused(lambda: _insert(db, "rent_agreement_owner_signatures",
                                     _owner_signature("e0000000-0000-4000-8000-000000000009")))
    tenant = _insert(db, "tenant_lease_signatures", _tenant_signature())
    short = _refused(lambda: _insert(db, "rent_agreement_owner_signatures",
                                     _owner_signature(tenant["id"], consent_text="I agree.")))

    assert early.message == "Tenant must sign before the owner"
    assert short.code == "23514" and "rent_agreement_owner_signatures_consent_text_check" in short.message


# -- activation ------------------------------------------------------------------------------
def test_the_owner_activates_a_lease_with_matching_signatures(db, approved):
    _signed(db, approved)

    assert _call(db, OWNER, "mobile_owner_activate_rent_agreement", p_agreement_id=AGREEMENT) == AGREEMENT

    [row] = db.tables["rent_agreements"]
    assert row["status"] == "ACTIVE" and row["activated_at"] is not None
    assert [(n["user_id"], n["link"]) for n in db.tables["notifications"] if n["user_id"] == TENANT] == [
        (TENANT, f"/agreements/activated/{AGREEMENT}")]


@pytest.mark.parametrize("person", [TENANT, STRANGER, None])
def test_only_the_owner_activates(db, approved, person):
    _signed(db, approved)

    error = _refused(lambda: _call(db, person, "mobile_owner_activate_rent_agreement", p_agreement_id=AGREEMENT))

    assert error.message in ("Authentication required.", "Activation requires an approved application, active owner "
                             "and matching tenant and owner signatures.")
    assert db.tables["rent_agreements"][0]["status"] == "DRAFT"


def test_no_activation_without_both_signatures_even_written_directly(db, approved):
    _agreement(db, approved)
    _document(db)
    _insert(db, "tenant_lease_signatures", _tenant_signature())

    by_function = _refused(lambda: _call(db, OWNER, "mobile_owner_activate_rent_agreement", p_agreement_id=AGREEMENT))
    direct = _refused(lambda: get_supabase_client().table("rent_agreements").update(
        {"status": "ACTIVE", "activated_at": "2026-10-23T00:00:00+00:00"}).eq("id", AGREEMENT).execute())
    born_active = _refused(lambda: _insert(db, "rent_agreements", {
        "application_id": seed_approved(db, tenant=OTHER_TENANT)["application"], "listing_id": approved["listing"],
        "tenant_user_id": OTHER_TENANT, "owner_user_id": OWNER, "rent_amount": 650, "rent_frequency": "WEEKLY",
        "start_date": "2026-11-15", "first_due_date": "2026-11-15", "status": "ACTIVE",
        "activated_at": "2026-10-23T00:00:00+00:00"}))

    assert by_function.message.startswith("Activation requires")
    assert direct.message == "Cannot activate agreement without matching tenant and owner signatures."
    assert born_active.message == "New rental agreements cannot start as ACTIVE."


def test_signed_terms_cannot_change_and_a_signed_agreement_stays(db, approved):
    _signed(db, approved)
    agreements = get_supabase_client().table("rent_agreements")

    edit = _refused(lambda: agreements.update({"rent_amount": 600}).eq("id", AGREEMENT).execute())
    delete = _refused(lambda: get_supabase_client().table("rent_agreements").delete().eq("id", AGREEMENT).execute())

    assert edit.message == "Agreed rental terms cannot change after signing"
    assert delete.message == "A signed rental agreement cannot be deleted"


def test_a_stand_in_needs_no_installed_rules(fake_db, monkeypatch):
    """The stand-ins apply the triggers to their own writes, whether or not a test installed the rules."""
    seed_parties(fake_db)
    approved = seed_approved(fake_db)
    _agreement(fake_db, approved)
    path = f"{AGREEMENT}/lease.pdf"
    _upload(fake_db, OWNER, path)

    _call(fake_db, OWNER, "mobile_register_tenant_lease_document", p_agreement_id=AGREEMENT, p_storage_path=path,
          p_original_filename="lease.pdf")

    assert [n["user_id"] for n in fake_db.tables["notifications"]] == [TENANT]
