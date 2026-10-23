"""Tenant matching (R34): GET /me/matches/properties and /landlords, the refine and essentials routes.

The essentials are musts: a listing that fails one never appears, in the
matches, the landlord suggestions or what the model is shown. Results are
the caller's own and are recorded in recommendations. The model never runs
in these tests: a stub answers in its place (tests.test_provider_recommendations
does the same for the provider assistant).
"""

import copy

import httpx
import pytest
from postgrest.exceptions import APIError
from pydantic import SecretStr

from app.core.config import settings
from app.core.deps import CurrentProfile
from app.services import matching
from tests import fake_supabase
from tests.fake_supabase import FakeTableQuery
from tests.factories_matching import (
    MEI, OLIVIA, SAM, THEO, in_days, match_rows, review_of, seed_home, tenant_profile, uid, user_row,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

URL = "/api/v1/me/matches"
OTTO = uid("otto")
PRIVATE_OWNER = uid("private-owner")
MUSTS = {"budget_max": 650, "locations": ["Newtown"], "has_pets": True, "move_in": in_days(30), "bedrooms_min": 2}


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    """Never contact DeepSeek, even with a local key."""
    matching.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))

    def unexpected(_payload):
        raise AssertionError("This test must not contact the model")

    monkeypatch.setattr(matching, "call_model", unexpected)
    yield
    matching.clear_caches()


@pytest.fixture
def world(strict_schema):
    """Mei wants a pet-friendly 2-bedroom home in Newtown for at most $650 a week, in a month.

    She is verified: refining with the model is the paid AI (R18, tests/test_gate_wiring.py).
    """
    strict_schema.seed("users", [
        user_row(MEI, "Mei Lin", verification_status="APPROVED"),
        user_row(THEO, "Theo Tenant"),
        user_row(SAM, "Sam Reviewer"),
        user_row(OLIVIA, "Olivia Owner", "LANDLORD", verification_status="APPROVED", phone="0400 999 888"),
        user_row(OTTO, "Otto Owner", "LANDLORD"),
    ])
    strict_schema.seed("tenant_profiles", [tenant_profile(MEI, **MUSTS)])
    review_of(strict_schema, OLIVIA, 5, "great")
    review_of(strict_schema, OLIVIA, 4, "good")
    return strict_schema


def homes(db) -> dict[str, str]:
    """One home that meets every must, and one failing each of them; name -> listing id."""
    return {
        "fits": seed_home(db, OLIVIA, "Harbour flat", rent=620),
        "budget": seed_home(db, OLIVIA, "Pricey loft", rent=800),
        "location": seed_home(db, OTTO, "Glebe terrace", suburb="Glebe", postcode="2037"),
        "pets": seed_home(db, OTTO, "No pets unit", pets=False),
        "bedrooms": seed_home(db, OTTO, "Tiny studio", bedrooms=1),
        "move_in": seed_home(db, OTTO, "Later house", available_from=in_days(60)),
    }


def signed_in(as_profile, user_id=MEI):
    return as_profile(id=user_id, role="tenant", full_name="Mei Lin")


def ids(body: dict) -> list[str]:
    return [item["listing"]["id"] for item in body["items"]]


def enable_model(monkeypatch, answer=None):
    """A configured key and a stub model; by default it reverses the order and picks each first fact."""
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []

    def call(payload):
        calls.append(copy.deepcopy(payload))
        if answer is not None:
            return answer(payload)
        return {"recommendations": [
            {"listing_id": listing["listing_id"], "reason_codes": [listing["facts"][-1]["code"]]}
            for listing in reversed(payload["listings"])
        ]}

    monkeypatch.setattr(matching, "call_model", call)
    return calls


# -- who may ask ------------------------------------------------------------------
REQUESTS = [("get", "/properties"), ("post", "/properties/refine"), ("get", "/landlords"), ("put", "/essentials")]


@pytest.mark.parametrize("method, path", REQUESTS)
def test_signed_out_callers_get_401(client, method, path):
    response = client.request(method.upper(), URL + path, json={"essentials": []} if method == "put" else None)
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["landlord", "service_provider", "admin", "officer"])
@pytest.mark.parametrize("method, path", REQUESTS)
def test_only_tenants_have_matches(client, world, as_profile, role, method, path):
    as_profile(id=OLIVIA, role=role)
    response = client.request(method.upper(), URL + path, json={"essentials": []} if method == "put" else None)
    assert response.status_code == 403


