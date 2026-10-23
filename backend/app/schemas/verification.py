from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.documents import AccountVerificationOut, DocumentLinkOut, DocumentOut, RequirementOut

# The queue's role tabs (admin_verification.QUEUE_ROLES): the roles the shared functions review.
QueueRole = Literal["tenant", "landlord", "provider"]
# profile_documents.review_status (ProfileDocumentReviewStatus).
ReviewStatus = Literal["PENDING", "APPROVED", "REJECTED"]
Decision = Literal["APPROVED", "REJECTED"]


class ReviewDocumentOut(DocumentOut):
    # The version a decision names (DocumentDecisionIn.expected_updated_at).
    updated_at: datetime
    # Opens the file for a few minutes; None without a file Storage could sign.
    link: DocumentLinkOut | None = None


class MobileDocumentOut(BaseModel):
    """A document the mobile app keeps in users.metadata.mobile.verificationDocuments: shown, never decided."""

    key: str
    name: str
    mime_type: str | None = None
    # As the mobile app saved it (uploadedAt).
    uploaded_at: str | None = None
    # Whether the mobile app saved a file or a link for it.
    has_file: bool
    # Opens the file for a few minutes: a file in the owner's folder of profile-documents only.
    link: DocumentLinkOut | None = None


class VerificationItemOut(BaseModel):
    """One account in the queue, with its documents in the status asked for."""

    user_id: str
    full_name: str
    email: str | None = None
    # The web role; primary_role is the shared one it comes from.
    role: str
    primary_role: str | None = None
    account: AccountVerificationOut
    # What the role's verification needs, from all of the account's documents.
    requirements: list[RequirementOut]
    # Whether review_user_verification can approve it now: a PENDING account (a provider with a
    # service area and categories). approval_note says why not, where that helps.
    can_approve: bool
    approval_note: str | None = None
    documents: list[ReviewDocumentOut]
    # The mobile app's documents of an account not yet approved, read-only.
    mobile_documents: list[MobileDocumentOut] = []


class VerificationQueueOut(BaseModel):
    role: QueueRole
    status: ReviewStatus
    items: list[VerificationItemOut]
    total: int
    limit: int
    offset: int
    # Accounts with documents in this status, per role tab.
    counts: dict[str, int]
    # The mobile app's documents could not be read this time: the items show the website's only.
    mobile_unavailable: bool = False


def _required_reason(decision: str, reason: str | None, message: str) -> str | None:
    """A rejection's reason with its spacing tidied; an approval keeps none."""
    reason = " ".join((reason or "").split()) or None
    if decision != "REJECTED":
        return None
    if not reason:
        raise PydanticCustomError("reason_required", message)
    return reason


class DocumentDecisionIn(BaseModel):
    decision: Decision
    # Required to reject, and shown to the person.
    reason: str | None = Field(default=None, max_length=500)
    # The document's updated_at as the admin saw it: the decision applies to that version only.
    expected_updated_at: datetime

    @model_validator(mode="after")
    def reason_to_reject(self) -> "DocumentDecisionIn":
        self.reason = _required_reason(self.decision, self.reason, "Give a reason for rejecting this document.")
        return self


class DocumentDecisionOut(BaseModel):
    document: ReviewDocumentOut
    # The account as review_profile_document left it.
    account: AccountVerificationOut


class AccountDecisionIn(BaseModel):
    decision: Decision
    # Required to reject, and shown to the person.
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reason_to_reject(self) -> "AccountDecisionIn":
        self.reason = _required_reason(self.decision, self.reason, "Give a reason for rejecting this account.")
        return self
