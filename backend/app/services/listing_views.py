"""Listing views (tracker R28): how many people open a listing, a day at a time.

A listing page sends a beacon when it opens (POST /properties/{id}/views,
frontend components/rental/ListingViewBeacon.tsx). Each viewer counts once
per listing and Sydney calendar day: web.listing_views
(supabase/shared/0005_listing_views.sql) holds one row for each, and its
unique key turns a second visit that day into no new row. This module is the
table's only writer; the owner's dashboard and listing analytics read the
counts below (services/dashboard.py).

Nothing personal is kept. A signed-in member is their users.id and a
signed-out visitor the random id their browser keeps (lib/listing-views.ts),
but a row stores only an HMAC-SHA256 of the listing, the day and that id,
keyed by the day's random salt (web.listing_view_salts), and the day, not
the time. The first view of a day makes its salt and deletes every earlier
day's, so once a day is over nothing, not even the service role, can
recompute its hashes: its rows name no one, and the same viewer's rows on
other listings or days cannot be matched. Within the day the salt lets the
unique key count a viewer once. A member counts once a day on all their
devices; a visitor who signs in during the day may count once more.

Not counted: the listing's owner and manager, TenantVoice staff, a request
whose token the API refused (the web refreshes the session and sends it
again), and signed-out views past VISITOR_VIEWS_PER_WINDOW from one address
in VIEW_WINDOW_SECONDS (public.consume_api_rate_limit, keyed by an HMAC of
the address under the day's salt), so a script with fresh visitor ids
cannot add views without end. The counts are read by the database: head
counts, never every row, once a listing has many views.
"""

import hashlib
import hmac
import logging
import secrets
from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.deps import CurrentProfile
from app.core.supabase import get_supabase_client, web_table
from app.services import properties as properties_service
from app.services._common import select_in
from app.services.maps_rental import PUBLIC_LISTING_STATUSES

logger = logging.getLogger(__name__)

# In the web schema: query them with web_table(...).
TABLE = "listing_views"
# One random salt per Sydney day, the hashes' key; earlier days' are deleted.
SALTS = "listing_view_salts"
# Views are counted by Sydney's calendar: the marketplace is NSW-only.
LOCAL_TZ = ZoneInfo("Australia/Sydney")
# Web roles whose visits are TenantVoice's own work, not interest in a home.
STAFF_ROLES = ("admin", "officer")
NEEDS_VISITOR_ID = "Send this browser's visitor id to count a view while signed out."
# Signed-out views counted per client address and window (consume_api_rate_limit).
VISITOR_VIEWS_PER_WINDOW = 60
VIEW_WINDOW_SECONDS = 600
# A listing with more views than this in a range is counted a day at a time by the database.
ROW_READ_LIMIT = 5000


# PostgREST's "no such table in the schema cache" and Postgres's undefined_table: 0005 not applied yet.
_MISSING_TABLE = ("PGRST205", "42P01")


class ViewsUnavailable(Exception):
    """The views cannot be read: web.listing_views does not exist yet (0005 not applied)."""


def _missing_table(exc: APIError) -> bool:
    return getattr(exc, "code", None) in _MISSING_TABLE


def _today() -> date:
    return datetime.now(LOCAL_TZ).date()


def _read_salt(day: str) -> str | None:
    rows = web_table(SALTS).select("salt").eq("viewed_on", day).limit(1).execute().data or []
    return rows[0]["salt"] if rows else None


def day_salt(day: date) -> str:
    """The day's salt, 64 hex digits; the day's first view makes it and deletes the earlier days' salts."""
    key = day.isoformat()
    salt = _read_salt(key)
    if salt is None:
        try:
            web_table(SALTS).insert({"viewed_on": key, "salt": secrets.token_hex(32)}).execute()
        except APIError as exc:
            if getattr(exc, "code", None) != "23505":
                raise  # 23505: another view made it first
        salt = _read_salt(key)
        # Once a day is over its rows can no longer be linked to anyone.
        web_table(SALTS).delete().lt("viewed_on", key).execute()
    return salt


def visitor_hash(salt: str, listing_id: str, day: date, viewer: str) -> str:
    """What a row keeps of its viewer: 64 hex digits, different for every listing and day."""
    return hmac.new(bytes.fromhex(salt), f"{listing_id}|{day.isoformat()}|{viewer}".encode(), hashlib.sha256).hexdigest()


