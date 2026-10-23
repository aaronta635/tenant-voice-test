"""Python stand-ins for the shared database's trigger functions, run by the strict fake.

With the catalog rules on (CATALOG_RULES in tests/conftest.py), the fake reads
from app/db/shared_catalog.json which triggers a table has, when each fires
(BEFORE or AFTER, its events and UPDATE OF columns) and runs them by name, as
Postgres does (tests/fake_supabase.py, StrictSchema):

- a BEFORE trigger runs before the row's checks and refuses a write by raising;
- an AFTER trigger runs once the statement's rows are stored, and writes
  through ctx.table() and ctx.insert(), so its writes are checked and fire
  their own triggers;
- a constraint trigger INITIALLY DEFERRED runs when the request commits; an
  error there undoes the whole request.

Each stand-in is written from its function's body, as saved in
output/shared-catalog/functions/<name>.sql (snapshot of 2026-10-23), and is
called as stand_in(ctx, old, new): ctx is a tests.fake_supabase.TriggerContext
(ctx.event is TG_OP in lower case, ctx.table_name TG_TABLE_NAME, ctx.now the
statement's now()), and old and new are OLD and NEW, None where Postgres has
none. None of these functions changes NEW, so a stand-in returns nothing.
RAISE EXCEPTION without an errcode is SQLSTATE P0001.
"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from tests.fake_sql import distinct
from tests.fake_supabase import api_error

RAISED = "P0001"  # RAISE EXCEPTION 'message' without an errcode
_EMULATIONS: dict = {}


def trigger(function: str):
    """Register the decorated stand-in for the named trigger function."""

    def register(stand_in):
        if function in _EMULATIONS:
            raise ValueError(f"two stand-ins for {function}()")
        _EMULATIONS[function] = stand_in
        return stand_in

    return register


def emulation(function: str):
    """The stand-in for a trigger function, or None."""
    return _EMULATIONS.get(function)


def _id(value) -> str | None:
    """A uuid as Postgres compares and prints it (lower case)."""
    return None if value is None else str(value).lower()


def _where(rows: list[dict], **ids) -> list[dict]:
    """rows whose uuid columns equal ids, as SQL's = compares them: a NULL equals nothing."""
    wanted = {column: _id(value) for column, value in ids.items()}
    if None in wanted.values():
        return []
    return [row for row in rows if all(_id(row.get(column)) == value for column, value in wanted.items())]


def _first(rows: list[dict]) -> dict | None:
    return rows[0] if rows else None


# -- listings and applications ----------------------------------------------------
_LISTING_MOVES = {
    "DRAFT": ("PUBLISHED", "ARCHIVED"),
    "PUBLISHED": ("PAUSED", "APPLICATIONS_CLOSED", "LEASED", "ARCHIVED"),
    "PAUSED": ("PUBLISHED", "APPLICATIONS_CLOSED", "ARCHIVED"),
    "APPLICATIONS_CLOSED": ("PUBLISHED", "LEASED", "ARCHIVED"),
    "LEASED": ("ARCHIVED",),
}
_APPLICATION_MOVES = {
    "SUBMITTED": ("UNDER_REVIEW", "SHORTLISTED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"),
    "UNDER_REVIEW": ("SHORTLISTED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"),
    "SHORTLISTED": ("UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"),
    "REJECTED": ("SUBMITTED",),
    "WITHDRAWN": ("SUBMITTED",),
    "EXPIRED": ("SUBMITTED",),
}


@trigger("enforce_listing_status_transition")
def enforce_listing_status_transition(ctx, old, new):
    """listings BEFORE UPDATE OF status: only the moves the listing lifecycle allows (22023)."""
    if new["status"] == old["status"]:
        return
    if new["status"] not in _LISTING_MOVES.get(old["status"], ()):
        raise api_error("22023", f"Invalid listing status transition: {old['status']} -> {new['status']}")


@trigger("enforce_application_status_transition")
def enforce_application_status_transition(ctx, old, new):
    """rental_applications BEFORE UPDATE OF status: APPROVED is final; a closed one may only be submitted again."""
    if new["status"] == old["status"]:
        return
    if new["status"] not in _APPLICATION_MOVES.get(old["status"], ()):
        raise api_error("22023", f"Invalid application status transition: {old['status']} -> {new['status']}")


