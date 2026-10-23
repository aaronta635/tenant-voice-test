"""Rental applications on the shared rental_applications table (plan §3 a6, R25).

A web "property" id is a listing id. The shared database's functions make
every status change, as the mobile app's do, so both apps keep one set of
rules (docs/shared-db.md):

- **Applying.** submit_rental_application, after the web's verification
  gate (the mobile's own mobile_submit_application asks for an approved
  account too). It takes a published listing only, and sends again an
  application that was declined, withdrawn or has expired; an open or
  approved one is a 409. It notifies the owner. The tenant sends what they
  choose to share: the apply form prefills it from their profile in the
  browser, and the server copies nothing from the profile. It is kept in
  metadata.mobile under the keys the mobile app reads (maps_rental
  MOBILE_DETAILS), written after the call, which replaces the metadata of
  an application sent again.
- **Deciding.** review_rental_application, with the owner's users.id: only
  the property's owner, an active LANDLORD, decides, so an agent or a
  manager gets its 403. Approving leases the listing and declines every
  other open application. The function writes each step to
  application_status_events with the owner's note, and notifies the
  applicants. The web refuses a move the database would not make (409)
  before it calls.
- **Withdrawing.** mobile_withdraw_application, run as the tenant, as the
  mobile app runs it.
- **Documents.** A tenant attaches documents they marked shareable
  (profile_documents.metadata.visibility "applications", a file the web
  stored). Each is an application_documents row naming its profile document.
  The listing's owner sees and opens one only while the tenant still shares
  it and the application is open or approved (SHARING_APPLICATION_STATUSES),
  through a link signed for a few minutes at each opening.

The web itself writes only what the functions do not: the details and the
documents of an application, the owner's own score, and the submission's
step in application_status_events (submit_rental_application keeps none).
"""

import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client
from app.schemas.profiles import sydney_today
from app.services import _common, audit, documents, gates, public_profiles, uploads, verification_rules
from app.services.maps_messaging import is_uuid
from app.services.maps_rental import (
    APPLICANT_SNAPSHOT_KEY,
    LEASE_DURATION_KEY,
    MOBILE_DETAILS,
    MOBILE_KEY,
    OPEN_LISTING,
    PROFILE_DOCUMENT_KEY,
    PUBLIC_LISTING_STATUSES,
    RESUBMITTABLE_APPLICATION_STATUSES,
    SHARING_APPLICATION_STATUSES,
    WITHDRAWABLE_APPLICATION_STATUSES,
    application_stage,
    application_statuses,
    decision_refusal,
    function_error,
    function_errors,
    lease_duration,
    mobile_date,
    same_instant,
)
from app.services.notifications import notify
from app.services.properties import cover_photos, listing_row, owned_listing, owns
from app.services.shared_map import (
    db_application_status,
    flatten_application,
    stamp_insert,
    stamp_update,
    web_application_status,
)

logger = logging.getLogger(__name__)

NOT_FOUND = "Application not found"
DOCUMENT_NOT_FOUND = "Document not found"
TABLE = "rental_applications"
EVENTS = "application_status_events"
DOCUMENTS = "application_documents"
# What a tenant shares when applying, kept in metadata.mobile (MOBILE_DETAILS).
SNAPSHOT_FIELDS = tuple(MOBILE_DETAILS)
NOT_SHAREABLE = "Only documents you chose to share with landlords can go with an application."
ALREADY_APPLIED = "You have already applied to this property"
CHANGED_MEANWHILE = "This application changed while you were deciding. Reload it and try again."


def _supabase():
    return get_supabase_client()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _metadata(row: dict) -> dict:
    return row.get("metadata") if isinstance(row.get("metadata"), dict) else {}


def _text(value) -> str | None:
    """Text on one line, its spaces collapsed; an empty one is no text."""
    text = " ".join(value.split()) if isinstance(value, str) else ""
    return text or None