def _within_limit(salt: str, client_host: str | None) -> bool:
    """One more signed-out view from this address in the window; False past VISITOR_VIEWS_PER_WINDOW.

    The key is an HMAC of the address under the day's salt: the database keeps
    no address. The address is the socket's unless uvicorn trusts a proxy's
    forwarded headers (docs/password-reset.md, "Behind a proxy").
    """
    if not client_host:
        return True
    key = hmac.new(bytes.fromhex(salt), f"listing-views|{client_host}".encode(), hashlib.sha256).hexdigest()
    allowed = get_supabase_client().rpc("consume_api_rate_limit", {
        "p_key_hash": key, "p_limit": VISITOR_VIEWS_PER_WINDOW, "p_window_seconds": VIEW_WINDOW_SECONDS,
    }).execute().data
    return allowed is not False


def record_view(listing_id: str, viewer: CurrentProfile | None, visitor_id: str | None, *,
                token_refused: bool = False, client_host: str | None = None) -> bool:
    """Count one view of a listing anyone may open, at most once a day per viewer; True when it counted.

    404 for a listing that is not open to everyone, as GET /properties/{id}
    answers. A signed-out request must carry its browser's visitor id (422),
    and counts only while its address is within the limit (_within_limit).
    """
    listing = properties_service.listing_row(listing_id)
    if not listing or listing.get("status") not in PUBLIC_LISTING_STATUSES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, properties_service.NOT_FOUND)
    if token_refused:
        return False
    if viewer is not None:
        if viewer.role in STAFF_ROLES:
            return False
        if properties_service.owns(properties_service.listing_property(listing), viewer.id):
            return False
        who = f"member:{viewer.id}"
    elif visitor_id:
        who = f"visitor:{visitor_id}"
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, NEEDS_VISITOR_ID)
    day = _today()
    try:
        salt = day_salt(day)
        if viewer is None and not _within_limit(salt, client_host):
            return False
        row = {"listing_id": listing["id"], "viewed_on": day.isoformat(),
               "visitor_hash": visitor_hash(salt, listing["id"], day, who)}
        web_table(TABLE).insert(row).execute()
    except APIError as exc:
        if getattr(exc, "code", None) == "23505":
            return False  # this viewer's view of the listing today is counted already
        if _missing_table(exc):
            logger.warning("Listing views are not counted: apply supabase/shared/0005_listing_views.sql")
            return False
        raise
    return True


def _count(listing_id: str, since: date | None, until: date | None = None) -> int:
    """The database's count of a listing's views from since on (to until, inclusive): no row is read."""
    try:
        query = web_table(TABLE).select("id", count="exact", head=True).eq("listing_id", listing_id)
        if since is not None:
            query = query.gte("viewed_on", since.isoformat())
        if until is not None:
            query = query.lte("viewed_on", until.isoformat())
        return query.execute().count or 0
    except APIError as exc:
        if _missing_table(exc):
            raise ViewsUnavailable from exc
        raise


def period_counts(listing_ids: list[str], since: date) -> dict[str, int]:
    """{listing id: views from since on}, one head count per listing; ViewsUnavailable before 0005."""
    return {listing_id: _count(listing_id, since) for listing_id in dict.fromkeys(listing_ids)}


def daily_counts(listing_ids: list[str], since: date, until: date | None = None) -> dict[str, Counter]:
    """{listing id: Counter({"YYYY-MM-DD": views})} for the listings' views from since on, Sydney days.

    A listing with at most ROW_READ_LIMIT views in the range is read as rows;
    one with more is counted a day at a time by the database, so a flood of
    views costs a bounded number of requests. ViewsUnavailable before 0005.
    """
    until = until or _today()
    counts: dict[str, Counter] = {}
    for listing_id in dict.fromkeys(listing_ids):
        in_range = _count(listing_id, since, until)
        if not in_range:
            continue
        if in_range <= ROW_READ_LIMIT:
            rows = select_in(
                lambda: web_table(TABLE).select("listing_id, viewed_on").gte("viewed_on", since.isoformat())
                .lte("viewed_on", until.isoformat()).order("id"),
                "listing_id",
                [listing_id],
            )
            counts[listing_id] = Counter(str(row["viewed_on"])[:10] for row in rows)
            continue
        days = Counter()
        day = since
        while day <= until:
            days[day.isoformat()] = _count(listing_id, day, day)
            day += timedelta(days=1)
        counts[listing_id] = +days
    return counts


def total(listing_id: str) -> int:
    """Every view of a listing counted so far; ViewsUnavailable before 0005."""
    return _count(listing_id, None)