# -- musts ------------------------------------------------------------------------
def test_a_listing_failing_a_must_never_appears(client, world, as_profile):
    listing = homes(world)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()

    assert ids(body) == [listing["fits"]]
    assert (body["considered"], body["excluded_total"]) == (6, 5)
    assert body["excluded"] == {"budget": 1, "location": 1, "pets": 1, "bedrooms": 1, "move_in": 1}
    assert body["has_preferences"] is True
    landlords = client.get(URL + "/landlords").json()["items"]
    assert [(landlord["id"], landlord["listing_count"]) for landlord in landlords] == [(OLIVIA, 1)]
    assert [home["id"] for home in landlords[0]["listings"]] == [listing["fits"]]


def test_the_reasons_are_the_facts_behind_the_match(client, world, as_profile):
    listing = homes(world)
    signed_in(as_profile)

    [match] = client.get(URL + "/properties").json()["items"]

    assert match["reasons"] == [
        "$620 a week, within your $650 budget",
        "In Newtown, NSW: one of your preferred areas",
        "Pets considered",
        "2 bedrooms (you want 2 or more)",
        "Available now",
        "Verified landlord",
        "Landlord rated 4.5 from 2 reviews",
        "Listed in the last week",
    ]
    assert match["unmet"] == []
    assert (match["match_level"], match["score"]) == ("strong", 99)
    assert match["landlord"] == {"id": OLIVIA, "verified": True, "rating_avg": 4.5, "review_count": 2}
    assert match["listing"]["id"] == listing["fits"]
    # What the listing page shows, never the street address.
    assert "Private Street" not in str(match)


def test_a_nice_to_have_ranks_a_home_lower_instead_of_leaving_it_out(client, world, as_profile):
    listing = homes(world)
    signed_in(as_profile)

    saved = client.put(URL + "/essentials", json={"essentials": ["budget", "pets", "bedrooms", "move_in"]})

    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert ids(body) == [listing["fits"], listing["location"]]
    glebe = body["items"][1]
    assert glebe["unmet"] == ["In Glebe, NSW: outside your preferred areas"]
    assert glebe["score"] < body["items"][0]["score"]
    assert {item["key"]: item["essential"] for item in body["filters"]} == {
        "budget": True, "location": False, "pets": True, "bedrooms": True, "move_in": True,
    }
    assert client.get(URL + "/properties").json()["items"] == body["items"]


def test_a_filter_without_a_saved_value_leaves_nothing_out(client, world, as_profile):
    world.tables["tenant_profiles"][0].update(has_pets=False, move_in_date=None)
    listing = homes(world)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()

    assert set(ids(body)) == {listing["fits"], listing["pets"], listing["move_in"]}
    assert {item["key"]: (item["active"], item["summary"]) for item in body["filters"]} == {
        "budget": (True, "Up to $650 a week"), "location": (True, "Newtown"), "pets": (False, None),
        "bedrooms": (True, "At least 2 bedrooms"), "move_in": (False, None),
    }


@pytest.mark.parametrize("place", ["Newtown", "newtown nsw", "Newtown, New South Wales 2042", "2042", "NSW"])
def test_a_preferred_area_can_be_a_suburb_postcode_or_state(client, world, as_profile, place):
    world.tables["tenant_profiles"][0]["preferred_locations"] = [place]
    listing = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    signed_in(as_profile)

    assert ids(client.get(URL + "/properties").json()) == [listing]


@pytest.mark.parametrize("place", ["Victoria Park", "victoria park wa", "Victoria Park, Western Australia 6100"])
def test_a_suburb_named_like_a_state_is_still_that_suburb(client, world, as_profile, place):
    world.tables["tenant_profiles"][0]["preferred_locations"] = [place]
    listing = seed_home(world, OLIVIA, "Park flat", rent=620, suburb="Victoria Park", state="WA", postcode="6100")
    signed_in(as_profile)

    assert ids(client.get(URL + "/properties").json()) == [listing]


