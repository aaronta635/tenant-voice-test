from datetime import date, datetime

from pydantic import BaseModel

STATUSES = ["available", "rented", "off_market"]


class PropertyCreate(BaseModel):
    title: str
    description: str | None = None
    address: str
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    property_type: str | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    parking: int | None = None
    price: float
    bond: float | None = None
    lease_term: str | None = None
    available_from: date | None = None
    amenities: list[str] | None = None
    photo_urls: list[str] | None = None
    status: str = "available"


class PropertyUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    property_type: str | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    parking: int | None = None
    price: float | None = None
    bond: float | None = None
    lease_term: str | None = None
    available_from: date | None = None
    amenities: list[str] | None = None
    photo_urls: list[str] | None = None
    status: str | None = None


class PropertyOut(BaseModel):
    id: str
    owner_id: str
    title: str
    description: str | None = None
    address: str
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    property_type: str | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    parking: int | None = None
    price: float
    bond: float | None = None
    lease_term: str | None = None
    available_from: date | None = None
    amenities: list[str] | None = None
    photo_urls: list[str] | None = None
    status: str
    rating_avg: float
    review_count: int
    created_at: datetime
    updated_at: datetime
