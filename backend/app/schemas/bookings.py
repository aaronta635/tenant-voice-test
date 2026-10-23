from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

STATUSES = ["new_enquiry", "confirmed", "in_progress", "completed", "declined", "cancelled"]


BookingStatus = Literal["new_enquiry", "confirmed", "in_progress", "completed", "declined", "cancelled"]


def local_clock_time(value: time) -> time:
    if value.tzinfo is not None:
        raise ValueError("Use Sydney local time without a timezone offset")
    return value


LocalClockTime = Annotated[time, AfterValidator(local_clock_time)]


class BookingCreate(BaseModel):
    provider_id: str
    service_id: str | None = None
    property_address: str | None = Field(default=None, max_length=300)
    property_suburb: str | None = Field(default=None, max_length=120)
    scheduled_date: date | None = None
    scheduled_time: LocalClockTime | None = None
    notes: str | None = Field(default=None, max_length=2000)


class BookingStatusUpdate(BaseModel):
    status: BookingStatus | None = None
    scheduled_date: date | None = None
    scheduled_time: LocalClockTime | None = None
    completion_report: str | None = Field(default=None, max_length=4000)
    notes: str | None = Field(default=None, max_length=2000)


class BookingOut(BaseModel):
    id: str
    client_id: str
    provider_id: str
    service_id: str | None = None
    status: str
    property_address: str | None = None
    property_suburb: str | None = None
    scheduled_date: date | None = None
    scheduled_time: time | None = None
    price: float | None = None
    notes: str | None = None
    completion_report: str | None = None
    created_at: datetime
    updated_at: datetime
    # Resolved by the service layer so the UI never has to guess a name.
    client_name: str | None = None
    client_avatar_url: str | None = None
    provider_name: str | None = None
    service_title: str | None = None
    review_rating: int | None = None
    unread_count: int = 0
    conversation_id: str | None = None
