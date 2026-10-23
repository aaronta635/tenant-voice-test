"""The admin console's verification queue and decisions (tracker R17).

The queue lists, for one role tab (tenants, landlords or providers: the
roles the shared verification functions review), the open accounts with
documents in one review status: while they wait, the oldest submission
first; once decided, the newest decision first. Each account comes with what
its verification needs, and each document with a link that opens its file
for a few minutes. The documents the mobile app keeps in
users.metadata.mobile.verificationDocuments come too, read-only, as
mobile_admin_verification_queue lists them (accounts not yet approved): an
account with any of them waits in the in-review tab, from when they were
sent. Signing those links is recorded in the web's audit_log, as opening
one file is (documents.admin_link).

An admin decides a document as they saw it (documents.review, through
review_profile_document) or the account itself (account_verification.decide,
through review_user_verification, while it is PENDING). The functions write
the decision, the account's verification and the person's notification. A
document decision also goes in the web's audit_log; an account decision in
both admin logs, as a status change does (admin_audit).
"""

import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, user_client
from app.services import (
    _common,
    account_verification,
    admin_audit,
    admin_users,
    audit,
    documents,
    uploads,
    verification_rules,
)
from app.services.shared_map import web_role

# Role tab -> the users.primary_role values it lists: those review_profile_document and
# review_user_verification review. Agents are not among them.
QUEUE_ROLES = {
    "tenant": ("TENANT",),
    "landlord": ("LANDLORD",),
    "provider": ("SERVICE_PROVIDER",),
}
TAB_OF = {primary_role: tab for tab, primary_roles in QUEUE_ROLES.items() for primary_role in primary_roles}
# Where each role keeps its documents (the verification gates link there).
DOCUMENTS_PATH = {
    "tenant": "/tenant/id-verification",
    "landlord": "/owner/profile/verification",
    "service_provider": "/dashboard/profile#verification-documents",
}
LINKS_SIGNED = "document.links_signed"
DOCUMENT_REVIEWED = "document.reviewed"
NOT_IN_QUEUE = "This account has no documents to review here."
# admin_users' refusals, in a verification decision's words.
LOCKS = {
    admin_users.SELF: "You can't decide the verification of your own account.",
    admin_users.STAFF: "Staff accounts are not verified from the admin console.",
}

# Sorts first; an account whose sending time cannot be read sorts last.
EARLIEST = datetime.min.replace(tzinfo=timezone.utc)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# The mobile app's verification documents
# ---------------------------------------------------------------------------
def _mobile_queue(access_token: str | None) -> tuple[dict[str, dict], bool]:
    """mobile_admin_verification_queue, run as the admin, by account id; and whether it could be read."""
    try:
        data = user_client(access_token).rpc("mobile_admin_verification_queue", {}).execute().data
    except Exception:
        logger.exception("could not read the mobile app's verification queue")
        return {}, False
    entries = data if isinstance(data, list) else []
    return {entry["id"]: entry for entry in entries if isinstance(entry, dict) and entry.get("id")}, True


def _mobile_documents(entry: dict | None) -> list[dict]:
    documents_ = (entry or {}).get("documents")
    return [document for document in documents_ if isinstance(document, dict)] if isinstance(documents_, list) else []


def _mobile_path(user_id: str, document: dict) -> str | None:
    """The file a mobile document names, when it is in its owner's folder of profile-documents."""
    return uploads.owned_path(document.get("storagePath"), documents.BUCKET, uploads.verification_folder(user_id))


def _mobile_out(user_id: str, document: dict, links: dict[str, dict]) -> dict:
    """One of the mobile app's documents as MobileDocumentOut."""
    path = _mobile_path(user_id, document)
    return {
        "key": str(document.get("key") or ""),
        "name": str(document.get("name") or document.get("key") or "Document"),
        "mime_type": document.get("mimeType"),
        "uploaded_at": document.get("uploadedAt"),
        "has_file": bool(document.get("storagePath") or document.get("url")),
        "link": links.get(path) if path else None,
    }


