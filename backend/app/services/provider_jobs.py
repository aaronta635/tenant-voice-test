"""Job requests owners send a provider from the mobile app (mobile_ai_service_jobs, tracker R33).

An owner asks a provider for a job through the mobile app's assistant
(mobile_ai_provider_job, action create), and assigning a repair writes one
too (mobile_assign_repair, request.source maintenance). The web lists the
provider's own (mobile_ai_jobs) and moves them on through
mobile_ai_provider_job, both run as the provider: pending to accepted or
declined, accepted to in progress, in progress to completed. The owner
cancels a pending or accepted one from the mobile app. The function writes
the job and tells the other party; the web writes nothing itself.
"""

from fastapi import HTTPException, status

from app.core.deps import CurrentProfile
from app.core.supabase import user_client
from app.services.maps_messaging import is_uuid
from app.services.maps_provider_core import run_function

# mobile_ai_service_jobs.payload.status as the web names it.
JOB_TO_WEB = {
    "pending": "pending", "accepted": "accepted", "declined": "declined", "inProgress": "in_progress",
    "completed": "completed", "cancelled": "cancelled",
}
WEB_TO_JOB = {web: job for job, web in JOB_TO_WEB.items()}
# The moves mobile_ai_provider_job lets the provider make.
NEXT_STATUSES = {"pending": ("accepted", "declined"), "accepted": ("in_progress",), "in_progress": ("completed",)}
JOB_NOT_FOUND = "Job request not found"


def _job(payload: dict, job_id: str | None = None) -> dict:
    """A job's payload as ProviderJobOut."""
    state = JOB_TO_WEB.get(payload.get("status"), "pending")
    return {
        "id": job_id or payload["id"],
        "title": payload.get("title") or "Job request",
        "description": payload.get("description") or None,
        "status": state,
        "owner_id": payload.get("ownerId"),
        "owner_name": payload.get("ownerName") or None,
        "property_title": payload.get("propertyTitle") or None,
        "listing_id": payload.get("propertyId"),
        # Assigning a repair writes one: its visit is booked from the repairs page.
        "from_repair": bool(payload.get("complaintId")),
        "created_at": payload.get("createdAt"),
        "next_statuses": list(NEXT_STATUSES.get(state, ())),
    }


def _mine(current: CurrentProfile) -> list[dict]:
    jobs = run_function(user_client(current.access_token).rpc("mobile_ai_jobs", {})) or []
    return [job for job in jobs if isinstance(job, dict) and job.get("providerId") == current.id and job.get("id")]


def list_jobs(current: CurrentProfile) -> list[dict]:
    """The job requests sent to the provider, newest first."""
    return [_job(job) for job in _mine(current)]


def set_status(job_id: str, current: CurrentProfile, new_status: str) -> dict:
    """Accept, decline, start or complete a job request; 409 for a move the function does not allow."""
    if not is_uuid(job_id) or not any(job["id"] == job_id for job in _mine(current)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, JOB_NOT_FOUND)
    payload = run_function(
        user_client(current.access_token).rpc("mobile_ai_provider_job", {
            "p_action": {"action": "status", "jobId": job_id, "status": WEB_TO_JOB[new_status]},
        }),
        # raise exception '...' without a code: P0001, here "Invalid job status change."
        {"P0001": status.HTTP_409_CONFLICT},
    )
    return _job(payload, job_id)
