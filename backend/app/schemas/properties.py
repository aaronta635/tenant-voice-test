from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.property_applications import ApplicationStage

STATUSES = ["available", "rented", "off_market"]

# listings.status as the web names it (maps_rental.listing_status_name). An
# archived listing is gone from the web, so no response carries "archived".
ListingStatus = Literal["draft", "published", "paused", "applications_closed", "leased"]
# What an owner can ask to move a listing to (maps_rental.SETTABLE_LISTING_STATUSES).
# leased is refused with the reason (409): approving an application leases a listing.
SettableListingStatus = Literal["published", "paused", "applications_closed", "leased"]

Amenity = Annotated[str, Field(max_length=60)]
PhotoLink = Annotated[str, Field(max_length=2000)]


class PropertyCreate(BaseModel):
    title: str = Field(max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    address: str = Field(max_length=200)
    suburb: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=40)
    postcode: str | None = Field(default=None, max_length=10)
    property_type: str | None = Field(default=None, max_length=40)
    bedrooms: int | None = Field(default=None, ge=0, le=50)
    bathrooms: int | None = Field(default=None, ge=0, le=50)
    parking: int | None = Field(default=None, ge=0, le=50)
    price: float = Field(gt=0, le=100_000)
    bond: float | None = Field(default=None, ge=0, le=1_000_000)
    lease_term: str | None = Field(default=None, max_length=40)
    available_from: date | None = None
    amenities: list[Amenity] | None = Field(default=None, max_length=40)
    photo_urls: list[PhotoLink] | None = Field(default=None, max_length=30)
    status: str = "available"


class PropertyUpdate(BaseModel):
    """A patch: a field left out keeps its value, and a null clears an optional one.

    The title, the address fields and the rent cannot be cleared. A status
    change is either the web's status or the exact listing_status, not both.
    """

    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    address: str | None = Field(default=None, max_length=200)
    suburb: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=40)
    postcode: str | None = Field(default=None, max_length=10)
    property_type: str | None = Field(default=None, max_length=40)
    bedrooms: int | None = Field(default=None, ge=0, le=50)
    bathrooms: int | None = Field(default=None, ge=0, le=50)
    parking: int | None = Field(default=None, ge=0, le=50)
    price: float | None = Field(default=None, gt=0, le=100_000)
    bond: float | None = Field(default=None, ge=0, le=1_000_000)
    lease_term: str | None = Field(default=None, max_length=40)
    available_from: date | None = None
    amenities: list[Amenity] | None = Field(default=None, max_length=40)
    photo_urls: list[PhotoLink] | None = Field(default=None, max_length=30)
    status: str | None = None
    listing_status: SettableListingStatus | None = None


class PropertyOut(BaseModel):
    id: str
    owner_id: str
    title: str
    description: str | None = None
    # The street address with its suburb, state and postcode. A signed-out
    # visitor of the public catalogue gets the suburb, state and postcode only.
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
    listing_status: ListingStatus
    rating_avg: float
    review_count: int
    created_at: datetime
    updated_at: datetime


class OwnerPropertyOut(PropertyOut):
    # properties.address_line_1, which an edit's address replaces; address
    # above is the whole address.
    street_address: str | None = None
    # Applications still on the listing: every one but the withdrawn and expired.
    application_count: int = 0
    # Of those, the ones nobody has looked at yet (SUBMITTED).
    new_application_count: int = 0


class ListingLandlordOut(BaseModel):
    """The listing's landlord as their public profile shows them (public_profiles), when they are listed."""

    id: str
    display_name: str
    role_label: str
    avatar_url: str | None = None
    verified: bool = False
    rating_avg: float | None = None
    review_count: int = 0


class ViewerApplicationOut(BaseModel):
    """The signed-in tenant's own application to the listing."""

    id: str
    stage: ApplicationStage
    can_withdraw: bool
    created_at: datetime


class ListingViewerOut(BaseModel):
    """Who is looking, as the server read their token: no role means signed out."""

    role: str | None = None
    # They own or manage the listing's property.
    is_owner: bool = False
    liked: bool = False
    application: ViewerApplicationOut | None = None


class PublicPropertyOut(PropertyOut):
    # True for a signed-out visitor: address holds only the suburb, state and
    # postcode, and a title that named the street describes the home instead.
    address_hidden: bool = False
    # Only a published listing takes applications; one closed to them still opens.
    accepting_applications: bool = False
    # The listing page's extras; None on catalogue pages.
    like_count: int | None = None
    landlord: ListingLandlordOut | None = None
    viewer: ListingViewerOut | None = None


class ListingLikeOut(BaseModel):
    liked: bool
    like_count: int
