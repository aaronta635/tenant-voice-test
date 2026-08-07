from pydantic import BaseModel


class MonthlyPoint(BaseModel):
    month: str          # 'YYYY-MM'
    label: str          # 'Jan'
    amount: float


class ProviderDashboardOut(BaseModel):
    active_bookings: int
    new_enquiries: int
    due_this_week: int
    completed_bookings: int
    month_earnings: float
    previous_month_earnings: float
    month_change_pct: float | None = None
    rating_avg: float
    review_count: int
    awaiting_reply: int
    unread_messages: int
    profile_completion: int
    service_count: int
    published_service_count: int
    draft_service_count: int
    booking_conversion_pct: float | None = None
    total_enquiries: int


class ProviderFinanceOut(BaseModel):
    available_balance: float
    pending_payments: float
    month_earnings: float
    total_payouts: float
    upcoming_payouts: float
    ytd_earnings: float
    yoy_change_pct: float | None = None
    monthly: list[MonthlyPoint]


class OwnerDashboardOut(BaseModel):
    property_count: int
    available_count: int
    rented_count: int
    application_count: int
    new_application_count: int
    active_lease_count: int
    unread_messages: int
    pending_connections: int
    unread_notifications: int
