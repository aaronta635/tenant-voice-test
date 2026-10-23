"""What a member's card or profile page needs to connect with them (R23, R24).

ConnectionStateOut is the signed-in viewer's state with one member, as
services/connections.py works it out from connection_requests (tracker
assumption #3); the Connect button offers only what that state allows.
"""

from typing import Literal

from pydantic import BaseModel

from app.schemas.connections import ProfileSearchOut

ConnectionState = Literal["self", "unavailable", "none", "sent", "received", "connected", "declined"]


class ConnectionStateOut(BaseModel):
    user_id: str
    # self: their own profile. unavailable: staff on either side, an account
    # that is not an active member, or a pair blocked in the mobile app.
    # none: they may send a request. sent: theirs waits, and they may
    # withdraw it. received: they may accept or decline. declined: the other
    # declined their request, and only the other may send a new one.
    state: ConnectionState
    # The request the state comes from, to answer or withdraw it.
    connection_id: str | None = None


class MemberSearchOut(ProfileSearchOut):
    # The rating and verified badge the member's profile shows
    # (public_profiles.trust_of); rating_avg is None until there is a review.
    rating_avg: float | None = None
    review_count: int = 0
    verified: bool = False
    connection: ConnectionStateOut
