"""Stand-ins for the rental functions the web calls: listings and applications.

Each follows its body in output/shared-catalog/functions/<name>.sql
(2026-10-23): the same checks in the same order, the same writes, errors
and return shape. The triggers those writes fire are checked before
anything is written, as a failing statement leaves nothing behind:
enforce_listing_status_transition and enforce_application_status_transition
(BEFORE UPDATE OF status), and enforce_listing_application_consistency,
which is deferred and so checked as at commit. A delete applies the ON
DELETE rule of each foreign key that points at the rows (constraints.md),
which the schema snapshot the fake reads does not have.

The rules are copied from the catalog, not imported from the web, so a test
checks the web against the database rather than against itself.
"""

import uuid
from datetime import datetime, timezone

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

# enforce_listing_status_transition
LISTING_MOVES = {
    "DRAFT": {"PUBLISHED", "ARCHIVED"},
    "PUBLISHED": {"PAUSED", "APPLICATIONS_CLOSED", "LEASED", "ARCHIVED"},
    "PAUSED": {"PUBLISHED", "APPLICATIONS_CLOSED", "ARCHIVED"},
    "APPLICATIONS_CLOSED": {"PUBLISHED", "LEASED", "ARCHIVED"},
    "LEASED": {"ARCHIVED"},
}
# enforce_application_status_transition
APPLICATION_MOVES = {
    "SUBMITTED": {"UNDER_REVIEW", "SHORTLISTED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"},
    "UNDER_REVIEW": {"SHORTLISTED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"},
    "SHORTLISTED": {"UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"},
    "REJECTED": {"SUBMITTED"},
    "WITHDRAWN": {"SUBMITTED"},
    "EXPIRED": {"SUBMITTED"},
}
OPEN_APPLICATIONS = ("SUBMITTED", "UNDER_REVIEW", "SHORTLISTED")

# The foreign keys a rental delete reaches, from constraints.md: (child
# table, its column, the parent table, the ON DELETE rule).
ON_DELETE = (
    ("complaints", "property_id", "properties", "set null"),
    ("listings", "property_id", "properties", "cascade"),
    ("property_media", "property_id", "properties", "cascade"),
    ("red_flag_events", "property_id", "properties", "set null"),
    ("reviews", "property_id", "properties", "set null"),
    ("conversations", "listing_id", "listings", "set null"),
    ("listing_favorites", "listing_id", "listings", "cascade"),
    ("maintenance_work_orders", "listing_id", "listings", "set null"),
    ("mobile_ai_service_jobs", "listing_id", "listings", "no action"),
    ("mobile_inspection_bookings", "listing_id", "listings", "cascade"),
    ("mobile_inspection_requests", "listing_id", "listings", "cascade"),
    ("mobile_inspection_slots", "listing_id", "listings", "cascade"),
    ("mobile_inspections", "listing_id", "listings", "cascade"),
    ("owner_assistant_records", "listing_id", "listings", "no action"),
    ("rent_agreements", "listing_id", "listings", "no action"),
    ("rental_applications", "listing_id", "listings", "cascade"),
    ("application_documents", "application_id", "rental_applications", "cascade"),
    ("application_status_events", "application_id", "rental_applications", "cascade"),
    ("conversations", "application_id", "rental_applications", "set null"),
    ("mobile_ai_tenancy_records", "application_id", "rental_applications", "no action"),
    ("rent_agreements", "application_id", "rental_applications", "no action"),
    ("mobile_inspection_requests", "inspection_id", "mobile_inspections", "set null"),
    ("mobile_inspection_bookings", "slot_id", "mobile_inspection_slots", "cascade"),
)
# Children before their parents, so no removed row is pointed at while it goes.
DELETE_ORDER = (
    "application_documents", "application_status_events", "mobile_inspection_bookings",
    "mobile_inspection_requests", "mobile_inspection_slots", "mobile_inspections", "listing_favorites",
    "rental_applications", "property_media", "listings", "properties",
)


# ---------------------------------------------------------------------------
# What the functions share
# ---------------------------------------------------------------------------
def _row(ctx, table: str, row_id) -> dict | None:
    """A copy of the row, as a SELECT INTO reads it: the call's own writes do not change it."""
    found = next((row for row in ctx.rows(table) if row.get("id") == row_id), None)
    return dict(found) if found is not None else None


