from fastapi import HTTPException, status
import re
import unicodedata

from app.core.supabase import get_supabase_client
from app.services import _common
from app.services import badges
from app.services import categories as categories_service
from app.services import gates
from app.services import provider_services
from app.services import verification_documents
from app.services.maps_provider_core import category_codes, provider_category, stored_abn
from app.services.maps_reviews_complaints import VISIBLE_REVIEW_STATUSES
from app.services.shared_map import flatten_user, review_rating, stamp_insert, stamp_update

# A provider is a service_provider_profiles row, shared with the mobile app and
# keyed by its owner's users.id: that id is the provider id everywhere else.
TABLE = "service_provider_profiles"
# Public provider pages only: the owner's personal phone number is not public.
PROFILE_FIELDS = "full_name,avatar_url,location,state,postcode"
# Fields every provider keeps a value for. A null sent for one of them is
# ignored; a null for any other field clears it.
REQUIRED_FIELDS = {"category", "is_published", "is_online"}
SORT_COLUMNS = {"newest": "created_at", "reviews": "review_count", "rating": "rating_avg"}
# Only a real uuid may reach a uuid column; anything else is looked up as a slug.
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
# The reviews a rating counts: the ones the provider's review list shows
# (reviews.list_provider_reviews), so the count and the list agree. A flagged
# review stays up until a moderator hides or archives it.
COUNTED_REVIEW_STATUSES = list(VISIBLE_REVIEW_STATUSES)
# Where a search looks, column by column, before the exact check on the
# fields _from_shared reads (company_name ahead of a stale metadata name).
SEARCH_COLUMNS = ("company_name", "pricing_summary", "metadata->>business_name", "metadata->>tagline", "metadata->>bio")
# The marketplace shows a provider only while its owner's account is open and
# ACTIVE, as public profiles list members (tracker assumption #14): a
# suspended provider is hidden from the lists and its pages answer 404. Its
# own workspace still reads it (get_provider_by_profile_id).
OWNER_ACCOUNT = "owner:users!user_id!inner(status, deleted_at)"
LISTED_ACCOUNT_STATUS = "ACTIVE"
# Verification document types -> the badge label shown on public profiles.
VERIFICATION_LABELS = {
    "id": "ID",
    "abn": "ABN",
    "licence": "Licensed",
    "insurance": "Insured",
    "other": "Verified",
}

PRICE_UNIT_LABELS = {
    "flat": "fixed",
    "hourly": "per hour",
    "from": "from",
}


def _profiles():
    return get_supabase_client().table(TABLE)


def _metadata(row: dict) -> dict:
    return row.get("metadata") if isinstance(row.get("metadata"), dict) else {}


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "provider"


def _unique_slug(base: str, exclude_id: str | None = None) -> str:
    """Pick a public URL slug no other provider uses, appending -2, -3, … on collision."""
    candidate = base
    suffix = 2
    while True:
        # Slugs live in metadata; the database filters on them.
        taken = _profiles().select("user_id").eq("metadata->>slug", candidate).execute().data or []
        if all(row["user_id"] == exclude_id for row in taken):
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


def _is_placeholder_slug(slug: str | None) -> bool:
    return not slug or slug.startswith("provider-")


def _upgraded_slug(provider_id: str, stored: str | None, business_name: str | None) -> str | None:
    """A new slug when the stored one is missing or a placeholder; None to keep it.

    A real business name replaces a placeholder; a provider with neither gets
    a placeholder until they name the business.
    """
    if not _is_placeholder_slug(stored):
        return None
    if business_name:
        return _unique_slug(_slugify(str(business_name)), exclude_id=provider_id)
    if not stored:
        return _unique_slug(_slugify(f"provider-{provider_id[:8]}"), exclude_id=provider_id)
    return None


def _completion_score(provider: dict, has_services: bool, has_docs: bool) -> int:
    checks = [
        bool(provider.get("business_name")),
        bool(provider.get("bio")),
        bool(provider.get("headline") or provider.get("tagline")),
        bool(provider.get("category")),
        provider.get("service_radius_km") is not None,
        bool(provider.get("slug")),
        has_services,
        has_docs,
        bool(provider.get("is_published")),
    ]
    return round(100 * sum(1 for ok in checks if ok) / len(checks))


