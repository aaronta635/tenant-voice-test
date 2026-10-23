"""Stand-ins for the shared functions documents and verification call (R15, R17).

Each is written from output/shared-catalog/functions/<name>.sql (snapshot of
2026-10-23): the same checks in the same order, the same writes through
ctx.table, the same errors and the same return shape. SQL's null logic is
kept where it decides a branch: `v_role not in (...)` is not true for a
null role, so a document of a closed account is still reviewed, as there.
"""

import json
import re
import uuid
from datetime import datetime, timezone

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

REVIEWABLE_ROLES = ("TENANT", "LANDLORD", "SERVICE_PROVIDER")
# review_profile_document's v_required_types, by users.primary_role; any other role takes the last.
REQUIRED_TYPES = {
    "TENANT": ("PASSPORT", "DRIVERS_LICENCE", "MEDICARE_CARD"),
    "LANDLORD": ("GOVERNMENT_PHOTO_ID", "PROOF_OF_PROPERTY_OWNERSHIP"),
}
OTHER_REQUIRED_TYPES = ("GOVERNMENT_PHOTO_ID", "TRADE_LICENCE", "PUBLIC_LIABILITY_INSURANCE")
# mobile_role_to_app()
APP_ROLES = {
    "TENANT": "tenant", "LANDLORD": "owner", "AGENT": "owner", "SERVICE_PROVIDER": "provider",
    "ADMIN": "admin", "REGULATOR": "regulator",
}


def _first(ctx, table: str, **where) -> dict | None:
    return next((row for row in ctx.rows(table) if all(row.get(key) == value for key, value in where.items())), None)


def _trim(value: str | None) -> str | None:
    """SQL trim(): spaces off both ends; null stays null."""
    return None if value is None else value.strip(" ")


def _blank(value: str | None) -> bool:
    """nullif(trim(coalesce(value, '')), '') is null."""
    return not _trim(value or "")


def _initcap(text: str) -> str:
    """Postgres initcap(): each run of letters and digits capitalised, the rest of it lower case."""
    return re.sub(r"[A-Za-z0-9]+", lambda word: word.group(0)[:1].upper() + word.group(0)[1:].lower(), text)


def _active_admin(ctx, user_id) -> bool:
    """exists (users where id = user_id and primary_role = 'ADMIN' and status = 'ACTIVE' and deleted_at is null)."""
    return any(
        row.get("id") == user_id and row.get("primary_role") == "ADMIN" and row.get("status") == "ACTIVE"
        and row.get("deleted_at") is None
        for row in ctx.rows("users")
    )


def _notify(ctx, user_id: str, title: str, body: str, now) -> None:
    ctx.table("notifications").insert({
        "id": str(uuid.uuid4()), "user_id": user_id, "title": title, "body": body, "category": "system",
        "link": "/admin/profile", "is_read": False, "created_at": now,
    }).execute()


def _sync_role_profile(ctx, role: str | None, user_id: str, status: str, now) -> None:
    """The landlord's or provider's profile row takes the account's verification_status."""
    table = {"LANDLORD": "landlord_profiles", "SERVICE_PROVIDER": "service_provider_profiles"}.get(role)
    if table:
        ctx.table(table).update({"verification_status": status, "updated_at": now}).eq("user_id", user_id).execute()