def _paragraphs(value) -> str | None:
    """Free text as typed, trimmed; an empty one is no text."""
    text = value.strip() if isinstance(value, str) else ""
    return text or None


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------
def _shared_details(row: dict) -> dict:
    """What the tenant shared, by SNAPSHOT_FIELDS.

    From metadata.mobile, where the web keeps it and where the mobile app
    keeps its own applications' details. An application the web saved
    before that kept them in metadata.applicant_snapshot, and one older still
    kept annual_income, move_in_date and has_pets at the top of metadata.
    """
    meta = _metadata(row)
    mobile = meta.get(MOBILE_KEY) if isinstance(meta.get(MOBILE_KEY), dict) else None
    if mobile is not None:
        return {field: mobile.get(key) for field, key in MOBILE_DETAILS.items()}
    snapshot = meta.get(APPLICANT_SNAPSHOT_KEY) if isinstance(meta.get(APPLICANT_SNAPSHOT_KEY), dict) else None
    if snapshot is not None:
        return {field: snapshot.get(field) for field in SNAPSHOT_FIELDS}
    return {field: meta.get(field) for field in ("move_in_date", "has_pets", "annual_income")}


def _number(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _application_out(row: dict) -> dict:
    """ApplicationOut without the documents, history and people: the row and what the tenant shared.

    Values another app wrote are shown only when they read as the web's
    (a date, a whole number of people), so an odd one never fails the list.
    """
    out = flatten_application(row)
    shared = _shared_details(row)
    move_in = shared.get("move_in_date")
    occupants = shared.get("occupants")
    out.update(
        annual_income=_number(shared.get("annual_income")),
        move_in_date=move_in if isinstance(move_in, date) else mobile_date(move_in),
        has_pets=shared.get("has_pets") is True,
        stage=application_stage(row.get("status")),
        can_withdraw=row.get("status") in WITHDRAWABLE_APPLICATION_STATUSES,
        occupants=occupants if isinstance(occupants, int) and not isinstance(occupants, bool) else None,
        pets=_text(shared.get("pets")),
        about=_paragraphs(shared.get("about")),
        documents=[],
        history=[],
        listing=None,
    )
    return out


def _events_by_application(application_ids: list[str]) -> dict[str, list[dict]]:
    rows = _common.select_in(
        lambda: _supabase().table(EVENTS).select("*").order("created_at").order("id"),
        "application_id",
        application_ids,
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["application_id"], []).append(row)
    return grouped


def _event_out(event: dict, applicant_id: str, prop: dict | None) -> dict:
    actor = event.get("changed_by_user_id")
    by = "applicant" if actor and actor == applicant_id else "landlord" if actor and owns(prop, actor) else None
    return {
        "from_stage": application_stage(event["from_status"]) if event.get("from_status") else None,
        "to_stage": application_stage(event.get("to_status")),
        "note": _paragraphs(event.get("note")),
        "by": by,
        "created_at": event.get("created_at"),
    }


def _shared(document: dict | None, applicant_id: str) -> bool:
    """Whether a profile document is one its owner shares with landlords: theirs, marked shareable, on file."""
    return (
        document is not None
        and document.get("user_id") == applicant_id
        and _metadata(document).get(documents.VISIBILITY_KEY) == documents.APPLICATIONS
        and uploads.owned_path(document.get("file_url"), documents.BUCKET, uploads.verification_folder(applicant_id))
        is not None
    )


def _attached(application_ids: list[str]) -> dict[str, list[tuple[dict, dict | None]]]:
    """Each application's application_documents rows, with the profile document each names (or None)."""
    rows = _common.select_in(
        lambda: _supabase().table(DOCUMENTS).select("*").order("created_at").order("id"),
        "application_id",
        application_ids,
    )
    profile_ids = [
        _metadata(row).get(PROFILE_DOCUMENT_KEY) for row in rows if is_uuid(_metadata(row).get(PROFILE_DOCUMENT_KEY))
    ]
    profile_documents = {
        row["id"]: row
        for row in _common.select_in(
            lambda: _supabase().table(documents.TABLE).select("*").order("id"), "id", profile_ids
        )
    }
    grouped: dict[str, list[tuple[dict, dict | None]]] = {}
    for row in rows:
        grouped.setdefault(row["application_id"], []).append(
            (row, profile_documents.get(_metadata(row).get(PROFILE_DOCUMENT_KEY)))
        )
    return grouped


def _documents_out(pairs: list[tuple[dict, dict | None]], applicant_id: str, *, shared_only: bool) -> list[dict]:
    """The documents that went with an application, by name: one request attaches them all at once."""
    shown = [_document_out(attached, document, applicant_id) for attached, document in pairs]
    if shared_only:
        shown = [document for document in shown if document["shared"]]
    return sorted(shown, key=lambda document: (document["label"].casefold(), document["id"]))


def _document_out(attached: dict, document: dict | None, applicant_id: str) -> dict:
    shared = _shared(document, applicant_id)
    if document is not None:
        shown = documents.document_out(document, folder=None)
        label, verified = shown["label"], shown["status"] == "verified"
    else:
        known = verification_rules.DOCUMENT_TYPES.get(attached.get("document_type"))
        label, verified = (known.label if known else str(attached.get("document_type") or "Document")), False
    return {
        "id": attached["id"],
        "document_type": attached.get("document_type"),
        "label": label,
        "verified": verified,
        "shared": shared,
    }


def _listing_summaries(listing_ids: list[str]) -> tuple[dict[str, dict], dict[str, dict]]:
    """({listing id: ApplicationListingOut}, {listing id: its properties row}) for a tenant's list."""
    listings = _common.select_in(
        lambda: _supabase().table("listings").select("id, title, weekly_rent, status, property_id").order("id"),
        "id",
        listing_ids,
    )
    props = {
        row["id"]: row
        for row in _common.select_in(
            lambda: _supabase().table("properties").select("*").order("id"),
            "id",
            [listing["property_id"] for listing in listings],
        )
    }
    photos = cover_photos(list(props))
    summaries, by_listing = {}, {}
    for listing in listings:
        prop = props.get(listing["property_id"]) or {}
        by_listing[listing["id"]] = prop
        summaries[listing["id"]] = {
            "id": listing["id"],
            "title": listing.get("title") or prop.get("nickname") or "Listing",
            "suburb": prop.get("suburb"),
            "state": prop.get("state"),
            "photo_url": photos.get(listing["property_id"]),
            "weekly_rent": float(listing["weekly_rent"]) if listing.get("weekly_rent") is not None else None,
            "is_public": listing.get("status") in PUBLIC_LISTING_STATUSES,
        }
    return summaries, by_listing


def _for_tenant(rows: list[dict]) -> list[dict]:
    """The tenant's applications, each with its listing, history and the documents that went with it."""
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    summaries, props = _listing_summaries(list({row["listing_id"] for row in rows}))
    events = _events_by_application(ids)
    attached = _attached(ids)
    applications = []
    for row in rows:
        out = _application_out(row)
        applicant, prop = row["applicant_user_id"], props.get(row["listing_id"])
        out["listing"] = summaries.get(row["listing_id"])
        out["history"] = [_event_out(event, applicant, prop) for event in events.get(row["id"], [])]
        out["documents"] = _documents_out(attached.get(row["id"], []), applicant, shared_only=False)
        applications.append(out)
    return applications


def _for_landlord(rows: list[dict], prop: dict) -> list[dict]:
    """A listing's applications as its owner sees them: who applied, with their badge and
    rating, what they shared, the documents they still share and the history. Never the
    applicant's phone or email: the tenant did not share them, and owners message in the app."""
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    applicant_ids = list({row["applicant_user_id"] for row in rows})
    people = {
        person["id"]: person
        for person in _common.select_in(
            lambda: _supabase().table("users").select("id, full_name").order("id"), "id", applicant_ids
        )
    }
    trust = public_profiles.trust_of(applicant_ids)
    events = _events_by_application(ids)
    attached = _attached(ids)
    applications = []
    for row in rows:
        out = _application_out(row)
        applicant = row["applicant_user_id"]
        person, rated = people.get(applicant) or {}, trust.get(applicant) or {}
        out.update(
            tenant_name=person.get("full_name"),
            tenant_verified=bool(rated.get("verified")),
            tenant_rating_avg=rated.get("rating_avg"),
            tenant_review_count=rated.get("review_count", 0),
        )
        out["history"] = [_event_out(event, applicant, prop) for event in events.get(row["id"], [])]
        if row.get("status") in SHARING_APPLICATION_STATUSES:
            out["documents"] = _documents_out(attached.get(row["id"], []), applicant, shared_only=True)
        applications.append(out)
    return applications


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def _record_status(application_id: str, from_status: str | None, to_status: str, actor_id: str,
                   note: str | None = None) -> None:
    """Add a step to the application's timeline. Never raises: the application is saved already."""
    try:
        _supabase().table(EVENTS).insert(
            {
                "application_id": application_id,
                "from_status": from_status,
                "to_status": to_status,
                "changed_by_user_id": actor_id,
                "note": note,
            }
        ).execute()
    except Exception as exc:
        logger.error("application status event write failed for %s: %s", application_id, exc)


def _shareable_documents(tenant_id: str, document_ids: list[str]) -> list[dict]:
    """The tenant's profile documents to attach, in the order sent; 422 unless every one is shareable."""
    wanted = list(dict.fromkeys(document_ids))
    if not wanted:
        return []
    if not all(is_uuid(document_id) for document_id in wanted):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NOT_SHAREABLE)
    rows = {
        row["id"]: row
        for row in _supabase().table(documents.TABLE).select("*").eq("user_id", tenant_id).in_("id", wanted)
        .execute().data or []
    }
    if any(not _shared(rows.get(document_id), tenant_id) for document_id in wanted):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NOT_SHAREABLE)
    return [rows[document_id] for document_id in wanted]


