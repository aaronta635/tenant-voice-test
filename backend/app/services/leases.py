"""Lease drafts, their PDF and the parties' typed-name signatures (tracker R26).

The shared database holds the lease and its rules: rent_agreements with its
tenant_lease_documents, tenant_lease_signatures and
rent_agreement_owner_signatures, and their guard triggers. The web calls the
mobile functions for every step they cover, as the caller, so both apps keep
one set of rules:

- The owner of an approved application's property drafts the agreed terms
  (mobile_create_rent_agreement_draft).
- The owner sends a PDF, made from the guided form (services/pdf.py) or
  uploaded. It goes to tenant-lease-documents at <agreement id>/<file>.pdf
  with the owner's own token, since the bucket's insert policy and
  mobile_register_tenant_lease_document check who uploaded it, and is then
  registered. A new PDF is the only one either party can open or sign.
- The tenant reviews the latest PDF and confirms the terms
  (mobile_tenant_confirm_rent_agreement), then signs it: a
  tenant_lease_signatures row with the typed name, the consent statement and
  the SHA-256 of the stored PDF's bytes.
- The owner signs the same PDF (rent_agreement_owner_signatures) and
  activates the agreement (mobile_owner_activate_rent_agreement).

The database's triggers check each signature against the latest PDF and send
the notifications, so this module sends none. Only the two parties read a
lease or open its PDF, which the backend streams: the bucket is public, so its
object URLs are never handed out. A repeated request (a double click, a retry)
finds what the first one wrote and answers with it.
"""

import base64
import hashlib
import logging
import re
from collections.abc import Callable
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, UploadFile, status
from postgrest.exceptions import APIError

from app.core.config import settings
from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client
from app.services import _common, pdf, uploads
from app.services.maps_messaging import is_uuid
from app.services.shared_map import stamp_insert

logger = logging.getLogger(__name__)

AGREEMENTS = "rent_agreements"
DOCUMENTS = "tenant_lease_documents"
TENANT_SIGNATURES = "tenant_lease_signatures"
OWNER_SIGNATURES = "rent_agreement_owner_signatures"

BUCKET = "tenant-lease-documents"
PDF_TYPE = "application/pdf"
# The bucket's file_size_limit.
MAX_BYTES = 10 * uploads.MB
SIGNING_METHOD = "TYPED_NAME"

# What each signer agrees to; the signature row keeps the text and its version.
TENANT_CONSENT_VERSION = "tenantvoice-web-tenant-2026-10"
TENANT_CONSENT = (
    "I have read the lease PDF shown to me in TenantVoice and I agree to its terms. I sign it electronically "
    "by typing my full name, and I agree that TenantVoice keeps a record of my typed name, the time I signed "
    "and the SHA-256 fingerprint of that PDF."
)
OWNER_CONSENT_VERSION = "tenantvoice-web-owner-2026-10"
OWNER_CONSENT = (
    "I have read the lease PDF the tenant signed in TenantVoice and I agree to its terms. I sign it "
    "electronically by typing my full name, and I agree that TenantVoice keeps a record of my typed name, "
    "the time I signed and the SHA-256 fingerprint of that PDF."
)

NOT_FOUND = "Lease not found."
CHANGED = "The lease PDF has changed; review the latest PDF."
FREQUENCY_WORDS = {"WEEKLY": "per week", "FORTNIGHTLY": "per fortnight", "MONTHLY": "per month"}

# How a shared function's error reaches the caller.
_ERROR_STATUS = {"42501": 403, "P0002": 404, "23505": 409, "22023": 422, "23514": 422}
# The mobile functions raise plain exceptions (P0001). These name a value the caller sent;
# the rest name a state the lease is not in.
_INVALID_INPUT = {
    "Enter a valid rent amount.",
    "Invalid rent frequency.",
    "Start date and first due date are required.",
    "End date cannot precede start date.",
    "Invalid lease document path.",
    "Invalid PDF filename.",
}
# The function found no active account for the caller's token.
_NO_ACCOUNT = {"Please sign in first.", "Authentication required."}


# ---------------------------------------------------------------------------
# Clients and errors
# ---------------------------------------------------------------------------
def _db():
    return get_supabase_client()


def _service():
    """The service-role client, for its .storage: the backend reads PDFs with it, and tidies up one nothing registered."""
    return get_supabase_client()


class _UserStorage:
    """Storage as one signed-in user, as .storage; a context manager that closes its connection."""

    def __init__(self, access_token: str):
        from storage3 import SyncStorageClient

        self.storage = SyncStorageClient(
            f"{settings.supabase_url.rstrip('/')}/storage/v1/",
            {"apiKey": settings.supabase_service_role_key, "Authorization": f"Bearer {access_token}"},
        )

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.storage.session.close()
        return False


