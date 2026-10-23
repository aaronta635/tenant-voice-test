"""Your own profile's role sections and settings (R14), on the strict fake.

A tenant's details go to tenant_profiles (columns, and private keys in its
metadata), a landlord's to landlord_profiles, everyone's settings to the
keys of users.metadata.mobile the mobile app shares (member_settings). A
PATCH is a patch at every level, it merges into metadata that the mobile app
writes too, and it is checked before anything is stored.
"""

import itertools
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.profiles import NOTIFICATION_KINDS, NotificationPreferencesOut, PrivacyOut, sydney_today
from app.services import maps_messaging, public_profiles
from tests.factories import NOW
from tests.factories_identity import users_row

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
URL = f"{API}/profiles/me"
MEI = "c0000000-0000-4000-8000-000000000001"
OLLY = "c0000000-0000-4000-8000-000000000002"
PIA = "c0000000-0000-4000-8000-000000000003"
TODAY = sydney_today()
LAST_YEAR = (TODAY - timedelta(days=400)).isoformat()
MOVE_IN = (TODAY + timedelta(days=30)).isoformat()

TENANT_DETAILS = {
    "about_me": "Quiet nurse who keeps a tidy home.",
    "budget_min": 450,
    "budget_max": 700.5,
    "preferred_locations": ["Newtown", "Glebe"],
    "move_in_date": MOVE_IN,
    "household_size": 2,
    "has_pets": True,
    "employment": {
        "types": ["full_time", "student"], "employer": "Royal Prince Alfred", "job_title": "Nurse",
        "annual_income": 92000, "notes": "Permanent role since 2021.",
    },
    "household": {"members": [{"name": "Sam Lin", "age": 31, "relationship": "Partner"}], "pets": "One cat"},
    "emergency_contact": {"name": "Ines Lin", "relationship": "Sister", "phone": "0411 222 333",
                          "email": "ines@example.test"},
    "rental_history": [{
        "address": "12/55 Martin Place", "suburb": "Sydney", "state": "NSW", "start_date": "2021-02-01",
        "end_date": LAST_YEAR, "weekly_rent": 650, "landlord_name": "John Smith",
        "landlord_contact": "john@example.test", "reason_for_leaving": "Moved closer to work",
        "bond_returned": "yes",
    }],
    "rental_preferences": {"property_types": ["apartment", "townhouse"], "bedrooms_min": 2, "bathrooms_min": 1,
                           "parking_min": 0, "notes": "Near a train line."},
    "qualities": {"tags": ["reliable_rent", "long_term_stay"], "notes": "References on request."},
}
SETTINGS = {
    "notification_preferences": {"message": False, "property": False},
    "privacy": {"public_profile": False, "share_score": False},
}
# Where SETTINGS is stored: the mobile app's keys, with the web's notification switches next to its own, and
# the privacy switches the web kept before mirrored for the readers that still read them (share_score only there).
STORED_SETTINGS = {
    "mobile": {
        "notificationPreferences": {"messages": False, "propertyUpdates": False},
        "privacySettings": {"publicProfile": False},
    },
    "privacy": {"public_profile": False, "share_score": False},
}
ALL_ON = dict.fromkeys(NotificationPreferencesOut.model_fields, True)
DEFAULT_PRIVACY = PrivacyOut().model_dump()


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mei(strict_schema, as_profile):
    """A tenant with her tenant_profiles row, signed in."""
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin", phone="0400 000 000")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW}])
    as_profile(id=MEI, role="tenant")
    return strict_schema


@pytest.fixture
def olly(strict_schema, as_profile):
    """A landlord without a landlord_profiles row yet, signed in."""
    strict_schema.seed("users", [users_row(OLLY, "olly@demo.test", "LANDLORD", full_name="Olly Owner")])
    as_profile(id=OLLY, role="landlord")
    return strict_schema


def _row(db, table: str, key: str = "user_id", value: str = MEI) -> dict:
    [row] = [row for row in db.tables.get(table, []) if row[key] == value]
    return row


