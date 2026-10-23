"""Aggregated dashboard figures.

Every number the overview / finance / profile screens display is computed here
from Supabase rows — there are no hard-coded stat cards left in the UI.
"""

from collections import Counter, defaultdict
import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import logging
from zoneinfo import ZoneInfo

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, user_client, web_table
from app.services import _common
from app.services import bookings as bookings_service
from app.services import complaints as complaints_service
from app.services import conversations as conversations_service
from app.services import ledger
from app.services import listing_views as listing_views_service
from app.services import profiles as profiles_service
from app.services import reviews as reviews_service
from app.services import properties as properties_service
from app.services.maps_messaging import filter_time, moment
from app.services.maps_provider_core import SERVICE_ARCHIVED_STATUS, SERVICE_LIVE_STATUS
from app.services.maps_rental import (
    CLOSED_APPLICATION_STATUSES,
    LISTING_STATUS_FILTER,
    listing_status_name,
    locality,
    repair_is_open,
)

logger = logging.getLogger(__name__)

# The marketplace is NSW-only: "today" and "this month" follow Sydney time, so
# a payment at 9am on the 1st doesn't land in the previous (UTC) month.
LOCAL_TZ = ZoneInfo("Australia/Sydney")

MONTH_LABELS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

ACTIVE_STATUSES = ("confirmed", "in_progress")
BOOKED_STATUSES = ("confirmed", "in_progress", "completed")
# Net earnings: what the provider keeps. Payouts move money out of the balance
# but are not a cost, so they don't reduce earnings.
EARNING_SIGN = {"payment": 1, "refund": -1, "platform_fee": -1}


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _local_today() -> date:
    return datetime.now(LOCAL_TZ).date()


def _local_date(value: str) -> date:
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(LOCAL_TZ).date()


def _month_key(value: str) -> str:
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return value[:7]
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(LOCAL_TZ).strftime("%Y-%m")


def _net(transaction: dict) -> float:
    return EARNING_SIGN.get(transaction["type"], 0) * float(transaction["amount"])


def _months_back(today: date, count: int) -> list[str]:
    """The last `count` calendar months ending with today's, oldest first."""
    months = []
    year, month = today.year, today.month
    for _ in range(count):
        months.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(months))


def _provider_rows(table: str, columns: str, provider_id: str) -> list[dict]:
    """Every row of a provider's web.bookings, web.transactions or web.invoices, read page by page."""
    return _common.select_all(lambda: web_table(table).select(columns).eq("provider_id", provider_id).order("id"))


def _unread_message_count(profile_id: str) -> int:
    """Messages other people sent the user that are still unread, in all their threads.

    The inbox's rule (conversations.unread_counts): in each thread the user
    takes part in, other people's messages newer than their last_read_at.
    """
    return sum(conversations_service.unread_counts(profile_id).values())