@trigger("enforce_listing_application_consistency")
def enforce_listing_application_consistency(ctx, old, new):
    """Deferred, on listings and rental_applications: a LEASED listing has exactly one APPROVED application,
    and an APPROVED application's listing is LEASED or ARCHIVED, when the transaction commits (23514)."""
    if ctx.table_name == "listings":
        listing_id = new.get("id")
    elif ctx.table_name == "rental_applications":
        listing_id = new.get("listing_id")
    else:
        raise api_error("22023", f"Unsupported consistency trigger table: {ctx.table_name}")
    listing = _first(_where(ctx.rows("listings"), id=listing_id or None))
    status = listing["status"] if listing else None
    approved = sum(1 for row in _where(ctx.rows("rental_applications"), listing_id=listing_id or None)
                   if row["status"] == "APPROVED")
    if status == "LEASED" and approved != 1:
        raise api_error("23514", "A leased listing must have exactly one approved application")
    if approved > 0 and status is not None and status not in ("LEASED", "ARCHIVED"):
        raise api_error("23514", "An approved application requires a leased or archived listing")


@trigger("enforce_listing_creator_access")
def enforce_listing_creator_access(ctx, old, new):
    """listings BEFORE INSERT OR UPDATE OF property_id, created_by_user_id: the creator owns or manages it."""
    creator = _id(new.get("created_by_user_id"))
    if creator is None or not any(creator in (_id(row.get("owner_user_id")), _id(row.get("manager_user_id")))
                                  for row in _where(ctx.rows("properties"), id=new.get("property_id"))):
        raise api_error("23514", "Listing creator must own or manage the property")


@trigger("enforce_conversation_application_listing_match")
def enforce_conversation_application_listing_match(ctx, old, new):
    """conversations BEFORE INSERT OR UPDATE OF application_id, listing_id: the application is the listing's."""
    if new.get("application_id") is None or new.get("listing_id") is None:
        return
    if not _where(ctx.rows("rental_applications"), id=new["application_id"], listing_id=new["listing_id"]):
        raise api_error("23514", "Conversation application_id must belong to conversation listing_id")


# -- roles ------------------------------------------------------------------------
@trigger("sync_primary_role_assignment")
def sync_primary_role_assignment(ctx, old, new):
    """users AFTER INSERT OR UPDATE OF primary_role: the primary role's assignment is the primary one.

    As the body: insert (or, on conflict (user_id, role), mark primary) the
    new primary role first, then unmark the others. So changing a user's
    primary role trips user_role_assignments_one_primary_per_user_key (23505)
    while the old assignment is still primary, as on the live database.
    """
    assignments = _where(ctx.rows("user_role_assignments"), user_id=new["id"])
    same = [row for row in assignments if row["role"] == new["primary_role"]]
    if same:
        ctx.table("user_role_assignments").update({"is_primary": True}).eq("id", same[0]["id"]).execute()
    else:
        ctx.insert("user_role_assignments", {"id": str(uuid.uuid4()), "user_id": new["id"],
                                             "role": new["primary_role"], "is_primary": True, "created_at": ctx.now})
    (ctx.table("user_role_assignments").update({"is_primary": False}).eq("user_id", new["id"])
     .neq("role", new["primary_role"]).eq("is_primary", True).execute())


@trigger("guard_primary_role_assignment")
def guard_primary_role_assignment(ctx, old, new):
    """user_role_assignments BEFORE INSERT OR DELETE OR UPDATE OF role, is_primary: is_primary follows users."""
    user = _first(_where(ctx.rows("users"), id=(new or old)["user_id"]))
    primary = user["primary_role"] if user else None
    if ctx.event == "delete":
        if primary is not None and old["role"] == primary:
            raise api_error("23514", "The assignment for a user primary role cannot be deleted")
        return
    if primary is None:  # no users row: every comparison is unknown
        return
    if new["role"] == primary and new["is_primary"] is False:
        raise api_error("23514", "The assignment matching users.primary_role must be primary")
    if new["role"] != primary and new["is_primary"] is True:
        raise api_error("23514", "Only the assignment matching users.primary_role can be primary")


# -- rent agreements and lease signing ----------------------------------------------
def _latest_document(ctx, agreement_id) -> dict | None:
    """The agreement's newest tenant_lease_documents row: ORDER BY created_at DESC, id DESC LIMIT 1."""
    documents = _where(ctx.rows("tenant_lease_documents"), agreement_id=agreement_id)
    return max(documents, default=None,
               key=lambda row: (ctx.typed("tenant_lease_documents", "created_at", row["created_at"]), _id(row["id"])))


