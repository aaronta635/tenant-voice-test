import re

from pydantic import BaseModel, Field, field_validator

_EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+$")


class ForgotPasswordIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email", mode="before")
    @classmethod
    def trim_email(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def looks_like_an_email(cls, value: str) -> str:
        # Only the shape: whether the address has an account is never checked here.
        if not _EMAIL_SHAPE.match(value):
            raise ValueError("Enter a valid email address")
        return value


class ResetPasswordIn(BaseModel):
    # The recovery session's access token, from the emailed link's URL fragment.
    access_token: str = Field(min_length=1, max_length=8192)
    # Sign-up's rule (RegisterIn.password); tests/test_password_reset.py keeps them equal.
    password: str = Field(min_length=8)


class PasswordResetOut(BaseModel):
    message: str