def _with_checked_abn(payload: dict) -> dict:
    """payload with its ABN as metadata.abn keeps it; 422 for a number that fails the ABR's check.

    Only an ABN sent is checked, so one another app stored never blocks an
    unrelated edit.
    """
    if "abn" not in payload:
        return payload
    try:
        return {**payload, "abn": stored_abn(payload["abn"])}
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "That ABN is not valid. Check its 11 digits, for example on ABN Lookup.",
        ) from None


def _from_shared(row: dict) -> dict:
    """A service_provider_profiles row as the provider DTO, before its stats."""
    meta = _metadata(row)
    return {
        "id": row["user_id"],
        "profile_id": row["user_id"],
        # The web category (maps_provider_core.WEB_CATEGORY_KEY in metadata), else read from the shared codes;
        # None until the provider picks one in onboarding step 1.
        "category": provider_category(row),
        "slug": meta.get("slug") or row["user_id"],
        "business_name": row.get("company_name") or meta.get("business_name"),
        "abn": meta.get("abn"),
        "tagline": row.get("pricing_summary") or meta.get("tagline"),
        "bio": meta.get("bio"),
        "headline": meta.get("headline"),
        "badge_label": meta.get("badge_label"),
        "years_experience": meta.get("years_experience"),
        "languages": meta.get("languages") or [],
        "skills": meta.get("skills") or [],
        "specialties": meta.get("specialties") or [],
        "gallery_urls": meta.get("gallery_urls") or [],
        "service_radius_km": meta.get("service_radius_km"),
        "website": meta.get("website"),
        "response_time": meta.get("response_time"),
        "availability_note": meta.get("availability_note"),
        # Stored in metadata by update_provider. A row the web creates starts
        # unpublished (ensure_user_for_auth, create_provider); a row from the
        # mobile app has no flag and stays listed, as before the flag existed.
        "is_online": bool(meta.get("is_online")),
        "is_published": bool(meta.get("is_published", True)),
        # Not stored: _with_ratings and _with_completion derive them.
        "profile_completion": 0,
        "rating_avg": 0,
        "review_count": 0,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "verifications": [],
        "from_price": None,
        "price_unit": None,
        "service_count": 0,
        "completed_jobs": 0,
        "profiles": None,
    }


def _evidence(provider_ids: list[str]) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    """Each provider's live services and credentials, by provider id."""
    services: dict[str, list[dict]] = {}
    documents: dict[str, list[dict]] = {}
    for service in provider_services.live_services(provider_ids):
        services.setdefault(service["provider_id"], []).append(service)
    for document in verification_documents.credentials_of(provider_ids):
        documents.setdefault(document["provider_id"], []).append(document)
    return services, documents


def _with_ratings(providers: list[dict]) -> list[dict]:
    """The review summary: the published and flagged reviews about each provider's account."""
    if not providers:
        return providers
    reviews = _common.select_in(
        lambda: get_supabase_client()
        .table("reviews")
        .select("id, reviewed_user_id, rating, landlord_rating")
        .in_("status", COUNTED_REVIEW_STATUSES)
        .order("id"),
        "reviewed_user_id",
        [provider["id"] for provider in providers],
    )
    scores: dict[str, list[int]] = {}
    for review in reviews:
        scores.setdefault(review["reviewed_user_id"], []).append(review_rating(review))
    for provider in providers:
        mine = scores.get(provider["id"], [])
        provider["rating_avg"] = round(sum(mine) / len(mine), 2) if mine else 0
        provider["review_count"] = len(mine)
    return providers


def _with_completion(providers: list[dict], evidence=None) -> list[dict]:
    if not providers:
        return providers
    services, documents = evidence or _evidence([provider["id"] for provider in providers])
    for provider in providers:
        provider["profile_completion"] = _completion_score(
            provider, bool(services.get(provider["id"])), bool(documents.get(provider["id"]))
        )
    return providers