@pytest.mark.parametrize("place", ["Sydney", "Newtown VIC", "Hills", "3000"])
def test_another_area_is_not_the_listings(client, world, as_profile, place):
    world.tables["tenant_profiles"][0]["preferred_locations"] = [place]
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()
    assert (body["items"], body["excluded"]) == ([], {"location": 1})


def test_only_published_listings_of_active_owners_that_the_tenant_has_not_applied_for(client, world, as_profile):
    world.seed("users", [user_row(uid("gone"), "Gone Owner", "LANDLORD", status="SUSPENDED")])
    fits = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    seed_home(world, OLIVIA, "Draft flat", rent=620, status="DRAFT")
    seed_home(world, OLIVIA, "Leased flat", rent=620, status="LEASED")
    seed_home(world, uid("gone"), "Suspended owner's flat", rent=620)
    applied = seed_home(world, OLIVIA, "Applied flat", rent=620)
    world.seed("rental_applications", [{"id": uid("application"), "listing_id": applied, "applicant_user_id": MEI,
                                        "offer_weekly_rent": 620, "updated_at": "2026-01-01T00:00:00+00:00"}])
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()
    assert (ids(body), body["considered"]) == ([fits], 1)


def test_an_owner_out_of_the_public_lists_lends_no_badges_and_is_not_suggested(client, world, as_profile):
    world.seed("users", [user_row(PRIVATE_OWNER, "Private Owner", "LANDLORD", verification_status="APPROVED",
                                  metadata={"privacy": {"public_profile": False}})])
    review_of(world, PRIVATE_OWNER, 5, "private")
    listing = seed_home(world, PRIVATE_OWNER, "Quiet flat", rent=620)
    signed_in(as_profile)

    [match] = client.get(URL + "/properties").json()["items"]
    assert match["listing"]["id"] == listing
    assert match["landlord"] is None
    assert not any("landlord" in reason.lower() for reason in match["reasons"])
    assert client.get(URL + "/landlords").json()["items"] == []


def test_landlords_come_with_their_public_profile_and_the_homes_that_fit(client, world, as_profile):
    first = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    second = seed_home(world, OLIVIA, "Second flat", rent=640, listed_days_ago=10)
    seed_home(world, OTTO, "Otto's flat", rent=600, listed_days_ago=40)
    seed_home(world, OTTO, "Otto's loft", rent=900)
    signed_in(as_profile)

    body = client.get(URL + "/landlords").json()

    assert [landlord["id"] for landlord in body["items"]] == [OLIVIA, OTTO]
    olivia = body["items"][0]
    assert (olivia["display_name"], olivia["role_label"], olivia["verified"]) == ("Olivia Owner", "Landlord", True)
    assert (olivia["rating_avg"], olivia["review_count"], olivia["listing_count"]) == (4.5, 2, 2)
    assert [home["id"] for home in olivia["listings"]] == [first, second]
    assert olivia["reasons"] == [
        "2 homes of theirs meet all your musts",
        "Best fit: Harbour flat, $620 a week",
        "Verified landlord",
        "Rated 4.5 from 2 reviews",
    ]
    # Their public profile's fields only: no email or phone.
    assert "0400 999 888" not in str(body) and "@example.test" not in str(body)


# -- empty states -----------------------------------------------------------------------
def test_without_preferences_there_is_nothing_to_match(client, world, as_profile):
    world.tables["tenant_profiles"][0].update(budget_max=None, preferred_locations=None, has_pets=False,
                                              move_in_date=None, metadata=None)
    homes(world)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()
    assert (body["items"], body["has_preferences"], body["considered"]) == ([], False, 0)
    landlords = client.get(URL + "/landlords").json()
    assert (landlords["items"], landlords["has_preferences"]) == ([], False)


def test_a_tenant_without_a_profile_row_gets_the_empty_state(client, world, as_profile):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    signed_in(as_profile, THEO)

    response = client.get(URL + "/properties")
    assert response.status_code == 200
    assert (response.json()["items"], response.json()["has_preferences"]) == ([], False)


def test_nothing_meeting_the_musts_is_an_empty_list_with_what_left_each_out(client, world, as_profile):
    seed_home(world, OLIVIA, "Pricey loft", rent=800)
    seed_home(world, OTTO, "Pricey studio", rent=900, bedrooms=1)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()
    assert (body["items"], body["has_preferences"]) == ([], True)
    assert (body["excluded"], body["excluded_total"]) == ({"budget": 2, "bedrooms": 1}, 2)
    assert client.get(URL + "/landlords").json()["items"] == []


