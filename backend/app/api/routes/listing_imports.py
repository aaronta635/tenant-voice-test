from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from app.core.deps import CurrentProfile, require_role
from app.schemas.listing_import import ListingImportOut, ListingImportUrlIn
from app.services import listing_import

router = APIRouter(tags=["listing-imports"])
landlord = require_role("landlord")

# The multipart around a PDF at the limit: its boundaries, part headers and the use_ai field.
FORM_OVERHEAD = 64 * 1024
MAX_FORM_BYTES = listing_import.MAX_PDF_BYTES + FORM_OVERHEAD
PDF_FORM = {
    "requestBody": {
        "required": True,
        "content": {"multipart/form-data": {"schema": {
            "type": "object",
            "required": ["file"],
            "properties": {
                "file": {"type": "string", "format": "binary", "description": "The listing's PDF, at most 10 MB."},
                "use_ai": {"type": "boolean", "default": False},
            },
        }}},
    },
}


@router.post("/me/listing-imports/url", response_model=ListingImportOut)
def import_listing_from_url(payload: ListingImportUrlIn, current: CurrentProfile = Depends(landlord)):
    """The listing a link opens, as the create-listing wizard's fields; nothing is saved."""
    return listing_import.import_url(current, payload.url, use_ai=payload.use_ai)


@router.post("/me/listing-imports/pdf", response_model=ListingImportOut, openapi_extra=PDF_FORM)
async def import_listing_from_pdf(request: Request, current: CurrentProfile = Depends(landlord)):
    """A listing's PDF, as the create-listing wizard's fields; the file is read in memory and never stored.

    The form is read here rather than as an UploadFile parameter: FastAPI
    would read the whole body before the sign-in and role checks, and with
    no size limit. Here they come first, and the body stops at MAX_FORM_BYTES.
    """
    upload = await _pdf_form(request)
    try:
        data = await upload["file"].read(listing_import.MAX_PDF_BYTES + 1)
        filename = upload["file"].filename
    finally:
        await upload["file"].close()
    return await run_in_threadpool(listing_import.import_pdf, current, data, filename, upload["use_ai"])


async def _pdf_form(request: Request) -> dict:
    declared = request.headers.get("content-length", "").strip()
    if declared.isdigit() and int(declared) > MAX_FORM_BYTES:
        raise _too_large()
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise _no_file()

    over = []

    async def body():
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > MAX_FORM_BYTES:
                # The parser closes the files it opened on its own exception only.
                over.append(True)
                raise MultiPartException("The form is larger than a PDF import takes.")
            yield chunk

    try:
        form = await MultiPartParser(request.headers, body(), max_files=1, max_fields=1, max_part_size=1024).parse()
    except MultiPartException:
        raise (_too_large() if over else _no_file()) from None
    file = form.get("file")
    if not isinstance(file, UploadFile):
        await form.close()
        raise _no_file()
    use_ai = form.get("use_ai")
    return {"file": file, "use_ai": isinstance(use_ai, str) and use_ai.strip().lower() in ("true", "1", "on", "yes")}


def _too_large() -> HTTPException:
    return HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, {
        "code": "too_large",
        "message": "That PDF is larger than 10 MB. Choose a smaller file, or type the details below.",
    })


def _no_file() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
        "code": "invalid_file", "message": "Choose a PDF file to import.",
    })
