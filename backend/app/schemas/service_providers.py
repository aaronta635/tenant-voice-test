from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# The web's provider categories (maps_provider_core.WEB_CATEGORIES, the CHECK of
# web.service_categories): each is saved as its shared repair codes too
# (maps_provider_core.WEB_CATEGORY_CODES).
WebCategory = Literal[
    "co_host_inspector", "real_estate_agent", "accountant", "tradie", "cleaner",
    "photographer", "conveyancer", "property_manager", "other",
]


class ServiceProviderCreate(BaseModel):
    category: WebCategory
    business_name: str | None = None
    abn: str | None = None
    tagline: str | None = None
    bio: str | None = None
    headline: str | None = None
    years_experience: int | None = None
    languages: list[str] | None = None
    skills: list[str] | None = None
    specialties: list[str] | None = None
    service_radius_km: int | None = None
    website: str | None = None
    slug: str | None = None


class ServiceProviderUpdate(BaseModel):
    category: WebCategory | None = None
    business_name: str | None = None
    abn: str | None = None
    tagline: str | None = None
    bio: str | None = None
    headline: str | None = None
    years_experience: int | None = None
    languages: list[str] | None = None
    skills: list[str] | None = None
    specialties: list[str] | None = None
    gallery_urls: list[str] | None = None
    service_radius_km: int | None = None
    website: str | None = None
    response_time: str | None = None
    availability_note: str | None = None
    is_published: bool | None = None
    is_online: bool | None = None


class ProfileSummary(BaseModel):
    full_name: str
    avatar_url: str | None = None
    location: str | None = None
    state: str | None = None
    postcode: str | None = None
    phone: str | None = None


class ServiceProviderOut(BaseModel):
    id: str
    profile_id: str
    # None until the provider chooses one in onboarding step 1.
    category: str | None = None
    slug: str | None = None
    business_name: str | None = None
    abn: str | None = None
    tagline: str | None = None
    bio: str | None = None
    headline: str | None = None
    badge_label: str | None = None
    years_experience: int | None = None
    languages: list[str] | None = None
    skills: list[str] | None = None
    specialties: list[str] | None = None
    gallery_urls: list[str] | None = None
    service_radius_km: int | None = None
    website: str | None = None
    response_time: str | None = None
    availability_note: str | None = None
    is_online: bool = False
    is_published: bool
    profile_completion: int
    rating_avg: float
    review_count: int
    created_at: datetime
    updated_at: datetime


class ServiceProviderPublicOut(ServiceProviderOut):
    profiles: ProfileSummary | None = None
    # Derived, read-only presentation fields resolved by the service layer.
    category_name: str | None = None
    category_slug: str | None = None
    # The account's verified badge (badges.is_verified), as public profiles show it.
    verified: bool = False
    verifications: list[str] = []
    from_price: float | None = None
    price_unit: str | None = None
    service_count: int = 0
    completed_jobs: int = 0
