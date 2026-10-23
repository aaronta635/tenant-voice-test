"""Owner listings and the public listing catalogue, on the shared tables.

A web property is a shared listings row with its properties row. Its id is
the listing's: applications, inspections and repairs hang off listings
(shared_map.flatten_listing). A listing belongs to whoever owns or manages
its property (properties.owner_user_id, manager_user_id), not to whoever
created it: agents create listings for owners. Writes stamp the ids and
times Prisma's client would (shared_map.stamp_insert / stamp_update).

A listing's status moves as the shared database lets it
(maps_rental.LISTING_MOVES): the web refuses any other move (409) before it
writes. For a property's owner who is a LANDLORD, the move, publishing
included, goes through transition_listing_status, which checks their
verification again; the database's functions take a LANDLORD owner only,
so an agent's or a manager's move is written here, under the same checks.
Deleting follows delete_owned_unrented_property, as the mobile app's delete
does: the property goes with its listing, its applications and its photos,
unless it has a tenancy (409). A property with other listings keeps them:
a draft goes through delete_owned_draft_listing, any other is archived.

The public catalogue sends a signed-out visitor no street address: address
holds the suburb, state and postcode, and a title that names the street
describes the home instead (maps_rental.public_title). Nobody's email or
phone number is in a listing; tenants message the landlord in the app.
Likes are listing_favorites rows, written only here.
"""

import logging
from collections.abc import Callable
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client
from app.services import audit, gates, public_profiles, uploads
from app.services._common import search_term, select_in
from app.services.maps_messaging import is_uuid
from app.services.maps_rental import (
    ARCHIVED_LISTING,
    CLOSED_APPLICATION_STATUSES,
    DRAFT_LISTING,
    LEASED_BY_APPROVAL,
    LEASED_LISTING,
    LISTING_STATUS_FILTER,
    OPEN_LISTING,
    OWNER_LISTING_STATUSES,
    PUBLIC_LISTING_STATUSES,
    SETTABLE_LISTING_STATUSES,
    WITHDRAWABLE_APPLICATION_STATUSES,
    application_stage,
    function_errors,
    is_photo,
    lease_term_months,
    listing_move_refusal,
    listing_status_name,
    listing_statuses,
    locality,
    photo_url,
    property_type_filter,
    public_title,
)
from app.services.shared_map import (
    db_listing_status,
    db_property_type,
    flatten_listing,
    stamp_insert,
    stamp_update,
    web_listing_status,
)

logger = logging.getLogger(__name__)

NOT_FOUND = "Property not found"
FAVORITES = "listing_favorites"
# The text a listing cannot be saved without: listings.title and the NOT NULL
# address columns of properties, which PropertyCreate leaves optional.
REQUIRED_TEXT = ("title", "address", "suburb", "state", "postcode")
# The property columns a location search matches each of its words against.
LOCATION_COLUMNS = ("suburb", "state", "postcode", "address_line_1", "address_line_2")
# A signed-out search matches only what a signed-out visitor is shown, so no
# street word or number can confirm where a listing is.
PUBLIC_LOCATION_COLUMNS = ("suburb", "state", "postcode")
MAX_LOCATION_WORDS = 5
# Rows asked for per request when reading a whole table.
PAGE_SIZE = 1000


def _supabase():
    return get_supabase_client()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)


def listing_row(listing_id: str) -> dict | None:
    """The listings row with this id; None for anything but a uuid, which the id column would refuse."""
    if not is_uuid(listing_id):
        return None
    rows = _supabase().table("listings").select("*").eq("id", listing_id).limit(1).execute().data
    return rows[0] if rows else None


def _property(property_id: str) -> dict | None:
    rows = _supabase().table("properties").select("*").eq("id", property_id).limit(1).execute().data
    return rows[0] if rows else None


def listing_property(listing: dict) -> dict | None:
    """The properties row of a listing."""
    return _property(listing["property_id"])


def owns(prop: dict | None, user_id: str) -> bool:
    """Whether the user owns or manages the property (plan §3 a6, decision 11)."""
    return bool(prop) and user_id in (prop.get("owner_user_id"), prop.get("manager_user_id"))


