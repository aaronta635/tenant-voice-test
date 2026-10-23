from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.owner_assistant import (
    OwnerAssistantAsk,
    OwnerAssistantConfirmOut,
    OwnerAssistantMessageOut,
    OwnerAssistantWorkspaceOut,
)
from app.services import owner_assistant as service

router = APIRouter(prefix="/me/owner-assistant", tags=["owner-assistant"])


@router.get("", response_model=OwnerAssistantWorkspaceOut)
def get_workspace(current: CurrentProfile = Depends(require_role("landlord"))):
    return service.workspace(current)


@router.post("/messages", response_model=OwnerAssistantMessageOut)
def ask_assistant(payload: OwnerAssistantAsk, current: CurrentProfile = Depends(require_role("landlord"))):
    # The model is the paid AI (R18): an unverified owner gets the rules' answer, with the refusal.
    return service.ask(current, payload.question, str(payload.request_id) if payload.request_id else None)


@router.post("/messages/{request_id}/confirm", response_model=OwnerAssistantConfirmOut)
def confirm_action(request_id: UUID, current: CurrentProfile = Depends(require_role("landlord"))):
    # Runs the action that answer proposed, exactly as saved; a verified owner only.
    return service.confirm(current, str(request_id))
