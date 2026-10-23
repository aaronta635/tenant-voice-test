"""Reviews of properties, landlords and providers (tracker R12, part of R40).

Every review is a shared reviews row: reviewer_user_id wrote it about
reviewed_user_id (a landlord, or a provider's users.id), a property review
also names its properties row, and the reviewed party answers in
landlord_reply. Moderators own status: a property shows its PUBLISHED
reviews only, and HIDDEN and ARCHIVED ones are left out everywhere.

The shared database's functions keep both apps on one set of rules, so the
web calls them instead of writing those rows itself:

- a tenant's property review is mobile_submit_review, run as the tenant
  (JWT): the 8 category ratings, a title, the text, the details (pros, cons,
  advice, recommend, disclosure, the private eviction answer, reported
  issues) and up to 4 photos. The web uploads the photos to review-photos at
  <users.id>/<file> first and removes them again when the call fails. The
  function keeps the ratings and details in media_urls.mobile and the photo
  keys in media_urls.photos (docs/shared-db.md). The homes a tenant may
  review come from mobile_reviewable_homes: an APPROVED application, and no
  review of theirs yet;
- a report is mobile_report_review, run as the reporter: a reason, optional
  details, once per member, kept in media_urls.reports, and the admins are
  told;
- a landlord's reply to a property review is reply_to_listing_review, which
  also tells the reviewer.

Their errors keep their own message, with the status the code means
(raise_for_rpc). What mobile_review_json would show is stripped here: a property
review's reviewer is "Verified tenant" or "Tenant" with no id, the private
eviction answer goes only to its author and admins, and photos only to
signed-in members, as links signed for PHOTO_LINK_TTL seconds (the bucket's
own rule, mobile_can_view_review_photo, shows a published review's photos
to any signed-in member).

A client's review of a completed booking is a review of the provider like
any other, with landlord_rating equal to its rating; the booking keeps it in
web.bookings.review_id, which also makes it the booking's only one. The
provider answers it here, in landlord_reply.
"""

from datetime import datetime, timezone
import logging
from typing import NoReturn

from fastapi import HTTPException, UploadFile, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client
from app.services import bookings as bookings_service
from app.services import notifications, provider_services, public_profiles, uploads
from app.services import service_providers as service_providers_service
from app.services.maps_bookings import booking_review
from app.services.maps_messaging import is_uuid, moment
from app.services.maps_reviews_complaints import PUBLISHED_REVIEW, VISIBLE_REVIEW_STATUSES
from app.services.shared_map import flatten_review, stamp_insert, stamp_update

logger = logging.getLogger(__name__)

TABLE = "reviews"
MODERATOR_ROLES = ("admin", "officer")
# Who reads a property review's private eviction answer besides its author.
PRIVATE_ANSWER_ROLES = ("admin",)
# The shared admin log's entries of the admin console's review decisions
# (admin_moderation). A report older than a review's newest one is decided.
DECISIONS_TABLE = "mobile_admin_audit_entries"
REVIEW_MODERATED = "review.moderated"
# What the dashboard's report (PATCH /reviews/{id}/flag) tells mobile_report_review.
REPORT_REASON = "other"
REPORT_DETAILS = "Reported from the TenantVoice web app."
# A public review with its reviewer's role, which names them (public_profiles.reviewer_label).
PUBLIC_COLUMNS = "*, reviewer:users!reviewer_user_id(primary_role)"

# media_urls.mobile.ratings: mobile_submit_review's 8 categories, each 1 to 5.
CATEGORIES = (
    "conditionAtMoveIn", "ownerResponsiveness", "complianceFairness", "costValue",
    "maintenanceHandling", "repairQuality", "safetyPrivacy", "neighbourhood",
)
MAX_PHOTOS = 4
# The private review-photos bucket: <users.id>/<file>, 5 MB, jpeg, png, webp and
# heic in the shared project (output/shared-storage-buckets.json), narrowed to
# the types uploads can tell from a file's bytes. This module is its only writer.
REVIEW_PHOTOS_BUCKET = "review-photos"
uploads.BUCKETS.setdefault(
    REVIEW_PHOTOS_BUCKET, uploads.BucketRules(5 * uploads.MB, frozenset({"image/jpeg", "image/png", "image/webp"}))
)
# How long a review photo's link works (seconds); each read signs new ones.
PHOTO_LINK_TTL = 10 * 60

