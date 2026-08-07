from datetime import datetime

from pydantic import BaseModel


class PlanOut(BaseModel):
    id: str
    code: str
    name: str
    audience: str
    price: float
    billing_period: str
    description: str | None = None
    features: list[str] = []
    is_popular: bool = False
    sort_order: int = 0
    is_current: bool = False


class SubscriptionSelect(BaseModel):
    plan_id: str


class SubscriptionOut(BaseModel):
    id: str
    user_id: str
    plan_id: str
    status: str
    started_at: datetime
    renews_at: datetime | None = None
    plan: PlanOut | None = None
