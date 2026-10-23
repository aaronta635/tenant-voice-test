"""A member's own profile fills in from the mobile app's details where the web holds none (R14).

The mobile app keeps them in users.metadata.mobile, in the shapes
mobile_public_profile_json reads. GET /profiles/me shows them in the web's
shapes, names them in from_mobile and counts them in the completion; a save
writes the web's own keys and never the mobile app's.
"""

import copy
from datetime import timedelta

import pytest

from app.schemas.profiles import sydney_today
from app.services import mobile_profile, public_profiles
from tests.factories import NOW
from tests.factories_identity import users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
URL = f"{API}/profiles/me"
MEI = "c2000000-0000-4000-8000-000000000001"
OLLY = "c2000000-0000-4000-8000-000000000002"
LAST_YEAR = (sydney_today() - timedelta(days=400)).isoformat()
NEXT_YEAR = (sydney_today() + timedelta(days=200)).isoformat()

MOBILE = {
    "personalDetails": {"displayName": "Mei", "phone": "0412 345 678", "suburb": "Glebe",
                        "aboutMe": "Nurse on night shifts."},
    "emergencyContact": {"fullName": "Ines Lin", "phone": "0499 111 999", "relationship": "Sister"},
    "householdMembers": [{"fullName": "Bo Lin", "age": 9, "relationship": "Son"}, {"fullName": "  "}],
    "addressHistory": [
        {"id": "addr-1", "streetAddress": "4 Elm St", "suburb": "Glebe", "state": "NSW", "weeklyRent": 610,
         "isCurrent": True, "leaseEndDate": NEXT_YEAR},
        {"id": "addr-2", "suburb": "Ultimo", "state": "NSW", "weeklyRent": 540, "isCurrent": False,
         "leaseStartDate": "2021-02-01", "leaseEndDate": LAST_YEAR},
    ],
    "employmentStatus": {"types": ["fullTime", "Student", "casual"]},
    "profilePublished": True,
}


@pytest.fixture
def mei(strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin",
                                           metadata={"mobile": copy.deepcopy(MOBILE)})])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {}}])
    as_profile(id=MEI, role="tenant")
    return strict_schema


def stored(db, table, key="user_id") -> dict:
    return next(row for row in db.tables[table] if row[key] == MEI)


@pytest.mark.parametrize("details", [
    {"phone": "0412.345.678"}, {"phone": "1300 TRADIE"}, {"suburb": "Upper " * 15 + "Mount Colah"},
], ids=["a phone with dots", "a phone with letters", "a long suburb"])
def test_a_mobile_value_the_webs_checks_refuse_is_not_filled_in_and_blocks_no_save(client, strict_schema,
                                                                                   as_profile, details):
    # The provider page sends every account field with a new name; a filled-in value it cannot save would block it.
    strict_schema.seed("users", [users_row(OLLY, "olly@demo.test", "SERVICE_PROVIDER", full_name="Olly Plumbing",
                                           metadata={"mobile": {"personalDetails": details}})])
    as_profile(id=OLLY, role="service_provider")
    before = client.get(URL).json()

    assert (before["phone"], before["location"], before["from_mobile"]) == (None, None, [])
    response = client.patch(URL, json={"full_name": "Olly Plumbing Co", "phone": before["phone"],
                                       "location": before["location"], "state": before["state"]})

    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Olly Plumbing Co"


def test_the_forms_fill_in_from_the_mobile_apps_details(client, mei):
    profile = client.get(URL).json()

    assert (profile["phone"], profile["location"]) == ("0412 345 678", "Glebe")
    tenant = profile["tenant"]
    assert tenant["about_me"] == "Nurse on night shifts."
    assert tenant["employment"]["types"] == ["full_time", "student"]
    assert tenant["household"]["members"] == [{"name": "Bo Lin", "age": 9, "relationship": "Son"}]
    assert tenant["emergency_contact"] == {"name": "Ines Lin", "relationship": "Sister", "phone": "0499 111 999",
                                           "email": None}
    assert [(entry["id"], entry["address"], entry["current"], entry["end_date"], entry["weekly_rent"])
            for entry in tenant["rental_history"]] == [
        ("addr-1", "4 Elm St", True, None, 610.0),
        ("addr-2", "Ultimo, NSW", False, LAST_YEAR, 540.0),
    ]
    assert profile["from_mobile"] == [
        "phone", "location", "tenant.about_me", "tenant.employment.types", "tenant.household.members",
        "tenant.emergency_contact", "tenant.rental_history",
    ]
    # Counted as the member sees them: the name and phone, and the history are there.
    done = {item["key"] for item in profile["completion"]["items"] if item["done"]}
    assert {"personal_details", "rental_history"} <= done
    # Nothing is written by a read but the score.
    assert stored(mei, "users", "id")["metadata"] == {"mobile": MOBILE}
    assert stored(mei, "tenant_profiles")["metadata"] == {}


