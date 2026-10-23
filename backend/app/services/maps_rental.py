"""Rental mappings the shared tables need beyond shared_map.py (plan §3 a6, a7).

shared_map.py presents listings and applications as the web's DTOs. This
module holds the other direction for the owner and tenant flows: which
shared statuses a web status filter means, the exact statuses the web names
(listing_status, an application's stage), the lease term as whole months,
the photos of a listing, what a signed-out visitor sees of its address, and
which repairs a tenant still waits on.

It also holds the shared database's own rental rules, as the web checks
them before it calls the functions that apply them: the status moves its
triggers allow (enforce_listing_status_transition,
enforce_application_status_transition), what an owner's decision may be
(review_rental_application), the keys the mobile app reads in an
application's metadata (mobile_application_json, mobile_my_rental_history),
and how a function's error reaches the caller (function_error).
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import date, datetime

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.services import uploads
from app.services.shared_map import MAINT_TO_WEB, WEB_TO_PROPERTY_TYPE

# What deleting a listing on the web writes: mobile rows point at listings,
# so the row stays. An archived listing is gone from the web.
ARCHIVED_LISTING = "ARCHIVED"

# A web listing status -> every shared status the web shows that way.
LISTING_STATUS_FILTER: dict[str, tuple[str, ...]] = {
    "available": ("PUBLISHED", "APPLICATIONS_CLOSED"),
    "rented": ("LEASED",),
    "off_market": ("DRAFT", "PAUSED"),
}
# The statuses of the listings an owner sees on the web: all but archived.
OWNER_LISTING_STATUSES = tuple(status for statuses in LISTING_STATUS_FILTER.values() for status in statuses)
# Listings anyone may open: the catalogue's, and those closed to new applications.
PUBLIC_LISTING_STATUSES = LISTING_STATUS_FILTER["available"]
# The one status that takes applications.
OPEN_LISTING = "PUBLISHED"
# What an owner can ask to move a listing to from the web (PropertyUpdate.listing_status).
# Archiving is DELETE /me/properties/{id}, and nothing goes back to a draft.
# Which moves the database allows is LISTING_MOVES; LEASED by hand never is.
SETTABLE_LISTING_STATUSES = {
    "published": "PUBLISHED",
    "paused": "PAUSED",
    "applications_closed": "APPLICATIONS_CLOSED",
    "leased": "LEASED",
}

# A web application status -> every shared status the web shows that way.
APPLICATION_STATUS_FILTER: dict[str, tuple[str, ...]] = {
    "new": ("SUBMITTED",),
    "reviewing": ("UNDER_REVIEW", "SHORTLISTED"),
    "approved": ("APPROVED",),
    "declined": ("REJECTED", "WITHDRAWN", "EXPIRED"),
}
# A tenant may withdraw until the owner has decided.
WITHDRAWABLE_APPLICATION_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "SHORTLISTED")
# Applications the tenant or time has closed: the owner can no longer decide them.
CLOSED_APPLICATION_STATUSES = ("WITHDRAWN", "EXPIRED")
# Applications whose shared documents the listing's owner may open: still
# waiting on them, or approved. A decline, a withdrawal or the expiry ends
# the sharing.
SHARING_APPLICATION_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED")
# An application's stage as the web names it (ApplicationOut.stage): the
# shared status in lower case, with REJECTED called declined as elsewhere.
APPLICATION_STAGES = {
    "SUBMITTED": "submitted",
    "UNDER_REVIEW": "under_review",
    "SHORTLISTED": "shortlisted",
    "APPROVED": "approved",
    "REJECTED": "declined",
    "WITHDRAWN": "withdrawn",
    "EXPIRED": "expired",
}

# rental_applications.metadata key holding what the tenant shared when
# applying (docs/shared-db.md), and application_documents.metadata key
# naming the profile_documents row an attached document is.
APPLICANT_SNAPSHOT_KEY = "applicant_snapshot"
PROFILE_DOCUMENT_KEY = "profile_document_id"

MAX_LEASE_MONTHS = 120
_LEASE_TERM = re.compile(r"(\d+(?:\.\d+)?)\s*-?\s*([a-z]*)", re.IGNORECASE)
_WORDS = re.compile(r"[a-z0-9/]+")
_TOKENS = re.compile(r"[a-z0-9]+")
# Words an address line uses for a unit rather than the street.
_UNIT_WORDS = frozenset({"unit", "u", "apartment", "apt", "flat", "suite", "shop", "lot", "level", "lvl", "villa"})
# Street types, each spelling to one, so "Ln" and "Lane" read the same.
_STREET_TYPES = {
    "street": "st", "st": "st", "road": "rd", "rd": "rd", "lane": "ln", "ln": "ln", "avenue": "ave", "ave": "ave",
    "av": "ave", "drive": "dr", "dr": "dr", "place": "pl", "pl": "pl", "court": "ct", "ct": "ct",
    "crescent": "cres", "cres": "cres", "cr": "cres", "parade": "pde", "pde": "pde", "terrace": "tce", "tce": "tce",
    "highway": "hwy", "hwy": "hwy", "boulevard": "blvd", "blvd": "blvd", "close": "cl", "cl": "cl",
    "circuit": "cct", "cct": "cct", "grove": "gr", "gr": "gr", "way": "way", "square": "sq", "sq": "sq",
}


def listing_statuses(web_status: str) -> tuple[str, ...]:
    """The shared statuses a web listing status filter matches; ValueError for an unknown one."""
    try:
        return LISTING_STATUS_FILTER[web_status]
    except KeyError:
        raise ValueError(f"unknown listing status {web_status!r}") from None


def application_statuses(web_status: str) -> tuple[str, ...]:
    """The shared statuses a web application status filter matches; ValueError for an unknown one."""
    try:
        return APPLICATION_STATUS_FILTER[web_status]
    except KeyError:
        raise ValueError(f"unknown application status {web_status!r}") from None


def listing_status_name(db_status: str | None) -> str:
    """A shared ListingStatus as PropertyOut.listing_status names it: the label in lower case."""
    return (db_status or "DRAFT").lower()


def application_stage(db_status: str | None) -> str:
    """A shared ApplicationStatus as ApplicationOut.stage names it."""
    return APPLICATION_STAGES.get(db_status or "", "submitted")


def locality(prop: dict) -> str:
    """Suburb, state and postcode, "Wollongong, NSW 2500": a property's address without the street."""
    place = " ".join(part for part in (prop.get("state"), prop.get("postcode")) if part)
    return ", ".join(part for part in (prop.get("suburb"), place) if part)


