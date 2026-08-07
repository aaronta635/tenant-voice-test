from datetime import datetime

from pydantic import BaseModel


class TransactionOut(BaseModel):
    id: str
    provider_id: str
    booking_id: str | None = None
    type: str
    amount: float
    description: str | None = None
    created_at: datetime
    # Resolved by the service layer for the finance table.
    client_name: str | None = None
    client_avatar_url: str | None = None
    service_title: str | None = None
    booking_status: str | None = None
