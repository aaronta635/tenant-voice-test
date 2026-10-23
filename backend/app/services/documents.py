"""Private documents for every role: shared profile_documents rows and the private profile-documents bucket (R15).

A tenant, landlord or provider keeps the document types verification_rules
allows their role, one of each: profile_documents is UNIQUE (user_id,
document_type).

- upload: the file goes to Storage first, under the bucket's rules
  (uploads.store_verification_document, in the owner's {users.id} folder),
  then its row, stamped, PENDING and submitted now. An upload of a type the
  person already has replaces that document's file, as replace does. A row
  that cannot be written takes its file with it, and a file Storage refuses
  leaves no row, so a failure never reads as uploaded;
- replace: the new file sends the document back to review (unreviewed())
  and the old file goes;
- delete: the row goes, then its file;
- open: only through a link signed for LINK_TTL seconds, for the owner (a
  file in their own folder) or an admin, whose opening is audited.

metadata holds the web's keys (docs/shared-db.md, "Web metadata keys"),
merged into the mobile app's own: visibility, label for a document the
person named, and web_type for a tenant's OTHER document marked as a
payslip or an employment contract, which the profile completion counts. A
file that goes is queued in profile_document_deletion_queue (REPLACED,
USER_DELETED, or ORPHANED for an upload whose row was never saved),
removed, and marked deleted with mark_profile_document_object_deleted; a
removal that fails stays queued for the mobile side's cleanup to retry.

An admin decides a document waiting for review with review() (R17), through
the shared review_profile_document: it records the decision, its review
event and the account's verification (account_verification). A new file or
a delete of a type the account's verification requires puts an approved or
rejected account back in review (account_verification.apply_rule).

Every write the web makes to profile_documents and its deletion queue is in
this module. The provider credentials (verification_documents) keep their
DTOs and rules and save through insert_row, update_row, delete_row and
release_file.
"""

import logging
import re
from collections.abc import Iterable
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client
from app.services import _common, account_verification, audit, uploads, verification_rules
from app.services.maps_provider_core import web_document_status
from app.services.shared_map import stamp_insert, stamp_update

TABLE = "profile_documents"
OWNER = "user_id"
DELETION_QUEUE = "profile_document_deletion_queue"
BUCKET = uploads.VERIFICATION_DOCUMENTS_BUCKET
# Postgres foreign_key_violation and unique_violation.
FOREIGN_KEY_VIOLATION = "23503"
UNIQUE_VIOLATION = "23505"
# Reads again this many times when a write finds the row changed meanwhile.
ATTEMPTS = 3
# How long a link to open a document works (seconds): enough to load the
# file, too short to pass around. Each opening signs a new one.
LINK_TTL = 5 * 60

# metadata.visibility: who may see the file besides its owner and admins.
VISIBILITY_KEY = "visibility"
PRIVATE = "private"
# Shareable with the owners of the listings the person applies to. Only
# tenants apply (the application flow, R25).
APPLICATIONS = "applications"
VISIBILITIES = (PRIVATE, APPLICATIONS)
SHARING_ROLES = frozenset({"tenant"})
# metadata.label: the name a person gave the document, such as an OTHER one.
LABEL_KEY = "label"
MAX_LABEL = 120
# metadata.web_type: what a tenant's OTHER document is, when it is one the
# profile completion counts (profile_completion.PAYSLIP, EMPLOYMENT_CONTRACT).
# The provider credentials keep their own web types there (verification_documents).
KIND_KEY = "web_type"
KINDS = {"payslip": "Payslip", "employment_contract": "Employment contract"}
KIND_ROLES = frozenset({"tenant"})
KIND_TYPES = frozenset({"OTHER"})
# The keys review_profile_document writes into metadata at a decision. A new
# file is not reviewed, so where they are, they say so again.
REVIEW_METADATA = {"reviewStatus": "PENDING", "rejectionReason": None, "reviewedAt": None}
# The web's key layout, {users.id}/{32 hex}/{file name}, or verification/
# before it (uploads.store_verification_document): the last part is the file's name.
_UPLOAD_DIRECTORY = re.compile(r"[0-9a-f]{32}")

