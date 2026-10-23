"""Who gets the verified badge, wherever a profile appears.

One rule for search cards, public profiles and, later, the provider pages
(tracker R17, R23): an admin approved the account. Profile documents and the
role profiles' own verification_status columns do not count on their own.
"""

# users.verification_status is free text (default PENDING). The admin review
# writes one of these once it approves the account.
VERIFIED_STATUSES = frozenset({"APPROVED", "VERIFIED"})


def is_verified(verification_status: str | None) -> bool:
    """Whether a users row's verification_status earns the verified badge."""
    if not isinstance(verification_status, str):
        return False
    return verification_status.strip().upper() in VERIFIED_STATUSES
