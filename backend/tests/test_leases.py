"""Leases (tracker R26) through the API: drafting, the PDF, confirming, both signatures and activation.

The lease functions run as stand-ins (tests/fake_rpcs/fb_tenancy.py) under the
caller's own token, the lease tables' constraints and triggers apply to every
write (fb_tenancy.install), and tenant-lease-documents keeps each object's
owner and the bucket's policies (fb_tenancy.LeaseStorage).
"""

import base64
import copy
import hashlib
from urllib.parse import unquote

import pytest

from app.core.config import settings
from app.services import leases
from tests.factories_tenancy import (
    ADMIN,
    AUTH,
    MANAGER,
    OTHER_TENANT,
    OWNER,
    PROVIDER,
    STRANGER,
    TENANT,
    as_party,
    seed_approved,
    seed_parties,
)
from tests.fake_rpcs import fb_tenancy
from tests.fake_supabase import api_error

API = "/api/v1/leases"
TERMS = {"rent_amount": 650, "rent_frequency": "WEEKLY", "start_date": "2026-11-15",
         "first_due_date": "2026-11-15", "end_date": "2027-11-14"}
FORM = {"title": "Residential tenancy agreement", "bond_amount": 2600, "payment_details": "Bank transfer to BSB 062-000",
        "max_occupants": 2, "pets_allowed": False, "utilities": "The tenant pays electricity and internet.",
        "special_conditions": "No smoking inside."}
PDF = b"%PDF-1.4\n% an uploaded lease\n%%EOF\n"


@pytest.fixture
def db(fake_db, monkeypatch):
    fb_tenancy.install(monkeypatch)
    fb_tenancy.use_storage(monkeypatch, fake_db)
    seed_parties(fake_db)
    return fake_db


@pytest.fixture
def approved(db):
    return seed_approved(db)


def _draft(client, as_profile, approved, **terms) -> dict:
    as_party(as_profile, OWNER)
    response = client.post(API, json={"application_id": approved["application"], **TERMS, **terms})
    assert response.status_code == 201, response.text
    return response.json()


def _preview(client, as_profile, lease_id: str, **form) -> dict:
    as_party(as_profile, OWNER)
    response = client.post(f"{API}/{lease_id}/document/preview", json={**FORM, **form})
    assert response.status_code == 200, response.text
    return response.json()


def _send(client, as_profile, lease_id: str, **form) -> dict:
    preview = _preview(client, as_profile, lease_id, **form)
    response = client.post(f"{API}/{lease_id}/document", json={**FORM, **form, "preview_sha256": preview["sha256"]})
    assert response.status_code == 200, response.text
    return response.json()


def _confirm(client, as_profile, lease: dict):
    as_party(as_profile, TENANT)
    return client.post(f"{API}/{lease['id']}/confirm", json={"document_id": lease["document"]["id"]})


def _tenant_sign(client, as_profile, lease: dict, name: str = "Tanya Tenant"):
    as_party(as_profile, TENANT)
    return client.post(f"{API}/{lease['id']}/sign",
                       json={"document_id": lease["document"]["id"], "signer_name": name, "agree": True})


def _owner_sign(client, as_profile, lease: dict, name: str = "Olivia Owner"):
    as_party(as_profile, OWNER)
    return client.post(f"{API}/{lease['id']}/owner-signature", json={"signer_name": name, "agree": True})


def _sent(client, as_profile, approved) -> dict:
    return _send(client, as_profile, _draft(client, as_profile, approved)["id"])


def _signed_by_tenant(client, as_profile, approved) -> dict:
    lease = _sent(client, as_profile, approved)
    assert _confirm(client, as_profile, lease).status_code == 200
    response = _tenant_sign(client, as_profile, lease)
    assert response.status_code == 200, response.text
    return response.json()


def _rows(db, table: str) -> list[dict]:
    return db.tables.get(table, [])


def _stored_pdf(db) -> tuple[str, bytes]:
    [(bucket, path)] = [key for key in db.storage.objects if key[0] == leases.BUCKET]
    return path, db.storage.objects[(bucket, path)]


