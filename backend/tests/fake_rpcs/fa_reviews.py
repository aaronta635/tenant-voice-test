"""Stand-ins for the shared database's review functions (output/shared-catalog/functions, 2026-10-23).

The backend calls mobile_reviewable_homes, mobile_submit_review,
mobile_report_review and mobile_admin_moderate_review through the caller's
JWT (they read current_app_user_id()), and reply_to_listing_review through
the service role (it takes the landlord as a parameter). The functions those
call in turn (save_listing_review, mobile_repair_clean_photos,
mobile_property_listing, mobile_review_json, mobile_require_admin and
mobile_admin_log_action) are private helpers here: the backend never calls
them, so they register no stand-in.

Postgres details kept: trim() strips spaces only, round() of a numeric rounds
half away from zero, ->> renders a JSON value as text, and
jsonb_strip_nulls() drops null keys.
"""

import json
import re
import uuid
from decimal import ROUND_HALF_UP, Decimal

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

CATEGORIES = (
    "conditionAtMoveIn", "ownerResponsiveness", "complianceFairness", "costValue",
    "maintenanceHandling", "repairQuality", "safetyPrivacy", "neighbourhood",
)
LANDLORD_CATEGORIES = ("ownerResponsiveness", "complianceFairness", "maintenanceHandling", "repairQuality")
REPORT_REASONS = {
    "spam": "Spam",
    "misleading": "Misleading information",
    "offensive": "Offensive content",
    "hate": "Hate speech or discrimination",
    "privacy": "Privacy violation",
    "other": "Other",
}
MODERATION_STATUSES = {"APPROVE": "PUBLISHED", "DISMISS": "PUBLISHED", "REJECT": "HIDDEN", "HIDE": "HIDDEN",
                       "DELETE": "HIDDEN"}

# mobile_admin_moderate_review checks FOUND after an EXECUTE, which never sets
# it (PL/pgSQL: "EXECUTE changes the output of GET DIAGNOSTICS, but does not
# change FOUND"), and FOUND starts false in every call. So every call that
# passes its admin and action checks raises P0002 and rolls back. A test that
# needs the function as it would work once fixed sets this to True.
MODERATION_FOUND_AFTER_EXECUTE = False


# ---------------------------------------------------------------------------
# Postgres semantics
# ---------------------------------------------------------------------------
def _trim(value: str | None) -> str | None:
    """trim(): spaces only, as Postgres's default trims."""
    return value.strip(" ") if isinstance(value, str) else value


def _text(value) -> str | None:
    """jsonb ->> key: a string as itself, anything else as its JSON text, a JSON null as NULL."""
    if value is None or isinstance(value, str):
        return value
    return json.dumps(value)


def _nullif_blank(value: str | None) -> str | None:
    """nullif(trim(coalesce(value, '')), '')."""
    trimmed = _trim(value or "")
    return trimmed or None


def _round(value: Decimal, places: int = 0) -> Decimal:
    """round(numeric[, places]): half away from zero."""
    return value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def _strip_nulls(document: dict) -> dict:
    """jsonb_strip_nulls(): object keys with a null value go, nested objects too."""
    return {key: _strip_nulls(value) if isinstance(value, dict) else value
            for key, value in document.items() if value is not None}


def _row(ctx, table: str, **match) -> dict | None:
    for row in ctx.rows(table):
        if all(row.get(column) == value for column, value in match.items()):
            return row
    return None


def _notify(ctx, user_id: str, title: str, body: str, category: str, link: str, now: str) -> None:
    ctx.table("notifications").insert({
        "id": str(uuid.uuid4()), "user_id": user_id, "title": title, "body": body, "category": category,
        "link": link, "is_read": False, "created_at": now,
    }).execute()


def _admin_link(listing_id: str | None) -> str:
    return f"/admin/listings/{listing_id}" if listing_id else "/admin/properties"