# ---------------------------------------------------------------------------
# Service provider
# ---------------------------------------------------------------------------
def provider_dashboard(profile_id: str, provider: dict) -> dict:
    """The overview's figures from the provider's bookings, ledger, reviews, services and threads.

    A provider's id is its owner's users.id: profile_id and provider["id"]
    are the same id, the one web.bookings and web.transactions keep.
    """
    provider_id = provider["id"]
    today = _local_today()
    week_end = today + timedelta(days=6)

    bookings = _provider_rows(bookings_service.TABLE, "id, status, scheduled_date, price", provider_id)

    active = [b for b in bookings if b["status"] in ACTIVE_STATUSES]
    new_enquiries = [b for b in bookings if b["status"] == "new_enquiry"]
    completed = [b for b in bookings if b["status"] == "completed"]
    # Show upcoming and overdue work separately so the weekly label stays accurate.
    due_this_week = [
        b for b in active if b.get("scheduled_date") and today.isoformat() <= b["scheduled_date"] <= week_end.isoformat()
    ]

    transactions = _provider_rows(ledger.TRANSACTIONS, "amount, type, created_at", provider_id)
    this_month = today.strftime("%Y-%m")
    previous = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    month_earnings = sum(_net(t) for t in transactions if _month_key(t["created_at"]) == this_month)
    previous_earnings = sum(_net(t) for t in transactions if _month_key(t["created_at"]) == previous)

    previous_year, previous_month = map(int, previous.split("-"))
    previous_cutoff = date(previous_year, previous_month, min(today.day, calendar.monthrange(previous_year, previous_month)[1]))
    previous_period_earnings = sum(_net(t) for t in transactions
        if _month_key(t["created_at"]) == previous and _local_date(t["created_at"]) <= previous_cutoff)

    # The reviews the Reviews page lists, so the figures agree with it: every
    # review about the provider's users.id, a booking's review among them. A
    # reply is stored as landlord_reply and listed as provider_reply.
    reviews = reviews_service.list_provider_reviews(provider_id, user_id=profile_id, with_reports=False)
    awaiting_reply = sum(1 for r in reviews if not r.get("provider_reply"))
    rating_avg = round(sum(r["rating"] for r in reviews) / len(reviews), 2) if reviews else 0.0

    # mobile_provider_services rows; a live one is published, an archived one removed (maps_provider_core).
    services = _common.select_all(
        lambda: get_supabase_client()
        .table("mobile_provider_services")
        .select("id, status")
        .eq("provider_user_id", provider_id)
        .neq("status", SERVICE_ARCHIVED_STATUS)
        .order("id")
    )
    published = sum(1 for s in services if s["status"] == SERVICE_LIVE_STATUS)

    # Of the enquiries that have been decided, how many became jobs. Open
    # enquiries aren't decided yet; cancellations are not conversions.
    decided = [b for b in bookings if b["status"] != "new_enquiry"]
    booked = sum(1 for b in decided if b["status"] in BOOKED_STATUSES)
    conversion = round(booked / len(decided) * 100, 1) if decided else None

    return {
        "active_bookings": len(active),
        "new_enquiries": len(new_enquiries),
        "due_this_week": len(due_this_week),
        "overdue_bookings": sum(1 for b in active if b.get("scheduled_date") and b["scheduled_date"] < today.isoformat()),
        "decided_enquiries": len(decided),
        "completed_bookings": len(completed),
        "month_earnings": round(month_earnings, 2),
        "previous_month_earnings": round(previous_earnings, 2),
        "month_change_pct": _pct_change(month_earnings, previous_period_earnings),
        "rating_avg": rating_avg,
        "review_count": len(reviews),
        "awaiting_reply": awaiting_reply,
        "unread_messages": _unread_message_count(profile_id),
        "profile_completion": provider["profile_completion"],
        "service_count": len(services),
        "published_service_count": published,
        "draft_service_count": len(services) - published,
        "booking_conversion_pct": conversion,
        "total_enquiries": len(bookings),
    }


