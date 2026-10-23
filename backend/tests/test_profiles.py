"""Reading and editing your own profile: the shared users row (strict fake).

Regression cover: an edit never moved users.updated_at, which has no default
or trigger on the shared database.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from app.services import profiles as profiles_service
from tests.factories import NOW
from tests.factories_identity import users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = "c0000000-0000-4000-8000-000000000001"
NOBODY = "c0000000-0000-4000-8000-0000000000ff"


@pytest.fixture
def mei(strict_schema, as_profile):
    strict_schema.seed("users", [users_row(
        MEI, "mei@demo.test", full_name="Jon", phone="0400 000 000",
        metadata={"location": "Newtown", "state": "NSW", "postcode": "2042"},
    )])
    as_profile(id=MEI, role="tenant")
    return strict_schema


def _stored(fake_db) -> dict:
    [row] = fake_db.tables["users"]
    return row


def _when(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_get_profile_unknown_id_is_404():
    with pytest.raises(HTTPException) as exc:
        profiles_service.get_profile(NOBODY)
    assert exc.value.status_code == 404


def test_a_closed_profile_is_404(strict_schema):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", deleted_at=NOW)])
    with pytest.raises(HTTPException) as exc:
        profiles_service.get_profile(MEI)
    assert exc.value.status_code == 404


def test_the_profile_shows_the_shared_email_and_metadata(client, mei):
    body = client.get("/api/v1/profiles/me").json()
    assert (body["id"], body["email"], body["role"]) == (MEI, "mei@demo.test", "tenant")
    assert (body["location"], body["state"], body["postcode"]) == ("Newtown", "NSW", "2042")


def test_update_profile_leaves_unsent_fields_alone(client, mei):
    response = client.patch("/api/v1/profiles/me", json={"location": "Marrickville"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["location"] == "Marrickville"
    # Fields not present in the PATCH stay untouched.
    assert (body["full_name"], body["phone"], body["state"]) == ("Jon", "0400 000 000", "NSW")
    assert _stored(mei)["metadata"] == {"location": "Marrickville", "state": "NSW", "postcode": "2042"}


def test_update_profile_null_clears_a_field(client, mei):
    response = client.patch("/api/v1/profiles/me", json={"phone": None, "location": None, "state": None})
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["phone"], body["location"], body["state"]) == (None, None, None)
    assert body["postcode"] == "2042"
    reloaded = client.get("/api/v1/profiles/me").json()
    assert (reloaded["phone"], reloaded["location"]) == (None, None)


def test_update_profile_keeps_the_name_when_sent_null(client, mei):
    response = client.patch("/api/v1/profiles/me", json={"full_name": None})
    assert response.status_code == 200
    assert response.json()["full_name"] == "Jon"
    assert _stored(mei)["updated_at"] == NOW  # nothing was written


def test_update_profile_with_empty_payload_returns_current(mei):
    profile = profiles_service.update_my_profile(MEI, {})
    assert profile["full_name"] == "Jon"


def test_an_edit_moves_updated_at(client, mei):
    response = client.patch("/api/v1/profiles/me", json={"full_name": "Mei Lin", "avatar_url": "https://img.test/m.png"})

    assert response.status_code == 200, response.text
    stored = _stored(mei)
    assert (stored["full_name"], stored["avatar_url"]) == ("Mei Lin", "https://img.test/m.png")
    assert stored["updated_at"] != NOW
    assert _when(response.json()["updated_at"]) == _when(stored["updated_at"])