def _active_landlord(ctx, user_id) -> dict | None:
    """The users row of an active, undeleted LANDLORD with this id."""
    user = _row(ctx, "users", user_id)
    if user and user.get("primary_role") == "LANDLORD" and user.get("status") == "ACTIVE" and not user.get("deleted_at"):
        return user
    return None


def _owned(ctx, listing_id, owner_id) -> tuple[dict, dict] | None:
    """(listing, property) when the listing's property is owner_id's: the functions' join on owner_user_id."""
    listing = _row(ctx, "listings", listing_id)
    prop = _row(ctx, "properties", listing["property_id"]) if listing else None
    if prop is None or prop.get("owner_user_id") != owner_id:
        return None
    return listing, prop


def _listing_move(old: str, new: str) -> None:
    """enforce_listing_status_transition, as a status update fires it."""
    if new != old and new not in LISTING_MOVES.get(old, set()):
        raise api_error("22023", f"Invalid listing status transition: {old} -> {new}")


def _application_move(old: str, new: str) -> None:
    """enforce_application_status_transition, as a status update fires it."""
    if new != old and new not in APPLICATION_MOVES.get(old, set()):
        raise api_error("22023", f"Invalid application status transition: {old} -> {new}")


def _consistent(ctx, listing_id, listing_status: str, changed: dict | None = None) -> None:
    """enforce_listing_application_consistency at commit, with the statuses the call leaves.

    changed maps application ids to the status the call gives them.
    """
    changed = changed or {}
    approved = sum(
        1 for row in ctx.rows("rental_applications")
        if row["listing_id"] == listing_id and changed.get(row["id"], row["status"]) == "APPROVED"
    ) + sum(1 for row_id, value in changed.items() if value == "APPROVED" and _row(ctx, "rental_applications", row_id) is None)
    if listing_status == "LEASED" and approved != 1:
        raise api_error("23514", "A leased listing must have exactly one approved application")
    if approved > 0 and listing_status not in ("LEASED", "ARCHIVED"):
        raise api_error("23514", "An approved application requires a leased or archived listing")


def _offer_allowed(offer) -> None:
    """rental_applications_offer_weekly_rent_positive_check, which the snapshot does not carry."""
    if offer is None or not 0 < float(offer) <= 99999999.99:
        raise api_error("23514", 'new row for relation "rental_applications" violates check constraint '
                                 '"rental_applications_offer_weekly_rent_positive_check"')


def _notify(ctx, user_id, title: str, body: str, created_at: str, *, with_id: bool = True) -> None:
    row = {"user_id": user_id, "title": title, "body": body, "category": "system",
           "link": "/admin/applications", "is_read": False, "created_at": created_at}
    if with_id:
        row["id"] = str(uuid.uuid4())
    ctx.table("notifications").insert(row).execute()


def _event(ctx, application_id, from_status, to_status, note, actor, created_at) -> None:
    ctx.table("application_status_events").insert({
        "id": str(uuid.uuid4()), "application_id": application_id, "from_status": from_status,
        "to_status": to_status, "note": note, "changed_by_user_id": actor, "created_at": created_at,
    }).execute()


def delete_rows(ctx, table: str, ids: list) -> None:
    """DELETE FROM table WHERE id IN ids, as Postgres runs it with the catalog's ON DELETE rules.

    Rows a cascade reaches go too, set null clears the rest, and a row still
    pointing at a removed one through a NO ACTION key fails the statement
    with 23503 before anything changes.
    """
    removing: dict[str, set] = {table: set(ids)}
    pending = [(table, set(ids))]
    while pending:
        parent, keys = pending.pop()
        for child, column, of, rule in ON_DELETE:
            if of != parent or rule != "cascade":
                continue
            more = {row["id"] for row in ctx.rows(child) if row.get(column) in keys} - removing.get(child, set())
            if more:
                removing.setdefault(child, set()).update(more)
                pending.append((child, more))
    cleared = []
    for parent, keys in removing.items():
        for child, column, of, rule in ON_DELETE:
            if of != parent or rule == "cascade":
                continue
            left = [row["id"] for row in ctx.rows(child)
                    if row.get(column) in keys and row["id"] not in removing.get(child, set())]
            if not left:
                continue
            if rule == "no action":
                raise api_error("23503", f'update or delete on table "{parent}" violates foreign key constraint '
                                         f'"{child}_{column}_fkey" on table "{child}"')
            cleared.append((child, column, left))
    for child, column, left in cleared:
        ctx.table(child).update({column: None}).in_("id", left).execute()
    for name in DELETE_ORDER:
        if removing.get(name):
            ctx.table(name).delete().in_("id", list(removing[name])).execute()


