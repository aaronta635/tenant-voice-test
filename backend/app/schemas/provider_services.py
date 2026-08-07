from datetime import datetime

from pydantic import BaseModel


class ProviderServiceCreate(BaseModel):
    title: str
    description: str | None = None
    pricing_type: str = "flat"
    price: float
    duration_minutes: int | None = None
    inclusions: str | None = None
    exclusions: str | None = None
    service_area: str | None = None
    cancellation_policy: str | None = None
    is_active: bool = True
    sort_order: int = 0


class ProviderServiceUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    pricing_type: str | None = None
    price: float | None = None
    duration_minutes: int | None = None
    inclusions: str | None = None
    exclusions: str | None = None
    service_area: str | None = None
    cancellation_policy: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ProviderServiceOut(BaseModel):
    id: str
    provider_id: str
    title: str
    description: str | None = None
    pricing_type: str
    price: float
    duration_minutes: int | None = None
    inclusions: str | None = None
    exclusions: str | None = None
    service_area: str | None = None
    cancellation_policy: str | None = None
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    booking_count: int = 0
