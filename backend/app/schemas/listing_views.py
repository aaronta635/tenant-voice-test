from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

# The random id a browser keeps for its signed-out visitor (frontend lib/listing-views.ts).
VisitorId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9-]{16,64}$")]


class ListingViewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Needed while signed out; a signed-in member counts as their account instead.
    visitor_id: VisitorId | None = None


class ListingViewOut(BaseModel):
    # False when this viewer's view of the listing today was counted already, or is not counted.
    counted: bool
