"""Service providers suggested to owners and tenants (tracker R31).

rank_providers() ranks the providers the marketplace lists for the places a
client needs work done, optionally in one category. GET
/me/provider-suggestions calls it for an owner's property (or all of them) and
for a tenant's own and preferred areas, and the owner AI (R29) will call it
too. Four public facts decide the order:

- Where the provider works (LOCATION_WEIGHT): the service area on its profile
  and its live services' service areas, then where it is based (its owner's
  users.metadata). A suburb named as a whole beats the postcode, which beats
  the state. A provider that fits none of the places is left out; with no
  place to match on, every provider is ranked on the rest.
- Its rating (RATING_WEIGHT): the reviews its profile counts
  (public_profiles.trust_of: PUBLISHED and FLAGGED), averaged with
  PRIOR_REVIEWS reviews of PRIOR_RATING, so that one 5-star review does not
  outrank 40 good ones.
- Its price (PRICE_WEIGHT, tracker assumption #10): its cheapest priced live
  service against the median of the same pricing type (fixed, hourly or from)
  among the listed providers of its category, one price each. At or below the
  median scores in full: cost-effective, not cheapest. A median needs
  MIN_PRICES_COMPARED prices, and a price without one neither helps nor hurts.
- The verified badge (badges.is_verified) breaks a tie.

Listed is what the marketplace lists (service_providers.published_providers):
published, with an open, ACTIVE account. A provider without a live service
cannot be booked, so it is never suggested. Each suggestion's reasons are
those facts as numbers ("Serves Newtown", "4.8 from 12 reviews", "$120 fixed,
below the $150 median for cleaning"). Nothing here is written.
"""

import re
import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client
from app.services import _common, profiles, public_profiles, provider_services, service_providers
from app.services import categories as categories_service
from app.services import properties as properties_service
from app.services.maps_rental import locality
from app.services.provider_recommendations import (
    _STATE_CODE,
    _STATE_NAME,
    _area_pieces,
    _capitalised_runs,
    _normalise,
    _parse_state,
    _plain,
)

DEFAULT_LIMIT = 12
# Points out of 100 for each factor; the location's count only when there is a place to match.
LOCATION_WEIGHT, RATING_WEIGHT, PRICE_WEIGHT = 45, 35, 20
# Best first. A whole suburb name, then the postcode, then the state.
TIER_SCORES = {"suburb": 1.0, "postcode": 0.8, "state": 0.4}
# Every rating is averaged with this many reviews of this score.
PRIOR_RATING, PRIOR_REVIEWS = 3.5, 3
# A median needs this many providers' prices of one pricing type in a category.
MIN_PRICES_COMPARED = 3
# The price fit of a price no median compares: halfway, so it neither helps nor hurts.
UNCOMPARED_PRICE = 0.5
PRICE_WORDS = {"flat": "fixed", "hourly": "per hour"}
# How a reason names a category's work: "below the $150 median for cleaning".
CATEGORY_PHRASES = {
    "co_host_inspector": "co-host inspections",
    "real_estate_agent": "real estate agents",
    "accountant": "property accounting",
    "tradie": "trade work",
    "cleaner": "cleaning",
    "photographer": "property photography",
    "conveyancer": "legal and tenancy support",
    "property_manager": "property maintenance",
    "other": "other property services",
}
VERIFIED_REASON = "Verified by TenantVoice"
FALLBACK_NAME = "TenantVoice provider"
# The most place labels a response lists; every place is still matched.
PLACES_SHOWN = 20
_POSTCODE = re.compile(r"(?<!\d)\d{4}(?!\d)")


# ---------------------------------------------------------------------------
# Places
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Place:
    """Where a client needs work done: a suburb as written, a postcode and a state code, each optional."""

    suburb: str | None = None
    postcode: str | None = None
    state: str | None = None

    @property
    def key(self) -> str:
        return _normalise(self.suburb)

    @property
    def label(self) -> str:
        """"Newtown, NSW 2042", as maps_rental.locality writes a property's."""
        return locality({"suburb": self.suburb, "state": self.state, "postcode": self.postcode})


