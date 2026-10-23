from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.conversations import (
    ConversationCreate,
    ConversationOut,
    MessageCreate,
    MessageOut,
    RentalConversationCreate,
)
from app.services import conversations as conversations_service

# A thread's members are its conversation_participants rows, keyed by users.id
# (a provider's id is its owner's), so the caller's own id is all a route needs.
router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(payload: ConversationCreate, current: CurrentProfile = Depends(get_current_profile)):
    return conversations_service.create_conversation(current.id, payload.model_dump())


@router.post("/rental", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_rental_conversation(
    payload: RentalConversationCreate, current: CurrentProfile = Depends(get_current_profile)
):
    return conversations_service.create_rental_conversation(
        current.id, current.role, payload.model_dump()
    )


@router.get("", response_model=list[ConversationOut])
def list_conversations(current: CurrentProfile = Depends(get_current_profile)):
    return conversations_service.list_conversations(current.id)


@router.get("/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return conversations_service.get_conversation(conversation_id, current.id)


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(conversation_id: str, current: CurrentProfile = Depends(get_current_profile)):
    return conversations_service.list_messages(conversation_id, current.id)


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def create_message(
    conversation_id: str, payload: MessageCreate, current: CurrentProfile = Depends(get_current_profile)
):
    return conversations_service.create_message(conversation_id, current.id, payload.model_dump())


@router.post("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(conversation_id: str, current: CurrentProfile = Depends(get_current_profile)):
    conversations_service.mark_read(conversation_id, current.id)
