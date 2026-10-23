"""Provider credentials, kept as the shared profile_documents (migration plan §3 b2).

A credential saved here joins the mobile app's verification queue: its type
is a ProfileDocumentType, its review is review_status, and the web's type and
label are kept in metadata. Rows and files are written through
app.services.documents, as every role's documents are; this module keeps the
credentials' DTO and rules: one per document type, an ABN without a file,
and a file the provider uploaded first, through /uploads/verification-document.

profile_documents is UNIQUE (user_id, document_type), so a credential of a
type the provider has already replaces theirs: the new file goes to review
and the old one goes. The ABN and an other credential share the one OTHER
document, so saving one replaces the other.
"""

from collections.abc import Iterable
from contextlib import contextmanager

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client
from app.services import _common
from app.services import documents
from app.services import uploads
from app.services.maps_provider_core import CREDENTIAL_DOCUMENT_TYPES, WEB_TO_DOC_TYPE, flatten_profile_document

TABLE = documents.TABLE
OWNER = documents.OWNER
DELETION_QUEUE = documents.DELETION_QUEUE
BUCKET = documents.BUCKET
REVIEWED = "The database keeps this reviewed credential, so it can't be removed. Replace its file instead."


def _metadata(row: dict) -> dict:
    return row.get("metadata") if isinstance(row.get("metadata"), dict) else {}


def _with_file_links(rows: list[dict], owner_id: str) -> list[dict]:
    """Swap each stored file key for a short-lived signed URL.

    Only a file in the owner's upload folder is signed. Any other saved value
    (an outside link from before keys were stored) is shown as it was saved.
    """
    folder = uploads.verification_folder(owner_id)
    paths = {row["id"]: uploads.owned_path(row.get("document_url"), BUCKET, folder) for row in rows}
    urls = uploads.signed_urls(BUCKET, paths.values())
    for row in rows:
        path = paths[row["id"]]
        if path:
            row["document_url"] = urls.get(path)
    return rows


def _uploaded_file(value: str | None, owner_id: str) -> str | None:
    """The key of a file this provider uploaded, from the upload's path or URL."""
    if not value:
        return None
    path = uploads.owned_path(value, BUCKET, uploads.verification_folder(owner_id))
    if path is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Upload the document from your account before attaching it"
        )
    return path


def _credential_rows(user_ids: Iterable[str]) -> list[dict]:
    """The users' credential documents, newest first; their other documents are not credentials."""
    return _common.select_in(
        lambda: get_supabase_client()
        .table(TABLE)
        .select("*")
        .in_("document_type", CREDENTIAL_DOCUMENT_TYPES)
        .order("submitted_at", desc=True)
        .order("id"),
        OWNER,
        user_ids,
    )