# A shared function's error code, as the status the web answers with:
# insufficient_privilege, no_data_found, unique_violation, and
# invalid_parameter_value or check_violation.
RPC_STATUSES = {"42501": 403, "P0002": 404, "23505": 409, "22023": 422, "23514": 422}
PROPERTY_NOT_FOUND = "Property not found."
REVIEW_NOT_FOUND = "Review not found"


def _supabase():
    return get_supabase_client()


def raise_for_rpc(exc: APIError) -> NoReturn:
    """Answer a shared function's error: its own message, with the status its code means.

    Any other code stays the database error it is (main.database_error).
    """
    code = getattr(exc, "code", None)
    if code in RPC_STATUSES:
        raise HTTPException(RPC_STATUSES[code], exc.message or "This request could not be completed.") from exc
    raise exc


def _run(query):
    """A function call's data, or its error as raise_for_rpc() answers it."""
    try:
        return query.execute().data
    except APIError as exc:
        raise_for_rpc(exc)


def _visible(query):
    """query, keeping the reviews moderators left up (VISIBLE_REVIEW_STATUSES)."""
    return query.in_("status", list(VISIBLE_REVIEW_STATUSES))


# ---------------------------------------------------------------------------
# Reports and the decisions on them
# ---------------------------------------------------------------------------
def _media(row: dict) -> dict:
    return row["media_urls"] if isinstance(row.get("media_urls"), dict) else {}


def reports_of(row: dict) -> list[dict]:
    """Every report mobile_report_review kept on a review (media_urls.reports), oldest first."""
    reports = _media(row).get("reports")
    return [report for report in reports if isinstance(report, dict)] if isinstance(reports, list) else []


def open_reports(row: dict, decided_at: datetime | None) -> list[dict]:
    """The review's reports made after its last decision (all of them before any).

    A decision clears the reports (mobile_admin_moderate_review), but the
    web's decisions before it moved to that function left them in place.
    """
    reports = reports_of(row)
    if decided_at is None:
        return reports
    return [report for report in reports if (reported_at(report) or decided_at) > decided_at]


def reported_at(report: dict) -> datetime | None:
    """When a report was made (its reportedAt), or None when it says no readable time."""
    try:
        return moment(report.get("reportedAt"))
    except (TypeError, ValueError):
        return None


def last_decisions(review_ids: list[str]) -> dict[str, datetime]:
    """When each review had its last web decision, by id.

    A failed read never fails the list it decorates: it is logged, and every
    report reads as open.
    """
    if not review_ids:
        return {}
    query = (
        _supabase().table(DECISIONS_TABLE).select("entity_id, created_at")
        .eq("entity_type", "review").eq("action", REVIEW_MODERATED).in_("entity_id", review_ids)
    )
    try:
        rows = query.execute().data or []
    except APIError as exc:
        logger.warning("could not read review decisions: %s", exc)
        return {}
    last: dict[str, datetime] = {}
    for row in rows:
        when = moment(row.get("created_at"))
        if when and (row["entity_id"] not in last or when > last[row["entity_id"]]):
            last[row["entity_id"]] = when
    return last


def _with_reports(rows: list[dict]) -> list[dict]:
    """flatten_review() each row, flagged when FLAGGED or a report on it waits for a decision."""
    decisions = last_decisions([row["id"] for row in rows if reports_of(row)])
    reviews = [flatten_review(row) for row in rows]
    for review, row in zip(reviews, rows):
        review["is_flagged"] = review["is_flagged"] or bool(open_reports(row, decisions.get(row["id"])))
    return reviews


# ---------------------------------------------------------------------------
# Writing reviews
# ---------------------------------------------------------------------------
def decorate(reviews: list[dict]) -> list[dict]:
    if not reviews:
        return []
    client_ids = list({r["client_id"] for r in reviews if r.get("client_id")})
    users = (
        _supabase().table("users").select("id, full_name, avatar_url, metadata").in_("id", client_ids).execute().data
        or []
        if client_ids
        else []
    )
    by_id = {u["id"]: u for u in users}
    for review in reviews:
        user = by_id.get(review.get("client_id")) or {}
        meta = user.get("metadata") if isinstance(user.get("metadata"), dict) else {}
        review["client_name"] = user.get("full_name")
        review["client_avatar_url"] = user.get("avatar_url")
        review["location"] = meta.get("location")
    return reviews