# -- round trip -------------------------------------------------------------------
def test_values_survive_a_reload_in_another_browser(fake_db):
    with TestClient(app) as first_browser:
        registered = first_browser.post(f"{API}/auth/register", json={
            "email": "mei@example.test", "password": "password123", "full_name": "Mei Lin", "role": "tenant",
        })
        assert registered.status_code == 201, registered.text
        saved = first_browser.patch(URL, headers=bearer(registered.json()["access_token"]), json={
            "phone": "0400 111 222", "location": "Newtown", "state": "NSW", "postcode": "2042",
            "tenant": TENANT_DETAILS, "settings": SETTINGS,
        })
        assert saved.status_code == 200, saved.text

    # Another browser shares nothing with the first but the account.
    with TestClient(app) as second_browser:
        signed_in = second_browser.post(f"{API}/auth/login", json={
            "email": "mei@example.test", "password": "password123",
        })
        reloaded = second_browser.get(URL, headers=bearer(signed_in.json()["access_token"]))

    assert reloaded.status_code == 200, reloaded.text
    assert reloaded.json() == saved.json()
    tenant = reloaded.json()["tenant"]
    [entry] = tenant.pop("rental_history")
    assert entry.pop("id")
    assert entry == {**TENANT_DETAILS["rental_history"][0], "current": False}
    assert tenant == {
        **{key: value for key, value in TENANT_DETAILS.items() if key != "rental_history"},
        "budget_min": 450.0,
    }
    assert reloaded.json()["settings"] == {
        "notification_preferences": {**ALL_ON, "message": False, "property": False},
        "privacy": {**DEFAULT_PRIVACY, "public_profile": False, "share_score": False},
    }
    assert (reloaded.json()["phone"], reloaded.json()["postcode"]) == ("0400 111 222", "2042")


def test_each_value_is_stored_where_the_shared_schema_keeps_it(client, mei):
    response = client.patch(URL, json={"tenant": TENANT_DETAILS, "settings": SETTINGS})

    assert response.status_code == 200, response.text
    row = _row(mei, "tenant_profiles")
    assert {column: row[column] for column in (
        "about_me", "budget_min", "budget_max", "preferred_locations", "move_in_date", "household_size", "has_pets",
    )} == {
        "about_me": "Quiet nurse who keeps a tidy home.", "budget_min": 450, "budget_max": 700.5,
        "preferred_locations": ["Newtown", "Glebe"], "move_in_date": MOVE_IN, "household_size": 2,
        "has_pets": True,
    }
    assert sorted(row["metadata"]) == [
        "emergency_contact", "employment", "household", "qualities", "rental_history", "rental_preferences",
    ]
    assert row["metadata"]["employment"] == TENANT_DETAILS["employment"]
    assert row["updated_at"] != NOW
    user = _row(mei, "users", "id")
    assert user["metadata"] == STORED_SETTINGS
    assert user["updated_at"] != NOW