def provider_finance(provider_id: str) -> dict:
    """Balances and earnings from the provider's web.transactions, and what its issued invoices await."""
    transactions = _provider_rows(ledger.TRANSACTIONS, "amount, type, created_at", provider_id)

    today = _local_today()
    this_month = today.strftime("%Y-%m")
    this_year = today.strftime("%Y")

    def total(kind: str) -> float:
        return sum(float(t["amount"]) for t in transactions if t["type"] == kind)

    total_payouts = total("payout")

    monthly_totals: dict[str, float] = defaultdict(float)
    for t in transactions:
        monthly_totals[_month_key(t["created_at"])] += _net(t)

    # Every calendar month is listed, so a quiet month shows as $0 rather than
    # disappearing from the 3m / 6m / 12m chart.
    monthly = [
        {
            "month": month,
            "label": MONTH_LABELS[int(month[5:7]) - 1],
            "amount": round(monthly_totals.get(month, 0.0), 2),
        }
        for month in _months_back(today, 12)
    ]

    ytd = sum(a for m, a in monthly_totals.items() if m.startswith(this_year))
    previous_cutoff = date(today.year - 1, today.month, min(today.day, calendar.monthrange(today.year - 1, today.month)[1]))
    previous_ytd = sum(_net(t) for t in transactions if _local_date(t["created_at"]).year == today.year - 1 and _local_date(t["created_at"]) <= previous_cutoff)
    lifetime = sum(monthly_totals.values())

    # Pending = invoices sent to clients and not yet paid; drafts were never sent.
    invoices = _provider_rows(ledger.INVOICES, "amount, status", provider_id)
    pending = sum(float(i["amount"]) for i in invoices if i["status"] == "issued")

    available = lifetime - total_payouts

    return {
        "available_balance": round(available, 2),
        "pending_payments": round(pending, 2),
        "month_earnings": round(monthly_totals.get(this_month, 0.0), 2),
        "total_payouts": round(total_payouts, 2),
        # Paid out at the next payout run: whatever is available now.
        "upcoming_payouts": round(max(available, 0.0), 2),
        "ytd_earnings": round(ytd, 2),
        "lifetime_earnings": round(lifetime, 2),
        "yoy_change_pct": _pct_change(ytd, previous_ytd),
        "monthly": monthly,
    }


# ---------------------------------------------------------------------------
# Inspections still to come (owner and tenant)
# ---------------------------------------------------------------------------
# Views the owner's dashboard adds up: the last 30 Sydney days, today included.
VIEW_DAYS = 30
# How many upcoming inspections a dashboard lists; it counts them all.
UPCOMING_LISTED = 5
# An open-home booking (mobile_inspection_bookings) the owner accepted, and an
# inspection (mobile_inspections) not yet done or cancelled.
ACCEPTED_BOOKING = "accepted"
SCHEDULED_INSPECTION = "Scheduled"
OPEN_HOME_LABEL = "Open home booking"
# The one rent_agreements status of a lease in force: a listing has one at most.
ACTIVE_AGREEMENT = "ACTIVE"
# A complaint still waiting on a decision, as the Complaints page names its status.
ACTIVE_COMPLAINT_STATUSES = ("open", "under_review")
# The ranges a listing's analytics offer, in days.
ANALYTICS_DAYS = (7, 30, 90)
# Application stages as the owner's filters name them (maps_rental), with the
# ones a decline filter groups told apart.
APPLICATION_STAGES = (
    ("new", ("SUBMITTED",)),
    ("reviewing", ("UNDER_REVIEW", "SHORTLISTED")),
    ("approved", ("APPROVED",)),
    ("declined", ("REJECTED",)),
    ("withdrawn", ("WITHDRAWN",)),
    ("expired", ("EXPIRED",)),
)
# mobile_inspection_bookings.status, in its order.
BOOKING_STATUSES = ("pending", "accepted", "reschedule_requested", "rejected", "cancelled")


def _now_filter() -> str:
    return filter_time(datetime.now(timezone.utc))


def _rows_in(table: str, columns: str, column: str, values, **equal) -> list[dict]:
    """Every row of a shared table whose column is one of values and that matches each name=value in equal."""
    def build():
        query = get_supabase_client().table(table).select(columns)
        for name, value in equal.items():
            query = query.eq(name, value)
        return query.order("id")

    return _common.select_in(build, column, values)


def _accepted_bookings(column: str, values, now: str) -> list[dict]:
    """Accepted open-home bookings whose time is still to come, by listing_id or tenant_id."""
    return _common.select_in(
        lambda: get_supabase_client()
        .table("mobile_inspection_bookings")
        .select("id, listing_id, mobile_inspection_slots!inner(starts_at, duration_minutes, status)")
        .eq("status", ACCEPTED_BOOKING)
        .gt("mobile_inspection_slots.starts_at", now)
        .neq("mobile_inspection_slots.status", "cancelled")
        .order("id"),
        column,
        values,
    )


