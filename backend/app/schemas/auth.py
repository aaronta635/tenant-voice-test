from pydantic import BaseModel, Field

from app.schemas.profiles import ProfileOut

# Roles a user is allowed to self-register as. Privileged roles (officer, admin)
# are provisioned out-of-band, never through the public register endpoint.
REGISTERABLE_ROLES = ["tenant", "landlord", "service_provider"]


class RegisterIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1)
    role: str = "tenant"


class LoginIn(BaseModel):
    email: str
    password: str


class AuthOut(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_at: int | None = None
    profile: ProfileOut
