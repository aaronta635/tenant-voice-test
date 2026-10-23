from datetime import date, datetime

from pydantic import BaseModel, Field

STATUSES = ["draft", "issued", "paid", "void"]
ALLOWED_TRANSITIONS = {
    "draft": {"issued", "void"},
    "issued": {"paid", "void"},
    "paid": set(),
    "void": set(),
}


class InvoiceCreate(BaseModel):
    booking_id: str | None = None
    number: str = Field(min_length=1, max_length=40)
    amount: float = Field(ge=0, le=1_000_000)
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


class InvoiceParty(BaseModel):
    name: str | None = None
    abn: str | None = None
    location: str | None = None
    phone: str | None = None


class InvoiceLine(BaseModel):
    description: str
    detail: str | None = None
    amount: float


class InvoiceDocumentOut(InvoiceOut):
    """Everything a printable invoice needs, resolved server-side."""

    provider: InvoiceParty
    client: InvoiceParty
    lines: list[InvoiceLine]