def create_review(client_id: str, payload: dict) -> dict:
    """POST /reviews: a client's review of their own completed booking.

    A property review has its own form (submit_property_review): the shared
    function asks for all 8 ratings and the text, which this payload lacks.
    """
    if payload.get("property_id") or payload.get("listing_id"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Review a property with the review form: it asks for all eight ratings.",
        )
    return _create_booking_review(client_id, payload)


def _create_booking_review(client_id: str, payload: dict) -> dict:
    """A client's review of their own completed booking (migration plan §3 c3).

    It is a shared reviews row about the provider (maps_bookings.booking_review),
    linked from the booking's review_id. A booking takes one review: the link
    is written only while the booking has none, so of two reviews sent at once
    the second is taken back and refused.
    """
    booking_id = payload.get("booking_id")
    if not booking_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A property or booking is required to submit a review")
    booking = bookings_service.get_booking(booking_id)
    if booking["client_id"] != client_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only review your own bookings")
    if booking["status"] != "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can only review a completed booking")
    if booking.get("review_id"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This booking has already been reviewed")

    service_id = booking.get("service_id")
    service = provider_services.services_by_id([service_id] if service_id else []).get(service_id) or {}
    row = stamp_insert(TABLE, booking_review(booking, payload["rating"], payload.get("comment"), service.get("title")))
    created = _supabase().table(TABLE).insert(row).execute().data[0]
    try:
        attached = bookings_service.attach_review(booking_id, created["id"])
    except Exception:
        _take_back(created["id"])
        raise
    if not attached:
        _take_back(created["id"])
        raise HTTPException(status.HTTP_409_CONFLICT, "This booking has already been reviewed")

    client = bookings_service.people_by_id([client_id]).get(client_id) or {}
    notifications.notify(
        booking["provider_id"],
        "review",
        f"New {created['rating']}-star review from {client.get('full_name') or 'a client'}",
        created.get("body"),
        "/dashboard/reviews",
    )
    review = decorate([flatten_review(created)])[0]
    review["booking_id"] = booking_id
    return review


def _take_back(review_id: str) -> None:
    """Delete a review this request saved but could not link to its booking. Never raises."""
    try:
        _supabase().table(TABLE).delete().eq("id", review_id).execute()
    except Exception as exc:
        logger.error("could not take back the unlinked review %s: %s", review_id, exc)


def _property_id(listing_or_property_id: str) -> str:
    """The properties row a listing's id names; any other id is taken for a property's own."""
    if not is_uuid(listing_or_property_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, PROPERTY_NOT_FOUND)
    listing = (
        _supabase().table("listings").select("property_id").eq("id", listing_or_property_id).limit(1).execute()
    )
    return listing.data[0]["property_id"] if listing.data else listing_or_property_id


def reviewable_homes(current: CurrentProfile) -> list[dict]:
    """The homes the tenant may review (mobile_reviewable_homes, run as them), by name."""
    homes = _run(user_client(current.access_token).rpc("mobile_reviewable_homes", {})) or []
    return [
        {
            "property_id": home.get("propertyId") or home["id"],
            "listing_id": home.get("listingId"),
            "name": home.get("name") or "Your rental",
            "address": home.get("address") or None,
            "property_type": home.get("type"),
            "image_url": home.get("image"),
            "rating": float(home.get("rating") or 0),
            "review_count": int(home.get("reviewCount") or 0),
        }
        for home in homes
        if isinstance(home, dict)
    ]


def _function_details(details: dict) -> dict:
    """The review's details as mobile_submit_review reads them (p_details)."""
    names = {
        "pros": "pros", "cons": "cons", "advice_to_owner": "adviceToOwner", "would_recommend": "wouldRecommend",
        "issues_disclosed": "issuesDisclosed", "maintenance_or_eviction_issue": "maintenanceOrEvictionIssue",
        "reported_issues": "reportedIssues",
    }
    return {names[key]: value for key, value in details.items() if key in names and value is not None}


def _discard_photos(paths: list[str]) -> None:
    for path in paths:
        uploads.remove(REVIEW_PHOTOS_BUCKET, path)


def submit_property_review(current: CurrentProfile, listing_or_property_id: str, payload: dict,
                           photos: list[UploadFile]) -> dict:
    """A tenant's review of a home they rented, through mobile_submit_review; the review as its author reads it.

    The photos are stored first, under the tenant's own folder, as the
    function asks; when they or the call fail, the ones stored go again, so
    a failed review leaves no file behind.
    """
    if current.role != "tenant":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only tenants can review a property.")
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "You can attach up to 4 photos.")
    property_id = _property_id(listing_or_property_id)
    stored: list[str] = []
    try:
        for photo in photos:
            stored.append(uploads.store(photo, REVIEW_PHOTOS_BUCKET, prefix=current.id)["path"])
        saved = user_client(current.access_token).rpc("mobile_submit_review", {
            "p_property_id": property_id,
            "p_ratings": payload["ratings"],
            "p_title": payload.get("title"),
            "p_body": payload.get("body") or "",
            "p_details": _function_details(payload.get("details") or {}),
            "p_photos": stored,
        }).execute().data
    except APIError as exc:
        _discard_photos(stored)
        raise_for_rpc(exc)
    except BaseException:
        _discard_photos(stored)
        raise
    review_id = saved.get("id") if isinstance(saved, dict) else None
    rows = _supabase().table(TABLE).select("*").eq("id", review_id).limit(1).execute().data if review_id else []
    if not rows:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Your review was saved but could not be read back. Reload the page.")
    return _property_reviews(rows, current)[0]