def _state_of(value, whole: bool = False) -> str | None:
    """The state code a text names; whole: the text holds only a state, as a state column does."""
    text = _plain(value if isinstance(value, str) else None, 40)
    return _parse_state(text.upper() if whole and len(text) <= 3 else text) if text else None


def _postcode_of(value) -> str | None:
    found = _POSTCODE.search(_plain(value if isinstance(value, str) else None, 20))
    return found.group(0) if found else None


def _without_state_or_postcode(text: str) -> str:
    return _POSTCODE.sub(" ", _STATE_NAME.sub(" ", _STATE_CODE.sub(" ", text)))


def place_from_text(value) -> Place | None:
    """A place someone typed ("Newtown, NSW 2042", "2042", "Victoria"); None for one that names nothing."""
    text = _plain(value if isinstance(value, str) else None, 80)
    suburb = " ".join(_without_state_or_postcode(text).replace(",", " ").split()).strip(" .;-")
    place = Place(suburb or None, _postcode_of(text), _state_of(text))
    return place if place.key or place.postcode or place.state else None


def property_place(prop: dict) -> Place:
    """A properties row's suburb, postcode and state."""
    return Place(_plain(prop.get("suburb"), 80) or None, _postcode_of(prop.get("postcode")),
                 _state_of(prop.get("state"), whole=True))


def _profile_place(raw: dict) -> Place | None:
    """The suburb, postcode and state on a member's profile (users.metadata), or None."""
    place = Place(_plain(raw.get("location"), 80) or None, _postcode_of(raw.get("postcode")),
                  _state_of(raw.get("state"), whole=True))
    return place if place.key or place.postcode or place.state else None


def _distinct_places(places: Iterable[Place | None]) -> list[Place]:
    kept: dict[tuple, Place] = {}
    for place in places:
        if place is not None and (place.key or place.postcode or place.state):
            kept.setdefault((place.key, place.postcode, place.state), place)
    return list(kept.values())


# ---------------------------------------------------------------------------
# Where a provider works
# ---------------------------------------------------------------------------
@dataclass
class _Areas:
    """A provider's served suburbs (with the state each is in, if known), postcodes and whole states, and its base."""

    suburbs: set[tuple[str, str | None]]
    postcodes: set[str]
    states: set[str]
    base: Place


def _areas(texts: Iterable[str | None], base: Place) -> _Areas:
    """Read service areas such as "Newtown, Enmore", "Inner West NSW", "2042" or "VIC".

    Each piece between commas, semicolons and slashes is a suburb or region
    named as a whole, with its capitalised names ("15km of Newtown" serves
    Newtown); its 4-digit numbers are postcodes, and a piece that is only a
    state serves the whole state. A piece that names no state is in the
    provider's own state, so "Newtown" from a Geelong provider is not
    Newtown in Sydney.
    """
    areas = _Areas(set(), set(), set(), base)
    for text in texts:
        for piece in _area_pieces(text):
            piece = _plain(piece, 120)
            state, codes = _parse_state(piece), set(_POSTCODE.findall(piece))
            rest = _without_state_or_postcode(piece)
            areas.postcodes |= codes
            names = {_normalise(rest), *(_normalise(run) for run in _capitalised_runs(rest))} - {""}
            if not names:
                if state and not codes:
                    areas.states.add(state)
                continue
            areas.suburbs |= {(name, state or base.state) for name in names if not _parse_state(name)}
    return areas


def _same_state(first: str | None, second: str | None) -> bool:
    return first is None or second is None or first == second


def _named(values: list[str]) -> str:
    """The first two, as a sentence names them: "Newtown and Glebe"."""
    shown = list(dict.fromkeys(values))[:2]
    return " and ".join(shown)


