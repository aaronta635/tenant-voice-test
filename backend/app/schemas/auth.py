from pydantic import BaseModel, Field, field_validator

from app.schemas.profiles import ProfileOut

# Roles a user is allowed to self-register as. Privileged roles (officer, admin)
# are provisioned out-of-band, never through the public register endpoint.
REGISTERABLE_ROLES = ["tenant", "landlord", "service_provider"]


class RegisterIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1)
    role: str = "tenant"

    @field_validator("full_name", "email", mode="before")
    @classmethod
    def trim_identity(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class LoginIn(BaseModel):
    email: str
    password: str
    # The role tab the user picked. Optional so existing API clients keep
    # working, but when present the account must actually hold that role -
    # otherwise picking "Client" and typing a landlord's address would sign
    # you in as that landlord.
    role: str | None = None


class RefreshIn(BaseModel):
    refresh_token: str


class AuthOut(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_at: int | None = None
    profile: ProfileOut
