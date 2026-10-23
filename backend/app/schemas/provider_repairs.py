"""The assigned provider's repairs (tracker R33): maintenance_work_orders assigned to them."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RepairScheduleIn(BaseModel):
    """The visit, in Sydney time as the provider's calendar shows it."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    date: dt.date
    time: dt.time
    duration_minutes: int = Field(ge=15, le=24 * 60)
    # For the tenant and the owner, such as "I'll call 30 minutes before".
    note: str | None = Field(default=None, max_length=500)


class RepairCompleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # What was done, for the tenant and the owner.
    note: str = Field(min_length=3, max_length=2000)


class ProviderRepairOut(BaseModel):
    id: str
    # awaiting_confirmation once the provider marked it done, until the tenant confirms it.
    status: Literal["open", "in_progress", "awaiting_confirmation", "resolved", "cancelled"]
    # assigned until a visit is booked, then scheduled; completed once done (cancelled: an old row).
    stage: Literal["assigned", "scheduled", "completed", "cancelled"]
    category: str
    category_label: str | None = None
    priority: str
    title: str
    description: str
    photo_urls: list[str] = []
    property_title: str | None = None
    suburb: str | None = None
    state: str | None = None
    # Only once a visit is booked: the street address, the access notes and the tenant.
    address: str | None = None
    access_notes: str | None = None
    tenant_name: str | None = None
    owner_id: str | None = None
    owner_name: str | None = None
    appointment_at: dt.datetime | None = None
    estimated_duration_minutes: int | None = None
    appointment_note: str | None = None
    completed_at: dt.datetime | None = None
    completion_note: str | None = None
    # The tenant's 1 to 5, once they confirmed or rated the job.
    tenant_rating: int | None = None
    created_at: dt.datetime
    updated_at: dt.datetime
