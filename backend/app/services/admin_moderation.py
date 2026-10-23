"""Review and listing moderation in the admin console (tracker R40; handover 7 step 5, 8 step 3).

Reviews: a review someone reported waits in the queue. It is FLAGGED, or
it holds a report (media_urls.reports, which mobile_report_review keeps,
from either app) newer than the last decision on it, as
mobile_admin_moderation_reports lists them. An admin hides it (HIDDEN) or
keeps it published (PUBLISHED), and restores a hidden or archived one,
always with a reason, through mobile_admin_moderate_review run as the admin
(_decide): HIDE, DISMISS and APPROVE, which also clear its reports. Nothing
is deleted: the review stays, each decision keeps the reports it decided
(decided_reports) with its actor and reason, and every list a visitor reads
leaves a HIDDEN review out (maps_reviews_complaints.VISIBLE_REVIEW_STATUSES).
The reviewer is told of each change to their review, with the reason, and
the people whose report was decided are told the outcome. The queue shows
admins what visitors never see: the private eviction answer, and the photos
through short-lived links.

Listings: an admin pauses a published one (PAUSED: out of search; its owner
may publish it again once it is fixed) or archives it (ARCHIVED: gone from
the web, as a listing its owner deleted), with a reason the owner is told.
A rented listing is never archived, and one closed to applications is never
paused, as the status trigger allows.

reviews.status and listings.status are written here for these decisions
only (services/reviews.py and services/properties.py write the rest of
those rows), and only while the row still has the status the admin saw.
Each decision is recorded, with its actor and reason, in both audit logs
(admin_audit).
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client
from app.services import admin_audit, notifications, public_profiles
from app.services import reviews as reviews_service
from app.services._common import select_all, select_in
from app.services.admin_users import contains_pattern
from app.services.maps_messaging import is_uuid, moment
from app.services.shared_map import address_of, stamp_update, web_role

ENTRIES = admin_audit.ENTRIES
REVIEW_MODERATED = reviews_service.REVIEW_MODERATED
LISTING_MODERATED = "listing.moderated"

# The queue's two views.
REPORTED_VIEW = "reported"
HIDDEN_VIEW = "hidden"
HIDEABLE = ("PUBLISHED", "FLAGGED")
TAKEN_DOWN = ("HIDDEN", "ARCHIVED")

# enforce_listing_status_transition moves only a published listing to PAUSED: one closed to
# applications reopens, is leased or is archived, never paused.
PAUSABLE = ("PUBLISHED",)
PAUSE_REFUSALS = {
    "PAUSED": "This listing is paused already.",
    "APPLICATIONS_CLOSED": "A listing closed to applications can't be paused: archive it, or ask its owner to "
                           "reopen applications first.",
}
ARCHIVABLE = ("DRAFT", "PUBLISHED", "PAUSED", "APPLICATIONS_CLOSED")
LISTING_SELECT = "*, properties(id, owner_user_id, manager_user_id, address_line_1, address_line_2, suburb, state, postcode)"

REVIEW_NOT_FOUND = "Review not found"
LISTING_NOT_FOUND = "Listing not found"
REVIEW_CHANGED = "This review changed while you were looking at it. Reload the queue and try again."
LISTING_CHANGED = "This listing changed while you were looking at it. Reload the list and try again."

# The reviewer's notice for each decision that changes their review.
REVIEW_NOTICES = {
    "hidden": ("Your review was hidden", "A TenantVoice admin hid your review of {about}."),
    "restored": ("Your review is visible again", "A TenantVoice admin restored your review of {about}."),
    "kept": ("Your review stays published", "A TenantVoice admin checked a report about your review of {about} "
                                            "and kept it."),
}
REPORTER_OUTCOMES = {
    "hidden": "A TenantVoice admin hid it.",
    "restored": "A TenantVoice admin published it again.",
    "kept": "A TenantVoice admin kept it published.",
}
# Where a provider reads the reviews about them; the reporter's notice links there.
PROVIDER_REVIEWS_PATH = "/dashboard/reviews"


def _db():
    return get_supabase_client()


def _people(user_ids) -> dict[str, dict]:
    user_ids = [user_id for user_id in set(user_ids) if user_id]
    if not user_ids:
        return {}
    rows = select_in(lambda: _db().table("users").select("id, full_name, email, primary_role").order("id"), "id",
                     user_ids)
    return {row["id"]: row for row in rows}


def _party(user_id: str | None, people: dict[str, dict]) -> dict | None:
    if not user_id:
        return None
    person = people.get(user_id) or {}
    return {
        "id": user_id,
        "full_name": person.get("full_name") or person.get("email"),
        "role": web_role(person.get("primary_role")) if person else None,
    }


def _entries(entity_type: str, action: str, entity_ids: list[str] | None = None) -> list[dict]:
    """The shared admin log's entries of one action on one kind of row, oldest first."""
    def build():
        return (
            _db().table(ENTRIES).select("id, actor_user_id, entity_id, summary, metadata, created_at")
            .eq("entity_type", entity_type).eq("action", action).order("created_at").order("id")
        )

    rows = select_all(build) if entity_ids is None else select_in(build, "entity_id", entity_ids)
    return sorted(rows, key=lambda row: (moment(row.get("created_at")), row["id"]))