# ---------------------------------------------------------------------------
# The queue
# ---------------------------------------------------------------------------
def _rows(review_status: str, user_id: str | None = None) -> list[dict]:
    """Documents in a review status of open accounts in a queue role, each with its owner, in queue order."""

    def build():
        query = (
            get_supabase_client()
            .table(documents.TABLE)
            .select(f"*, owner:users!user_id!inner({account_verification.ACCOUNT_COLUMNS})")
            .eq("review_status", review_status)
            .is_("owner.deleted_at", "null")
            .in_("owner.primary_role", list(TAB_OF))
        )
        if user_id is not None:
            query = query.eq(documents.OWNER, user_id)
        if review_status == "PENDING":
            # Waiting: not verified before review_status existed either (documents.waiting).
            return query.eq("is_verified", False).order("submitted_at").order("id")
        return query.order("updated_at", desc=True).order("id")

    return _common.select_all(build)


def _open_accounts(user_ids) -> dict[str, dict]:
    """The open accounts in a queue role among user_ids, by id."""
    rows = _common.select_in(
        lambda: get_supabase_client()
        .table("users")
        .select(account_verification.ACCOUNT_COLUMNS)
        .is_("deleted_at", "null")
        .in_("primary_role", list(TAB_OF))
        .order("id"),
        "id",
        user_ids,
    )
    return {row["id"]: row for row in rows}


def _approval(user: dict, profile: dict | None) -> tuple[bool, str | None]:
    """Whether review_user_verification would approve the account now, and why not where that helps."""
    status_ = user.get("verification_status")
    if status_ == verification_rules.REJECTED:
        return False, "It can be decided again once its owner replaces or deletes a document its verification needs."
    if status_ != verification_rules.PENDING:
        return False, None
    if user.get("primary_role") == "SERVICE_PROVIDER" and not account_verification.provider_ready(profile):
        return False, "Approving a provider needs a service area and categories on its profile."
    return True, None


def _item(user: dict, shown: list[dict], every: list[dict], profile: dict | None, links: dict,
          mobile: list[dict]) -> dict:
    """One account as VerificationItemOut."""
    primary_role = user.get("primary_role")
    account = account_verification.account_out(user)
    can_approve, approval_note = _approval(user, profile)
    return {
        "user_id": user["id"],
        "full_name": user.get("full_name") or "",
        "email": user.get("email"),
        "role": web_role(primary_role),
        "primary_role": primary_role,
        "account": account,
        "requirements": documents.requirements_out(primary_role, every),
        "can_approve": can_approve,
        "approval_note": approval_note,
        "documents": [
            {**documents.document_out(row, folder=None), "updated_at": row["updated_at"], "link": links.get(row["id"])}
            for row in shown
        ],
        "mobile_documents": mobile,
    }


def _items(users: list[dict], shown: dict[str, list[dict]], mobile: dict[str, dict], admin_id: str) -> list[dict]:
    """The accounts as queue items, with links to the documents shown; handing those out is audited."""
    ids = [user["id"] for user in users]
    every = account_verification.documents_of(ids)
    profiles = account_verification.provider_profiles(
        [user["id"] for user in users if user.get("primary_role") == "SERVICE_PROVIDER"]
    )
    links = documents.review_links(row for rows in shown.values() for row in rows)
    saved = {user_id: _mobile_documents(mobile.get(user_id)) for user_id in ids}
    mobile_links = documents.signed_links(
        _mobile_path(user_id, document) for user_id, kept in saved.items() for document in kept
    )
    mobile_out = {user_id: [_mobile_out(user_id, document, mobile_links) for document in kept]
                  for user_id, kept in saved.items()}
    signed_mobile = sorted(
        ({"user_id": user_id, "key": document["key"]}
         for user_id, kept in mobile_out.items() for document in kept if document["link"]),
        key=lambda entry: (entry["user_id"], entry["key"]),
    )
    if links or signed_mobile:
        metadata = {"document_ids": sorted(links), "expires_in": documents.LINK_TTL}
        if signed_mobile:
            metadata["mobile_documents"] = signed_mobile
        audit.record(admin_id, LINKS_SIGNED, "profile_document", None, metadata)
    return [
        _item(user, shown.get(user["id"], []), every.get(user["id"], []), profiles.get(user["id"]), links,
              mobile_out[user["id"]])
        for user in users
    ]


def _waiting_since(rows: list[dict], entry: dict | None):
    """When an account's oldest document in review was sent: its pending rows' and the mobile app's."""
    moments = [verification_rules.moment(row.get("submitted_at")) for row in rows[:1]]
    if _mobile_documents(entry):
        moments.append(verification_rules.moment(entry.get("submittedAt")))
    return min((moment for moment in moments if moment is not None), default=None)