def user_storage(access_token: str) -> _UserStorage:
    """Storage as the signed-in user: Storage makes the token's user the owner of what it stores.

    The bucket's insert policy lets only the draft's owner add a PDF, and
    mobile_register_tenant_lease_document accepts only a PDF its caller
    stored (storage.objects.owner_id), so the owner's PDF is never stored with
    the service role.
    """
    if not access_token:
        # Never fall back to the service role: it is nobody's upload.
        raise ValueError("user_storage needs the user's access token")
    return _UserStorage(access_token)


def refusal(exc: APIError) -> HTTPException | None:
    """The HTTP answer for a shared function's error, with its message; None for one that is not the caller's.

    42501 is 403, P0002 404, 23505 409, 22023 and 23514 422. A plain
    exception (P0001), which is how the mobile functions refuse, is 422 when
    it names a value the caller sent and 409 when it names the lease's state.
    """
    code = getattr(exc, "code", None)
    message = (getattr(exc, "message", None) or "").strip()
    if code == "23505":
        return HTTPException(status.HTTP_409_CONFLICT, "This was already recorded.")
    if code in _ERROR_STATUS:
        return HTTPException(_ERROR_STATUS[code], message or "This lease cannot change that way.")
    if code == "P0001":
        if message in _NO_ACCOUNT:
            return HTTPException(status.HTTP_403_FORBIDDEN, message)
        if message in _INVALID_INPUT:
            return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, message)
        return HTTPException(status.HTTP_409_CONFLICT, message or "This lease cannot change that way.")
    return None


def _raise(exc: APIError):
    answer = refusal(exc)
    if answer is None:
        raise exc
    raise answer from exc


