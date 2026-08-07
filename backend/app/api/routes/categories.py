from fastapi import APIRouter

from app.schemas.categories import CategoryOut
from app.services import categories as categories_service

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories():
    return categories_service.list_categories()


@router.get("/{slug}", response_model=CategoryOut)
def get_category(slug: str):
    return categories_service.get_category(slug)
