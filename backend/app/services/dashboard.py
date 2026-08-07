"""Aggregated dashboard figures.

Every number the overview / finance / profile screens display is computed here
from Supabase rows — there are no hard-coded stat cards left in the UI.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from app.core.supabase import get_supabase_client

MONTH_LABELS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

ACTIVE_STATUSES = ("confirmed", "in_progress")
EARNING_TYPES = ("payment",)


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _month_key(value: str) -> str:
    return value[:7]


def _unread_message_count(supabase, profile_id: str, provider_id: str | None) -> int:
    filters = [
        f"client_id.eq.{profile_id}",
        f"owner_id.eq.{profile_id}",
        f"tenant_id.eq.{profile_id}",
    ]
    if provider_id:
        filters.append(f"provider_id.eq.{provider_id}")

    conversations = (
        supabase.table("conversations").select("id").or_(",".join(filters)).execute().data or []
    )
    if not conversations:
        return 0

    messages = (
        supabase.table("messages")
        .select("id")
        .eq("is_read", False)
        .neq("sender_id", profile_id)
        .in_("conversation_id", [c["id"] for c in conversations])
        .execute()
        .data
        or []
    )
    return len(messages)


# ---------------------------------------------------------------------------
# Service provider
# ---------------------------------------------------------------------------
def provider_dashboard(profile_id: str, provider: dict) -> dict:
    supabase = get_supabase_client()
    provider_id = provider["id"]
    today = date.today()
    week_end = today + timedelta(days=7)

    bookings = (
        supabase.table("bookings")
        .select("id, status, scheduled_date, price")
        .eq("provider_id", provider_id)
        .execute()
        .data
        or []
    )

    active = [b for b in bookings if b["status"] in ACTIVE_STATUSES]
    new_enquiries = [b for b in bookings if b["status"] == "new_enquiry"]
    completed = [b for b in bookings if b["status"] == "completed"]
    due_this_week = [
        b
        for b in active
        if b.get("scheduled_date")
        and today.isoformat() <= b["scheduled_date"] <= week_end.isoformat()
    ]

    transactions = (
        supabase.table("transactions")
        .select("amount, type, created_at")
        .eq("provider_id", provider_id)
        .execute()
        .data
        or []
    )
    this_month = today.strftime("%Y-%m")
    previous = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    month_earnings = sum(
        float(t["amount"])
        for t in transactions
        if t["type"] in EARNING_TYPES and _month_key(t["created_at"]) == this_month
    )
    previous_earnings = sum(
        float(t["amount"])
        for t in transactions
        if t["type"] in EARNING_TYPES and _month_key(t["created_at"]) == previous
    )

    reviews = (
        supabase.table("reviews")
        .select("id, provider_reply")
        .eq("provider_id", provider_id)
        .execute()
        .data
        or []
    )
    awaiting_reply = sum(1 for r in reviews if not r.get("provider_reply"))

    services = (
        supabase.table("provider_services")
        .select("id, is_active")
        .eq("provider_id", provider_id)
        .execute()
        .data
        or []
    )
    published = sum(1 for s in services if s["is_active"])

    booked = len([b for b in bookings if b["status"] not in ("new_enquiry", "declined")])
    conversion = round(booked / len(bookings) * 100, 1) if bookings else None

    return {
        "active_bookings": len(active),
        "new_enquiries": len(new_enquiries),
        "due_this_week": len(due_this_week),
        "completed_bookings": len(completed),
        "month_earnings": round(month_earnings, 2),
        "previous_month_earnings": round(previous_earnings, 2),
        "month_change_pct": _pct_change(month_earnings, previous_earnings),
        "rating_avg": float(provider["rating_avg"]),
        "review_count": provider["review_count"],
        "awaiting_reply": awaiting_reply,
        "unread_messages": _unread_message_count(supabase, profile_id, provider_id),
        "profile_completion": provider["profile_completion"],
        "service_count": len(services),
        "published_service_count": published,
        "draft_service_count": len(services) - published,
        "booking_conversion_pct": conversion,
        "total_enquiries": len(bookings),
    }


def provider_finance(provider_id: str) -> dict:
    supabase = get_supabase_client()
    transactions = (
        supabase.table("transactions")
        .select("amount, type, created_at")
        .eq("provider_id", provider_id)
        .execute()
        .data
        or []
    )

    now = datetime.now(timezone.utc)
    this_month = now.strftime("%Y-%m")
    this_year = now.strftime("%Y")
    last_year = str(now.year - 1)

    payments = [t for t in transactions if t["type"] == "payment"]
    payouts = [t for t in transactions if t["type"] == "payout"]
    refunds = [t for t in transactions if t["type"] == "refund"]
    fees = [t for t in transactions if t["type"] == "platform_fee"]

    total_payments = sum(float(t["amount"]) for t in payments)
    total_payouts = sum(float(t["amount"]) for t in payouts)
    total_refunds = sum(float(t["amount"]) for t in refunds)
    total_fees = sum(float(t["amount"]) for t in fees)

    monthly_totals: dict[str, float] = defaultdict(float)
    for t in payments:
        monthly_totals[_month_key(t["created_at"])] += float(t["amount"])

    monthly = [
        {
            "month": month,
            "label": MONTH_LABELS[int(month[5:7]) - 1],
            "amount": round(amount, 2),
        }
        for month, amount in sorted(monthly_totals.items())
    ]

    ytd = sum(a for m, a in monthly_totals.items() if m.startswith(this_year))
    previous_ytd = sum(a for m, a in monthly_totals.items() if m.startswith(last_year))

    # Pending = invoices raised but not yet paid.
    invoices = (
        supabase.table("invoices")
        .select("amount, status")
        .eq("provider_id", provider_id)
        .execute()
        .data
        or []
    )
    pending = sum(float(i["amount"]) for i in invoices if i["status"] in ("draft", "issued"))

    available = total_payments - total_payouts - total_refunds - total_fees

    return {
        "available_balance": round(available, 2),
        "pending_payments": round(pending, 2),
        "month_earnings": round(monthly_totals.get(this_month, 0.0), 2),
        "total_payouts": round(total_payouts, 2),
        "upcoming_payouts": round(pending, 2),
        "ytd_earnings": round(ytd, 2),
        "yoy_change_pct": _pct_change(ytd, previous_ytd),
        "monthly": monthly,
    }


# ---------------------------------------------------------------------------
# Landlord / owner
# ---------------------------------------------------------------------------
def owner_dashboard(profile_id: str) -> dict:
    supabase = get_supabase_client()

    properties = (
        supabase.table("properties")
        .select("id, status")
        .eq("owner_id", profile_id)
        .execute()
        .data
        or []
    )
    property_ids = [p["id"] for p in properties]

    applications = []
    if property_ids:
        applications = (
            supabase.table("property_applications")
            .select("id, status")
            .in_("property_id", property_ids)
            .execute()
            .data
            or []
        )

    connections = (
        supabase.table("connections")
        .select("id")
        .eq("addressee_id", profile_id)
        .eq("status", "pending")
        .execute()
        .data
        or []
    )

    notifications = (
        supabase.table("notifications")
        .select("id")
        .eq("user_id", profile_id)
        .eq("is_read", False)
        .execute()
        .data
        or []
    )

    return {
        "property_count": len(properties),
        "available_count": sum(1 for p in properties if p["status"] == "available"),
        "rented_count": sum(1 for p in properties if p["status"] == "rented"),
        "application_count": len(applications),
        "new_application_count": sum(1 for a in applications if a["status"] == "new"),
        "active_lease_count": sum(1 for a in applications if a["status"] == "approved"),
        "unread_messages": _unread_message_count(supabase, profile_id, None),
        "pending_connections": len(connections),
        "unread_notifications": len(notifications),
    }