def _rpc(current: CurrentProfile, name: str, params: dict):
    """A shared function that reads auth.uid(), run as the caller. Raises its APIError."""
    if not current.access_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in again to continue.")
    return user_client(current.access_token).rpc(name, params).execute().data


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Reading a lease
# ---------------------------------------------------------------------------
def _agreement(agreement_id: str) -> dict:
    # id is a uuid column: anything else is no lease, not a 22P02.
    if not is_uuid(agreement_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    rows = _db().table(AGREEMENTS).select("*").eq("id", agreement_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return rows[0]


def _for_party(agreement_id: str, current: CurrentProfile) -> tuple[dict, str]:
    """The agreement and whether the caller is its tenant or its owner; 404 for anyone else."""
    agreement = _agreement(agreement_id)
    if agreement.get("tenant_user_id") == current.id:
        return agreement, "tenant"
    if agreement.get("owner_user_id") == current.id:
        return agreement, "owner"
    raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)


def _documents(agreement_ids: list[str]) -> dict[str, list[dict]]:
    """Each agreement's PDFs, newest first, in the order the database's functions and triggers take the latest."""
    rows = _common.select_in(
        lambda: _db().table(DOCUMENTS).select("*").order("created_at", desc=True).order("id", desc=True),
        "agreement_id", agreement_ids,
    )
    by_agreement: dict[str, list[dict]] = {}
    for row in rows:  # an agreement's rows all come from one query, in its order
        by_agreement.setdefault(row["agreement_id"], []).append(row)
    return by_agreement


def _signatures(table: str, agreement_ids: list[str]) -> dict[str, dict]:
    """Each agreement's signature row in table (one per agreement, by its unique key)."""
    rows = _common.select_in(lambda: _db().table(table).select("*").order("id"), "agreement_id", agreement_ids)
    return {row["agreement_id"]: row for row in rows}


def _names(user_ids: list[str]) -> dict[str, str]:
    rows = _common.select_in(lambda: _db().table("users").select("id, full_name").order("id"), "id", user_ids)
    return {row["id"]: (row.get("full_name") or "").strip() for row in rows}


def _listings(listing_ids: list[str]) -> dict[str, dict]:
    rows = _common.select_in(
        lambda: _db().table("listings").select(
            "id, title, bond_amount, lease_term_months, available_from, "
            "properties(owner_user_id, manager_user_id, address_line_1, address_line_2, suburb, state, postcode)"
        ).order("id"),
        "id", listing_ids,
    )
    return {row["id"]: row for row in rows}


def _address(prop: dict | None) -> str | None:
    if not prop:
        return None
    street = ", ".join(part.strip() for part in (prop.get("address_line_1"), prop.get("address_line_2")) if part and part.strip())
    place = " ".join(part.strip() for part in (prop.get("suburb"), prop.get("state"), prop.get("postcode")) if part and part.strip())
    return ", ".join(part for part in (street, place) if part) or None


def _on_document(signature: dict | None, document: dict | None) -> bool:
    return bool(signature and document and signature.get("document_id") == document["id"]
                and signature.get("document_storage_path") == document.get("storage_path"))


def stage_of(agreement: dict, latest: dict | None, tenant_signature: dict | None, owner_signature: dict | None) -> str:
    """Where a lease is. A draft counts as signed only when both signatures are on its latest PDF,
    with the same hash, as rent_agreement_has_matching_signatures checks; it is active only once activated."""
    state = (agreement.get("status") or "DRAFT").upper()
    if state in ("ACTIVE", "ENDED", "CANCELLED"):
        return state.lower()
    tenant_signed = _on_document(tenant_signature, latest)
    if (tenant_signed and _on_document(owner_signature, latest)
            and owner_signature.get("tenant_signature_id") == tenant_signature["id"]
            and owner_signature.get("document_sha256") == tenant_signature.get("document_sha256")):
        return "signed"
    if tenant_signed:
        return "tenant_signed"
    if latest and agreement.get("tenant_confirmed_at"):
        return "confirmed"
    return "review" if latest else "draft"


def _signature_out(row: dict | None) -> dict | None:
    if not row:
        return None
    return {key: row.get(key) for key in ("signer_name", "signed_at", "document_id", "document_sha256", "consent_version")}


def _context(agreements: list[dict]) -> dict:
    """What the leases' answers read besides the agreements, loaded once for all of them."""
    ids = [row["id"] for row in agreements]
    return {
        "documents": _documents(ids),
        "tenant_signatures": _signatures(TENANT_SIGNATURES, ids),
        "owner_signatures": _signatures(OWNER_SIGNATURES, ids),
        "names": _names([row[key] for row in agreements for key in ("tenant_user_id", "owner_user_id")]),
        "listings": _listings([row["listing_id"] for row in agreements]),
    }


def _out(agreement: dict, viewer_id: str, context: dict) -> dict:
    documents = context["documents"].get(agreement["id"], [])
    latest = documents[0] if documents else None
    tenant_signature = context["tenant_signatures"].get(agreement["id"])
    owner_signature = context["owner_signatures"].get(agreement["id"])
    stage = stage_of(agreement, latest, tenant_signature, owner_signature)
    listing = context["listings"].get(agreement["listing_id"]) or {}
    role = "tenant" if agreement["tenant_user_id"] == viewer_id else "owner"
    draft = (agreement.get("status") or "").upper() == "DRAFT"
    actions = {
        # mobile_register_tenant_lease_document takes a PDF only until the tenant confirms, and none once signed.
        "send_document": role == "owner" and draft and not agreement.get("tenant_confirmed_at") and not tenant_signature,
        "confirm": role == "tenant" and stage == "review",
        "sign": role == "tenant" and stage == "confirmed",
        "owner_sign": role == "owner" and stage == "tenant_signed" and not owner_signature,
        "activate": role == "owner" and stage == "signed",
    }
    names = context["names"]
    return {
        "id": agreement["id"],
        "application_id": agreement["application_id"],
        "listing_id": agreement["listing_id"],
        "title": listing.get("title") or "Rental agreement",
        "address": _address(listing.get("properties")),
        "bond_amount": float(listing["bond_amount"]) if listing.get("bond_amount") is not None else None,
        "tenant": {"id": agreement["tenant_user_id"], "name": names.get(agreement["tenant_user_id"]) or "Tenant"},
        "owner": {"id": agreement["owner_user_id"], "name": names.get(agreement["owner_user_id"]) or "Owner"},
        "rent_amount": float(agreement["rent_amount"]),
        "rent_frequency": agreement["rent_frequency"],
        "currency": agreement.get("currency") or "AUD",
        "start_date": agreement["start_date"],
        "end_date": agreement.get("end_date"),
        "first_due_date": agreement["first_due_date"],
        "status": (agreement.get("status") or "DRAFT").lower(),
        "stage": stage,
        "tenant_confirmed_at": agreement.get("tenant_confirmed_at"),
        "activated_at": agreement.get("activated_at"),
        "created_at": agreement["created_at"],
        "updated_at": agreement["updated_at"],
        "document": {
            "id": latest["id"], "filename": latest["original_filename"], "version": len(documents),
            "created_at": latest["created_at"],
        } if latest else None,
        "tenant_signature": _signature_out(tenant_signature),
        "owner_signature": _signature_out(owner_signature),
        "viewer_role": role,
        "actions": actions,
        "consent": {"text": TENANT_CONSENT, "version": TENANT_CONSENT_VERSION} if role == "tenant"
        else {"text": OWNER_CONSENT, "version": OWNER_CONSENT_VERSION},
    }


def _lease(agreement_id: str, current: CurrentProfile) -> dict:
    agreement, _role = _for_party(agreement_id, current)
    return _out(agreement, current.id, _context([agreement]))


def get_lease(agreement_id: str, current: CurrentProfile) -> dict:
    """One lease, for its tenant or its owner only."""
    return _lease(agreement_id, current)


def list_leases(current: CurrentProfile) -> list[dict]:
    """The caller's leases, newest first: as the tenant, or as the owner."""
    column = "tenant_user_id" if current.role == "tenant" else "owner_user_id"
    agreements = _common.select_all(
        lambda: _db().table(AGREEMENTS).select("*").eq(column, current.id).order("created_at", desc=True).order("id")
    )
    if not agreements:
        return []
    context = _context(agreements)
    return [_out(agreement, current.id, context) for agreement in agreements]


# ---------------------------------------------------------------------------
# Drafting the terms
# ---------------------------------------------------------------------------
def _move_in(application: dict) -> str | None:
    metadata = application.get("metadata") if isinstance(application.get("metadata"), dict) else {}
    snapshot = metadata.get("applicant_snapshot") if isinstance(metadata.get("applicant_snapshot"), dict) else {}
    value = snapshot.get("move_in_date") or metadata.get("move_in_date")
    try:
        return date.fromisoformat(str(value)[:10]).isoformat() if value else None
    except ValueError:
        return None


def candidates(current: CurrentProfile) -> list[dict]:
    """The owner's approved applications without a lease yet, newest decision first, to draft one from.

    Only the property's owner (properties.owner_user_id) can draft its lease,
    as mobile_create_rent_agreement_draft requires; a manager cannot.
    """
    properties = _common.select_all(
        lambda: _db().table("properties").select("id").eq("owner_user_id", current.id).order("id")
    )
    listings = _common.select_in(
        lambda: _db().table("listings").select(
            "id, title, bond_amount, lease_term_months, available_from, "
            "properties(owner_user_id, manager_user_id, address_line_1, address_line_2, suburb, state, postcode)"
        ).order("id"),
        "property_id", [row["id"] for row in properties],
    )
    by_listing = {row["id"]: row for row in listings}
    applications = _common.select_in(
        lambda: _db().table("rental_applications")
        .select("id, listing_id, applicant_user_id, offer_weekly_rent, metadata, last_status_at, updated_at")
        .eq("status", "APPROVED").order("id"),
        "listing_id", list(by_listing),
    )
    drafted = {row["application_id"] for row in _common.select_in(
        lambda: _db().table(AGREEMENTS).select("application_id").order("id"),
        "application_id", [row["id"] for row in applications],
    )}
    waiting = [row for row in applications if row["id"] not in drafted]
    names = _names([row["applicant_user_id"] for row in waiting])
    out = []
    for row in waiting:
        listing = by_listing[row["listing_id"]]
        out.append({
            "application_id": row["id"],
            "listing_id": row["listing_id"],
            "title": listing.get("title") or "Rental listing",
            "address": _address(listing.get("properties")),
            "tenant": {"id": row["applicant_user_id"], "name": names.get(row["applicant_user_id"]) or "Tenant"},
            "offer_weekly_rent": float(row["offer_weekly_rent"]) if row.get("offer_weekly_rent") is not None else None,
            "move_in_date": _move_in(row) or listing.get("available_from"),
            "bond_amount": float(listing["bond_amount"]) if listing.get("bond_amount") is not None else None,
            "lease_term_months": listing.get("lease_term_months"),
            "approved_at": row.get("last_status_at") or row.get("updated_at"),
        })
    return sorted(out, key=lambda item: str(item["approved_at"] or ""), reverse=True)


def _owned_application(application_id: str, owner_id: str) -> dict:
    """The application, if the caller owns its listing's property and it is approved."""
    missing = HTTPException(status.HTTP_404_NOT_FOUND, "Application not found.")
    if not is_uuid(application_id):
        raise missing
    rows = (
        _db().table("rental_applications")
        .select("id, status, listing_id, applicant_user_id, listings(id, properties(owner_user_id, manager_user_id))")
        .eq("id", application_id).limit(1).execute().data
    )
    if not rows:
        raise missing
    application = rows[0]
    prop = (application.get("listings") or {}).get("properties") or {}
    if prop.get("owner_user_id") != owner_id:
        if prop.get("manager_user_id") == owner_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the property's owner can prepare its lease.")
        raise missing
    if application.get("status") != "APPROVED":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only an approved application can get a lease.")
    return application


def _agreement_for(application_id: str) -> dict | None:
    rows = _db().table(AGREEMENTS).select("*").eq("application_id", application_id).limit(1).execute().data
    return rows[0] if rows else None


def _same_terms(agreement: dict, terms: dict) -> bool:
    return (
        Decimal(str(agreement["rent_amount"])) == Decimal(str(terms["rent_amount"]))
        and agreement["rent_frequency"] == terms["rent_frequency"]
        and str(agreement["start_date"])[:10] == str(terms["start_date"])
        and str(agreement["first_due_date"])[:10] == str(terms["first_due_date"])
        and (str(agreement["end_date"])[:10] if agreement.get("end_date") else None)
        == (str(terms["end_date"]) if terms.get("end_date") else None)
    )


def _existing(agreement: dict, terms: dict, current: CurrentProfile) -> tuple[dict, bool]:
    """A repeated draft request answers with the draft it made; different terms are a conflict."""
    if _same_terms(agreement, terms):
        return _out(agreement, current.id, _context([agreement])), False
    raise HTTPException(status.HTTP_409_CONFLICT, "This application already has a lease.")


def create_draft(current: CurrentProfile, terms: dict) -> tuple[dict, bool]:
    """Draft the lease of an approved application with its agreed terms; (lease, whether it is new)."""
    application = _owned_application(terms["application_id"], current.id)
    existing = _agreement_for(application["id"])
    if existing:
        return _existing(existing, terms, current)
    try:
        agreement_id = _rpc(current, "mobile_create_rent_agreement_draft", {
            "p_application_id": application["id"],
            "p_rent_amount": float(terms["rent_amount"]),
            "p_rent_frequency": terms["rent_frequency"],
            "p_start_date": str(terms["start_date"]),
            "p_first_due_date": str(terms["first_due_date"]),
            "p_end_date": str(terms["end_date"]) if terms.get("end_date") else None,
        })
    except APIError as exc:
        existing = _agreement_for(application["id"]) if exc.code == "23505" else None
        if existing:  # a repeated request drafted it first
            return _existing(existing, terms, current)
        _raise(exc)
    return _lease(str(agreement_id), current), True


# ---------------------------------------------------------------------------
# The lease PDF
# ---------------------------------------------------------------------------
def _money(value) -> str:
    return f"${Decimal(str(value)):,.2f}"


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")


def _long_date(value) -> str:
    """1 November 2026, whatever the server's locale."""
    day = date.fromisoformat(str(value)[:10])
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


def _file_stem(title: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9 _().-]", "", title).strip(" .") or "Lease"
    return stem[:120]


def lease_pdf(agreement: dict, form: dict, version: int, context: dict) -> tuple[bytes, str]:
    """The guided form's PDF for an agreement, and its file name: its terms, parties and premises come from
    the database, the rest from the form. The same inputs give the same bytes."""
    names = context["names"]
    listing = context["listings"].get(agreement["listing_id"]) or {}
    tenant = names.get(agreement["tenant_user_id"]) or "The tenant"
    owner = names.get(agreement["owner_user_id"]) or "The landlord"
    title = form["title"]
    rent = f"{_money(agreement['rent_amount'])} {FREQUENCY_WORDS.get(agreement['rent_frequency'], '')}".strip()
    pets = {True: "Allowed", False: "Not allowed"}.get(form.get("pets_allowed"), "Not set in this agreement")

    document = pdf.PdfDocument(title, footer=f"Agreement {agreement['id']} · PDF version {version}")
    document.heading(title)
    document.paragraph(
        f"Prepared in TenantVoice by {owner} for {tenant}, from the approved rental application for "
        f"{listing.get('title') or 'this home'}. Agreement reference {agreement['id']}, PDF version {version}.",
        size=9, gray=True,
    )
    document.subheading("1. Parties").fields([("Landlord", owner), ("Tenant", tenant)])
    document.subheading("2. Premises").fields([
        ("Address", _address(listing.get("properties")) or "As listed in TenantVoice"),
        ("Listing", listing.get("title") or "Rental listing"),
    ])
    document.subheading("3. Term").fields([
        ("Starts", _long_date(agreement["start_date"])),
        ("Ends", _long_date(agreement["end_date"]) if agreement.get("end_date")
         else "No end date: the tenancy continues until it is ended as the law allows."),
    ])
    document.subheading("4. Rent").fields([
        ("Rent", f"{rent} ({agreement.get('currency') or 'AUD'})"),
        ("First payment due", _long_date(agreement["first_due_date"])),
        ("How to pay", form.get("payment_details") or "As the landlord and the tenant agree in writing."),
    ])
    document.subheading("5. Bond").fields([
        ("Bond", _money(form["bond_amount"]) if form.get("bond_amount") is not None else "No bond is set in this agreement."),
    ])
    document.subheading("6. Occupants and pets").fields([
        ("Most occupants", str(form["max_occupants"]) if form.get("max_occupants") else "Not set in this agreement"),
        ("Pets", pets),
    ])
    document.subheading("7. Utilities and other charges").paragraph(
        form.get("utilities") or "As the law sets out and the landlord and the tenant agree.")
    document.subheading("8. Special conditions").paragraph(form.get("special_conditions") or "None.")
    document.subheading("9. About this document").paragraph(
        "This PDF records the terms the landlord and the tenant agreed in TenantVoice. It does not take away "
        "any right or duty that tenancy law gives either of them.", size=9, gray=True)
    document.page_break().heading("Signing page").paragraph(
        "Each party signs this PDF in TenantVoice by typing their full name after reading it. TenantVoice "
        "records the typed name, the time, the consent statement shown and the SHA-256 fingerprint of this "
        "exact PDF, so both can check that they signed the same document. The tenant signs first, then the "
        "landlord."
    )
    document.signature("Tenant", tenant, "Signed electronically in TenantVoice")
    document.signature("Landlord", owner, "Signed electronically in TenantVoice")
    return document.render(), f"{_file_stem(title)}.pdf"


def _sendable(agreement_id: str, current: CurrentProfile) -> tuple[dict, dict]:
    """The owner's draft that can still take a new PDF, and its context; 409 once it cannot."""
    agreement, role = _for_party(agreement_id, current)
    if role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner sends the lease PDF.")
    context = _context([agreement])
    if (agreement.get("status") or "").upper() != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, "This lease is no longer a draft.")
    if agreement.get("tenant_confirmed_at") or context["tenant_signatures"].get(agreement["id"]):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "The tenant has confirmed this lease, so its PDF can no longer change.")
    return agreement, context


