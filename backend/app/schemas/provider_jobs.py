"""Job requests sent to a provider from the mobile app (mobile_ai_service_jobs, tracker R33)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

JobStatus = Literal["pending", "accepted", "declined", "in_progress", "completed", "cancelled"]


class ProviderJobStatusIn(BaseModel):
    # The provider's moves (mobile_ai_provider_job): accept or decline a pending job, start an
    # accepted one, complete one in progress.
    status: Literal["accepted", "declined", "in_progress", "completed"]


class ProviderJobOut(BaseModel):
    id: str
    title: str
    description: str | None = None
    status: JobStatus
    owner_id: str | None = None
    owner_name: str | None = None
    property_title: str | None = None
    listing_id: str | None = None
    # Written by assigning a repair: its visit is booked from the repairs page.
    from_repair: bool = False
    created_at: dt.datetime | None = None
    # What the provider may move it to now.
    next_statuses: list[Literal["accepted", "declined", "in_progress", "completed"]] = []
