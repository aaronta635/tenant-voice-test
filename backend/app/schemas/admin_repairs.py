"""Repairs in the admin console (services/admin_repairs.py, tracker R40).

A repair is a maintenance_work_orders row and the complaint it hangs off
(services/maintenance.py). Its status is the web's (MaintenanceOut's), read
from the work order's; work_status is the work order's own, which a decision
names as the one the admin saw.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.admin_complaints import PartyOut

# The web's repair statuses (shared_map.MAINT_TO_WEB) and priorities (complaints.severity behind them).
RepairStatus = Literal["open", "in_progress", "resolved", "cancelled"]
RepairPriority = Literal["low", "normal", "urgent"]
# cancel: the job will not be done (CANCELLED; its case CLOSED). close: it is over (COMPLETED; its case RESOLVED).
RepairAction = Literal["cancel", "close"]


class RepairDecisionOut(BaseModel):
    # cancelled or closed.
    decision: str | None = None
    reason: str | None = None
    actor: PartyOut | None = None
    created_at: datetime


class AdminRepairOut(BaseModel):
    id: str
    title: str
    description: str
    category: str
    priority: RepairPriority
    status: RepairStatus
    # maintenance_work_orders.status as stored, such as ASSIGNED or SCHEDULED.
    work_status: str
    property_title: str | None = None
    # The listing's suburb and state: the street stays with the parties.
    area: str | None = None
    tenant: PartyOut | None = None
    owner: PartyOut | None = None
    provider: PartyOut | None = None
    # The visit the assigned provider booked, if any.
    appointment_at: datetime | None = None
    resolution_note: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    # What an admin may do to it now: cancel, close.
    actions: list[RepairAction]
    last_decision: RepairDecisionOut | None = None


class AdminRepairPageOut(BaseModel):
    items: list[AdminRepairOut]
    total: int
    limit: int
    offset: int


class RepairDecisionIn(BaseModel):
    action: RepairAction
    # Required: kept with the decision, in the case timeline, and sent to the tenant, owner and provider.
    reason: str = Field(default="", max_length=500)
    # The work_status the admin saw; the decision applies only while the repair still has it.
    expected_status: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def reason_required(self):
        self.reason = " ".join(self.reason.split())
        if not self.reason:
            raise PydanticCustomError("reason_required", "Give a reason. It is kept with the decision.")
        return self