# ---------------------------------------------------------------------------
# Reading property reviews
# ---------------------------------------------------------------------------
def _ratings(extra: dict) -> dict[str, int]:
    given = extra.get("ratings") if isinstance(extra.get("ratings"), dict) else {}
    return {
        key: given[key] for key in CATEGORIES
        if isinstance(given.get(key), int) and not isinstance(given.get(key), bool) and 1 <= given[key] <= 5
    }


def _text(extra: dict, key: str) -> str | None:
    value = extra.get(key)
    return value if isinstance(value, str) and value.strip() else None


def _flag(extra: dict, key: str) -> bool | None:
    value = extra.get(key)
    return value if isinstance(value, bool) else None


def photo_keys(row: dict) -> list[str]:
    """The review's photos (media_urls.photos) that are keys of the review-photos bucket."""
    photos = _media(row).get("photos")
    keys = [uploads.stored_path(photo, REVIEW_PHOTOS_BUCKET) for photo in photos if isinstance(photo, str)] \
        if isinstance(photos, list) else []
    return [key for key in keys if key]


def photo_links(keys) -> dict[str, str]:
    """Links to review photos by key, each signed for PHOTO_LINK_TTL seconds, in one request. Never raises.

    A photo Storage cannot sign (a missing object) is left out.
    """
    wanted = sorted(set(keys))
    if not wanted:
        return {}
    try:
        signed = _supabase().storage.from_(REVIEW_PHOTOS_BUCKET).create_signed_urls(wanted, PHOTO_LINK_TTL)
    except Exception as exc:
        logger.warning("could not sign %d review photo(s): %s", len(wanted), exc)
        return {}
    links = {}
    for item in signed or []:
        url = item.get("signedURL") or item.get("signedUrl")
        if item.get("path") in wanted and url and not item.get("error"):
            links[item["path"]] = url
    return links


def review_details(row: dict) -> dict:
    """What mobile_submit_review kept of a review (media_urls.mobile), the private answer included."""
    extra = _media(row).get("mobile")
    extra = extra if isinstance(extra, dict) else {}
    issues = extra.get("reportedIssues")
    return {
        "ratings": _ratings(extra),
        "pros": _text(extra, "pros"),
        "cons": _text(extra, "cons"),
        "advice_to_owner": _text(extra, "adviceToOwner"),
        "would_recommend": _flag(extra, "wouldRecommend"),
        "issues_disclosed": _flag(extra, "issuesDisclosed"),
        "maintenance_or_eviction_issue": _flag(extra, "maintenanceOrEvictionIssue"),
        "reported_issues": [issue for issue in issues if isinstance(issue, str)] if isinstance(issues, list) else [],
    }


def _signed_in(viewer: CurrentProfile | None) -> bool:
    """Whether the viewer may see review photos: an active member, as the bucket's rule asks."""
    return viewer is not None and (viewer.raw or {}).get("status", "ACTIVE") == "ACTIVE"


