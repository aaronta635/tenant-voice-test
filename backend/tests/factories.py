"""Values and rows several test modules share; each area's own rows are in tests/factories_*.py."""

NOW = "2026-01-01T00:00:00+00:00"


def make_availability(provider_id, day_of_week=1, start_time="09:00:00", end_time="17:00:00", **over) -> dict:
    """A web.provider_availability window; day_of_week counts from Sunday (0).

    Without an id, the column default gives the row one.
    """
    row = {
        "provider_id": provider_id,
        "day_of_week": day_of_week,
        "start_time": start_time,
        "end_time": end_time,
        "is_available": True,
    }
    row.update(over)
    return row