def _scheduled_inspections(column: str, values, now: str) -> list[dict]:
    """Scheduled inspections still to come (routine, entry, exit, viewings), by listing_id or attendee_user_id."""
    return _common.select_in(
        lambda: get_supabase_client()
        .table("mobile_inspections")
        .select("id, listing_id, inspection_type, scheduled_at")
        .eq("status", SCHEDULED_INSPECTION)
        .gt("scheduled_at", now)
        .order("id"),
        column,
        values,
    )


def _upcoming(bookings: list[dict], inspections: list[dict], titles: dict[str, str]) -> list[dict]:
    """UpcomingInspectionOut rows for both kinds, soonest first, each once."""
    items: dict[str, dict] = {}
    for booking in bookings:
        slot = booking["mobile_inspection_slots"]
        items[booking["id"]] = {
            "id": booking["id"], "kind": "booking", "listing_id": booking["listing_id"],
            "listing_title": titles.get(booking["listing_id"]), "starts_at": slot["starts_at"],
            "duration_minutes": slot.get("duration_minutes"), "label": OPEN_HOME_LABEL,
        }
    for inspection in inspections:
        items[inspection["id"]] = {
            "id": inspection["id"], "kind": "inspection", "listing_id": inspection["listing_id"],
            "listing_title": titles.get(inspection["listing_id"]), "starts_at": inspection["scheduled_at"],
            "duration_minutes": None, "label": inspection.get("inspection_type") or "Inspection",
        }
    return sorted(items.values(), key=lambda item: (moment(item["starts_at"]), item["id"]))


def _rating(reviews: list[dict]) -> float | None:
    """The average rating, as a listing card rounds it; None without a review."""
    return round(sum(r["rating"] for r in reviews) / len(reviews), 2) if reviews else None


# ---------------------------------------------------------------------------
# Landlord / owner
# ---------------------------------------------------------------------------
def _active_complaint_count(profile_id: str) -> int:
    """The complaints about the owner or a home they own still open or under review, as their Complaints page shows them."""
    return sum(1 for complaint in complaints_service.list_complaints_against_me(profile_id)
               if complaint["status"] in ACTIVE_COMPLAINT_STATUSES)