# profile_document_deletion_queue.reason (a CHECK): why a file goes.
REPLACED = "REPLACED"
USER_DELETED = "USER_DELETED"
ORPHANED = "ORPHANED"

ROLE_NOUNS = {"tenant": "tenant", "landlord": "landlord", "service_provider": "service provider"}
REVIEWED = "The database keeps this reviewed document, so it can't be removed. Replace its file instead."

# An admin's decision on a document waiting for review (ProfileDocumentReviewStatus).
DECISIONS = ("APPROVED", "REJECTED")
STALE = (
    "This document changed since you opened it: another admin may have decided it, or a new file came in. "
    "Reload it to see the latest version."
)
OWN = "You can't review your own documents."

logger = logging.getLogger(__name__)


def _table():
    return get_supabase_client().table(TABLE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _metadata(row: dict) -> dict:
    return row.get("metadata") if isinstance(row.get("metadata"), dict) else {}


def unreviewed() -> dict:
    """The review columns of a file nobody has reviewed yet, submitted now.

    A new file starts here, and a replaced one comes back here: an earlier
    approval or rejection was about another file. review_profile_document
    decides only a PENDING document.
    """
    return {
        "review_status": "PENDING",
        "is_verified": False,
        "verified_at": None,
        "verified_by_user_id": None,
        "rejection_reason": None,
        "submitted_at": _now(),
    }


def unreviewed_metadata(metadata: dict) -> dict:
    """A document's metadata for a new file: review keys a decision left there say it is in review again."""
    if not any(key in metadata for key in REVIEW_METADATA):
        return dict(metadata)
    return {**metadata, **REVIEW_METADATA}


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------
def insert_row(user_id: str, fields: dict) -> dict:
    """A new document of user_id, waiting for review: fields are its document_type, file_url and metadata.

    23505 when the person has a document of that type already.
    """
    row = stamp_insert(TABLE, {**fields, OWNER: user_id, **unreviewed()})
    return _table().insert(row).execute().data[0]


def update_row(document_id: str, user_id: str, changes: dict, *, types: Iterable[str],
               file_url: str | None = None) -> dict | None:
    """The document after the changes, or None when no row of user_id with one of types has that id.

    With file_url, the change applies only while the row still has that
    file, so two replacements cannot both win. A new file resets the
    account's verification (account_verification.apply_rule); a new name or
    visibility leaves the account as it is.
    """
    query = (
        _table()
        .update(stamp_update(TABLE, changes))
        .eq("id", document_id)
        .eq(OWNER, user_id)
        .in_("document_type", list(types))
    )
    if file_url is not None:
        query = query.eq("file_url", file_url)
    rows = query.execute().data
    if rows and "file_url" in changes:
        account_verification.apply_rule(user_id, document_type=rows[0]["document_type"])
    return rows[0] if rows else None


def delete_row(document_id: str, user_id: str, *, types: Iterable[str], reviewed: str = REVIEWED) -> dict | None:
    """The deleted document, or None when user_id has none with that id among types.

    Its review events stay, pointing nowhere (their foreign key is ON DELETE
    SET NULL); a database that keeps the document instead (23503) answers 409
    (reviewed). A deleted document resets the account's verification.
    """
    try:
        rows = (
            _table()
            .delete()
            .eq("id", document_id)
            .eq(OWNER, user_id)
            .in_("document_type", list(types))
            .execute()
            .data
        )
    except APIError as exc:
        if exc.code != FOREIGN_KEY_VIOLATION:
            raise
        raise HTTPException(status.HTTP_409_CONFLICT, reviewed) from exc
    if rows:
        account_verification.apply_rule(user_id, document_type=rows[0]["document_type"])
    return rows[0] if rows else None


def _rows_of(user_id: str, types: Iterable[str]) -> list[dict]:
    """The user's documents of these types, newest first."""
    wanted = list(types)
    if not wanted:
        return []
    return _common.select_all(
        lambda: _table()
        .select("*")
        .eq(OWNER, user_id)
        .in_("document_type", wanted)
        .order("submitted_at", desc=True)
        .order("id")
    )


def _owned(document_id: str, user_id: str, types: Iterable[str]) -> dict:
    """The user's document with this id among types: 404 for anyone else's, or another type."""
    rows = (
        _table()
        .select("*")
        .eq("id", document_id)
        .eq(OWNER, user_id)
        .in_("document_type", list(types))
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return rows[0]


def pending_by_user(user_ids: Iterable[str]) -> dict[str, int]:
    """How many documents of each of these users wait for review."""
    rows = _common.select_in(
        lambda: _table().select("id, user_id").eq("review_status", "PENDING").eq("is_verified", False).order("id"),
        OWNER,
        user_ids,
    )
    counts: dict[str, int] = {}
    for row in rows:
        counts[row[OWNER]] = counts.get(row[OWNER], 0) + 1
    return counts


def pending_summary() -> tuple[int, int]:
    """(documents waiting for review, people they belong to), across every account."""
    rows = _common.select_all(
        lambda: _table().select("id, user_id").eq("review_status", "PENDING").eq("is_verified", False).order("id")
    )
    return len(rows), len({row[OWNER] for row in rows})


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------
def _file_name(path: str | None) -> str | None:
    """The original name of a file the web stored; None for any other key, whose name is not known."""
    parts = path.split("/") if path else []
    if len(parts) == 4 and parts[0] == uploads.LEGACY_VERIFICATION_ROOT:
        parts = parts[1:]
    if len(parts) == 3 and _UPLOAD_DIRECTORY.fullmatch(parts[1]):
        return parts[2]
    return None


def _type_label(document_type: str) -> str:
    known = verification_rules.DOCUMENT_TYPES.get(document_type)
    return known.label if known else document_type.replace("_", " ").capitalize()


def document_out(row: dict, *, folder: str | None) -> dict:
    """A profile_documents row as DocumentOut.

    folder is the owner's folder: their files there can be opened. Without
    one (an admin's view) every file in the bucket can.
    """
    meta = _metadata(row)
    path = uploads.stored_path(row.get("file_url"), BUCKET)
    openable = uploads.owned_path(path, BUCKET, folder) if folder else path
    review = web_document_status(row)
    visibility = meta.get(VISIBILITY_KEY)
    kind = meta.get(KIND_KEY) if row["document_type"] in KIND_TYPES and meta.get(KIND_KEY) in KINDS else None
    return {
        "id": row["id"],
        "document_type": row["document_type"],
        "label": meta.get(LABEL_KEY) or KINDS.get(kind) or _type_label(row["document_type"]),
        "status": review,
        "rejection_reason": row.get("rejection_reason") if review == "rejected" else None,
        "file_name": _file_name(path),
        "has_file": bool(row.get("file_url")),
        "can_open": bool(openable),
        "visibility": visibility if visibility in VISIBILITIES else PRIVATE,
        "kind": kind,
        "submitted_at": row.get("submitted_at") or row.get("created_at"),
        "verified_at": row.get("verified_at"),
    }


def _type_out(document_type: str, required: Iterable[str], role: str, *, kept_only: bool = False) -> dict:
    """One type of the checklist (DocumentTypeOut); kept_only for an earlier type the person still holds."""
    info = verification_rules.DOCUMENT_TYPES[document_type]
    markable = role in KIND_ROLES and document_type in KIND_TYPES
    return {
        "type": document_type,
        "label": info.label,
        "description": info.description,
        "group": info.group,
        "group_label": verification_rules.GROUP_LABELS[info.group],
        # One document per type and person (UNIQUE (user_id, document_type)).
        "repeatable": False,
        "required": document_type in required,
        "kinds": [{"value": value, "label": label} for value, label in KINDS.items()] if markable else [],
        "kept_only": kept_only,
    }


def requirements_out(primary_role: str | None, rows: list[dict]) -> list[dict]:
    """What the account's verification needs (RequirementOut), and how far these documents meet it."""
    return [
        {
            "key": requirement.key,
            "label": requirement.label,
            "types": list(requirement.any_of),
            "status": verification_rules.requirement_status(requirement, rows),
        }
        for requirement in verification_rules.requirements(primary_role)
    ]


def list_documents(user_id: str, role: str) -> dict:
    """The role's document checklist (DocumentsOut): its types, what verification needs, the files and the account."""
    types = verification_rules.allowed_types(role)
    rows = _rows_of(user_id, verification_rules.kept_types(role))
    user = account_verification.account(user_id) or {}
    primary_role = user.get("primary_role")
    required = verification_rules.counted_types(primary_role)
    folder = uploads.verification_folder(user_id)
    # An earlier type shows only while the person holds a document of it.
    held = {row.get("document_type") for row in rows}
    earlier = [value for value in verification_rules.kept_types(role) if value not in types and value in held]
    return {
        "role": role,
        "can_share": role in SHARING_ROLES,
        "types": [_type_out(document_type, required, role) for document_type in types]
        + [_type_out(document_type, required, role, kept_only=True) for document_type in earlier],
        "requirements": requirements_out(primary_role, rows),
        "requirements_met": verification_rules.requirements_met(primary_role, rows),
        "account": account_verification.account_out(user),
        "documents": [document_out(row, folder=folder) for row in rows],
    }


def documents_for_admin(user_id: str) -> list[dict]:
    """Every document of an account, whatever its type, as an admin sees them."""
    rows = _common.select_all(
        lambda: _table().select("*").eq(OWNER, user_id).order("submitted_at", desc=True).order("id")
    )
    return [document_out(row, folder=None) for row in rows]


# ---------------------------------------------------------------------------
# The documents panel's actions
# ---------------------------------------------------------------------------
def _allowed(role: str) -> tuple[str, ...]:
    types = verification_rules.allowed_types(role)
    if not types:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account does not keep documents")
    return types


def _kept(role: str) -> tuple[str, ...]:
    """The types a person may open, replace, change and delete: _allowed, and the earlier ones they still hold."""
    _allowed(role)
    return verification_rules.kept_types(role)


def _visibility(role: str, value: str | None) -> str:
    if value in (None, PRIVATE):
        return PRIVATE
    if value not in VISIBILITIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose who may see this document")
    if role not in SHARING_ROLES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only tenants can share documents with the owners they apply to"
        )
    return value


def _kind(role: str, document_type: str, value: str | None) -> str | None:
    """A payslip or contract mark, which only a tenant's OTHER document takes."""
    if value is None:
        return None
    if role not in KIND_ROLES or document_type not in KIND_TYPES or value not in KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only a tenant's other document can be marked as a payslip or a contract"
        )
    return value


