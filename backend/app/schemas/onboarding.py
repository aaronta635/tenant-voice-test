"""Where a tenant or landlord is in the web's onboarding (R19).

GET and PUT /me/onboarding read and save users.metadata.onboarding.<role>:
the wizard step to resume at and when the member finished
(docs/shared-db.md, "Onboarding"). The wizard saves the profile itself
through PATCH /profiles/me and the documents through /me/documents.
Providers have their own wizard, which works its step out from the
provider profile.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StrictBool, StringConstraints

OnboardingRole = Literal["tenant", "landlord"]
# A wizard step's name, such as "rent-timing". The wizards own the list, so a
# step they drop later reads back as it was stored and they start over.
STEP_PATTERN = r"[a-z][a-z0-9-]{0,39}"
StepName = Annotated[str, StringConstraints(pattern=f"^{STEP_PATTERN}$")]


class OnboardingOut(BaseModel):
    role: OnboardingRole
    # The step to resume at; null until the member first saves one.
    step: str | None = None
    # When the member first finished; null until then. Going through the steps again keeps it.
    completed_at: datetime | None = None


class OnboardingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: StepName
    # True from the last step: onboarding is finished from then on.
    completed: StrictBool = False
