"""File uploads.

The browser never talks to Supabase Storage directly (docs/README.md: Supabase is
backend-only), so files are POSTed here as multipart, validated, and forwarded to
a bucket with the service-role key. Callers get back the object key and a URL:
a short-lived signed one for a private bucket, whose rows keep the key and are
signed again whenever they are read, so a saved link never outlives its token;
the permanent public URL for a public bucket.

This is the project's first upload path; keep `store()` generic so verification
documents and property photos can reuse it.

Before a file is stored, ClamAV scans it when settings.clamav_host names a
clamd (tracker assumption #22): an infected file is refused and nothing is
stored. The outcome stays with the file, in the stored object's metadata
(SCAN_KEY): "clean", or "not_scanned" while no scanner is configured.
"""

import logging
import re
import socket
import struct
import time
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote, unquote

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.core.supabase import get_supabase_client

logger = logging.getLogger(__name__)

# Chat files have a private bucket of their own (supabase/shared/0003_storage.sql),
# apart from the identity documents in profile-documents.
MESSAGE_ATTACHMENTS_BUCKET = "message-attachments"
VERIFICATION_DOCUMENTS_BUCKET = "profile-documents"

MB = 1024 * 1024
# Every type _sniff() recognises, with the extension its object key gets.
EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}


@dataclass(frozen=True)
class BucketRules:
    max_bytes: int
    content_types: frozenset[str]
    # A public bucket's objects have a permanent URL; a private one's are signed.
    public: bool = False


# The shared project's bucket settings (public, file_size_limit,
# allowed_mime_types), narrowed to the types _sniff() recognises. Storage
# refuses anything else, so store() answers 413 or 415 for it instead of a 502
# from the upload. A bucket the backend stores into needs an entry here.
BUCKETS = {
    # Credentials; it refuses GIF.
    "profile-documents": BucketRules(5 * MB, frozenset({"application/pdf", "image/jpeg", "image/png", "image/webp"})),
    # Chat attachments, GIF included (supabase/shared/0003_storage.sql).
    "message-attachments": BucketRules(
        5 * MB, frozenset({"application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp"})
    ),
    "property-images": BucketRules(
        3 * MB, frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"}), public=True
    ),
    "provider-portfolios": BucketRules(10 * MB, frozenset({"image/jpeg", "image/png", "image/webp"}), public=True),
}


def rules_for(bucket: str) -> BucketRules:
    """A bucket's BucketRules. Storing into a bucket without any is a bug, named as such."""
    try:
        return BUCKETS[bucket]
    except KeyError:
        raise ValueError(f"uploads.BUCKETS has no rules for the {bucket!r} bucket") from None


# How long a returned signed URL stays valid (seconds). Nothing stores one: rows
# keep the object key and are signed again when they are read.
SIGNED_URL_TTL = 60 * 60
# A link signed on read is handed out again for this long, so a thread polled
# every few seconds keeps the same image URLs and the browser can cache them.
SIGNED_URL_REUSE = 30 * 60
MAX_REUSED_URLS = 1000
_reused_urls: dict[tuple[str, str], tuple[float, str]] = {}


def _sniff(data: bytes) -> str | None:
    """The real content type from the file's leading bytes, if it's one we accept.

    The browser-supplied Content-Type and filename are not trusted: an HTML or
    SVG file renamed to .png must not be stored as an image. Which of these a
    bucket takes is up to its BucketRules.
    """
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    return None


# ---------------------------------------------------------------------------
# Virus scanning
# ---------------------------------------------------------------------------
# The key of the stored object's metadata (Storage's user metadata) that keeps
# the scan's outcome, and its values.
SCAN_KEY = "virus_scan"
SCAN_CLEAN = "clean"
NOT_SCANNED = "not_scanned"
SCANNER = "clamav"
# clamd's INSTREAM takes the file as length-prefixed chunks and a zero length.
CLAMD_CHUNK_BYTES = 64 * 1024
CLAMD_REPLY_LIMIT = 4096
CLAMD_CLEAN_REPLY = "stream: OK"
SCANNER_DOWN = "This file could not be checked for viruses right now, so it was not uploaded. Please try again shortly."


def scanner_configured() -> bool:
    """Whether uploads are scanned: a clamd host is set."""
    return bool(settings.clamav_host.strip())


def _clamd_reply(data: bytes) -> str:
    """What clamd answers for data sent with INSTREAM, such as "stream: OK". Raises OSError on a network failure."""
    address = (settings.clamav_host.strip(), settings.clamav_port)
    with socket.create_connection(address, timeout=settings.clamav_timeout_seconds) as connection:
        connection.sendall(b"zINSTREAM\0")
        for start in range(0, len(data), CLAMD_CHUNK_BYTES):
            chunk = data[start:start + CLAMD_CHUNK_BYTES]
            connection.sendall(struct.pack("!I", len(chunk)) + chunk)
        connection.sendall(struct.pack("!I", 0))
        reply = b""
        # The z prefix makes clamd end its reply with a NUL byte.
        while not reply.endswith(b"\0") and len(reply) < CLAMD_REPLY_LIMIT:
            received = connection.recv(CLAMD_REPLY_LIMIT)
            if not received:
                break
            reply += received
    return reply.rstrip(b"\0").decode("utf-8", "replace").strip()