def rent_agreement_has_matching_signatures(ctx, agreement_id) -> bool:
    """public.rent_agreement_has_matching_signatures(): both parties signed the agreement's latest PDF."""
    agreement = _first(_where(ctx.rows("rent_agreements"), id=agreement_id))
    if agreement is None:
        return False
    latest = _latest_document(ctx, agreement["id"])
    for signature in _where(ctx.rows("tenant_lease_signatures"), agreement_id=agreement["id"],
                            signer_user_id=agreement["tenant_user_id"]):
        document = _first(_where(ctx.rows("tenant_lease_documents"), id=signature["document_id"],
                                 agreement_id=agreement["id"]))
        if document is None or latest is None or _id(document["id"]) != _id(latest["id"]):
            continue
        for owner in _where(ctx.rows("rent_agreement_owner_signatures"), agreement_id=agreement["id"],
                            tenant_signature_id=signature["id"], owner_user_id=agreement["owner_user_id"]):
            if (_id(owner["document_id"]) == _id(signature["document_id"])
                    and owner["document_sha256"] == signature["document_sha256"]
                    and signature["document_storage_path"] == document["storage_path"]
                    and owner["document_storage_path"] == document["storage_path"]):
                return True
    return False


@trigger("guard_rent_agreement_activation")
def guard_rent_agreement_activation(ctx, old, new):
    """rent_agreements BEFORE INSERT OR UPDATE: ACTIVE only after both signatures on the latest PDF."""
    if ctx.event == "insert":
        if new["status"] == "ACTIVE":
            raise api_error(RAISED, "New rental agreements cannot start as ACTIVE.")
        return
    if new["status"] == "ACTIVE" and old["status"] != "ACTIVE":
        if not rent_agreement_has_matching_signatures(ctx, new["id"]):
            raise api_error(RAISED, "Cannot activate agreement without matching tenant and owner signatures.")


_AGREED_TERMS = ("application_id", "listing_id", "tenant_user_id", "owner_user_id", "rent_amount", "rent_frequency",
                 "currency", "start_date", "end_date", "first_due_date")


@trigger("guard_signed_rent_agreement")
def guard_signed_rent_agreement(ctx, old, new):
    """rent_agreements BEFORE DELETE OR UPDATE: once the tenant signed, kept, and its terms fixed."""
    if not _where(ctx.rows("tenant_lease_signatures"), agreement_id=old["id"]):
        return
    if ctx.event == "delete":
        raise api_error(RAISED, "A signed rental agreement cannot be deleted")
    if any(distinct(ctx.typed("rent_agreements", column, new.get(column)),
                    ctx.typed("rent_agreements", column, old.get(column))) for column in _AGREED_TERMS):
        raise api_error(RAISED, "Agreed rental terms cannot change after signing")


@trigger("guard_tenant_lease_documents")
def guard_tenant_lease_documents(ctx, old, new):
    """tenant_lease_documents BEFORE INSERT OR DELETE OR UPDATE: insert only, and only before signing."""
    if ctx.event != "insert":
        raise api_error(RAISED, "Lease document records cannot be edited or deleted")
    if not _where(ctx.rows("rent_agreements"), id=new["agreement_id"]):
        raise api_error(RAISED, "Rental agreement not found")
    if _where(ctx.rows("tenant_lease_signatures"), agreement_id=new["agreement_id"]):
        raise api_error(RAISED, "Cannot register documents after lease signing")


@trigger("guard_tenant_lease_signatures")
def guard_tenant_lease_signatures(ctx, old, new):
    """tenant_lease_signatures BEFORE INSERT OR DELETE OR UPDATE: the tenant signs a draft's latest PDF, once."""
    if ctx.event != "insert":
        raise api_error(RAISED, "Recorded signatures cannot be edited or deleted")
    agreement = _first(_where(ctx.rows("rent_agreements"), id=new["agreement_id"]))
    if agreement is None:
        raise api_error(RAISED, "Rental agreement not found")
    if agreement["status"] != "DRAFT":
        raise api_error(RAISED, "Only draft agreements can be signed")
    if _id(agreement["tenant_user_id"]) != _id(new["signer_user_id"]):
        raise api_error(RAISED, "Signer is not the agreement tenant")
    latest = _latest_document(ctx, new["agreement_id"]) or {}
    if (_id(latest.get("id")) != _id(new["document_id"])
            or latest.get("storage_path") != new["document_storage_path"]):
        raise api_error(RAISED, "Lease document has changed; review the latest PDF")