def owner_dashboard(profile_id: str) -> dict:
    """The owner's figures, overall and for each listing, from the rows each one counts (tracker R28).

    Listings are those of the properties the owner owns or manages, as My
    properties lists them (never archived ones). Occupancy is the share of
    them with an ACTIVE rent agreement, so it moves only when an agreement is
    activated or ends, not when a listing is marked leased. Applications
    leave out the withdrawn and expired, as My properties counts them.
    Reviews are the PUBLISHED reviews of the owner's homes; favourites are
    listing_favorites rows; views are web.listing_views rows of the last
    VIEW_DAYS days (services/listing_views.py).
    """
    supabase = get_supabase_client()
    listings = properties_service.owned_listings(profile_id, columns="id, title, status, property_id")
    listing_ids = [listing["id"] for listing in listings]
    property_ids = list(dict.fromkeys(listing["property_id"] for listing in listings))
    titles = {listing["id"]: listing.get("title") for listing in listings}
    now = _now_filter()

    applications: dict[str, list[dict]] = defaultdict(list)
    for row in _rows_in("rental_applications", "id, listing_id, status", "listing_id", listing_ids):
        if row.get("status") not in CLOSED_APPLICATION_STATUSES:
            applications[row["listing_id"]].append(row)
    leased = {row["listing_id"] for row in _rows_in("rent_agreements", "id, listing_id", "listing_id", listing_ids,
                                                    status=ACTIVE_AGREEMENT)}
    favourites = Counter(row["listing_id"] for row in _rows_in("listing_favorites", "id, listing_id", "listing_id", listing_ids))
    reviews = _rows_in("reviews", "id, property_id, rating, landlord_reply", "property_id", property_ids, status="PUBLISHED")
    reviews_by_property: dict[str, list[dict]] = defaultdict(list)
    for review in reviews:
        reviews_by_property[review["property_id"]].append(review)
    try:
        views = listing_views_service.period_counts(listing_ids, since=_local_today() - timedelta(days=VIEW_DAYS - 1))
    except listing_views_service.ViewsUnavailable:
        views = None  # 0005 not applied yet: the rest of the dashboard still answers
    upcoming = _upcoming(_accepted_bookings("listing_id", listing_ids, now),
                         _scheduled_inspections("listing_id", listing_ids, now), titles)
    upcoming_by_listing = Counter(item["listing_id"] for item in upcoming)

    rows = []
    for listing in listings:
        live = applications[listing["id"]]
        own_reviews = reviews_by_property[listing["property_id"]]
        rows.append({
            "id": listing["id"],
            "title": listing.get("title"),
            "listing_status": listing_status_name(listing.get("status")),
            "occupied": listing["id"] in leased,
            "application_count": len(live),
            "new_application_count": sum(1 for row in live if row.get("status") == "SUBMITTED"),
            "view_count": views.get(listing["id"], 0) if views is not None else None,
            "favourite_count": favourites[listing["id"]],
            "review_count": len(own_reviews),
            "rating_avg": _rating(own_reviews),
            "upcoming_inspection_count": upcoming_by_listing[listing["id"]],
        })

    available = LISTING_STATUS_FILTER["available"]
    return {
        "property_count": len(listings),
        "available_count": sum(1 for p in listings if p.get("status") in available),
        "rented_count": sum(1 for p in listings if p.get("status") == "LEASED"),
        "application_count": sum(row["application_count"] for row in rows),
        "new_application_count": sum(row["new_application_count"] for row in rows),
        "active_lease_count": len(leased),
        "occupancy_pct": round(len(leased) / len(listings) * 100, 1) if listings else None,
        "active_complaint_count": _active_complaint_count(profile_id),
        "upcoming_inspection_count": len(upcoming),
        "upcoming_inspections": upcoming[:UPCOMING_LISTED],
        "review_count": len(reviews),
        "rating_avg": _rating(reviews),
        "reviews_awaiting_reply": sum(1 for review in reviews if not review.get("landlord_reply")),
        "favourite_count": sum(favourites.values()),
        "view_count": sum(row["view_count"] for row in rows) if views is not None else None,
        "views_available": views is not None,
        "view_days": VIEW_DAYS,
        "listings": rows,
        "unread_messages": _unread_message_count(profile_id),
        "pending_connections": _pending_connections(profile_id),
        "unread_notifications": _unread_notifications(profile_id),
    }


def _pending_connections(profile_id: str) -> int:
    """Connection requests waiting for this person's answer, not every pending request."""
    result = (get_supabase_client().table("connection_requests").select("id", count="exact", head=True)
              .eq("receiver_user_id", profile_id).eq("status", "PENDING").execute())
    return result.count or 0


def _unread_notifications(profile_id: str) -> int:
    result = (get_supabase_client().table("notifications").select("id", count="exact", head=True)
              .eq("user_id", profile_id).eq("is_read", False).execute())
    return result.count or 0


def owner_badges(profile_id: str) -> dict:
    """The owner shell's counts, which every owner page shows: the few queries they need.

    new_application_count is owner_dashboard's (SUBMITTED applications on the
    listings the owner owns or manages); the others are the dashboard's too.
    OwnerShell asks for these on every navigation, so they leave out the
    rest of the dashboard: complaints, inspections, reviews and views.
    """
    listing_ids = [listing["id"] for listing in properties_service.owned_listings(profile_id, columns="id")]
    return {
        "new_application_count": len(_rows_in("rental_applications", "id", "listing_id", listing_ids, status="SUBMITTED")),
        "unread_messages": _unread_message_count(profile_id),
        "pending_connections": _pending_connections(profile_id),
        "unread_notifications": _unread_notifications(profile_id),
    }