def preview(current: CurrentProfile, agreement_id: str, form: dict) -> dict:
    """The PDF the guided form makes, to look at before sending it; nothing is stored."""
    agreement, context = _sendable(agreement_id, current)
    version = len(context["documents"].get(agreement["id"], [])) + 1
    data, filename = lease_pdf(agreement, form, version, context)
    return {"sha256": _sha256(data), "filename": filename, "size": len(data),
            "pdf_base64": base64.b64encode(data).decode("ascii")}


def send_generated(current: CurrentProfile, agreement_id: str, form: dict, preview_sha256: str) -> dict:
    """Store and register the guided form's PDF: the one the owner previewed, or 409."""
    agreement, context = _sendable(agreement_id, current)
    documents = context["documents"].get(agreement["id"], [])
    if documents and _content_of(documents[0]) == preview_sha256[:12]:
        return _out(agreement, current.id, context)  # a repeated send: that PDF is already the latest
    data, filename = lease_pdf(agreement, form, len(documents) + 1, context)
    if _sha256(data) != preview_sha256:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "The lease changed after you previewed it. Preview it again, then send it.")
    return _store(current, agreement, documents, data, filename)


def send_uploaded(current: CurrentProfile, agreement_id: str, upload: UploadFile) -> dict:
    """Store and register a PDF the owner made elsewhere."""
    agreement, context = _sendable(agreement_id, current)
    declared = (upload.content_type or "").split(";")[0].strip()
    data = upload.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The PDF is too large (max 10 MB).")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.")
    if declared != PDF_TYPE or not data.startswith(b"%PDF-"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload the lease as a PDF.")
    filename = uploads._verification_filename(upload.filename, PDF_TYPE)
    return _store(current, agreement, context["documents"].get(agreement["id"], []), data, filename)


def _content_of(document: dict) -> str | None:
    """The content hash prefix a PDF's storage path ends with (lease-v<n>-<12 hex>.pdf), or None."""
    match = re.search(r"-([0-9a-f]{12})\.pdf$", document.get("storage_path") or "")
    return match.group(1) if match else None


def _registered(agreement_id: str, path: str) -> bool:
    return bool(_db().table(DOCUMENTS).select("id").eq("agreement_id", agreement_id).eq("storage_path", path)
                .limit(1).execute().data)


def _storage_status(exc: Exception) -> str:
    return str(getattr(exc, "status", "") or getattr(exc, "statusCode", "") or "")


def _store(current: CurrentProfile, agreement: dict, documents: list[dict], data: bytes, filename: str) -> dict:
    """Store a PDF as the owner, at a path that names its version and content, then register it.

    The path makes a repeated send of the same PDF land on the same object,
    which Storage refuses to overwrite, and on the same document row, which is
    unique: either way the PDF registered first is the answer.
    """
    sha = _sha256(data)
    agreement_id = agreement["id"]
    if documents and _content_of(documents[0]) == sha[:12]:
        return _lease(agreement_id, current)  # that PDF is already the latest
    path = f"{agreement_id}/lease-v{len(documents) + 1}-{sha[:12]}.pdf"
    scanned = uploads.scan(data)
    if not current.access_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in again to continue.")
    stored_here = True
    try:
        with user_storage(current.access_token) as owner:
            owner.storage.from_(BUCKET).upload(path, data, {"content-type": PDF_TYPE, "upsert": "false", "metadata": scanned})
    except Exception as exc:
        code = _storage_status(exc)
        if code == "409" or "already exists" in str(exc).lower():
            stored_here = False  # a repeated send stored it a moment ago
        elif code == "403" or "row-level security" in str(exc).lower():
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "The lease changed while its PDF was uploading. Reload it and try again.") from exc
        elif code == "413":
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The PDF is too large (max 10 MB).") from exc
        else:
            logger.error("could not store a lease PDF for %s: %s", agreement_id, exc)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "Could not store the lease PDF. Please try again.") from exc
    try:
        _rpc(current, "mobile_register_tenant_lease_document", {
            "p_agreement_id": agreement_id, "p_storage_path": path, "p_original_filename": filename,
        })
    except APIError as exc:
        if not _registered(agreement_id, path):
            if stored_here:
                _remove(path)
            _raise(exc)
    return _lease(agreement_id, current)