# -- drafting --------------------------------------------------------------------------
def test_the_owner_drafts_an_approved_applications_lease_as_themselves(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)

    [row] = _rows(db, "rent_agreements")
    assert (row["application_id"], row["listing_id"], row["tenant_user_id"], row["owner_user_id"]) == (
        approved["application"], approved["listing"], TENANT, OWNER)
    assert (row["rent_amount"], row["rent_frequency"], row["start_date"], row["first_due_date"], row["end_date"],
            row["status"]) == (650, "WEEKLY", "2026-11-15", "2026-11-15", "2027-11-14", "DRAFT")
    # mobile_create_rent_agreement_draft reads the owner from their own token.
    assert ("mobile_create_rent_agreement_draft", AUTH[OWNER]) in db.rpc_callers
    assert (lease["id"], lease["stage"], lease["status"], lease["viewer_role"]) == (row["id"], "draft", "draft", "owner")
    assert lease["actions"] == {"send_document": True, "confirm": False, "sign": False, "owner_sign": False,
                                "activate": False}
    assert (lease["title"], lease["address"], lease["bond_amount"]) == (
        "Harbour flat", "12 Harbour Street, Unit 4, Wollongong NSW 2500", 2600)
    assert (lease["tenant"]["name"], lease["owner"]["name"]) == ("Tanya Tenant", "Olivia Owner")


def test_a_repeated_draft_answers_with_the_same_draft(client, db, as_profile, approved):
    first = _draft(client, as_profile, approved)

    again = client.post(API, json={"application_id": approved["application"], **TERMS})

    assert again.status_code == 200, again.text
    assert again.json()["id"] == first["id"]
    assert len(_rows(db, "rent_agreements")) == 1


def test_other_terms_for_a_drafted_application_are_a_conflict(client, db, as_profile, approved):
    _draft(client, as_profile, approved)

    response = client.post(API, json={"application_id": approved["application"], **TERMS, "rent_amount": 700})

    assert response.status_code == 409
    assert len(_rows(db, "rent_agreements")) == 1


def test_a_race_that_drafts_first_is_answered_with_its_draft(client, db, as_profile, approved, monkeypatch):
    """Two requests at once: the second read no draft, so its insert hits the unique application; it answers 200."""
    lease = _draft(client, as_profile, approved)
    reads = []
    real = leases._agreement_for

    def first_read_misses(application_id):
        reads.append(application_id)
        return None if len(reads) == 1 else real(application_id)

    monkeypatch.setattr(leases, "_agreement_for", first_read_misses)

    response = client.post(API, json={"application_id": approved["application"], **TERMS})

    assert response.status_code == 200, response.text
    assert response.json()["id"] == lease["id"]
    assert len(_rows(db, "rent_agreements")) == 1


@pytest.mark.parametrize("status", ["SUBMITTED", "SHORTLISTED", "REJECTED", "WITHDRAWN"])
def test_only_an_approved_application_gets_a_lease(client, db, as_profile, approved, status):
    next(row for row in _rows(db, "rental_applications") if row["id"] == approved["application"])["status"] = status
    as_party(as_profile, OWNER)

    response = client.post(API, json={"application_id": approved["application"], **TERMS})

    assert response.status_code == 409
    assert _rows(db, "rent_agreements") == []


@pytest.mark.parametrize("person, code", [(MANAGER, 403), (STRANGER, 404), (TENANT, 403), (PROVIDER, 403), (ADMIN, 403)])
def test_only_the_propertys_owner_drafts_its_lease(client, db, as_profile, approved, person, code):
    as_party(as_profile, person)

    response = client.post(API, json={"application_id": approved["application"], **TERMS})

    assert response.status_code == code
    assert _rows(db, "rent_agreements") == []


@pytest.mark.parametrize("change", [
    {"rent_amount": 0}, {"rent_amount": 650.555}, {"rent_frequency": "DAILY"},
    {"end_date": "2026-11-01"}, {"start_date": None}, {"application_id": "not-an-id"},
])
def test_terms_the_database_would_refuse_are_refused_first(client, db, as_profile, approved, change):
    as_party(as_profile, OWNER)

    response = client.post(API, json={"application_id": approved["application"], **TERMS, **change})

    assert response.status_code in (404, 422), response.text
    assert _rows(db, "rent_agreements") == []