def test_a_tenant_without_a_profile_row_gets_one_stamped(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    as_profile(id=MEI, role="tenant")

    before = client.get(URL)
    assert before.status_code == 200, before.text
    assert before.json()["tenant"]["has_pets"] is False
    assert "tenant_profiles" not in strict_schema.tables or not strict_schema.tables["tenant_profiles"]

    response = client.patch(URL, json={"tenant": {"about_me": "Hello", "move_in_date": MOVE_IN}})

    assert response.status_code == 200, response.text
    row = _row(strict_schema, "tenant_profiles")
    assert (row["about_me"], row["move_in_date"], row["has_pets"]) == ("Hello", MOVE_IN, False)
    assert row["updated_at"] and row["completion_score"] == response.json()["completion"]["score"] == 9


def test_a_landlord_section_is_stored_and_its_row_made_when_missing(client, olly):
    response = client.patch(URL, json={"landlord": {
        "agency_name": "Harbour Homes", "license_number": "20012345", "portfolio_size": 4,
        "bio": "Family-run rentals in the inner west.",
    }})

    assert response.status_code == 200, response.text
    assert response.json()["landlord"] == {
        "agency_name": "Harbour Homes", "license_number": "20012345", "portfolio_size": 4,
        "bio": "Family-run rentals in the inner west.",
    }
    assert (response.json()["tenant"], response.json()["completion"]) == (None, None)
    row = _row(olly, "landlord_profiles", value=OLLY)
    assert (row["agency_name"], row["license_number"], row["portfolio_size"]) == ("Harbour Homes", "20012345", 4)
    assert (row["metadata"], row["verification_status"]) == ({"bio": "Family-run rentals in the inner west."},
                                                             "PENDING")
    # The public card shows the business name and the about line, never the licence.
    card = client.get(f"{API}/public/profiles/{OLLY}").json()
    assert (card["business_name"], card["about"]) == ("Harbour Homes", "Family-run rentals in the inner west.")
    assert "20012345" not in client.get(f"{API}/public/profiles/{OLLY}").text


# -- patch semantics --------------------------------------------------------------
def test_a_section_patch_keeps_what_it_does_not_name_and_a_null_clears(client, mei):
    client.patch(URL, json={"tenant": {"employment": {
        "types": ["full_time"], "employer": "Acme", "job_title": "Clerk",
    }}})

    kept = client.patch(URL, json={"tenant": {"employment": {"job_title": "Senior clerk"}}})
    cleared = client.patch(URL, json={"tenant": {"employment": {"employer": None}, "budget_max": None}})

    assert kept.json()["tenant"]["employment"]["employer"] == "Acme"
    assert kept.json()["tenant"]["employment"]["job_title"] == "Senior clerk"
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["tenant"]["employment"] == {
        "types": ["full_time"], "employer": None, "job_title": "Senior clerk", "annual_income": None, "notes": None,
    }
    assert _row(mei, "tenant_profiles")["metadata"]["employment"] == {
        "types": ["full_time"], "job_title": "Senior clerk",
    }


def test_a_list_is_replaced_whole_and_each_entry_keeps_its_id(client, mei):
    first = client.patch(URL, json={"tenant": {"rental_history": [
        {"address": "1 King Street", "start_date": "2019-01-01", "end_date": "2020-01-01"},
        {"address": "2 Queen Street", "current": True},
    ]}})
    ids = [entry["id"] for entry in first.json()["tenant"]["rental_history"]]

    second = client.patch(URL, json={"tenant": {"rental_history": [
        {**first.json()["tenant"]["rental_history"][1], "weekly_rent": 500},
    ]}})

    assert len(set(ids)) == 2 and all(ids)
    entries = second.json()["tenant"]["rental_history"]
    assert [(entry["id"], entry["address"], entry["weekly_rent"]) for entry in entries] == [
        (ids[1], "2 Queen Street", 500.0),
    ]


def test_blank_text_is_stored_as_nothing(client, mei):
    response = client.patch(URL, json={"phone": "  ", "tenant": {"about_me": "", "employment": {"employer": " "}}})

    assert response.status_code == 200, response.text
    assert (response.json()["phone"], response.json()["tenant"]["about_me"]) == (None, None)
    assert "employment" not in (_row(mei, "tenant_profiles")["metadata"] or {})


def test_unchanged_values_write_nothing(client, mei):
    # The stored score is already the one her name and phone give.
    _row(mei, "tenant_profiles")["completion_score"] = 9

    response = client.patch(URL, json={"full_name": "Mei Lin", "phone": "0400 000 000", "tenant": {"has_pets": False}})

    assert response.status_code == 200, response.text
    assert _row(mei, "users", "id")["updated_at"] == NOW
    assert _row(mei, "tenant_profiles")["updated_at"] == NOW


# -- other apps' keys -----------------------------------------------------------
def test_merging_keeps_the_keys_other_apps_wrote(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin", metadata={
        "location": "Newtown", "mobile_theme": "dark",
        "notification_preferences": {"push_enabled": False, "message": True},
        "privacy": {"show_last_seen": False},
        "mobile": {"profilePublished": True, "privacySettings": {"showLastSeen": False},
                   "notificationPreferences": {"inspections": False}},
    })])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "references": [{"name": "Olga"}], "employment": {"payroll_id": "M-77"},
    }}])
    as_profile(id=MEI, role="tenant")

    saved = client.patch(URL, json={
        "state": "NSW",
        "settings": {"notification_preferences": {"message": False}, "privacy": {"public_profile": False}},
        "tenant": {"employment": {"types": ["student"]}, "qualities": {"tags": ["clear_communication"]}},
    })
    reset = client.patch(URL, json={
        "settings": {"privacy": None, "notification_preferences": None}, "tenant": {"employment": None},
    })

    assert (saved.status_code, reset.status_code) == (200, 200), (saved.text, reset.text)
    assert _row(strict_schema, "users", "id")["metadata"] == {
        "location": "Newtown", "state": "NSW", "mobile_theme": "dark",
        # A null clears the switches the web knows; the others stay, and the web's earlier keys are only read.
        "notification_preferences": {"push_enabled": False, "message": True}, "privacy": {"show_last_seen": False},
        "mobile": {"profilePublished": True, "privacySettings": {"showLastSeen": False},
                   "notificationPreferences": {"inspections": False}},
    }
    assert _row(strict_schema, "tenant_profiles")["metadata"] == {
        "references": [{"name": "Olga"}], "employment": {"payroll_id": "M-77"},
        "qualities": {"tags": ["clear_communication"]},
    }
    assert reset.json()["settings"]["notification_preferences"]["message"] is True


