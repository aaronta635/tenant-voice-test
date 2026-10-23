from fastapi import APIRouter, Depends, Response, status

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.core.officer import get_current_officer
from app.schemas.housing_portal import (
    AggregatesOut,
    ComplaintSummaryOut,
    DatapointRequestIn,
    DatapointRequestOut,
    DatapointResponseIn,
    FlagStatusIn,
    HousingOverviewOut,
    OfficerMeOut,
    RedFlagsOut,
    ReferralActionIn,
    ReferralOut,
    ReferralUpdateOut,
    RegulatoryFlagOut,
    SurveyIn,
    SurveyOut,
    SurveyStatusIn,
)
from app.services import housing_portal

# Every route here depends on get_current_officer (an ACTIVE REGULATOR): the
# check is on the server, on each request, whatever the browser shows.
router = APIRouter(prefix="/housing", tags=["housing"])
# The admins' side of the officers' data category requests: get_current_admin.
admin_router = APIRouter(prefix="/admin/datapoint-requests", tags=["admin"])


@router.get("/me", response_model=OfficerMeOut)
def officer_me(current: CurrentProfile = Depends(get_current_officer)):
    """The signed-in officer, for the portal's header; 403 for anyone else."""
    return {"id": current.id, "full_name": current.full_name, "email": current.raw.get("email")}


@router.get("/overview", response_model=HousingOverviewOut)
def overview(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.overview(current)


@router.get("/referrals", response_model=list[ReferralOut])
def referrals(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.referrals(current)


@router.post("/referrals/{referral_id}/actions", response_model=ReferralUpdateOut)
def act_on_referral(referral_id: str, payload: ReferralActionIn, current: CurrentProfile = Depends(get_current_officer)):
    """Start the review of a referral, mark its package ready, or close it, with an optional note."""
    return housing_portal.act_on_referral(current, referral_id, payload.action, payload.note)


@router.get("/red-flags", response_model=RedFlagsOut)
def red_flags(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.red_flags()


@router.patch("/red-flags/alerts/{flag_id}", response_model=RegulatoryFlagOut)
def set_flag_status(flag_id: str, payload: FlagStatusIn, current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.set_flag_status(current, flag_id, payload.status, payload.from_status)


@router.get("/complaints", response_model=ComplaintSummaryOut)
def complaints(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.complaint_summary()


@router.get("/datapoint-requests", response_model=list[DatapointRequestOut])
def datapoint_requests(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.list_requests()


@router.post("/datapoint-requests", response_model=DatapointRequestOut, status_code=status.HTTP_201_CREATED)
def request_datapoint_change(
    payload: DatapointRequestIn, response: Response, current: CurrentProfile = Depends(get_current_officer)
):
    """Ask the admins to change a datapoint; the same pending request sent again comes back with 200."""
    request, created = housing_portal.create_request(current, payload.datapoint, payload.requested_change, payload.reason)
    if not created:
        response.status_code = status.HTTP_200_OK
    return request


@router.get("/surveys", response_model=list[SurveyOut])
def surveys(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.surveys()


@router.post("/surveys", response_model=SurveyOut, status_code=status.HTTP_201_CREATED)
def create_survey(payload: SurveyIn, current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.create_survey(current, payload.model_dump())


@router.patch("/surveys/{survey_id}", response_model=SurveyOut)
def set_survey_status(survey_id: str, payload: SurveyStatusIn, current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.set_survey_status(current, survey_id, payload.status, payload.from_status)


@router.get("/aggregates", response_model=AggregatesOut)
def aggregates(current: CurrentProfile = Depends(get_current_officer)):
    return housing_portal.aggregates()


@admin_router.get("", response_model=list[DatapointRequestOut])
def admin_datapoint_requests(current: CurrentProfile = Depends(get_current_admin)):
    return housing_portal.list_requests()


@admin_router.patch("/{request_id}", response_model=DatapointRequestOut)
def answer_datapoint_request(
    request_id: str, payload: DatapointResponseIn, current: CurrentProfile = Depends(get_current_admin)
):
    """Accept, decline or complete an officer's request, with a response the officer reads."""
    return housing_portal.respond_to_request(current, request_id, payload.status, payload.response, payload.from_status)
