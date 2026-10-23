"""profile_documents rows and stored files as the documents panel keeps them (app.services.documents).

Each row has every NOT NULL column its table has no default for, so strict
seeds accept it. A file the web stores sits in the owner's folder,
{users.id}/{32 hex}/{name}, in the private profile-documents bucket; the web
stored earlier ones under verification/{users.id}/ (earlier_file_key).
"""

from app.services import documents
from tests.factories import NOW

BUCKET = documents.BUCKET
REVIEW_STATUS = {"pending": "PENDING", "verified": "APPROVED", "rejected": "REJECTED"}
PDF = b"%PDF-1.7\nA test document"
PNG = b"\x89PNG\r\n\x1a\nA test image"
GIF = b"GIF89aA test animation"


def file_key(user_id: str, name: str = "Passport.pdf", directory: str = "a" * 32) -> str:
    return f"{user_id}/{directory}/{name}"


def earlier_file_key(user_id: str, name: str = "Passport.pdf", directory: str = "a" * 32) -> str:
    """Where the web stored a file before keys started with the owner's users.id."""
    return f"verification/{user_id}/{directory}/{name}"


def stored_file(fake_db, user_id: str, name: str = "Passport.pdf", directory: str = "a" * 32, *,
                earlier: bool = False) -> str:
    """A file the web stored for user_id (earlier: under the layout it used before); returns its key."""
    path = (earlier_file_key if earlier else file_key)(user_id, name, directory)
    fake_db.storage.objects[(BUCKET, path)] = PDF
    return path


def document_row(id, user_id, document_type="PASSPORT", status="pending", file_url=None, **over) -> dict:
    """A profile_documents row; verified ones carry the review columns an approval sets."""
    row = {
        "id": id,
        "user_id": user_id,
        "document_type": document_type,
        "file_url": file_url if file_url is not None else file_key(user_id),
        "metadata": {"visibility": "private"},
        "review_status": REVIEW_STATUS[status],
        "is_verified": status == "verified",
        "verified_at": NOW if status == "verified" else None,
        "rejection_reason": "The photo is blurred." if status == "rejected" else None,
        "submitted_at": NOW,
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def queue_entries(fake_db) -> list[dict]:
    return fake_db.tables.get(documents.DELETION_QUEUE, [])