def test_a_failed_read_is_an_error_not_an_empty_list(client, world, as_profile, monkeypatch):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    signed_in(as_profile)
    fail_queries_on(monkeypatch, "listings")

    for path in ("/properties", "/landlords"):
        response = client.get(URL + path)
        assert response.status_code == 500
        assert response.json() == {"detail": "Something went wrong. Please try again."}


def fail_queries_on(monkeypatch, table):
    """Every query on a public table fails as a statement timeout does (57014)."""
    execute = fake_supabase.FakeTableQuery.execute

    def _execute(query):
        if query._schema == "public" and query._name == table:
            raise APIError({"code": "57014", "message": f"query on {table} timed out"})
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", _execute)


# -- results are each tenant's own --------------------------------------------------------
def test_each_tenant_sees_only_their_own_matches(client, world, as_profile):
    listing = homes(world)
    world.seed("tenant_profiles", [tenant_profile(THEO, budget_max=900, locations=["Glebe"])])

    signed_in(as_profile, MEI)
    mine = ids(client.get(URL + "/properties").json())
    signed_in(as_profile, THEO)
    theirs = ids(client.get(URL + "/properties").json())

    assert mine == [listing["fits"]]
    assert theirs == [listing["location"]]
    assert {row["entity_id"] for row in match_rows(world, MEI)} == {listing["fits"]}
    assert {row["entity_id"] for row in match_rows(world, THEO)} == {listing["location"]}


def test_another_tenants_recorded_model_order_is_never_used(client, world, as_profile, monkeypatch):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    seed_home(world, OLIVIA, "Second flat", rent=600)
    world.seed("tenant_profiles", [tenant_profile(THEO, **MUSTS)])
    calls = enable_model(monkeypatch)
    signed_in(as_profile, MEI)
    refined = client.post(URL + "/properties/refine").json()

    signed_in(as_profile, THEO)
    theirs = client.get(URL + "/properties").json()

    assert refined["source"] == "ai" and len(calls) == 1
    assert (theirs["source"], theirs["cached"]) == ("rules", False)
    assert ids(theirs) == list(reversed(ids(refined)))


# -- recorded results ---------------------------------------------------------------------
def test_matches_are_recorded_once_and_a_refresh_writes_nothing(client, world, as_profile):
    listing = homes(world)
    signed_in(as_profile)

    client.get(URL + "/properties")
    first = copy.deepcopy(match_rows(world, MEI))
    client.get(URL + "/properties")

    assert match_rows(world, MEI) == first
    [row] = first
    assert (row["recommendation_type"], row["entity_type"], row["entity_id"], row["source"]) == (
        "PROPERTY", "listing", listing["fits"], "RULE_ENGINE")
    assert row["score"] == 99 and row["expires_at"]
    assert row["reason"].startswith("$620 a week, within your $650 budget")
    assert (row["payload"]["app"], row["payload"]["rank"], row["payload"]["match_level"]) == ("web", 1, "strong")


def test_changed_results_replace_the_recorded_ones(client, world, as_profile):
    listing = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    signed_in(as_profile)
    client.get(URL + "/properties")
    [before] = match_rows(world, MEI)

    next(row for row in world.tables["listings"] if row["id"] == listing)["weekly_rent"] = 640
    client.get(URL + "/properties")

    [after] = match_rows(world, MEI)
    assert after["id"] != before["id"]
    assert after["reason"].startswith("$640 a week")


def test_another_apps_recommendations_are_left_alone(client, world, as_profile):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    mobile = {"id": uid("mobile-row"), "target_user_id": MEI, "recommendation_type": "PROPERTY",
              "entity_type": "listing", "entity_id": "something", "payload": {"from": "mobile"}}
    world.seed("recommendations", [mobile])
    signed_in(as_profile)

    client.get(URL + "/properties")
    client.put(URL + "/essentials", json={"essentials": ["budget"]})

    assert any(row["id"] == mobile["id"] and row["payload"] == {"from": "mobile"}
               for row in world.tables["recommendations"])


