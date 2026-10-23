from typing import Literal

from pydantic import BaseModel

# gates.Standing.state: approved, or why the gates refuse the account new work.
GateStanding = Literal["approved", "pending", "rejected", "unknown", "suspended", "inactive"]


class AdminProviderOut(BaseModel):
    """A provider account on the marketplace, as the admin console shows it (R18)."""

    has_profile: bool
    # The provider made their profile live.
    published: bool
    # The marketplace shows them now: live, with an open, ACTIVE account.
    listed: bool
    # Whether they may accept bookings, take on repairs and go live, or why not.
    standing: GateStanding
    # Confirmed bookings from today on (or not dated yet), and jobs in progress.
    upcoming_bookings: int
    jobs_in_progress: int
