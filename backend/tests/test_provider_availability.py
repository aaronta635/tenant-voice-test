"""Weekly hours live in web.provider_availability, keyed by the provider's users.id.

Validation prevents malformed or partial updates corrupting saved hours.
"""

import pytest

from tests.factories import make_availability
from tests.factories_provider_core import seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER = "a0000000-0000-4000-8000-000000000001"
OTHER = "a0000000-0000-4000-8000-000000000002"
MONDAY = "b0000000-0000-4000-8000-000000000001"
FOREIGN = "b0000000-0000-4000-8000-000000000002"


def hours(id, provider_id, day, start, end, **over):
    return make_availability(provider_id, day, start, end, id=id, **over)


@pytest.fixture
def provider_hours(strict_schema, as_profile):
    seed_provider(strict_schema, PROVIDER)
    seed_provider(strict_schema, OTHER)
    strict_schema.seed("provider_availability", [hours(MONDAY, PROVIDER, 1, "09:00:00", "17:00:00")], schema="web")
    as_profile(PROVIDER)
    return strict_schema


def _saved(db):
    return db.schema_tables["web"]["provider_availability"]


def test_hours_are_created_listed_and_shown_publicly(client, provider_hours):
    created = client.post("/api/v1/me/availability", json={"day_of_week": 0, "start_time": "10:00", "end_time": "14:00"})

    assert created.status_code == 201, created.text
    assert created.json()["provider_id"] == PROVIDER
    assert [row["day_of_week"] for row in client.get("/api/v1/me/availability").json()] == [0, 1]
    assert [row["id"] for row in client.get(f"/api/v1/providers/{PROVIDER}/availability").json()] == [
        created.json()["id"], MONDAY,
    ]


@pytest.mark.parametrize("start,end", [
    ("", "17:00"), ("09:00", ""), ("25:00", "26:00"),
    ("09:00", "09:00"), ("17:00", "09:00"), ("9:00", "17:00"),
])
def test_invalid_schedule_creation_has_no_side_effects(client, provider_hours, start, end):
    response = client.post("/api/v1/me/availability", json={
        "day_of_week": 2, "start_time": start, "end_time": end,
    })
    assert response.status_code == 422
    assert len(_saved(provider_hours)) == 1


@pytest.mark.parametrize("patch", [
    {"start_time": "18:00"}, {"end_time": "08:00"}, {"start_time": "17:00"},
    {"start_time": ""}, {"end_time": ""},
])
def test_partial_patch_checks_complete_time_range(client, provider_hours, patch):
    before = dict(_saved(provider_hours)[0])
    response = client.patch(f"/api/v1/me/availability/{MONDAY}", json=patch)
    assert response.status_code == 422
    assert _saved(provider_hours)[0] == before


def test_valid_partial_patch_preserves_other_time(client, provider_hours):
    response = client.patch(f"/api/v1/me/availability/{MONDAY}", json={"start_time": "10:30"})
    assert response.status_code == 200
    assert response.json()["start_time"] == "10:30"
    assert response.json()["end_time"] == "17:00:00"
    assert len(_saved(provider_hours)) == 1


def test_cannot_edit_or_delete_another_providers_hours(client, provider_hours):
    provider_hours.seed("provider_availability", [hours(FOREIGN, OTHER, 3, "09:00", "17:00")], schema="web")
    assert client.patch(f"/api/v1/me/availability/{FOREIGN}", json={"end_time": "18:00"}).status_code == 404
    assert client.delete(f"/api/v1/me/availability/{FOREIGN}").status_code == 404
    assert next(row for row in _saved(provider_hours) if row["id"] == FOREIGN)["end_time"] == "17:00"


@pytest.mark.parametrize("field", ["start_time", "end_time"])
def test_omitted_optional_time_as_null_is_noop_and_cannot_corrupt_schedule(client, provider_hours, field):
    before = dict(_saved(provider_hours)[0])
    response = client.patch(f"/api/v1/me/availability/{MONDAY}", json={field: None})
    assert response.status_code == 200
    assert _saved(provider_hours)[0] == before


def test_deleting_hours_removes_them(client, provider_hours):
    assert client.delete(f"/api/v1/me/availability/{MONDAY}").status_code == 204
    assert _saved(provider_hours) == []