def race_before_recording(monkeypatch, other):
    """Run other() once, between this request's delete of its recorded matches and its insert of the new ones."""
    execute = FakeTableQuery.execute
    pending = [other]

    def racing(query):
        if pending and query._name == "recommendations" and query._op == "insert":
            pending.pop()()
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", racing)


@pytest.mark.parametrize("path, recommendation_type", [("/properties", "PROPERTY"), ("/landlords", "USER")])
def test_two_requests_at_once_converge_on_one_set_of_recorded_matches(
    client, world, as_profile, monkeypatch, path, recommendation_type,
):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    seed_home(world, OLIVIA, "Second flat", rent=600)
    signed_in(as_profile)
    mei = CurrentProfile(id=MEI, role="tenant", full_name="Mei Lin", raw={})
    other = matching.get_property_matches if recommendation_type == "PROPERTY" else matching.get_landlord_matches
    # The other tab's request runs whole while this one is between its delete and its insert.
    race_before_recording(monkeypatch, lambda: other(mei))

    first = client.get(URL + path)

    assert first.status_code == 200, first.text
    rows = match_rows(world, MEI, recommendation_type)
    shown = [item["id"] if recommendation_type == "USER" else item["listing"]["id"] for item in first.json()["items"]]
    assert sorted(row["entity_id"] for row in rows) == sorted(shown)
    assert len({row["payload"]["batch"] for row in rows}) == 1
    # And the one set left is the tenant's recorded result: a refresh writes nothing.
    kept = copy.deepcopy(rows)
    client.get(URL + path)
    assert match_rows(world, MEI, recommendation_type) == kept


def test_the_newest_of_two_recorded_sets_is_the_one_kept(client, world, as_profile, monkeypatch):
    # A refine that ends after a page load recorded the rule order: the model's order is kept.
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    seed_home(world, OTTO, "Second flat", rent=640, listed_days_ago=20)
    calls = enable_model(monkeypatch)
    signed_in(as_profile)
    mei = CurrentProfile(id=MEI, role="tenant", full_name="Mei Lin", raw={})
    race_before_recording(monkeypatch, lambda: matching.get_property_matches(mei))

    refined = client.post(URL + "/properties/refine").json()

    assert (refined["source"], len(calls)) == ("ai", 1)
    assert {row["source"] for row in match_rows(world, MEI)} == {"AI"}
    again = client.get(URL + "/properties").json()
    assert (again["source"], again["cached"], ids(again)) == ("ai", True, ids(refined))


def test_landlord_suggestions_are_recorded_as_user_rows(client, world, as_profile):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    signed_in(as_profile)

    client.get(URL + "/landlords")
    client.get(URL + "/landlords")

    [row] = match_rows(world, MEI, "USER")
    assert (row["entity_type"], row["entity_id"], row["source"]) == ("user", OLIVIA, "RULE_ENGINE")


# -- the model -----------------------------------------------------------------------------
def test_it_works_without_model_credentials(client, world, as_profile):
    listing = homes(world)
    signed_in(as_profile)

    shown = client.get(URL + "/properties").json()
    refined = client.post(URL + "/properties/refine").json()

    for body in (shown, refined):
        assert (ids(body), body["source"], body["ai_status"]) == ([listing["fits"]], "rules", "not_configured")
        assert body["message"] == "AI ordering is not connected yet. These homes are ordered by your preferences."


@pytest.mark.parametrize("verification, status", [("PENDING", "pending"), ("REJECTED", "rejected")])
def test_an_unverified_tenant_is_told_up_front_why_the_ai_order_is_not_offered(
    client, world, as_profile, monkeypatch, verification, status,
):
    listing = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    next(row for row in world.tables["users"] if row["id"] == MEI)["verification_status"] = verification
    calls = enable_model(monkeypatch)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()

    # The matches themselves are open to every tenant (R18): only the AI order waits for verification.
    assert (ids(body), body["source"], body["ai_status"]) == ([listing], "rules", "verification_required")
    assert body["message"] == "AI ordering needs a verified account. These homes are ordered by your preferences."
    assert (body["verification"]["code"], body["verification"]["action"], body["verification"]["status"]) == (
        "verification_required", "paid_ai", status)
    assert body["verification"]["documents_href"] == "/tenant/id-verification"
    assert calls == []


