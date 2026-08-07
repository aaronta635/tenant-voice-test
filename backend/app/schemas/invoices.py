from datetime import date, datetime

from pydantic import BaseModel

STATUSES = ["draft", "issued", "paid", "void"]
ALLOWED_TRANSITIONS = {
    "draft": {"issued", "void"},
    "issued": {"paid", "void"},
    "paid": set(),
    "void": set(),
}


class InvoiceCreate(BaseModel):
    booking_id: str | None = None
    number: str
    amount: float
    due_date: date | None = None
    document_url: str | None = None


class InvoiceUpdate(BaseModel):
    status: str | None = None
    due_date: date | None = None
    document_url: str | None = None


class InvoiceOut(BaseModel):
    id: str
    provider_id: str
    booking_id: str | None = None
    number: str
    amount: float
    status: str
    issued_at: datetime | None = None
    due_date: date | None = None
    document_url: str | None = None
    created_at: datetime
