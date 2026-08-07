from datetime import datetime

from pydantic import BaseModel


class VerificationDocumentCreate(BaseModel):
    type: str
    label: str | None = None
    document_url: str


class VerificationDocumentUpdate(BaseModel):
    label: str | None = None
    document_url: str | None = None


class VerificationDocumentOut(BaseModel):
    id: str
    provider_id: str
    type: str
    label: str | None = None
    document_url: str | None = None
    status: str
    verified_at: datetime | None = None
    created_at: datetime