def _location(areas: _Areas, places: Sequence[Place]) -> tuple[str, str] | None:
    """(tier, reason) of the best fit between the provider's areas and the places, or None."""
    base = areas.base
    for tier in TIER_SCORES:
        serves: list[str] = []
        based: list[str] = []
        for place in places:
            if tier == "suburb" and place.key:
                if any(name == place.key and _same_state(state, place.state) for name, state in areas.suburbs):
                    serves.append(place.suburb)
                elif place.key == base.key and _same_state(base.state, place.state):
                    based.append(place.suburb)
            elif tier == "postcode" and place.postcode:
                if place.postcode in areas.postcodes:
                    serves.append(f"postcode {place.postcode}")
                elif place.postcode == base.postcode:
                    based.append(f"postcode {place.postcode}")
            elif tier == "state" and place.state:
                if place.state in areas.states:
                    serves.append(place.state)
                elif place.state == base.state:
                    based.append(place.state)
        if serves:
            return tier, f"Serves {_named(serves)}"
        if based:
            return tier, f"Based in {_named(based)}"
    return None


# ---------------------------------------------------------------------------
# Rating and price
# ---------------------------------------------------------------------------
def _one_decimal(value: float) -> str:
    """The average to one decimal, as RatingBadge shows it (JavaScript's toFixed: an exact half goes up)."""
    return str(Decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _rating_fit(average: float | None, count: int) -> float:
    """0-1: the average blended with PRIOR_REVIEWS reviews of PRIOR_RATING."""
    blended = (PRIOR_RATING * PRIOR_REVIEWS + (average or 0) * count) / (PRIOR_REVIEWS + count)
    return (blended - 1) / 4


def _rating_reason(average: float | None, count: int) -> str:
    if not count or average is None:
        return "No reviews yet"
    return f"{_one_decimal(average)} from {count} review{'' if count == 1 else 's'}"


def _money(value: float) -> str:
    return f"${value:,.0f}" if float(value).is_integer() else f"${value:,.2f}"


def _price_text(service: dict) -> str:
    """"$120 fixed", "$85 per hour" or "From $85"."""
    amount = _money(service["price"])
    if service["pricing_type"] == "from":
        return f"From {amount}"
    return f"{amount} {PRICE_WORDS[service['pricing_type']]}"


def _headline(services: list[dict]) -> dict:
    """The cheapest priced live service, as the marketplace card's price; the first one when none is priced."""
    priced = [service for service in services if service["price"] > 0]
    return min(priced, key=lambda service: service["price"]) if priced else services[0]


def _medians(providers: list[dict], services: dict[str, list[dict]]) -> dict[tuple[str, str], tuple[float, int]]:
    """(category, pricing type) -> (median, how many), of each provider's cheapest price of that type."""
    prices: dict[tuple[str, str], list[float]] = {}
    for provider in providers:
        if not provider["category"]:
            continue
        cheapest: dict[str, float] = {}
        for service in services.get(provider["id"], []):
            kind = service["pricing_type"]
            if service["price"] > 0:
                cheapest[kind] = min(cheapest.get(kind, service["price"]), service["price"])
        for kind, price in cheapest.items():
            prices.setdefault((provider["category"], kind), []).append(price)
    return {
        key: (float(statistics.median(values)), len(values))
        for key, values in prices.items()
        if len(values) >= MIN_PRICES_COMPARED
    }


def _category_phrase(code: str, catalogue: dict[str, dict]) -> str:
    named = (catalogue.get(code) or {}).get("name")
    return CATEGORY_PHRASES.get(code) or (named.lower() if named else code.replace("_", " ").lower())


def _price(service: dict, category: str | None, medians: dict, catalogue: dict) -> tuple[float, dict | None, str | None]:
    """(0-1 fit, the comparison, its reason) for the headline service's price."""
    found = medians.get((category, service["pricing_type"])) if category and service["price"] > 0 else None
    if found is None:
        return UNCOMPARED_PRICE, None, None
    median, compared = found
    price = service["price"]
    position = "below" if round(price, 2) < round(median, 2) else "at" if round(price, 2) == round(median, 2) else "above"
    fit = 1.0 if position != "above" else max(0.0, 1 - (price - median) / median)
    reason = f"{_price_text(service)}, {position} the {_money(median)} median for {_category_phrase(category, catalogue)}"
    return fit, {"median": median, "position": position, "compared": compared}, reason


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------
def _service_areas(provider_ids: list[str]) -> dict[str, str | None]:
    rows = _common.select_in(
        lambda: get_supabase_client().table("service_provider_profiles").select("user_id, service_area").order("user_id"),
        "user_id",
        provider_ids,
    )
    return {row["user_id"]: row.get("service_area") for row in rows}


def category_row(value: str, catalogue: dict[str, dict]) -> dict | None:
    """The catalogue row (categories.by_code) a category code or URL slug names, as categories.code_for reads it."""
    return catalogue.get(value) or next((row for row in catalogue.values() if row["slug"] == value), None)


def _display_name(provider: dict) -> str:
    owner = provider.get("profiles") or {}
    return (
        public_profiles.shown_name(provider.get("business_name"))
        or public_profiles.shown_name(owner.get("full_name"))
        or FALLBACK_NAME
    )


def rank_providers(
    places: Sequence[Place],
    category: str | None = None,
    *,
    limit: int = DEFAULT_LIMIT,
    exclude: Iterable[str] = (),
) -> list[dict]:
    """The listed providers best suited to work at these places, best first, as ProviderSuggestionOut dicts.

    places are where the client needs the work done, in the order a reason
    names them; category is a category code or its URL slug, None for every
    category. exclude holds provider ids never to suggest, such as the
    caller's own. Raises ValueError for a category the catalogue does not
    know. See the module docstring for the order and the reasons.
    """
    catalogue = categories_service.by_code()
    code = None
    if category:
        named = category_row(category, catalogue)
        if named is None:
            raise ValueError(f"unknown category {category!r}")
        code = named["category"]
    places = _distinct_places(places)
    excluded = set(exclude)
    listed = [
        provider for provider in service_providers.published_providers()
        if provider["id"] not in excluded and (code is None or provider["category"] == code)
    ]
    services: dict[str, list[dict]] = {}
    for service in provider_services.live_services(provider["id"] for provider in listed):
        services.setdefault(service["provider_id"], []).append(service)
    medians = _medians(listed, services)
    bookable = service_providers._with_owner_profiles([provider for provider in listed if services.get(provider["id"])])
    if not bookable:
        return []
    ids = [provider["id"] for provider in bookable]
    served, trust = _service_areas(ids), public_profiles.trust_of(ids)

    ranked = []
    for provider in bookable:
        mine = services[provider["id"]]
        owner = provider.get("profiles") or {}
        fit = None
        if places:
            base = _profile_place(owner) or Place()
            fit = _location(_areas([served.get(provider["id"]), *(service["service_area"] for service in mine)], base), places)
            if fit is None:
                continue
        standing = trust.get(provider["id"], {})
        average, count, verified = standing.get("rating_avg"), standing.get("review_count", 0), standing.get("verified", False)
        headline = _headline(mine)
        price_fit, comparison, price_reason = _price(headline, provider["category"], medians, catalogue)
        weighted = [(RATING_WEIGHT, _rating_fit(average, count)), (PRICE_WEIGHT, price_fit)]
        if fit:
            weighted.append((LOCATION_WEIGHT, TIER_SCORES[fit[0]]))
        score = round(100 * sum(weight * value for weight, value in weighted) / sum(weight for weight, _ in weighted))
        reasons = [fit[1]] if fit else []
        reasons += [_rating_reason(average, count), *([price_reason] if price_reason else [])]
        reasons += [VERIFIED_REASON] if verified else []
        name = _display_name(provider)
        item = {
            "id": provider["id"],
            "slug": provider["slug"],
            "display_name": name,
            "category": provider["category"],
            "category_name": (catalogue.get(provider["category"]) or {}).get("name"),
            "location": _plain(owner.get("location"), 80) or None,
            "state": _plain(owner.get("state"), 20) or None,
            "verified": verified,
            "rating_avg": average,
            "review_count": count,
            "service": {key: headline[key] for key in ("id", "title", "pricing_type", "price")},
            "price_comparison": comparison,
            "match": fit[0] if fit else None,
            "score": score,
            "reasons": reasons[:4],
        }
        # The verified badge breaks a tie, then the number of reviews.
        ranked.append(((-score, not verified, -count, name.casefold(), provider["id"]), item))
    ranked.sort(key=lambda found: found[0])
    return [item for _, item in ranked[:limit]]


# ---------------------------------------------------------------------------
# GET /me/provider-suggestions
# ---------------------------------------------------------------------------
def _owner_context(owner_id: str, raw: dict, property_id: str | None) -> dict:
    """One property the owner owns or manages (else 404), all of them, or the owner's own area."""
    if property_id:
        listing, prop = properties_service.owned_listing(property_id, owner_id)
        place = property_place(prop)
        return {"kind": "property", "property_id": listing["id"], "property_title": listing.get("title"),
                "places": [place], "suburb": place.suburb}
    listings = properties_service.owned_listings(owner_id, columns="id, properties(suburb, state, postcode)")
    places = _distinct_places(property_place(row["properties"]) for row in listings if row.get("properties"))
    if places:
        return {"kind": "properties", "places": places, "suburb": places[0].suburb if len(places) == 1 else None}
    return _profile_context(raw, [])


def _tenant_context(tenant_id: str, raw: dict) -> dict:
    """The tenant's own area, then the suburbs they would like to live in."""
    rows = (
        get_supabase_client().table("tenant_profiles").select("user_id, preferred_locations")
        .eq("user_id", tenant_id).limit(1).execute().data
    )
    preferred = profiles.tenant_details(rows[0] if rows else None)["preferred_locations"]
    return _profile_context(raw, preferred_places(preferred, _profile_place(raw)))


def preferred_places(texts: Iterable[str], own: Place | None) -> list[Place]:
    """A tenant's preferred suburbs as places, each in a state where one can be told.

    The web saves them a name at a time, in the order typed: the settings
    split "Newtown, NSW, Footscray, VIC" at its commas, and onboarding adds one
    suburb after another. So a suburb (or postcode) saved without a state is
    in the first state saved after it, else in the tenant's own: a Geelong
    provider's "Newtown" is not the Newtown a Glebe tenant means. A state
    saved after such suburbs is theirs, not a place of its own (a postcode
    saved with it, "NSW 2042", still is); a state saved alone is ("NSW":
    anywhere in it).
    """
    places: list[Place] = []
    # The places so far without a state, waiting for the next state saved.
    waiting: list[int] = []
    for place in filter(None, (place_from_text(text) for text in texts)):
        if place.state and not place.key and waiting:
            for index in waiting:
                places[index] = replace(places[index], state=place.state)
            waiting = []
            if not place.postcode:
                continue
        elif not place.state:
            waiting.append(len(places))
        places.append(place)
    for index in waiting:
        places[index] = replace(places[index], state=own.state if own else None)
    return places


def _profile_context(raw: dict, more: list[Place | None]) -> dict:
    own = _profile_place(raw)
    places = _distinct_places([own, *more])
    return {"kind": "profile" if places else "none", "places": places, "suburb": own.suburb if own else None}


def suggestions(current: CurrentProfile, category: str | None = None, property_id: str | None = None,
                limit: int = DEFAULT_LIMIT) -> dict:
    """The providers suggested to the signed-in owner or tenant, with the places they were ranked for.

    An owner's are for property_id, one of their own properties (404 for
    anyone else's), or else for all their properties, or their own area when
    they have none. A tenant's are for their own area and preferred suburbs,
    and a tenant names no property (400).
    """
    if current.role == "landlord":
        context = _owner_context(current.id, current.raw, property_id)
    elif property_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only an owner can choose one of their properties.")
    else:
        context = _tenant_context(current.id, current.raw)
    named = category_row(category, categories_service.by_code()) if category else None
    if category and named is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a category from the list.")
    items = rank_providers(context["places"], named["category"] if named else None, limit=limit, exclude={current.id})
    return {
        "items": items,
        "context": {
            "kind": context["kind"],
            "property_id": context.get("property_id"),
            "property_title": context.get("property_title"),
            "places": [place.label for place in context["places"][:PLACES_SHOWN]],
            "suburb": context.get("suburb"),
        },
        "category": {key: named[source] for key, source in (("code", "category"), ("slug", "slug"), ("name", "name"))}
        if named else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