def test_list_items_the_web_cannot_read_survive_a_save(client, strict_schema, as_profile):
    """Saving the whole list back never drops what the web could not show."""
    unreadable = [
        {"suburb": "Glebe"},  # no address
        {"address": "2 Big St", "weekly_rent": 50_000},  # over the web's cap
        "12 Garbage Lane",
    ]
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "rental_history": [{"id": 7, "address": "1 A St", "mobile_note": "verified by app"}, *unreadable],
        "household": {"members": [{"name": "Ann"}, {"age": 4}], "pets": "Cat"},
    }}])
    as_profile(id=MEI, role="tenant")

    read = client.get(URL).json()["tenant"]
    [shown] = read["rental_history"]
    added = client.patch(URL, json={"tenant": {
        "rental_history": [shown, {"address": "3 New St", "current": True}],
        "household": {"members": read["household"]["members"]},
    }})

    assert (shown["id"], shown["address"]) == ("7", "1 A St")
    assert read["household"]["members"] == [{"name": "Ann", "age": None, "relationship": None}]
    assert added.status_code == 200, added.text
    stored = _row(strict_schema, "tenant_profiles")["metadata"]
    assert [entry if isinstance(entry, str) else entry.get("address") for entry in stored["rental_history"]] == [
        "1 A St", "3 New St", None, "2 Big St", "12 Garbage Lane",
    ]
    # The entry sent back keeps the key the mobile app added to it.
    assert stored["rental_history"][0]["mobile_note"] == "verified by app"
    assert stored["household"] == {"members": [{"name": "Ann"}, {"age": 4}], "pets": "Cat"}

    cleared = client.patch(URL, json={"tenant": {"rental_history": None, "household": {"members": []}}})

    assert cleared.status_code == 200, cleared.text
    stored = _row(strict_schema, "tenant_profiles")["metadata"]
    assert stored["rental_history"] == unreadable
    assert stored["household"]["members"] == [{"age": 4}]


def test_an_entry_stored_without_an_id_reads_with_the_same_one_each_time(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "rental_history": [{"address": "1 A St", "landlord_phone": "0400 111 222"}],
    }}])
    as_profile(id=MEI, role="tenant")

    first, second = (client.get(URL).json()["tenant"]["rental_history"] for _ in range(2))
    saved = client.patch(URL, json={"tenant": {"rental_history": [{**first[0], "weekly_rent": 480}]}})

    assert first == second
    assert saved.status_code == 200, saved.text
    [entry] = _row(strict_schema, "tenant_profiles")["metadata"]["rental_history"]
    assert (entry["id"], entry["weekly_rent"], entry["landlord_phone"]) == (first[0]["id"], 480, "0400 111 222")


def test_a_household_member_sent_back_keeps_the_keys_another_app_added(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "household": {"members": [{"name": "Al", "age": 30, "relationship": "Partner", "dob": "1995-01-01"}]},
    }}])
    as_profile(id=MEI, role="tenant")

    members = client.get(URL).json()["tenant"]["household"]["members"]
    saved = client.patch(URL, json={"tenant": {"household": {"members": [*members, {"name": "Bo", "age": 4}]}}})

    assert saved.status_code == 200, saved.text
    assert _row(strict_schema, "tenant_profiles")["metadata"]["household"]["members"] == [
        {"name": "Al", "age": 30, "relationship": "Partner", "dob": "1995-01-01"}, {"name": "Bo", "age": 4},
    ]


def test_a_section_another_app_stored_in_another_shape_is_never_overwritten(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "employment": "Nurse at RPA", "rental_history": "Lived in Glebe since 2019",
    }}])
    as_profile(id=MEI, role="tenant")

    employment = client.patch(URL, json={"tenant": {"employment": {"job_title": "Nurse"}}})
    history = client.patch(URL, json={"tenant": {"rental_history": [{"address": "1 A St"}]}})
    budget = client.patch(URL, json={"tenant": {"budget_max": 700}})

    assert (employment.status_code, history.status_code) == (409, 409)
    assert "another app" in employment.json()["detail"]
    assert budget.status_code == 200, budget.text
    assert _row(strict_schema, "tenant_profiles")["metadata"] == {
        "employment": "Nurse at RPA", "rental_history": "Lived in Glebe since 2019",
    }


