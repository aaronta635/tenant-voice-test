from datetime import datetime

from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class ReviewReply(BaseModel):
    provider_reply: str


class ReviewOut(BaseModel):
    id: str
    booking_id: str | None = None
    provider_id: str
    client_id: str
    rating: int
    comment: str | None = None
    provider_reply: str | None = None
    replied_at: datetime | None = None
    is_flagged: bool
    created_at: datetime
    # Resolved by the service layer for the reviews management screen.
    client_name: str | None = None
    client_avatar_url: str | None = None
    service_title: str | None = None
    location: str | None = None
