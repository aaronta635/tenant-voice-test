from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials

from app.core.deps import CurrentProfile, bearer_scheme, get_optional_profile
from app.schemas.listing_views import ListingViewIn, ListingViewOut
from app.services import listing_views as listing_views_service

router = APIRouter(tags=["listing-views"])


@router.post("/properties/{property_id}/views", response_model=ListingViewOut)
def record_listing_view(
    property_id: str,
    request: Request,
    payload: ListingViewIn | None = None,
    viewer: CurrentProfile | None = Depends(get_optional_profile),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    """The listing page's beacon: one view per viewer, listing and Sydney day, kept only as a hash."""
    counted = listing_views_service.record_view(
        property_id,
        viewer,
        payload.visitor_id if payload else None,
        token_refused=credentials is not None and viewer is None,
        client_host=request.client.host if request.client else None,
    )
    # A view is no action on anyone's data, and the audit trail (AuditMiddleware)
    # would keep who opened which listing: leave it out.
    request.state.actor_id = None
    request.state.actor_role = None
    return {"counted": counted}