# ---------------------------------------------------------------------------
# Helpers the functions call
# ---------------------------------------------------------------------------
def _property_listing(ctx, property_id: str | None) -> tuple[str | None, str | None]:
    """mobile_property_listing(): (listing_id, title) of the property's published listing, else its latest."""
    listings = [row for row in ctx.rows("listings") if row.get("property_id") == property_id]
    if not listings:
        return None, None
    listings.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    listings.sort(key=lambda row: row.get("status") == "PUBLISHED", reverse=True)
    return listings[0]["id"], listings[0].get("title")


def _clean_photos(photos, owner: str) -> list[str]:
    """mobile_repair_clean_photos(): distinct trimmed keys in first-seen order, at most 4, each <owner>/<file>."""
    paths: dict[str, None] = {}
    for raw in photos or []:
        path = _trim(raw)
        if path:
            paths.setdefault(path)
    if len(paths) > 4:
        raise api_error("22023", "You can attach up to 4 photos.")
    for path in paths:
        if not re.fullmatch(re.escape(owner) + r"/[A-Za-z0-9._-]+", path):
            raise api_error("22023", "A photo could not be attached. Please add it again.")
    return list(paths)


def _approved_tenant(ctx, user_id: str, property_id: str) -> bool:
    """An APPROVED application of user_id's to a listing of the property."""
    listings = {row["id"] for row in ctx.rows("listings") if row.get("property_id") == property_id}
    return any(row.get("applicant_user_id") == user_id and row.get("status") == "APPROVED"
               and row.get("listing_id") in listings for row in ctx.rows("rental_applications"))


def _save_listing_review(ctx, property_id, landlord_id, reviewer_id, rating, landlord_rating, title, body,
                         now) -> str:
    """save_listing_review(): the PUBLISHED, verified reviews row of an approved tenant, once per property."""
    if not 1 <= rating <= 5 or not 1 <= landlord_rating <= 5:
        raise api_error("22023", "Property and landlord ratings must be between 1 and 5")
    if _row(ctx, "properties", id=property_id, owner_user_id=landlord_id) is None:
        raise api_error("42501", "The reviewed landlord does not own this property")
    if not _approved_tenant(ctx, reviewer_id, property_id):
        raise api_error("42501", "Only an approved tenant can review this property")
    if _row(ctx, "reviews", property_id=property_id, reviewer_user_id=reviewer_id) is not None:
        raise api_error("23505", "A tenant can only review a property once")
    review_id = str(uuid.uuid4())
    ctx.table("reviews").insert({
        "id": review_id, "property_id": property_id, "reviewer_user_id": reviewer_id,
        "reviewed_user_id": landlord_id, "rating": rating, "landlord_rating": landlord_rating, "title": title,
        "body": body, "media_urls": None, "is_verified_interaction": True, "status": "PUBLISHED",
        "created_at": now, "updated_at": now,
    }).execute()
    return review_id


def _review_json(ctx, review_id: str, viewer: str | None) -> dict | None:
    """mobile_review_json(): the review as the mobile app reads it, for viewer."""
    review = _row(ctx, "reviews", id=review_id)
    if review is None:
        return None
    media = review["media_urls"] if isinstance(review.get("media_urls"), dict) else {}
    extra = media["mobile"] if isinstance(media.get("mobile"), dict) else {}
    prop = _row(ctx, "properties", id=review.get("property_id")) or {}
    reviewer = _row(ctx, "users", id=review.get("reviewer_user_id")) or {}
    listing_id, title = _property_listing(ctx, review.get("property_id"))
    reports = media.get("reports") if isinstance(media.get("reports"), list) else []
    return {
        "id": review["id"],
        "propertyId": review.get("property_id"),
        "listingId": listing_id,
        "propertyName": title or "Property",
        "propertyAddress": ", ".join(part for part in (prop.get("suburb"), prop.get("state")) if part is not None),
        "userId": review.get("reviewer_user_id"),
        "userName": _trim(reviewer.get("full_name")) or "Verified tenant",
        "rating": review.get("rating"),
        "landlordRating": review.get("landlord_rating"),
        "ratings": extra.get("ratings", {}),
        "title": review.get("title") or "",
        "overallComments": review.get("body") or "",
        "comment": review.get("body") or "",
        "pros": _text(extra.get("pros")) or "",
        "cons": _text(extra.get("cons")) or "",
        "adviceToOwner": _text(extra.get("adviceToOwner")) or "",
        "wouldRecommend": extra.get("wouldRecommend"),
        "reportedIssues": extra.get("reportedIssues", []),
        "issuesDisclosed": extra.get("issuesDisclosed"),
        "maintenanceOrEvictionIssue": extra.get("maintenanceOrEvictionIssue"),
        "photos": media.get("photos", []),
        "verified": review.get("is_verified_interaction"),
        "status": (review.get("status") or "").lower(),
        "landlordReply": review.get("landlord_reply"),
        "landlordRepliedAt": review.get("landlord_replied_at"),
        "mine": review.get("reviewer_user_id") == viewer,
        "reportedByMe": any(isinstance(report, dict) and report.get("userId") == viewer for report in reports),
        "date": str(review.get("created_at") or "")[:10],
        "createdAt": review.get("created_at"),
    }