def application_json(ctx, application_id, viewer_id) -> dict | None:
    """mobile_application_json: the application as the mobile app reads it."""
    application = _row(ctx, "rental_applications", application_id)
    listing = _row(ctx, "listings", application["listing_id"]) if application else None
    prop = _row(ctx, "properties", listing["property_id"]) if listing else None
    user = _row(ctx, "users", application["applicant_user_id"]) if application else None
    if not (application and listing and prop and user):
        return None
    meta = application.get("metadata") if isinstance(application.get("metadata"), dict) else {}
    mobile = meta.get("mobile") if isinstance(meta.get("mobile"), dict) else {}
    statuses = {"APPROVED": "Accepted", "REJECTED": "Rejected", "WITHDRAWN": "Withdrawn", "EXPIRED": "Expired"}
    full = prop.get("owner_user_id") == viewer_id or application["status"] == "APPROVED"
    parts = (prop.get("address_line_1"),) if full else ()
    photos = sorted((row for row in ctx.rows("property_media") if row.get("property_id") == prop["id"]),
                    key=lambda row: (not row.get("is_cover"), row.get("sort_order") or 0, row.get("created_at") or ""))
    def kept(key):  # nullif(metadata -> 'mobile' ->> key, '')
        value = mobile.get(key)
        return None if value in (None, "") else value

    def first(*values):  # coalesce
        return next((value for value in values if value is not None), None)

    return {
        **mobile,
        "id": application["id"],
        "userId": application["applicant_user_id"],
        "userName": first(kept("userName"), user.get("full_name"), user.get("email")),
        "userEmail": first(kept("userEmail"), user.get("email")),
        "userPhone": first(kept("userPhone"), user.get("phone")),
        "status": statuses.get(application["status"], "Pending"),
        "applicationStatus": application["status"],
        "submittedDate": application.get("submitted_at"),
        "lastStatusAt": application.get("last_status_at"),
        "propertyId": application["listing_id"],
        "listingId": application["listing_id"],
        "propertyOwnerId": prop.get("owner_user_id"),
        "propertyTitle": listing.get("title"),
        "propertyAddress": ", ".join(
            part for part in (*parts, prop.get("suburb"), prop.get("state"), prop.get("postcode")) if part is not None
        ),
        "propertyImage": photos[0]["media_url"] if photos else None,
        "rent": application.get("offer_weekly_rent"),
        "listedRent": listing.get("weekly_rent"),
        "beds": prop.get("bedrooms"),
        "baths": prop.get("bathrooms"),
        "message": application.get("message"),
        "listingStatus": listing.get("status"),
    }