def _label(value: str | None) -> str | None:
    label = " ".join((value or "").split())
    if len(label) > MAX_LABEL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Keep the name under {MAX_LABEL} characters")
    return label or None


def _upload_metadata(metadata: dict, document_type: str, visibility: str, label: str | None,
                     kind: str | None) -> dict:
    """The metadata of an uploaded document: the upload's visibility, name and mark over the keys kept there."""
    saved = unreviewed_metadata(metadata)
    saved[VISIBILITY_KEY] = visibility
    if label:
        saved[LABEL_KEY] = label
    else:
        saved.pop(LABEL_KEY, None)
    if document_type in KIND_TYPES:
        if kind:
            saved[KIND_KEY] = kind
        else:
            saved.pop(KIND_KEY, None)
    return saved


def _save_upload(user_id: str, document_type: str, path: str, visibility: str, label: str | None,
                 kind: str | None) -> tuple[dict, str | None]:
    """The person's document of this type with the uploaded file, and the file it replaced (None for a new one).

    A type the person has already (theirs from the website, or the mobile
    app's) gets the new file, as replace_file() gives it; another tab's
    upload of the same type that came first is replaced the same way.
    """
    for _ in range(ATTEMPTS):
        kept = _rows_of(user_id, [document_type])
        if not kept:
            metadata = _upload_metadata({}, document_type, visibility, label, kind)
            try:
                return insert_row(user_id, {"document_type": document_type, "file_url": path, "metadata": metadata}), None
            except APIError as exc:
                if exc.code != UNIQUE_VIOLATION:
                    raise
                continue
        current = kept[0]
        changes = {
            "file_url": path,
            "metadata": _upload_metadata(_metadata(current), document_type, visibility, label, kind),
            **unreviewed(),
        }
        updated = update_row(current["id"], user_id, changes, types=[document_type], file_url=current["file_url"])
        if updated is not None:
            return updated, current["file_url"]
    raise HTTPException(
        status.HTTP_409_CONFLICT, "This document changed while you were uploading it. Reload and try again."
    )


