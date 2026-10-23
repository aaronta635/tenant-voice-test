from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.upload_scanning import UploadScanningOut
from app.services import uploads as uploads_service

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.get("/scanning", response_model=UploadScanningOut)
def scanning(_current: CurrentProfile = Depends(get_current_profile)):
    """Whether uploads are virus-scanned, for the labels on files other people sent."""
    return {"enabled": uploads_service.scanner_configured()}