def _require_admin(ctx) -> str:
    """mobile_require_admin(): the caller, an active ADMIN, or 42501."""
    caller = ctx.caller
    if caller is None or caller.get("primary_role") != "ADMIN":
        raise api_error("42501", "You need admin privileges to access this page.")
    return caller["id"]


def _log_action(ctx, actor, action, entity_type, entity_id, summary, metadata) -> None:
    """mobile_admin_log_action(): one mobile_admin_audit_entries row."""
    ctx.table("mobile_admin_audit_entries").insert({
        "actor_user_id": actor, "action": action[:80], "entity_type": entity_type[:80], "entity_id": entity_id,
        "summary": summary[:500], "metadata": metadata if metadata is not None else {},
    }).execute()


# ---------------------------------------------------------------------------
# The functions the backend calls
# ---------------------------------------------------------------------------
@rpc("mobile_reviewable_homes")
def mobile_reviewable_homes(ctx, params):
    """The caller's homes with an APPROVED application they have not reviewed yet, by name."""
    caller = ctx.caller
    if caller is None:
        raise api_error("42501", "Please sign in first.")
    user = caller["id"]
    homes = []
    for prop in ctx.rows("properties"):
        if not _approved_tenant(ctx, user, prop["id"]):
            continue
        if _row(ctx, "reviews", property_id=prop["id"], reviewer_user_id=user) is not None:
            continue
        listing_id, title = _property_listing(ctx, prop["id"])
        media = sorted(
            (row for row in ctx.rows("property_media") if row.get("property_id") == prop["id"]),
            key=lambda row: (not row.get("is_cover"), row.get("sort_order") or 0, str(row.get("created_at") or "")),
        )
        published = [row["rating"] for row in ctx.rows("reviews")
                     if row.get("property_id") == prop["id"] and row.get("status") == "PUBLISHED"]
        # coalesce(round(avg(rating)::numeric, 1), 0): a numeric such as 4.5, or the integer 0.
        rating = float(_round(Decimal(sum(published)) / len(published), 1)) if published else 0
        property_type = prop.get("property_type")
        homes.append({
            "id": prop["id"],
            "propertyId": prop["id"],
            "listingId": listing_id,
            "name": title or "Your rental",
            "address": ", ".join(part for part in (prop.get("suburb"), prop.get("state")) if part is not None),
            "type": property_type.lower().capitalize() if property_type else None,
            "ownerId": prop.get("owner_user_id"),
            "image": media[0]["media_url"] if media else None,
            "rating": rating,
            "reviewCount": len(published),
        })
    return sorted(homes, key=lambda home: home["name"])


