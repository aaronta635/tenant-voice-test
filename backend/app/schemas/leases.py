"""Lease drafts, their PDF and the parties' typed-name signatures (tracker R26)."""

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

# rent_agreements.rent_frequency (its CHECK).
RentFrequency = Literal["WEEKLY", "FORTNIGHTLY", "MONTHLY"]
# Where a lease is, from its rows (services/leases.stage_of):
# draft: no PDF yet; review: the tenant reviews the latest PDF; confirmed: the
# tenant confirmed the terms; tenant_signed: the owner signs next; signed:
# both signed the latest PDF, the owner activates it; active, ended, cancelled.
LeaseStage = Literal["draft", "review", "confirmed", "tenant_signed", "signed", "active", "ended", "cancelled"]
ViewerRole = Literal["tenant", "owner"]

# The rent the shared function accepts (mobile_create_rent_agreement_draft).
MAX_RENT = Decimal("9999999999.99")
MAX_BOND = Decimal("10000000")
SHA256 = r"^[a-f0-9]{64}$"


def _block(value: str | None) -> str | None:
    """Free text as the PDF prints it: each line's spaces collapsed, at most one blank line in a row; None if blank."""
    if value is None:
        return None
    text = "\n".join(" ".join(line.split()) for line in value.replace("\r\n", "\n").split("\n")).strip()
    return re.sub(r"\n{3,}", "\n\n", text) or None


def _title(value: str) -> str:
    title = " ".join(value.split())
    if not 3 <= len(title) <= 120:
        raise ValueError("Give the lease a title of 3 to 120 characters.")
    return title


def _typed_name(value: str) -> str:
    """A signer's typed name: inner whitespace collapsed; 2 to 160 characters, as the signature tables' CHECKs."""
    name = " ".join(value.split())
    if not 2 <= len(name) <= 160:
        raise ValueError("Type your full name (2 to 160 characters).")
    return name


TypedName = Annotated[str, Field(max_length=400), AfterValidator(_typed_name)]
Text = Annotated[str | None, AfterValidator(_block)]


class LeaseDraftCreate(BaseModel):
    """The agreed terms an owner drafts a lease with, for one of their approved applications."""

    model_config = ConfigDict(extra="forbid")

    application_id: str = Field(max_length=64)
    rent_amount: Decimal = Field(gt=0, le=MAX_RENT, decimal_places=2)
    rent_frequency: RentFrequency
    start_date: date
    first_due_date: date
    end_date: date | None = None

    @field_validator("rent_frequency", mode="before")
    @classmethod
    def _upper(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _dates(self):
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("The end date cannot be before the start date.")
        return self


class LeaseDocumentForm(BaseModel):
    """The guided lease form: what the PDF says beyond the agreement's own terms, parties and premises."""

    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, Field(max_length=400), AfterValidator(_title)] = "Residential tenancy agreement"
    bond_amount: Decimal | None = Field(default=None, ge=0, le=MAX_BOND, decimal_places=2)
    payment_details: Text = Field(default=None, max_length=500)
    max_occupants: int | None = Field(default=None, ge=1, le=20)
    pets_allowed: bool | None = None
    utilities: Text = Field(default=None, max_length=1000)
    special_conditions: Text = Field(default=None, max_length=4000)


class LeaseDocumentSend(LeaseDocumentForm):
    """The form again, with the SHA-256 of the preview the owner looked at: the PDF sent must be that one."""

    preview_sha256: str = Field(pattern=SHA256)


class LeasePreviewOut(BaseModel):
    sha256: str
    filename: str
    size: int
    pdf_base64: str


class LeaseConfirm(BaseModel):
    """The tenant confirms the terms of the PDF they reviewed (its id): a newer one must be reviewed first."""

    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(max_length=64)


class LeaseTenantSign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(max_length=64)
    signer_name: TypedName
    # The signer ticked the consent statement the lease showed them.
    agree: Literal[True]


class LeaseOwnerSign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signer_name: TypedName
    agree: Literal[True]


class LeaseParty(BaseModel):
    id: str
    name: str


class LeaseDocumentOut(BaseModel):
    """The latest PDF: the only one either party can open, review or sign."""

    id: str
    filename: str
    # 1 for the first PDF; each new one the owner sends counts up.
    version: int
    created_at: datetime


class LeaseSignatureOut(BaseModel):
    signer_name: str
    signed_at: datetime
    document_id: str
    document_sha256: str
    consent_version: str


class LeaseActions(BaseModel):
    """What the viewer can do next; the server checks each again when it is asked."""

    send_document: bool = False
    confirm: bool = False
    sign: bool = False
    owner_sign: bool = False
    activate: bool = False


class LeaseConsent(BaseModel):
    """The statement the viewer agrees to when they sign, and its version; the server stores its own copy."""

    text: str
    version: str


class LeaseOut(BaseModel):
    id: str
    application_id: str
    listing_id: str
    title: str
    address: str | None = None
    # The listing's bond, which the guided lease form starts from.
    bond_amount: float | None = None
    tenant: LeaseParty
    owner: LeaseParty
    rent_amount: float
    rent_frequency: str
    currency: str
    start_date: date
    end_date: date | None = None
    first_due_date: date
    # rent_agreements.status, lower case: draft, active, ended or cancelled.
    status: str
    stage: LeaseStage
    tenant_confirmed_at: datetime | None = None
    activated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    document: LeaseDocumentOut | None = None
    tenant_signature: LeaseSignatureOut | None = None
    owner_signature: LeaseSignatureOut | None = None
    viewer_role: ViewerRole
    actions: LeaseActions
    consent: LeaseConsent | None = None


class LeaseCandidateOut(BaseModel):
    """An owner's approved application that has no lease yet, with what the draft form starts from."""

    application_id: str
    listing_id: str
    title: str
    address: str | None = None
    tenant: LeaseParty
    offer_weekly_rent: float | None = None
    move_in_date: date | None = None
    bond_amount: float | None = None
    lease_term_months: int | None = None
    approved_at: datetime | None = None