def listing_analytics(listing_id: str, owner_id: str, days: int) -> dict:
    """One listing's analytics for the last `days` Sydney days (ANALYTICS_DAYS), with its totals of all time.

    404 unless the owner owns or manages the listing, which must not be
    archived (properties.owned_listing). Views come day by day; the other
    figures are the rows as they stand, with how many arrived in the range.
    """
    listing, prop = properties_service.owned_listing(listing_id, owner_id)
    supabase = get_supabase_client()
    today = _local_today()
    start = today - timedelta(days=days - 1)
    now = _now_filter()
    listing_id = listing["id"]

    try:
        counted = listing_views_service.daily_counts([listing_id], since=start, until=today).get(listing_id, Counter())
        views_total = listing_views_service.total(listing_id)
    except listing_views_service.ViewsUnavailable:
        counted, views_total = None, None  # 0005 not applied yet
    daily = [] if counted is None else [
        {"date": (start + timedelta(days=offset)).isoformat(), "count": counted.get((start + timedelta(days=offset)).isoformat(), 0)}
        for offset in range(days)
    ]

    favourites = _common.select_all(
        lambda: supabase.table("listing_favorites").select("id, created_at").eq("listing_id", listing_id).order("id")
    )
    applications = _common.select_all(
        lambda: supabase.table("rental_applications").select("id, status, submitted_at")
        .eq("listing_id", listing_id).order("id")
    )
    statuses = Counter(row.get("status") for row in applications)
    bookings = _common.select_all(
        lambda: supabase.table("mobile_inspection_bookings").select("id, status").eq("listing_id", listing_id).order("id")
    )
    booking_statuses = Counter(row.get("status") for row in bookings)
    upcoming = _upcoming(_accepted_bookings("listing_id", [listing_id], now),
                         _scheduled_inspections("listing_id", [listing_id], now), {listing_id: listing.get("title")})
    reviews = _common.select_all(
        lambda: supabase.table("reviews").select("id, rating, landlord_reply")
        .eq("property_id", prop["id"]).eq("status", "PUBLISHED").order("id")
    )
    ratings = Counter(review.get("rating") for review in reviews)
    agreements = (
        supabase.table("rent_agreements")
        .select("id, start_date, end_date, rent_amount, rent_frequency")
        .eq("listing_id", listing_id)
        .eq("status", ACTIVE_AGREEMENT)
        .limit(1)
        .execute()
        .data
        or []
    )

    def since_start(rows: list[dict], column: str) -> int:
        return sum(1 for row in rows if row.get(column) and _local_date(row[column]) >= start)

    return {
        "property_id": listing_id,
        "title": listing.get("title"),
        "listing_status": listing_status_name(listing.get("status")),
        "published_at": listing.get("published_at"),
        "days": days,
        "start": start.isoformat(),
        "end": today.isoformat(),
        "views": {
            "available": counted is not None,
            "total": views_total,
            "period": sum(point["count"] for point in daily) if counted is not None else None,
            "daily": daily,
        },
        "favourites": {"total": len(favourites), "period": since_start(favourites, "created_at")},
        "applications": {
            "total": len(applications),
            "period": since_start(applications, "submitted_at"),
            **{stage: sum(statuses[status] for status in stored) for stage, stored in APPLICATION_STAGES},
            "shortlisted": statuses["SHORTLISTED"],
        },
        "inspections": {
            "bookings": len(bookings),
            **{status: booking_statuses[status] for status in BOOKING_STATUSES},
            "upcoming_count": len(upcoming),
            "upcoming": upcoming[:UPCOMING_LISTED],
        },
        "reviews": {
            "count": len(reviews),
            "rating_avg": _rating(reviews),
            "awaiting_reply": sum(1 for review in reviews if not review.get("landlord_reply")),
            "distribution": [{"rating": rating, "count": ratings[rating]} for rating in range(5, 0, -1)],
        },
        "lease": (
            {"agreement_id": agreements[0]["id"], "start_date": agreements[0]["start_date"],
             "end_date": agreements[0].get("end_date"), "rent_amount": agreements[0]["rent_amount"],
             "rent_frequency": agreements[0]["rent_frequency"]}
            if agreements else None
        ),
    }


