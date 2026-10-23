from datetime import datetime

from typing import Literal

from pydantic import BaseModel, Field


DocumentType = Literal["id", "licence", "insurance", "abn", "other"]


class VerificationDocumentCreate(BaseModel):
    type: DocumentType
    label: str | None = Field(default=None, max_length=120)
    # The path (or URL) /uploads/verification-document returned. The key is
    # stored; responses carry a short-lived signed URL for it.
    document_url: str | None = Field(default=None, max_length=2000)


class VerificationDocumentUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    document_url: str | None = Field(default=None, max_length=2000)


class VerificationDocumentOut(BaseModel):
    id: str
    provider_id: str
    type: str
    label: str | None = None
    document_url: str | None = None
    status: str
    # Why an admin rejected it; None unless the status is rejected.
    rejection_reason: str | None = None
    verified_at: datetime | None = None
    created_at: datetime
