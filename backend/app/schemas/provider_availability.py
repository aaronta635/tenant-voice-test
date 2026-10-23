from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, model_validator

ClockTime = Annotated[str, StringConstraints(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$")]


class AvailabilityCreate(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: ClockTime
    end_time: ClockTime
    is_available: bool = True

    @model_validator(mode="after")
    def ordered_times(self):
        if self.start_time[:5] >= self.end_time[:5]:
            raise ValueError("End time must be after start time")
        return self


class AvailabilityUpdate(BaseModel):
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    start_time: ClockTime | None = None
    end_time: ClockTime | None = None
    is_available: bool | None = None


class AvailabilityOut(BaseModel):
    id: str
    provider_id: str
    day_of_week: int
    start_time: str
    end_time: str
    is_available: bool