@trigger("guard_rent_agreement_owner_signature")
def guard_rent_agreement_owner_signature(ctx, old, new):
    """rent_agreement_owner_signatures BEFORE INSERT OR DELETE OR UPDATE: the owner signs the PDF the tenant did."""
    if ctx.event != "insert":
        raise api_error(RAISED, "Recorded owner signatures cannot be edited or deleted")
    agreement = _first(_where(ctx.rows("rent_agreements"), id=new["agreement_id"]))
    if agreement is None:
        raise api_error(RAISED, "Rental agreement not found")
    if agreement["status"] != "DRAFT":
        raise api_error(RAISED, "Only draft agreements can be signed")
    if _id(new["owner_user_id"]) != _id(agreement["owner_user_id"]):
        raise api_error(RAISED, "Signer is not the agreement owner")
    if not any(row["status"] == "ACTIVE" and row.get("deleted_at") is None
               for row in _where(ctx.rows("users"), id=new["owner_user_id"])):
        raise api_error(RAISED, "Active owner account required")
    signature = _first(_where(ctx.rows("tenant_lease_signatures"), agreement_id=new["agreement_id"]))
    if signature is None:
        raise api_error(RAISED, "Tenant must sign before the owner")
    if (_id(new["tenant_signature_id"]) != _id(signature["id"])
            or _id(new["document_id"]) != _id(signature["document_id"])
            or new["document_storage_path"] != signature["document_storage_path"]
            or new["document_sha256"] != signature["document_sha256"]):
        raise api_error(RAISED, "Owner and tenant signatures must reference the same PDF")
    latest = _latest_document(ctx, new["agreement_id"])
    if _id(latest["id"] if latest else None) != _id(new["document_id"]):
        raise api_error(RAISED, "The document version has changed")


@trigger("guard_tenant_lease_signature_evidence")
def guard_tenant_lease_signature_evidence(ctx, old, new):
    """tenant_lease_signature_evidence_files BEFORE INSERT OR DELETE OR UPDATE: evidence of an ACTIVE agreement's
    matching signatures, whose PDF is already in the tenant-lease-signing-evidence bucket."""
    if ctx.event != "insert":
        raise api_error(RAISED, "Recorded lease evidence cannot be edited or deleted")
    matches = False
    for agreement in _where(ctx.rows("rent_agreements"), id=new["agreement_id"]):
        if agreement["status"] != "ACTIVE":
            continue
        for signature in _where(ctx.rows("tenant_lease_signatures"), agreement_id=agreement["id"],
                                id=new["tenant_signature_id"], signer_user_id=agreement["tenant_user_id"]):
            documents = _where(ctx.rows("tenant_lease_documents"), id=signature["document_id"],
                               agreement_id=agreement["id"])
            owners = _where(ctx.rows("rent_agreement_owner_signatures"), agreement_id=agreement["id"],
                            tenant_signature_id=signature["id"], id=new["owner_signature_id"],
                            owner_user_id=agreement["owner_user_id"])
            matches = matches or any(
                _id(document["id"]) == _id(new["source_document_id"])
                and _id(owner["document_id"]) == _id(document["id"])
                and owner["document_sha256"] == signature["document_sha256"]
                and new["source_pdf_sha256"] == signature["document_sha256"]
                and signature["document_storage_path"] == document["storage_path"]
                and owner["document_storage_path"] == document["storage_path"]
                for document in documents for owner in owners)
    if not matches:
        raise api_error(RAISED, "Agreement and electronic signing evidence do not match")
    if not ctx.stored("tenant-lease-signing-evidence", new["storage_path"]):
        raise api_error(RAISED, "Generated evidence PDF is not present in Storage")


@trigger("notify_tenant_lease_document_ready")
def notify_tenant_lease_document_ready(ctx, old, new):
    """tenant_lease_documents AFTER INSERT: tell the tenant of a draft agreement nobody signed yet."""
    agreement = _first(_where(ctx.rows("rent_agreements"), id=new["agreement_id"]))
    tenant = agreement["tenant_user_id"] if agreement else None
    status = agreement["status"] if agreement else None
    if tenant is None or (status is not None and status != "DRAFT"):  # a NULL status is unknown: no return
        return
    if _where(ctx.rows("tenant_lease_signatures"), agreement_id=new["agreement_id"]):
        return
    ctx.insert("notifications", {
        "user_id": tenant,
        "title": "Lease document ready for review",
        "body": "Your property owner has uploaded a lease PDF. Review the document before deciding whether to "
                "electronically sign.",
        "category": "system",
        "link": f"/documents/lease-ready/{_id(new['agreement_id'])}/{_id(new['id'])}",
    }, on_conflict_do_nothing=True)