def _snapshot(payload: dict) -> dict:
    """What the tenant shared, as sent: free text trimmed, an empty field kept as null."""
    snapshot = {field: payload.get(field) for field in SNAPSHOT_FIELDS}
    snapshot["has_pets"] = bool(payload.get("has_pets"))
    snapshot["pets"] = _text(payload.get("pets")) if snapshot["has_pets"] else None
    snapshot["about"] = _paragraphs(payload.get("about"))
    return snapshot


def _mobile_details(payload: dict, listing: dict) -> dict:
    """What the tenant shared, by the keys metadata.mobile keeps it under, leaving out what they left out.

    leaseDuration is the listing's lease term, the one the tenant applies for
    (mobile_my_rental_history reads it when the listing gives none).
    """
    snapshot = _snapshot(payload)
    details = {MOBILE_DETAILS[field]: snapshot[field] for field in SNAPSHOT_FIELDS if snapshot[field] is not None}
    if duration := lease_duration(listing.get("lease_term_months")):
        details[LEASE_DURATION_KEY] = duration
    return details


def _application_for(listing_id: str, tenant_id: str) -> dict | None:
    """The tenant's application for a listing: one at most (rental_applications_listing_id_applicant_user_id_key)."""
    rows = (
        _supabase().table(TABLE).select("*").eq("listing_id", listing_id).eq("applicant_user_id", tenant_id)
        .limit(1).execute().data or []
    )
    return rows[0] if rows else None