def test_a_frequency_in_lower_case_is_the_databases_upper_case(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved, rent_frequency="fortnightly", end_date=None)

    assert (lease["rent_frequency"], lease["end_date"]) == ("FORTNIGHTLY", None)


def test_the_candidates_are_the_owners_approved_applications_without_a_lease(client, db, as_profile, approved):
    other = seed_approved(db, owner=STRANGER, tenant=OTHER_TENANT, manager=OWNER)
    as_party(as_profile, OWNER)

    [candidate] = client.get(f"{API}/candidates").json()

    # The property OWNER only manages is not theirs to lease.
    assert candidate["application_id"] == approved["application"] != other["application"]
    assert (candidate["title"], candidate["tenant"]["name"], candidate["offer_weekly_rent"], candidate["move_in_date"],
            candidate["bond_amount"], candidate["lease_term_months"]) == (
        "Harbour flat", "Tanya Tenant", 650, "2026-11-15", 2600, 12)
    _draft(client, as_profile, approved)
    assert client.get(f"{API}/candidates").json() == []


# -- the PDF -----------------------------------------------------------------------------
def test_a_preview_is_the_guided_forms_pdf_and_stores_nothing(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)

    preview = _preview(client, as_profile, lease["id"])

    data = base64.b64decode(preview["pdf_base64"])
    assert data.startswith(b"%PDF-1.4") and data.rstrip().endswith(b"%%EOF")
    assert preview["sha256"] == hashlib.sha256(data).hexdigest()
    assert (preview["filename"], preview["size"]) == ("Residential tenancy agreement.pdf", len(data))
    for text in (b"(Harbour flat)", b"(Olivia Owner)", b"(Tanya Tenant)", b"($650.00 per week \\(AUD\\))",
                 b"(15 November 2026)", b"($2,600.00)", b"(No smoking inside.)", b"(Signing page)"):
        assert text in data
    assert [key for key in db.storage.objects if key[0] == leases.BUCKET] == []
    assert _rows(db, "tenant_lease_documents") == []


def test_sending_stores_the_pdf_as_the_owner_and_registers_it(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)
    preview = _preview(client, as_profile, lease["id"])

    sent = client.post(f"{API}/{lease['id']}/document", json={**FORM, "preview_sha256": preview["sha256"]})

    assert sent.status_code == 200, sent.text
    path, data = _stored_pdf(db)
    assert path == f"{lease['id']}/lease-v1-{preview['sha256'][:12]}.pdf"
    assert hashlib.sha256(data).hexdigest() == preview["sha256"]
    # Stored with the owner's token: the function accepts only a PDF its caller uploaded.
    meta = fb_tenancy.object_meta(db)[(leases.BUCKET, path)]
    assert (meta["owner_id"], meta["mimetype"], meta["metadata"]) == (AUTH[OWNER], "application/pdf",
                                                                      {"virus_scan": "not_scanned"})
    [document] = _rows(db, "tenant_lease_documents")
    assert (document["storage_path"], document["original_filename"], document["uploaded_by_user_id"]) == (
        path, "Residential tenancy agreement.pdf", OWNER)
    assert ("mobile_register_tenant_lease_document", AUTH[OWNER]) in db.rpc_callers
    body = sent.json()
    assert (body["stage"], body["document"]["id"], body["document"]["version"]) == ("review", document["id"], 1)
    # The database tells the tenant, once.
    assert [(n["user_id"], n["link"]) for n in _rows(db, "notifications")] == [
        (TENANT, f"/documents/lease-ready/{lease['id']}/{document['id']}")]


def test_a_pdf_that_is_not_the_one_previewed_is_not_sent(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)
    preview = _preview(client, as_profile, lease["id"])

    stale = client.post(f"{API}/{lease['id']}/document",
                        json={**FORM, "special_conditions": "Edited after the preview.", "preview_sha256": preview["sha256"]})

    assert stale.status_code == 409
    assert "Preview it again" in stale.json()["detail"]
    assert db.storage.objects == {} and _rows(db, "tenant_lease_documents") == []


