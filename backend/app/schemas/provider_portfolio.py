from datetime import datetime

from pydantic import BaseModel


class PortfolioItemCreate(BaseModel):
    title: str | None = None
    description: str | None = None
    image_url: str
    sort_order: int = 0


class PortfolioItemUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    sort_order: int | None = None


class PortfolioItemOut(BaseModel):
    id: str
    provider_id: str
    title: str | None = None
    description: str | None = None
    image_url: str
    sort_order: int
    created_at: datetime