def test_an_order_the_model_gave_is_not_served_once_the_account_is_back_in_review(
    client, world, as_profile, monkeypatch,
):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    seed_home(world, OTTO, "Second flat", rent=640, listed_days_ago=20)
    enable_model(monkeypatch)
    signed_in(as_profile)
    refined = client.post(URL + "/properties/refine").json()
    assert refined["source"] == "ai"

    next(row for row in world.tables["users"] if row["id"] == MEI)["verification_status"] = "PENDING"
    shown = client.get(URL + "/properties").json()

    assert (shown["source"], shown["ai_status"], shown["cached"]) == ("rules", "verification_required", False)
    assert ids(shown) == list(reversed(ids(refined)))
    # Verified again, the model's order comes back without another call.
    next(row for row in world.tables["users"] if row["id"] == MEI)["verification_status"] = "APPROVED"
    assert client.get(URL + "/properties").json()["source"] == "ai"


def test_without_a_model_key_nobody_is_asked_for_verification(client, world, as_profile):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    next(row for row in world.tables["users"] if row["id"] == MEI)["verification_status"] = "PENDING"
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()

    assert (body["ai_status"], body["verification"]) == ("not_configured", None)


def test_showing_matches_never_calls_the_model(client, world, as_profile, monkeypatch):
    seed_home(world, OLIVIA, "Harbour flat", rent=620)
    calls = enable_model(monkeypatch)
    signed_in(as_profile)

    body = client.get(URL + "/properties").json()

    assert (body["source"], body["ai_status"], calls) == ("rules", "ready", [])


def test_the_model_reorders_the_known_listings_with_their_own_facts(client, world, as_profile, monkeypatch):
    first = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    second = seed_home(world, OTTO, "Second flat", rent=640, listed_days_ago=20)
    calls = enable_model(monkeypatch)
    signed_in(as_profile)
    assert ids(client.get(URL + "/properties").json()) == [first, second]

    refined = client.post(URL + "/properties/refine").json()

    assert (ids(refined), refined["source"], refined["ai_status"], refined["cached"]) == (
        [second, first], "ai", "applied", False)
    # The fact it picked leads; the others follow.
    assert refined["items"][1]["reasons"][0] == "Listed in the last week"
    assert {row["entity_id"]: row["source"] for row in match_rows(world, MEI)} == {first: "AI", second: "AI"}
    # Shown again, the recorded order comes back without another call.
    again = client.get(URL + "/properties").json()
    assert (ids(again), again["source"], again["cached"], len(calls)) == ([second, first], "ai", True, 1)


def test_the_model_sees_aliases_and_facts_never_ids_titles_or_names(client, world, as_profile, monkeypatch):
    listing = seed_home(world, OLIVIA, "Harbour flat by Olivia", rent=620)
    calls = enable_model(monkeypatch)
    signed_in(as_profile)

    client.post(URL + "/properties/refine")

    [payload] = calls
    text = str(payload)
    for private in (listing, OLIVIA, MEI, "Harbour flat", "Olivia", "Mei", "Private Street", "@example.test"):
        assert private not in text
    assert payload["listings"][0]["listing_id"] == "listing_1"
    assert payload["tenant"]["musts"] == ["bedrooms", "budget", "location", "move_in", "pets"]