def _keep_details(row: dict, details: dict, now: datetime) -> dict:
    """Merge the tenant's details into metadata.mobile, after submit_rental_application wrote the metadata."""
    meta = dict(_metadata(row))
    mobile = dict(meta[MOBILE_KEY]) if isinstance(meta.get(MOBILE_KEY), dict) else {}
    meta[MOBILE_KEY] = {**mobile, **details}
    return (
        _supabase().table(TABLE).update(stamp_update(TABLE, {"metadata": meta}, now)).eq("id", row["id"])
        .execute().data[0]
    )


def _attach(application_id: str, attachments: list[dict], *, replace: bool) -> None:
    """Make the application's documents exactly the ones the tenant chose this time."""
    supabase = _supabase()
    if replace:
        # Sent again, an application goes with the documents chosen now, not those it went with before.
        supabase.table(DOCUMENTS).delete().eq("application_id", application_id).execute()
    if attachments:
        supabase.table(DOCUMENTS).insert([
            stamp_insert(DOCUMENTS, {
                "application_id": application_id,
                "document_type": document["document_type"],
                "file_url": document["file_url"],
                "metadata": {PROFILE_DOCUMENT_KEY: document["id"]},
            })
            for document in attachments
        ]).execute()


def _notify_manager(listing: dict, tenant_id: str, *, again: bool) -> None:
    """Tell the property's manager: submit_rental_application tells only its owner."""
    rows = _supabase().table("properties").select("owner_user_id, manager_user_id").eq(
        "id", listing["property_id"]).limit(1).execute().data
    manager = rows[0].get("manager_user_id") if rows else None
    if not manager or manager == rows[0].get("owner_user_id"):
        return
    applicant = _supabase().table("users").select("full_name").eq("id", tenant_id).limit(1).execute().data
    name = (applicant[0].get("full_name") if applicant else None) or "A tenant"
    title = listing.get("title") or "your listing"
    notify(
        manager, "application",
        f"Application resubmitted for {title}" if again else f"New application for {title}",
        f"{name} applied again." if again else f"{name} applied.",
        f"/owner/properties/{listing['id']}?tab=applications",
    )


