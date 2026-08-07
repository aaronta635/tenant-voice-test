from datetime import date, datetime

from pydantic import BaseModel

STATUSES = ["new", "reviewing", "approved", "declined"]


class ApplicationCreate(BaseModel):
    property_id: str
    annual_income: float | None = None
    move_in_date: date | None = None
    rent_offered: float | None = None
    has_pets: bool = False
    message: str | None = None


class ApplicationUpdate(BaseModel):
    status: str | None = None
    shortlisted: bool | None = None
    tenant_score: float | None = None


class ApplicationOut(BaseModel):
    id: str
    property_id: str
    tenant_id: str
    status: str
    annual_income: float | None = None
    move_in_date: date | None = None
    rent_offered: float | None = None
    tenant_score: float | None = None
    shortlisted: bool
    has_pets: bool
    message: str | None = None
    created_at: datetime
    updated_at: datetime
    # Populated only on the landlord-facing endpoints (list/update) so an owner
    # can see who applied. None on the tenant's own-applications endpoint.
    tenant_name: str | None = None
    tenant_phone: str | None = None