def _property_reviews(rows: list[dict], viewer: CurrentProfile | None) -> list[dict]:
    """PropertyReviewOut for each row, as viewer (None: signed out) may read it."""
    links = photo_links(key for row in rows for key in photo_keys(row)) if _signed_in(viewer) else {}
    shown = []
    for row in rows:
        mine = viewer is not None and viewer.id == row.get("reviewer_user_id")
        details = review_details(row)
        if not (mine or (viewer is not None and viewer.role in PRIVATE_ANSWER_ROLES)):
            details["maintenance_or_eviction_issue"] = None
        keys = photo_keys(row)
        review = flatten_review(row)
        for private in ("client_id", "booking_id", "is_flagged"):
            review.pop(private, None)
        shown.append({
            **review,
            **details,
            # Nobody is named: not even an author's own name goes out with their review.
            "client_name": "Verified tenant" if row.get("is_verified_interaction") else "Tenant",
            "client_avatar_url": None,
            "location": None,
            "service_title": None,
            "title": row.get("title"),
            "landlord_rating": row.get("landlord_rating"),
            "verified": bool(row.get("is_verified_interaction")),
            "status": row.get("status"),
            "photo_count": len(keys),
            "photos": [{"url": links[key], "expires_in": PHOTO_LINK_TTL} for key in keys if key in links],
            "mine": mine,
            "reported_by_me": viewer is not None and any(
                report.get("userId") == viewer.id for report in reports_of(row)
            ),
        })
    return shown