def test_a_repeated_send_keeps_one_pdf(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)
    preview = _preview(client, as_profile, lease["id"])
    body = {**FORM, "preview_sha256": preview["sha256"]}

    first = client.post(f"{API}/{lease['id']}/document", json=body)
    again = client.post(f"{API}/{lease['id']}/document", json=body)

    assert (first.status_code, again.status_code) == (200, 200)
    assert again.json()["document"] == first.json()["document"]
    assert len(_rows(db, "tenant_lease_documents")) == 1 and len(db.storage.objects) == 1
    assert len(_rows(db, "notifications")) == 1


def test_a_send_racing_the_same_send_registers_one_pdf(client, db, as_profile, approved, monkeypatch):
    """The second request read no PDF yet: Storage refuses to overwrite the object, the database a second row."""
    lease = _draft(client, as_profile, approved)
    preview = _preview(client, as_profile, lease["id"])
    body = {**FORM, "preview_sha256": preview["sha256"]}
    first = client.post(f"{API}/{lease['id']}/document", json=body)
    real = leases._sendable

    def read_before_the_first_registered(agreement_id, current):
        agreement, context = real(agreement_id, current)
        return agreement, {**context, "documents": {}}

    monkeypatch.setattr(leases, "_sendable", read_before_the_first_registered)

    second = client.post(f"{API}/{lease['id']}/document", json=body)

    assert (first.status_code, second.status_code) == (200, 200), second.text
    assert second.json()["document"] == first.json()["document"]
    assert len(_rows(db, "tenant_lease_documents")) == 1 and len(db.storage.objects) == 1


def test_an_uploaded_pdf_is_stored_and_registered(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/document/upload",
                           files={"file": ("Our lease/v2.pdf", PDF, "application/pdf")})

    assert response.status_code == 200, response.text
    path, data = _stored_pdf(db)
    assert data == PDF and path == f"{lease['id']}/lease-v1-{hashlib.sha256(PDF).hexdigest()[:12]}.pdf"
    [document] = _rows(db, "tenant_lease_documents")
    assert document["original_filename"] == "v2.pdf"


@pytest.mark.parametrize("name, data, content_type, code", [
    ("lease.txt", b"just text", "text/plain", 415),
    ("lease.pdf", b"<html>not a pdf</html>", "application/pdf", 415),
    ("lease.pdf", b"", "application/pdf", 400),
    ("lease.pdf", b"%PDF-" + b"0" * (10 * 1024 * 1024), "application/pdf", 413),
])
def test_an_upload_that_is_not_a_pdf_within_the_limit_is_refused(client, db, as_profile, approved, name, data,
                                                                  content_type, code):
    lease = _draft(client, as_profile, approved)
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/document/upload", files={"file": (name, data, content_type)})

    assert response.status_code == code
    assert db.storage.objects == {} and _rows(db, "tenant_lease_documents") == []


def test_a_pdf_stored_by_the_service_role_is_never_registered(client, db, as_profile, approved, monkeypatch):
    """Why the owner's token stores it: the function refuses a PDF its caller did not upload, and it is removed."""
    lease = _draft(client, as_profile, approved)
    monkeypatch.setattr(leases, "user_storage", lambda token: fb_tenancy.LeaseStorage(db))
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/document/upload", files={"file": ("lease.pdf", PDF, "application/pdf")})

    assert response.status_code == 409
    assert response.json()["detail"] == "Uploaded PDF was not found or is not authorised."
    assert db.storage.objects == {} and _rows(db, "tenant_lease_documents") == []


def test_only_the_owner_sends_a_pdf(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)

    for person, code in ((TENANT, 403), (STRANGER, 404), (MANAGER, 404)):
        as_party(as_profile, person)
        response = client.post(f"{API}/{lease['id']}/document/upload", files={"file": ("l.pdf", PDF, "application/pdf")})
        assert response.status_code == code, person
    assert db.storage.objects == {}


def test_no_new_pdf_once_the_tenant_confirmed(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)
    assert _confirm(client, as_profile, lease).status_code == 200
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/document/upload", files={"file": ("l.pdf", PDF, "application/pdf")})

    assert response.status_code == 409
    assert len(_rows(db, "tenant_lease_documents")) == 1