def queue(role: str, review_status: str, limit: int, offset: int, admin_id: str, access_token: str | None) -> dict:
    """One page of a role tab's accounts with documents in review_status (VerificationQueueOut)."""
    owners: dict[str, dict] = {}
    shown: dict[str, list[dict]] = {}
    for row in _rows(review_status):
        owner = row.pop("owner")
        owners.setdefault(owner["id"], owner)
        shown.setdefault(owner["id"], []).append(row)
    mobile, mobile_loaded = _mobile_queue(access_token)
    order = list(owners)
    if review_status == "PENDING":
        # The mobile queue lists rejected accounts too; only an account still PENDING waits for a decision.
        sent = [
            user_id for user_id, entry in mobile.items()
            if _mobile_documents(entry) and user_id not in owners
            and str(entry.get("verificationStatus") or "PENDING").upper() == "PENDING"
        ]
        owners.update(_open_accounts(sent))

        def oldest_first(user_id: str):
            since = _waiting_since(shown.get(user_id, []), mobile.get(user_id))
            return since is None, since or EARLIEST, user_id

        order = sorted(owners, key=oldest_first)
    counts = {tab: 0 for tab in QUEUE_ROLES}
    for user_id in order:
        counts[TAB_OF[owners[user_id]["primary_role"]]] += 1
    listed = [user_id for user_id in order if TAB_OF[owners[user_id]["primary_role"]] == role]
    page = listed[offset:offset + limit]
    return {
        "role": role,
        "status": review_status,
        "items": _items([owners[user_id] for user_id in page], {user_id: shown.get(user_id, []) for user_id in page},
                        mobile, admin_id),
        "total": len(listed),
        "limit": limit,
        "offset": offset,
        "counts": counts,
        "mobile_unavailable": not mobile_loaded,
    }


def _queued_account(user_id: str) -> dict:
    """An open account in a queue role: 404 for any other, staff and closed accounts included."""
    user = account_verification.account(user_id)
    if user is None or user.get("deleted_at") or user.get("primary_role") not in TAB_OF:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_IN_QUEUE)
    return user


def item(user_id: str, review_status: str, admin_id: str, access_token: str | None) -> dict:
    """One account as the queue shows it, read again: its documents in review_status may be none by now."""
    user = _queued_account(user_id)
    rows = _rows(review_status, user_id)
    for row in rows:
        row.pop("owner", None)
    mobile, _ = _mobile_queue(access_token)
    return _items([user], {user_id: rows}, {user_id: mobile[user_id]} if user_id in mobile else {}, admin_id)[0]


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------
def decide_document(admin_id: str, document_id: str, decision: str, reason: str | None, seen_version) -> dict:
    """An admin's decision on one document waiting for review (DocumentDecisionOut)."""
    reviewer = account_verification.account(admin_id)
    if reviewer is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No profile found for this account")
    decided, before = documents.review(document_id, reviewer, decision, reason, seen_version)
    after = account_verification.account(before["id"]) or before
    audit.record(
        admin_id, DOCUMENT_REVIEWED, "profile_document", decided["id"],
        {
            "user_id": before["id"],
            "document_type": decided["document_type"],
            "decision": decided["review_status"],
            "reason": decided.get("rejection_reason"),
            "account_status": after.get("verification_status"),
        },
    )
    return {
        "document": {**documents.document_out(decided, folder=None), "updated_at": decided["updated_at"]},
        "account": account_verification.account_out(after),
    }


def decide_account(admin_id: str, user_id: str, decision: str, reason: str | None) -> dict:
    """An admin's decision on a PENDING account's verification; the account as admin_users.get_user()."""
    user = account_verification.account(user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    lock = admin_users.management_lock(user, admin_id)
    if lock:
        raise HTTPException(lock[0], LOCKS.get(lock[1], lock[1]))
    reason = reason if decision == verification_rules.REJECTED else None
    updated = account_verification.decide(user, decision, admin_id, reason)
    admin_audit.record_verification_decision(
        admin_id, updated, user.get("verification_status"), updated["verification_status"], reason,
    )
    return admin_users.get_user(user_id, admin_id)
