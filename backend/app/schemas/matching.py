"""Tenant matching (R34): the homes and landlords that fit a tenant's saved preferences.

Every response is built field by field in services/matching.py: a listing
shows what its public page shows, never the street address, and a landlord
what their public profile shows (schemas/public_profiles.py).
"""

from datetime import date, datetime
from typing import Annotated, Literal, get_args

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.schemas.gates import GateRefusalOut

# The preferences a tenant can make essential (a must) or nice to have.
EssentialFilter = Literal["budget", "location", "pets", "bedrooms", "move_in"]
ESSENTIAL_FILTERS: tuple[str, ...] = get_args(EssentialFilter)
MatchLevel = Literal["strong", "good", "fair"]
# verification_required: the model is the paid AI, which only a verified tenant uses (R18).
AiStatus = Literal["not_configured", "ready", "applied", "unavailable", "cooldown", "verification_required"]


def _distinct(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


class EssentialsUpdate(BaseModel):
    """Which preferences every match must meet; the others only rank a home lower."""

    model_config = ConfigDict(extra="forbid")

    essentials: Annotated[list[EssentialFilter], Field(max_length=len(ESSENTIAL_FILTERS)), AfterValidator(_distinct)]


class MatchFilterOut(BaseModel):
    key: EssentialFilter
    # The tenant's mark, or the default (every filter is a must until marked otherwise).
    essential: bool
    # Whether the tenant saved a value for it; a filter without one excludes nothing.
    active: bool
    # The saved value in words, such as "Up to $650 a week"; None while there is none.
    summary: str | None = None


class MatchListingOut(BaseModel):
    """A listing as its public page shows it, without the street address."""

    id: str
    title: str
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    property_type: str | None = None
    price: float
    bedrooms: int | None = None
    bathrooms: int | None = None
    parking: int | None = None
    pet_friendly: bool = False
    available_from: date | None = None
    photo_url: str | None = None
    published_at: datetime | None = None


class MatchLandlordOut(BaseModel):
    """The badges the listing's owner's public profile shows."""

    id: str
    verified: bool = False
    rating_avg: float | None = None
    review_count: int = 0


class PropertyMatchOut(BaseModel):
    listing: MatchListingOut
    # 0-100: the share of the preferences and trust signals the home meets.
    score: int = Field(ge=0, le=100)
    match_level: MatchLevel
    # Facts from the listing and its landlord that fit the tenant, best first.
    reasons: list[str]
    # The nice-to-have preferences the home misses.
    unmet: list[str] = []
    # None when the owner took their profile out of the public lists.
    landlord: MatchLandlordOut | None = None


class PropertyMatchesOut(BaseModel):
    items: list[PropertyMatchOut]
    filters: list[MatchFilterOut]
    # False until the tenant saves a budget, suburb, bedrooms, pets or another preference.
    has_preferences: bool
    # Published listings looked at, and how many each essential left out (one may fail several).
    considered: int
    excluded: dict[EssentialFilter, int] = {}
    excluded_total: int = 0
    source: Literal["rules", "ai"]
    ai_status: AiStatus
    message: str | None = None
    # Why the model was not asked, with ai_status verification_required; None otherwise.
    verification: GateRefusalOut | None = None
    generated_at: datetime
    # The order was read back from the recorded results instead of worked out again.
    cached: bool = False


class LandlordListingOut(BaseModel):
    id: str
    title: str
    suburb: str | None = None
    price: float


class LandlordMatchOut(BaseModel):
    """A landlord as their public profile shows them, with the homes of theirs that fit."""

    id: str
    display_name: str
    # "Landlord" or "Agent".
    role_label: str
    avatar_url: str | None = None
    areas: list[str] = []
    verified: bool = False
    rating_avg: float | None = None
    review_count: int = 0
    # Their listings that meet every essential; the best ones come in listings.
    listing_count: int
    listings: list[LandlordListingOut]
    score: int = Field(ge=0, le=100)
    reasons: list[str]


class LandlordMatchesOut(BaseModel):
    items: list[LandlordMatchOut]
    has_preferences: bool
    generated_at: datetime


# ---------------------------------------------------------------------------
# What the model may answer when it re-orders the shortlist: aliases of the
# supplied listings and codes of their own facts, nothing else.
# ---------------------------------------------------------------------------
class AiPick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    listing_id: str = Field(min_length=1, max_length=40)
    # Empty only for a listing without facts (services/matching._validated_order).
    reason_codes: list[str] = Field(max_length=3)


class AiOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendations: list[AiPick] = Field(min_length=1, max_length=24)
