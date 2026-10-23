"""The admin console's analytics (tracker R40): counts over time, from the rows themselves.

For the last 30 days (by day), 90 days (by week) or 12 months (by month),
in Sydney's calendar: new accounts, listings, applications, complaints and
reviews in each period, read only from the range, a page at a time; the
complaints of the range by category and by status, and its reviews by
status; and the totals of all time. Complaints never count repairs, which
are complaints only on the shared database (services/complaints.py).
"""

from bisect import bisect_right
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.supabase import get_supabase_client
from app.services import complaint_categories, complaints
from app.services._common import select_all
from app.services.maps_messaging import filter_time, moment

LOCAL_TZ = ZoneInfo("Australia/Sydney")
# Days of a range -> how it is split.
RANGES = {30: "day", 90: "week", 365: "month"}

# (key, label, table, the column that dates a row).
SERIES = (
    ("users", "New accounts", "users", "created_at"),
    ("listings", "New listings", "listings", "created_at"),
    ("applications", "Applications", "rental_applications", "created_at"),
    ("complaints", "Complaints", complaints.TABLE, "lodged_at"),
    ("reviews", "Reviews", "reviews", "created_at"),
)
COMPLAINT_STATUSES = (
    ("OPEN", "Open"),
    ("IN_REVIEW", "In review"),
    ("ESCALATED", "Escalated"),
    ("RESOLVED", "Resolved"),
    ("CLOSED", "Closed"),
    ("WITHDRAWN", "Withdrawn"),
)
REVIEW_STATUSES = (
    ("PUBLISHED", "Published"),
    ("FLAGGED", "Reported"),
    ("HIDDEN", "Hidden"),
    ("ARCHIVED", "Archived"),
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _period_starts(days: int, today: date) -> list[date]:
    """The first day of each period of the range ending today, oldest first."""
    granularity = RANGES[days]
    if granularity == "day":
        return [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
    if granularity == "week":
        monday = today - timedelta(days=today.weekday())
        first = today - timedelta(days=days - 1)
        first -= timedelta(days=first.weekday())
        return [first + timedelta(weeks=week) for week in range((monday - first).days // 7 + 1)]
    starts = []
    year, month = today.year, today.month
    for _ in range(12):
        starts.append(date(year, month, 1))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return starts[::-1]


def _local_day(value) -> date | None:
    instant = moment(value)
    return instant.astimezone(LOCAL_TZ).date() if instant else None


def _rows_since(table: str, column: str, since: str, columns: str) -> list[dict]:
    return select_all(
        lambda: get_supabase_client().table(table).select(columns).gte(column, since).order("id")
    )


def _total(table: str, **filters) -> int:
    query = get_supabase_client().table(table).select("id", count="exact", head=True)
    for column, value in filters.items():
        query = query.is_(column, value)
    return query.execute().count or 0


def analytics(days: int) -> dict:
    """AnalyticsOut for the last `days` days (30, 90 or 365)."""
    today = _now().astimezone(LOCAL_TZ).date()
    starts = _period_starts(days, today)
    since = filter_time(datetime.combine(starts[0], time.min, tzinfo=LOCAL_TZ))

    series = []
    in_range: dict[str, list[dict]] = {}
    for key, label, table, column in SERIES:
        columns = f"id, {column}"
        if table == complaints.TABLE:
            columns = f"id, {column}, category, status, metadata, maintenance_work_orders(id)"
        elif table == "reviews":
            columns = f"id, {column}, status"
        rows = _rows_since(table, column, since, columns)
        if table == complaints.TABLE:
            rows = [row for row in rows if not complaints.is_repair(row)]
        in_range[key] = rows
        counts = [0] * len(starts)
        for row in rows:
            day = _local_day(row.get(column))
            if day is not None and day >= starts[0]:
                counts[bisect_right(starts, day) - 1] += 1
        series.append({"key": key, "label": label, "counts": counts, "total": sum(counts)})

    labels = complaint_categories.Labels()
    by_category: dict[str, dict] = {}
    by_status: Counter = Counter()
    for row in in_range["complaints"]:
        category = labels.category(row.get("category"))
        counted = by_category.setdefault(complaint_categories.key(category["code"]),
                                         {"code": category["code"], "label": category["label"], "count": 0})
        counted["count"] += 1
        by_status["WITHDRAWN" if complaints.is_withdrawn(row) else row.get("status") or "OPEN"] += 1
    review_status = Counter(row.get("status") for row in in_range["reviews"])

    all_complaints = select_all(
        lambda: get_supabase_client().table(complaints.TABLE).select("id, maintenance_work_orders(id)").order("id")
    )
    return {
        "days": days,
        "granularity": RANGES[days],
        "start": starts[0],
        "end": today,
        "periods": starts,
        "series": series,
        "totals": {
            "users": _total("users", deleted_at="null"),
            "listings": _total("listings"),
            "applications": _total("rental_applications"),
            "complaints": sum(1 for row in all_complaints if not complaints.is_repair(row)),
            "reviews": _total("reviews"),
        },
        "complaints_by_category": sorted(by_category.values(), key=lambda item: (-item["count"], item["label"])),
        "complaints_by_status": [
            {"status": value, "label": label, "count": by_status.get(value, 0)} for value, label in COMPLAINT_STATUSES
        ],
        "reviews_by_status": [
            {"status": value, "label": label, "count": review_status.get(value, 0)} for value, label in REVIEW_STATUSES
        ],
    }
