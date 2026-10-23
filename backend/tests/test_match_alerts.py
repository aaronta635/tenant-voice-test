"""Match alerts (R36): a tenant hears about a strong match when a listing is published or their preferences change.

alert_matches_for_listing() is for the listing publish path and
alert_matches_for_tenant() for a preferences save. A tenant hears about a
listing at most once (the recommendations alert rows), never because a page
was loaded, and not at all while their match notices are off. Each notice is
about one listing and links to /matches/property/<id>, as the mobile app's
mobile_notify_matches links one, so neither app sends a match twice.
"""

import logging

import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services import matching
from tests.factories_identity import fail_inserts
from tests.factories_matching import (
    MEI, OLIVIA, SAM, THEO, alert_rows, in_days, seed_home, tenant_profile, uid, user_row,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

URL = "/api/v1/me/matches"
ZOE = uid("zoe")
AVA = uid("ava")
MUSTS = {"budget_max": 650, "locations": ["Newtown"], "bedrooms_min": 2}


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    matching.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))


@pytest.fixture
def tenants(strict_schema):
    """Mei and Zoe want the same home; Theo wants a bigger budget's home; Ava turned property matches off."""
    strict_schema.seed("users", [
        user_row(MEI, "Mei Lin"),
        user_row(ZOE, "Zoe Tenant"),
        user_row(THEO, "Theo Tenant"),
        user_row(AVA, "Ava Tenant", metadata={"notification_preferences": {"property": False}}),
        user_row(SAM, "Sam Reviewer"),
        user_row(OLIVIA, "Olivia Owner", "LANDLORD"),
    ])
    strict_schema.seed("tenant_profiles", [
        tenant_profile(MEI, **MUSTS),
        tenant_profile(ZOE, **MUSTS),
        tenant_profile(THEO, budget_max=400, locations=["Newtown"]),
        tenant_profile(AVA, **MUSTS),
    ])
    return strict_schema


def notices(db, user_id: str | None = None) -> list[dict]:
    return [row for row in db.tables.get("notifications", []) if user_id is None or row["user_id"] == user_id]


# -- a listing is published ---------------------------------------------------------
def test_publishing_alerts_each_tenant_it_is_a_strong_match_for(tenants):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    assert matching.alert_matches_for_listing(listing) == 2

    assert sorted(row["user_id"] for row in notices(tenants)) == sorted([MEI, ZOE])
    notice = notices(tenants, MEI)[0]
    assert (notice["title"], notice["category"], notice["link"]) == (
        "A new home matches your preferences", "system", f"/matches/property/{listing}")
    assert notice["body"] == "Harbour flat, Newtown, NSW: $620 a week."
    [row] = alert_rows(tenants, MEI)
    assert (row["recommendation_type"], row["entity_type"], row["entity_id"], row["source"]) == (
        "PROPERTY", "listing", listing, "RULE_ENGINE")
    assert (row["payload"]["app"], row["payload"]["trigger"]) == ("web", "listing_published")


@pytest.mark.parametrize("saved", [{"locations": ["Newtown"]}, {"bedrooms_min": 2}, {"has_pets": True}])
def test_a_home_meeting_every_preference_a_tenant_saved_is_alerted(strict_schema, saved):
    # One preference saved, met in full, by an unverified landlord without reviews: under STRONG, still a fit.
    strict_schema.seed("users", [user_row(ZOE, "Zoe Tenant"), user_row(OLIVIA, "Olivia Owner", "LANDLORD")])
    strict_schema.seed("tenant_profiles", [tenant_profile(ZOE, **saved)])
    listing = seed_home(strict_schema, OLIVIA, "Harbour flat", rent=620)

    assert matching.alert_matches_for_listing(listing) == 1
    assert [row["user_id"] for row in notices(strict_schema)] == [ZOE]


def test_a_home_missing_a_nice_to_have_needs_a_strong_score(strict_schema):
    strict_schema.seed("users", [user_row(ZOE, "Zoe Tenant"), user_row(OLIVIA, "Olivia Owner", "LANDLORD")])
    strict_schema.seed("tenant_profiles", [
        tenant_profile(ZOE, locations=["Newtown"], bedrooms_min=3, essentials=["location"]),
    ])
    listing = seed_home(strict_schema, OLIVIA, "Harbour flat", rent=620, bedrooms=2)

    assert matching.alert_matches_for_listing(listing) == 0
    assert notices(strict_schema) == []


