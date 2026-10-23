from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.auth import AuthOut, LoginIn, RefreshIn, RegisterIn
from app.schemas.profiles import ProfileOut
from app.services import auth as auth_service
from app.services import profiles as profiles_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn):
    return auth_service.register(
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        role=payload.role,
    )


@router.post("/login", response_model=AuthOut)
def login(payload: LoginIn):
    return auth_service.login(
        email=payload.email, password=payload.password, role=payload.role
    )


@router.post("/refresh", response_model=AuthOut)
def refresh(payload: RefreshIn):
    return auth_service.refresh(refresh_token=payload.refresh_token)


@router.get("/me", response_model=ProfileOut)
def me(current: CurrentProfile = Depends(get_current_profile)):
    return profiles_service.get_profile(current.id)