def _metadata(entry: dict) -> dict:
    return entry["metadata"] if isinstance(entry.get("metadata"), dict) else {}


def _by_entity(entries: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for entry in entries:
        if entry.get("entity_id"):
            grouped.setdefault(entry["entity_id"], []).append(entry)
    return grouped


def _last_decision(decisions: list[dict]) -> datetime | None:
    """When the newest of a review's decisions (oldest first) was made; None before any."""
    return moment(decisions[-1]["created_at"]) if decisions else None


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------
# mobile_admin_moderate_review's action for each decision.
DECISION_ACTIONS = {"hidden": "HIDE", "restored": "APPROVE", "kept": "DISMISS"}
DECISION_STATUSES = {"hidden": "HIDDEN", "restored": "PUBLISHED", "kept": "PUBLISHED"}
QUEUE_COLUMNS = "id, status, updated_at, media_urls"
_LONG_AGO = datetime.min.replace(tzinfo=timezone.utc)


def _queue(view: str) -> list[tuple[str, object]]:
    """(review id, when it last moved) of every review in a view, the latest first."""
    decisions = _by_entity(_entries("review", REVIEW_MODERATED))
    if view == HIDDEN_VIEW:
        rows = select_all(lambda: _db().table("reviews").select("id, updated_at").in_("status", list(TAKEN_DOWN))
                          .order("id"))
        moved = {row["id"]: _last_decision(decisions[row["id"]]) if row["id"] in decisions
                 else moment(row.get("updated_at")) for row in rows}
        return sorted(moved.items(), key=lambda item: (item[1] or _LONG_AGO, item[0]), reverse=True)
    flagged = select_all(lambda: _db().table("reviews").select(QUEUE_COLUMNS).eq("status", "FLAGGED").order("id"))
    # A report on a review that is hidden or archived by now was decided with it.
    reported = select_all(
        lambda: _db().table("reviews").select(QUEUE_COLUMNS).in_("status", list(HIDEABLE))
        .neq("media_urls->>reports", "[]").order("id")
    )
    moved = {}
    for row in {row["id"]: row for row in flagged + reported}.values():
        waiting = reviews_service.open_reports(row, _last_decision(decisions.get(row["id"], [])))
        if row.get("status") != "FLAGGED" and not waiting:
            continue
        times = [moment(row.get("updated_at"))] if row.get("status") == "FLAGGED" else []
        times += [reviews_service.reported_at(report) for report in waiting]
        moved[row["id"]] = max((when for when in times if when), default=_LONG_AGO)
    return sorted(moved.items(), key=lambda item: (item[1], item[0]), reverse=True)


def _report_key(report: dict) -> tuple:
    return report.get("userId"), report.get("reportedAt")


def _decided_reports(entry: dict) -> list[dict]:
    """The reports a decision closed, as it kept them."""
    reports = _metadata(entry).get("decided_reports")
    return [report for report in reports if isinstance(report, dict)] if isinstance(reports, list) else []


def _review_items(review_ids: list[str]) -> list[dict]:
    """ModeratedReviewOut for these reviews, in this order, with every report and decision."""
    if not review_ids:
        return []
    rows = {row["id"]: row for row in select_in(lambda: _db().table("reviews").select("*").order("id"), "id", review_ids)}
    decisions = _by_entity(_entries("review", REVIEW_MODERATED, review_ids))
    reports: dict[str, list[dict]] = {}
    for review_id, row in rows.items():
        # Those still on the review, then those its decisions closed (one each).
        every: dict[tuple, dict] = {}
        for report in reviews_service.reports_of(row) + [
            report for entry in decisions.get(review_id, []) for report in _decided_reports(entry)
        ]:
            every.setdefault(_report_key(report), report)
        reports[review_id] = sorted(every.values(), key=lambda report: reviews_service.reported_at(report)
                                    or _LONG_AGO, reverse=True)
    people = _people(
        [row.get("reviewer_user_id") for row in rows.values()]
        + [row.get("reviewed_user_id") for row in rows.values()]
        + [entry.get("actor_user_id") for found in decisions.values() for entry in found]
        + [report.get("userId") for found in reports.values() for report in found]
    )
    listings = _listings_by_property(row.get("property_id") for row in rows.values())
    links = reviews_service.photo_links(key for row in rows.values() for key in reviews_service.photo_keys(row))
    items = []
    for review_id in review_ids:
        row = rows.get(review_id)
        if row is None:
            continue
        own_decisions = decisions.get(review_id, [])
        waiting = {_report_key(report) for report in
                   reviews_service.open_reports(row, _last_decision(own_decisions))}
        listing = listings.get(row.get("property_id")) or {}
        details = reviews_service.review_details(row)
        keys = reviews_service.photo_keys(row)
        items.append({
            "id": review_id,
            "status": row.get("status"),
            "rating": row.get("rating") or row.get("landlord_rating") or 0,
            "title": row.get("title"),
            "body": row.get("body"),
            "reply": row.get("landlord_reply"),
            "is_verified_interaction": bool(row.get("is_verified_interaction")),
            "created_at": row.get("created_at"),
            "reviewer": _party(row.get("reviewer_user_id"), people),
            "reviewed": _party(row.get("reviewed_user_id"), people),
            "property_id": row.get("property_id"),
            "listing_id": listing.get("id"),
            "property_title": listing.get("title"),
            "open_reports": len(waiting),
            "reports": [
                {
                    "id": f"{review_id}:{report.get('userId')}:{report.get('reportedAt')}",
                    "reporter": _party(report.get("userId"), people),
                    "reason": report.get("reason"),
                    "details": report.get("details"),
                    "open": _report_key(report) in waiting,
                    "created_at": report.get("reportedAt"),
                }
                for report in reports[review_id]
            ],
            "decisions": [
                {
                    "id": entry["id"],
                    "decision": _metadata(entry).get("decision"),
                    "from_status": _metadata(entry).get("from_status"),
                    "to_status": _metadata(entry).get("to_status"),
                    "reason": _metadata(entry).get("reason"),
                    "actor": _party(entry.get("actor_user_id"), people),
                    "created_at": entry["created_at"],
                }
                for entry in reversed(own_decisions)
            ],
            "ratings": details.pop("ratings") if row.get("property_id") else {},
            # For admins only: the private eviction answer included. A provider's review has none of a
            # property review's details (mobile_submit_review writes them for a property only).
            "details": details if row.get("property_id") else None,
            "photo_count": len(keys),
            "photos": [{"url": links[key], "expires_in": reviews_service.PHOTO_LINK_TTL} for key in keys
                       if key in links],
        })
    return items


def _listings_by_property(property_ids) -> dict[str, dict]:
    property_ids = [property_id for property_id in set(property_ids) if property_id]
    if not property_ids:
        return {}
    rows = select_in(
        lambda: _db().table("listings").select("id, title, property_id, created_at").order("created_at", desc=True)
        .order("id"),
        "property_id",
        property_ids,
    )
    newest: dict[str, dict] = {}
    for row in sorted(rows, key=lambda row: (moment(row.get("created_at")), row["id"]), reverse=True):
        newest.setdefault(row["property_id"], row)
    return newest


def review_queue(view: str, limit: int = 20, offset: int = 0) -> dict:
    """ReviewQueueOut: one page of a view, the latest moved first, with how many each view holds."""
    queues = {name: _queue(name) for name in (REPORTED_VIEW, HIDDEN_VIEW)}
    page = [review_id for review_id, _ in queues[view][offset:offset + limit]]
    return {
        "view": view,
        "items": _review_items(page),
        "total": len(queues[view]),
        "limit": limit,
        "offset": offset,
        "counts": {name: len(queue) for name, queue in queues.items()},
    }


def _review_row(review_id: str) -> dict:
    found = _db().table("reviews").select("*").eq("id", review_id).limit(1).execute().data if is_uuid(review_id) else []
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, REVIEW_NOT_FOUND)
    return found[0]