def _with_stats(providers: list[dict], evidence=None) -> list[dict]:
    """Fill in what provider rows do not store: the review summary and completion."""
    return _with_completion(_with_ratings(providers), evidence)


def _owner_summary(owner: dict) -> dict:
    """The public part of an owner's profile; the phone number stays private."""
    summary = {key: owner.get(key) for key in PROFILE_FIELDS.split(",")}
    return summary | {"full_name": summary["full_name"] or ""}


def _with_owner_profiles(rows: list[dict]) -> list[dict]:
    """Attach each provider's owner name, avatar and location (users rows) where missing."""
    missing = [row["profile_id"] for row in rows if not row.get("profiles")]
    if not missing:
        return rows
    users = _common.select_in(
        lambda: get_supabase_client().table("users").select("id, full_name, avatar_url, metadata").order("id"),
        "id",
        missing,
    )
    owners = {user["id"]: _owner_summary(flatten_user(user)) for user in users}
    for row in rows:
        if not row.get("profiles"):
            row["profiles"] = owners.get(row["profile_id"])
    return rows


def _profile_row(user_id: str) -> dict | None:
    rows = _profiles().select("*").eq("user_id", user_id).limit(1).execute().data
    return rows[0] if rows else None


def get_provider_by_profile_id(profile_id: str) -> dict | None:
    row = _profile_row(profile_id)
    return _with_stats([_from_shared(row)])[0] if row else None


