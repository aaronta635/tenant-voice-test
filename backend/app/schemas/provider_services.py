from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

# What mobile_create_provider_service and mobile_update_provider_service take
# (output/shared-catalog/functions): the price types and category codes they
# accept, a title of up to 80 characters, a description of up to 1000, a
# price from 0 to 100,000, and an area of up to 200. Those functions check the
# rest, such as a description and a price above 0 to make a service active,
# and answer with their own message (422).
PricingType = Literal["flat", "hourly", "from"]
ServiceCategory = Literal["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Area = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Price = Annotated[float, Field(ge=0, le=100_000)]
Duration = Annotated[int, Field(ge=5, le=24 * 60)]


class ProviderServiceCreate(BaseModel):
    title: Title
    description: Description | None = None
    pricing_type: PricingType = "flat"
    price: Price
    duration_minutes: Duration | None = None
    # One item per line; the functions keep 20 items of up to 120 characters.
    inclusions: LongText | None = None
    exclusions: LongText | None = None
    service_area: Area | None = None
    category: ServiceCategory = "GENERAL"
    cancellation_policy: LongText | None = None
    is_active: bool = True
    sort_order: int = 0


class ProviderServiceUpdate(BaseModel):
    title: Title | None = None
    description: Description | None = None
    pricing_type: PricingType | None = None
    price: Price | None = None
    duration_minutes: Duration | None = None
    inclusions: LongText | None = None
    exclusions: LongText | None = None
    service_area: Area | None = None
    category: ServiceCategory | None = None
    cancellation_policy: LongText | None = None
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
    # One of ServiceCategory; a value another app stored outside them reads as GENERAL.
    category: str = "GENERAL"
    cancellation_policy: str | None = None
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    booking_count: int = 0
