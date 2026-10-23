"""Rows for the tests of the shared catalog's rules: each one passes every CHECK and key of its table.

A home is an owner's property and listing with a tenant's application; a
lease is that home's draft rent agreement. Ids are fixed uuids, and every
users row has its own email (users_email_key).
"""

import pytest
from postgrest.exceptions import APIError

NOW = "2026-01-01T00:00:00+00:00"
OWNER = "a1000000-0000-4000-8000-000000000001"
TENANT = "a1000000-0000-4000-8000-000000000002"
PROPERTY = "b1000000-0000-4000-8000-000000000001"
LISTING = "c1000000-0000-4000-8000-000000000001"
OTHER_LISTING = "c1000000-0000-4000-8000-000000000002"
APPLICATION = "d1000000-0000-4000-8000-000000000001"
AGREEMENT = "e1000000-0000-4000-8000-000000000001"
DOCUMENT = "f3000000-0000-4000-8000-000000000001"
SIGNATURE = "f4000000-0000-4000-8000-000000000001"
OWNER_SIGNATURE = "f5000000-0000-4000-8000-000000000001"
SHA = "a" * 64


def fails(code: str, query, match: str | None = None) -> APIError:
    """Run query and expect the database error code (and message part) it fails with."""
    with pytest.raises(APIError) as caught:
        query.execute()
    assert caught.value.code == code, caught.value.message
    if match:
        assert match in caught.value.message, caught.value.message
    return caught.value


def user(id: str, **over) -> dict:
    return {"id": id, "email": f"{id}@example.test", "updated_at": NOW, **over}


def home(db, listing_status: str = "PUBLISHED", application_status: str = "SUBMITTED") -> None:
    db.seed("users", [user(OWNER, primary_role="LANDLORD"), user(TENANT)])
    db.seed("properties", [{"id": PROPERTY, "owner_user_id": OWNER, "address_line_1": "1 Test St",
                            "suburb": "Newtown", "state": "NSW", "postcode": "2042", "updated_at": NOW}])
    db.seed("listings", [listing(status=listing_status)])
    db.seed("rental_applications", [{"id": APPLICATION, "listing_id": LISTING, "applicant_user_id": TENANT,
                                     "offer_weekly_rent": 600, "status": application_status, "updated_at": NOW}])


def listing(id: str = LISTING, **over) -> dict:
    return {"id": id, "property_id": PROPERTY, "created_by_user_id": OWNER, "title": "Flat", "weekly_rent": 600,
            "status": "PUBLISHED", "updated_at": NOW, **over}


def agreement(**over) -> dict:
    return {"id": AGREEMENT, "application_id": APPLICATION, "listing_id": LISTING, "tenant_user_id": TENANT,
            "owner_user_id": OWNER, "rent_amount": 600, "rent_frequency": "WEEKLY", "start_date": "2026-02-01",
            "first_due_date": "2026-02-01", **over}


def lease_document(id: str = DOCUMENT, agreement_id: str = AGREEMENT, name: str = "lease.pdf") -> dict:
    return {"id": id, "agreement_id": agreement_id, "storage_path": f"{agreement_id}/{name}",
            "original_filename": name, "uploaded_by_user_id": OWNER}


def tenant_signature(document: str = DOCUMENT, name: str = "lease.pdf", **over) -> dict:
    return {"id": SIGNATURE, "agreement_id": AGREEMENT, "document_id": document, "signer_user_id": TENANT,
            "signer_name": "Tess Tenant", "consent_text": "I agree to sign electronically.", "consent_version": "v1",
            "document_storage_path": f"{AGREEMENT}/{name}", "document_sha256": SHA, **over}


def owner_signature(**over) -> dict:
    return {"id": OWNER_SIGNATURE, "agreement_id": AGREEMENT, "tenant_signature_id": SIGNATURE,
            "document_id": DOCUMENT, "owner_user_id": OWNER, "signer_name": "Olga Owner",
            "consent_text": "I agree to sign this lease electronically.", "consent_version": "v1",
            "document_storage_path": f"{AGREEMENT}/lease.pdf", "document_sha256": SHA, **over}