def _words(text: str | None) -> str:
    return " ".join(_WORDS.findall((text or "").lower()))


def _street(prop: dict) -> tuple[set[str], list[str], str | None]:
    """A property's street numbers (the unit's too), its street's name words and its type, each
    spelling to one: "Unit 4", "12 Kingfisher Lane" -> ({"4", "12"}, ["kingfisher"], "ln")."""
    tokens = _TOKENS.findall(f"{prop.get('address_line_1') or ''} {prop.get('address_line_2') or ''}".lower())
    numbers = {token for token in tokens if token[0].isdigit()}
    line = [token for token in _TOKENS.findall((prop.get("address_line_1") or "").lower())
            if not token[0].isdigit() and token not in _UNIT_WORDS]
    kind = _STREET_TYPES.get(line[-1]) if line else None
    return numbers, line[:-1] if kind else line, kind


def names_street(title: str, prop: dict) -> bool:
    """Whether a title gives away the property's street, however it is written.

    It does when it holds the street's name with its type ("Kingfisher Ln"),
    or with one of the address's numbers ("12 Kingfisher", "Unit 4, 12
    Kingfisher Lane"). A word of the name alone ("near Kingfisher Park")
    does not.
    """
    numbers, name, kind = _street(prop)
    if not name:
        street = _words(prop.get("address_line_1"))
        return bool(street) and f" {street} " in f" {_words(title)} "
    tokens = _TOKENS.findall((title or "").lower())
    text = f" {' '.join(_STREET_TYPES.get(token, token) for token in tokens)} "
    named = " ".join(name)
    if f" {named} " not in text:
        return False
    return (kind is not None and f" {named} {kind} " in text) or any(token in numbers for token in tokens)


def public_title(title: str, prop: dict) -> str:
    """The title a signed-out visitor sees: the owner's, unless it gives away the street.

    Listings are often titled with their address ("1/23 Random Street"),
    which would put the street in front of every visitor. Such a title
    (names_street) is replaced by the kind of home and its suburb:
    "2-bedroom apartment in Wollongong".
    """
    if not names_street(title, prop):
        return title
    kind = (prop.get("property_type") or "OTHER").lower()
    noun = "home" if kind == "other" else kind
    bedrooms = prop.get("bedrooms")
    described = f"{bedrooms}-bedroom {noun}" if isinstance(bedrooms, int) and bedrooms > 0 and kind != "studio" else noun
    suburb = prop.get("suburb")
    return f"{described.capitalize()} in {suburb}" if suburb else described.capitalize()


