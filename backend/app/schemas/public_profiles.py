"""What anyone may see of a member: the public profile allowlist.

Tracker assumption #1. Every field is named here on purpose: the service
builds these models field by field, and extra="forbid" makes passing a
database row through fail instead of leaking its other columns. The same
fields go to signed-out and signed-in callers.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

PublicRole = Literal["tenant", "landlord", "provider"]


class PublicProfileOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    # The search tab a member is under: agents are listed with landlords.
    role: PublicRole
    # "Tenant", "Landlord", "Agent" or "Service provider".
    role_label: str
    # Tenants by first name and surname initial, everyone else by full or business name.
    display_name: str
    business_name: str | None = None
    avatar_url: str | None = None
    # Suburbs and areas, never a street address.
    areas: list[str] = []
    # One line, cut short: the rest of the text stays private.
    about: str | None = None
    verified: bool = False
    # From the reviews moderators left up (public_profiles.RATED_STATUSES); None until there is one.
    rating_avg: float | None = None
    review_count: int = 0
    # Tenants: the weekly budget, and the month (never the day) they want to move in.
    budget_min: float | None = None
    budget_max: float | None = None
    move_in_month: str | None = None
    # Providers.
    categories: list[str] = []
    pricing_summary: str | None = None
    service_area: str | None = None
    provider_slug: str | None = None


class PublicProfileReviewOut(BaseModel):
    """A review about the member that moderators left up. Reviewers are never named or linked."""

    model_config = ConfigDict(extra="forbid")

    id: str
    rating: int
    title: str | None = None
    body: str | None = None
    # "Verified tenant", "Landlord", ...: who wrote it, by role only.
    reviewer_label: str
    reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime
    # Someone reported it (FLAGGED) and no moderator has decided yet: it stays
    # up, shown as reported, until one hides it.
    reported: bool = False


class PublicScorecardOut(BaseModel):
    """The owner scorecards a tenant chose to show (R43), as one figure: never who wrote them or what they said."""

    model_config = ConfigDict(extra="forbid")

    # The mean of each scorecard's average rating, from 1 to 5, to two decimals.
    average: float
    count: int


class PublicProfileDetailOut(PublicProfileOut):
    # The newest reviews moderators left up; review_count has the total.
    reviews: list[PublicProfileReviewOut] = []
    # Tenants only: the completed scorecards they show on their profile; None while they show none.
    scorecard: PublicScorecardOut | None = None


class PublicProfilePageOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PublicProfileOut]
    total: int
    # The page size used: a larger limit is capped.
    limit: int
    offset: int
