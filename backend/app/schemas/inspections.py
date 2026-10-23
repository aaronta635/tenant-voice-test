"""Inspection times, bookings and records (services/inspections.py).

property_id is the listing's id, as everywhere on the web. Statuses are the
mobile tables' CHECK values.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

SlotStatus = Literal["open", "held", "booked", "cancelled"]
BookingStatus = Literal["pending", "accepted", "rejected", "reschedule_requested", "cancelled"]
RecordStatus = Literal["Scheduled", "Completed", "Cancelled"]


class InspectionSlotOut(BaseModel):
    id: str
    property_id: str
    owner_id: str | None = None
    starts_at: datetime
    duration_minutes: int
    status: SlotStatus
    property_title: str | None = None
    # The street address; null for a visitor who is signed out.
    address: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class InspectionBookingOut(BaseModel):
    id: str
    slot_id: str
    property_id: str
    owner_id: str
    tenant_id: str
    status: BookingStatus
    note: str | None = None
    starts_at: datetime
    duration_minutes: int
    slot_status: SlotStatus
    property_title: str | None = None
    address: str | None = None
    tenant_name: str | None = None
    owner_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class OwnerInspectionsOut(BaseModel):
    slots: list[InspectionSlotOut]
    bookings: list[InspectionBookingOut]


class InspectionHomeOut(BaseModel):
    property_id: str
    title: str | None = None
    address: str | None = None
    owner_id: str | None = None
    owner_name: str | None = None
    open_slot_count: int


class InspectionSlotsCreate(BaseModel):
    # A time without an offset is Sydney wall-clock time (services/inspections.sydney_instant).
    starts_at: list[datetime] = Field(default_factory=list)
    duration_minutes: int = 30


class InspectionBookingCreate(BaseModel):
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class InspectionDecision(BaseModel):
    decision: str = Field(max_length=40)


class InspectionStepOut(BaseModel):
    status: str | None = None
    note: str | None = None
    at: datetime | None = None


class InspectionRecordOut(BaseModel):
    id: str
    property_id: str
    property_title: str | None = None
    address: str | None = None
    type: str
    scheduled_at: datetime
    attendee_id: str | None = None
    attendee_name: str | None = None
    notes: str | None = None
    status: RecordStatus
    history: list[InspectionStepOut] = Field(default_factory=list)
    # For an attendee: whether the listing page opens (PUBLISHED or APPLICATIONS_CLOSED); None for the owner.
    listed: bool | None = None


class InspectionRecordIn(BaseModel):
    type: str = Field(max_length=60)
    # Without an offset: Sydney wall-clock time.
    scheduled_at: datetime
    attendee_id: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


class InspectionRecordStatusIn(BaseModel):
    status: str = Field(max_length=40)
    note: str | None = Field(default=None, max_length=1000)


class InspectionAttendeeOut(BaseModel):
    user_id: str
    name: str