@rpc("mobile_submit_review")
def mobile_submit_review(ctx, params):
    """A tenant's structured review of a property: 8 ratings, the text, details and photo keys."""
    caller = ctx.caller
    if caller is None:
        raise api_error("42501", "Please sign in first.")
    if caller.get("primary_role") != "TENANT":
        raise api_error("42501", "Only tenants can review a property.")
    user = caller["id"]
    user_name = _trim(caller.get("full_name")) or caller.get("email")

    given = params.get("p_ratings")
    if not isinstance(given, dict):
        raise api_error("22023", "Please rate all categories before continuing.")
    ratings = {}
    for key in CATEGORIES:
        value = _text(given.get(key))
        if value is None or not re.fullmatch(r"[1-5]", value):
            raise api_error("22023", "Please rate all categories before continuing.")
        ratings[key] = int(value)

    body = params.get("p_body")
    if not _nullif_blank(body):
        raise api_error("22023", "Please share your overall experience.")
    if len(_trim(body)) > 4000:
        raise api_error("22023", "Your review can be up to 4000 characters.")
    title = params.get("p_title")
    if len(_trim(title or "")) > 120:
        raise api_error("22023", "The review title can be up to 120 characters.")
    details = params.get("p_details")
    if not isinstance(details, dict):  # coalesce(p_details, '{}'), and '{}' for a non-object
        details = {}
    if any(len(_text(details.get(key)) or "") > 1000 for key in ("pros", "cons", "adviceToOwner")):
        raise api_error("22023", "Pros, cons and advice can be up to 1000 characters each.")

    photos = _clean_photos(params.get("p_photos"), user)
    rating = int(_round(Decimal(sum(ratings[key] for key in CATEGORIES)) / len(CATEGORIES)))
    landlord_rating = int(_round(Decimal(sum(ratings[key] for key in LANDLORD_CATEGORIES)) / len(LANDLORD_CATEGORIES)))

    prop = _row(ctx, "properties", id=params.get("p_property_id"))
    if prop is None:
        raise api_error("P0002", "Property not found.")
    owner = prop["owner_user_id"]
    listing_id, listing_title = _property_listing(ctx, prop["id"])
    now = ctx.now()
    review_id = _save_listing_review(ctx, prop["id"], owner, user, rating, landlord_rating, _nullif_blank(title),
                                     _trim(body), now)

    def flag(key):
        return details.get(key) if isinstance(details.get(key), bool) else None

    issues = details.get("reportedIssues") if isinstance(details.get("reportedIssues"), list) else []
    reported = [_trim(text)[:80] for text in map(_text, issues) if _nullif_blank(text)]
    extra = _strip_nulls({
        "ratings": ratings,
        "pros": _nullif_blank(_text(details.get("pros"))),
        "cons": _nullif_blank(_text(details.get("cons"))),
        "adviceToOwner": _nullif_blank(_text(details.get("adviceToOwner"))),
        "wouldRecommend": flag("wouldRecommend"),
        "issuesDisclosed": flag("issuesDisclosed"),
        "maintenanceOrEvictionIssue": flag("maintenanceOrEvictionIssue"),
        "reportedIssues": reported or None,  # jsonb_agg of no rows is null
    })
    ctx.table("reviews").update({"media_urls": {"photos": photos, "mobile": extra}}).eq("id", review_id).execute()

    if owner is not None and owner != user:
        _notify(ctx, owner, "New property review",
                f"{user_name} rated {listing_title or 'your property'} {rating}/5.", "social",
                _admin_link(listing_id), now)
    return _review_json(ctx, review_id, user)


@rpc("mobile_report_review")
def mobile_report_review(ctx, params):
    """One report per member on a PUBLISHED review not their own, kept in media_urls.reports; admins are told."""
    caller = ctx.caller
    if caller is None:
        raise api_error("42501", "Please sign in first.")
    user = caller["id"]
    reason = params.get("p_reason")
    label = REPORT_REASONS.get(reason) if isinstance(reason, str) else None
    if label is None:
        raise api_error("22023", "Please select a reason for reporting this review.")
    details = params.get("p_details")
    if len(details or "") > 500:
        raise api_error("22023", "Extra details can be up to 500 characters.")

    review = _row(ctx, "reviews", id=params.get("p_review_id"), status="PUBLISHED")
    if review is None:
        raise api_error("P0002", "Review not found.")
    if review.get("reviewer_user_id") == user:
        raise api_error("22023", "You cannot report your own review.")
    media = dict(review["media_urls"]) if isinstance(review.get("media_urls"), dict) else {}
    reports = media.get("reports", [])
    if not isinstance(reports, list):
        raise api_error("22023", "cannot extract elements from a scalar")
    if any(isinstance(report, dict) and report.get("userId") == user for report in reports):
        raise api_error("23505", "You have already reported this review.")

    now = ctx.now()
    media["reports"] = [*reports, _strip_nulls({
        "userId": user, "reason": reason, "details": _nullif_blank(details), "reportedAt": now,
    })]
    ctx.table("reviews").update({"media_urls": media}).eq("id", review["id"]).execute()

    listing_id, _ = _property_listing(ctx, review.get("property_id"))
    quoted = (review.get("title") or None) or review.get("body") or "Review"
    note = _nullif_blank(details)
    body = f'{label}: "{quoted[:80]}"' + (f" — {note[:200]}" if note else "")
    for admin in ctx.rows("users"):
        if admin.get("primary_role") == "ADMIN" and admin.get("status") == "ACTIVE" and admin.get("deleted_at") is None:
            _notify(ctx, admin["id"], "Review reported", body, "system", _admin_link(listing_id), now)
    return _review_json(ctx, review["id"], user)