def test_two_identical_entries_stored_without_ids_read_as_two(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "rental_history": [{"address": "1 A St"}, {"address": "1 A St"}],
    }}])
    as_profile(id=MEI, role="tenant")

    first, second = client.get(URL).json()["tenant"]["rental_history"]
    removed = client.patch(URL, json={"tenant": {"rental_history": [first]}})

    assert first["id"] != second["id"]
    assert removed.status_code == 200, removed.text
    assert [entry["address"] for entry in _row(strict_schema, "tenant_profiles")["metadata"]["rental_history"]] == [
        "1 A St"]


def test_codes_the_web_does_not_know_survive_a_save(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "metadata": {
        "employment": {"types": ["FULL_TIME", "student"]},
        "rental_preferences": {"property_types": ["villa"]},
    }}])
    as_profile(id=MEI, role="tenant")

    read = client.get(URL).json()["tenant"]
    saved = client.patch(URL, json={"tenant": {
        "employment": {"types": ["student", "part_time"]}, "rental_preferences": {"property_types": []},
    }})

    assert (read["employment"]["types"], read["rental_preferences"]["property_types"]) == (["student"], [])
    assert saved.status_code == 200, saved.text
    assert saved.json()["tenant"]["employment"]["types"] == ["student", "part_time"]
    stored = _row(strict_schema, "tenant_profiles")["metadata"]
    assert stored["employment"]["types"] == ["student", "part_time", "FULL_TIME"]
    assert stored["rental_preferences"]["property_types"] == ["villa"]


def test_a_write_never_overwrites_a_change_made_since_its_read(client, mei, monkeypatch):
    """Another app writes the row between our read and our write: ours starts again from its row."""
    from app.services import profiles

    real_read = profiles.get_user_row
    reads = []

    def read_then_mobile_writes(user_id):
        row = real_read(user_id)
        reads.append(row)
        if len(reads) == 2:  # the write's own read: the mobile app saves before the write lands
            [stored] = mei.tables["users"]
            stored["metadata"] = {"mobile_written": True}
            stored["updated_at"] = "2026-01-01T00:00:05+00:00"
        return row

    monkeypatch.setattr(profiles, "get_user_row", read_then_mobile_writes)
    response = client.patch(URL, json={"settings": {"privacy": {"share_score": False}}})

    assert response.status_code == 200, response.text
    assert _row(mei, "users", "id")["metadata"] == {
        "mobile_written": True, "privacy": {"share_score": False},
    }
    assert len(reads) == 3  # the patch's read, the write's read and, after it lost the race, its second read


def test_a_failed_account_write_leaves_the_tenant_row_as_it_was(client, mei, monkeypatch):
    """The users row is written first: its completion counts only a name and phone that were saved."""
    from app.services import profiles

    real_update = profiles._update_if_unchanged
    monkeypatch.setattr(
        profiles, "_update_if_unchanged",
        lambda table, row, changes: None if table == "users" else real_update(table, row, changes),
    )

    response = client.patch(URL, json={"phone": "0400 999 888", "tenant": {"about_me": "Hello"}})

    assert (response.status_code, response.json()) == (409, {"detail": profiles.CHANGED_ELSEWHERE})
    row = _row(mei, "tenant_profiles")
    assert (row["about_me"], row["completion_score"], row["updated_at"]) == (None, 0, NOW)


def test_a_write_that_keeps_losing_races_is_a_conflict(client, mei, monkeypatch):
    from app.services import profiles

    real_read = profiles.get_user_row
    seconds = itertools.count(10)

    def read_then_someone_writes(user_id):
        row = real_read(user_id)
        [stored] = mei.tables["users"]
        stored["updated_at"] = f"2026-01-01T00:00:{next(seconds)}+00:00"
        return row

    monkeypatch.setattr(profiles, "get_user_row", read_then_someone_writes)
    response = client.patch(URL, json={"phone": "0400 999 888"})

    assert (response.status_code, response.json()) == (409, {"detail": profiles.CHANGED_ELSEWHERE})
    assert _row(mei, "users", "id")["phone"] == "0400 000 000"


# -- settings -----------------------------------------------------------------------
def test_settings_are_on_until_switched_off_and_hide_the_public_profile(client, mei, monkeypatch):
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)
    assert client.get(URL).json()["settings"] == {"notification_preferences": ALL_ON, "privacy": DEFAULT_PRIVACY}
    assert DEFAULT_PRIVACY == {
        "public_profile": True, "discoverable": True, "show_contact": False, "show_availability": True,
        "allow_messages": True, "share_score": True,
    }
    assert client.get(f"{API}/public/profiles/{MEI}").status_code == 200

    response = client.patch(URL, json={"settings": {"privacy": {"public_profile": False}}})

    assert response.json()["settings"]["privacy"] == {**DEFAULT_PRIVACY, "public_profile": False}
    metadata = _row(mei, "users", "id")["metadata"]
    assert metadata["mobile"]["privacySettings"]["publicProfile"] is False
    assert metadata["privacy"]["public_profile"] is False
    assert client.get(f"{API}/public/profiles/{MEI}").status_code == 404


