"""Providers as the admin console suspends and enables them (tracker R18, assumption #14).

An admin suspends or enables a provider with the account status control
(admin_users.change_status), and the rest follows from users.status:

- Suspended: the marketplace and search hide them (service_providers,
  public_profiles), and the gates refuse them new bookings, repairs and
  going live (gates.require_verified). They still sign in, to finish the
  jobs in progress and read past messages and invoices (maps_identity).
- Enabled, that is ACTIVE again: listed again while their profile is live.
  Only an approved provider is enabled (enable_lock): a profile that was
  live is listed at once and never passes the go_live gate again. Going
  live still needs a verified account, which the go_live gate checks.

When a provider stops taking work (suspended, or deactivated, which also
signs them out), the client of each of their confirmed bookings from today
on is told, with a link to their bookings. The booking stays as it is, for
the client to cancel. This module only reads web.bookings, which
bookings.py writes, and notifies through notifications.notify().
"""

import logging
from datetime import date, datetime

from app.core.supabase import web_table
from app.services import _common, bookings, gates, notifications, service_providers
from app.services.shared_map import web_role

logger = logging.getLogger(__name__)

PROVIDER = "service_provider"
# users.status values that take a provider off the marketplace and out of new work.
OUT_OF_WORK = frozenset({"SUSPENDED", "DEACTIVATED"})
NOT_APPROVED = (
    "Only an approved provider can be enabled. Approve their verification first, then enable the account."
)
CONFIRMED = "confirmed"
IN_PROGRESS = "in_progress"
# Where a client of each web role keeps their bookings; the notice links there.
CLIENT_BOOKINGS_PATH = {
    "tenant": "/tenant/bookings",
    "landlord": "/owner/bookings",
    "service_provider": "/dashboard/client-bookings",
}


def _today() -> date:
    return datetime.now(bookings.LOCAL_TZ).date()


def _open_jobs(provider_id: str) -> list[dict]:
    """The provider's confirmed bookings and jobs in progress, as web.bookings rows."""
    return _common.select_all(
        lambda: web_table(bookings.TABLE)
        .select("*")
        .eq("provider_id", provider_id)
        .in_("status", [CONFIRMED, IN_PROGRESS])
        .order("id")
    )


def _upcoming(job: dict, today: date) -> bool:
    """A confirmed booking that has not happened yet: dated today or later, or not dated yet."""
    if job.get("status") != CONFIRMED:
        return False
    day = job.get("scheduled_date")
    return not day or date.fromisoformat(str(day)[:10]) >= today


def provider_out(user: dict) -> dict | None:
    """The account page's provider section (AdminProviderOut); None for an account that is not a provider."""
    if web_role(user.get("primary_role")) != PROVIDER:
        return None
    today = _today()
    jobs = _open_jobs(user["id"])
    return {
        **service_providers.marketplace_state(user["id"]),
        "standing": gates.standing(user["id"]).state,
        "upcoming_bookings": sum(1 for job in jobs if _upcoming(job, today)),
        "jobs_in_progress": sum(1 for job in jobs if job["status"] == IN_PROGRESS),
    }


def enable_lock(user: dict, new_status: str) -> str | None:
    """Why an admin may not set this account to new_status now; None when they may.

    Enabling a provider, ACTIVE again from OUT_OF_WORK, needs an approved
    verification, the account's and the profile's (gates.verification_state,
    tracker R18): a profile that was live would be listed again at once,
    while its verification is back in review. Any other change is no
    concern of this module.
    """
    enabling = new_status == "ACTIVE" and user.get("status") in OUT_OF_WORK
    if not enabling or web_role(user.get("primary_role")) != PROVIDER:
        return None
    return None if gates.verification_state(user) == gates.APPROVED else NOT_APPROVED


def _notice(booking: dict) -> tuple[str, str]:
    """The title and body that tell a client their confirmed booking may not go ahead."""
    name = booking.get("provider_name")
    # The same summary as the booking's other notices: service, suburb and time.
    summary = bookings._summary(booking)
    title = f"Your booking with {name} may not go ahead" if name else "Your booking may not go ahead"
    body = (
        f"{name or 'Your provider'} can't take on work on TenantVoice for now. "
        "You can cancel this booking from your bookings."
    )
    return title, f"{summary}. {body}" if summary else body


def after_status_change(user: dict, old_status: str | None, new_status: str) -> int:
    """Tell the clients of a provider's confirmed upcoming bookings once the provider stops taking work.

    Only a move into OUT_OF_WORK from outside it: a suspension that becomes
    a deactivation has told them already. One notice per booking. Returns
    how many notices were written, which the admin is told. Never raises:
    the status change it follows has already happened, so a failure is
    logged as an error.
    """
    if web_role(user.get("primary_role")) != PROVIDER or new_status not in OUT_OF_WORK or old_status in OUT_OF_WORK:
        return 0
    told = 0
    try:
        today = _today()
        upcoming = [job for job in _open_jobs(user["id"]) if _upcoming(job, today)]
        clients = bookings.people_by_id(job["client_id"] for job in upcoming)
        for booking in bookings.decorate(upcoming):
            title, body = _notice(booking)
            role = (clients.get(booking["client_id"]) or {}).get("role")
            if notifications.notify(booking["client_id"], "booking", title, body, CLIENT_BOOKINGS_PATH.get(role)):
                told += 1
    except Exception:
        logger.exception("could not tell the clients of provider %s about their upcoming bookings", user["id"])
    return told
