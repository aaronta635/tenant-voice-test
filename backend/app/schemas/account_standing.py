"""Where the caller's own account stands for the verification gates (services/gates.py, tracker R18).

The provider workspace reads it to say why a suspended account can no longer
take new work (assumption #14), before an action is refused.
"""

from typing import Literal

from pydantic import BaseModel

# gates.standing(): approved, or why the gates refuse new work.
StandingState = Literal["approved", "pending", "rejected", "unknown", "suspended", "inactive"]


class AccountStandingOut(BaseModel):
    state: StandingState