def _remove(path: str) -> None:
    """Delete a stored PDF nothing registered: the bucket is public. Never raises."""
    try:
        _service().storage.from_(BUCKET).remove([path])
    except Exception as exc:
        logger.warning("could not remove an unregistered lease PDF %s: %s", path, exc)


def _download(path: str) -> bytes:
    try:
        data = _service().storage.from_(BUCKET).download(path)
    except Exception as exc:
        logger.error("could not read the lease PDF %s: %s", path, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The lease PDF could not be read right now. Please try again.") from exc
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The lease PDF could not be read right now. Please try again.")
    return bytes(data)


def document_file(current: CurrentProfile, agreement_id: str, document_id: str) -> tuple[bytes, str]:
    """The bytes and file name of the lease's latest PDF, for its tenant or owner; an older one is 410."""
    agreement, _role = _for_party(agreement_id, current)
    documents = _documents([agreement["id"]]).get(agreement["id"], [])
    document = next((row for row in documents if row["id"] == document_id), None) if is_uuid(document_id) else None
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lease PDF not found.")
    if document is not documents[0]:
        raise HTTPException(status.HTTP_410_GONE, "A newer lease PDF replaced this one. Open the latest version.")
    return _download(document["storage_path"]), document["original_filename"]


# ---------------------------------------------------------------------------
# Confirming, signing and activating
# ---------------------------------------------------------------------------
def _latest(agreement_id: str) -> dict | None:
    documents = _documents([agreement_id]).get(agreement_id, [])
    return documents[0] if documents else None


def confirm(current: CurrentProfile, agreement_id: str, document_id: str) -> dict:
    """The tenant confirms the terms of the latest PDF, which they name (mobile_tenant_confirm_rent_agreement)."""
    agreement, role = _for_party(agreement_id, current)
    if role != "tenant":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the tenant confirms the lease terms.")
    if agreement.get("tenant_confirmed_at"):
        return _lease(agreement_id, current)  # confirmed already: a repeated request
    if (agreement.get("status") or "").upper() != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, "This lease is no longer a draft.")
    latest = _latest(agreement["id"])
    if latest is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner has not sent the lease PDF yet.")
    if latest["id"] != document_id:
        raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
    try:
        _rpc(current, "mobile_tenant_confirm_rent_agreement", {"p_agreement_id": agreement["id"]})
    except APIError as exc:
        if not _agreement(agreement["id"]).get("tenant_confirmed_at"):
            _raise(exc)
    return _lease(agreement_id, current)


