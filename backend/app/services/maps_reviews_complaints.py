"""Shared-schema values for complaints, repairs and reviews.

The row mappers (flatten_complaint, flatten_maintenance, flatten_review and
flatten_inspection_slot) are in shared_map; these are the values the
services write to and read from the shared tables around them (migration
plan §3 a6, a7 and b3). The DTOs stay as they are.
"""

# complaint_events.event_type: one row per step taken on a complaint or a
# repair, the case timeline both apps share (plan §3 b3). The column is free
# text and the mobile app's own labels are not known yet (Appendix A1).
EVENT_CREATED = "CREATED"
EVENT_UPDATED = "UPDATED"
EVENT_RESPONDED = "RESPONDED"
EVENT_ASSIGNED = "ASSIGNED"
EVENT_STATUS_CHANGED = "STATUS_CHANGED"


def complaint_event(complaint_id: str, actor_id: str | None, event_type: str, note: str | None = None,
                    **details) -> dict:
    """A complaint_events row for one step taken on the web; details go into metadata."""
    return {
        "complaint_id": complaint_id,
        "actor_user_id": actor_id,
        "event_type": event_type,
        "note": note,
        "metadata": {"source": "web", **details},
    }


# complaints.severity behind a repair's priority, and back. The web has
# three priorities; the mobile app's CRITICAL reads as urgent.
PRIORITY_TO_SEVERITY = {"low": "LOW", "normal": "MEDIUM", "urgent": "HIGH"}
SEVERITY_TO_PRIORITY = {"LOW": "low", "MEDIUM": "normal", "HIGH": "urgent", "CRITICAL": "urgent"}

# maintenance_work_orders.status once a worker is assigned (reads as in_progress).
MAINT_ASSIGNED = "ASSIGNED"
# Where a repair's web status moves its complaint: the case is over.
REPAIR_TO_COMPLAINT_STATUS = {"resolved": "RESOLVED", "cancelled": "CLOSED"}


# ReviewStatus values a review about someone is listed with. HIDDEN and
# ARCHIVED are moderators' decisions, so those reviews stay out; a FLAGGED one
# is shown as reported until a moderator decides (plan §3 a8).
VISIBLE_REVIEW_STATUSES = ("PUBLISHED", "FLAGGED")
# What a property's public review list shows, as its review counts do (§3 a6).
PUBLISHED_REVIEW = "PUBLISHED"