def test_there_is_a_switch_for_every_kind_of_notification_the_app_sends():
    assert set(NOTIFICATION_KINDS) == set(maps_messaging.WEB_TO_NOTIFICATION_CATEGORY)
    assert set(NOTIFICATION_KINDS) <= set(NotificationPreferencesOut.model_fields)


def test_a_provider_has_settings_but_no_role_details(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(PIA, "pia@demo.test", "SERVICE_PROVIDER", full_name="Pia Plumbing")])
    as_profile(id=PIA, role="service_provider")

    response = client.patch(URL, json={"settings": {"notification_preferences": {"booking": False}}})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["tenant"], body["landlord"], body["completion"]) == (None, None, None)
    assert body["settings"]["notification_preferences"]["booking"] is False


# -- validation ---------------------------------------------------------------------
TOMORROW = (TODAY + timedelta(days=1)).isoformat()
INVALID_PATCHES = {
    "negative budget": {"tenant": {"budget_min": -1}},
    "budget past the cap": {"tenant": {"budget_max": 20_001}},
    "budget as text": {"tenant": {"budget_min": "lots"}},
    "empty household": {"tenant": {"household_size": 0}},
    "pets as text": {"tenant": {"has_pets": "yes"}},
    "no such date": {"tenant": {"move_in_date": "2026-02-30"}},
    "move-in three years out": {"tenant": {"move_in_date": (TODAY + timedelta(days=3 * 365)).isoformat()}},
    "long suburb": {"tenant": {"preferred_locations": ["x" * 81]}},
    "eleven suburbs": {"tenant": {"preferred_locations": [f"Suburb {n}" for n in range(11)]}},
    "long about": {"tenant": {"about_me": "x" * 2001}},
    "unknown employment type": {"tenant": {"employment": {"types": ["astronaut"]}}},
    "negative income": {"tenant": {"employment": {"annual_income": -5}}},
    "unknown employment key": {"tenant": {"employment": {"salary": 5}}},
    "unknown tenant key": {"tenant": {"date_of_birth": "1990-01-01"}},
    "bad contact email": {"tenant": {"emergency_contact": {"name": "Ann", "email": "not-an-email"}}},
    "bad contact phone": {"tenant": {"emergency_contact": {"name": "Ann", "phone": "call me"}}},
    "member without a name": {"tenant": {"household": {"members": [{"age": 30}]}}},
    "member aged 130": {"tenant": {"household": {"members": [{"name": "Al", "age": 130}]}}},
    "current address with an end": {"tenant": {"rental_history": [
        {"address": "1 King St", "current": True, "end_date": LAST_YEAR}]}},
    "tenancy ending before it starts": {"tenant": {"rental_history": [
        {"address": "1 King St", "start_date": "2024-02-01", "end_date": "2024-01-01"}]}},
    "tenancy starting tomorrow": {"tenant": {"rental_history": [{"address": "1 King St", "start_date": TOMORROW}]}},
    "past tenancy ending tomorrow": {"tenant": {"rental_history": [{"address": "1 King St", "end_date": TOMORROW}]}},
    "tenancy without an address": {"tenant": {"rental_history": [{"suburb": "Newtown"}]}},
    "twenty-one tenancies": {"tenant": {"rental_history": [{"address": f"{n} King St"} for n in range(21)]}},
    "rent past the cap": {"tenant": {"rental_history": [{"address": "1 King St", "weekly_rent": 50_000}]}},
    "unknown bond answer": {"tenant": {"rental_history": [{"address": "1 King St", "bond_returned": "maybe"}]}},
    "entry id with spaces": {"tenant": {"rental_history": [{"id": "my entry", "address": "1 King St"}]}},
    "unknown property type": {"tenant": {"rental_preferences": {"property_types": ["castle"]}}},
    "eleven bedrooms": {"tenant": {"rental_preferences": {"bedrooms_min": 11}}},
    "unknown quality": {"tenant": {"qualities": {"tags": ["punctual"]}}},
    "five-digit postcode": {"postcode": "20000"},
    "two-digit phone": {"phone": "12"},
    "script avatar": {"avatar_url": "javascript:alert(1)"},
    "blank name": {"full_name": " "},
    "switch as text": {"settings": {"notification_preferences": {"message": "no"}}},
    "unknown switch": {"settings": {"notification_preferences": {"sms": False}}},
    "privacy as a number": {"settings": {"privacy": {"public_profile": 0}}},
}


