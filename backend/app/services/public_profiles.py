"""Public profiles: what anyone may see of a tenant, landlord or provider (R22).

GET /public/profiles and /public/profiles/{id} work signed out and give
signed-in callers the same fields. They read the shared tables with the
service-role client, so this module is what keeps everything else private:
each response is built field by field from app/schemas/public_profiles.py.

Listed members are users that are ACTIVE and not deleted, with a TENANT,
LANDLORD, AGENT (with the landlords, labelled Agent) or SERVICE_PROVIDER
role, whose profile is public, with the switches the mobile app shares
(services/member_settings.py): users.metadata.mobile.privacySettings.
publicProfile, else the web's earlier privacy.public_profile, is not false.
A tenant's profile must also be published in the mobile app
(metadata.mobile.profilePublished not false), and a provider's in the
provider workspace (service_provider_profiles.metadata.is_published is
true). A member who is not discoverable (privacySettings.discoverable false)
is left out of the search, as mobile_discover_profiles leaves them out, but
their page still opens.

Search text and location are matched here, against the public fields only,
as a case-insensitive literal substring: what an ilike with every wildcard
escaped would match. So a tenant's surname, the rest of an about text or a
postcode cannot be found by searching for them, and no search text reaches a
PostgREST filter. Ranking (review count, then average, then name) needs every
listed member's reviews, so every listed member is read, up to MAX_SCAN, with
the scores of their rated reviews embedded: a card counts the same reviews as
the profile page. One read serves the searches of the next SCAN_TTL_SECONDS,
since typing searches again at each pause.

A rating is one thing everywhere a profile appears (tracker R23): the
average and count of RATED_STATUSES reviews, and the verified badge of
badges.is_verified. trust_of() gives both to lists that read members another
way, such as the signed-in profile search.

A tenant's profile page also gives the average and count of the owner
scorecards they chose to show (R43, services/scorecards.py), unless their
users.metadata.privacy.share_score is false.
"""

import logging
import re
import time
from collections.abc import Callable, Iterable

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, web_table
from app.schemas.public_profiles import (
    PublicProfileDetailOut,
    PublicProfileOut,
    PublicProfilePageOut,
    PublicProfileReviewOut,
    PublicScorecardOut,
)
from app.services import _common, member_settings
from app.services.badges import is_verified
from app.services.maps_provider_core import REPAIR_CATEGORY_LABELS
from app.services.maps_reviews_complaints import VISIBLE_REVIEW_STATUSES
from app.services.shared_map import review_rating

logger = logging.getLogger(__name__)

# The reviews a rating counts: the ones a profile's review list shows, as the
# marketplace counts a provider's (service_providers.COUNTED_REVIEW_STATUSES).
# So a search card, a public profile and a provider's marketplace card and
# page give the same average and count. A flagged review stays up until a
# moderator hides or archives it, and its card says it was reported.
RATED_STATUSES = list(VISIBLE_REVIEW_STATUSES)

# Search tab -> the users.primary_role values listed under it. ADMIN and
# REGULATOR accounts are staff and never listed.
ROLE_GROUPS: dict[str, tuple[str, ...]] = {
    "tenant": ("TENANT",),
    "landlord": ("LANDLORD", "AGENT"),
    "provider": ("SERVICE_PROVIDER",),
}
LISTED_ROLES = tuple(role for roles in ROLE_GROUPS.values() for role in roles)
ROLE_FILTERS = {"all": LISTED_ROLES, **ROLE_GROUPS}
GROUP_OF_ROLE = {role: group for group, roles in ROLE_GROUPS.items() for role in roles}
ROLE_LABELS = {"TENANT": "Tenant", "LANDLORD": "Landlord", "AGENT": "Agent", "SERVICE_PROVIDER": "Service provider"}
REVIEWER_NOUNS = {"TENANT": "tenant", "LANDLORD": "landlord", "AGENT": "agent", "SERVICE_PROVIDER": "service provider"}

DEFAULT_LIMIT = 12
MAX_LIMIT = 24
# Rows asked for per request. Supabase's PostgREST answers at most its
# max_rows (1000 by default), so a shorter page does not mean the end.
PAGE_SIZE = 1000
# The most members one search reads; past it the rest are left out.
MAX_SCAN = 5000
# How long one read of the listed members serves later searches.
SCAN_TTL_SECONDS = 5.0
REVIEWS_SHOWN = 20
MAX_AREAS = 4
MAX_CATEGORIES = 5
ABOUT_LENGTH = 140
# Longer search text is cut: no public name or area is that long.
MAX_SEARCH_LENGTH = 100
FALLBACK_NAME = "TenantVoice member"