def upload(user_id: str, role: str, document_type: str, file: UploadFile, *,
           label: str | None = None, visibility: str | None = PRIVATE, kind: str | None = None) -> dict:
    """Store a document, the file first, then its row, or neither; one of a type the person has replaces theirs."""
    types = _allowed(role)
    if document_type not in types:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"A {ROLE_NOUNS.get(role, role)} account can't keep that type of document"
        )
    visibility = _visibility(role, visibility)
    label = _label(label)
    kind = _kind(role, document_type, kind)
    stored = uploads.store_verification_document(file, user_id)
    try:
        row, replaced = _save_upload(user_id, document_type, stored["path"], visibility, label, kind)
    except Exception:
        _discard_upload(stored["path"])
        raise
    if replaced is not None:
        release_file(replaced, user_id, REPLACED)
    return document_out(row, folder=uploads.verification_folder(user_id))


def replace_file(document_id: str, user_id: str, role: str, file: UploadFile) -> dict:
    """A new file for a document: it goes back to review, and the old file goes."""
    types = _kept(role)
    current = _owned(document_id, user_id, types)
    stored = uploads.store_verification_document(file, user_id)
    changes = {"file_url": stored["path"], "metadata": unreviewed_metadata(_metadata(current)), **unreviewed()}
    try:
        updated = update_row(document_id, user_id, changes, types=types, file_url=current["file_url"])
    except Exception:
        _discard_upload(stored["path"])
        raise
    if updated is None:
        _discard_upload(stored["path"])
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This document changed while you were replacing it. Reload and try again."
        )
    release_file(current["file_url"], user_id, REPLACED)
    return document_out(updated, folder=uploads.verification_folder(user_id))