def list_property_reviews(listing_or_property_id: str, viewer: CurrentProfile | None = None) -> list[dict]:
    """A property's PUBLISHED reviews, newest first, as viewer may read them: what its review counts count.

    Anyone may read them. A reviewer is "Verified tenant", or "Tenant"
    without a verified tenancy, never their name, face or id (tracker
    assumptions #1, #11: no reviewer can opt to show a name yet).
    """
    if not is_uuid(listing_or_property_id):
        return []
    property_id = _property_id(listing_or_property_id)
    rows = (
        _supabase()
        .table(TABLE)
        .select("*")
        .eq("property_id", property_id)
        .eq("status", PUBLISHED_REVIEW)
        .order("created_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )
    return _property_reviews(rows, viewer)


def list_provider_reviews(provider_id: str, user_id: str | None = None, with_reports: bool = True) -> list[dict]:
    """Reviews about a provider or landlord, newest first.

    Reviews name the reviewed user, and a provider's id is its users.id;
    user_id, where a caller passes it as well, is that same id. Callers that
    never show is_flagged pass with_reports=False, which skips reading the
    decisions on reports.
    """
    rows = (
        _visible(_supabase().table(TABLE).select("*").eq("reviewed_user_id", user_id or provider_id))
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return decorate(_with_reports(rows) if with_reports else [flatten_review(row) for row in rows])


def list_public_provider_reviews(provider_id: str) -> list[dict]:
    """A provider's reviews as anyone may read them, newest first, for PublicReviewOut.

    A reviewer is named by their role alone, as on a public profile
    ("Verified tenant" after a booking, public_profiles.reviewer_label):
    never their name, which may be an email or a phone number, their face
    or their suburb (tracker assumptions #1, #11). Reports are not read:
    PublicReviewOut has no is_flagged.
    """
    rows = (
        _visible(_supabase().table(TABLE).select(PUBLIC_COLUMNS).eq("reviewed_user_id", provider_id))
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    shown = []
    for row in rows:
        reviewer = row.get("reviewer") if isinstance(row.get("reviewer"), dict) else {}
        label = public_profiles.reviewer_label(reviewer.get("primary_role"), row.get("is_verified_interaction"))
        shown.append({**flatten_review(row), "client_name": label, "client_avatar_url": None, "location": None})
    return shown


def list_my_submitted_reviews(user_id: str) -> list[dict]:
    rows = (
        _visible(_supabase().table(TABLE).select("*").eq("reviewer_user_id", user_id))
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return decorate([flatten_review(row) for row in rows])


def _get_visible(review_id: str) -> dict:
    """A review moderators left up; a hidden or archived one is not found."""
    if not is_uuid(review_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, REVIEW_NOT_FOUND)
    result = _visible(_supabase().table(TABLE).select("*").eq("id", review_id)).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, REVIEW_NOT_FOUND)
    return result.data[0]


def _reread(review_id: str) -> dict:
    return _supabase().table(TABLE).select("*").eq("id", review_id).limit(1).execute().data[0]


# ---------------------------------------------------------------------------
# Replies
# ---------------------------------------------------------------------------
def _reply_notice(replier_id: str, role: str | None) -> tuple[str, str | None]:
    """The title and link of the notice telling a reviewer the person their review is about answered it."""
    if role == "service_provider":
        provider = service_providers_service.get_provider_by_profile_id(replier_id) or {}
        name = provider.get("business_name") or "The provider"
        return f"{name} replied to your review", f"/providers/{provider['slug']}" if provider.get("slug") else None
    name = notifications.profile_summary(replier_id).get("full_name") or "The landlord"
    return f"{name} replied to your review", None


def _listing_of(property_id: str) -> str | None:
    """The listing reply_to_listing_review answers through: the property's published one, else its latest
    (as mobile_property_listing picks it)."""
    rows = (
        _supabase().table("listings").select("id, status, updated_at").eq("property_id", property_id)
        .order("updated_at", desc=True).order("id").limit(50).execute().data or []
    )
    rows.sort(key=lambda row: row.get("status") == "PUBLISHED", reverse=True)
    return rows[0]["id"] if rows else None


def _reply_to_property_review(review: dict, user_id: str, reply: str) -> dict:
    """The property's landlord answering a review of it, through reply_to_listing_review (it tells the reviewer)."""
    if review.get("status") == "FLAGGED" and review.get("reviewed_user_id") == user_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This review was reported and waits for a moderator. You can reply once it has been checked.",
        )
    listing_id = _listing_of(review["property_id"])
    if listing_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    _run(_supabase().rpc("reply_to_listing_review", {
        "p_listing_id": listing_id,
        "p_review_id": review["id"],
        "p_landlord_id": user_id,
        "p_reply": reply,
        "p_now": datetime.now(timezone.utc).isoformat(),
    }))
    return decorate(_with_reports([_reread(review["id"])]))[0]


def reply_to_review(review_id: str, user_id: str, reply: str, role: str | None = None) -> dict:
    """The reviewed party answering a review; the reviewer is told.

    A property review is answered through reply_to_listing_review, which
    decides who may (the property's landlord, while the review is
    published); a provider answers a review about them here.
    """
    review = _get_visible(review_id)
    if review.get("property_id"):
        return _reply_to_property_review(review, user_id, reply)
    if review["reviewed_user_id"] != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only reply to your own reviews")
    # Worked out before the reply is saved: if a read fails, nothing is written.
    title, link = _reply_notice(user_id, role)
    now = datetime.now(timezone.utc)
    changes = stamp_update(TABLE, {"landlord_reply": reply, "landlord_replied_at": now.isoformat()}, now)
    updated = _supabase().table(TABLE).update(changes).eq("id", review_id).execute().data[0]
    notifications.notify(review["reviewer_user_id"], "review", title, reply, link)
    return decorate(_with_reports([updated]))[0]


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
def _report(review_id: str, access_token: str | None, reason: str, details: str | None) -> None:
    """mobile_report_review, run as the reporter: it takes them from auth.uid()."""
    _run(user_client(access_token).rpc("mobile_report_review", {
        "p_review_id": review_id, "p_reason": reason, "p_details": details,
    }))


def report_review(review_id: str, current: CurrentProfile, reason: str, details: str | None) -> dict:
    """Any member reporting a published review for moderation, with a reason (mobile_report_review).

    The function decides: a reason it knows, details of up to 500
    characters, never one's own review, and once per member.
    """
    if not is_uuid(review_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found.")
    _report(review_id, current.access_token, reason, details)
    return {"review_id": review_id, "reason": reason, "reported_by_me": True}


def flag_review(review_id: str, reporter_id: str, role: str, access_token: str | None) -> dict:
    """The reviewed party (or staff) reporting a review from their reviews page.

    The answer is the reviews page's ReviewOut, which names the reviewer, so
    only the party a review is about or staff may ask here; anyone else
    reports through report_review. A review already reported (FLAGGED, or
    by them) is left as it is.
    """
    review = _get_visible(review_id)
    if role not in MODERATOR_ROLES and review["reviewed_user_id"] != reporter_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only report reviews about you")
    reported = review.get("status") == "FLAGGED" or any(
        report.get("userId") == reporter_id for report in reports_of(review)
    )
    if not reported:
        _report(review_id, access_token, REPORT_REASON, REPORT_DETAILS)
        review = _reread(review_id)
    return decorate(_with_reports([review]))[0]
