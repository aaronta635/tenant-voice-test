"""Map the shared provider tables onto the /api/v1 provider DTOs (migration plan §3 a8, b1, b2).

The mobile app reads and writes the same rows: services live in
mobile_provider_services and credentials in profile_documents. Each mapping
reads either app's rows and writes values the other app can show.
"""

from __future__ import annotations

import re

from fastapi import HTTPException
from postgrest.exceptions import APIError

# mobile_provider_services.status: its CHECK allows active, draft and archived
# (output/shared-catalog/constraints.md). An active service is one clients can
# see and book, the web's is_active. Removing a service archives it
# (mobile_delete_provider_service), so the bookings that name it keep it.
SERVICE_LIVE_STATUS = "active"
SERVICE_DRAFT_STATUS = "draft"
SERVICE_ARCHIVED_STATUS = "archived"

# The web category codes: the CHECK list of web.service_categories.category.
WEB_CATEGORIES = (
    "co_host_inspector", "real_estate_agent", "accountant", "tradie", "cleaner",
    "photographer", "conveyancer", "property_manager", "other",
)
# The repair category codes both apps share: mobile_provider_services.category
# and a repair's complaints.category take one (their CHECK and
# mobile_repair_insert), and service_provider_profiles.service_categories
# holds a list of them, which update_own_profile checks and
# assign_maintenance_work_order matches a repair's category against. The
# labels are mobile_repair_category_label's.
GENERAL_CATEGORY = "GENERAL"
REPAIR_CATEGORY_LABELS = {
    "PLUMBING": "Plumbing",
    "ELECTRICAL": "Electrical",
    "HVAC": "Heating & Cooling",
    "APPLIANCE": "Appliance",
    "LOCKS_SECURITY": "Locks / Security",
    "LEAK": "Leak",
    "SAFETY": "Safety",
    GENERAL_CATEGORY: "General",
}
REPAIR_CATEGORIES = tuple(REPAIR_CATEGORY_LABELS)
TRADE_CATEGORIES = tuple(code for code in REPAIR_CATEGORIES if code != GENERAL_CATEGORY)
# The repair codes a provider of each web category covers: what the web writes
# to service_provider_profiles.service_categories (docs/shared-db.md). Each
# list holds GENERAL, so no provider has an empty one: review_user_verification
# approves a worker only with a category. The web category itself stays in
# service_provider_profiles.metadata[WEB_CATEGORY_KEY].
WEB_CATEGORY_CODES: dict[str, tuple[str, ...]] = {
    "tradie": REPAIR_CATEGORIES,
    "property_manager": (GENERAL_CATEGORY, "LEAK", "SAFETY"),
    "co_host_inspector": (GENERAL_CATEGORY,),
    "cleaner": (GENERAL_CATEGORY,),
    "real_estate_agent": (GENERAL_CATEGORY,),
    "accountant": (GENERAL_CATEGORY,),
    "conveyancer": (GENERAL_CATEGORY,),
    "photographer": (GENERAL_CATEGORY,),
    "other": (GENERAL_CATEGORY,),
}
WEB_CATEGORY_KEY = "category"
# A profile the mobile app wrote has codes only: a trade reads as a tradie,
# GENERAL alone as other.
MOBILE_TO_WEB_CATEGORY = {**{code: "tradie" for code in TRADE_CATEGORIES}, GENERAL_CATEGORY: "other"}

# How a shared function's refusal reaches the caller, with the function's own
# message: no access, nothing there, a repeat, or a value it does not take.
FUNCTION_ERROR_STATUS = {"42501": 403, "P0002": 404, "23505": 409, "22023": 422, "23514": 422}