def update_details(document_id: str, user_id: str, role: str, changes: dict) -> dict:
    """Change who may see a document, its name or its mark; the review is kept, as the file is the same."""
    types = _kept(role)
    current = _owned(document_id, user_id, types)
    metadata = dict(_metadata(current))
    if changes.get("visibility") is not None:
        metadata[VISIBILITY_KEY] = _visibility(role, changes["visibility"])
    if "label" in changes:
        label = _label(changes["label"])
        if label:
            metadata[LABEL_KEY] = label
        else:
            metadata.pop(LABEL_KEY, None)
    if "kind" in changes:
        kind = _kind(role, current["document_type"], changes["kind"])
        if kind:
            metadata[KIND_KEY] = kind
        else:
            metadata.pop(KIND_KEY, None)
    updated = current
    if metadata != _metadata(current):
        updated = update_row(document_id, user_id, {"metadata": metadata}, types=types)
        if updated is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return document_out(updated, folder=uploads.verification_folder(user_id))


def delete(document_id: str, user_id: str, role: str) -> None:
    """Delete one of the person's documents, then its file."""
    row = delete_row(document_id, user_id, types=_kept(role))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    release_file(row.get("file_url"), user_id, USER_DELETED)


# ---------------------------------------------------------------------------
# Opening a file
# ---------------------------------------------------------------------------
def _no_file(row: dict) -> HTTPException:
    if not row.get("file_url"):
        return HTTPException(status.HTTP_404_NOT_FOUND, "This document has no file")
    return HTTPException(status.HTTP_409_CONFLICT, "This file was not uploaded on the website, so it can't be opened here")


def _signed(path: str) -> dict:
    try:
        signed = get_supabase_client().storage.from_(BUCKET).create_signed_url(path, LINK_TTL)
        url = signed.get("signedURL") or signed.get("signedUrl")
    except Exception as exc:  # a missing object, storage unreachable, ...
        logger.warning("could not sign a document file in %s: %s", BUCKET, exc)
        url = None
    if not url:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not open the file. Please try again.")
    return {"url": url, "expires_in": LINK_TTL}