@rpc("review_profile_document")
def review_profile_document(ctx, params):
    document_id, reviewer_id = params["p_document_id"], params["p_reviewer_id"]
    decision, reason, now = params["p_status"], params["p_rejection_reason"], params["p_now"]
    if not _active_admin(ctx, reviewer_id):
        raise api_error("42501", "Administrator access is required")
    if decision not in ("APPROVED", "REJECTED"):
        raise api_error("22023", "Invalid document review status")
    if decision == "REJECTED" and _blank(reason):
        raise api_error("22023", "Rejection reason is required")

    document = _first(ctx, "profile_documents", id=document_id)
    if document is None:
        raise api_error("P0002", "Profile document not found")
    if document["review_status"] != "PENDING":
        raise api_error("23505", "Document has already been reviewed")

    subject = _first(ctx, "users", id=document["user_id"], deleted_at=None)
    role = subject["primary_role"] if subject else None
    current_status = subject["verification_status"] if subject else None
    if role is not None and role not in REVIEWABLE_ROLES:
        raise api_error("22023", "User role is not reviewable")

    rejected_with = _trim(reason) if decision == "REJECTED" else None
    metadata = {**(document.get("metadata") or {}),
                "reviewStatus": decision, "rejectionReason": rejected_with, "reviewedAt": now}
    ctx.table("profile_documents").update({
        "review_status": decision, "is_verified": decision == "APPROVED", "rejection_reason": rejected_with,
        "verified_by_user_id": reviewer_id, "verified_at": now, "metadata": metadata, "updated_at": now,
    }).eq("id", document_id).execute()

    owner = _first(ctx, "users", id=document["user_id"])
    reviewer = _first(ctx, "users", id=reviewer_id)
    if owner and reviewer:
        ctx.table("profile_document_review_events").insert({
            "document_id": document["id"], "subject_user_id": owner["id"], "reviewer_user_id": reviewer["id"],
            "subject_role": owner["primary_role"], "document_type": document["document_type"],
            "review_status": decision, "rejection_reason": rejected_with,
            "reviewer_email": reviewer["email"], "reviewer_name": reviewer.get("full_name"),
            "subject_email": owner["email"], "subject_name": owner.get("full_name"), "reviewed_at": now,
        }).execute()

    required = REQUIRED_TYPES.get(role, OTHER_REQUIRED_TYPES)
    counted = [row for row in ctx.rows("profile_documents")
               if row["user_id"] == document["user_id"] and row["document_type"] in required]
    approved = sum(row["review_status"] == "APPROVED" for row in counted)
    rejected = sum(row["review_status"] == "REJECTED" for row in counted)
    if current_status == "APPROVED" or approved == len(required):
        next_status = "APPROVED"
    elif rejected > 0:
        next_status = "REJECTED"
    else:
        next_status = "PENDING"

    account = _first(ctx, "users", id=document["user_id"]) or {}
    ctx.table("users").update({
        "verification_status": next_status,
        "approved_by_user_id": reviewer_id if next_status == "APPROVED" else None,
        "approved_at": (account.get("approved_at") or now) if next_status == "APPROVED" else None,
        "rejection_reason": _trim(reason) if next_status == "REJECTED" else None,
        "updated_at": now,
    }).eq("id", document["user_id"]).execute()
    _sync_role_profile(ctx, role, document["user_id"], next_status, now)

    kind = _initcap(document["document_type"]).replace("_", " ")
    body = f"Your {kind} was approved." if decision == "APPROVED" else f"Your {kind} was rejected: {_trim(reason)}"
    _notify(ctx, document["user_id"], "Verification document reviewed", body, now)
    return [{"document_id": document_id, "user_id": document["user_id"], "review_status": decision,
             "account_verification_status": next_status, "reviewed_at": now}]


@rpc("review_user_verification")
def review_user_verification(ctx, params):
    user_id, reviewer_id = params["p_user_id"], params["p_reviewer_id"]
    decision, reason, now = params["p_status"], params["p_rejection_reason"], params["p_now"]
    if not _active_admin(ctx, reviewer_id):
        raise api_error("42501", "Administrator access is required")
    if decision not in ("APPROVED", "REJECTED"):
        raise api_error("22023", "Invalid verification status")
    if decision == "REJECTED" and _blank(reason):
        raise api_error("22023", "Rejection reason is required")

    user = _first(ctx, "users", id=user_id, deleted_at=None)
    if user is None:
        raise api_error("P0002", "User not found")
    role, current_status = user["primary_role"], user["verification_status"]
    if current_status is not None and current_status != "PENDING":
        raise api_error("23505", "Verification request already reviewed")
    if role not in REVIEWABLE_ROLES:
        raise api_error("22023", "User role is not reviewable")
    if decision == "APPROVED" and role == "SERVICE_PROVIDER" and not any(
        row["user_id"] == user_id and not _blank(row.get("service_area"))
        and isinstance(row.get("service_categories"), list) and len(row["service_categories"]) > 0
        for row in ctx.rows("service_provider_profiles")
    ):
        raise api_error("22023", "Worker service area and categories are required before approval")

    ctx.table("users").update({
        "verification_status": decision,
        "approved_by_user_id": reviewer_id,
        "approved_at": now if decision == "APPROVED" else None,
        "rejection_reason": _trim(reason) if decision == "REJECTED" else None,
        "updated_at": now,
    }).eq("id", user_id).execute()
    _sync_role_profile(ctx, role, user_id, decision, now)

    body = ("Your TenantVoice account verification was approved." if decision == "APPROVED"
            else f"Your TenantVoice account verification was rejected: {_trim(reason)}")
    _notify(ctx, user_id, "Account verification updated", body, now)
    return None


