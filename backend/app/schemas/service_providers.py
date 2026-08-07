from datetime import datetime

from pydantic import BaseModel


class ServiceProviderCreate(BaseModel):
    category: str
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
    category: str | None = None
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
    category: str
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
    verifications: list[str] = []
    from_price: float | None = None
    price_unit: str | None = None
    service_count: int = 0