@trigger("notify_owner_of_tenant_lease_signature")
def notify_owner_of_tenant_lease_signature(ctx, old, new):
    """tenant_lease_signatures AFTER INSERT: tell the owner the tenant signed."""
    agreement = _first(_where(ctx.rows("rent_agreements"), id=new["agreement_id"]))
    owner = agreement["owner_user_id"] if agreement else None
    if owner is None:
        raise api_error(RAISED, "Agreement owner not found")
    ctx.insert("notifications", {
        "user_id": owner,
        "title": "Tenant electronically signed a lease",
        "body": f"{new['signer_name']} has electronically signed the lease PDF. Review the signing record and "
                "continue the lease process.",
        "category": "system",
        "link": f"/applications/lease-signed/{_id(new['agreement_id'])}",
    }, on_conflict_do_nothing=True)


@trigger("notify_tenant_rent_agreement_activated")
def notify_tenant_rent_agreement_activated(ctx, old, new):
    """rent_agreements AFTER UPDATE OF status: tell the tenant the agreement is ACTIVE."""
    if new["status"] != "ACTIVE" or old["status"] == new["status"]:
        return
    ctx.insert("notifications", {
        "user_id": new["tenant_user_id"],
        "title": "Rental agreement activated",
        "body": "Both parties have recorded their electronic signatures. Your rental agreement is now active in "
                "TenantVoice.",
        "category": "system",
        "link": f"/agreements/activated/{_id(new['id'])}",
    }, on_conflict_do_nothing=True)


