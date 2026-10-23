"""Tenant scorecards (tracker R43): a tenant asks an owner or agent to rate them.

The owner rates the seven items of the Owner/Agent Tenant Scorecard from 1
to 5 and may add a comment (tracker assumption #20; the reference's
onboarding step 14), or declines. Both of them read the result; the tenant
chooses whether it counts on their public profile. The rows are
web.scorecard_requests (supabase/shared/0004_scorecards.sql).
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool

ScorecardStatus = Literal["pending", "completed", "declined", "cancelled"]
# Where the tenant knows the owner from: a lease with them, current or past,
# or an application the owner (or the agent managing the home) approved.
ScorecardSource = Literal["agreement", "application"]
Rating = Annotated[int, Field(strict=True, ge=1, le=5)]

# The Owner/Agent Tenant Scorecard, in its order: (answers key, question).
# docs/shared-db.md ("Scorecards") lists the same keys, which the web's form
# reads too (frontend/app/lib/scorecards.ts).
ITEMS: tuple[tuple[str, str], ...] = (
    ("paid_rent_on_time", "Paid rent on time"),
    ("looked_after_property", "Looked after the property"),
    ("communicated_respectfully", "Communicated respectfully"),
    ("followed_lease_conditions", "Followed lease conditions"),
    ("cooperated_with_inspections", "Cooperated with inspections"),
    ("left_property_in_good_condition", "Left property in good condition"),
    ("would_rent_again", "Would you rent to this tenant again?"),
)
COMMENT_LENGTH = 1000
REASON_LENGTH = 500


class ScorecardRequestCreate(BaseModel):
    """The owner or agent to ask, and the home (properties.id) the tenancy was at."""

    model_config = ConfigDict(extra="forbid")

    owner_user_id: UUID
    property_id: UUID


class ScorecardAnswers(BaseModel):
    """A rating from 1 to 5 for every item, and nothing else."""

    model_config = ConfigDict(extra="forbid")

    paid_rent_on_time: Rating
    looked_after_property: Rating
    communicated_respectfully: Rating
    followed_lease_conditions: Rating
    cooperated_with_inspections: Rating
    left_property_in_good_condition: Rating
    would_rent_again: Rating


class ScorecardSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    answers: ScorecardAnswers
    # For the tenant: optional, as on the reference's scorecard.
    comment: str | None = Field(default=None, max_length=COMMENT_LENGTH)


class ScorecardDecline(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # For the tenant, such as "I only managed the building, not your lease."
    reason: str | None = Field(default=None, max_length=REASON_LENGTH)


class ScorecardVisibility(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visible_on_profile: StrictBool


class ScorecardAnswerOut(BaseModel):
    key: str
    label: str
    rating: int


class ScorecardRequestOut(BaseModel):
    """One request, as both its tenant and its owner read it."""

    id: str
    status: ScorecardStatus
    tenant_id: str
    tenant_name: str
    owner_id: str
    owner_name: str
    # The home: its properties.id, and the street line both of them know it by.
    property_id: str
    property_label: str
    suburb: str | None = None
    state: str | None = None
    requested_at: datetime
    # When it stopped waiting: submitted, declined or cancelled. Null while pending.
    decided_at: datetime | None = None
    # Once completed: every rating in the scorecard's order, their average and the comment.
    answers: list[ScorecardAnswerOut] = []
    average: float | None = None
    comment: str | None = None
    # The owner's reason for declining, when they gave one.
    reason: str | None = None
    # The tenant's choice, which only they read (null for the owner); it counts on
    # the public profile only once completed.
    visible_on_profile: bool | None = None


class ScorecardRecipientOut(BaseModel):
    """Someone the tenant may ask for a scorecard, for one home."""

    owner_id: str
    owner_name: str
    # "Landlord" or "Agent".
    owner_role_label: str
    property_id: str
    property_label: str
    suburb: str | None = None
    state: str | None = None
    source: ScorecardSource
    # The request already waiting for their answer: another is refused until it is answered.
    pending_request_id: str | None = None
    # The scorecard they already completed for this home: one tenancy has one, so none is asked again.
    completed_request_id: str | None = None
    # After a decline or a cancel, when the tenant may ask them about this home again; null when they may now.
    ask_again_from: datetime | None = None