def _credential(document_id: str, provider_id: str) -> dict:
    """The provider's credential with this id: 404 for any other row, such as their tenancy papers."""
    rows = (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .eq("id", document_id)
        .eq(OWNER, provider_id)
        .in_("document_type", CREDENTIAL_DOCUMENT_TYPES)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return rows[0]


def credentials_of(user_ids: Iterable[str]) -> list[dict]:
    """The credentials of these providers (by users.id), as VerificationDocumentOut fields."""
    return [flatten_profile_document(row) for row in _credential_rows(user_ids)]


@contextmanager
def _upload_released_if_unsaved(reference: str | None, owner_id: str):
    """Release the upload `reference` names if the save inside fails.

    The browser stores a credential's file first and saves the credential
    second, so a failed save (a credential that is gone or changed meanwhile,
    a database error) would otherwise leave a private file in Storage that
    nothing points to. The save's own error is what the caller sees.
    """
    try:
        yield
    except Exception:
        documents.release_file(reference, owner_id, documents.ORPHANED)
        raise


def list_my_documents(provider_id: str, owner_id: str) -> list[dict]:
    return _with_file_links(credentials_of([provider_id]), owner_id)


# The ABN is checked against the number on the profile, so it needs no upload;
# every other credential is only reviewable with the document attached.
FILE_OPTIONAL_TYPES = {"abn"}


def _same_type(provider_id: str, document_type: str) -> dict | None:
    rows = (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .eq(OWNER, provider_id)
        .eq("document_type", document_type)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _credential_metadata(metadata: dict, web_type: str, label: str | None, *, new_file: bool = True) -> dict:
    """A saved credential's metadata over the keys the row keeps: its web type, and its label or none."""
    saved = {**(documents.unreviewed_metadata(metadata) if new_file else metadata), "web_type": web_type}
    if label:
        saved["label"] = label
    else:
        saved.pop("label", None)
    return saved


def create_document(provider_id: str, owner_id: str, payload: dict) -> dict:
    """Save a credential; one of a document type the provider has already replaces theirs."""
    replaced = None
    with _upload_released_if_unsaved(payload.get("document_url"), owner_id):
        path = _uploaded_file(payload.get("document_url"), owner_id)
        web_type = payload["type"]
        if web_type not in FILE_OPTIONAL_TYPES and not path:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Attach the document file for this credential")
        document_type = WEB_TO_DOC_TYPE[web_type]
        saved = None
        for _ in range(documents.ATTEMPTS):
            current = _same_type(provider_id, document_type)
            if current is None:
                try:
                    saved = documents.insert_row(provider_id, {
                        # An ABN saved without a file keeps '' in the NOT NULL file_url.
                        "document_type": document_type, "file_url": path or "",
                        "metadata": _credential_metadata({}, web_type, payload.get("label")),
                    })
                    break
                except APIError as exc:
                    if exc.code != documents.UNIQUE_VIOLATION:
                        raise
                    continue
            # The same file again keeps its review; any other one goes to review in its place.
            new_file = not path or uploads.stored_path(current.get("file_url"), BUCKET) != path
            changes = {"metadata": _credential_metadata(_metadata(current), web_type, payload.get("label"),
                                                        new_file=new_file)}
            if new_file:
                changes.update(file_url=path or "", **documents.unreviewed())
            saved = documents.update_row(current["id"], provider_id, changes, types=[document_type],
                                         file_url=current["file_url"])
            if saved is not None:
                replaced = current["file_url"] if new_file else None
                break
        if saved is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This credential changed while you were saving it. Reload and try again."
            )
    if replaced:
        documents.release_file(replaced, owner_id, documents.REPLACED)
    return _with_file_links([flatten_profile_document(saved)], owner_id)[0]


def update_document(document_id: str, provider_id: str, owner_id: str, payload: dict) -> dict:
    with _upload_released_if_unsaved(payload.get("document_url"), owner_id):
        current = _credential(document_id, provider_id)
        new_path = _uploaded_file(payload.get("document_url"), owner_id)
        changes: dict = {}
        if payload.get("label") is not None:
            changes["metadata"] = {**_metadata(current), "label": payload["label"]}
        replaced = bool(new_path) and new_path != uploads.stored_path(current.get("file_url"), BUCKET)
        if replaced:
            # A new file has not been reviewed: the old verification can't carry over.
            metadata = documents.unreviewed_metadata(changes.get("metadata") or _metadata(current))
            changes.update(file_url=new_path, metadata=metadata, **documents.unreviewed())
        updated = current
        if changes:
            updated = documents.update_row(document_id, provider_id, changes, types=CREDENTIAL_DOCUMENT_TYPES)
            if updated is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    if replaced:
        documents.release_file(current.get("file_url"), owner_id, documents.REPLACED)
    return _with_file_links([flatten_profile_document(updated)], owner_id)[0]


def delete_document(document_id: str, provider_id: str, owner_id: str) -> None:
    """Delete one of the provider's credentials; their other documents are not the web's to delete (404)."""
    deleted = documents.delete_row(document_id, provider_id, types=CREDENTIAL_DOCUMENT_TYPES, reviewed=REVIEWED)
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    documents.release_file(deleted.get("file_url"), owner_id, documents.USER_DELETED)