# A credential's web type -> profile_documents.document_type (ProfileDocumentType).
# abn and other share OTHER, told apart by metadata.web_type.
WEB_TO_DOC_TYPE = {
    "id": "GOVERNMENT_PHOTO_ID",
    "licence": "TRADE_LICENCE",
    "insurance": "PUBLIC_LIABILITY_INSURANCE",
    "abn": "OTHER",
    "other": "OTHER",
}
# The document types that are provider credentials, and the web type each
# reads as. A user's other documents (tenancy and identity papers) are not.
DOC_TYPE_TO_WEB = {
    "GOVERNMENT_PHOTO_ID": "id",
    "PASSPORT": "id",
    "DRIVERS_LICENCE": "id",
    "TRADE_LICENCE": "licence",
    "PUBLIC_LIABILITY_INSURANCE": "insurance",
    "POLICE_CHECK": "other",
    "OTHER": "other",
}
CREDENTIAL_DOCUMENT_TYPES = list(DOC_TYPE_TO_WEB)
REVIEW_STATUS_TO_WEB = {"PENDING": "pending", "APPROVED": "verified", "REJECTED": "rejected"}

# mobile_provider_services.pricing_type is free text with the default 'flat'.
# The web prices a service three ways (tracker assumption #10) and writes
# only these: a fixed price, an hourly rate, or a "from" price that the job
# can raise. Other spellings either app may store read as the same three; an
# unknown one reads as "from", which never promises less than may be charged.
PRICING_TYPES = ("flat", "hourly", "from")
_PRICING_SPELLINGS = {
    "flat": "flat", "fixed": "flat", "fixed_price": "flat", "flat_rate": "flat", "flat_fee": "flat",
    "hourly": "hourly", "hour": "hourly", "per_hour": "hourly", "hourly_rate": "hourly", "hr": "hourly",
    "from": "from", "starting_from": "from", "from_price": "from", "starting_at": "from", "starts_at": "from",
}

_HOUR_UNITS = {"h", "hr", "hrs", "hour", "hours"}
_MINUTE_UNITS = {"m", "min", "mins", "minute", "minutes"}
_DURATION_PART = re.compile(r"(\d+(?:\.\d+)?)\s*([a-z]*)")


# ---------------------------------------------------------------------------
# Provider categories
# ---------------------------------------------------------------------------
def _web_code(value: str) -> str | None:
    code = re.sub(r"[\s-]+", "_", value.strip()).lower()
    return code if code in WEB_CATEGORIES else None


def web_category(values) -> str | None:
    """The web category of a provider's service_categories (a list of codes, or one).

    The first web code wins, in any case or with dashes (rows the web wrote
    before the shared codes, or a web label). Else the repair codes read as
    MOBILE_TO_WEB_CATEGORY does, a trade before GENERAL; else the first value
    as it is. None when there is none.
    """
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return None
    texts = [value.strip() for value in values if isinstance(value, str) and value.strip()]
    web = next((code for code in map(_web_code, texts) if code), None)
    if web:
        return web
    mobile = [MOBILE_TO_WEB_CATEGORY[text.upper()] for text in texts if text.upper() in MOBILE_TO_WEB_CATEGORY]
    if mobile:
        return "tradie" if "tradie" in mobile else mobile[0]
    return texts[0] if texts else None


def provider_category(row: dict) -> str | None:
    """The web category of a service_provider_profiles row: its metadata label, else its codes."""
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    label = meta.get(WEB_CATEGORY_KEY)
    if isinstance(label, str) and _web_code(label):
        return _web_code(label)
    return web_category(row.get("service_categories")) or web_category(meta.get("service_categories"))


def category_codes(category: str | None) -> list[str]:
    """The service_categories codes for a web category; [] before the provider picks one."""
    if not category:
        return []
    return list(WEB_CATEGORY_CODES.get(_web_code(category) or "", (GENERAL_CATEGORY,)))


def repair_category(value) -> str:
    """A stored category as one of the shared codes; anything else reads as GENERAL, as the mobile app shows it."""
    code = value.strip().upper() if isinstance(value, str) else ""
    return code if code in REPAIR_CATEGORIES else GENERAL_CATEGORY