# -- opening the PDF -------------------------------------------------------------------
def test_both_parties_open_the_latest_pdf_through_the_backend(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)
    _path, stored = _stored_pdf(db)

    for person in (TENANT, OWNER):
        as_party(as_profile, person)
        response = client.get(f"{API}/{lease['id']}/documents/{lease['document']['id']}/file")
        assert response.status_code == 200, person
        assert response.content == stored
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["cache-control"] == "private, no-store"
        assert 'filename="Residential tenancy agreement.pdf"' in response.headers["content-disposition"]


@pytest.mark.parametrize("name, fallback", [
    ("John’s lease – signed.pdf", "John_s lease _ signed.pdf"),
    ("Hợp đồng thuê.pdf", "Hop _ong thue.pdf"),
    ('lease\r\nSet-Cookie: a="b".pdf', "leaseSet-Cookie: a=_b_.pdf"),
])
def test_a_pdf_named_in_any_script_on_the_mobile_app_opens(client, db, as_profile, approved, name, fallback):
    lease = _sent(client, as_profile, approved)
    # mobile_register_tenant_lease_document takes any name that ends in .pdf and has no '/'.
    next(row for row in _rows(db, "tenant_lease_documents")
         if row["id"] == lease["document"]["id"])["original_filename"] = name

    for person in (TENANT, OWNER):
        as_party(as_profile, person)
        response = client.get(f"{API}/{lease['id']}/documents/{lease['document']['id']}/file")
        assert response.status_code == 200, person
        disposition = response.headers["content-disposition"]
        assert disposition.startswith(f'inline; filename="{fallback}"; filename*=UTF-8\'\'')
        assert unquote(disposition.split("filename*=UTF-8''")[1]) == name.replace("\r\n", "")
        assert "\n" not in disposition and "\r" not in disposition


def test_no_lease_answer_names_the_public_bucket(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)
    path, _data = _stored_pdf(db)

    for person in (TENANT, OWNER):
        as_party(as_profile, person)
        for url in (API, f"{API}/{lease['id']}"):
            text = client.get(url).text
            assert path not in text and "storage/v1" not in text and leases.BUCKET not in text


@pytest.mark.parametrize("person, code", [(OTHER_TENANT, 404), (STRANGER, 404), (MANAGER, 404), (PROVIDER, 403),
                                          (ADMIN, 403)])
def test_nobody_else_opens_a_lease_or_its_pdf(client, db, as_profile, approved, person, code):
    lease = _sent(client, as_profile, approved)
    as_party(as_profile, person)

    assert client.get(f"{API}/{lease['id']}").status_code == code
    assert client.get(f"{API}/{lease['id']}/documents/{lease['document']['id']}/file").status_code == code
    if code == 404:
        assert client.get(API).json() == []


LEASE_STEPS = [
    ("post", "document/preview", {**FORM}),
    ("post", "confirm", "document"),
    ("post", "sign", "signature"),
    ("post", "owner-signature", {"signer_name": "Not The Owner", "agree": True}),
    ("post", "activate", None),
]
LEASE_TABLES = ("rent_agreements", "tenant_lease_documents", "tenant_lease_signatures", "rent_agreement_owner_signatures")


@pytest.mark.parametrize("method, step, body", LEASE_STEPS, ids=[step for _, step, _ in LEASE_STEPS])
@pytest.mark.parametrize("person", [OTHER_TENANT, STRANGER, MANAGER, PROVIDER, ADMIN])
def test_no_one_but_the_parties_takes_a_lease_step(client, db, as_profile, approved, method, step, body, person):
    lease = _sent(client, as_profile, approved)
    document = lease["document"]["id"]
    named = {"document": {"document_id": document},
             "signature": {"document_id": document, "signer_name": "Not The Tenant", "agree": True}}
    payload = named[body] if isinstance(body, str) else body
    before = {table: copy.deepcopy(_rows(db, table)) for table in LEASE_TABLES}
    objects = dict(db.storage.objects)
    as_party(as_profile, person)

    response = getattr(client, method)(f"{API}/{lease['id']}/{step}", **({"json": payload} if payload is not None else {}))

    assert response.status_code in (403, 404), (person, step, response.status_code)
    # The preview's PDF names both parties, the address and the rent: none of it leaks.
    assert b"%PDF" not in response.content
    assert {table: _rows(db, table) for table in LEASE_TABLES} == before
    assert dict(db.storage.objects) == objects


