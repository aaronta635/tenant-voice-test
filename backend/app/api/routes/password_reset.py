from fastapi import APIRouter, BackgroundTasks, Request, status

from app.schemas.password_reset import ForgotPasswordIn, PasswordResetOut, ResetPasswordIn
from app.services import password_reset as password_reset_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/forgot-password", response_model=PasswordResetOut, status_code=status.HTTP_202_ACCEPTED)
def forgot_password(payload: ForgotPasswordIn, request: Request, background_tasks: BackgroundTasks):
    password_reset_service.claim_request(payload.email, request.client.host if request.client else None)
    # After the response, so how long Supabase takes never shows whether the account exists.
    background_tasks.add_task(password_reset_service.send_reset_email, payload.email)
    return {"message": password_reset_service.REQUEST_ACCEPTED}


@router.post("/reset-password", response_model=PasswordResetOut)
def reset_password(payload: ResetPasswordIn):
    password_reset_service.reset_password(payload.access_token, payload.password)
    return {"message": password_reset_service.PASSWORD_UPDATED}
