"""The searches of members honour the privacy switches the mobile app shares (R22, R14).

The public profiles (GET /public/profiles) and the signed-in profile search
(GET /profiles/search) list a member as mobile_discover_profiles does: their
users.metadata.mobile.privacySettings publicProfile and discoverable are not
false, else the web's earlier privacy.public_profile is not, and a tenant's
metadata.mobile.profilePublished is not false.
"""

import pytest

from app.services import public_profiles
from tests.factories_messaging import person

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
URL = f"{API}/profiles/me"
MEI = "c1000000-0000-4000-8000-000000000001"
JON = "c1000000-0000-4000-8000-000000000002"
ZOE = "c1000000-0000-4000-8000-000000000003"
ME = "c1000000-0000-4000-8000-000000000004"


@pytest.fixture(autouse=True)
def fresh_scans(monkeypatch):
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)


def user_metadata(db, id=MEI) -> dict:
    return next(row for row in db.tables["users"] if row["id"] == id)["metadata"]


def seed_people(db, mei_mobile: dict, role="TENANT"):
    db.seed("users", [
        person(MEI, role, "Mei Lin", location="Newtown", state="NSW", mobile=mei_mobile),
        person(JON, "LANDLORD", "Jon Doe", location="Enmore", state="NSW"),
        person(ME, "SERVICE_PROVIDER", "Amelia Whitlock"),
    ])


def public_ids(client) -> list[str]:
    response = client.get(f"{API}/public/profiles")
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def member_search_ids(client) -> list[str]:
    response = client.get(f"{API}/profiles/search")
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()]


@pytest.mark.parametrize("mobile, page", [
    ({"privacySettings": {"publicProfile": False}}, 404),
    ({"privacySettings": {"publicProfile": "false"}}, 404),
    ({"profilePublished": False}, 404),
    # Not discoverable: left out of every search, but its page opens, as the mobile app shows it.
    ({"privacySettings": {"discoverable": False}}, 200),
])
def test_a_member_the_mobile_settings_hide_is_left_out_of_both_searches(client, strict_schema, as_profile,
                                                                         mobile, page):
    seed_people(strict_schema, mobile)
    as_profile(id=ME, role="service_provider")

    assert public_ids(client) == [JON]
    assert member_search_ids(client) == [JON]
    assert client.get(f"{API}/public/profiles/{MEI}").status_code == page


def test_only_a_tenant_needs_a_published_profile(client, strict_schema, as_profile):
    seed_people(strict_schema, {"profilePublished": False}, role="LANDLORD")
    as_profile(id=ME, role="service_provider")

    assert sorted(public_ids(client)) == sorted([MEI, JON])
    assert sorted(member_search_ids(client)) == sorted([MEI, JON])


def test_the_mobile_switch_wins_over_the_webs_earlier_one_in_the_searches(client, strict_schema, as_profile):
    strict_schema.seed("users", [
        person(MEI, "TENANT", "Mei Lin", privacy={"public_profile": False},
               mobile={"privacySettings": {"publicProfile": True}}),
        person(JON, "LANDLORD", "Jon Doe", privacy={"public_profile": False}),
        person(ZOE, "TENANT", "Zoe Tenant", privacy={"public_profile": True},
               mobile={"privacySettings": {"publicProfile": False}}),
        person(ME, "SERVICE_PROVIDER", "Amelia Whitlock"),
    ])
    as_profile(id=ME, role="service_provider")

    assert public_ids(client) == [MEI]
    assert member_search_ids(client) == [MEI]


def test_settings_saved_on_the_web_hide_the_member_from_both_apps(client, strict_schema, as_profile):
    seed_people(strict_schema, {})
    as_profile(id=MEI, role="tenant")

    client.patch(URL, json={"settings": {"privacy": {"discoverable": False}}})

    # What mobile_discover_profiles reads.
    assert user_metadata(strict_schema)["mobile"]["privacySettings"]["discoverable"] is False
    assert public_ids(client) == [JON]
    as_profile(id=ME, role="service_provider")
    assert member_search_ids(client) == [JON]