STORED_ELSEWHERE = {
    "a phone with dots": {"phone": "0412.345.678"},
    "a phone with letters": {"phone": "1300 TRADIE"},
    "a phone with an extension": {"phone": "+61 2 9999 9999 ext 12"},
    "a long suburb": {"metadata": {"location": "Upper " * 15 + "Mount Colah", "state": "NSW"}},
}


@pytest.mark.parametrize("stored", STORED_ELSEWHERE.values(), ids=STORED_ELSEWHERE.keys())
def test_a_value_todays_checks_refuse_is_kept_when_another_field_changes(client, strict_schema, as_profile, stored):
    """Another app's format never blocks a save: the provider page sends every account field with a new name."""
    strict_schema.seed("users", [users_row(PIA, "pia@demo.test", "SERVICE_PROVIDER", full_name="Pia Plumbing",
                                           **stored)])
    as_profile(id=PIA, role="service_provider")
    before = client.get(URL).json()

    response = client.patch(URL, json={
        "full_name": "Pia Plumbing Co", "phone": before["phone"], "location": before["location"],
        "state": before["state"],
    })

    assert response.status_code == 200, response.text
    after = response.json()
    assert after["full_name"] == "Pia Plumbing Co"
    assert (after["phone"], after["location"], after["state"]) == (before["phone"], before["location"], before["state"])


def test_a_changed_value_is_still_checked_beside_one_stored_elsewhere(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(PIA, "pia@demo.test", "SERVICE_PROVIDER", full_name="Pia Plumbing",
                                           phone="0412.345.678")])
    as_profile(id=PIA, role="service_provider")

    response = client.patch(URL, json={"full_name": "Pia Plumbing Co", "phone": "0412.345.679", "postcode": "20000"})

    assert response.status_code == 422, response.text
    assert [error["loc"] for error in response.json()["detail"]] == [["body", "phone"], ["body", "postcode"]]
    assert "Enter a phone number of 6 to 15 digits" in response.json()["detail"][0]["msg"]
    assert _row(strict_schema, "users", "id", PIA)["full_name"] == "Pia Plumbing"


@pytest.mark.parametrize("patch", INVALID_PATCHES.values(), ids=INVALID_PATCHES.keys())
def test_an_invalid_value_is_refused_and_nothing_is_written(client, mei, patch):
    before = {table: [dict(row) for row in rows] for table, rows in mei.tables.items()}

    response = client.patch(URL, json=patch)

    assert response.status_code == 422, response.text
    assert {table: rows for table, rows in mei.tables.items() if rows} == {k: v for k, v in before.items() if v}


@pytest.mark.parametrize(("patch", "message"), [
    ({"tenant": {"budget_min": 800, "budget_max": 700}}, "The minimum budget can't be more than the maximum."),
    ({"tenant": {"emergency_contact": {"phone": "0411 222 333"}}}, "Add your emergency contact's name."),
    ({"tenant": {"emergency_contact": {"name": "Ines Lin"}}},
     "Add a phone number or email for your emergency contact."),
], ids=["budget out of order", "contact without a name", "contact without a way to reach them"])
def test_rules_across_fields_are_checked_on_the_whole_section(client, mei, patch, message):
    response = client.patch(URL, json=patch)

    assert (response.status_code, response.json()) == (422, {"detail": message})


def test_rules_across_fields_count_what_is_stored(client, mei):
    client.patch(URL, json={"tenant": {
        "budget_min": 600, "emergency_contact": {"name": "Ines", "phone": "0411 222 333"},
    }})

    too_low = client.patch(URL, json={"tenant": {"budget_max": 500}})
    unreachable = client.patch(URL, json={"tenant": {"emergency_contact": {"phone": None}}})
    added = client.patch(URL, json={"tenant": {"budget_max": 650, "emergency_contact": {"email": "ines@example.test"}}})

    assert too_low.status_code == unreachable.status_code == 422
    assert added.status_code == 200, added.text
    assert added.json()["tenant"]["emergency_contact"] == {
        "name": "Ines", "relationship": None, "phone": "0411 222 333", "email": "ines@example.test",
    }