def test_a_new_pdf_retires_the_one_before(client, db, as_profile, approved):
    first = _sent(client, as_profile, approved)
    second = _send(client, as_profile, first["id"], special_conditions="No pets on the balcony.")
    as_party(as_profile, TENANT)

    old = client.get(f"{API}/{first['id']}/documents/{first['document']['id']}/file")
    stale = _confirm(client, as_profile, first)

    assert second["document"]["version"] == 2 and second["document"]["id"] != first["document"]["id"]
    assert old.status_code == 410
    assert stale.status_code == 409 and stale.json()["detail"] == leases.CHANGED
    assert client.get(f"{API}/{first['id']}/documents/{second['document']['id']}/file").status_code == 200
    assert b"(No pets on the balcony.)" in client.get(
        f"{API}/{first['id']}/documents/{second['document']['id']}/file").content


# -- confirming and signing ------------------------------------------------------------
def test_the_tenant_confirms_the_terms_as_themselves(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)

    response = _confirm(client, as_profile, lease)

    assert response.status_code == 200, response.text
    assert response.json()["stage"] == "confirmed" and response.json()["actions"]["sign"] is True
    [row] = _rows(db, "rent_agreements")
    assert row["tenant_confirmed_at"] is not None and row["status"] == "DRAFT"
    assert ("mobile_tenant_confirm_rent_agreement", AUTH[TENANT]) in db.rpc_callers
    assert _confirm(client, as_profile, lease).status_code == 200  # again: nothing changes


def test_confirming_needs_a_pdf_and_the_tenant(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)
    as_party(as_profile, TENANT)

    nothing_sent = client.post(f"{API}/{lease['id']}/confirm", json={"document_id": lease["id"]})
    lease = _send(client, as_profile, lease["id"])
    as_party(as_profile, OWNER)
    by_owner = client.post(f"{API}/{lease['id']}/confirm", json={"document_id": lease["document"]["id"]})

    assert nothing_sent.status_code == 409 and by_owner.status_code == 403
    assert _rows(db, "rent_agreements")[0]["tenant_confirmed_at"] is None


def test_the_tenant_signs_the_stored_pdf_with_its_hash(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)
    _confirm(client, as_profile, lease)

    response = _tenant_sign(client, as_profile, lease, name="  Tanya   Tenant ")

    assert response.status_code == 200, response.text
    path, data = _stored_pdf(db)
    [signature] = _rows(db, "tenant_lease_signatures")
    assert (signature["signer_user_id"], signature["signer_name"], signature["signing_method"]) == (
        TENANT, "Tanya Tenant", "TYPED_NAME")
    assert (signature["document_id"], signature["document_storage_path"], signature["document_sha256"]) == (
        lease["document"]["id"], path, hashlib.sha256(data).hexdigest())
    assert (signature["consent_text"], signature["consent_version"]) == (leases.TENANT_CONSENT,
                                                                         leases.TENANT_CONSENT_VERSION)
    body = response.json()
    assert (body["stage"], body["status"], body["tenant_signature"]["signer_name"]) == ("tenant_signed", "draft",
                                                                                        "Tanya Tenant")
    # The database tells the owner, once, and nothing is sent again for a repeat.
    assert _tenant_sign(client, as_profile, lease).status_code == 200
    assert len(_rows(db, "tenant_lease_signatures")) == 1
    assert [(n["user_id"], n["link"]) for n in _rows(db, "notifications") if n["user_id"] == OWNER] == [
        (OWNER, f"/applications/lease-signed/{lease['id']}")]


def test_signing_comes_after_confirming(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)

    response = _tenant_sign(client, as_profile, lease)

    assert response.status_code == 409
    assert _rows(db, "tenant_lease_signatures") == []


@pytest.mark.parametrize("change", [{"agree": False}, {"signer_name": "T"}, {"signer_name": "x" * 161}])
def test_a_signature_needs_consent_and_a_typed_name(client, db, as_profile, approved, change):
    lease = _sent(client, as_profile, approved)
    _confirm(client, as_profile, lease)
    as_party(as_profile, TENANT)

    response = client.post(f"{API}/{lease['id']}/sign", json={
        "document_id": lease["document"]["id"], "signer_name": "Tanya Tenant", "agree": True, **change})

    assert response.status_code == 422
    assert _rows(db, "tenant_lease_signatures") == []