# ---------------------------------------------------------------------------
# Tenant
# ---------------------------------------------------------------------------
def _money(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def _rent_charges(agreement_id: str, today: date) -> list[dict]:
    """The agreement's issued charges, soonest due first, each with what verified payments cover.

    As mobile_my_rent_summary works it out: only ISSUED charges; a payment
    counts once it SUCCEEDED and is verified; the outstanding amount never
    drops below zero; and the status is PAID once the payments cover the
    charge, else OVERDUE after its due date, else PARTIALLY_PAID or UNPAID.
    The due date is compared with Sydney's date, where the function uses the
    database's (UTC) date.
    """
    supabase = get_supabase_client()
    charges = _common.select_all(
        lambda: supabase.table("rent_charges")
        .select("id, period_start, period_end, due_date, amount_due")
        .eq("agreement_id", agreement_id)
        .eq("status", "ISSUED")
        .order("due_date")
        .order("id")
    )
    paid: dict[str, Decimal] = defaultdict(Decimal)
    for payment in _rows_in("rent_payments", "id, charge_id, amount, verified_at", "charge_id",
                            [charge["id"] for charge in charges], status="SUCCEEDED"):
        if payment.get("verified_at"):
            paid[payment["charge_id"]] += _money(payment.get("amount"))
    out = []
    for charge in charges:
        due, covered = _money(charge.get("amount_due")), paid[charge["id"]]
        if covered >= due:
            state = "PAID"
        elif date.fromisoformat(str(charge["due_date"])[:10]) < today:
            state = "OVERDUE"
        elif covered > 0:
            state = "PARTIALLY_PAID"
        else:
            state = "UNPAID"
        out.append({
            "charge_id": charge["id"],
            "period_start": charge["period_start"],
            "period_end": charge["period_end"],
            "due_date": charge["due_date"],
            "amount_due": float(due),
            "amount_paid": float(covered),
            "amount_outstanding": float(max(due - covered, Decimal(0))),
            "status": state,
        })
    return out


def _rental_history(current: CurrentProfile) -> tuple[list[dict], bool]:
    """(the tenant's tenancies newest first, whether TenantVoice's own could be read).

    TenantVoice's come from mobile_my_rental_history, called as the tenant
    (their approved applications, as the mobile app lists them); the others
    are those the tenant reported on their profile
    (tenant_profiles.metadata.rental_history, as GET /profiles/me reads it).
    """
    platform: list[dict] = []
    complete = bool(current.access_token)
    if complete:
        try:
            rows = user_client(current.access_token).rpc("mobile_my_rental_history", {}).execute().data
        except Exception as exc:
            logger.warning("rental history of %s could not be read: %s", current.id, exc)
            rows, complete = [], False
        for row in rows if isinstance(rows, list) else []:
            platform.append({
                "id": str(row.get("id")),
                "source": "tenantvoice",
                "listing_id": row.get("propertyId"),
                "title": row.get("propertyTitle"),
                "address": row.get("address"),
                "start_date": row.get("startDate"),
                "end_date": row.get("endDate"),
                "current": row.get("status") == "Current",
                "weekly_rent": row.get("weeklyRent"),
                "landlord_name": row.get("ownerName"),
            })
    profile = (
        get_supabase_client().table("tenant_profiles").select("metadata").eq("user_id", current.id)
        .limit(1).execute().data
        or []
    )
    reported = []
    for entry in profiles_service.tenant_details(profile[0] if profile else None)["rental_history"]:
        reported.append({
            "id": entry["id"],
            "source": "self_reported",
            "listing_id": None,
            "title": None,
            "address": ", ".join(part for part in (entry["address"], entry.get("suburb"), entry.get("state")) if part),
            "start_date": entry.get("start_date"),
            "end_date": entry.get("end_date"),
            "current": entry.get("current", False),
            "weekly_rent": entry.get("weekly_rent"),
            "landlord_name": entry.get("landlord_name"),
        })
    history = platform + reported
    history.sort(key=lambda item: str(item["start_date"] or ""), reverse=True)
    return history, complete


def tenant_dashboard(current: CurrentProfile) -> dict:
    """The tenant's home on TenantVoice, from the rows each figure counts (tracker R35).

    The current lease is their ACTIVE rent agreement (the latest to start,
    if they have more than one), and the next payment the first of its
    issued charges not yet paid (_rent_charges). Open repairs are their work
    orders not yet resolved; upcoming inspections are their accepted
    open-home bookings and the scheduled inspections at their home or that
    they attend, still to come. Their rental history is _rental_history's.
    """
    profile_id = current.id
    supabase = get_supabase_client()
    today = _local_today()
    now = _now_filter()

    agreements = (
        supabase.table("rent_agreements")
        .select("id, listing_id, rent_amount, rent_frequency, start_date, end_date, first_due_date")
        .eq("tenant_user_id", profile_id)
        .eq("status", ACTIVE_AGREEMENT)
        .order("start_date", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )
    agreement = agreements[0] if agreements else None
    lease, charges = None, []
    if agreement:
        listing = properties_service.listing_row(agreement["listing_id"]) or {}
        prop = properties_service.listing_property(listing) if listing else None
        lease = {
            "agreement_id": agreement["id"],
            "listing_id": agreement["listing_id"],
            "listing_title": listing.get("title"),
            "address": ", ".join(part for part in (
                (prop or {}).get("address_line_1"), locality(prop) if prop else None,
            ) if part) or None,
            "rent_amount": agreement["rent_amount"],
            "rent_frequency": agreement["rent_frequency"],
            "start_date": agreement["start_date"],
            "end_date": agreement.get("end_date"),
            "first_due_date": agreement.get("first_due_date"),
        }
        charges = _rent_charges(agreement["id"], today)
    overdue = [charge for charge in charges if charge["status"] == "OVERDUE"]

    repairs = (
        supabase.table("maintenance_work_orders")
        .select("id, status")
        .eq("tenant_user_id", profile_id)
        .execute()
        .data
        or []
    )

    homes = [agreement["listing_id"]] if agreement else []
    inspections = _scheduled_inspections("listing_id", homes, now) + _scheduled_inspections("attendee_user_id", [profile_id], now)
    bookings = _accepted_bookings("tenant_id", [profile_id], now)
    listing_ids = list({row["listing_id"] for row in inspections + bookings})
    titles = {row["id"]: row.get("title") for row in _rows_in("listings", "id, title", "id", listing_ids)}
    upcoming = _upcoming(bookings, inspections, titles)

    history, complete = _rental_history(current)
    return {
        "has_tenancy": agreement is not None,
        "listing_id": lease["listing_id"] if lease else None,
        "listing_title": lease["listing_title"] if lease else None,
        "lease": lease,
        "next_payment": next((charge for charge in charges if charge["status"] != "PAID"), None),
        "overdue_count": len(overdue),
        "overdue_amount": float(sum(_money(charge["amount_outstanding"]) for charge in overdue)),
        "open_maintenance": sum(1 for r in repairs if repair_is_open(r.get("status"))),
        "upcoming_inspections": len(upcoming),
        "next_inspections": upcoming[:UPCOMING_LISTED],
        "rental_history": history,
        "rental_history_complete": complete,
    }