def _about(item: dict) -> str:
    """What a review is about, as the admin log names it: a member without a name by their email."""
    if item.get("property_title"):
        return item["property_title"]
    return (item.get("reviewed") or {}).get("full_name") or "a TenantVoice member"


def _about_for_reviewer(item: dict, row: dict) -> str:
    """What a review is about, as the reviewer's notice names it: never by someone's email or phone number."""
    if item.get("property_title"):
        return item["property_title"]
    reviewed = _people([row.get("reviewed_user_id")]).get(row.get("reviewed_user_id")) or {}
    return public_profiles.shown_name(reviewed.get("full_name")) or "a TenantVoice member"


def _decide(admin: CurrentProfile, row: dict, decision: str) -> None:
    """Apply a decision through mobile_admin_moderate_review, run as the admin.

    The function checks that the caller is an active admin (42501: 403) and
    knows the action, then sets the status and clears the reports. As it
    stands it never keeps that: it reads FOUND after an EXECUTE, which never
    sets FOUND, so every call raises P0002 ("Review report was not found.")
    and rolls its update back. For that answer about a review that is here,
    the same update is made directly: the decision's status, the reports
    cleared, and only while the review still has the status the admin
    decided on (409 otherwise). Once the function is fixed, its own update
    stands and this one is not made.
    """
    try:
        user_client(admin.access_token).rpc("mobile_admin_moderate_review", {
            "p_review_id": row["id"], "p_action": DECISION_ACTIONS[decision],
        }).execute()
        return
    except APIError as exc:
        if exc.code != "P0002":
            reviews_service.raise_for_rpc(exc)
    changes = {"status": DECISION_STATUSES[decision]}
    if isinstance(row.get("media_urls"), dict):
        changes["media_urls"] = {**row["media_urls"], "reports": []}
    changed = (
        _db().table("reviews").update(stamp_update("reviews", changes))
        .eq("id", row["id"]).eq("status", row.get("status")).execute().data
    )
    if not changed:
        raise HTTPException(status.HTTP_409_CONFLICT, REVIEW_CHANGED)


