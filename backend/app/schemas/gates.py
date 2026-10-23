"""A verification gate's refusal as a response field (services/gates.py, tracker R18).

Most gated actions answer 403 with this detail. An endpoint that still
answers without the action, such as matching without the paid model, puts
it in its response instead (gates.refusal()).
"""

from typing import Literal

from pydantic import BaseModel


class GateRefusalOut(BaseModel):
    code: Literal["verification_required"]
    # The gated action (gates.ACTIONS), such as paid_ai.
    action: str
    # Why: pending, rejected or unknown (the verification), suspended or inactive (the account).
    status: str
    # A sentence for the person, in the action's words.
    message: str
    # Their role's documents page while documents can change the answer; None otherwise.
    documents_href: str | None = None