def test_values_another_app_stored_badly_do_not_block_an_unrelated_edit(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW, "budget_min": 700, "budget_max": 900,
                                            "preferred_locations": "Newtown, Glebe", "move_in_date": "soon",
                                            "metadata": {"employment": "Full time", "rental_history": [{"suburb": "X"}],
                                                         "household": {"members": [{"age": 3}], "pets": "Dog"},
                                                         "qualities": {"tags": ["reliable_rent", "MOBILE_TAG"]}}}])
    # No budget out of order: tenant_profiles_budget_range_check refuses one, and any update of a row holding it.
    as_profile(id=MEI, role="tenant")

    read = client.get(URL)
    edited = client.patch(URL, json={"tenant": {"about_me": "Still here"}})
    # What a form read it can send straight back.
    resaved = client.patch(URL, json={"tenant": {"qualities": read.json()["tenant"]["qualities"]}})

    assert (read.status_code, edited.status_code, resaved.status_code) == (200, 200, 200), resaved.text
    tenant = edited.json()["tenant"]
    assert (tenant["budget_min"], tenant["budget_max"], tenant["move_in_date"]) == (700.0, 900.0, None)
    assert tenant["preferred_locations"] == ["Newtown", "Glebe"]
    assert (tenant["employment"]["types"], tenant["rental_history"]) == ([], [])
    assert tenant["household"] == {"members": [], "pets": "Dog"}
    assert tenant["qualities"] == {"tags": ["reliable_rent"], "notes": None}


@pytest.mark.parametrize(("role", "section"), [
    ("tenant", "landlord"), ("landlord", "tenant"), ("service_provider", "tenant"), ("service_provider", "landlord"),
])
def test_a_role_section_is_only_for_that_role(client, strict_schema, as_profile, role, section):
    db_role = {"tenant": "TENANT", "landlord": "LANDLORD", "service_provider": "SERVICE_PROVIDER"}[role]
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", db_role)])
    as_profile(id=MEI, role=role)

    response = client.patch(URL, json={section: {}, "phone": "0400 999 888"})

    assert response.status_code == 422
    assert response.json() == {"detail": f"Only {section} accounts have {section} details."}
    assert _row(strict_schema, "users", "id")["phone"] is None
    assert not strict_schema.tables.get(f"{section}_profiles")


def test_an_agent_keeps_landlord_details_on_their_agent_profile_which_public_profiles_read(
    client, strict_schema, as_profile, monkeypatch,
):
    monkeypatch.setattr(public_profiles, "_scans", {})
    strict_schema.seed("users", [users_row(OLLY, "agent@demo.test", "AGENT", full_name="Avery Agent")])
    strict_schema.seed("agent_profiles", [{"user_id": OLLY, "market_area": "Inner West", "updated_at": NOW,
                                           "metadata": {"mobile_badge": "gold"}}])
    as_profile(id=OLLY, role="landlord")

    response = client.patch(URL, json={"landlord": {
        "agency_name": "Avery Realty", "license_number": "A-1", "portfolio_size": 40, "bio": "Inner west leasing.",
    }})

    assert response.status_code == 200, response.text
    assert response.json()["landlord"] == {
        "agency_name": "Avery Realty", "license_number": "A-1", "portfolio_size": 40, "bio": "Inner west leasing.",
    }
    row = _row(strict_schema, "agent_profiles", value=OLLY)
    assert (row["agency_name"], row["license_number"], row["market_area"]) == ("Avery Realty", "A-1", "Inner West")
    assert row["metadata"] == {"mobile_badge": "gold", "portfolio_size": 40, "bio": "Inner west leasing."}
    assert not strict_schema.tables.get("landlord_profiles")
    card = client.get(f"{API}/public/profiles/{OLLY}").json()
    assert (card["business_name"], card["about"]) == ("Avery Realty", "Inner west leasing.")
    assert client.get(URL).json()["landlord"] == response.json()["landlord"]


def test_an_agent_without_an_agent_profile_gets_one_stamped(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(OLLY, "agent@demo.test", "AGENT", full_name="Avery Agent")])
    as_profile(id=OLLY, role="landlord")

    response = client.patch(URL, json={"landlord": {"agency_name": "Avery Realty"}})

    assert response.status_code == 200, response.text
    row = _row(strict_schema, "agent_profiles", value=OLLY)
    assert (row["agency_name"], row["verification_status"]) == ("Avery Realty", "PENDING")
    assert row["updated_at"]


def test_the_profile_of_a_closed_account_is_not_found(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", deleted_at=NOW)])
    as_profile(id=MEI, role="tenant")

    assert client.get(URL).status_code == 404
    assert client.patch(URL, json={"phone": "0400 999 888"}).status_code == 404