def test_publishing_again_never_alerts_a_tenant_twice(tenants):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    matching.alert_matches_for_listing(listing)
    assert matching.alert_matches_for_listing(listing) == 0
    assert matching.alert_matches_for_tenant(MEI) == 0

    assert len(notices(tenants, MEI)) == 1
    assert len(alert_rows(tenants, MEI)) == 1


def test_a_refresh_never_sends_or_resends_an_alert(client, tenants, as_profile):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    as_profile(id=MEI, role="tenant")

    for _ in range(3):
        assert client.get(URL + "/properties").status_code == 200
        assert client.get(URL + "/landlords").status_code == 200
    assert notices(tenants) == []
    assert alert_rows(tenants) == []

    matching.alert_matches_for_listing(listing)
    for _ in range(3):
        client.get(URL + "/properties")
    assert len(notices(tenants, MEI)) == 1


def test_no_alert_for_a_listing_that_is_not_published_or_a_must_it_fails(tenants):
    draft = seed_home(tenants, OLIVIA, "Draft flat", rent=620, status="DRAFT")
    pricey = seed_home(tenants, OLIVIA, "Pricey flat", rent=900)

    assert matching.alert_matches_for_listing(draft) == 0
    assert matching.alert_matches_for_listing(pricey) == 0
    assert matching.alert_matches_for_listing("not-a-listing") == 0
    assert notices(tenants) == []


def test_no_alert_to_someone_who_turned_property_matches_off(tenants):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    matching.alert_matches_for_listing(listing)

    assert notices(tenants, AVA) == []
    assert alert_rows(tenants, AVA) == []
    assert matching.alert_matches_for_tenant(AVA) == 0


def test_no_alert_for_a_weak_match_or_a_listing_already_applied_for(tenants):
    # Nice to have only: a home outside her areas and without the bedrooms is a weak match.
    tenants.tables["tenant_profiles"][0]["metadata"] = {"rental_preferences": {"bedrooms_min": 2, "essentials": []}}
    weak = seed_home(tenants, OLIVIA, "Glebe studio", rent=620, suburb="Glebe", postcode="2037", bedrooms=1,
                     listed_days_ago=60)
    applied = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    tenants.seed("rental_applications", [{"id": uid("application"), "listing_id": applied, "applicant_user_id": ZOE,
                                          "offer_weekly_rent": 620, "updated_at": "2026-01-01T00:00:00+00:00"}])

    matching.alert_matches_for_listing(weak)
    matching.alert_matches_for_listing(applied)

    assert [row["user_id"] for row in notices(tenants)] == [MEI]
    assert notices(tenants, MEI)[0]["link"] == f"/matches/property/{applied}"


def test_a_listing_of_a_suspended_owner_alerts_nobody(tenants):
    tenants.tables["users"][-1]["status"] = "SUSPENDED"
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    assert matching.alert_matches_for_listing(listing) == 0
    assert notices(tenants) == []


# -- preferences change ---------------------------------------------------------------
def test_new_preferences_alert_the_matches_not_alerted_yet(tenants):
    first = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    second = seed_home(tenants, OLIVIA, "Second flat", rent=600, listed_days_ago=3)
    matching.alert_matches_for_listing(first)

    assert matching.alert_matches_for_tenant(MEI) == 1

    latest = notices(tenants, MEI)[-1]
    assert (latest["title"], latest["link"]) == ("A home matches your preferences", f"/matches/property/{second}")
    assert latest["body"] == "Second flat, Newtown, NSW: $600 a week."
    assert {row["entity_id"] for row in alert_rows(tenants, MEI)} == {first, second}
    assert matching.alert_matches_for_tenant(MEI) == 0
    assert len(notices(tenants, MEI)) == 2


def test_each_new_match_gets_its_own_notice_with_the_mobile_link(tenants):
    homes = [seed_home(tenants, OLIVIA, name, rent=rent)
             for name, rent in (("Harbour flat", 620), ("Second flat", 600), ("Third flat", 640))]

    assert matching.alert_matches_for_tenant(MEI) == 3

    assert sorted(row["link"] for row in notices(tenants, MEI)) == sorted(f"/matches/property/{home}" for home in homes)
    assert {row["title"] for row in notices(tenants, MEI)} == {"A home matches your preferences"}


