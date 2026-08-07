from datetime import datetime

from pydantic import BaseModel


class SavedProviderCreate(BaseModel):
    provider_id: str


class SavedProviderOut(BaseModel):
    id: str
    user_id: str
    provider_id: str
    created_at: datetime