def test_the_webs_own_values_win_over_the_mobile_apps(client, mei):
    user = stored(mei, "users", "id")
    user.update(phone="0400 000 111", metadata={**user["metadata"], "location": "Newtown"})
    stored(mei, "tenant_profiles").update(about_me="Web about.", metadata={
        "emergency_contact": {"name": "Web Contact", "phone": "0400 222 333"},
        "rental_history": [{"id": "web-1", "address": "1 Web Way"}],
    })

    profile = client.get(URL).json()

    assert (profile["phone"], profile["location"], profile["tenant"]["about_me"]) == (
        "0400 000 111", "Newtown", "Web about.")
    assert profile["tenant"]["emergency_contact"]["name"] == "Web Contact"
    assert [entry["id"] for entry in profile["tenant"]["rental_history"]] == ["web-1"]
    assert profile["from_mobile"] == ["tenant.employment.types", "tenant.household.members"]


def test_saving_one_field_of_a_filled_in_section_keeps_the_rest_in_the_webs_key(client, mei):
    # The forms send only what changed: here the employer, the contact's email and the pets.
    response = client.patch(URL, json={"tenant": {
        "employment": {"employer": "Royal Prince Alfred"},
        "emergency_contact": {"email": "ines@example.test"},
        "household": {"pets": "A cat"},
    }})

    assert response.status_code == 200, response.text
    meta = stored(mei, "tenant_profiles")["metadata"]
    assert meta["employment"] == {"types": ["full_time", "student"], "employer": "Royal Prince Alfred"}
    assert meta["emergency_contact"] == {"name": "Ines Lin", "relationship": "Sister", "phone": "0499 111 999",
                                         "email": "ines@example.test"}
    assert meta["household"] == {"members": [{"name": "Bo Lin", "age": 9, "relationship": "Son"}], "pets": "A cat"}
    # The mobile app's keys are never written.
    assert stored(mei, "users", "id")["metadata"] == {"mobile": MOBILE}
    assert "tenant.emergency_contact" not in response.json()["from_mobile"]


def test_a_filled_in_contact_saved_without_its_name_is_still_checked(client, mei):
    response = client.patch(URL, json={"tenant": {"emergency_contact": {"name": None}}})

    assert response.status_code == 422, response.text
    assert "emergency_contact" not in stored(mei, "tenant_profiles")["metadata"]


def test_a_filled_in_rental_history_saves_as_the_webs_entries(client, mei):
    history = client.get(URL).json()["tenant"]["rental_history"]

    response = client.patch(URL, json={"tenant": {"rental_history": [*history, {"address": "9 New Rd"}]}})

    assert response.status_code == 200, response.text
    saved = stored(mei, "tenant_profiles")["metadata"]["rental_history"]
    assert [(entry["id"], entry["address"]) for entry in saved[:2]] == [
        ("addr-1", "4 Elm St"), ("addr-2", "Ultimo, NSW"),
    ]
    assert saved[2]["address"] == "9 New Rd"
    assert "tenant.rental_history" not in response.json()["from_mobile"]


def test_nobody_else_sees_the_mobile_apps_details(client, mei, as_profile, monkeypatch):
    monkeypatch.setattr(public_profiles, "_scans", {})
    mei.seed("users", [users_row(OLLY, "olly@demo.test", "LANDLORD", full_name="Olly Owner")])

    card = client.get(f"{API}/public/profiles/{MEI}").json()
    as_profile(id=OLLY, role="landlord")
    found = client.get(f"{API}/profiles/search").json()

    assert card["about"] is None and card["areas"] == []
    text = repr((card, found))
    for secret in ("0412 345 678", "Ines Lin", "Bo Lin", "4 Elm St", "Nurse on night shifts"):
        assert secret not in text


def test_a_landlord_fills_in_the_account_fields_only(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(OLLY, "olly@demo.test", "LANDLORD", full_name="Olly Owner",
                                           metadata={"mobile": MOBILE})])
    as_profile(id=OLLY, role="landlord")

    profile = client.get(URL).json()

    assert (profile["phone"], profile["location"], profile["tenant"]) == ("0412 345 678", "Glebe", None)
    assert profile["from_mobile"] == ["phone", "location"]


@pytest.mark.parametrize("item", [
    {"suburb": None, "state": None},
    "4 Elm St",
    {"streetAddress": "4 Elm St", "weeklyRent": 99_999},
])
def test_an_address_the_web_could_not_save_back_is_not_shown(item):
    assert mobile_profile.rental_history({"addressHistory": [item]}) == []


def test_the_older_rental_history_key_is_read_too():
    older = {"rentalHistory": [{"suburb": "Glebe", "state": "NSW"}]}
    [entry] = mobile_profile.rental_history(older)

    assert (entry["address"], entry["suburb"]) == ("Glebe, NSW", "Glebe")
    # An entry without an id gets the same one at every read, so a save finds it again.
    assert entry["id"] == mobile_profile.rental_history(older)[0]["id"]