def _insert_signature(table: str, row: dict, already: Callable[[], bool]) -> None:
    """Insert one signature row; a repeated request whose signature is already there (already()) is fine."""
    try:
        _db().table(table).insert(stamp_insert(table, row)).execute()
    except APIError as exc:
        if exc.code == "23505" and already():
            return
        _raise(exc)


def tenant_sign(current: CurrentProfile, agreement_id: str, document_id: str, signer_name: str) -> dict:
    """The tenant signs the latest PDF, which they name, with their typed name and the stored PDF's SHA-256."""
    agreement, role = _for_party(agreement_id, current)
    if role != "tenant":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the tenant signs the lease here.")

    def signed_already() -> bool:
        signature = _signatures(TENANT_SIGNATURES, [agreement["id"]]).get(agreement["id"])
        if signature is None:
            return False
        if signature.get("signer_user_id") == current.id and signature.get("document_id") == document_id:
            return True
        raise HTTPException(status.HTTP_409_CONFLICT, "This lease is already signed by the tenant.")

    if signed_already():
        return _lease(agreement_id, current)
    if (agreement.get("status") or "").upper() != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a draft lease can be signed.")
    if not agreement.get("tenant_confirmed_at"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirm the lease terms before you sign.")
    latest = _latest(agreement["id"])
    if latest is None or latest["id"] != document_id:
        raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
    data = _download(latest["storage_path"])
    _insert_signature(TENANT_SIGNATURES, {
        "agreement_id": agreement["id"],
        "document_id": latest["id"],
        "signer_user_id": current.id,
        "signer_name": signer_name,
        "signing_method": SIGNING_METHOD,
        "consent_text": TENANT_CONSENT,
        "consent_version": TENANT_CONSENT_VERSION,
        "document_storage_path": latest["storage_path"],
        "document_sha256": _sha256(data),
    }, signed_already)
    return _lease(agreement_id, current)


def owner_sign(current: CurrentProfile, agreement_id: str, signer_name: str) -> dict:
    """The owner signs the PDF the tenant signed: same document, same path and the same SHA-256 of its bytes."""
    agreement, role = _for_party(agreement_id, current)
    if role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner countersigns the lease.")
    tenant_signature = _signatures(TENANT_SIGNATURES, [agreement["id"]]).get(agreement["id"])

    def signed_already() -> bool:
        signature = _signatures(OWNER_SIGNATURES, [agreement["id"]]).get(agreement["id"])
        if signature is None:
            return False
        if (signature.get("owner_user_id") == current.id and tenant_signature
                and signature.get("tenant_signature_id") == tenant_signature["id"]):
            return True
        raise HTTPException(status.HTTP_409_CONFLICT, "This lease is already signed by the owner.")

    if signed_already():
        return _lease(agreement_id, current)
    if (agreement.get("status") or "").upper() != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a draft lease can be signed.")
    if tenant_signature is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The tenant has not signed the lease yet.")
    latest = _latest(agreement["id"])
    if not _on_document(tenant_signature, latest):
        raise HTTPException(status.HTTP_409_CONFLICT, "The document version has changed.")
    sha = _sha256(_download(tenant_signature["document_storage_path"]))
    if sha != tenant_signature.get("document_sha256"):
        logger.error("the stored lease PDF of %s no longer has the hash the tenant signed", agreement["id"])
        raise HTTPException(status.HTTP_409_CONFLICT, "The stored lease PDF no longer matches the one the tenant signed.")
    _insert_signature(OWNER_SIGNATURES, {
        "agreement_id": agreement["id"],
        "tenant_signature_id": tenant_signature["id"],
        "document_id": tenant_signature["document_id"],
        "owner_user_id": current.id,
        "signer_name": signer_name,
        "signing_method": SIGNING_METHOD,
        "consent_text": OWNER_CONSENT,
        "consent_version": OWNER_CONSENT_VERSION,
        "document_storage_path": tenant_signature["document_storage_path"],
        "document_sha256": sha,
    }, signed_already)
    return _lease(agreement_id, current)


def activate(current: CurrentProfile, agreement_id: str) -> dict:
    """The owner activates a lease both signed (mobile_owner_activate_rent_agreement); the tenant is notified by the database."""
    agreement, role = _for_party(agreement_id, current)
    if role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner activates the lease.")
    state = (agreement.get("status") or "").upper()
    if state == "ACTIVE":
        return _lease(agreement_id, current)
    if state != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, "This lease is no longer a draft.")
    if _out(agreement, current.id, _context([agreement]))["stage"] != "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Both of you sign the latest lease PDF before it is activated.")
    try:
        _rpc(current, "mobile_owner_activate_rent_agreement", {"p_agreement_id": agreement["id"]})
    except APIError as exc:
        if (_agreement(agreement["id"]).get("status") or "").upper() != "ACTIVE":
            if exc.code == "23505":
                raise HTTPException(status.HTTP_409_CONFLICT, "This listing already has an active lease.") from exc
            _raise(exc)
    return _lease(agreement_id, current)
