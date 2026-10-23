from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.admin_complaints import PartyOut

# admin: the shared mobile_admin_audit_entries; web: the web's audit_log.
ActivityLog = Literal["admin", "web"]


class ActivityEntryOut(BaseModel):
    id: str
    log: ActivityLog
    actor: PartyOut | None = None
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    # The shared log's summary, or a web request's method and path.
    summary: str | None = None
    # The entry's plain metadata values, such as a reason or a status.
    details: dict[str, Any] = {}
    created_at: datetime


class ActivityPageOut(BaseModel):
    log: ActivityLog
    items: list[ActivityEntryOut]
    total: int
    limit: int
    offset: int