def scan(data: bytes, now: datetime | None = None) -> dict:
    """The scan record a file is stored with, its object metadata; refuses a file that must not be stored.

    Without a scanner the file is not_scanned. With one, an infected file is
    422 and a scanner that cannot answer is 503: while scanning is on, every
    file stored has been scanned clean.
    """
    if not scanner_configured():
        return {SCAN_KEY: NOT_SCANNED}
    try:
        reply = _clamd_reply(data)
    except OSError as exc:
        logger.error("the virus scanner could not be reached: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, SCANNER_DOWN) from exc
    if reply.endswith(" FOUND"):
        # The signature name only: nothing of the file reaches the log.
        logger.warning("an upload was refused as infected: %s", reply.removeprefix("stream:").strip()[:200])
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "This file contains a virus, so it was not uploaded."
        )
    if reply != CLAMD_CLEAN_REPLY:
        # An ERROR, such as a file over clamd's StreamMaxLength, or no answer.
        logger.error("the virus scanner could not scan an upload: %s", reply[:200] or "no reply")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, SCANNER_DOWN)
    scanned_at = (now or datetime.now(timezone.utc)).isoformat()
    return {SCAN_KEY: SCAN_CLEAN, "virus_scanner": SCANNER, "virus_scanned_at": scanned_at}


def _verification_filename(filename: str | None, content_type: str) -> str:
    """Keep a readable original basename within Storage's ASCII key rules.

    Browser file names are untrusted: discard either platform's directory parts,
    control/reserved characters and excess length. The real bytes determine the
    extension, so a renamed HTML/SVG file cannot masquerade as an image.
    """
    basename = re.split(r"[/\\]", filename or "")[-1]
    basename = unicodedata.normalize("NFKD", basename).encode("ascii", "ignore").decode("ascii")
    basename = re.sub(r"\s+", " ", basename)
    basename = re.sub(r"[^A-Za-z0-9 _().-]", "-", basename)
    stem, separator, extension = basename.rpartition(".")
    if not separator:
        stem = basename
    expected = EXTENSIONS[content_type]
    allowed_extensions = {expected, ".jpeg"} if content_type == "image/jpeg" else {expected}
    suffix = f".{extension}" if separator and f".{extension.lower()}" in allowed_extensions else expected
    stem = re.sub(r"-{2,}", "-", stem).strip(" .-_")[:160].rstrip(" .") or "document"
    return f"{stem}{suffix}"


def store(upload: UploadFile, bucket: str, prefix: str, *, preserve_filename: bool = False) -> dict:
    """Validate one file against its bucket's BucketRules, scan it and upload it.

    Returns {url, path, content_type, size, virus_scan}; url is signed unless
    the bucket is public, and virus_scan is the outcome kept in the object's
    metadata (scan()).
    """
    rules = rules_for(bucket)
    unsupported = HTTPException(
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        f"Unsupported file type. Allowed: {', '.join(sorted(rules.content_types))}",
    )
    declared = (upload.content_type or "").split(";")[0].strip()
    if declared not in rules.content_types:
        raise unsupported

    # Never read more than the limit (+1 byte to detect "too large").
    data = upload.file.read(rules.max_bytes + 1)
    if len(data) > rules.max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File is too large (max {rules.max_bytes // MB} MB)",
        )
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")
    content_type = _sniff(data)
    if content_type not in rules.content_types:
        raise unsupported
    scanned = scan(data)

    unique_id = uuid.uuid4().hex
    if preserve_filename:
        path = f"{prefix}/{unique_id}/{_verification_filename(upload.filename, content_type)}"
    else:
        path = f"{prefix}/{unique_id}{EXTENSIONS[content_type]}"
    supabase = get_supabase_client()
    try:
        supabase.storage.from_(bucket).upload(
            path, data, {"content-type": content_type, "upsert": "false", "metadata": scanned}
        )
        if rules.public:
            url = public_url(bucket, path)
        else:
            signed = supabase.storage.from_(bucket).create_signed_url(path, SIGNED_URL_TTL)
            url = signed.get("signedURL") or signed.get("signedUrl")
    except Exception as exc:  # bucket missing, storage unreachable, ...
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Could not store the file. Please try again."
        ) from exc

    return {"url": url, "path": path, "content_type": content_type, "size": len(data), "virus_scan": scanned[SCAN_KEY]}


def message_attachment_folder(profile_id: str) -> str:
    return profile_id