def require_provider_by_profile_id(profile_id: str) -> dict:
    provider = get_provider_by_profile_id(profile_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No service provider profile for this account")
    return provider


def create_provider(profile_id: str, payload: dict) -> dict:
    """Set up the caller's provider profile from onboarding.

    Sign-up already inserts an empty row (profiles.ensure_user_for_auth), so
    an existing row is filled in rather than refused; an account without one
    gets a new row, unpublished until the provider goes live.
    """
    payload = _with_checked_abn({k: v for k, v in payload.items() if v is not None})
    if payload.get("slug"):
        payload["slug"] = _unique_slug(payload["slug"], exclude_id=profile_id)
    if _profile_row(profile_id) is not None:
        return update_provider(profile_id, payload)
    seed = payload.get("business_name") or f"provider-{profile_id[:8]}"
    slug = payload.get("slug") or _unique_slug(_slugify(seed))
    row = {
        "user_id": profile_id,
        "company_name": payload.get("business_name"),
        # The shared codes of the web category, which metadata keeps (WEB_CATEGORY_KEY, from payload).
        "service_categories": category_codes(payload.get("category")),
        "pricing_summary": payload.get("tagline"),
        "verification_status": "PENDING",
        "metadata": {
            **payload,
            "slug": slug,
            # Private until the provider publishes it.
            "is_published": False,
        },
    }
    result = _profiles().insert(stamp_insert(TABLE, row)).execute()
    return _with_stats([_from_shared(result.data[0])])[0]


def update_provider(provider_id: str, payload: dict) -> dict:
    # The route forwards only the fields the client sent, so a null asks for
    # that field to be cleared.
    payload = _with_checked_abn({k: v for k, v in payload.items() if v is not None or k not in REQUIRED_FIELDS})
    raw = _profile_row(provider_id)
    if raw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    existing = _from_shared(raw)

    if payload.get("is_published") and not existing["is_published"]:
        # Going live needs a verified provider with an active account (R18).
        gates.require_verified(provider_id, "go_live")
        if not provider_services.has_live_service(provider_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Publish at least one service before listing your profile")

    if "slug" not in payload:
        business_name = payload.get("business_name") or existing.get("business_name")
        slug = _upgraded_slug(provider_id, _metadata(raw).get("slug"), business_name)
        if slug:
            payload["slug"] = slug
    return _update_shared(provider_id, raw, payload)


def _update_shared(provider_id: str, raw: dict, payload: dict) -> dict:
    if not payload:
        return _with_stats([_from_shared(raw)])[0]
    update = {"metadata": {**_metadata(raw), **payload}}
    # _from_shared reads these columns ahead of metadata, so they follow every change.
    if "business_name" in payload:
        update["company_name"] = payload["business_name"]
    if "tagline" in payload:
        update["pricing_summary"] = payload["tagline"]
    if "category" in payload:
        # update_own_profile and assign_maintenance_work_order read the shared codes; the web
        # category stays in metadata (WEB_CATEGORY_KEY, merged from payload above).
        update["service_categories"] = category_codes(payload["category"])
    result = _profiles().update(stamp_update(TABLE, update)).eq("user_id", provider_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    # A new category leaves the account's verification as it is: review_profile_document asks every
    # provider for the same documents (verification_rules.REQUIRED_TYPES), whatever its category.
    return _with_stats([_from_shared(result.data[0])])[0]


# ---------------------------------------------------------------------------
# Public marketplace presentation
# ---------------------------------------------------------------------------
def _verification_statuses(user_ids: list[str]) -> dict[str, str | None]:
    """Each provider owner's users.verification_status, by id."""
    users = _common.select_in(
        lambda: get_supabase_client().table("users").select("id, verification_status").order("id"), "id", user_ids
    )
    return {user["id"]: user.get("verification_status") for user in users}


def _decorate(rows: list[dict], evidence=None) -> list[dict]:
    """Resolve the derived fields the marketplace cards render.

    Verifications come from approved credentials, the "from" price and unit
    from the cheapest priced live service (a mobile service priced 0 has no
    price yet), and the category label from the catalogue — none of it is
    hard-coded in the UI. verified is the account's verified badge, the one
    public profiles show (badges.is_verified): an admin approved the account,
    which one approved credential does not make.
    """
    if not rows:
        return []
    services, documents = evidence or _evidence([row["id"] for row in rows])
    catalogue = categories_service.by_code()
    statuses = _verification_statuses([row["id"] for row in rows])

    for row in rows:
        pid = row["id"]
        row["verified"] = badges.is_verified(statuses.get(pid))
        approved = {document["type"] for document in documents.get(pid, []) if document["status"] == "verified"}
        row["verifications"] = [label for kind, label in VERIFICATION_LABELS.items() if kind in approved]
        live = services.get(pid, [])
        priced = [service for service in live if service["price"] > 0]
        best = min(priced, key=lambda service: service["price"]) if priced else None
        category = catalogue.get(row["category"]) or {}
        row["category_name"] = category.get("name")
        row["category_slug"] = category.get("slug")
        row["service_count"] = len(live)
        row["from_price"] = best["price"] if best else None
        row["price_unit"] = PRICE_UNIT_LABELS.get(best["pricing_type"]) if best else None

    return rows


def _listed(query):
    """A select of provider rows and their OWNER_ACCOUNT, narrowed to those the marketplace may show."""
    return query.eq("owner.status", LISTED_ACCOUNT_STATUS).is_("owner.deleted_at", "null")


def _published(reference: str) -> dict | None:
    """A listed provider by user id or URL slug, before its stats; drafts and suspended accounts stay private.

    A slug is matched by the database rather than by reading every provider,
    and never reaches the uuid user_id column (Postgres rejects it with 22P02).
    """
    column = "user_id" if _looks_like_uuid(reference) else "metadata->>slug"
    rows = _listed(_profiles().select(f"*, {OWNER_ACCOUNT}").eq(column, reference)).execute().data or []
    published = [provider for provider in map(_from_shared, rows) if provider["is_published"]]
    return published[0] if published else None


def get_public_provider(provider_id: str) -> dict:
    """Look a published provider up by UUID *or* by its URL slug."""
    # Imported on use: bookings imports this module.
    from app.services import bookings

    found = _published(provider_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    evidence = _evidence([found["id"]])
    provider = _decorate(_with_owner_profiles(_with_stats([found], evidence)), evidence)[0]
    provider["completed_jobs"] = bookings.completed_job_count(provider["id"])
    return provider


def _looks_like_uuid(value: str) -> bool:
    return UUID_PATTERN.fullmatch(value) is not None


def published_providers(term: str = "") -> list[dict]:
    """Every provider the marketplace lists, before their stats, read page by page.

    A row the web creates starts unpublished; a row from the mobile app has no
    publish flag and is listed. A provider whose account is suspended, inactive
    or closed is not (OWNER_ACCOUNT). term, a _common.search_term(), keeps the
    providers whose business name, tagline or bio contains it.
    """

    def build():
        query = _listed(_profiles().select(f"*, {OWNER_ACCOUNT}"))
        if term:
            query = query.or_(",".join(f"{column}.ilike.%{term}%" for column in SEARCH_COLUMNS))
        return query.order("user_id")

    providers = [provider for provider in map(_from_shared, _common.select_all(build)) if provider["is_published"]]
    needle = term.lower()
    return [
        provider
        for provider in providers
        if not needle or any(needle in (provider[field] or "").lower() for field in ("business_name", "tagline", "bio"))
    ]


def list_public_providers(
    category: str | None = None,
    location: str | None = None,
    min_rating: float | None = None,
    search: str | None = None,
    sort: str = "rating",
    limit: int = 20,
    offset: int = 0,
) -> list[dict]:
    enum_value = None
    if category:
        # Accept either the code or the URL slug; an unknown category is
        # simply an empty result, not a database error.
        enum_value = categories_service.code_for(category)
        if not enum_value:
            return []
    column = SORT_COLUMNS.get(sort, "rating_avg")

    providers = [
        provider
        for provider in published_providers(_common.search_term(search))
        if not enum_value or provider["category"] == enum_value
    ]
    providers = [
        provider for provider in _with_ratings(providers) if min_rating is None or provider["rating_avg"] >= min_rating
    ]
    if location:
        # Location lives on the owner's profile, so filter first and page after;
        # paging first returned short pages and hid matches beyond the first page.
        needle = location.lower()
        providers = [provider for provider in _with_owner_profiles(providers) if needle in _owner_area(provider)]
    # Ties keep id order (the sorts below are stable), so offset pages never
    # repeat or skip a provider.
    providers.sort(key=lambda provider: provider["id"])
    if column == "created_at":
        providers.sort(key=lambda provider: str(provider.get("created_at") or ""), reverse=True)
    else:
        providers.sort(key=lambda provider: float(provider.get(column) or 0), reverse=True)
    page = providers[offset : offset + limit]
    evidence = _evidence([provider["id"] for provider in page])
    return _decorate(_with_owner_profiles(_with_completion(page, evidence)), evidence)


def _owner_area(row: dict) -> str:
    owner = row.get("profiles") or {}
    return " ".join(filter(None, [owner.get("location"), owner.get("state"), owner.get("postcode")])).lower()


def provider_id_for(reference: str) -> str | None:
    """The provider id (its owner's users.id) an id or URL slug names, published or not; None for neither.

    A slug never reaches the uuid user_id column, where Postgres would
    reject it with 22P02.
    """
    if _looks_like_uuid(reference):
        return reference
    rows = _profiles().select("user_id").eq("metadata->>slug", reference).limit(1).execute().data or []
    return rows[0]["user_id"] if rows else None


def marketplace_state(provider_id: str) -> dict:
    """Where a provider is on the marketplace, for the admin console.

    has_profile: there is a provider profile; published: the provider made it
    live (a mobile row without the flag counts, as the listing reads it);
    listed: the marketplace shows it now, which also needs an open, ACTIVE
    account.
    """
    raw = _profile_row(provider_id)
    published = raw is not None and _from_shared(raw)["is_published"]
    return {
        "has_profile": raw is not None,
        "published": published,
        "listed": published and _published(provider_id) is not None,
    }


def require_published(provider_id: str) -> str:
    """404 unless the provider is live: unpublished data stays private.

    Accepts an id or slug and returns the canonical id (the owner's users.id)
    the provider's other rows are keyed by.
    """
    found = _published(provider_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    return found["id"]
