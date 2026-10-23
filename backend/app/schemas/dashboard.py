from datetime import date, datetime

from pydantic import BaseModel


class MonthlyPoint(BaseModel):
    month: str          # 'YYYY-MM'
    label: str          # 'Jan'
    amount: float


class ProviderDashboardOut(BaseModel):
    active_bookings: int
    new_enquiries: int
    due_this_week: int
    overdue_bookings: int = 0
    decided_enquiries: int = 0
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
    lifetime_earnings: float = 0
    yoy_change_pct: float | None = None
    monthly: list[MonthlyPoint]


class UpcomingInspectionOut(BaseModel):
    id: str
    kind: str                       # 'booking' (an accepted open-home booking) | 'inspection'
    listing_id: str
    listing_title: str | None = None
    starts_at: datetime
    duration_minutes: int | None = None
    label: str                      # 'Open home booking', or the inspection's type


class OwnerListingOut(BaseModel):
    id: str
    title: str | None = None
    listing_status: str
    occupied: bool                  # an ACTIVE rent agreement
    application_count: int          # withdrawn and expired left out, as on My properties
    new_application_count: int
    view_count: int | None          # the last view_days days; None before 0005 is applied
    favourite_count: int
    review_count: int
    rating_avg: float | None = None
    upcoming_inspection_count: int


class OwnerBadgesOut(BaseModel):
    new_application_count: int
    unread_messages: int
    pending_connections: int
    unread_notifications: int


class OwnerDashboardOut(BaseModel):
    property_count: int
    available_count: int
    rented_count: int
    application_count: int
    new_application_count: int
    active_lease_count: int         # ACTIVE rent agreements: one at most per listing
    occupancy_pct: float | None = None
    active_complaint_count: int = 0
    upcoming_inspection_count: int = 0
    upcoming_inspections: list[UpcomingInspectionOut] = []
    review_count: int = 0
    rating_avg: float | None = None
    reviews_awaiting_reply: int = 0
    favourite_count: int = 0
    view_count: int | None = 0      # None before 0005 is applied (views_available false)
    views_available: bool = True
    view_days: int = 30
    listings: list[OwnerListingOut] = []
    unread_messages: int
    pending_connections: int
    unread_notifications: int


class DailyCountOut(BaseModel):
    date: date
    count: int


class ListingViewsOut(BaseModel):
    available: bool = True          # false before 0005 is applied: no figure, no days
    total: int | None               # every view counted so far
    period: int | None              # views in the range
    daily: list[DailyCountOut]      # one per day of the range, oldest first


class PeriodCountOut(BaseModel):
    total: int
    period: int                     # of them, how many arrived in the range


class ApplicationFunnelOut(BaseModel):
    total: int
    period: int
    new: int
    reviewing: int                  # under review or shortlisted
    shortlisted: int
    approved: int
    declined: int
    withdrawn: int
    expired: int


class InspectionBookingsOut(BaseModel):
    bookings: int                   # open-home bookings of every status
    pending: int
    accepted: int
    reschedule_requested: int
    rejected: int
    cancelled: int
    upcoming_count: int
    upcoming: list[UpcomingInspectionOut]


class RatingCountOut(BaseModel):
    rating: int
    count: int


class ReviewSummaryOut(BaseModel):
    count: int
    rating_avg: float | None = None
    awaiting_reply: int
    distribution: list[RatingCountOut]  # 5 stars down to 1


class ListingLeaseOut(BaseModel):
    agreement_id: str
    start_date: date
    end_date: date | None = None
    rent_amount: float
    rent_frequency: str             # WEEKLY | FORTNIGHTLY | MONTHLY


class ListingAnalyticsOut(BaseModel):
    property_id: str
    title: str | None = None
    listing_status: str
    published_at: datetime | None = None
    days: int
    start: date
    end: date
    views: ListingViewsOut
    favourites: PeriodCountOut
    applications: ApplicationFunnelOut
    inspections: InspectionBookingsOut
    reviews: ReviewSummaryOut
    lease: ListingLeaseOut | None = None


class TenantLeaseOut(BaseModel):
    agreement_id: str
    listing_id: str
    listing_title: str | None = None
    address: str | None = None
    rent_amount: float
    rent_frequency: str             # WEEKLY | FORTNIGHTLY | MONTHLY
    start_date: date
    end_date: date | None = None
    first_due_date: date | None = None


class RentChargeOut(BaseModel):
    charge_id: str
    period_start: date
    period_end: date
    due_date: date
    amount_due: float
    amount_paid: float              # verified, successful payments
    amount_outstanding: float
    status: str                     # PAID | OVERDUE | PARTIALLY_PAID | UNPAID, as mobile_my_rent_summary names it


class RentalHistoryItemOut(BaseModel):
    id: str
    source: str                     # 'tenantvoice' (an approved application) | 'self_reported'
    listing_id: str | None = None
    title: str | None = None
    address: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    current: bool = False
    weekly_rent: float | None = None
    landlord_name: str | None = None


class TenantDashboardOut(BaseModel):
    has_tenancy: bool               # an ACTIVE rent agreement
    listing_id: str | None = None
    listing_title: str | None = None
    lease: TenantLeaseOut | None = None
    next_payment: RentChargeOut | None = None
    overdue_count: int = 0
    overdue_amount: float = 0
    open_maintenance: int = 0
    upcoming_inspections: int = 0
    next_inspections: list[UpcomingInspectionOut] = []
    rental_history: list[RentalHistoryItemOut] = []
    # False when TenantVoice's own tenancies could not be read: the list holds the reported ones only.
    rental_history_complete: bool = True