# ---------------------------------------------------------------------------
# The functions
# ---------------------------------------------------------------------------
@rpc("review_rental_application")
def review_rental_application(ctx, params):
    application_id, landlord_id, wanted = params["p_application_id"], params["p_landlord_id"], params["p_status"]
    note, now = params["p_note"], params["p_now"]
    if _active_landlord(ctx, landlord_id) is None:
        raise api_error("42501", "Active landlord access is required")
    if wanted not in ("UNDER_REVIEW", "SHORTLISTED", "APPROVED", "REJECTED"):
        raise api_error("22023", "Invalid application status")
    application = _row(ctx, "rental_applications", application_id)
    owned = _owned(ctx, application["listing_id"], landlord_id) if application else None
    if owned is None:
        raise api_error("42501", "Application ownership could not be verified")
    listing = owned[0]
    current = application["status"]
    if current == wanted:
        return [{"application_id": application["id"], "application_status": current,
                 "listing_status": listing["status"], "updated_at": application["updated_at"]}]
    if current == "APPROVED":
        raise api_error("22023", "An approved application cannot be changed")
    if wanted == "APPROVED" and listing["status"] not in ("PUBLISHED", "APPLICATIONS_CLOSED"):
        raise api_error("22023", "Listing is not available for approval")

    competing = [
        dict(row) for row in ctx.rows("rental_applications")
        if row["listing_id"] == listing["id"] and row["id"] != application_id and row["status"] in OPEN_APPLICATIONS
    ] if wanted == "APPROVED" else []
    listing_status = "LEASED" if wanted == "APPROVED" else listing["status"]
    # The triggers the writes below fire; any refusal leaves nothing written.
    _application_move(current, wanted)
    for row in competing:
        _application_move(row["status"], "REJECTED")
    _listing_move(listing["status"], listing_status)
    _consistent(ctx, listing["id"], listing_status, {application_id: wanted, **{row["id"]: "REJECTED" for row in competing}})

    ctx.table("rental_applications").update({"status": wanted, "last_status_at": now, "updated_at": now}).eq(
        "id", application_id).execute()
    _event(ctx, application_id, current, wanted, note, landlord_id, now)
    for row in competing:
        ctx.table("rental_applications").update({"status": "REJECTED", "last_status_at": now, "updated_at": now}).eq(
            "id", row["id"]).execute()
        _event(ctx, row["id"], row["status"], "REJECTED", "Another application was approved.", landlord_id, now)
        _notify(ctx, row["applicant_user_id"], "Application status updated", f"{listing['title']} is no longer available.", now)
    if wanted == "APPROVED":
        ctx.table("listings").update({"status": "LEASED", "updated_at": now}).eq("id", listing["id"]).execute()
    _notify(ctx, application["applicant_user_id"], "Application status updated",
            f"{listing['title']} is now {wanted.replace('_', ' ').lower()}.", now)
    return [{"application_id": application_id, "application_status": wanted, "listing_status": listing_status,
             "updated_at": now}]


@rpc("submit_rental_application")
def submit_rental_application(ctx, params):
    listing = _row(ctx, "listings", params["p_listing_id"])
    if listing is None or listing["status"] != "PUBLISHED":
        raise api_error("22023", "Listing is not open for applications")
    prop = _row(ctx, "properties", listing["property_id"])
    landlord_id = prop.get("owner_user_id") if prop else None
    applicant, now = params["p_applicant_id"], params["p_now"]
    if applicant in (listing.get("created_by_user_id"), landlord_id):
        raise api_error("42501", "You cannot apply to your own listing")

    existing = next((dict(row) for row in ctx.rows("rental_applications")
                     if row["listing_id"] == listing["id"] and row["applicant_user_id"] == applicant), None)
    resubmitted = existing is not None
    if existing is not None:
        if existing["status"] not in ("REJECTED", "WITHDRAWN", "EXPIRED"):
            return [{"application_id": existing["id"], "application_status": existing["status"]}]
        _application_move(existing["status"], "SUBMITTED")
        _offer_allowed(params["p_offer_weekly_rent"])
        _consistent(ctx, listing["id"], listing["status"], {existing["id"]: "SUBMITTED"})
        ctx.table("rental_applications").update({
            "status": "SUBMITTED", "offer_weekly_rent": params["p_offer_weekly_rent"], "message": params["p_message"],
            "submitted_at": now, "last_status_at": now, "updated_at": now,
            "metadata": {"source": "listing_detail_apply", "resubmittedAt": now},
        }).eq("id", existing["id"]).execute()
        application_id = existing["id"]
    else:
        application_id = params["p_application_id"]
        _offer_allowed(params["p_offer_weekly_rent"])
        _consistent(ctx, listing["id"], listing["status"], {application_id: "SUBMITTED"})
        ctx.table("rental_applications").insert({
            "id": application_id, "listing_id": listing["id"], "applicant_user_id": applicant, "status": "SUBMITTED",
            "offer_weekly_rent": params["p_offer_weekly_rent"], "message": params["p_message"],
            "submitted_at": now, "last_status_at": now,
            "metadata": {"source": "listing_detail_apply", "submittedByRole": params["p_role"]},
            "created_at": now, "updated_at": now,
        }).execute()

    user = _row(ctx, "users", applicant)
    name = ((user.get("full_name") or "").strip() or user.get("email")) if user else None
    _notify(
        ctx, landlord_id, "Application resubmitted" if resubmitted else "New rental application",
        f"{name or 'A tenant'}{' resubmitted an application for ' if resubmitted else ' applied for '}{listing['title']}.",
        now, with_id=False,
    )
    return [{"application_id": application_id, "application_status": "SUBMITTED"}]


