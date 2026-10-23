from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_suggestions import ProviderSuggestionsOut, ProviderSuggestionsQuery
from app.services import provider_ranking as service

# The caller's own suggestions only: an owner names one of their own properties, a tenant none.
router = APIRouter(prefix="/me/provider-suggestions", tags=["provider suggestions"])


@router.get("", response_model=ProviderSuggestionsOut)
def provider_suggestions(
    query: Annotated[ProviderSuggestionsQuery, Query()],
    current: CurrentProfile = Depends(require_role("landlord", "tenant")),
):
    """Listed providers ranked by where they work, their rating and their price, each with its reasons."""
    return service.suggestions(current, query.category, query.property_id, query.limit)
