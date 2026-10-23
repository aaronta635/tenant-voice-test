from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

STATUSES = ["new", "reviewing", "approved", "declined"]

# An application's stage as the web names it (maps_rental.APPLICATION_STAGES):
# the shared status, finer than the web's four statuses.
ApplicationStage = Literal["submitted", "under_review", "shortlisted", "approved", "declined", "withdrawn", "expired"]
# Who made a step in an application's history: the tenant who applied, the
# listing's owner or manager, or someone else (an admin, the mobile app's jobs).
EventActor = Literal["applicant", "landlord"]

MAX_DOCUMENTS = 10


class ApplicationCreate(BaseModel):
    """What the tenant chooses to share. The apply form prefills it from their
    profile, and they can change any of it before sending; the server copies
    nothing from the profile."""

    model_config = ConfigDict(extra="forbid")

    property_id: str
    move_in_date: date | None = None
    # How many people will live there.
    occupants: int | None = Field(default=None, ge=1, le=20)
    has_pets: bool = False
    pets: str | None = Field(default=None, max_length=200)
    # As long as a profile's about line, which the apply form fills it from (schemas/profiles.About).
    about: str | None = Field(default=None, max_length=2000)
    annual_income: float | None = Field(default=None, ge=0, le=10_000_000)
    # The weekly rent offered; the asking rent when left out.
    rent_offered: float | None = Field(default=None, gt=0, le=100_000)
    message: str | None = Field(default=None, max_length=2000)
    # profile_documents ids the tenant marked shareable with landlords.
    document_ids: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=MAX_DOCUMENTS)


class ApplicationUpdate(BaseModel):
    status: str | None = None
    shortlisted: bool | None = None
    tenant_score: float | None = None
    # Sent to the applicant with the decision, and kept in its history.
    note: str | None = Field(default=None, max_length=500)


class ApplicationEventOut(BaseModel):
    """One step of the application's history (application_status_events)."""

    from_stage: ApplicationStage | None = None
    to_stage: ApplicationStage
    note: str | None = None
    by: EventActor | None = None
    created_at: datetime


class ApplicationDocumentOut(BaseModel):
    """A document that went with the application (application_documents)."""

    id: str
    # A ProfileDocumentType value.
    document_type: str
    label: str
    # TenantVoice verified the document (an admin approved it).
    verified: bool = False
    # The tenant still shares it: it is theirs, marked shareable, and on file.
    # The listing's owner sees only shared documents, and only while the
    # application is open or approved.
    shared: bool = True


class ApplicationListingOut(BaseModel):
    """The listing an application is for, as the tenant's list shows it."""

    id: str
    title: str
    suburb: str | None = None
    state: str | None = None
    photo_url: str | None = None
    weekly_rent: float | None = None
    # Whether the public listing page still opens (published, or closed to applications).
    is_public: bool = False


class ApplicationOut(BaseModel):
    id: str
    property_id: str
    tenant_id: str
    status: str
    stage: ApplicationStage
    # The tenant may still withdraw it: the owner has not decided yet.
    can_withdraw: bool
    annual_income: float | None = None
    move_in_date: date | None = None
    occupants: int | None = None
    rent_offered: float | None = None
    tenant_score: float | None = None
    shortlisted: bool
    has_pets: bool
    pets: str | None = None
    about: str | None = None
    message: str | None = None
    documents: list[ApplicationDocumentOut] = []
    history: list[ApplicationEventOut] = []
    created_at: datetime
    updated_at: datetime
    # The tenant's own list only.
    listing: ApplicationListingOut | None = None
    # Populated only on the landlord-facing endpoints (list/update) so an owner
    # can see who applied. None on the tenant's own-applications endpoint.
    tenant_name: str | None = None
    tenant_phone: str | None = None
    # The applicant's verified badge and rating, as their profile shows them.
    tenant_verified: bool | None = None
    tenant_rating_avg: float | None = None
    tenant_review_count: int | None = None