@rpc("transition_listing_status")
def transition_listing_status(ctx, params):
    owner = _active_landlord(ctx, params["p_owner_user_id"])
    if owner is None:
        raise api_error("42501", "Active landlord access is required")
    owned = _owned(ctx, params["p_listing_id"], owner["id"])
    if owned is None:
        raise api_error("42501", "Listing ownership could not be verified")
    listing, wanted, now = owned[0], params["p_status"], params["p_now"]
    if wanted not in ("DRAFT", "PUBLISHED", "PAUSED", "APPLICATIONS_CLOSED", "LEASED", "ARCHIVED"):
        raise api_error("22023", "Invalid listing status")
    if wanted == "PUBLISHED" and owner.get("verification_status") != "APPROVED":
        raise api_error("42501", "Landlord verification is required")
    _listing_move(listing["status"], wanted)
    _consistent(ctx, listing["id"], wanted)
    published_at = now if wanted == "PUBLISHED" and listing.get("published_at") is None else listing.get("published_at")
    ctx.table("listings").update({"status": wanted, "published_at": published_at, "updated_at": now}).eq(
        "id", listing["id"]).execute()
    return [{"listing_status": wanted, "published_at": published_at, "updated_at": now}]


@rpc("delete_owned_draft_listing")
def delete_owned_draft_listing(ctx, params):
    owned = _owned(ctx, params["p_listing_id"], params["p_owner_user_id"])
    if owned is None:
        raise api_error("42501", "Listing ownership could not be verified")
    listing = owned[0]
    if listing["status"] != "DRAFT":
        raise api_error("22023", "Only a draft listing can be deleted; archive active or historical listings instead")
    if any(row["listing_id"] == listing["id"] for row in ctx.rows("rental_applications")):
        raise api_error("22023", "A listing with applications cannot be deleted")
    delete_rows(ctx, "listings", [listing["id"]])
    return None


@rpc("delete_owned_unrented_property")
def delete_owned_unrented_property(ctx, params):
    owned = _owned(ctx, params["p_listing_id"], params["p_owner_user_id"])
    if owned is None:
        raise api_error("42501", "Listing ownership could not be verified")
    listing, prop = owned
    if listing["status"] == "LEASED" or any(
        row["listing_id"] == listing["id"] and row["status"] == "APPROVED" for row in ctx.rows("rental_applications")
    ):
        raise api_error("22023", "A property with rental history cannot be deleted; take it off market instead")
    deleted_media = [
        {"bucket": row["storage_bucket"], "path": row["storage_path"]}
        for row in ctx.rows("property_media")
        if row.get("property_id") == prop["id"] and row.get("storage_bucket") is not None
        and row.get("storage_path") is not None
    ]
    delete_rows(ctx, "properties", [prop["id"]])
    return [{"property_id": prop["id"], "deleted_media": deleted_media}]


@rpc("mobile_application_json")
def mobile_application_json(ctx, params):
    return application_json(ctx, params["p_application_id"], params["p_viewer_id"])


@rpc("mobile_withdraw_application")
def mobile_withdraw_application(ctx, params):
    user = ctx.caller
    if user is None:
        raise api_error("42501", "Please sign in first.")
    application = _row(ctx, "rental_applications", params["p_application_id"])
    if application is None or application["applicant_user_id"] != user["id"]:
        raise api_error("42501", "You can only withdraw your own applications.")
    if application["status"] == "WITHDRAWN":
        return application_json(ctx, application["id"], user["id"])
    if application["status"] not in OPEN_APPLICATIONS:
        raise api_error("22023", "This application can no longer be withdrawn.")
    now = datetime.now(timezone.utc).isoformat()
    listing = _row(ctx, "listings", application["listing_id"])
    _application_move(application["status"], "WITHDRAWN")
    _consistent(ctx, listing["id"], listing["status"], {application["id"]: "WITHDRAWN"})

    ctx.table("rental_applications").update({"status": "WITHDRAWN", "last_status_at": now, "updated_at": now}).eq(
        "id", application["id"]).execute()
    _event(ctx, application["id"], application["status"], "WITHDRAWN", "Withdrawn by applicant.", user["id"], now)
    prop = _row(ctx, "properties", listing["property_id"])
    name = (user.get("full_name") or "").strip() or "A tenant"
    _notify(ctx, prop["owner_user_id"], "Application withdrawn",
            f"{name} withdrew their application for {listing['title']}.", now)
    return application_json(ctx, application["id"], user["id"])