def property_type_filter(web_type: str) -> str | None:
    """The shared PropertyType a search for a web type means, or None when no type is that one.

    Writes store any other free-text type as OTHER (db_property_type), so a
    search for "flat" would find every OTHER listing; it finds none instead.
    """
    key = web_type.strip().lower()
    return "OTHER" if key == "other" else WEB_TO_PROPERTY_TYPE.get(key)


def lease_term_months(text: str | None) -> int | None:
    """Whole months from the web's free-text lease term: "12 months", "1 year", "6".

    None when there is no term. ValueError when the text names no number of
    months or years, or one outside 1 to MAX_LEASE_MONTHS months.
    """
    if text is None or not text.strip():
        return None
    match = _LEASE_TERM.search(text)
    if match is None:
        raise ValueError(f"no number of months in the lease term {text!r}")
    number, unit = float(match.group(1)), match.group(2).lower()
    if unit.startswith(("year", "yr")) or unit == "y":
        months = number * 12
    elif not unit or unit.startswith(("month", "mth", "mo")) or unit == "m":
        months = number
    else:
        raise ValueError(f"the lease term {text!r} is not in months or years")
    if months != int(months) or not 1 <= months <= MAX_LEASE_MONTHS:
        raise ValueError(f"the lease term {text!r} is not a whole number of months from 1 to {MAX_LEASE_MONTHS}")
    return int(months)


def is_photo(media: dict) -> bool:
    """Whether a property_media row is a picture: photo_urls leaves videos out."""
    return not (media.get("media_type") or "").lower().startswith("video")


def photo_url(media: dict) -> str | None:
    """The link a property_media row shows as.

    media_url is the public URL for the web's uploads. A row that keeps only
    a key in the public listing bucket gets that object's public URL.
    """
    url = media.get("media_url") or ""
    if url.startswith(("http://", "https://")):
        return url
    if media.get("storage_bucket") == uploads.PROPERTY_IMAGES_BUCKET and media.get("storage_path"):
        return uploads.public_url(uploads.PROPERTY_IMAGES_BUCKET, media["storage_path"])
    return url or None


def repair_is_open(status: str | None) -> bool:
    """Whether a work order's status, in either case, still has the tenant waiting.

    MAINT_TO_WEB is keyed by the upper-case values the mobile app writes, so
    the status is looked up upper-cased; one it does not list counts as open.
    """
    web = MAINT_TO_WEB.get(str(status or "OPEN").upper(), "open")
    return web not in ("resolved", "cancelled")


# ---------------------------------------------------------------------------
# The shared database's rental rules
# ---------------------------------------------------------------------------
# enforce_listing_status_transition: where a listing may go from each status.
# A listing goes back to none it left, and only archiving leaves LEASED.
LISTING_MOVES: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"PUBLISHED", "ARCHIVED"}),
    "PUBLISHED": frozenset({"PAUSED", "APPLICATIONS_CLOSED", "LEASED", "ARCHIVED"}),
    "PAUSED": frozenset({"PUBLISHED", "APPLICATIONS_CLOSED", "ARCHIVED"}),
    "APPLICATIONS_CLOSED": frozenset({"PUBLISHED", "LEASED", "ARCHIVED"}),
    "LEASED": frozenset({"ARCHIVED"}),
}
LEASED_LISTING = "LEASED"
DRAFT_LISTING = "DRAFT"
# How a refusal names a listing's status, and a move to one.
_LISTING_IS = {
    "DRAFT": "a draft", "PUBLISHED": "published", "PAUSED": "paused",
    "APPLICATIONS_CLOSED": "closed to applications", "LEASED": "leased",
}
_LISTING_TO = {
    "PUBLISHED": "published", "PAUSED": "paused", "APPLICATIONS_CLOSED": "closed to applications",
    "LEASED": "marked as leased", "ARCHIVED": "archived",
}
# A listing is leased only with exactly one approved application
# (enforce_listing_application_consistency), and approving one through
# review_rental_application leases it: an owner never marks it by hand.
LEASED_BY_APPROVAL = "A listing is leased when you approve one of its applications."

# What review_rental_application takes as an owner's decision, and the
# listings it approves on.
OWNER_DECISIONS = ("UNDER_REVIEW", "SHORTLISTED", "APPROVED", "REJECTED")
APPROVABLE_LISTING_STATUSES = ("PUBLISHED", "APPLICATIONS_CLOSED")
# Applications an owner still decides (enforce_application_status_transition
# lets an owner's decision leave only these).
UNDECIDED_APPLICATION_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "SHORTLISTED")
# Applications submit_rental_application sends again as new: a tenant whose
# application was declined, withdrawn or expired may apply once more.
RESUBMITTABLE_APPLICATION_STATUSES = ("REJECTED", "WITHDRAWN", "EXPIRED")