def test_a_signature_on_a_pdf_replaced_meanwhile_is_refused_by_the_database(client, db, as_profile, approved,
                                                                            monkeypatch):
    """The backend read the latest PDF before a newer one landed: the guard trigger refuses the stale one."""
    lease = _sent(client, as_profile, approved)
    _confirm(client, as_profile, lease)
    older = dict(_rows(db, "tenant_lease_documents")[0])
    db.seed("tenant_lease_documents", [{**older, "id": "d0000000-0000-4000-8000-000000000001",
                                        "storage_path": f"{lease['id']}/lease-v2-000000000000.pdf",
                                        "created_at": "2030-01-01T00:00:00+00:00"}])
    monkeypatch.setattr(leases, "_latest", lambda agreement_id: older)

    response = _tenant_sign(client, as_profile, lease)

    assert response.status_code == 409
    assert response.json()["detail"] == "Lease document has changed; review the latest PDF"
    assert _rows(db, "tenant_lease_signatures") == []


def test_no_new_pdf_after_the_tenant_signed(client, db, as_profile, approved, monkeypatch):
    """Even past the backend's own check, the bucket's policies refuse a PDF for a signed lease."""
    lease = _signed_by_tenant(client, as_profile, approved)
    monkeypatch.setattr(leases, "_sendable", lambda agreement_id, current: (
        leases._agreement(agreement_id), leases._context([leases._agreement(agreement_id)])))
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/document/upload", files={"file": ("l.pdf", PDF, "application/pdf")})

    assert response.status_code == 409
    assert len(_rows(db, "tenant_lease_documents")) == 1 and len(db.storage.objects) == 1


def test_the_owner_signs_the_pdf_the_tenant_signed(client, db, as_profile, approved):
    lease = _signed_by_tenant(client, as_profile, approved)

    response = _owner_sign(client, as_profile, lease)

    assert response.status_code == 200, response.text
    [tenant] = _rows(db, "tenant_lease_signatures")
    [owner] = _rows(db, "rent_agreement_owner_signatures")
    assert (owner["tenant_signature_id"], owner["document_id"], owner["document_storage_path"],
            owner["document_sha256"]) == (tenant["id"], tenant["document_id"], tenant["document_storage_path"],
                                          tenant["document_sha256"])
    assert (owner["owner_user_id"], owner["signer_name"], owner["consent_version"]) == (
        OWNER, "Olivia Owner", leases.OWNER_CONSENT_VERSION)
    body = response.json()
    # Signed by both, the lease is still a draft until the owner activates it.
    assert (body["stage"], body["status"], body["actions"]["activate"]) == ("signed", "draft", True)
    assert _owner_sign(client, as_profile, lease).status_code == 200
    assert len(_rows(db, "rent_agreement_owner_signatures")) == 1


def test_the_owner_signs_only_after_the_tenant(client, db, as_profile, approved):
    lease = _sent(client, as_profile, approved)
    _confirm(client, as_profile, lease)

    early = _owner_sign(client, as_profile, lease)
    as_party(as_profile, TENANT)
    by_tenant = client.post(f"{API}/{lease['id']}/owner-signature", json={"signer_name": "Tanya", "agree": True})

    assert (early.status_code, by_tenant.status_code) == (409, 403)
    assert _rows(db, "rent_agreement_owner_signatures") == []


def test_a_stored_pdf_that_changed_since_the_tenant_signed_is_not_countersigned(client, db, as_profile, approved):
    lease = _signed_by_tenant(client, as_profile, approved)
    path, data = _stored_pdf(db)
    db.storage.objects[(leases.BUCKET, path)] = data + b"% tampered\n"

    response = _owner_sign(client, as_profile, lease)

    assert response.status_code == 409
    assert _rows(db, "rent_agreement_owner_signatures") == []


