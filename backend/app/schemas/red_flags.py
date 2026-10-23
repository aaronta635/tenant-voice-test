from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# red_flag_rules.trigger_mode and .severity (ComplaintSeverity), red_flag_events.status (RedFlagStatus).
TriggerMode = Literal["TOTAL", "WINDOW"]
FlagSeverity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
FlagStatus = Literal["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]
FlagAction = Literal["acknowledge", "resolve", "dismiss"]


class RedFlagRuleOut(BaseModel):
    id: str
    # Unique; taken from the name when the rule was created, and never changed.
    rule_key: str
    name: str
    description: str = ""
    # Complaints about one property that raise a flag: all of them (TOTAL), or those in window_days (WINDOW).
    threshold_count: int
    trigger_mode: TriggerMode
    window_days: int
    severity: FlagSeverity
    is_active: bool
    created_at: datetime | None = None
    # The version an edit names.
    updated_at: datetime | None = None
    # Its OPEN or ACKNOWLEDGED flags, and every flag it raised.
    active_flags: int = 0
    total_flags: int = 0


class RedFlagRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    # The table's checks: 1 to 10000 complaints, a window of 1 to 3650 days.
    threshold_count: int = Field(default=3, ge=1, le=10000)
    trigger_mode: TriggerMode = "WINDOW"
    window_days: int | None = Field(default=30, ge=1, le=3650)
    severity: FlagSeverity = "HIGH"
    is_active: bool = True


class RedFlagRuleUpdate(BaseModel):
    """A rule's fields but its rule_key; null keeps a field."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    threshold_count: int | None = Field(default=None, ge=1, le=10000)
    trigger_mode: TriggerMode | None = None
    window_days: int | None = Field(default=None, ge=1, le=3650)
    severity: FlagSeverity | None = None
    # The version the admin edited (RedFlagRuleOut.updated_at).
    expected_updated_at: datetime


class RedFlagRuleActiveIn(BaseModel):
    is_active: bool
    reason: str | None = Field(default=None, max_length=500)


class EvaluationOut(BaseModel):
    rule_id: str
    # The flags this run opened (evaluate_red_flag_rule's count).
    created: int
    evaluated_at: datetime


class FlagComplaintOut(BaseModel):
    """The complaint that raised a flag."""

    id: str
    category_label: str
    status: str | None = None
    lodged_at: datetime | None = None


class FlagDecisionOut(BaseModel):
    """One admin decision on a flag, from evidence.decisions."""

    action: str | None = None
    from_status: str | None = None
    to_status: str | None = None
    actor_id: str | None = None
    actor_name: str | None = None
    note: str | None = None
    at: datetime | None = None


class RedFlagEventOut(BaseModel):
    id: str
    rule_id: str
    rule_name: str | None = None
    summary: str
    status: FlagStatus
    triggered_at: datetime
    # When it was resolved or dismissed.
    resolved_at: datetime | None = None
    property_id: str | None = None
    address: str | None = None
    # The property's newest listing (the web's property id) and its title.
    listing_id: str | None = None
    property_title: str | None = None
    complaint: FlagComplaintOut | None = None
    # What the database recorded when it raised the flag: details, complaintCount, thresholdCount,
    # triggerMode, windowDays, windowStart, evaluatedAt.
    evidence: dict
    # Oldest first.
    decisions: list[FlagDecisionOut]
    # What an admin may do with it now.
    actions: list[FlagAction]


class RedFlagEventPageOut(BaseModel):
    items: list[RedFlagEventOut]
    total: int
    limit: int
    offset: int


class FlagDecisionIn(BaseModel):
    # Required to resolve or dismiss.
    note: str | None = Field(default=None, max_length=1000)
    # The status the admin saw; the decision applies only while the flag still has it.
    expected_status: FlagStatus | None = None