@pytest.mark.parametrize("answer", [
    # A listing it was not given: an alias out of range, a real id of a home that fails a must.
    lambda payload, excluded: {"recommendations": [{"listing_id": "listing_9", "reason_codes": ["within_budget"]}]},
    lambda payload, excluded: {"recommendations": [{"listing_id": excluded, "reason_codes": ["within_budget"]}]},
    # A listing left out, with another one named in its place.
    lambda payload, excluded: {"recommendations": [{"listing_id": "listing_1", "reason_codes": []}]},
    # A listing twice, a fact the listing does not have, extra keys, prose.
    lambda payload, excluded: {"recommendations": [{"listing_id": "listing_1", "reason_codes": ["within_budget"]}] * 2},
    lambda payload, excluded: {"recommendations": [{"listing_id": "listing_1", "reason_codes": ["cheapest_in_town"]}]},
    lambda payload, excluded: {"recommendations": [{"listing_id": "listing_1", "reason_codes": ["within_budget"],
                                                     "note": "trust me"}]},
    lambda payload, excluded: {"text": "The best home is the loft."},
])
def test_the_model_cannot_add_listings_or_reasons(client, world, as_profile, monkeypatch, answer):
    listing = homes(world)
    enable_model(monkeypatch, lambda payload: answer(payload, listing["budget"]))
    signed_in(as_profile)

    body = client.post(URL + "/properties/refine").json()

    assert (ids(body), body["source"], body["ai_status"]) == ([listing["fits"]], "rules", "unavailable")
    assert body["message"] == "AI is unavailable right now. These homes are ordered by your preferences."
    assert {row["entity_id"] for row in match_rows(world, MEI)} == {listing["fits"]}
    assert all(row["source"] == "RULE_ENGINE" for row in match_rows(world, MEI))


def test_a_model_failure_keeps_the_rule_order_and_then_cools_down(client, world, as_profile, monkeypatch):
    listing = seed_home(world, OLIVIA, "Harbour flat", rent=620)
    calls = []

    def fail(payload):
        calls.append(payload)
        raise httpx.ReadTimeout("slow")

    enable_model(monkeypatch, fail)
    signed_in(as_profile)

    failed = client.post(URL + "/properties/refine").json()
    again = client.post(URL + "/properties/refine").json()

    assert (ids(failed), failed["ai_status"]) == ([listing], "unavailable")
    assert (ids(again), again["ai_status"], len(calls)) == ([listing], "cooldown", 1)


# -- essentials ------------------------------------------------------------------------------
def test_saving_musts_keeps_every_other_preference(client, world, as_profile):
    world.tables["tenant_profiles"][0]["metadata"] = {
        "rental_preferences": {"bedrooms_min": 2, "notes": "Near a park", "keep_me": "mobile"},
        "employment": {"employer": "Acme"},
    }
    signed_in(as_profile)

    response = client.put(URL + "/essentials", json={"essentials": ["budget", "pets", "budget"]})

    assert response.status_code == 200, response.text
    assert world.tables["tenant_profiles"][0]["metadata"] == {
        "rental_preferences": {"bedrooms_min": 2, "notes": "Near a park", "keep_me": "mobile",
                               "essentials": ["budget", "pets"]},
        "employment": {"employer": "Acme"},
    }
    # The profile page still reads and saves the preferences as before, and the marks stay.
    profile = client.get("/api/v1/profiles/me").json()
    assert profile["tenant"]["rental_preferences"]["bedrooms_min"] == 2
    saved = client.patch("/api/v1/profiles/me", json={"tenant": {"rental_preferences": {"bedrooms_min": 3}}})
    assert saved.status_code == 200, saved.text
    assert world.tables["tenant_profiles"][0]["metadata"]["rental_preferences"]["essentials"] == ["budget", "pets"]


def test_no_musts_at_all_is_a_choice_too(client, world, as_profile):
    listing = homes(world)
    signed_in(as_profile)

    body = client.put(URL + "/essentials", json={"essentials": []}).json()

    assert set(ids(body)) == set(listing.values())
    assert body["excluded_total"] == 0
    assert not any(item["essential"] for item in body["filters"])


def test_saving_musts_makes_the_profile_row_a_tenant_lacks(client, world, as_profile):
    signed_in(as_profile, THEO)

    response = client.put(URL + "/essentials", json={"essentials": ["pets"]})

    assert response.status_code == 200, response.text
    [row] = [row for row in world.tables["tenant_profiles"] if row["user_id"] == THEO]
    assert row["metadata"] == {"rental_preferences": {"essentials": ["pets"]}}
    assert response.json()["has_preferences"] is False


@pytest.mark.parametrize("payload", [
    {"essentials": ["budget", "garden"]}, {"essentials": "budget"}, {}, {"essentials": [], "tenant_id": THEO},
])
def test_musts_are_checked_before_anything_is_saved(client, world, as_profile, payload):
    signed_in(as_profile)
    before = copy.deepcopy(world.tables["tenant_profiles"])

    assert client.put(URL + "/essentials", json=payload).status_code == 422
    assert world.tables["tenant_profiles"] == before