def create_application(tenant_id: str, payload: dict) -> dict:
    """Apply through submit_rental_application, or apply again once an application was closed.

    Nothing is written when a check fails: the verification gate (R18), a
    listing that takes no applications (404), a past move-in date (422), an
    open or approved application already there (409) or a document that is
    not shareable (422).
    """
    # Only a verified tenant applies (R18); the account is read again here.
    gates.require_verified(tenant_id, "apply")
    listing_id = payload["property_id"]
    listing = listing_row(listing_id)
    # Only a published listing takes applications: one closed to them still
    # shows as available, but the owner has stopped accepting more.
    if not listing or listing.get("status") != OPEN_LISTING:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found or not accepting applications")
    move_in = payload.get("move_in_date")
    if move_in and move_in < sydney_today().isoformat():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a move-in date from today on.")

    previous = _application_for(listing_id, tenant_id)
    if previous and previous.get("status") not in RESUBMITTABLE_APPLICATION_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_APPLIED)
    attachments = _shareable_documents(tenant_id, payload.get("document_ids") or [])

    offer = payload.get("rent_offered")
    now = _now()
    new_id = str(uuid.uuid4())
    with function_errors():
        answer = _supabase().rpc("submit_rental_application", {
            "p_application_id": new_id,
            "p_listing_id": listing_id,
            "p_applicant_id": tenant_id,
            # NOT NULL: without an offer the tenant applies at the asking rent.
            "p_offer_weekly_rent": offer if offer is not None else listing["weekly_rent"],
            "p_message": _paragraphs(payload.get("message")),
            "p_role": "TENANT",
            "p_now": now.isoformat(),
        }).execute().data
    application_id = (answer or [{}])[0].get("application_id")
    rows = _supabase().table(TABLE).select("*").eq("id", application_id).limit(1).execute().data if application_id else []
    # The function answers with the application there already when another
    # request applied meanwhile, and changes nothing: this one applied nothing.
    if not rows or application_id != (previous["id"] if previous else new_id) or not same_instant(
        rows[0].get("submitted_at"), now
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_APPLIED)
    try:
        created = _keep_details(rows[0], _mobile_details(payload, listing), now)
        _attach(created["id"], attachments, replace=previous is not None)
    except Exception:
        if previous is None:
            # No application without what the tenant chose to send.
            _supabase().table(TABLE).delete().eq("id", application_id).execute()
        raise
    _record_status(created["id"], previous.get("status") if previous else None, "SUBMITTED", tenant_id)
    audit.record(
        tenant_id, "application.submitted", "property_application", created["id"],
        {"property_id": listing_id, "documents": len(attachments), "again": previous is not None},
    )
    _notify_manager(listing, tenant_id, again=previous is not None)
    return _for_tenant([created])[0]


def list_my_applications(tenant_id: str) -> list[dict]:
    rows = (
        _supabase()
        .table(TABLE)
        .select("*")
        .eq("applicant_user_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return _for_tenant(rows)


def list_property_applications(
    property_id: str, owner_id: str, status_filter: str | None = None
) -> list[dict]:
    _, prop = owned_listing(property_id, owner_id)
    query = _supabase().table(TABLE).select("*").eq("listing_id", property_id)
    if status_filter:
        try:
            query = query.in_("status", list(application_statuses(status_filter)))
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Unknown status filter. Use new, reviewing, approved or declined."
            ) from None
    rows = query.order("created_at", desc=True).execute().data or []
    return _for_landlord(rows, prop)


def _decided_status(application: dict, payload: dict) -> str:
    """The shared status an owner's edit asks for: the current one when it asks for no change."""
    current = application["status"]
    target = current
    if "status" in payload:
        try:
            wanted = db_application_status(payload["status"])
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Status must be new, reviewing, approved or declined."
            ) from None
        # A shared status the web shows the same way stays: "reviewing" keeps
        # a shortlisted application shortlisted.
        if web_application_status(current) != payload["status"]:
            target = wanted
    if payload.get("shortlisted") and payload.get("status", "reviewing") == "reviewing":
        target = "SHORTLISTED"
    return target


