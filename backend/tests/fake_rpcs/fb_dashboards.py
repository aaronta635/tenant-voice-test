"""Stand-ins for the functions the dashboards and the view beacon call (tracker R28, R35).

Written from output/shared-catalog/functions/mobile_my_rental_history.sql,
mobile_parse_date.sql and consume_api_rate_limit.sql (snapshot of 2026-10-23).
"""

import calendar
import math
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

SYDNEY = ZoneInfo("Australia/Sydney")


def mobile_parse_date(text) -> date | None:
    """public.mobile_parse_date: YYYY-M-D or D/M/YYYY, else (or for an impossible date) null."""
    # trim() takes spaces only: "2026-02-05\n" keeps its newline and matches neither pattern.
    value = (text or "").strip(" ") if isinstance(text, str) else ""
    try:
        if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", value):
            year, month, day = (int(part) for part in value.split("-"))
            return date(year, month, day)
        if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", value):
            day, month, year = (int(part) for part in value.split("/"))
            return date(year, month, day)
    except ValueError:
        return None
    return None


def _mobile_text(metadata, key: str) -> str | None:
    """a.metadata -> 'mobile' ->> key."""
    mobile = metadata.get("mobile") if isinstance(metadata, dict) else None
    value = mobile.get(key) if isinstance(mobile, dict) else None
    if value is None or isinstance(value, str):
        return value
    return str(value).lower() if isinstance(value, bool) else str(value)


def _sydney_date(value) -> date:
    """(timestamptz at time zone 'Australia/Sydney')::date."""
    moment = datetime.fromisoformat(str(value))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(SYDNEY).date()


def _plus_months(start: date, months: int) -> date:
    """date + make_interval(months => n): the same day of the month, or its last day."""
    month_index = start.month - 1 + months
    year, month = start.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


def _term_months(listing: dict, metadata) -> int | None:
    """coalesce(nullif(l.lease_term_months, 0), the first number of metadata.mobile.leaseDuration, in months)."""
    if listing.get("lease_term_months"):
        return listing["lease_term_months"]
    duration = _mobile_text(metadata, "leaseDuration") or ""
    if not re.search(r"\d", duration):
        return None
    number = int(re.search(r"\d{1,3}", duration).group())
    if number == 0:
        return None
    return number * (12 if re.search(r"year|yr", duration, re.IGNORECASE) else 1)


def _cover(media: list[dict], property_id: str) -> str | None:
    """The first property_media row by is_cover desc, sort_order, created_at (nulls last, as in Postgres)."""
    rows = [row for row in media if row.get("property_id") == property_id]
    rows.sort(key=lambda row: (
        not row.get("is_cover"),
        row.get("sort_order") is None, row.get("sort_order") or 0,
        row.get("created_at") is None, str(row.get("created_at") or ""),
    ))
    return rows[0].get("media_url") if rows else None


@rpc("mobile_my_rental_history")
def mobile_my_rental_history(ctx, params):
    caller = ctx.caller
    if caller is None:
        raise api_error("42501", "Please sign in first.")
    # (now() at time zone 'Australia/Sydney')::date, by the database's clock (ctx.now()).
    today = datetime.fromisoformat(ctx.now()).astimezone(SYDNEY).date()
    listings = {row["id"]: row for row in ctx.rows("listings")}
    properties = {row["id"]: row for row in ctx.rows("properties")}
    users = {row["id"]: row for row in ctx.rows("users")}
    media = ctx.rows("property_media")

    entries = []
    for application in ctx.rows("rental_applications"):
        if application.get("applicant_user_id") != caller["id"] or application.get("status") != "APPROVED":
            continue
        listing = listings.get(application.get("listing_id"))  # join listings
        prop = properties.get(listing.get("property_id")) if listing else None  # join properties
        if listing is None or prop is None:
            continue
        owner = users.get(prop.get("owner_user_id")) or {}  # left join users
        metadata = application.get("metadata")
        approved_at = application.get("last_status_at") or application.get("submitted_at")
        start = mobile_parse_date(_mobile_text(metadata, "moveInDate")) or _sydney_date(approved_at)
        months = _term_months(listing, metadata)
        end = _plus_months(start, months) if months is not None else None
        address = ", ".join(str(part) for part in (prop.get("address_line_1"), prop.get("suburb"), prop.get("state"),
                                                    prop.get("postcode")) if part is not None)
        entries.append({
            "id": application["id"],
            "propertyId": application["listing_id"],
            "propertyTitle": (listing.get("title") or "").strip(" ") or "Property",
            "address": address or "Address not provided",
            "image": _cover(media, prop["id"]),
            "ownerName": (owner.get("full_name") or "").strip(" ") or "Owner",
            "weeklyRent": application.get("offer_weekly_rent")
            if application.get("offer_weekly_rent") is not None else listing.get("weekly_rent"),
            "startDate": start.isoformat(),
            "endDate": end.isoformat() if end else None,
            "leaseTermMonths": months,
            "approvedAt": approved_at,
            "status": "Past" if end is not None and end < today else "Current",
        })
    # order by r.start_date desc, r.approved_at desc
    entries.sort(key=lambda entry: (entry["startDate"], str(entry["approvedAt"] or "")), reverse=True)
    return entries


@rpc("consume_api_rate_limit")
def consume_api_rate_limit(ctx, params):
    """Counts one request for p_key_hash in the current window of p_window_seconds; true while within p_limit.

    The window starts at floor(epoch(now) / window) * window and its row
    expires two windows later (api_rate_limits, primary key key_hash and
    window_started_at). The function's 1-in-100 sweep of up to 1000 expired
    rows changes no answer and is left out.
    """
    limit, window = params["p_limit"], params["p_window_seconds"]
    if limit < 1 or window < 1:
        raise api_error("22023", "Invalid rate limit configuration")
    now = datetime.fromisoformat(ctx.now())
    started = datetime.fromtimestamp(math.floor(now.timestamp() / window) * window, timezone.utc)
    key = params["p_key_hash"]
    row = next((item for item in ctx.rows("api_rate_limits")
                if item["key_hash"] == key and datetime.fromisoformat(str(item["window_started_at"])) == started), None)
    if row is None:
        ctx.table("api_rate_limits").insert({
            "key_hash": key, "window_started_at": started.isoformat(), "request_count": 1,
            "expires_at": (started + timedelta(seconds=window * 2)).isoformat(),
        }).execute()
        count = 1
    else:
        count = row["request_count"] + 1
        ctx.table("api_rate_limits").update({"request_count": count}).eq("key_hash", key) \
            .eq("window_started_at", row["window_started_at"]).execute()
    return count <= limit