def _text(value) -> str | None:
    """jsonb ->> key: a string as it is, any other value as its JSON text, a missing key as null."""
    if value is None or isinstance(value, str):
        return value
    return json.dumps(value)


def _nullif_empty(value) -> str | None:
    text = _text(value)
    return text if text != "" else None


def _timestamp_text(value) -> str | None:
    """timestamptz::text in a UTC session: '2026-01-01 00:00:00+00'."""
    if value is None:
        return None
    moment = datetime.fromisoformat(str(value))
    moment = (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    fraction = f".{moment.microsecond:06d}".rstrip("0") if moment.microsecond else ""
    return f"{moment:%Y-%m-%d %H:%M:%S}{fraction}+00"


def _mobile(row: dict) -> dict:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    mobile = metadata.get("mobile")
    return mobile if isinstance(mobile, dict) else {}


def _queue_entry(ctx, user: dict) -> dict:
    mobile = _mobile(user)
    saved = mobile.get("verificationDocuments")
    saved = saved if isinstance(saved, dict) else {}
    documents = []
    for key in sorted(saved):
        value = saved[key]
        if not isinstance(value, dict):
            continue
        entry = {
            "key": key,
            "name": _nullif_empty(value.get("name")) or _initcap(key.replace("_", " ")),
            "storagePath": _nullif_empty(value.get("storagePath")),
            "url": _nullif_empty(value.get("url")),
            "mimeType": _nullif_empty(value.get("mimeType")),
            "uploadedAt": _nullif_empty(value.get("uploadedAt")),
        }
        documents.append({name: item for name, item in entry.items() if item is not None})  # jsonb_strip_nulls
    role = user["primary_role"]
    if role == "SERVICE_PROVIDER":
        profile = _first(ctx, "service_provider_profiles", user_id=user["id"])
        subtitle = ((profile or {}).get("company_name") or None) or user["email"]
    elif role == "LANDLORD":
        profile = _first(ctx, "landlord_profiles", user_id=user["id"])
        subtitle = ((profile or {}).get("agency_name") or None) or user["email"]
    else:
        details = mobile.get("personalDetails")
        suburb = _text(details.get("suburb")) if isinstance(details, dict) else None
        subtitle = suburb if suburb is not None else user["email"]
    return {
        "id": user["id"],
        "name": _trim(user.get("full_name") or "") or user["email"],
        "email": user["email"],
        "role": APP_ROLES.get(role),
        "subtitle": subtitle,
        "verificationStatus": user.get("verification_status") or "PENDING",
        "documents": documents,
        "documentCount": len(saved),
        "submittedAt": _nullif_empty(mobile.get("verificationDocumentsUpdatedAt"))
        or _timestamp_text(user.get("updated_at")),
        "createdAt": user.get("created_at"),
    }


@rpc("mobile_admin_verification_queue")
def mobile_admin_verification_queue(ctx, params):
    caller = ctx.caller  # mobile_require_admin(): public.current_app_user_id() must be an active admin
    if caller is None or not _active_admin(ctx, caller["id"]):
        raise api_error("42501", "You need admin privileges to access this page.")
    users = [
        row for row in ctx.rows("users")
        if row.get("deleted_at") is None and row["primary_role"] not in ("ADMIN", "REGULATOR")
        and (row.get("verification_status") or "PENDING") != "APPROVED"
    ]
    # order by (status = 'REJECTED') desc, updated_at desc
    users.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    users.sort(key=lambda row: (row.get("verification_status") or "PENDING") == "REJECTED", reverse=True)
    return [_queue_entry(ctx, row) for row in users]


@rpc("mark_profile_document_object_deleted")
def mark_profile_document_object_deleted(ctx, params):
    for row in list(ctx.rows("profile_document_deletion_queue")):
        if row["file_path"] == params["p_file_path"] and row.get("deleted_at") is None:
            ctx.table("profile_document_deletion_queue").update({
                "deleted_at": params["p_now"], "attempts": row["attempts"] + 1, "last_error": None,
            }).eq("id", row["id"]).execute()
    return None