# ---------------------------------------------------------------------------
# The shared functions' refusals
# ---------------------------------------------------------------------------
def run_function(query, statuses: dict[str, int] | None = None):
    """The data of an RPC query; a refusal the function raises answers as FUNCTION_ERROR_STATUS says.

    statuses adds or overrides codes for one call. The function's message is
    passed through: it is written for the person. Any other error is raised
    as it is, for the app's handler (main.database_error).
    """
    try:
        return query.execute().data
    except APIError as exc:
        status_code = {**FUNCTION_ERROR_STATUS, **(statuses or {})}.get(exc.code)
        if status_code is None:
            raise
        raise HTTPException(status_code, exc.message or "This could not be saved. Please try again.") from exc


# ---------------------------------------------------------------------------
# Services: mobile_provider_services <-> ProviderServiceOut
# ---------------------------------------------------------------------------
def web_pricing_type(value) -> str:
    """flat, hourly or from, for a stored pricing_type in any case or spelling; '' is the column's flat."""
    if not isinstance(value, str) or not value.strip():
        return "flat"
    return _PRICING_SPELLINGS.get(re.sub(r"[\s/-]+", "_", value.strip()).lower(), "from")


def service_duration(minutes: int | None) -> str:
    """The duration column's text for the web's minutes; '' for none (its default)."""
    return f"{minutes} minutes" if minutes else ""


def duration_minutes(text) -> int | None:
    """Minutes from the free-text duration either app writes.

    Reads "90 minutes", "90", "1.5 hours", "1h 30m" and ranges such as
    "2-3 hours" (their lower bound); None for '' or a unit it cannot read.
    """
    if text is None or isinstance(text, bool):
        return None
    if isinstance(text, (int, float)):
        return round(text) or None
    total, pending = 0.0, None
    for number, unit in _DURATION_PART.findall(str(text).lower()):
        value = float(number)
        if not unit:
            # A bare number: the start of a range, or minutes on its own.
            pending = value if pending is None else pending
            continue
        if unit in _HOUR_UNITS:
            factor = 60
        elif unit in _MINUTE_UNITS:
            factor = 1
        else:
            return None
        total += (value if pending is None else pending) * factor
        pending = None
    if pending is not None:
        total += pending
    return round(total) or None


def inclusion_list(text: str | None) -> list[str]:
    """The service form's lines as the JSON list inclusions and exclusions hold."""
    return [line.strip() for line in (text or "").splitlines() if line.strip()]


def inclusion_text(value) -> str | None:
    """An inclusions or exclusions value as the form's text: one line per item."""
    if isinstance(value, str):
        return value.strip() or None
    if not isinstance(value, list):
        return None
    lines = [str(item).strip() for item in value if isinstance(item, (str, int, float)) and not isinstance(item, bool)]
    return "\n".join(line for line in lines if line) or None


