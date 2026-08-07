from datetime import datetime

from pydantic import BaseModel


class ProfileOut(BaseModel):
    id: str
    role: str
    full_name: str
    # Resolved from auth.users — the profiles table does not duplicate it.
    email: str | None = None
    avatar_url: str | None = None
    phone: str | None = None
    location: str | None = None
    state: str | None = None
    postcode: str | None = None
    created_at: datetime
    updated_at: datetime


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    avatar_url: str | None = None
    phone: str | None = None
    location: str | None = None
    state: str | None = None
    postcode: str | None = None
