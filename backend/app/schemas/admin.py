from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.admin_providers import AdminProviderOut
from app.schemas.documents import AccountVerificationOut, DocumentOut

# users.status (AccountStatus).
AccountStatus = Literal["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "DEACTIVATED"]
# The statuses an admin sets (admin_users.SETTABLE_STATUSES).
SettableStatus = Literal["ACTIVE", "SUSPENDED", "DEACTIVATED"]
# The users list's role filter: web roles, as admin_users.ROLE_FILTERS maps them.
RoleFilter = Literal["tenant", "landlord", "service_provider", "admin", "officer"]


class AdminMeOut(BaseModel):
    id: str
    full_name: str
    email: str | None = None


class RoleCountOut(BaseModel):
    role: str
    total: int
    active: int
    pending_verification: int
    suspended: int
    deactivated: int


class AdminOverviewOut(BaseModel):
    users_total: int
    closed_accounts: int
    roles: list[RoleCountOut]
    pending_documents: int
    pending_document_people: int


class AdminUserOut(BaseModel):
    id: str
    full_name: str
    email: str | None = None
    # The web role; primary_role is the shared one it comes from.
    role: str
    primary_role: str | None = None
    status: AccountStatus
    verification_status: str | None = None
    created_at: datetime | None = None
    pending_documents: int = 0


class AdminUserPageOut(BaseModel):
    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int


class RoleAssignmentOut(BaseModel):
    role: str
    is_primary: bool


class StatusChangeOut(BaseModel):
    from_status: str | None = None
    to_status: str | None = None
    reason: str | None = None
    actor_id: str | None = None
    actor_name: str | None = None
    created_at: datetime


class AdminUserDetailOut(AdminUserOut):
    phone: str | None = None
    updated_at: datetime | None = None
    closed_at: datetime | None = None
    roles: list[RoleAssignmentOut]
    documents: list[DocumentOut]
    verification: AccountVerificationOut
    status_history: list[StatusChangeOut]
    # Why this admin may not change the status (their own or a staff
    # account, or a closed one); None when they may.
    status_locked: str | None = None
    # A provider's marketplace state and open jobs; None for other accounts.
    provider: AdminProviderOut | None = None
    # On a status change's answer: how many people this change sent a notice
    # to (the clients of a provider's upcoming bookings). None on a read.
    notified: int | None = None


class StatusChangeIn(BaseModel):
    status: SettableStatus
    # Required unless the account is being made active again.
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reason_unless_active(self) -> "StatusChangeIn":
        self.reason = " ".join((self.reason or "").split()) or None
        if self.status != "ACTIVE" and not self.reason:
            raise PydanticCustomError("reason_required", "Give a reason for suspending or deactivating an account.")
        return self
