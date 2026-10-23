from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.provider_jobs import ProviderJobOut, ProviderJobStatusIn
from app.services import provider_jobs as provider_jobs_service

router = APIRouter(prefix="/me/job-requests", tags=["provider-jobs"])

provider_only = require_role("service_provider")


@router.get("", response_model=list[ProviderJobOut])
def list_my_job_requests(current: CurrentProfile = Depends(provider_only)):
    """The job requests owners sent the caller from the mobile app (mobile_ai_jobs), newest first."""
    return provider_jobs_service.list_jobs(current)


@router.post("/{job_id}/status", response_model=ProviderJobOut)
def move_my_job_request(job_id: str, payload: ProviderJobStatusIn, current: CurrentProfile = Depends(provider_only)):
    """Accept, decline, start or complete a job request (mobile_ai_provider_job); the owner is told."""
    return provider_jobs_service.set_status(job_id, current, payload.status)
