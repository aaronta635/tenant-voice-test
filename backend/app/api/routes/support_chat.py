from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.support_chat import SupportChatIn, SupportChatOut
from app.services import support_chat as service

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/chat", response_model=SupportChatOut)
def ask_support(
    payload: SupportChatIn,
    current: CurrentProfile = Depends(require_role(*service.ROLES)),
):
    """Answer a question about using TenantVoice from its help pages; reads and changes no business data."""
    return service.answer(current, payload)
