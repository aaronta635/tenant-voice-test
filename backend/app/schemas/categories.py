from pydantic import BaseModel


class CategoryOut(BaseModel):
    slug: str
    category: str
    name: str
    description: str
    icon_bg: str | None = None
    badge: str | None = None
    sort_order: int = 0
    provider_count: int = 0
    from_price: float | None = None
