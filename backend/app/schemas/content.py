from datetime import datetime

from pydantic import BaseModel


class FaqOut(BaseModel):
    id: str
    audience: str
    question: str
    answer: str
    sort_order: int = 0


class SupportContactOut(BaseModel):
    email: str
    phone: str


class PlatformStatsOut(BaseModel):
    verified_providers: int
    jobs_completed: int
    average_rating: float
    satisfaction_pct: int
    review_count: int
    category_count: int


class NotificationOut(BaseModel):
    id: str
    user_id: str
    category: str
    title: str
    body: str | None = None
    link_href: str | None = None
    is_read: bool
    created_at: datetime

