from datetime import date
from typing import Literal

from pydantic import BaseModel


class SeriesOut(BaseModel):
    key: str
    label: str
    # One count per period, oldest first.
    counts: list[int]
    total: int


class CategoryCountOut(BaseModel):
    code: str
    label: str
    count: int


class StatusCountOut(BaseModel):
    status: str
    label: str
    count: int


class AnalyticsTotalsOut(BaseModel):
    users: int
    listings: int
    applications: int
    complaints: int
    reviews: int


class AnalyticsOut(BaseModel):
    days: int
    granularity: Literal["day", "week", "month"]
    start: date
    end: date
    # The first day of each period, oldest first (Sydney's calendar).
    periods: list[date]
    series: list[SeriesOut]
    # Of all time: open accounts, and every listing, application, complaint and review.
    totals: AnalyticsTotalsOut
    complaints_by_category: list[CategoryCountOut]
    complaints_by_status: list[StatusCountOut]
    reviews_by_status: list[StatusCountOut]
