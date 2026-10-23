from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# profile_documents.review_status as the web reads it (maps_provider_core.web_document_status).
DocumentStatus = Literal["pending", "verified", "rejected"]
# A requirement with no document that could meet it is missing.
RequirementStatus = Literal["missing", "pending", "verified", "rejected"]
# metadata.visibility (app.services.documents): private, or shareable with
# the owners of the listings a tenant applies to.
Visibility = Literal["private", "applications"]
# users.verification_status as the web reads it (account_verification.web_status).
VerificationStatus = Literal["pending", "verified", "rejected"]
# What a tenant's OTHER document is, when it is one the profile completion
# counts (metadata.web_type, app.services.documents.KINDS).
DocumentKind = Literal["payslip", "employment_contract"]


class DocumentOut(BaseModel):
    id: str
    # A ProfileDocumentType value.
    document_type: str
    label: str
    status: DocumentStatus
    rejection_reason: str | None = None
    # The uploaded file's own name; None when the web did not store it.
    file_name: str | None = None
    has_file: bool
    # Whether GET .../link can open it: a file the web stored for its owner.
    can_open: bool
    visibility: Visibility
    # A tenant's OTHER document marked as a payslip or a contract.
    kind: DocumentKind | None = None
    submitted_at: datetime | None = None
    verified_at: datetime | None = None


class DocumentKindOut(BaseModel):
    value: DocumentKind
    label: str


class DocumentTypeOut(BaseModel):
    type: str
    label: str
    description: str
    group: str
    group_label: str
    # Always false: a person keeps one document of each type (UNIQUE (user_id, document_type)).
    repeatable: bool
    # A type the account's verification requires.
    required: bool
    # What a document of this type may be marked as: a tenant's OTHER only.
    kinds: list[DocumentKindOut] = []
    # An earlier type the person still holds (verification_rules.EARLIER_DOCUMENT_TYPES): kept, opened,
    # replaced and deleted, but no new one is uploaded and it does not count for verification.
    kept_only: bool = False


class RequirementOut(BaseModel):
    key: str
    label: str
    # The document type that meets it, once approved.
    types: list[str]
    status: RequirementStatus


class AccountVerificationOut(BaseModel):
    """The account's verification (users.verification_status), which the verified badge reads."""

    status: VerificationStatus
    # Why, when rejected: the rejected requirements, or an admin's reason.
    rejection_reason: str | None = None
    approved_at: datetime | None = None
    # An admin rejected the account itself (review_user_verification), not
    # through a document: it is back in review once a document its
    # verification needs is replaced or deleted.
    account_rejected: bool = False


class DocumentsOut(BaseModel):
    role: str
    # Whether documents may be shared with the owners of listings applied to.
    can_share: bool
    types: list[DocumentTypeOut]
    requirements: list[RequirementOut]
    # Every required type has an approved document, which review_profile_document
    # approves the account on.
    requirements_met: bool
    account: AccountVerificationOut
    documents: list[DocumentOut]


class DocumentUpdate(BaseModel):
    visibility: Visibility | None = None
    label: str | None = Field(default=None, max_length=120)
    # A null takes the mark off.
    kind: DocumentKind | None = None


class DocumentLinkOut(BaseModel):
    url: str
    # Seconds the link works for.
    expires_in: int
