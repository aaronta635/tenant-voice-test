from fastapi import APIRouter

from app.schemas.complaints import ComplaintCategoryOut
from app.services import complaint_categories

router = APIRouter(prefix="/complaint-categories", tags=["complaints"])


@router.get("", response_model=list[ComplaintCategoryOut])
def list_complaint_categories():
    """The categories a complaint form offers: the active ones admins manage, by name."""
    return complaint_categories.form_categories()