@trigger("notify_verified_rent_payment")
def notify_verified_rent_payment(ctx, old, new):
    """rent_payments AFTER INSERT OR UPDATE OF status, verified_at: tell both parties of a verified Stripe payment."""
    # NEW.provider <> 'STRIPE' is unknown for a NULL provider, which does not return.
    if new["status"] != "SUCCEEDED" or new.get("verified_at") is None or new.get("provider") not in (None, "STRIPE"):
        return
    if ctx.event == "update" and old["status"] == "SUCCEEDED" and old.get("verified_at") is not None:
        return
    charge = _first(_where(ctx.rows("rent_charges"), id=new["charge_id"]))
    agreement = _first(_where(ctx.rows("rent_agreements"), id=charge["agreement_id"])) if charge else None
    if agreement is None or agreement["tenant_user_id"] is None or agreement["owner_user_id"] is None:
        return
    amount = ctx.typed("rent_payments", "amount", new["amount"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    message = f"Stripe payment of A${amount} has been verified for your rental agreement."
    for user_id, title in ((agreement["tenant_user_id"], "Rent payment confirmed"),
                           (agreement["owner_user_id"], "Rent payment received")):
        ctx.insert("notifications", {"user_id": user_id, "title": title, "body": message, "category": "system",
                                     "link": f"/payments/verified/{_id(new['id'])}"}, on_conflict_do_nothing=True)


# -- complaints and red flags ----------------------------------------------------------
def _json_time(moment):
    """A timestamptz as to_jsonb prints it."""
    return None if moment is None else moment.astimezone(timezone.utc).isoformat()


def evaluate_red_flag_rule_for_property(ctx, rule_id, property_id, complaint_id, evaluated_at):
    """public.evaluate_red_flag_rule_for_property(): the new red_flag_events id, or None.

    An active rule whose complaint count for the property (all of them, or
    those of its window) reaches its threshold opens an event, unless one is
    still OPEN or ACKNOWLEDGED, and notifies every active admin.
    """
    if property_id is None:
        return None
    rule = _first([row for row in _where(ctx.rows("red_flag_rules"), id=rule_id) if row["is_active"] is True])
    if rule is None:
        return None
    moment = ctx.typed("complaints", "lodged_at", evaluated_at)
    window_days = ctx.typed("red_flag_rules", "window_days", rule["window_days"])
    threshold = ctx.typed("red_flag_rules", "threshold_count", rule["threshold_count"])
    lodged = [ctx.typed("complaints", "lodged_at", row["lodged_at"])
              for row in _where(ctx.rows("complaints"), property_id=property_id)]
    if rule["trigger_mode"] == "TOTAL":
        window_start = None
        count = sum(1 for at in lodged if at is not None and at <= moment)
        details = f"{count} complaints have been recorded for this property in total."
    else:
        window_start = moment - timedelta(days=window_days)
        count = sum(1 for at in lodged if at is not None and window_start <= at <= moment)
        details = f"{count} complaints were recorded for this property within {window_days} days."
    if count < threshold:
        return None
    if any(row["status"] in ("OPEN", "ACKNOWLEDGED")
           for row in _where(ctx.rows("red_flag_events"), rule_id=rule["id"], property_id=property_id)):
        return None
    event = ctx.insert("red_flag_events", {
        "id": str(uuid.uuid4()),
        "rule_id": rule["id"],
        "property_id": property_id,
        "complaint_id": complaint_id,
        "summary": f"{rule['name']}: complaint threshold reached",
        "status": "OPEN",
        "triggered_at": evaluated_at,
        "evidence": {
            "details": details,
            "complaintCount": count,
            "thresholdCount": threshold,
            "triggerMode": rule["trigger_mode"],
            "windowDays": window_days if rule["trigger_mode"] == "WINDOW" else None,
            "windowStart": _json_time(window_start),
            "evaluatedAt": _json_time(moment),
        },
    })
    admins = [row for row in ctx.rows("users")
              if row["primary_role"] == "ADMIN" and row["status"] == "ACTIVE" and row.get("deleted_at") is None]
    for admin in admins:
        ctx.insert("notifications", {
            "id": str(uuid.uuid4()),
            "user_id": admin["id"],
            "title": "New property red flag",
            "body": f"{rule['name']} triggered after {count} complaints.",
            "category": "system",
            "link": "/admin/red-flags",
            "is_read": False,
            "created_at": evaluated_at,
        })
    return event["id"]


@trigger("evaluate_complaint_red_flags")
def evaluate_complaint_red_flags(ctx, old, new):
    """complaints AFTER INSERT: evaluate every active red flag rule, by id, for the complaint's property."""
    if new.get("property_id") is None:
        return
    rules = sorted((row for row in ctx.rows("red_flag_rules") if row["is_active"] is True),
                   key=lambda row: _id(row["id"]))
    for rule in rules:
        evaluate_red_flag_rule_for_property(ctx, rule["id"], new["property_id"], new["id"], new["lodged_at"])


# -- the owner assistant's leases ------------------------------------------------------
_SIGNING = ("sending", "sent", "reconcile_required", "complete_pending_file", "complete", "test_complete")


def _payload_text(row: dict, key: str) -> str | None:
    """payload ->> key: a JSON string as itself, any other value as its JSON text, null as NULL."""
    payload = row.get("payload")
    value = payload.get(key) if isinstance(payload, dict) else None
    return None if value is None else value if isinstance(value, str) else json.dumps(value)


@trigger("owner_lease_freeze_pending")
def owner_lease_freeze_pending(ctx, old, new):
    """owner_bridge_records BEFORE DELETE OR UPDATE: a lease being signed keeps its body, ids and status."""
    jobs = [row for row in ctx.rows("owner_lease_signing_jobs") if row["record_id"] == old["id"]]
    if not any(row["state"] in _SIGNING for row in jobs):
        return
    if ctx.event == "delete":
        raise api_error(RAISED, "agreement_locked_for_signing")
    signed_now = old["status"] == "draft" and new["status"] == "signed" and any(row["state"] == "complete"
                                                                                for row in jobs)
    if (_payload_text(new, "body") != _payload_text(old, "body")
            or _payload_text(new, "applicationId") != _payload_text(old, "applicationId")
            or new["property_id"] != old["property_id"]
            or new["firebase_uid"] != old["firebase_uid"]
            or (new["status"] != old["status"] and not signed_now)):
        raise api_error(RAISED, "agreement_locked_for_signing")


@trigger("owner_lease_freeze_documents")
def owner_lease_freeze_documents(ctx, old, new):
    """owner_lease_documents BEFORE INSERT OR DELETE OR UPDATE: no document changes while its lease is signed."""
    record_id = old["record_id"] if ctx.event == "delete" else new["record_id"]
    jobs = ctx.rows("owner_lease_signing_jobs")
    if any(row["record_id"] == record_id and row["state"] in _SIGNING for row in jobs):
        raise api_error(RAISED, "supporting_documents_locked_for_signing")
