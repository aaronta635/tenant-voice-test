"""Listing auto-fill (tracker R32): a listing read from a link or a PDF, for the create-listing wizard.

Nothing here is saved. services/listing_import.py reads the source and
answers these fields; the wizard puts the ones the owner keeps into its
draft, and only publishing the listing writes it (R25).

Every field comes back with where its value came from: found (the source
states it), inferred (worked out from what it states, or read by the model)
or missing (the owner types it). evidence is the snippet it came from, so
the owner can check it.
"""

from datetime import date
from typing import Generic, Literal, TypeVar, get_args

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.gates import GateRefusalOut

FieldSource = Literal["found", "inferred", "missing"]
# Where a value was read: the page's schema.org JSON-LD, its OpenGraph and
# meta tags (and <title>), the text rules on the page or PDF text, the PDF's
# own properties, or the model.
FieldVia = Literal["structured_data", "page_meta", "text", "pdf_metadata", "ai"]
ImportKind = Literal["url", "pdf", "sample"]
# not_requested: the owner did not ask for the model. The rest as in
# matching, plus not_needed: every field was already found, so it was not asked.
AiStatus = Literal[
    "not_requested", "not_configured", "not_needed", "applied", "unavailable", "cooldown", "verification_required",
]
# The fields an import fills: the wizard's, but the photos. Pets and the floor
# area become features when the owner keeps them.
FieldName = Literal[
    "title", "description", "address", "suburb", "state", "postcode", "property_type", "bedrooms", "bathrooms",
    "price", "bond", "lease_term", "available_from", "amenities", "pets_allowed", "floor_area",
]
FIELD_NAMES: tuple[str, ...] = get_args(FieldName)

Value = TypeVar("Value")


class ImportedField(BaseModel, Generic[Value]):
    value: Value | None = None
    source: FieldSource = "missing"
    # The snippet the value came from, as the source has it; None when missing.
    evidence: str | None = None
    via: FieldVia | None = None


class ImportedFields(BaseModel):
    title: ImportedField[str]
    description: ImportedField[str]
    # The street line, as the wizard's "Property address" holds it.
    address: ImportedField[str]
    suburb: ImportedField[str]
    state: ImportedField[str]
    postcode: ImportedField[str]
    # The wizard's label: Apartment, House, Townhouse, Unit, Studio or Duplex.
    property_type: ImportedField[str]
    bedrooms: ImportedField[int]
    bathrooms: ImportedField[int]
    # Dollars a week.
    price: ImportedField[float]
    bond: ImportedField[float]
    # "12 months".
    lease_term: ImportedField[str]
    available_from: ImportedField[date]
    amenities: ImportedField[list[str]]
    pets_allowed: ImportedField[bool]
    # Square metres.
    floor_area: ImportedField[float]


class ImportCounts(BaseModel):
    found: int
    inferred: int
    missing: int


class ListingImportOut(BaseModel):
    kind: ImportKind
    # What the owner sees as the source: the site's host, the PDF's name, or "Sample listing".
    source_label: str
    # The page read, after any redirect; None for a PDF or the sample.
    source_url: str | None = None
    # The sample offered when a site refuses to be read (tracker assumption #7): not the owner's listing.
    demo: bool = False
    fields: ImportedFields
    counts: ImportCounts
    ai_status: AiStatus
    # What happened with the model, in words; None when it was not asked for.
    message: str | None = None
    # Why the model was not asked, with ai_status verification_required; None otherwise.
    verification: GateRefusalOut | None = None


class ListingImportUrlIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=2048)
    # Also let the model read the page for the fields the rules left missing (paid AI, R18).
    use_ai: bool = False


class AiFieldAnswer(BaseModel):
    """One field the model filled; services/listing_import.py checks it against the source."""

    model_config = ConfigDict(extra="forbid")

    value: str | int | float | bool | list[str]
    evidence: str = Field(min_length=1, max_length=400)


class AiExtraction(BaseModel):
    """The model's whole answer: the fields it filled, by name, and nothing else."""

    model_config = ConfigDict(extra="forbid")

    fields: dict[FieldName, AiFieldAnswer] = Field(default_factory=dict)