def owner_link(document_id: str, user_id: str, role: str) -> dict:
    """A short-lived link to one of the person's own files."""
    row = _owned(document_id, user_id, _kept(role))
    path = uploads.owned_path(row.get("file_url"), BUCKET, uploads.verification_folder(user_id))
    if not path:
        raise _no_file(row)
    return _signed(path)


def admin_link(document_id: str, admin_id: str) -> dict:
    """A short-lived link to anyone's file, for an admin; the opening goes in the audit trail."""
    rows = _table().select("*").eq("id", document_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    row = rows[0]
    path = uploads.stored_path(row.get("file_url"), BUCKET)
    if not path:
        raise _no_file(row)
    link = _signed(path)
    audit.record(
        admin_id, "document.opened", "profile_document", document_id,
        {"user_id": row[OWNER], "document_type": row["document_type"]},
    )
    return link


def signed_links(paths: Iterable[str]) -> dict[str, dict]:
    """Links to these stored keys for an admin, by key, signed in one request. Never raises.

    A key Storage cannot sign (a missing object) is left out. Each link
    works for LINK_TTL seconds.
    """
    wanted = sorted({path for path in paths if path})
    if not wanted:
        return {}
    try:
        signed = get_supabase_client().storage.from_(BUCKET).create_signed_urls(wanted, LINK_TTL)
    except Exception as exc:
        logger.warning("could not sign %d document file(s) in %s: %s", len(wanted), BUCKET, exc)
        return {}
    links = {}
    for item in signed or []:
        url = item.get("signedURL") or item.get("signedUrl")
        if item.get("path") in wanted and url and not item.get("error"):
            links[item["path"]] = {"url": url, "expires_in": LINK_TTL}
    return links


def review_links(rows: Iterable[dict]) -> dict[str, dict]:
    """Links to these documents' files for an admin's review, by document id, signed in one request.

    Any file in the bucket can be signed, as admin_link() can; one Storage
    cannot sign is left out. Never raises.
    """
    paths = {row["id"]: uploads.stored_path(row.get("file_url"), BUCKET) for row in rows}
    links = signed_links(paths.values())
    return {document_id: links[path] for document_id, path in paths.items() if path in links}


# ---------------------------------------------------------------------------
# An admin's decision (R17)
# ---------------------------------------------------------------------------
def waiting(row: dict) -> bool:
    """Whether a document waits for review: PENDING, and not verified before review_status existed."""
    return row.get("review_status") == "PENDING" and not row.get("is_verified")


def review(document_id: str, reviewer: dict, decision: str, reason: str | None, seen_version) -> tuple[dict, dict]:
    """Approve or reject a document waiting for review, as the admin saw it; the decided row and its owner's account.

    review_profile_document decides it, as the mobile admin console does: it
    sets the review columns, writes the profile_document_review_events row,
    sets the account's verification from its documents and notifies the
    person, all at once. It decides only a PENDING document, so of two admins
    the second gets 409 (Document has already been reviewed). Before it the
    web refuses what the function cannot tell: a document that got a new
    file or other change since the admin saw seen_version (its updated_at),
    an admin's own document and a closed account's. reviewer is the admin's
    users row.
    """
    if decision not in DECISIONS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Approve or reject the document")
    reason = " ".join((reason or "").split()) or None
    if decision == "REJECTED" and not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give a reason for rejecting this document.")
    rows = _table().select("*").eq("id", document_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    current = rows[0]
    if current[OWNER] == reviewer["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, OWN)
    subject = account_verification.account(current[OWNER])
    if subject is None or subject.get("deleted_at"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This account has been closed.")
    seen = verification_rules.moment(seen_version)
    if current.get("review_status") == "PENDING" and (
        seen is None or verification_rules.moment(current.get("updated_at")) != seen
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, STALE)
    try:
        get_supabase_client().rpc("review_profile_document", {
            "p_document_id": document_id,
            "p_reviewer_id": reviewer["id"],
            "p_status": decision,
            "p_rejection_reason": reason if decision == "REJECTED" else None,
            "p_now": _now(),
        }).execute()
    except APIError as exc:
        account_verification.raise_function_error(exc)
    decided = _table().select("*").eq("id", document_id).limit(1).execute().data
    return (decided[0] if decided else current), subject


# ---------------------------------------------------------------------------
# Files nothing points to any more
# ---------------------------------------------------------------------------
def _queue(path: str, reason: str) -> dict | None:
    """Queue a file for deletion, one entry per file as the shared functions keep it; None when it could not be written."""
    try:
        try:
            row = stamp_insert(DELETION_QUEUE, {"bucket": BUCKET, "file_path": path, "reason": reason})
            return get_supabase_client().table(DELETION_QUEUE).insert(row).execute().data[0]
        except APIError as exc:
            if exc.code != UNIQUE_VIOLATION:
                raise
        # Queued before: queue it again, as replace_profile_document's on conflict (file_path) does.
        again = {"reason": reason, "requested_at": _now(), "deleted_at": None, "attempts": 0, "last_error": None}
        rows = (
            get_supabase_client()
            .table(DELETION_QUEUE)
            .update(stamp_update(DELETION_QUEUE, again))
            .eq("file_path", path)
            .execute()
            .data
        )
        return rows[0] if rows else None
    except Exception:
        logger.exception("could not queue a document file for deletion")
        return None


def _failed(entry: dict | None, exc: Exception) -> None:
    """Say on a file's queue entry that removing it failed, for the cleanup to retry."""
    if entry is None:
        return
    try:
        (
            get_supabase_client()
            .table(DELETION_QUEUE)
            .update(stamp_update(DELETION_QUEUE, {"attempts": (entry.get("attempts") or 0) + 1,
                                                  "last_error": str(exc)[:500]}))
            .eq("id", entry["id"])
            .execute()
        )
    except Exception:
        logger.exception("could not update a document deletion queue entry")


def _remove(path: str, entry: dict | None) -> None:
    """Remove a file now and mark its queue entry deleted; a failure stays queued, with its error."""
    try:
        get_supabase_client().storage.from_(BUCKET).remove([path])
    except Exception as exc:
        logger.warning("could not remove a document file from %s: %s", BUCKET, exc)
        _failed(entry, exc)
        return
    if entry is None:
        return
    try:
        get_supabase_client().rpc(
            "mark_profile_document_object_deleted", {"p_file_path": path, "p_now": _now()}
        ).execute()
    except Exception:
        logger.exception("could not mark a removed document file in the deletion queue")


def _mobile_paths(user_id: str) -> set[str]:
    """The files the mobile app's own verification documents name (users.metadata.mobile.verificationDocuments)."""
    rows = (
        get_supabase_client()
        .table("users")
        .select("saved:metadata->mobile->verificationDocuments")
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
    )
    saved = rows[0].get("saved") if rows else None
    if not isinstance(saved, dict):
        return set()
    return {value["storagePath"] for value in saved.values()
            if isinstance(value, dict) and isinstance(value.get("storagePath"), str)}


def release_file(reference: str | None, user_id: str, reason: str) -> None:
    """Remove a saved file that nothing of its owner uses any more. Never raises.

    Only a file in the owner's own folder is ever touched, and not while one
    of their documents, or the mobile app's verification documents, still
    names it. It is queued for deletion first, so a removal that fails is
    retried, and a file whose use cannot be checked stays.
    """
    path = uploads.owned_path(reference, BUCKET, uploads.verification_folder(user_id))
    if not path:
        return
    try:
        in_use = _table().select("file_url").eq(OWNER, user_id).execute().data or []
        mobile = _mobile_paths(user_id)
    except Exception:
        logger.exception("could not check whether a document file is still in use, so it stays")
        return
    if path in mobile or any(uploads.stored_path(row.get("file_url"), BUCKET) == path for row in in_use):
        return
    _remove(path, _queue(path, reason))


def _discard_upload(path: str) -> None:
    """Remove a file this request stored for a row that was never written. Never raises.

    Nothing points to it, so it goes at once. Only when Storage fails is it
    queued (ORPHANED), as far as the database allows: the database may be
    what failed.
    """
    try:
        get_supabase_client().storage.from_(BUCKET).remove([path])
    except Exception as exc:
        logger.warning("could not remove an unsaved document file from %s: %s", BUCKET, exc)
        _failed(_queue(path, ORPHANED), exc)