# Of the metadata columns, only the keys a public profile reads (docs/shared-db.md,
# "Web metadata keys"), as text: ->> turns a JSON false into "false".
USER_COLUMNS = (
    "id, full_name, avatar_url, primary_role, verification_status, "
    "public_profile:metadata->privacy->>public_profile, share_score:metadata->privacy->>share_score, "
    "mobile_public_profile:metadata->mobile->privacySettings->>publicProfile, "
    "discoverable:metadata->mobile->privacySettings->>discoverable, "
    "profile_published:metadata->mobile->>profilePublished, "
    "location:metadata->>location, state:metadata->>state"
)
# Each embed is one row or null: user_id is every role profile's primary key.
ROLE_PROFILES = (
    "tenant_profiles(about_me, budget_min, budget_max, preferred_locations, move_in_date), "
    "landlord_profiles(agency_name, bio:metadata->>bio), "
    "agent_profiles(agency_name, market_area, bio:metadata->>bio), "
    "service_provider_profiles(company_name, service_categories, service_area, pricing_summary, "
    "is_published:metadata->>is_published, slug:metadata->>slug, bio:metadata->>bio, "
    "web_category:metadata->>category)"
)
# Every review about the member, filtered to RATED_STATUSES in the query: only
# its scores, which reach the response as the average and the count.
RATED_SCORES = "reviews!reviewed_user_id(rating, landlord_rating)"
# The reviewer's role labels a review; their id and name never leave here.
REVIEW_COLUMNS = (
    "id, rating, landlord_rating, title, body, is_verified_interaction, landlord_reply, landlord_replied_at, "
    "created_at, status, reviewer:users!reviewer_user_id(primary_role)"
)
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DATE_PATTERN = re.compile(r"\d{4}-(?:0[1-9]|1[0-2])-\d{2}")
URL_PATTERN = re.compile(r"https?://\S+", re.IGNORECASE)


