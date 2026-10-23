from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditEntryOut(BaseModel):
    id: str
    actor_id: str | None = None
    actor_name: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    metadata: dict[str, Any] = {}
    created_at: datetime