@rpc("mobile_admin_moderate_review")
def mobile_admin_moderate_review(ctx, params):
    """An admin's decision: APPROVE or DISMISS publish the review, REJECT, HIDE or DELETE hide it; reports clear.

    As the function stands, its update never survives: see MODERATION_FOUND_AFTER_EXECUTE.
    """
    admin = _require_admin(ctx)
    action = _trim(params.get("p_action") or "").upper()
    new_status = MODERATION_STATUSES.get(action)
    if new_status is None:
        raise api_error("22023", "Unsupported moderation action.")
    review_id = params.get("p_review_id")
    review = _row(ctx, "reviews", id=review_id)
    if not MODERATION_FOUND_AFTER_EXECUTE or review is None:
        # The exception rolls the update back, so nothing is written.
        raise api_error("P0002", "Review report was not found.")
    media = review.get("media_urls")
    changes = {"status": new_status, "updated_at": ctx.now()}
    if isinstance(media, dict):
        changes["media_urls"] = {**media, "reports": []}
    ctx.table("reviews").update(changes).eq("id", review_id).execute()
    _log_action(ctx, admin, "MODERATE_REVIEW", "review", review_id,
                "Approved a reported review." if new_status == "PUBLISHED" else "Rejected and hid a reported review.",
                {"action": action, "status": new_status})
    return {"id": review_id, "status": new_status}


@rpc("reply_to_listing_review")
def reply_to_listing_review(ctx, params):
    """The property's landlord answering a PUBLISHED review of it; the reviewer is told."""
    listing = _row(ctx, "listings", id=params.get("p_listing_id"))
    if listing is None:
        raise api_error("P0002", "Listing not found")
    landlord_id = params.get("p_landlord_id")
    prop = _row(ctx, "properties", id=listing.get("property_id")) or {}
    if prop.get("owner_user_id") != landlord_id:
        raise api_error("42501", "Only the property landlord can reply to this review")
    landlord = _row(ctx, "users", id=landlord_id)
    if (landlord is None or landlord.get("primary_role") != "LANDLORD" or landlord.get("status") != "ACTIVE"
            or landlord.get("deleted_at") is not None):
        raise api_error("42501", "Active landlord access is required")
    review = _row(ctx, "reviews", id=params.get("p_review_id"))
    if review is None:
        raise api_error("P0002", "Review not found")
    if review.get("property_id") != listing.get("property_id") or review.get("status") != "PUBLISHED":
        raise api_error("42501", "This review does not belong to the listing")
    reply = _nullif_blank(params.get("p_reply"))
    if reply is None or len(reply) > 2000:
        raise api_error("22023", "Reply must be between 1 and 2000 characters")

    now = params.get("p_now")
    ctx.table("reviews").update({
        "reviewed_user_id": landlord_id, "landlord_reply": reply, "landlord_replied_at": now, "updated_at": now,
    }).eq("id", review["id"]).execute()
    _notify(ctx, review["reviewer_user_id"], "Landlord replied to your review",
            "The property owner posted a public reply to your review.", "social",
            f"/admin/listings/{listing['id']}", now)
    return review["id"]
