from pydantic import BaseModel


class AvailabilityCreate(BaseModel):
    day_of_week: int
    start_time: str
    end_time: str
    is_available: bool = True


class AvailabilityUpdate(BaseModel):
    day_of_week: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    is_available: bool | None = None


class AvailabilityOut(BaseModel):
    id: str
    provider_id: str
    day_of_week: int
    start_time: str
    end_time: str
    is_available: bool