# -- activation ----------------------------------------------------------------------------
def test_the_owner_activates_a_lease_both_signed(client, db, as_profile, approved):
    lease = _signed_by_tenant(client, as_profile, approved)
    _owner_sign(client, as_profile, lease)
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/activate")

    assert response.status_code == 200, response.text
    [row] = _rows(db, "rent_agreements")
    assert row["status"] == "ACTIVE" and row["activated_at"] is not None
    assert ("mobile_owner_activate_rent_agreement", AUTH[OWNER]) in db.rpc_callers
    assert (response.json()["stage"], response.json()["status"]) == ("active", "active")
    assert client.post(f"{API}/{lease['id']}/activate").status_code == 200  # again: nothing changes
    assert [n["link"] for n in _rows(db, "notifications") if n["user_id"] == TENANT].count(
        f"/agreements/activated/{lease['id']}") == 1


def test_a_lease_is_activated_only_once_both_signed(client, db, as_profile, approved):
    lease = _signed_by_tenant(client, as_profile, approved)
    as_party(as_profile, OWNER)

    early = client.post(f"{API}/{lease['id']}/activate")
    as_party(as_profile, TENANT)
    by_tenant = client.post(f"{API}/{lease['id']}/activate")

    assert (early.status_code, by_tenant.status_code) == (409, 403)
    assert _rows(db, "rent_agreements")[0]["status"] == "DRAFT"


def test_the_function_refuses_an_owner_it_does_not_count(client, db, as_profile, approved, monkeypatch):
    """mobile_owner_activate_rent_agreement's own message reaches the owner when it refuses."""
    lease = _signed_by_tenant(client, as_profile, approved)
    _owner_sign(client, as_profile, lease)
    next(row for row in _rows(db, "rental_applications") if row["id"] == approved["application"])["status"] = "WITHDRAWN"
    as_party(as_profile, OWNER)

    response = client.post(f"{API}/{lease['id']}/activate")

    assert response.status_code == 409
    assert response.json()["detail"].startswith("Activation requires an approved application")
    assert _rows(db, "rent_agreements")[0]["status"] == "DRAFT"


def test_each_party_lists_only_their_leases(client, db, as_profile, approved):
    lease = _draft(client, as_profile, approved)

    for person, expected in ((OWNER, [lease["id"]]), (TENANT, [lease["id"]]), (OTHER_TENANT, []), (STRANGER, [])):
        as_party(as_profile, person)
        assert [item["id"] for item in client.get(API).json()] == expected, person
    as_party(as_profile, TENANT)
    assert client.get(API).json()[0]["viewer_role"] == "tenant"


def test_a_signature_on_another_pdf_is_a_conflict_not_a_repeat(client, db, as_profile, approved):
    lease = _signed_by_tenant(client, as_profile, approved)
    _rows(db, "tenant_lease_signatures")[0]["document_id"] = "d0000000-0000-4000-8000-000000000009"

    response = _tenant_sign(client, as_profile, lease)

    assert response.status_code == 409
    assert len(_rows(db, "tenant_lease_signatures")) == 1


# -- errors and storage ---------------------------------------------------------------------
@pytest.mark.parametrize("code, message, status", [
    ("42501", "Active landlord access is required", 403),
    ("P0002", "Application not found", 404),
    ("23505", "duplicate key value violates unique constraint", 409),
    ("22023", "Invalid application status", 422),
    ("23514", "new row violates check constraint", 422),
    ("P0001", "Enter a valid rent amount.", 422),
    ("P0001", "Invalid PDF filename.", 422),
    ("P0001", "Agreement unavailable for confirmation.", 409),
    ("P0001", "Lease document has changed; review the latest PDF", 409),
    ("P0001", "Please sign in first.", 403),
])
def test_a_functions_refusal_reaches_the_caller_with_its_message(code, message, status):
    answer = leases.refusal(api_error(code, message))

    assert answer.status_code == status
    assert answer.detail == ("This was already recorded." if code == "23505" else message)


def test_an_error_that_is_not_the_callers_is_left_to_the_api(fake_db):
    assert leases.refusal(api_error("XX000", "internal")) is None


def test_the_users_storage_client_carries_their_token():
    with leases.user_storage("jwt-owner") as owner:
        assert owner.storage._headers["authorization"] == "Bearer jwt-owner"
        assert str(owner.storage._base_url) == f"{settings.supabase_url.rstrip('/')}/storage/v1/"
    with pytest.raises(ValueError):
        leases.user_storage("")