def test_one_save_sends_at_most_as_many_match_notices_as_the_mobile_app_takes(tenants, monkeypatch):
    monkeypatch.setattr(matching, "MATCH_NOTICES", 2)
    for name in ("Harbour flat", "Second flat", "Third flat"):
        seed_home(tenants, OLIVIA, name, rent=620)

    assert matching.alert_matches_for_tenant(MEI) == 2
    # The one left over is not recorded, so the next save tells her about it.
    assert len(alert_rows(tenants, MEI)) == 2
    assert matching.alert_matches_for_tenant(MEI) == 1
    assert len(notices(tenants, MEI)) == 3


# -- the mobile app's notices and switches ---------------------------------------------
def test_a_match_the_mobile_app_already_sent_is_not_sent_again(tenants):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    # What mobile_notify_matches writes for a property match.
    tenants.seed("notifications", [{
        "id": uid("mobile-match"), "user_id": MEI, "title": "New match", "body": "Harbour flat",
        "category": "system", "link": f"/matches/property/{listing}", "is_read": False,
    }])

    assert matching.alert_matches_for_listing(listing) == 1
    assert matching.alert_matches_for_tenant(MEI) == 0

    assert [row["user_id"] for row in notices(tenants) if row["title"] != "New match"] == [ZOE]
    assert alert_rows(tenants, MEI) == []


@pytest.mark.parametrize("switches", [{"matches": False}, {"pushEnabled": False}, {"matches": "false"}])
def test_the_mobile_apps_switches_stop_match_alerts(tenants, switches):
    tenants.tables["users"][0]["metadata"] = {"mobile": {"notificationPreferences": switches, "theme": "dark"}}
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    matching.alert_matches_for_listing(listing)

    assert matching.alert_matches_for_tenant(MEI) == 0
    assert notices(tenants, MEI) == []
    assert alert_rows(tenants, MEI) == []


def test_the_mobile_switch_wins_over_the_webs_earlier_one(tenants):
    # Ava turned property notices off on the web before; the mobile app turned matches back on.
    tenants.tables["users"][3]["metadata"]["mobile"] = {"notificationPreferences": {"matches": True}}
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    matching.alert_matches_for_listing(listing)

    assert [row["link"] for row in notices(tenants, AVA)] == [f"/matches/property/{listing}"]


def test_saving_musts_alerts_the_homes_they_let_in_once(client, tenants, as_profile):
    glebe = seed_home(tenants, OLIVIA, "Glebe flat", rent=620, suburb="Glebe", postcode="2037")
    as_profile(id=MEI, role="tenant")
    tenants.tables["tenant_profiles"][0]["preferred_locations"] = ["Newtown", "Glebe"]

    client.put(URL + "/essentials", json={"essentials": ["budget", "location", "bedrooms"]})
    client.put(URL + "/essentials", json={"essentials": ["budget", "bedrooms"]})
    client.get(URL + "/properties")

    [notice] = notices(tenants, MEI)
    assert notice["link"] == f"/matches/property/{glebe}"


PROFILE = "/api/v1/profiles/me"


def test_a_profile_save_that_changes_preferences_alerts_the_matches_it_lets_in_once(client, tenants, as_profile):
    roomy = seed_home(tenants, OLIVIA, "Roomy flat", rent=700)  # over Mei's $650 budget
    as_profile(id=MEI, role="tenant")

    raised = client.patch(PROFILE, json={"tenant": {"budget_max": 750}})

    assert raised.status_code == 200, raised.text
    [notice] = notices(tenants, MEI)
    assert (notice["title"], notice["link"]) == ("A home matches your preferences", f"/matches/property/{roomy}")
    assert [row["payload"]["trigger"] for row in alert_rows(tenants, MEI)] == ["preferences_changed"]


def test_a_save_that_changes_no_preference_alerts_nobody(client, tenants, as_profile):
    as_profile(id=MEI, role="tenant")
    client.patch(PROFILE, json={"tenant": {"budget_max": 750}})
    # A home published without its own alert (another app, say): only a change of preferences looks again.
    newer = seed_home(tenants, OLIVIA, "Roomy flat", rent=720)

    same = client.patch(PROFILE, json={"tenant": {"budget_max": 750}})
    other = client.patch(PROFILE, json={"tenant": {"about_me": "Quiet, tidy and on time with rent."}})
    client.get(PROFILE)
    client.get(URL + "/properties")

    assert (same.status_code, other.status_code) == (200, 200)
    assert notices(tenants, MEI) == []
    # The next change of preferences finds it.
    client.patch(PROFILE, json={"tenant": {"rental_preferences": {"bathrooms_min": 1}}})
    assert [notice["link"] for notice in notices(tenants, MEI)] == [f"/matches/property/{newer}"]


