from datetime import datetime

from pydantic import BaseModel

STATUSES = ["pending", "accepted", "declined"]


class ConnectionCreate(BaseModel):
    addressee_id: str


class ConnectionUpdate(BaseModel):
    status: str


class ConnectionOut(BaseModel):
    id: str
    requester_id: str
    addressee_id: str
    status: str
    created_at: datetime
    responded_at: datetime | None = None
    # Resolved counterpart (the other profile in the pair).
    person_id: str
    person_name: str
    person_role: str
    person_avatar_url: str | None = None
    person_location: str | None = None
    direction: str  # 'incoming' | 'outgoing'


class ProfileSearchOut(BaseModel):
    id: str
    full_name: str
    role: str
    avatar_url: str | None = None
    location: str | None = None
    state: str | None = None
    connection_status: str | None = None