# rental_applications.metadata.mobile: the application as the mobile app
# reads it (mobile_application_json returns these keys to the app). The web
# keeps what the tenant shared there too, under the mobile's key where the
# mobile reads one (moveInDate, leaseDuration) and as named here otherwise.
MOBILE_KEY = "mobile"
MOBILE_DETAILS = {
    "move_in_date": "moveInDate",
    "occupants": "occupants",
    "has_pets": "hasPets",
    "pets": "pets",
    "about": "about",
    "annual_income": "annualIncome",
}
LEASE_DURATION_KEY = "leaseDuration"

# A function's error code -> the status the caller gets, with the function's message.
FUNCTION_ERROR_STATUS = {
    "42501": status.HTTP_403_FORBIDDEN,
    "P0002": status.HTTP_404_NOT_FOUND,
    "23505": status.HTTP_409_CONFLICT,
    "22023": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "23514": status.HTTP_422_UNPROCESSABLE_ENTITY,
}
STILL_IN_USE = "This listing is still in use elsewhere in TenantVoice, so it can't be deleted."


def listing_move_refusal(current: str, wanted: str) -> str | None:
    """Why a listing cannot move from current to wanted, or None when the database allows the move.

    The web asks before it writes, so an owner learns why instead of getting
    the trigger's error; LEASED by hand is refused whatever the matrix says.
    """
    if wanted == current:
        return None
    if wanted == LEASED_LISTING:
        return LEASED_BY_APPROVAL
    if wanted in LISTING_MOVES.get(current, frozenset()):
        return None
    if current == LEASED_LISTING:
        return "This listing is leased, so its status can no longer change. To let the home again, create a new listing."
    return f"This listing is {_LISTING_IS.get(current, current.lower())}, so it can't be {_LISTING_TO.get(wanted, wanted.lower())}."


def decision_refusal(current: str, wanted: str, listing_status: str) -> str | None:
    """Why an owner's decision cannot move an application from current to wanted, or None.

    The checks review_rental_application and the status trigger make, asked
    before the call so the owner gets a reason rather than the trigger's text.
    """
    if wanted == current:
        return None
    if current in ("WITHDRAWN", "EXPIRED"):
        return "This application was withdrawn or has expired, so it can no longer be decided."
    if current == "REJECTED":
        return "This application was declined and the tenant was told, so it can no longer be decided."
    if current == "APPROVED":
        return "This application was approved, so it can no longer be changed."
    if wanted not in OWNER_DECISIONS:
        return "An application can't go back to new once it has been looked at."
    if wanted == "APPROVED" and listing_status not in APPROVABLE_LISTING_STATUSES:
        if listing_status == LEASED_LISTING:
            return "This listing is already leased."
        return "Publish the listing again before approving an application for it."
    return None


def function_error(exc: APIError) -> HTTPException | None:
    """What a shared function's error becomes for the caller: its message with the matching status.

    42501 -> 403, P0002 -> 404, 23505 -> 409, 22023 and 23514 -> 422, and a
    foreign key still pointing at a row being deleted (23503) -> 409. None
    for any other error, which the app's database error handler answers.
    """
    code = getattr(exc, "code", None)
    if code == "23503":
        return HTTPException(status.HTTP_409_CONFLICT, STILL_IN_USE)
    if code in FUNCTION_ERROR_STATUS:
        return HTTPException(FUNCTION_ERROR_STATUS[code], getattr(exc, "message", None) or "The change was refused.")
    return None


@contextmanager
def function_errors():
    """Run a call to a shared function, raising its error as function_error() maps it."""
    try:
        yield
    except APIError as exc:
        mapped = function_error(exc)
        if mapped is None:
            raise
        raise mapped from exc


def lease_duration(months: int | None) -> str | None:
    """A lease term as the mobile app writes leaseDuration: "12 months"."""
    if not months:
        return None
    return f"{months} month{'s' if months != 1 else ''}"


def mobile_date(value) -> date | None:
    """A date the mobile app keeps as text, read as mobile_parse_date reads it: YYYY-MM-DD or DD/MM/YYYY."""
    text = value.strip() if isinstance(value, str) else ""
    try:
        if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", text):
            year, month, day = (int(part) for part in text.split("-"))
            return date(year, month, day)
        if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", text):
            day, month, year = (int(part) for part in text.split("/"))
            return date(year, month, day)
    except ValueError:
        return None
    return None


def same_instant(stored, expected: datetime) -> bool:
    """Whether a timestamp the database returned is the moment expected."""
    if not isinstance(stored, str):
        return False
    try:
        return datetime.fromisoformat(stored.replace("Z", "+00:00")) == expected
    except ValueError:
        return False
