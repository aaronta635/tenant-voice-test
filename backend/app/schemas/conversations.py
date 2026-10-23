from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ConversationCreate(BaseModel):
    """Marketplace thread: client <-> service provider."""

    provider_id: str
    client_id: str | None = None
    booking_id: str | None = None
    subject: str | None = None


class RentalConversationCreate(BaseModel):
    """Rental / network thread (see docs/messaging-plan.md).

    Property-scoped rental chat uses property_id / owner_id / tenant_id.
    Network DMs between any accepted connection can pass peer_id instead.
    """

    property_id: str | None = None
    owner_id: str | None = None
    tenant_id: str | None = None
    peer_id: str | None = None
    subject: str | None = None
    body: str | None = None


class BookingSummary(BaseModel):
    id: str
    status: str
    service_title: str | None = None
    scheduled_date: str | None = None
    scheduled_time: str | None = None
    property_address: str | None = None
    price: float | None = None


class ConversationOut(BaseModel):
    id: str
    kind: str  # 'marketplace' | 'rental'
    client_id: str | None = None
    provider_id: str | None = None
    owner_id: str | None = None
    tenant_id: str | None = None
    property_id: str | None = None
    booking_id: str | None = None
    subject: str | None = None
    last_message_at: datetime | None = None
    created_at: datetime
    # Resolved for the thread list.
    counterpart_id: str | None = None
    counterpart_name: str | None = None
    counterpart_role: str | None = None
    counterpart_avatar_url: str | None = None
    context: str | None = None
    last_message: str | None = None
    last_message_sender_id: str | None = None
    unread_count: int = 0
    booking: BookingSummary | None = None


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=4000)
    # The path (or URL) /uploads/message-attachment returned. The key is
    # stored; responses carry a short-lived signed URL for it.
    attachment_url: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _not_empty(self):
        self.body = self.body.strip()
        if not self.body and not self.attachment_url:
            raise ValueError("Write a message or attach a file")
        return self


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    sender_name: str | None = None
    body: str
    attachment_url: str | None = None
    is_read: bool
    created_at: datetime