def moderate_review(admin: CurrentProfile, review_id: str, action: str, reason: str, seen_status: str | None) -> dict:
    """Hide a review, or keep or restore it published, with a reason; the review as the queue shows it."""
    row = _review_row(review_id)
    current = row.get("status")
    if seen_status is not None and seen_status != current:
        raise HTTPException(status.HTTP_409_CONFLICT, REVIEW_CHANGED)
    waiting = reviews_service.open_reports(row, _last_decision(_entries("review", REVIEW_MODERATED, [review_id])))
    if action == "hide":
        if current not in HIDEABLE:
            raise HTTPException(status.HTTP_409_CONFLICT, "This review is hidden already.")
        decision = "hidden"
    elif current in TAKEN_DOWN:
        decision = "restored"
    elif current == "FLAGGED" or waiting:
        decision = "kept"
    else:
        raise HTTPException(status.HTTP_409_CONFLICT, "This review is published and nobody's report waits on it.")
    new_status = DECISION_STATUSES[decision]
    _decide(admin, row, decision)
    item = _review_items([review_id])[0]
    reviewer = (item.get("reviewer") or {}).get("full_name") or "a member"
    verb = {"hidden": "Hid", "restored": "Restored", "kept": "Kept"}[decision]
    summary = f"{verb} {reviewer}'s review of {_about(item)}{' published' if decision == 'kept' else ''}: {reason}"
    admin_audit.record(
        admin.id, REVIEW_MODERATED, "review", review_id, summary,
        {"decision": decision, "from_status": current, "to_status": new_status, "reason": reason,
         "reviewer_id": row.get("reviewer_user_id"), "reviewed_user_id": row.get("reviewed_user_id"),
         "reports": len(waiting), "decided_reports": waiting},
    )
    if new_status != current:
        title, body = REVIEW_NOTICES[decision]
        notifications.notify(
            row.get("reviewer_user_id"), "review", title,
            f"{body.format(about=_about_for_reviewer(item, row))} Reason: {reason}",
        )
    _tell_reporters(waiting, admin.id, decision)
    return _review_items([review_id])[0]


def _tell_reporters(reports: list[dict], admin_id: str, decision: str) -> None:
    """Tell each person whose report was just decided what became of the review."""
    reporters = {report.get("userId") for report in reports} - {admin_id, None}
    people = _people(reporters)
    for reporter in sorted(reporters):
        role = web_role((people.get(reporter) or {}).get("primary_role"))
        notifications.notify(
            reporter, "review", "We checked a review you reported", REPORTER_OUTCOMES[decision],
            PROVIDER_REVIEWS_PATH if role == "service_provider" else None,
        )


# ---------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------
def _listing_actions(listing: dict) -> list[str]:
    actions = []
    if listing.get("status") in PAUSABLE:
        actions.append("pause")
    if listing.get("status") in ARCHIVABLE:
        actions.append("archive")
    return actions