# profile-documents keys start with the owner's users.id, as the bucket's
# policies read storage.foldername(name)[1]: the owner, the listing owners
# they apply to and admins open that folder in the mobile app. The web keeps
# a directory per upload under it, so a file keeps its own name:
# {users.id}/{32 hex}/{file name}. Files the web stored before sit under
# verification/{users.id}/, which still counts as the owner's (owned_path).
LEGACY_VERIFICATION_ROOT = "verification"


def verification_folder(profile_id: str) -> str:
    """The owner's folder in profile-documents: their users.id."""
    return profile_id


def store_message_attachment(upload: UploadFile, profile_id: str) -> dict:
    return store(upload, MESSAGE_ATTACHMENTS_BUCKET, prefix=message_attachment_folder(profile_id))


def store_verification_document(upload: UploadFile, profile_id: str) -> dict:
    return store(
        upload, VERIFICATION_DOCUMENTS_BUCKET,
        prefix=verification_folder(profile_id), preserve_filename=True,
    )


# Listing photos live in the shared project's public bucket, which the mobile
# app reads too. It takes images of up to 3 MB (migration plan §2.3, BUCKETS),
# so a file it would refuse is refused here, with the reason.
PROPERTY_IMAGES_BUCKET = "property-images"


def property_image_folder(profile_id: str) -> str:
    return profile_id


def public_url(bucket: str, path: str) -> str:
    """The permanent link to an object in a public bucket."""
    return f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/{bucket}/{quote(path)}"


def public_path(url: str | None, bucket: str) -> str | None:
    """The object key a public_url() of this project names, or None for any other link."""
    prefix = public_url(bucket, "")
    if not url or not url.startswith(prefix):
        return None
    return stored_path(unquote(url.split("?", 1)[0].split("#", 1)[0][len(prefix):]), bucket)


def store_property_image(upload: UploadFile, profile_id: str) -> dict:
    """Validate and upload one listing photo, returning {url, path, content_type, size}.

    The bucket is public, so url is the object's permanent public URL rather
    than a signed one: property_media.media_url keeps it, as the mobile app's
    rows do.
    """
    return store(upload, PROPERTY_IMAGES_BUCKET, prefix=property_image_folder(profile_id))


def stored_path(value: str | None, bucket: str) -> str | None:
    """The object key a saved file reference names, or None if it is not one of ours.

    New rows keep the key an upload returned. A client may send back the
    signed URL the upload returned with it, which names the key too. A URL
    any other project issued, such as the old web project, is not ours.
    """
    if not value:
        return None
    if "://" in value:
        signed_prefix = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/{bucket}/"
        location = value.split("?", 1)[0].split("#", 1)[0]
        if not location.startswith(signed_prefix):
            return None
        value = unquote(location[len(signed_prefix):])
    if "\\" in value or not value.isprintable() or any(part in ("", ".", "..") for part in value.split("/")):
        return None
    return value


def owned_path(value: str | None, bucket: str, folder: str) -> str | None:
    """stored_path(), but only for an object inside the uploader's own folder.

    In profile-documents the owner's folder is their users.id, and the
    verification/{users.id}/ folder the web used before is theirs too.
    """
    path = stored_path(value, bucket)
    if not path:
        return None
    if path.startswith(f"{folder}/"):
        return path
    legacy = f"{LEGACY_VERIFICATION_ROOT}/{folder}/"
    return path if bucket == VERIFICATION_DOCUMENTS_BUCKET and path.startswith(legacy) else None


def signed_urls(bucket: str, paths: Iterable[str]) -> dict[str, str]:
    """Short-lived signed URLs for stored object keys, by key. Never raises.

    A key that cannot be signed (a missing object, storage unreachable) is
    left out, so one bad file never fails the page that lists it.
    """
    now = time.monotonic()
    urls: dict[str, str] = {}
    wanted = []
    for path in dict.fromkeys(p for p in paths if p):
        reused = _reused_urls.get((bucket, path))
        if reused and reused[0] > now:
            urls[path] = reused[1]
        else:
            wanted.append(path)
    if not wanted:
        return urls
    try:
        signed = get_supabase_client().storage.from_(bucket).create_signed_urls(wanted, SIGNED_URL_TTL)
    except Exception as exc:
        logger.warning("could not sign %d stored file(s) in %s: %s", len(wanted), bucket, exc)
        return urls
    if len(_reused_urls) > MAX_REUSED_URLS:
        _reused_urls.clear()
    for item in signed:
        url = item.get("signedURL") or item.get("signedUrl")
        if item.get("path") in wanted and url and not item.get("error"):
            urls[item["path"]] = url
            _reused_urls[(bucket, item["path"])] = (now + SIGNED_URL_REUSE, url)
    return urls


def remove(bucket: str, path: str) -> None:
    """Delete one stored object. Never raises: a file left behind must not fail
    the request that tried to tidy it up."""
    try:
        get_supabase_client().storage.from_(bucket).remove([path])
    except Exception as exc:
        logger.warning("could not remove a stored file from %s: %s", bucket, exc)