def search(
    role: str = "all",
    q: str | None = None,
    location: str | None = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> PublicProfilePageOut:
    """One page of listed members, best reviewed first; limit is capped at MAX_LIMIT.

    q matches any text a card shows: the name, business name, role, areas,
    service area, categories and about line. The homepage sends its one
    search box as q. location matches the shown areas and service area.
    """
    limit = min(limit, MAX_LIMIT)
    text, place = _needle(q), _needle(location)
    ranked = [
        profile
        for profile in _ranked_members(role)
        if _contains(text, [
            profile.display_name, profile.business_name, profile.role_label, *profile.areas, profile.service_area,
            *profile.categories, profile.about,
        ])
        and _contains(place, [*profile.areas, profile.service_area])
    ]
    return PublicProfilePageOut(
        items=ranked[offset : offset + limit],
        total=len(ranked),
        limit=limit,
        offset=offset,
    )


def get_public_profile(user_id: str) -> PublicProfileDetailOut:
    """One listed member and their newest rated reviews.

    An unknown id and a member who is not listed get the same 404, so the
    answer never tells whether a hidden account exists.
    """
    # Anything but a uuid would fail the id column's type check (22P02) instead.
    rows = _listed_query(LISTED_ROLES).eq("id", user_id).limit(1).execute().data if _is_uuid(user_id) else None
    profile = _public_profile(rows[0]) if rows else None
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    [profile] = _with_category_names([_rated(profile, _scores(rows[0]))])
    reviews = [_review(row) for row in _newest_reviews_about(user_id)]
    return PublicProfileDetailOut(**profile.model_dump(), reviews=reviews, scorecard=_scorecard(rows[0], profile))


def _scorecard(row: dict, profile: PublicProfileOut) -> PublicScorecardOut | None:
    """A tenant's owner scorecards as one average (R43), or None.

    Only those the tenant chose to show count (visible_on_profile), and none
    while their privacy.share_score is false: they do not want owners to see
    their score.
    """
    if profile.role != "tenant" or row.get("share_score") == "false":
        return None
    # Deferred: scorecards imports this module.
    from app.services import scorecards

    summary = scorecards.public_summary(row["id"])
    return PublicScorecardOut(**summary) if summary else None


def trust_of(user_ids: Iterable[str]) -> dict[str, dict]:
    """Each member's rating and verified badge, as their cards and profile page show them.

    For lists that read members another way, such as the signed-in profile
    search: {id: {"rating_avg", "review_count", "verified"}}. Whether a
    member is listed is the caller's business; an id without a users row is
    left out.
    """
    ids = [user_id for user_id in dict.fromkeys(user_ids) if _is_uuid(user_id)]
    if not ids:
        return {}
    users = _common.select_in(
        lambda: get_supabase_client().table("users").select("id, verification_status").order("id"), "id", ids
    )
    reviews = _common.select_in(
        lambda: get_supabase_client()
        .table("reviews")
        .select("id, reviewed_user_id, rating, landlord_rating")
        .in_("status", RATED_STATUSES)
        .order("id"),
        "reviewed_user_id",
        ids,
    )
    scores: dict[str, list[int]] = {}
    for review in reviews:
        scores.setdefault(review["reviewed_user_id"], []).append(review_rating(review))
    trust = {}
    for user in users:
        average, count = rating(scores.get(user["id"], []))
        trust[user["id"]] = {
            "rating_avg": average,
            "review_count": count,
            "verified": is_verified(user.get("verification_status")),
        }
    return trust


def rating(scores: list[int]) -> tuple[float | None, int]:
    """(average to two decimals, count) of review scores; the average is None until there is one."""
    return (round(sum(scores) / len(scores), 2) if scores else None), len(scores)


# ---------------------------------------------------------------------------
# Reading the shared tables
# ---------------------------------------------------------------------------
# role -> (when it was read, the tab's listed members, ranked)
_scans: dict[str, tuple[float, list[PublicProfileOut]]] = {}


def _ranked_members(role: str) -> list[PublicProfileOut]:
    """Every listed member under the tab, rated and best reviewed first.

    A read serves the next SCAN_TTL_SECONDS of searches on the tab, so a new
    review, sign-up or opt-out reaches the search after at most that long.
    """
    now = time.monotonic()
    read_at, members = _scans.get(role, (None, []))
    if read_at is not None and now - read_at < SCAN_TTL_SECONDS:
        return members
    rows = _listed_rows(ROLE_FILTERS[role])
    rated = sorted(
        (_rated(profile, _scores(row)) for row in rows if _discoverable(row) and (profile := _public_profile(row))),
        key=_rank,
    )
    # Named before any search: q matches the category names a card shows.
    members = _with_category_names(rated)
    _scans[role] = (now, members)
    return members


def _listed_query(roles: Iterable[str], count: str | None = None):
    return (
        get_supabase_client()
        .table("users")
        .select(f"{USER_COLUMNS}, {ROLE_PROFILES}, {RATED_SCORES}", count=count)
        .eq("status", "ACTIVE")
        .is_("deleted_at", "null")
        .in_("primary_role", list(roles))
        # Filters the embedded reviews, not the members: HIDDEN and ARCHIVED never count.
        .in_("reviews.status", RATED_STATUSES)
    )


def _listed_rows(roles: Iterable[str]) -> list[dict]:
    roles = list(roles)
    return _all_rows(lambda count=None: _listed_query(roles, count).order("id"), MAX_SCAN, "members")


def _scores(row: dict) -> list[int]:
    """The member's rated review scores, embedded in their users row."""
    reviews = row.get("reviews")
    if not isinstance(reviews, list):
        return []
    return [review_rating(review) for review in reviews if isinstance(review, dict)]


def _newest_reviews_about(user_id: str) -> list[dict]:
    return (
        get_supabase_client()
        .table("reviews")
        .select(REVIEW_COLUMNS)
        .eq("reviewed_user_id", user_id)
        .in_("status", RATED_STATUSES)
        .order("created_at", desc=True)
        .order("id")
        .limit(REVIEWS_SHOWN)
        .execute()
        .data
        or []
    )


def _all_rows(query: Callable, cap: int, what: str) -> list[dict]:
    """Every row query() selects, PAGE_SIZE rows a request, up to cap.

    The first request also counts the rows, so a PostgREST that answers
    fewer than PAGE_SIZE a request still has every page read. query() builds
    a fresh, totally ordered select each time: a builder keeps the range it
    was given, so each page needs its own.
    """
    first = query(count="exact").range(0, PAGE_SIZE - 1).execute()
    rows = list(first.data or [])
    total = first.count if first.count is not None else len(rows)
    while len(rows) < min(total, cap):
        page = query().range(len(rows), len(rows) + PAGE_SIZE - 1).execute().data or []
        if not page:
            break  # rows removed since the count
        rows.extend(page)
    if total > cap:
        logger.warning("public profiles read only the first %s %s", cap, what)
    return rows[:cap]


def _with_category_names(profiles: list[PublicProfileOut]) -> list[PublicProfileOut]:
    """Providers' category codes as the marketplace names them (web.service_categories)."""
    codes = sorted({code for profile in profiles for code in profile.categories})
    if not codes:
        return profiles
    rows = web_table("service_categories").select("category, name").in_("category", codes).execute().data or []
    names = {row["category"]: row["name"] for row in rows}

    def named(profile: PublicProfileOut) -> PublicProfileOut:
        labels = _distinct(
            names.get(code) or REPAIR_CATEGORY_LABELS.get(code.upper()) or _humanise(code) for code in profile.categories
        )
        return profile.model_copy(update={"categories": labels})

    return [named(profile) if profile.categories else profile for profile in profiles]


# ---------------------------------------------------------------------------
# The allowlist: a users row and its role profile as the public sees them
# ---------------------------------------------------------------------------
def is_public(row: dict) -> bool:
    """Whether a users row (with USER_COLUMNS' switches) keeps a public profile.

    The mobile app's publicProfile decides, else the web's earlier key; and a
    tenant's profile must be published in the app (profilePublished).
    """
    public = member_settings.switch(row.get("mobile_public_profile"))
    if public is None:
        public = member_settings.switch(row.get("public_profile"))
    return public is not False and member_settings.published(row.get("primary_role"), row.get("profile_published"))


def _discoverable(row: dict) -> bool:
    """Whether a member may be found by a search: privacySettings.discoverable is not false."""
    return member_settings.switch(row.get("discoverable")) is not False


def _public_profile(row: dict) -> PublicProfileOut | None:
    """row as anyone may see it, or None when the member is not listed."""
    role = row.get("primary_role")
    group = GROUP_OF_ROLE.get(role)
    if group is None or not is_public(row):
        return None
    # Only the profile of the member's own role: another one may be stale or private.
    tenant = _object(row.get("tenant_profiles")) if group == "tenant" else {}
    provider = _object(row.get("service_provider_profiles")) if group == "provider" else {}
    landlord = _object(row.get("landlord_profiles")) if group == "landlord" else {}
    # The web gives agents a landlord profile; the mobile app an agent profile.
    agent = _object(row.get("agent_profiles")) if role == "AGENT" else {}
    role_profile = provider or agent or landlord
    if group == "provider" and provider.get("is_published") != "true":
        return None

    full_name = _name(row.get("full_name"))
    business_name = _name(provider.get("company_name") or agent.get("agency_name") or landlord.get("agency_name"))
    if group == "tenant":
        display_name = _first_name_and_initial(row.get("full_name"))
    elif group == "provider":
        display_name = business_name or full_name or FALLBACK_NAME
    else:
        display_name = full_name or business_name or FALLBACK_NAME
    return PublicProfileOut(
        id=row["id"],
        role=group,
        role_label=ROLE_LABELS[role],
        display_name=display_name,
        business_name=business_name if business_name != display_name else None,
        avatar_url=_url(row.get("avatar_url")),
        areas=_areas(group, row, tenant, agent),
        about=_one_line(tenant.get("about_me") if group == "tenant" else role_profile.get("bio"), ABOUT_LENGTH),
        verified=is_verified(row.get("verification_status")),
        budget_min=_amount(tenant.get("budget_min")),
        budget_max=_amount(tenant.get("budget_max")),
        move_in_month=_month(tenant.get("move_in_date")),
        # The web category the provider chose (maps_provider_core.WEB_CATEGORY_KEY), else the
        # shared repair codes a mobile row holds.
        categories=_texts([provider["web_category"]] if provider.get("web_category")
                          else provider.get("service_categories"))[:MAX_CATEGORIES],
        pricing_summary=_one_line(provider.get("pricing_summary"), 80),
        service_area=_one_line(provider.get("service_area"), 80),
        provider_slug=_slug(provider.get("slug")),
    )


def _areas(group: str, user: dict, tenant: dict, agent: dict) -> list[str]:
    """Suburbs only: a tenant's preferred ones, else the suburb and state on the profile."""
    suburb = ", ".join(_texts([user.get("location"), user.get("state")]))
    places = _texts(tenant.get("preferred_locations")) if group == "tenant" else []
    if agent:
        places += _texts([agent.get("market_area")])
    if suburb and (group != "tenant" or not places):
        places.append(suburb)
    return _distinct(places)[:MAX_AREAS]


def reviewer_label(primary_role: str | None, verified_interaction: bool | None) -> str:
    """How a public review names its reviewer: by role alone, "Verified tenant" after a verified interaction.

    Never their name, face or suburb (tracker assumptions #1, #11): no
    reviewer can opt to show a name yet.
    """
    noun = REVIEWER_NOUNS.get(primary_role, "member")
    return f"Verified {noun}" if verified_interaction else noun.capitalize()


def _review(row: dict) -> PublicProfileReviewOut:
    return PublicProfileReviewOut(
        id=row["id"],
        rating=review_rating(row),
        title=_one_line(row.get("title"), 120),
        body=_paragraphs(row.get("body")),
        reviewer_label=reviewer_label(_object(row.get("reviewer")).get("primary_role"), row.get("is_verified_interaction")),
        reply=_paragraphs(row.get("landlord_reply")),
        replied_at=row.get("landlord_replied_at"),
        created_at=row["created_at"],
        reported=row.get("status") == "FLAGGED",
    )


def _rated(profile: PublicProfileOut, scores: list[int]) -> PublicProfileOut:
    average, count = rating(scores)
    return profile.model_copy(update={"rating_avg": average, "review_count": count})


def _rank(profile: PublicProfileOut) -> tuple:
    # The id makes the order total, so offset pages never repeat or skip a member.
    return (-profile.review_count, -(profile.rating_avg or 0), profile.display_name.casefold(), profile.id)


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------
def _first_name_and_initial(full_name) -> str:
    """"Jane Mary Doe" -> "Jane D.": how a tenant's name is shown (assumption #1)."""
    words = full_name.split() if isinstance(full_name, str) and not _is_contact(full_name) else []
    if not words:
        return FALLBACK_NAME
    first = _one_line(words[0], 40)
    initial = next((char for char in words[-1] if char.isalnum()), None) if len(words) > 1 else None
    return f"{first} {initial.upper()}." if initial else first


def _name(value) -> str | None:
    """A name to show, or None for contact details saved as a name."""
    name = _one_line(value, 80)
    return name if name and not _is_contact(name) else None


def shown_name(value) -> str | None:
    """A member's name as other members may read it, or None when it holds an email or phone number."""
    return _name(value)


def _is_contact(text: str) -> bool:
    """An email address or phone number, which some accounts keep as their name."""
    return "@" in text or sum(char.isdigit() for char in text) >= 6


def _one_line(value, limit: int) -> str | None:
    """Text on one line, cut at a word boundary to at most limit characters."""
    if not isinstance(value, str):
        return None
    line = " ".join(value.split())
    if len(line) <= limit:
        return line or None
    cut = line[: limit - 1]
    if " " in cut[limit // 2 :]:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" ,.;:-") + "…"


def _paragraphs(value, limit: int = 2000) -> str | None:
    text = value.strip()[:limit] if isinstance(value, str) else ""
    return text or None


def _texts(value) -> list[str]:
    """The strings in a jsonb list, or in one comma-separated string."""
    items = value.split(",") if isinstance(value, str) else value if isinstance(value, list) else []
    return _distinct(line for item in items if (line := _one_line(item, 60)))


def _distinct(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    kept = []
    for value in values:
        if value.casefold() not in seen:
            seen.add(value.casefold())
            kept.append(value)
    return kept


def _humanise(code: str) -> str:
    """A category code the catalogue does not name: "PEST_CONTROL" -> "Pest control"."""
    return " ".join(code.replace("_", " ").replace("-", " ").split()).capitalize()


def _object(value) -> dict:
    """An embedded row, given as an object or a one-row list; anything else reads as empty."""
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, dict) else {}


def _amount(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return float(value)


def _month(value) -> str | None:
    """"2026-11-21" -> "2026-11": the move-in day stays private."""
    return value[:7] if isinstance(value, str) and DATE_PATTERN.match(value) else None


def _slug(value) -> str | None:
    return value if isinstance(value, str) and len(value) <= 100 and SLUG_PATTERN.fullmatch(value) else None


def _url(value) -> str | None:
    """Only a web address: a storage key or a script URL is not an image to show."""
    return value if isinstance(value, str) and len(value) <= 2048 and URL_PATTERN.fullmatch(value) else None


def _is_uuid(value: str) -> bool:
    return UUID_PATTERN.fullmatch(value) is not None


def _needle(value: str | None) -> str:
    return " ".join((value or "").split())[:MAX_SEARCH_LENGTH].casefold()


def _contains(needle: str, fields: list[str | None]) -> bool:
    """Whether needle is part of one of the fields, ignoring case; an empty needle matches all."""
    return not needle or any(needle in field.casefold() for field in fields if field)