def owned_listing(listing_id: str, owner_id: str) -> tuple[dict, dict]:
    """(listing, property) of a listing the user owns or manages, else 404.

    An archived listing was deleted on the web, so it is not found either.
    """
    listing = listing_row(listing_id)
    prop = _property(listing["property_id"]) if listing else None
    if not listing or listing.get("status") == ARCHIVED_LISTING or not owns(prop, owner_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return listing, prop


def owned_listings(
    owner_id: str, columns: str = "*", statuses: tuple[str, ...] = OWNER_LISTING_STATUSES
) -> list[dict]:
    """The listings of every property the user owns or manages, newest first; never archived ones."""
    supabase = _supabase()
    properties = (
        supabase.table("properties")
        .select("id")
        .or_(f"owner_user_id.eq.{owner_id},manager_user_id.eq.{owner_id}")
        .execute()
        .data
        or []
    )
    if not properties:
        return []
    return (
        supabase.table("listings")
        .select(columns)
        .in_("property_id", [row["id"] for row in properties])
        .in_("status", list(statuses))
        .order("created_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )


def _media_for(property_ids: list[str]) -> dict[str, list[dict]]:
    """Each property's photos, cover first, each with media_url set to the link to show."""
    if not property_ids:
        return {}
    rows = (
        _supabase()
        .table("property_media")
        .select("*")
        .in_("property_id", property_ids)
        .order("is_cover", desc=True)
        .order("sort_order")
        .order("created_at")
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        if is_photo(row):
            grouped.setdefault(row["property_id"], []).append({**row, "media_url": photo_url(row)})
    return grouped


def cover_photos(property_ids: list[str]) -> dict[str, str]:
    """Each property's cover photo link, for lists that show one photo a listing."""
    return {
        property_id: photos[0]["media_url"]
        for property_id, photos in _media_for(list(dict.fromkeys(property_ids))).items()
        if photos and photos[0].get("media_url")
    }


def _reviews_for_properties(property_ids: list[str]) -> dict[str, list[dict]]:
    if not property_ids:
        return {}
    rows = (
        _supabase()
        .table("reviews")
        .select("property_id, rating")
        .in_("property_id", property_ids)
        # Hidden, flagged and archived reviews are not shown, so they do not count.
        .eq("status", "PUBLISHED")
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        if row.get("property_id"):
            grouped.setdefault(row["property_id"], []).append(row)
    return grouped


def _assemble(listings: list[dict], properties: dict[str, dict] | None = None, *,
              public: bool = False, signed_in: bool = False, owner: bool = False) -> list[dict]:
    """PropertyOut rows for listings, each with its property, photos and review figures.

    A listing's property comes from properties (by id) or from an embedded
    properties object; any other is read here. public gives the catalogue's
    view (PublicPropertyOut), which keeps the street from a signed-out visitor;
    owner adds the street line on its own, for the edit form.
    """
    if not listings:
        return []
    by_id = dict(properties or {})
    for listing in listings:
        embedded = listing.pop("properties", None)
        if isinstance(embedded, dict):
            by_id[embedded["id"]] = embedded
    wanted = {listing["property_id"] for listing in listings}
    if missing := list(wanted - set(by_id)):
        rows = _supabase().table("properties").select("*").in_("id", missing).execute().data or []
        by_id.update((row["id"], row) for row in rows)
    found = list(wanted & set(by_id))
    media = _media_for(found)
    reviews = _reviews_for_properties(found)
    assembled = []
    for listing in listings:
        prop = by_id.get(listing["property_id"])
        if prop is None:
            continue
        item = flatten_listing(listing, prop, media.get(prop["id"], []), reviews.get(prop["id"], []))
        item["listing_status"] = listing_status_name(listing.get("status"))
        if owner:
            item["street_address"] = prop.get("address_line_1")
        if public:
            item["accepting_applications"] = listing.get("status") == OPEN_LISTING
            item["address_hidden"] = not signed_in
            if not signed_in:
                item["address"] = locality(prop)
                item["title"] = public_title(item["title"], prop)
        assembled.append(item)
    return assembled


def _owner_view(listings: list[dict], properties: dict[str, dict] | None = None) -> list[dict]:
    """OwnerPropertyOut rows: the listings with their street line and application counts."""
    return _with_application_counts(_assemble(listings, properties, owner=True))


def _with_application_counts(items: list[dict]) -> list[dict]:
    """Each listing's applications, leaving out the withdrawn and expired."""
    rows = select_in(
        lambda: _supabase().table("rental_applications").select("id, listing_id, status").order("id"),
        "listing_id",
        [item["id"] for item in items],
    )
    counts: dict[str, list[int]] = {}
    for row in rows:
        if row.get("status") in CLOSED_APPLICATION_STATUSES:
            continue
        count = counts.setdefault(row["listing_id"], [0, 0])
        count[0] += 1
        count[1] += row.get("status") == "SUBMITTED"
    for item in items:
        item["application_count"], item["new_application_count"] = counts.get(item["id"], [0, 0])
    return items


# ---------------------------------------------------------------------------
# Owner writes
# ---------------------------------------------------------------------------
def _clean_text(payload: dict, *, partial: bool = False) -> None:
    """Trim the REQUIRED_TEXT fields in place, or 422 naming the blank or missing ones.

    An edit (partial) checks only the fields it sends: one left out keeps
    its value, but an empty or null one would blank a NOT NULL column.
    """
    missing = []
    for field in REQUIRED_TEXT:
        if partial and field not in payload:
            continue
        value = str(payload.get(field) or "").strip()
        if value:
            payload[field] = value
        else:
            missing.append(field)
    if missing:
        names = missing[0] if len(missing) == 1 else f"{', '.join(missing[:-1])} and {missing[-1]}"
        raise _unprocessable(f"{names.capitalize()} {'is' if len(missing) == 1 else 'are'} required.")


def _optional_text(value) -> str | None:
    """Text that may be cleared: trimmed, with an empty one stored as null."""
    text = str(value).strip() if value is not None else ""
    return text or None


def _listing_status(web_status: str | None) -> str:
    try:
        return db_listing_status(web_status)
    except ValueError:
        raise _unprocessable("Status must be available, rented or off_market.") from None


def _lease_months(text: str | None) -> int | None:
    try:
        return lease_term_months(text)
    except ValueError:
        raise _unprocessable("Enter the lease term as a number of months or years, such as 12 months.") from None


def _photo_urls(urls: list[str]) -> list[str]:
    """The photo links in order, each once; 422 for anything but an http(s) link.

    The wizard uploads each file to /uploads/property-image and sends the
    links it gets. An inline data: URL would put a whole image into
    property_media.media_url, which the mobile app reads too.
    """
    links: list[str] = []
    for url in urls:
        url = url.strip()
        if not url.startswith(("https://", "http://")):
            raise _unprocessable("Photos must be links to uploaded images.")
        if url not in links:
            links.append(url)
    return links


def photo_folder(prop: dict) -> str:
    """Where a property's photos are stored once it exists: <owner id>/<property id>, as the mobile app's
    storage policy keeps them (mobile_property_images_insert_own)."""
    return f"{prop['owner_user_id']}/{prop['id']}"


def _web_upload(path: str | None, user_id: str, prop: dict | None = None) -> bool:
    """Whether an object key is one the web stored for this user: in their own upload folder, which
    the create wizard uses before the property exists, or in the property's folder (photo_folder)."""
    if not path:
        return False
    return path.startswith(f"{uploads.property_image_folder(user_id)}/") or (
        prop is not None and path.startswith(f"{photo_folder(prop)}/")
    )


def _media_row(prop: dict, owner_id: str, url: str, position: int) -> dict:
    """A property_media row for a photo link. One the web uploaded for this owner names its object."""
    path = uploads.public_path(url, uploads.PROPERTY_IMAGES_BUCKET)
    if not _web_upload(path, owner_id, prop):
        path = None
    return stamp_insert(
        "property_media",
        {
            "property_id": prop["id"],
            "media_url": url,
            "media_type": "image",
            "sort_order": position,
            "is_cover": position == 0,
            "storage_bucket": uploads.PROPERTY_IMAGES_BUCKET if path else None,
            "storage_path": path,
            "uploaded_by_user_id": owner_id,
        },
    )


def upload_photo(property_id: str, owner_id: str, upload: UploadFile) -> dict:
    """Store a photo for a listing the user owns or manages, in its property's folder (photo_folder).

    Returns {url, path, content_type, size, virus_scan}; the url goes in the
    listing's photo_urls, and saving the listing adds the photo.
    """
    _, prop = owned_listing(property_id, owner_id)
    return uploads.store(upload, uploads.PROPERTY_IMAGES_BUCKET, prefix=photo_folder(prop))


def _is_landlord(user_id: str) -> bool:
    """Whether the account is a LANDLORD: the shared listing functions take no other owner."""
    rows = _supabase().table("users").select("primary_role").eq("id", user_id).limit(1).execute().data
    return bool(rows) and rows[0].get("primary_role") == "LANDLORD"


def _transition(listing_id: str, owner_id: str, wanted: str, now: datetime) -> None:
    """transition_listing_status for the property's LANDLORD owner, its error mapped (function_error)."""
    with function_errors():
        _supabase().rpc("transition_listing_status", {
            "p_listing_id": listing_id, "p_owner_user_id": owner_id, "p_status": wanted, "p_now": now.isoformat(),
        }).execute()


def _move_listing(listing: dict, prop: dict, user_id: str, wanted: str, now: datetime) -> None:
    """Move a listing the user owns or manages to wanted, a move listing_move_refusal allows.

    The property's LANDLORD owner moves it through transition_listing_status.
    The function takes nobody else, so an agent's or a manager's move is
    written here as the function writes it, published_at set on the first
    publication only, and the database's status triggers check it. That
    write applies only while the listing has the status read, so a move made
    meanwhile is never overwritten (409).
    """
    if prop.get("owner_user_id") == user_id and _is_landlord(user_id):
        _transition(listing["id"], user_id, wanted, now)
        return
    fields = {"status": wanted}
    if wanted == OPEN_LISTING and not listing.get("published_at"):
        fields["published_at"] = now.isoformat()
    with function_errors():
        moved = (
            _supabase().table("listings").update(stamp_update("listings", fields, now))
            .eq("id", listing["id"]).eq("status", listing["status"]).execute().data
        )
    if not moved:
        raise HTTPException(status.HTTP_409_CONFLICT, "This listing changed meanwhile. Reload it and try again.")


def _undo(created: list[tuple[str, str]]) -> None:
    """Remove the rows a failed create wrote, newest first, so no half listing is left."""
    for table, row_id in reversed(created):
        try:
            _supabase().table(table).delete().eq("id", row_id).execute()
        except Exception as exc:
            logger.error("could not remove %s %s after a failed listing create: %s", table, row_id, exc)


def list_my_properties(owner_id: str, status_filter: str | None = None) -> list[dict]:
    statuses = OWNER_LISTING_STATUSES
    if status_filter:
        try:
            statuses = listing_statuses(status_filter)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Unknown status filter. Use available, rented or off_market."
            ) from None
    return _owner_view(owned_listings(owner_id, statuses=statuses))


def get_my_property(property_id: str, owner_id: str) -> dict:
    listing, prop = owned_listing(property_id, owner_id)
    return _owner_view([listing], {prop["id"]: prop})[0]


def create_property(owner_id: str, payload: dict, on_publish: Callable[[str], None] | None = None) -> dict:
    """A new listing, PUBLISHED unless the payload keeps it off the market (PAUSED).

    A LANDLORD's listing is saved as a draft and published through
    transition_listing_status; an agent's is saved published (module
    docstring). A new listing is never leased (422): approving an
    application leases one. on_publish(listing_id) runs once a published
    listing is saved: the route's match alerts (services/matching.py).
    """
    payload = {k: v for k, v in payload.items() if v is not None}
    _clean_text(payload)
    listing_status = _listing_status(payload.get("status"))
    if listing_status == LEASED_LISTING:
        raise _unprocessable(f"A new listing can't be rented yet. {LEASED_BY_APPROVAL}")
    lease_months = _lease_months(payload.get("lease_term"))
    photos = _photo_urls(payload.get("photo_urls") or [])
    if listing_status == OPEN_LISTING:
        # Only a verified owner publishes (R18); a listing kept off the market needs no check.
        gates.require_verified(owner_id, "publish_listing")
    publish_after = listing_status == OPEN_LISTING and _is_landlord(owner_id)
    now = _now()
    supabase = _supabase()

    # Two tables and their photos with no transaction: a failure part way
    # removes what was written (plan §3 a6).
    created: list[tuple[str, str]] = []
    try:
        prop = supabase.table("properties").insert(
            stamp_insert(
                "properties",
                {
                    "owner_user_id": owner_id,
                    "property_type": db_property_type(payload.get("property_type")),
                    "nickname": payload["title"],
                    "address_line_1": payload["address"],
                    "suburb": payload["suburb"],
                    "state": payload["state"],
                    "postcode": payload["postcode"],
                    "country": "AU",
                    "bedrooms": payload.get("bedrooms"),
                    "bathrooms": payload.get("bathrooms"),
                    "parking_spaces": payload.get("parking"),
                    "metadata": {"amenities": payload.get("amenities") or []},
                },
                now,
            )
        ).execute().data[0]
        created.append(("properties", prop["id"]))

        fields = {
            "property_id": prop["id"],
            "created_by_user_id": owner_id,
            "title": payload["title"],
            "description": _optional_text(payload.get("description")),
            "weekly_rent": payload["price"],
            "bond_amount": payload.get("bond"),
            "available_from": payload.get("available_from"),
            "lease_term_months": lease_months,
            "status": DRAFT_LISTING if publish_after else listing_status,
        }
        if listing_status == OPEN_LISTING and not publish_after:
            fields["published_at"] = now.isoformat()
        listing = supabase.table("listings").insert(stamp_insert("listings", fields, now)).execute().data[0]
        created.append(("listings", listing["id"]))

        if photos:
            media = supabase.table("property_media").insert(
                [_media_row(prop, owner_id, url, position) for position, url in enumerate(photos)]
            ).execute().data or []
            created.extend(("property_media", row["id"]) for row in media)
        if publish_after:
            _transition(listing["id"], owner_id, OPEN_LISTING, now)
            listing = listing_row(listing["id"]) or listing
    except Exception:
        _undo(created)
        raise

    audit.record(
        owner_id, "property.created", "property", listing["id"],
        {"title": listing.get("title"), "status": listing.get("status")},
    )
    if listing_status == OPEN_LISTING and on_publish:
        on_publish(listing["id"])
    return _owner_view([listing], {prop["id"]: prop})[0]


def _new_status(listing: dict, payload: dict) -> str | None:
    """The shared status an edit moves the listing to, or None when it asks for no change."""
    if "listing_status" in payload:
        wanted = SETTABLE_LISTING_STATUSES.get(payload["listing_status"])
        if wanted is None:
            raise _unprocessable("Listing status must be published, paused, applications_closed or leased.")
        return wanted if wanted != listing["status"] else None
    if "status" in payload:
        wanted = _listing_status(payload["status"])
        # A shared status the web shows the same way stays as it is: making a
        # listing closed to applications "available" must not reopen it.
        return wanted if web_listing_status(listing["status"]) != payload["status"] else None
    return None


def update_property(
    property_id: str, owner_id: str, payload: dict, on_publish: Callable[[str], None] | None = None,
) -> dict:
    """Apply an edit: payload holds only the fields the request sent.

    A field left out keeps its value and a null clears an optional one; the
    title, the address fields and the rent cannot be cleared (422). Nothing
    is written when a check fails. on_publish(listing_id) runs once an edit
    that moves the listing to PUBLISHED is saved, and never for any other.
    """
    listing, prop = owned_listing(property_id, owner_id)
    payload = {
        key: value for key, value in payload.items()
        if value is not None or key not in ("status", "listing_status")
    }
    if "status" in payload and "listing_status" in payload:
        raise _unprocessable("Send either status or listing_status, not both.")
    if not payload:
        return get_my_property(property_id, owner_id)
    _clean_text(payload, partial=True)
    if "price" in payload and payload["price"] is None:
        raise _unprocessable("Weekly rent is required.")
    new_status = _new_status(listing, payload)
    if new_status and (refusal := listing_move_refusal(listing["status"], new_status)):
        # A move the database's status trigger refuses is refused before anything is written.
        raise HTTPException(status.HTTP_409_CONFLICT, refusal)
    if new_status == OPEN_LISTING or (
        new_status in PUBLIC_LISTING_STATUSES and listing["status"] not in PUBLIC_LISTING_STATUSES
    ):
        # Publishing, publishing again and reopening applications put the
        # listing up for applications, and closing applications on a listing
        # nobody could open puts it in public view: only a verified owner may
        # (R18). Closing applications on a published listing is no publishing.
        gates.require_verified(owner_id, "publish_listing")
    now = _now()

    listing_update = {}
    for src, dest in (("title", "title"), ("price", "weekly_rent"), ("bond", "bond_amount"),
                      ("available_from", "available_from")):
        if src in payload:
            listing_update[dest] = payload[src]
    if "description" in payload:
        listing_update["description"] = _optional_text(payload["description"])
    if "lease_term" in payload:
        listing_update["lease_term_months"] = _lease_months(_optional_text(payload["lease_term"]))

    prop_update = {}
    for src, dest in (("address", "address_line_1"), ("suburb", "suburb"), ("state", "state"),
                      ("postcode", "postcode"), ("bedrooms", "bedrooms"), ("bathrooms", "bathrooms"),
                      ("parking", "parking_spaces"), ("title", "nickname")):
        if src in payload:
            prop_update[dest] = payload[src]
    if "property_type" in payload:
        prop_update["property_type"] = db_property_type(payload["property_type"])
    if "amenities" in payload:
        meta = dict(prop["metadata"]) if isinstance(prop.get("metadata"), dict) else {}
        meta["amenities"] = payload["amenities"] or []
        prop_update["metadata"] = meta
    photos = _photo_urls(payload["photo_urls"] or []) if "photo_urls" in payload else None

    supabase = _supabase()
    if new_status:
        # First, so a move the database refuses (such as publishing unverified) changes nothing else.
        _move_listing(listing, prop, owner_id, new_status, now)
    if prop_update:
        prop = (
            supabase.table("properties")
            .update(stamp_update("properties", prop_update, now))
            .eq("id", prop["id"])
            .execute()
            .data[0]
        )
    if photos is not None:
        _sync_photos(prop, owner_id, photos)
    # Every edit moves the listing's updated_at, the one PropertyOut shows.
    listing = (
        supabase.table("listings")
        .update(stamp_update("listings", listing_update, now))
        .eq("id", listing["id"])
        .execute()
        .data[0]
    )
    if new_status:
        audit.record(
            owner_id, "property.status_changed", "property", property_id,
            {"status": web_listing_status(new_status), "listing_status": listing_status_name(new_status)},
        )
    if new_status == OPEN_LISTING and on_publish:
        on_publish(listing["id"])
    return _owner_view([listing], {prop["id"]: prop})[0]


def _sync_photos(prop: dict, owner_id: str, urls: list[str]) -> None:
    """Make the property's photos exactly urls, in order, the first one the cover.

    A row already showing a link is kept and renumbered, a new link gets a
    row, and the other photos' rows go. Videos are not photos and stay.
    """
    supabase = _supabase()
    rows = [
        row
        for row in supabase.table("property_media").select("*").eq("property_id", prop["id"]).execute().data or []
        if is_photo(row)
    ]
    by_url: dict[str, dict] = {}
    for row in rows:
        by_url.setdefault(photo_url(row), row)
    kept: dict[str, int] = {}  # media id -> new position
    added = []
    for position, url in enumerate(urls):
        row = by_url.get(url)
        if row is not None:
            kept[row["id"]] = position
        else:
            added.append(_media_row(prop, owner_id, url, position))
    removed = [row for row in rows if row["id"] not in kept]
    if removed:
        supabase.table("property_media").delete().in_("id", [row["id"] for row in removed]).execute()

    changes = []
    for row in rows:
        if row["id"] in kept:
            wanted = {"sort_order": kept[row["id"]], "is_cover": kept[row["id"]] == 0}
            if change := {key: value for key, value in wanted.items() if row.get(key) != value}:
                changes.append((row["id"], change))
    # The old cover gives way before the new one is set, in case the database
    # allows one cover per property.
    for media_id, change in sorted(changes, key=lambda item: item[1].get("is_cover") is True):
        supabase.table("property_media").update(change).eq("id", media_id).execute()
    if added:
        supabase.table("property_media").insert(added).execute()
    for row in removed:
        _remove_uploaded_file(row, owner_id, prop)


def _remove_uploaded_file(media: dict, owner_id: str, prop: dict) -> None:
    """Delete a removed photo's file when the web uploaded it for this owner and no row shows it any more.

    The bucket is public, so a forgotten file stays reachable. Never raises:
    the photo rows are saved already.
    """
    bucket, path = media.get("storage_bucket"), media.get("storage_path")
    if bucket != uploads.PROPERTY_IMAGES_BUCKET or not path:
        return
    if not _web_upload(path, owner_id, prop):
        return
    try:
        # property_media_storage_object_idx keeps the object on one row, but an older row may show it by its link.
        still_shown = (
            _supabase().table("property_media").select("id")
            .eq("storage_bucket", bucket).eq("storage_path", path).limit(1).execute().data
            or (
                media.get("media_url")
                and _supabase().table("property_media").select("id")
                .eq("media_url", media["media_url"]).limit(1).execute().data
            )
        )
    except Exception as exc:
        logger.warning("could not check whether a removed listing photo is still used: %s", exc)
        return
    if not still_shown:
        uploads.remove(bucket, path)


def _in_managed_folder(path: str, user_id: str) -> bool:
    """Whether an object key is in the folder of a property the user owns or manages (photo_folder)."""
    parts = path.split("/")
    prop = _property(parts[1]) if len(parts) > 2 and is_uuid(parts[1]) else None
    return owns(prop, user_id) and _web_upload(path, user_id, prop)


def discard_uploaded_photo(url: str, owner_id: str) -> None:
    """Delete a listing photo the owner uploaded that no listing shows, such as one taken out of the wizard.

    Uploading stores a photo before any listing names it, and the bucket is
    public, so a photo the owner changed their mind about would stay
    reachable at its link. Only a file in the owner's own upload folder goes
    (404 otherwise), and never one a property_media row shows (409).
    """
    bucket = uploads.PROPERTY_IMAGES_BUCKET
    path = uploads.public_path(url, bucket)
    if path is None or not (_web_upload(path, owner_id) or _in_managed_folder(path, owner_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    media = _supabase().table("property_media").select("id")
    if (
        media.eq("storage_bucket", bucket).eq("storage_path", path).limit(1).execute().data
        or _supabase().table("property_media").select("id").eq("media_url", url).limit(1).execute().data
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "This photo is on a listing. Remove it from the listing instead.")
    uploads.remove(bucket, path)


def _has_approved_application(listing_id: str) -> bool:
    return bool(
        _supabase().table("rental_applications").select("id").eq("listing_id", listing_id).eq("status", "APPROVED")
        .limit(1).execute().data
    )


def delete_property(property_id: str, owner_id: str) -> None:
    """Delete a listing as the shared database's functions do (module docstring).

    Only the property's owner deletes: the functions check owner_user_id, so
    a manager gets their 403. A listing with a tenancy, leased or with an
    approved application, stays (409). Without other listings the property
    goes with it, through delete_owned_unrented_property, and the photo files
    it reports are removed from storage. A property's other listings stay: a
    draft is deleted alone (delete_owned_draft_listing) and any other
    listing is archived, which takes it off the web.
    """
    listing, prop = owned_listing(property_id, owner_id)
    if listing["status"] == LEASED_LISTING or _has_approved_application(listing["id"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This listing has a tenancy on it, so it can't be deleted.",
        )
    supabase = _supabase()
    others = [
        row for row in supabase.table("listings").select("id").eq("property_id", prop["id"]).execute().data or []
        if row["id"] != listing["id"]
    ]
    ids = {"p_listing_id": listing["id"], "p_owner_user_id": owner_id}
    if not others:
        with function_errors():
            deleted = supabase.rpc("delete_owned_unrented_property", ids).execute().data or []
        for media in (deleted[0].get("deleted_media") if deleted else None) or []:
            # The rows are gone, and the bucket is public: a file left behind would stay reachable.
            if media.get("bucket") == uploads.PROPERTY_IMAGES_BUCKET and media.get("path"):
                uploads.remove(media["bucket"], media["path"])
    elif listing["status"] == DRAFT_LISTING:
        with function_errors():
            supabase.rpc("delete_owned_draft_listing", ids).execute()
    elif prop.get("owner_user_id") != owner_id:
        # As the functions refuse a manager.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Listing ownership could not be verified")
    else:
        _move_listing(listing, prop, owner_id, ARCHIVED_LISTING, _now())
    audit.record(owner_id, "property.deleted", "property", property_id)


# ---------------------------------------------------------------------------
# Public catalogue
# ---------------------------------------------------------------------------
def list_amenities() -> list[str]:
    """Every amenity a property lists, read a page at a time: a single read stops at max-rows."""
    values: set[str] = set()
    offset = 0
    while True:
        rows = (
            _supabase()
            .table("properties")
            .select("id, amenities:metadata->amenities")
            .order("id")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
            .data
            or []
        )
        if not rows:
            return sorted(values)
        for row in rows:
            if isinstance(row.get("amenities"), list):
                values.update(item for item in row["amenities"] if isinstance(item, str))
        offset += len(rows)


def _public_listing(property_id: str) -> dict:
    """A listing anyone may open, or 404: published, or closed to new applications only."""
    listing = listing_row(property_id)
    if not listing or listing.get("status") not in PUBLIC_LISTING_STATUSES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return listing


def get_public_property(property_id: str, viewer: CurrentProfile | None = None) -> dict:
    """The listing page: the listing, its likes, its landlord's public card and what the viewer has done."""
    listing = _public_listing(property_id)
    prop = listing_property(listing)
    assembled = _assemble([listing], {prop["id"]: prop} if prop else None, public=True, signed_in=viewer is not None)
    if not assembled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    item = assembled[0]
    item["like_count"] = _like_count(listing["id"])
    item["landlord"] = _landlord(prop.get("owner_user_id"))
    item["viewer"] = _viewer(listing, prop, viewer)
    return item


def _landlord(user_id: str | None) -> dict | None:
    """The landlord's public card: their name, badge and rating, or None when their profile is not listed."""
    if not user_id:
        return None
    try:
        profile = public_profiles.get_public_profile(user_id)
    except HTTPException:
        return None
    return {
        "id": profile.id,
        "display_name": profile.display_name,
        "role_label": profile.role_label,
        "avatar_url": profile.avatar_url,
        "verified": profile.verified,
        "rating_avg": profile.rating_avg,
        "review_count": profile.review_count,
    }


def _viewer(listing: dict, prop: dict, viewer: CurrentProfile | None) -> dict:
    """What the listing page offers this viewer: nothing personal for a signed-out visitor."""
    if viewer is None:
        return {"role": None, "is_owner": False, "liked": False, "application": None}
    application = None
    if viewer.role == "tenant":
        rows = (
            _supabase()
            .table("rental_applications")
            .select("id, status, created_at")
            .eq("listing_id", listing["id"])
            .eq("applicant_user_id", viewer.id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
        )
        if rows:
            application = {
                "id": rows[0]["id"],
                "stage": application_stage(rows[0].get("status")),
                "can_withdraw": rows[0].get("status") in WITHDRAWABLE_APPLICATION_STATUSES,
                "created_at": rows[0].get("created_at"),
            }
    return {
        "role": viewer.role,
        "is_owner": owns(prop, viewer.id),
        "liked": viewer.role == "tenant" and _liked(listing["id"], viewer.id),
        "application": application,
    }


def _location_filter(words: list[str], columns: tuple[str, ...] = LOCATION_COLUMNS) -> str:
    """PostgREST logic for the properties embed: every word is in one of these address columns."""
    groups = [",".join(f"{column}.ilike.%{word}%" for column in columns) for word in words]
    if len(groups) == 1:
        return groups[0]
    return "and(" + ",".join(f"or({group})" for group in groups) + ")"


def list_public_properties(
    location: str | None = None,
    property_type: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    bedrooms: int | None = None,
    sort: str = "newest",
    limit: int = 20,
    offset: int = 0,
    viewer: CurrentProfile | None = None,
) -> list[dict]:
    """Published listings, filtered, sorted and paged by the database.

    The property filters apply to the embedded properties row, and !inner
    leaves out the listings whose property does not match. Filtering after
    paging returned short pages and hid the matches on later ones. A
    signed-in member's location search matches street words too; a
    signed-out visitor's only the suburb, state and postcode they are shown.
    """
    query = _supabase().table("listings").select("*, properties!inner(*)").eq("status", OPEN_LISTING)
    if min_price is not None:
        query = query.gte("weekly_rent", min_price)
    if max_price is not None:
        query = query.lte("weekly_rent", max_price)
    if property_type:
        db_type = property_type_filter(property_type)
        if db_type is None:
            return []
        query = query.eq("properties.property_type", db_type)
    # Any number of bedrooms, 0 included, is at least 0: a listing that gives
    # none (bedrooms is optional) must not drop out as SQL's NULL >= 0 would.
    if bedrooms is not None and bedrooms > 0:
        query = query.gte("properties.bedrooms", bedrooms)
    words = search_term(location).split()[:MAX_LOCATION_WORDS]
    if words:
        columns = LOCATION_COLUMNS if viewer is not None else PUBLIC_LOCATION_COLUMNS
        query = query.or_(_location_filter(words, columns), reference_table="properties")
    if sort == "price_asc":
        query = query.order("weekly_rent")
    elif sort == "price_desc":
        query = query.order("weekly_rent", desc=True)
    else:
        query = query.order("created_at", desc=True)
    # id makes the order total, so pages never repeat or skip a listing.
    listings = query.order("id").range(offset, offset + limit - 1).execute().data or []
    return _assemble(listings, public=True, signed_in=viewer is not None)


# ---------------------------------------------------------------------------
# Likes (listing_favorites)
# ---------------------------------------------------------------------------
def _like_count(listing_id: str) -> int:
    result = _supabase().table(FAVORITES).select("id", count="exact", head=True).eq("listing_id", listing_id).execute()
    return result.count or 0


def _liked(listing_id: str, user_id: str) -> bool:
    return bool(
        _supabase().table(FAVORITES).select("id").eq("listing_id", listing_id).eq("user_id", user_id)
        .limit(1).execute().data
    )


def like_listing(listing_id: str, user_id: str) -> dict:
    """Like a listing anyone may open; liking it again changes nothing.

    listing_favorites is UNIQUE (user_id, listing_id), so of two likes sent
    at once the second's insert fails with 23505: it is liked already.
    """
    listing = _public_listing(listing_id)
    if not _liked(listing["id"], user_id):
        row = stamp_insert(FAVORITES, {"user_id": user_id, "listing_id": listing["id"]})
        try:
            _supabase().table(FAVORITES).insert(row).execute()
        except APIError as exc:
            if str(exc.code) != "23505":
                raise
    return {"liked": True, "like_count": _like_count(listing["id"])}


def unlike_listing(listing_id: str, user_id: str) -> dict:
    """Take a like back, from any listing the person liked, even one no longer public."""
    listing = listing_row(listing_id)
    if not listing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    _supabase().table(FAVORITES).delete().eq("listing_id", listing["id"]).eq("user_id", user_id).execute()
    return {"liked": False, "like_count": _like_count(listing["id"])}
