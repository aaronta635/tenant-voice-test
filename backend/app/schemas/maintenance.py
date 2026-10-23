from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# What mobile_create_repair and mobile_owner_create_repair take
# (mobile_repair_insert): one of the eight shared category codes, a priority,
# a title of up to 120 characters, a description of 5 to 2000 and up to 4
# photos, each a repair-photos key in the caller's folder. The functions
# check them again and answer with their own message (422).
CATEGORIES = ["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL"]
RepairCategory = Literal["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL"]
# The mobile app's four priorities (complaints.severity LOW, MEDIUM, HIGH, CRITICAL).
PRIORITIES = ["low", "medium", "high", "urgent"]
Priority = Literal["low", "medium", "high", "urgent"]
# How the web shows maintenance_work_orders.status (services/maintenance.py
# STATUS_TO_WEB). cancelled is only read, from rows older than the shared CHECK.
STATUSES = ["open", "in_progress", "awaiting_confirmation", "resolved", "cancelled"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=2000)]
AccessNotes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
PhotoKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
# mobile_resolve_repair takes a note of up to 1200 characters.
ResolutionNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1200)]
Rating = Annotated[int, Field(ge=1, le=5)]


class MaintenanceCreate(BaseModel):
    """A tenant reporting a repair for a home they rent, or an owner logging one for a home with a tenant."""

    model_config = ConfigDict(extra="forbid")

    property_id: str  # the listing's id, as GET /maintenance/homes gives it
    title: Title
    description: Description
    category: RepairCategory = "GENERAL"
    priority: Priority = "medium"
    # Keys POST /maintenance/photos returned.
    photos: list[PhotoKey] = Field(default_factory=list, max_length=4)
    access_notes: AccessNotes | None = None


class MaintenanceUpdate(BaseModel):
    """Tenant edits, while the request is still open."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    description: Description | None = None
    category: RepairCategory | None = None
    priority: Priority | None = None
    access_notes: AccessNotes | None = None


class MaintenanceAssign(BaseModel):
    """Owner assigning a provider whose categories hold the repair's (GET /maintenance/{id}/providers)."""

    provider_id: str


class MaintenanceStatusUpdate(BaseModel):
    status: str
    resolution_note: ResolutionNote | None = None


class RepairResolveIn(BaseModel):
    note: ResolutionNote | None = None


class RepairRatingIn(BaseModel):
    rating: Rating


class RepairHomeOut(BaseModel):
    """A home the caller can report a repair for, and the other party there."""

    listing_id: str
    property_id: str | None = None
    title: str
    address: str | None = None
    owner_name: str | None = None
    tenant_name: str | None = None


class RepairProviderOut(BaseModel):
    """A provider the owner may assign the repair to: approved, active and covering its category."""

    id: str
    name: str
    service_area: str | None = None
    pricing_summary: str | None = None


class RepairPhotoOut(BaseModel):
    path: str
    url: str | None = None
    content_type: str
    size: int
    virus_scan: str


class MaintenanceOut(BaseModel):
    id: str
    property_id: str
    tenant_id: str
    owner_id: str
    provider_id: str | None = None
    booking_id: str | None = None
    category: str
    category_label: str | None = None
    priority: str
    status: str
    title: str
    description: str
    # Short-lived links to the photos.
    photo_urls: list[str] | None = None
    access_notes: str | None = None
    resolution_note: str | None = None
    assigned_at: datetime | None = None
    resolved_at: datetime | None = None
    appointment_at: datetime | None = None
    estimated_duration_minutes: int | None = None
    appointment_note: str | None = None
    completed_at: datetime | None = None
    tenant_rating: int | None = None
    conversation_id: str | None = None
    logged_by_owner: bool = False
    # What the caller may do next, as mobile_repair_json says.
    can_confirm: bool = False
    can_rate: bool = False
    can_assign: bool = False
    can_resolve: bool = False
    created_at: datetime
    updated_at: datetime
    # Resolved by the service layer so the UI never has to join.
    property_title: str | None = None
    property_address: str | None = None
    tenant_name: str | None = None
    owner_name: str | None = None
    provider_name: str | None = None