def test_saving_the_same_musts_again_alerts_nobody(client, tenants, as_profile):
    as_profile(id=MEI, role="tenant")
    client.put(URL + "/essentials", json={"essentials": ["budget", "location"]})
    home = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    client.put(URL + "/essentials", json={"essentials": ["budget", "location"]})
    assert notices(tenants, MEI) == []

    client.put(URL + "/essentials", json={"essentials": ["budget"]})
    assert [notice["link"] for notice in notices(tenants, MEI)] == [f"/matches/property/{home}"]


def test_a_preferences_alert_that_fails_never_fails_the_save(client, tenants, as_profile, monkeypatch, caplog):
    seed_home(tenants, OLIVIA, "Roomy flat", rent=700)
    fail_inserts(monkeypatch, "recommendations", times=10)
    as_profile(id=MEI, role="tenant")

    with caplog.at_level(logging.ERROR, logger="app.services.matching"):
        response = client.patch(PROFILE, json={"tenant": {"budget_max": 750}})

    assert response.status_code == 200, response.text
    assert response.json()["tenant"]["budget_max"] == 750
    assert notices(tenants, MEI) == []
    assert len(caplog.records) == 1


def test_a_tenant_whose_account_is_not_active_is_not_alerted(tenants):
    tenants.tables["users"][0]["status"] = "SUSPENDED"
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)

    assert matching.alert_matches_for_tenant(MEI) == 0
    matching.alert_matches_for_listing(listing)
    assert notices(tenants, MEI) == []


# -- once, even when two alerts race ------------------------------------------------------
def test_of_two_racing_alerts_only_the_first_is_sent(tenants):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    db = matching.get_supabase_client()
    prefs = matching.preferences_of(tenants.tables["tenant_profiles"][0])
    fit = matching._fit(prefs, db.table("listings").select(matching.LISTING_COLUMNS).execute().data[0], None,
                        matching._now())

    won_first = matching._claim(db, MEI, [fit], "listing_published", matching._now())
    won_second = matching._claim(db, MEI, [fit], "preferences_changed", matching._now())

    assert [match.id for match in won_first] == [listing]
    assert won_second == []
    [row] = alert_rows(tenants, MEI)
    assert row["payload"]["trigger"] == "listing_published"


def test_alerts_never_raise(tenants, monkeypatch, caplog):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    fail_inserts(monkeypatch, "recommendations", times=10)

    with caplog.at_level(logging.ERROR, logger="app.services.matching"):
        assert matching.alert_matches_for_listing(listing) == 0
        assert matching.alert_matches_for_tenant(MEI) == 0

    assert notices(tenants) == []
    # One record for each of Mei's and Zoe's failed listing alerts, and one for Mei's preferences alert.
    assert len(caplog.records) == 3


def test_one_tenants_failed_alert_never_keeps_it_from_the_others(tenants, monkeypatch, caplog):
    listing = seed_home(tenants, OLIVIA, "Harbour flat", rent=620)
    fail_inserts(monkeypatch, "recommendations", times=1)

    with caplog.at_level(logging.ERROR, logger="app.services.matching"):
        assert matching.alert_matches_for_listing(listing) == 1

    [told] = {row["user_id"] for row in notices(tenants)}
    assert told in (MEI, ZOE)
    assert len(caplog.records) == 1
    # The tenant whose alert failed still hears about it the next time the listing is published.
    assert matching.alert_matches_for_listing(listing) == 1
    assert sorted(row["user_id"] for row in notices(tenants)) == sorted([MEI, ZOE])


def test_the_essentials_alerts_follow_an_in_time_move(tenants):
    # A move-in date the listing is free by is met; one it is not free by is a must it fails.
    tenants.tables["tenant_profiles"][0]["move_in_date"] = in_days(14)
    later = seed_home(tenants, OLIVIA, "Later flat", rent=620, available_from=in_days(30))
    sooner = seed_home(tenants, OLIVIA, "Sooner flat", rent=620, available_from=in_days(7))

    matching.alert_matches_for_listing(later)
    matching.alert_matches_for_listing(sooner)

    assert [row["link"] for row in notices(tenants, MEI)] == [f"/matches/property/{sooner}"]