def _listing_items(rows: list[dict]) -> list[dict]:
    """ModeratedListingOut for listings rows selected with LISTING_SELECT."""
    decisions = _by_entity(_entries("listing", LISTING_MODERATED, [row["id"] for row in rows])) if rows else {}
    properties = {row["id"]: row.get("properties") if isinstance(row.get("properties"), dict) else {} for row in rows}
    people = _people(
        [prop.get("owner_user_id") for prop in properties.values()]
        + [prop.get("manager_user_id") for prop in properties.values()]
        + [entry.get("actor_user_id") for entries in decisions.values() for entry in entries]
    )
    items = []
    for row in rows:
        prop = properties[row["id"]]
        last = (decisions.get(row["id"]) or [None])[-1]
        items.append({
            "id": row["id"],
            "title": row.get("title") or "Listing",
            "status": row.get("status"),
            "weekly_rent": float(row.get("weekly_rent") or 0),
            "address": address_of(prop),
            "suburb": prop.get("suburb"),
            "created_at": row.get("created_at"),
            "published_at": row.get("published_at"),
            "owner": _party(prop.get("owner_user_id"), people),
            "manager": _party(prop.get("manager_user_id"), people),
            "actions": _listing_actions(row),
            "last_decision": {
                "decision": _metadata(last).get("decision"),
                "reason": _metadata(last).get("reason"),
                "actor": _party(last.get("actor_user_id"), people),
                "created_at": last["created_at"],
            } if last else None,
        })
    return items


def listing_queue(listing_status: str | None = None, q: str | None = None, limit: int = 20, offset: int = 0) -> dict:
    """ListingPageOut: one page of listings, newest first, with the total that match."""
    query = _db().table("listings").select(LISTING_SELECT, count="exact")
    if listing_status:
        query = query.eq("status", listing_status)
    pattern = contains_pattern(q)
    if pattern:
        query = query.ilike("title", pattern)
    result = query.order("created_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    rows = result.data or []
    return {
        "items": _listing_items(rows),
        "total": result.count if result.count is not None else offset + len(rows),
        "limit": limit,
        "offset": offset,
    }


def moderate_listing(admin_id: str, listing_id: str, action: str, reason: str, seen_status: str | None) -> dict:
    """Pause or archive a listing with a reason its owner is told; the listing as the list shows it."""
    found = (
        _db().table("listings").select(LISTING_SELECT).eq("id", listing_id).limit(1).execute().data
        if is_uuid(listing_id) else []
    )
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, LISTING_NOT_FOUND)
    listing = found[0]
    current = listing.get("status")
    if seen_status is not None and seen_status != current:
        raise HTTPException(status.HTTP_409_CONFLICT, LISTING_CHANGED)
    if action == "pause":
        if current not in PAUSABLE:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                PAUSE_REFUSALS.get(current, "Only a published listing can be paused."))
        new_status, decision = "PAUSED", "paused"
    else:
        if current == "LEASED":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This listing is rented: archiving it would take the tenancy's home away in the mobile app too.",
            )
        if current not in ARCHIVABLE:
            raise HTTPException(status.HTTP_409_CONFLICT, "This listing is archived already.")
        new_status, decision = "ARCHIVED", "archived"
    changed = (
        _db().table("listings").update(stamp_update("listings", {"status": new_status}))
        .eq("id", listing_id).eq("status", current).execute().data
    )
    if not changed:
        raise HTTPException(status.HTTP_409_CONFLICT, LISTING_CHANGED)
    prop = listing.get("properties") if isinstance(listing.get("properties"), dict) else {}
    title = listing.get("title") or "Listing"
    admin_audit.record(
        admin_id, LISTING_MODERATED, "listing", listing_id,
        f"{'Paused' if decision == 'paused' else 'Archived'} the listing “{title}”: {reason}",
        {"decision": decision, "from_status": current, "to_status": new_status, "reason": reason,
         "owner_id": prop.get("owner_user_id"), "manager_id": prop.get("manager_user_id")},
    )
    if decision == "paused":
        notice = (f"Your listing “{title}” was paused",
                  f"A TenantVoice admin took it out of search. Reason: {reason} Fix it, then publish it again.",
                  f"/owner/properties/{listing_id}")
    else:
        notice = (f"Your listing “{title}” was removed", f"A TenantVoice admin archived it. Reason: {reason}",
                  "/owner/properties")
    for person in dict.fromkeys(filter(None, (prop.get("owner_user_id"), prop.get("manager_user_id")))):
        notifications.notify(person, "property", *notice)
    return _listing_items([{**changed[0], "properties": prop}])[0]