def flatten_provider_service(row: dict, sort_order: int = 0, extras: dict | None = None) -> dict:
    """A mobile_provider_services row as ProviderServiceOut.

    The table has no sort order or cancellation policy: sort_order is the
    service's place in its provider's list, and extras are what the web keeps
    for it on the provider's profile (provider_services.EXTRAS_KEY).
    """
    extras = extras or {}
    return {
        "id": row["id"],
        "provider_id": row["provider_user_id"],
        "title": row["title"],
        "description": row.get("description") or None,
        "pricing_type": web_pricing_type(row.get("pricing_type")),
        "price": float(row.get("price") or 0),
        "duration_minutes": duration_minutes(row.get("duration")),
        "inclusions": inclusion_text(row.get("inclusions")),
        "exclusions": inclusion_text(row.get("exclusions")),
        "service_area": row.get("service_area") or None,
        "category": repair_category(row.get("category")),
        "cancellation_policy": extras.get("cancellation_policy"),
        "is_active": row.get("status") == SERVICE_LIVE_STATUS,
        "sort_order": sort_order,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def service_changes(fields: dict) -> dict:
    """The jsonb mobile_create_provider_service and mobile_update_provider_service take, for the form fields given.

    Only the fields present are sent, and the function keeps the rest. A null
    clears an optional field to its empty value ('' or []); title, price,
    pricing type, category and is_active are never cleared. The functions
    trim the text and clean the lists (mobile_service_clean_list). The
    cancellation policy and sort order have no column.
    """
    changes: dict = {}
    for key, name in (("title", "title"), ("price", "price"), ("pricing_type", "pricingType"), ("category", "category")):
        if fields.get(key) is not None:
            changes[name] = fields[key]
    for key, name in (("description", "description"), ("service_area", "serviceArea")):
        if key in fields:
            changes[name] = fields[key] or ""
    if "duration_minutes" in fields:
        changes["duration"] = service_duration(fields["duration_minutes"])
    for key in ("inclusions", "exclusions"):
        if key in fields:
            changes[key] = inclusion_list(fields[key])
    if fields.get("is_active") is not None:
        changes["status"] = SERVICE_LIVE_STATUS if fields["is_active"] else SERVICE_DRAFT_STATUS
    return changes


# ---------------------------------------------------------------------------
# ABN: service_provider_profiles.metadata.abn (tracker assumption #5)
# ---------------------------------------------------------------------------
# The Australian Business Register's check: take 1 from the first digit,
# weight the eleven digits, and the sum divides by 89.
ABN_WEIGHTS = (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19)


def abn_is_valid(digits: str) -> bool:
    """Whether eleven digits pass the ABN check. The first two are check digits, so never 0X."""
    if len(digits) != len(ABN_WEIGHTS) or not digits.isascii() or not digits.isdigit() or digits[0] == "0":
        return False
    values = [int(digit) for digit in digits]
    values[0] -= 1
    return sum(weight * value for weight, value in zip(ABN_WEIGHTS, values)) % 89 == 0


def stored_abn(value: str | None) -> str | None:
    """An ABN as the profile keeps it, grouped as the ABR prints it ("51 824 753 556"); None clears it.

    Spaces may separate the digits. ValueError when the number fails the check.
    """
    digits = "".join((value or "").split())
    if not digits:
        return None
    if not abn_is_valid(digits):
        raise ValueError("not a valid ABN")
    return f"{digits[:2]} {digits[2:5]} {digits[5:8]} {digits[8:]}"


# ---------------------------------------------------------------------------
# Credentials: profile_documents <-> VerificationDocumentOut
# ---------------------------------------------------------------------------
def _metadata(row: dict) -> dict:
    return row.get("metadata") if isinstance(row.get("metadata"), dict) else {}


def web_document_type(row: dict) -> str:
    if row.get("document_type") == "OTHER":
        web_type = _metadata(row).get("web_type")
        return web_type if web_type in ("abn", "other") else "other"
    return DOC_TYPE_TO_WEB.get(row.get("document_type"), "other")


def web_document_status(row: dict) -> str:
    """pending, verified or rejected; a row verified before review_status existed counts as verified."""
    review = row.get("review_status")
    if review == "REJECTED":
        return "rejected"
    if review == "APPROVED" or row.get("is_verified"):
        return "verified"
    return REVIEW_STATUS_TO_WEB.get(review, "pending")


def flatten_profile_document(row: dict) -> dict:
    """A profile_documents row as VerificationDocumentOut; an ABN saved without a file has file_url ''.

    rejection_reason is the admin's, and only while the credential is rejected:
    a new file sends it back to review, and the reason was about the old one.
    """
    review = web_document_status(row)
    return {
        "id": row["id"],
        "provider_id": row["user_id"],
        "type": web_document_type(row),
        "label": _metadata(row).get("label"),
        "document_url": row.get("file_url") or None,
        "status": review,
        "rejection_reason": row.get("rejection_reason") if review == "rejected" else None,
        "verified_at": row.get("verified_at"),
        "created_at": row.get("submitted_at") or row.get("created_at"),
    }
