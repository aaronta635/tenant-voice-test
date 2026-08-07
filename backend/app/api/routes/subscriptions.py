from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, get_current_profile, get_optional_profile
from app.schemas.subscriptions import PlanOut, SubscriptionOut, SubscriptionSelect
from app.services import subscriptions as subscriptions_service

router = APIRouter(tags=["subscriptions"])


@router.get("/subscription-plans", response_model=list[PlanOut])
def list_plans(
    audience: str | None = None,
    current: CurrentProfile | None = Depends(get_optional_profile),
):
    return subscriptions_service.list_plans(current.id if current else None, audience)


@router.get("/me/subscription", response_model=SubscriptionOut | None)
def get_my_subscription(current: CurrentProfile = Depends(get_current_profile)):
    return subscriptions_service.get_my_subscription(current.id)


@router.put("/me/subscription", response_model=SubscriptionOut)
def select_plan(
    payload: SubscriptionSelect, current: CurrentProfile = Depends(get_current_profile)
):
    return subscriptions_service.select_plan(current.id, payload.plan_id)


@router.delete("/me/subscription", response_model=SubscriptionOut)
def cancel_subscription(current: CurrentProfile = Depends(get_current_profile)):
    return subscriptions_service.cancel(current.id)
