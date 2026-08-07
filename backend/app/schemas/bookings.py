from datetime import date, datetime, time

from pydantic import BaseModel

STATUSES = ["new_enquiry", "confirmed", "in_progress", "completed", "declined", "cancelled"]


class BookingCreate(BaseModel):
    provider_id: str
    service_id: str | None = None
    property_address: str | None = None
    property_suburb: str | None = None
    scheduled_date: date | None = None
    scheduled_time: time | None = None
    notes: str | None = None


class BookingStatusUpdate(BaseModel):
    status: str | None = None
    scheduled_date: date | None = None
    scheduled_time: time | None = None
    completion_report: str | None = None
    notes: str | None = None


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
