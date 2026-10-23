"""Service providers suggested to an owner or a tenant (tracker R31).

Every suggestion is built field by field in services/provider_ranking.py from
what the marketplace already shows of a provider: its name, category, suburb
and state, rating, verified badge and live services. extra="forbid" makes a
database row passed through fail instead of leaking its other columns.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# How well a provider's areas fit the client's places: a suburb named as a
# whole, then the postcode, then the state.
LocationMatch = Literal["suburb", "postcode", "state"]
PricePosition = Literal["below", "at", "above"]
# property: one of the owner's properties; properties: all of them; profile:
# the suburb, postcode and state on the caller's profile, and a tenant's
# preferred suburbs; none: no place to match on.
ContextKind = Literal["property", "properties", "profile", "none"]


class ProviderSuggestionsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # A category code or its URL slug ("cleaner", "cleaning-provider").
    category: str | None = Field(default=None, max_length=60)
    # Owners only: one of their own properties (its listing id), else all of them.
    property_id: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=12, ge=1, le=24)


class SuggestedServiceOut(BaseModel):
    """The live service the price is for, and the one the booking link opens."""

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    pricing_type: Literal["flat", "hourly", "from"]
    # 0 when the provider has not priced it yet.
    price: float


class PriceComparisonOut(BaseModel):
    """The service's price against the median of the same pricing type in its category."""

    model_config = ConfigDict(extra="forbid")

    median: float
    position: PricePosition
    # How many providers' prices of that type the median is of, this one's included.
    compared: int


class ProviderSuggestionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The provider id: its owner's users.id.
    id: str
    # The provider page's address: /providers/{slug}.
    slug: str
    display_name: str
    category: str | None = None
    category_name: str | None = None
    # Where the provider is based, as its marketplace card shows it.
    location: str | None = None
    state: str | None = None
    verified: bool
    # The reviews its profile counts (public_profiles.trust_of); None until there is one.
    rating_avg: float | None = None
    review_count: int
    service: SuggestedServiceOut
    # None when too few providers of its category charge that way.
    price_comparison: PriceComparisonOut | None = None
    # None only when the client has no place to match on.
    match: LocationMatch | None = None
    # 0-100: location, rating and price, weighted as services/provider_ranking.py says.
    score: int = Field(ge=0, le=100)
    # The facts behind the place it has, as numbers: "4.8 from 12 reviews".
    reasons: list[str] = Field(min_length=1, max_length=4)


class SuggestionCategoryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    slug: str
    name: str


class SuggestionContextOut(BaseModel):
    """The places the providers were ranked for."""

    model_config = ConfigDict(extra="forbid")

    kind: ContextKind
    property_id: str | None = None
    property_title: str | None = None
    # Each place as "Newtown, NSW 2042", in the order they were matched.
    places: list[str] = []
    # The suburb a booking request starts with: the property's, or the caller's own.
    suburb: str | None = None


class ProviderSuggestionsOut(BaseModel):
    items: list[ProviderSuggestionOut]
    context: SuggestionContextOut
    category: SuggestionCategoryOut | None = None
    generated_at: datetime
