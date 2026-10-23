from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_recommendations import (
    RecommendationQuery, ProviderRecommendationsOut,
    RecommendationLocationQuery, RecommendationLocationsOut,
    RecommendationChatIn, RecommendationChatOut,
    WorkOpportunitiesOut, WorkOpportunitiesQuery,
)
from app.services import provider_recommendations as service

router = APIRouter(prefix="/me/recommendations/provider", tags=["recommendations"])


@router.get("/locations", response_model=RecommendationLocationsOut)
def suggest_locations(
    query: Annotated[RecommendationLocationQuery, Query()],
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    return service.suggest_locations(current, query)


@router.get("/opportunities", response_model=WorkOpportunitiesOut)
def list_work_opportunities(
    query: Annotated[WorkOpportunitiesQuery, Query()],
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    """Owners and landlords in the provider's areas, ranked on what their public profiles show."""
    return service.work_opportunities(current, query.limit)


@router.get("", response_model=ProviderRecommendationsOut)
def list_recommendations(
    query: Annotated[RecommendationQuery, Query()],
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    return service.recommend(current, query)


@router.post("/analyze", response_model=ProviderRecommendationsOut)
def analyze_recommendations(
    query: RecommendationQuery,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    return service.recommend(current, query, use_ai=True)


@router.post("/chat", response_model=RecommendationChatOut)
def chat_recommendations(
    payload: RecommendationChatIn,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    """Turn the provider's description into search criteria; never searches itself."""
    return service.chat(current, payload)