def _application(application_id: str) -> dict:
    rows = (
        _supabase().table(TABLE).select("*").eq("id", application_id).limit(1).execute().data
        if is_uuid(application_id) else None
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return rows[0]


def _status_now(application_id: str) -> str | None:
    rows = _supabase().table(TABLE).select("status").eq("id", application_id).limit(1).execute().data
    return rows[0]["status"] if rows else None


def _decide(application: dict, owner_id: str, target: str, note: str | None) -> None:
    """Make the owner's decision through review_rental_application, its error mapped (function_error).

    A trigger's refusal of a status the application no longer has (the
    tenant withdrew meanwhile) is a conflict, never an overwrite.
    """
    try:
        _supabase().rpc("review_rental_application", {
            "p_application_id": application["id"],
            "p_landlord_id": owner_id,
            "p_status": target,
            "p_note": note,
            "p_now": _now().isoformat(),
        }).execute()
    except APIError as exc:
        if getattr(exc, "code", None) == "22023" and _status_now(application["id"]) != application["status"]:
            raise HTTPException(status.HTTP_409_CONFLICT, CHANGED_MEANWHILE) from exc
        if (mapped := function_error(exc)) is None:
            raise
        raise mapped from exc


def update_application(application_id: str, owner_id: str, payload: dict) -> dict:
    """The owner's decision on an application, and their own score for the applicant.

    The decision goes through review_rental_application with the owner's
    users.id (module docstring): it decides for the property's owner only,
    an active LANDLORD, and refuses an agent or a manager (403). Approving
    leases the listing and declines the other open applications. A move the
    status trigger or the function would refuse is refused here first (409,
    maps_rental.decision_refusal), and a note goes only with a decision. The
    score is the web's own (metadata.tenant_score), kept for the owner or a
    manager.
    """
    application = _application(application_id)
    listing, prop = owned_listing(application["listing_id"], owner_id)

    payload = {k: v for k, v in payload.items() if v is not None}
    note = _paragraphs(payload.get("note"))
    current = application["status"]
    target = _decided_status(application, payload)
    if refusal := decision_refusal(current, target, listing["status"]):
        raise HTTPException(status.HTTP_409_CONFLICT, refusal)
    if note and target == current:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "A note goes with a decision: shortlist, approve or decline."
        )
    if target != current:
        _decide(application, owner_id, target, note)
        audit.record(
            owner_id, "application.status_changed", "property_application", application_id,
            {"status": web_application_status(target), "property_id": application["listing_id"]},
        )
    if "tenant_score" in payload:
        row = _application(application_id)  # its metadata as the decision left it
        meta = dict(_metadata(row))
        meta["tenant_score"] = payload["tenant_score"]
        _supabase().table(TABLE).update(stamp_update(TABLE, {"metadata": meta}, _now())).eq(
            "id", application_id).execute()
    return _for_landlord([_application(application_id)], prop)[0]


def withdraw_application(application_id: str, current: CurrentProfile) -> None:
    """Withdraw the tenant's own application through mobile_withdraw_application, run as the tenant.

    As in the mobile app: an application that is not theirs is 403, one the
    owner has decided is 422, and withdrawing twice changes nothing. The
    function records the step and notifies the owner.
    """
    if not is_uuid(application_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    with function_errors():
        user_client(current.access_token).rpc(
            "mobile_withdraw_application", {"p_application_id": application_id}
        ).execute()


def document_link(application_id: str, document_id: str, owner_id: str) -> dict:
    """A link, signed for a few minutes, to a document an applicant shares with this listing's owner.

    404 unless the application is the owner's listing's and still open or
    approved, the document went with it, and the tenant still shares it.
    The opening goes in the audit trail.
    """
    application = _application(application_id)
    owned_listing(application["listing_id"], owner_id)
    if application.get("status") not in SHARING_APPLICATION_STATUSES or not is_uuid(document_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, DOCUMENT_NOT_FOUND)
    pairs = _attached([application_id]).get(application_id, [])
    document = next((profile for row, profile in pairs if row["id"] == document_id), None)
    applicant = application["applicant_user_id"]
    if not _shared(document, applicant):
        raise HTTPException(status.HTTP_404_NOT_FOUND, DOCUMENT_NOT_FOUND)
    link = documents.review_links([document]).get(document["id"])
    if link is None:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not open the file. Please try again.")
    audit.record(
        owner_id, "application.document_opened", "property_application", application_id,
        {"document_id": document_id, "document_type": document["document_type"]},
    )
    return link
