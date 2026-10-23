"""Provider suggestions for owners and tenants (tracker R31) on the strict shared schema.

GET /me/provider-suggestions ranks the providers the marketplace lists by
where they work (a suburb their service areas name, then the postcode, then
the state), their rating (averaged with a prior, so one 5-star review does
not beat 40 good ones) and their price against the median of the same
pricing type in their category (assumption #10: cost-effective, not
cheapest), the verified badge breaking a tie. Each reason states one of those
facts. An owner gets suggestions for one of their own properties or for all
of them, a tenant for their own and preferred areas, and nobody else asks.
"""

import pytest

from app.services import provider_ranking as ranking
from tests.factories import NOW
from tests.factories_identity import account
from tests.factories_provider_core import category_row, provider_profile, provider_user, review_row, service_row
from tests.factories_recommendations import member, signed_in, uid, users
from tests.factories_rental import listing_row, property_row

pytestmark = pytest.mark.usefixtures("strict_schema")

URL = "/api/v1/me/provider-suggestions"
OWNER, OTHER_OWNER, AGENT, TENANT, REVIEWER = (uid(name) for name in ("owner", "other-owner", "agent", "tenant", "reviewer"))
NEWTOWN, PADDINGTON, BONDI, SOLD = (uid(name) for name in ("newtown-home", "paddington-home", "bondi-home", "sold-home"))
FLAT = "flat"


def provider(db, key, business, *, category="cleaner", based=(None, None, None), area=None,
             services=(("Standard clean", 150, FLAT, ""),), reviews=(), published=True, verified=False, **account_row):
    """A listed provider: its owner's users row, its profile and its live services; returns its id.

    services are (title, price, pricing type, service area); reviews are
    (rating, status) about the provider.
    """
    provider_id = uid(key)
    location, state, postcode = based
    db.seed("users", [provider_user(provider_id, f"{business} Owner", location, state, postcode,
                                    email=f"{key}@example.test", phone="0400 111 222",
                                    verification_status="APPROVED" if verified else "PENDING", **account_row)])
    db.seed("service_provider_profiles", [
        {**provider_profile(provider_id, business, category, slug=key, published=published), "service_area": area},
    ])
    if services:
        db.seed("mobile_provider_services", [
            service_row(uid(f"{key}-service-{index}"), provider_id, title=title, price=price, pricing_type=kind,
                        service_area=served, created_at=f"2026-01-01T00:{index:02d}:00+00:00")
            for index, (title, price, kind, served) in enumerate(services)
        ])
    if reviews:
        db.seed("reviews", [
            review_row(uid(f"{key}-review-{index}"), provider_id, REVIEWER, rating, review_status)
            for index, (rating, review_status) in enumerate(reviews)
        ])
    return provider_id


def home(db, listing_id, owner, title, suburb, postcode, state="NSW", status="PUBLISHED", manager=None):
    """One of an owner's properties and its listing; the web's property id is the listing's."""
    property_id = uid(f"{listing_id}-property")
    db.seed("properties", [property_row(owner, id=property_id, suburb=suburb, postcode=postcode, state=state,
                                        address_line_1="7 Private Lane", manager_user_id=manager)])
    db.seed("listings", [listing_row(property_id, owner, status, id=listing_id, title=title)])


@pytest.fixture
def base(fake_db):
    """The catalogue, the people and their homes, before any provider."""
    fake_db.seed("service_categories", [
        category_row("cleaner", "Cleaning Provider", "cleaning-provider"),
        category_row("tradie", "Tradies", "tradies", sort_order=2),
    ], schema="web")
    fake_db.seed("users", [
        member(OWNER, "landlord", "Olivia Owner", "Paddington", "NSW", "2021"),
        member(OTHER_OWNER, "landlord", "Oscar Other", "Bondi", "NSW"),
        member(AGENT, "agent", "Avery Agent", "Glebe", "NSW"),
        member(TENANT, "tenant", "Tia Tenant", "Glebe", "NSW", "2037"),
        member(REVIEWER, "tenant", "Rita Reviewer"),
    ])
    home(fake_db, NEWTOWN, OWNER, "King St terrace", "Newtown", "2042", manager=AGENT)
    home(fake_db, PADDINGTON, OWNER, "Oxford St flat", "Paddington", "2021")
    home(fake_db, BONDI, OTHER_OWNER, "Bondi unit", "Bondi", "2026")
    home(fake_db, SOLD, OWNER, "Sold cottage", "Perth", "6000", state="WA", status="ARCHIVED")
    fake_db.seed("tenant_profiles", [{"user_id": TENANT, "preferred_locations": ["Newtown, NSW"], "updated_at": NOW}])
    return fake_db


@pytest.fixture
def world(base):
    """Cleaners at every distance from the Newtown home, a tradie, and providers that must never appear.

    The listed cleaners' fixed prices are 120, 140, 150, 150, 160 and 200:
    a $150 median. Those that are never listed charge nothing that counts.
    """
    provider(base, "sparkle", "Sparkle Cleaning", based=("Marrickville", "NSW", "2204"), area="Newtown, Enmore",
             services=(("Bond clean", 120, FLAT, ""),), verified=True,
             reviews=((5, "PUBLISHED"), (5, "PUBLISHED"), (5, "PUBLISHED"), (4, "FLAGGED"), (1, "HIDDEN"), (1, "ARCHIVED")))
    provider(base, "local", "Local Cleaners", based=("Newtown", "NSW", "2042"), services=(("Regular clean", 150, FLAT, ""),))
    provider(base, "postcode", "Postcode Cleaners", based=("Sydney", "NSW", "2000"),
             services=(("Deep clean", 150, FLAT, "2042, 2043"),))
    provider(base, "statewide", "Statewide Cleaning", based=("Wollongong", "NSW", "2500"), area="NSW",
             services=(("Office clean", 200, FLAT, ""),), reviews=((4, "PUBLISHED"), (4, "PUBLISHED")))
    provider(base, "far", "Far Cleaning", based=("Perth", "WA", "6000"), area="Perth",
             services=(("Window clean", 160, FLAT, ""),))
    provider(base, "geelong", "Geelong Cleaning", based=("Geelong", "VIC", "3220"), area="Newtown",
             services=(("Carpet clean", 140, FLAT, ""),))
    provider(base, "tradie", "Newtown Trades", category="tradie", based=("Enmore", "NSW", "2042"), area="Newtown",
             services=(("Fix a tap", 90, FLAT, ""),))
    # Never suggested, whatever they charge or wherever they work.
    for key, over in (("suspended", {"status": "SUSPENDED"}), ("deactivated", {"status": "DEACTIVATED"}),
                      ("deleted", {"deleted_at": NOW}), ("draft", {"published": False})):
        provider(base, key, f"{key.title()} Cleaning", area="Newtown", services=(("Cheap clean", 10, FLAT, ""),),
                 reviews=((5, "PUBLISHED"),) * 5, **over)
    provider(base, "unbookable", "Unbookable Cleaning", area="Newtown", services=())
    base.seed("mobile_provider_services", [
        service_row(uid("unbookable-draft"), uid("unbookable"), title="Draft clean", price=20, live=False, service_area=""),
    ])
    return base


def ask(client, **query):
    response = client.get(URL, params=query)
    assert response.status_code == 200, response.text
    return response.json()


def names(body) -> list[str]:
    return [item["display_name"] for item in body["items"]]


def by_name(body) -> dict[str, dict]:
    return {item["display_name"]: item for item in body["items"]}


def as_owner(as_profile, db, user_id=OWNER):
    return signed_in(as_profile, users(db)[user_id])


# ---------------------------------------------------------------------------
# The factors
# ---------------------------------------------------------------------------
def test_a_suburb_served_comes_before_its_postcode_then_its_state(client, world, as_profile):
    as_owner(as_profile, world)

    body = ask(client, property_id=NEWTOWN, category="cleaner")

    assert [(item["display_name"], item["match"]) for item in body["items"]] == [
        ("Sparkle Cleaning", "suburb"),
        ("Local Cleaners", "suburb"),
        ("Postcode Cleaners", "postcode"),
        ("Statewide Cleaning", "state"),
    ]
    assert [item["reasons"][0] for item in body["items"]] == [
        "Serves Newtown", "Based in Newtown", "Serves postcode 2042", "Serves NSW",
    ]


def test_providers_working_elsewhere_are_left_out(client, world, as_profile):
    as_owner(as_profile, world)

    shown = set(names(ask(client, property_id=NEWTOWN, category="cleaner")))

    # Geelong's "Newtown" is the Newtown in Victoria: a service area without a state is in the provider's own.
    assert not shown & {"Far Cleaning", "Geelong Cleaning"}


@pytest.mark.parametrize("area", ["Newtown", "newtown nsw", "15km of Newtown", "Inner West/Newtown", "Enmore; Newtown 2042"])
def test_a_service_area_names_the_suburb_however_it_is_written(base, area):
    provider(base, "written", "Written Cleaning", based=("Sydney", "NSW", "2000"),
             services=(("Bond clean", 120, FLAT, area),))

    [item] = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    assert (item["match"], item["reasons"][0]) == ("suburb", "Serves Newtown")


def test_a_service_area_naming_another_suburb_is_no_match_for_this_one(base):
    provider(base, "glebe", "Glebe Cleaning", based=("Glebe", "VIC", "3000"), services=(("Bond clean", 120, FLAT, "Glebe"),))

    assert ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")]) == []


def test_the_rating_counts_the_reviews_a_profile_shows(client, world, as_profile):
    as_owner(as_profile, world)

    sparkle = by_name(ask(client, property_id=NEWTOWN))["Sparkle Cleaning"]

    # Published and flagged count; hidden and archived reviews do not.
    assert (sparkle["rating_avg"], sparkle["review_count"]) == (4.75, 4)
    assert sparkle["reasons"][1] == "4.8 from 4 reviews"


def test_one_five_star_review_does_not_outrank_forty_good_ones(base):
    provider(base, "lucky", "Lucky Cleaning", area="Newtown", reviews=((5, "PUBLISHED"),))
    provider(base, "proven", "Proven Cleaning", area="Newtown", reviews=((5, "PUBLISHED"),) * 20 + ((4, "PUBLISHED"),) * 20)

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    assert [(item["display_name"], item["rating_avg"]) for item in items] == [("Proven Cleaning", 4.5), ("Lucky Cleaning", 5.0)]
    assert [item["reasons"][1] for item in items] == ["4.5 from 40 reviews", "5.0 from 1 review"]


def test_a_new_provider_ranks_above_a_poorly_rated_one(base):
    provider(base, "poor", "Poor Cleaning", area="Newtown", reviews=((1, "PUBLISHED"), (2, "PUBLISHED")))
    provider(base, "new", "New Cleaning", area="Newtown")

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    assert names({"items": items}) == ["New Cleaning", "Poor Cleaning"]
    assert items[0]["reasons"][1] == "No reviews yet"


def test_prices_are_compared_with_the_same_pricing_type_only(base):
    for index, price in enumerate((100, 150, 200, 250)):
        provider(base, f"fixed-{index}", f"Fixed {index}", area="Sydney", services=(("Bond clean", price, FLAT, ""),))
    for index, rate in enumerate((40, 60, 80, 90)):
        provider(base, f"hourly-{index}", f"Hourly {index}", area="Sydney", services=(("Clean", rate, "hourly", ""),))
    provider(base, "rated", "Hourly Helpers", area="Newtown", services=(("Clean by the hour", 50, "hourly", ""),))
    provider(base, "fixed", "Fixed Price Cleaning", area="Newtown", services=(("Bond clean", 120, FLAT, ""),))

    found = by_name({"items": ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])})

    # Rates are not mixed into fixed prices: all ten together would make a $95 median.
    assert found["Hourly Helpers"]["reasons"][2] == "$50 per hour, below the $60 median for cleaning"
    assert found["Hourly Helpers"]["price_comparison"] == {"median": 60.0, "position": "below", "compared": 5}
    assert found["Fixed Price Cleaning"]["reasons"][2] == "$120 fixed, below the $150 median for cleaning"
    assert found["Fixed Price Cleaning"]["price_comparison"] == {"median": 150.0, "position": "below", "compared": 5}


def test_each_provider_is_one_price_in_the_median_and_offers_its_cheapest(base):
    provider(base, "range", "Range Cleaning", area="Newtown",
             services=(("Deep clean", 300, FLAT, ""), ("Quick clean", 100, FLAT, ""), ("Not priced yet", 0, FLAT, "")))
    provider(base, "two", "Two Cleaning", area="Sydney", services=(("Clean", 200, FLAT, ""),))
    provider(base, "three", "Three Cleaning", area="Sydney", services=(("Clean", 400, FLAT, ""),))

    found = by_name({"items": ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])})

    assert found["Range Cleaning"]["service"] == {
        "id": uid("range-service-1"), "title": "Quick clean", "pricing_type": FLAT, "price": 100.0,
    }
    # 100, 200 and 400: Range's $300 is not a fourth price.
    assert found["Range Cleaning"]["price_comparison"] == {"median": 200.0, "position": "below", "compared": 3}


def test_at_or_below_the_median_is_cost_effective_not_cheapest(base):
    provider(base, "mid", "Mid Cleaning", area="Sydney", services=(("Clean", 150, FLAT, ""),))
    provider(base, "bargain", "Bargain Cleaning", area="Newtown", services=(("Clean", 50, FLAT, ""),),
             reviews=((4, "PUBLISHED"),) * 10)
    provider(base, "value", "Value Cleaning", area="Newtown", services=(("Clean", 140, FLAT, ""),),
             reviews=((5, "PUBLISHED"),) * 6 + ((4, "PUBLISHED"),) * 4)
    provider(base, "pricey", "Pricey Cleaning", area="Sydney", services=(("Clean", 400, FLAT, ""),))

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    # Both are below the $145 median, so the better rated one comes first, though it charges more.
    assert names({"items": items}) == ["Value Cleaning", "Bargain Cleaning"]
    assert [item["price_comparison"]["position"] for item in items] == ["below", "below"]


def test_a_price_above_the_median_ranks_a_provider_lower(base):
    for index, price in enumerate((100, 150, 200)):
        provider(base, f"peer-{index}", f"Peer {index}", area="Sydney", services=(("Clean", price, FLAT, ""),))
    provider(base, "dear", "Dear Cleaning", area="Newtown", services=(("Clean", 300, FLAT, ""),))
    provider(base, "fair", "Fair Cleaning", area="Newtown", services=(("Clean", 150, FLAT, ""),))

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    assert names({"items": items}) == ["Fair Cleaning", "Dear Cleaning"]
    assert [item["reasons"][2] for item in items] == [
        "$150 fixed, at the $150 median for cleaning", "$300 fixed, above the $150 median for cleaning",
    ]
    assert items[0]["score"] > items[1]["score"]


def test_too_few_prices_say_nothing_about_price(base):
    provider(base, "one", "One Cleaning", area="Newtown", services=(("Clean", 120, FLAT, ""),))
    provider(base, "two", "Two Cleaning", area="Newtown", services=(("Clean", 200, "from", ""),),
             reviews=((4, "PUBLISHED"),))

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    assert [item["price_comparison"] for item in items] == [None, None]
    assert [item["reasons"] for item in items] == [["Serves Newtown", "4.0 from 1 review"], ["Serves Newtown", "No reviews yet"]]


def test_the_verified_badge_breaks_a_tie_and_nothing_more(base):
    provider(base, "plain", "A Plain Cleaning", area="Newtown")
    provider(base, "verified", "B Verified Cleaning", area="Newtown", verified=True)
    provider(base, "rated", "C Rated Cleaning", area="Newtown", reviews=((5, "PUBLISHED"),) * 3)

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")])

    # The same score: the verified one first, ahead of the name order. A better score still wins.
    assert names({"items": items}) == ["C Rated Cleaning", "B Verified Cleaning", "A Plain Cleaning"]
    assert items[1]["score"] == items[2]["score"]
    assert items[1]["reasons"][-1] == "Verified by TenantVoice"
    assert "Verified by TenantVoice" not in items[2]["reasons"]


def test_each_suggestion_states_the_facts_behind_it(client, world, as_profile):
    as_owner(as_profile, world)

    found = by_name(ask(client, property_id=NEWTOWN, category="cleaner"))

    assert found["Sparkle Cleaning"] == {
        "id": uid("sparkle"),
        "slug": "sparkle",
        "display_name": "Sparkle Cleaning",
        "category": "cleaner",
        "category_name": "Cleaning Provider",
        "location": "Marrickville",
        "state": "NSW",
        "verified": True,
        "rating_avg": 4.75,
        "review_count": 4,
        "service": {"id": uid("sparkle-service-0"), "title": "Bond clean", "pricing_type": FLAT, "price": 120.0},
        "price_comparison": {"median": 150.0, "position": "below", "compared": 6},
        "match": "suburb",
        "score": 93,
        "reasons": ["Serves Newtown", "4.8 from 4 reviews", "$120 fixed, below the $150 median for cleaning",
                    "Verified by TenantVoice"],
    }
    assert found["Local Cleaners"]["reasons"] == [
        "Based in Newtown", "No reviews yet", "$150 fixed, at the $150 median for cleaning",
    ]
    assert found["Statewide Cleaning"]["reasons"] == [
        "Serves NSW", "4.0 from 2 reviews", "$200 fixed, above the $150 median for cleaning",
    ]


def test_suspended_unpublished_deleted_or_unbookable_providers_never_appear(client, world, as_profile):
    as_owner(as_profile, world)

    for query in ({"property_id": NEWTOWN}, {}, {"category": "cleaner"}):
        shown = set(names(ask(client, **query)))
        assert not shown & {"Suspended Cleaning", "Deactivated Cleaning", "Deleted Cleaning", "Draft Cleaning",
                            "Unbookable Cleaning"}, query


def test_the_caller_and_the_excluded_are_never_suggested(base):
    me = provider(base, "me", "My Own Cleaning", area="Newtown")
    provider(base, "them", "Their Cleaning", area="Newtown")

    items = ranking.rank_providers([ranking.Place("Newtown", "2042", "NSW")], exclude={me})

    assert names({"items": items}) == ["Their Cleaning"]


def test_without_a_place_providers_are_ranked_on_rating_and_price(base):
    provider(base, "far", "Far Cleaning", based=("Perth", "WA", "6000"), reviews=((5, "PUBLISHED"),) * 4)
    provider(base, "near", "Near Cleaning", based=("Newtown", "NSW", "2042"))

    items = ranking.rank_providers([])

    assert [(item["display_name"], item["match"]) for item in items] == [("Far Cleaning", None), ("Near Cleaning", None)]
    assert items[0]["reasons"] == ["5.0 from 4 reviews"]


# ---------------------------------------------------------------------------
# Categories and the limit
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("category", ["cleaner", "cleaning-provider"])
def test_a_category_narrows_the_list_by_its_code_or_slug(client, world, as_profile, category):
    as_owner(as_profile, world)

    body = ask(client, property_id=NEWTOWN, category=category)

    assert {item["category"] for item in body["items"]} == {"cleaner"}
    assert body["category"] == {"code": "cleaner", "slug": "cleaning-provider", "name": "Cleaning Provider"}


def test_every_category_is_ranked_together_without_one(client, world, as_profile):
    as_owner(as_profile, world)

    body = ask(client, property_id=NEWTOWN)

    assert names(body) == ["Sparkle Cleaning", "Local Cleaners", "Postcode Cleaners", "Newtown Trades", "Statewide Cleaning"]
    # The only tradie: no median to compare its price with.
    assert by_name(body)["Newtown Trades"]["price_comparison"] is None
    assert body["category"] is None


def test_an_unknown_category_is_refused(client, world, as_profile):
    as_owner(as_profile, world)

    response = client.get(URL, params={"category": "plumbing"})

    assert (response.status_code, response.json()["detail"]) == (422, "Choose a category from the list.")
    with pytest.raises(ValueError):
        ranking.rank_providers([], "plumbing")


def test_the_limit_caps_the_list_after_ranking(client, world, as_profile):
    as_owner(as_profile, world)

    assert names(ask(client, property_id=NEWTOWN, limit=2)) == ["Sparkle Cleaning", "Local Cleaners"]
    assert client.get(URL, params={"limit": 0}).status_code == 422
    assert client.get(URL, params={"limit": 25}).status_code == 422


# ---------------------------------------------------------------------------
# Whose places
# ---------------------------------------------------------------------------
def test_an_owner_gets_suggestions_for_one_of_their_properties(client, world, as_profile):
    as_owner(as_profile, world)

    context = ask(client, property_id=NEWTOWN)["context"]

    assert context == {
        "kind": "property", "property_id": NEWTOWN, "property_title": "King St terrace",
        "places": ["Newtown, NSW 2042"], "suburb": "Newtown",
    }


@pytest.mark.parametrize("property_id", [BONDI, SOLD, "not-a-uuid", uid("nowhere")])
def test_another_owners_or_a_removed_property_is_not_found(client, world, as_profile, property_id):
    as_owner(as_profile, world)

    response = client.get(URL, params={"property_id": property_id})

    assert response.status_code == 404
    assert "items" not in response.json()


def test_a_manager_gets_suggestions_for_the_property_they_manage_only(client, world, as_profile):
    as_owner(as_profile, world, AGENT)

    assert ask(client, property_id=NEWTOWN)["context"]["places"] == ["Newtown, NSW 2042"]
    assert client.get(URL, params={"property_id": PADDINGTON}).status_code == 404
    assert ask(client)["context"]["places"] == ["Newtown, NSW 2042"]


def test_without_a_property_an_owner_gets_all_their_current_properties(client, world, as_profile):
    as_owner(as_profile, world)

    body = ask(client, category="cleaner")

    # The archived Perth cottage is no longer theirs to look after, so Perth's cleaner is not suggested.
    assert body["context"]["kind"] == "properties"
    assert sorted(body["context"]["places"]) == ["Newtown, NSW 2042", "Paddington, NSW 2021"]
    assert body["context"]["suburb"] is None
    assert names(body) == ["Sparkle Cleaning", "Local Cleaners", "Postcode Cleaners", "Statewide Cleaning"]


def test_an_owner_without_properties_falls_back_to_their_own_area_then_to_none(client, world, as_profile):
    as_owner(as_profile, world, OTHER_OWNER)
    world.tables["listings"][:] = [row for row in world.tables["listings"] if row["id"] != BONDI]

    assert ask(client)["context"] == {
        "kind": "profile", "property_id": None, "property_title": None, "places": ["Bondi, NSW"], "suburb": "Bondi",
    }

    users(world)[OTHER_OWNER]["metadata"] = {}
    as_owner(as_profile, world, OTHER_OWNER)
    body = ask(client, category="cleaner")

    assert (body["context"]["kind"], body["context"]["places"]) == ("none", [])
    assert {item["match"] for item in body["items"]} == {None}
    assert "Far Cleaning" in names(body)


def test_a_tenant_gets_suggestions_for_their_own_and_preferred_areas(client, world, as_profile):
    signed_in(as_profile, users(world)[TENANT])

    body = ask(client, category="cleaner")

    assert body["context"] == {
        "kind": "profile", "property_id": None, "property_title": None,
        "places": ["Glebe, NSW 2037", "Newtown, NSW"], "suburb": "Glebe",
    }
    assert [(item["display_name"], item["reasons"][0]) for item in body["items"]] == [
        ("Sparkle Cleaning", "Serves Newtown"),
        ("Local Cleaners", "Based in Newtown"),
        # Both only share the state: the one at the median price and without poor reviews first.
        ("Postcode Cleaners", "Based in NSW"),
        ("Statewide Cleaning", "Serves NSW"),
    ]


@pytest.mark.parametrize("preferred, places, geelong", [
    (["Newtown"], ["Glebe, NSW 2037", "Newtown, NSW"], None),
    (["Newtown", "NSW"], ["Glebe, NSW 2037", "Newtown, NSW"], None),
    (["Newtown", "New South Wales"], ["Glebe, NSW 2037", "Newtown, NSW"], None),
    # Suburbs in two states, as the settings save "Newtown, NSW, Footscray, VIC".
    (["Newtown", "NSW", "Footscray", "VIC"], ["Glebe, NSW 2037", "Newtown, NSW", "Footscray, VIC"], "Based in VIC"),
])
def test_a_preferred_suburb_saved_on_its_own_is_in_the_tenants_state(client, world, as_profile, preferred, places, geelong):
    # As the web saves them: the settings split "Newtown, NSW" at its comma, onboarding adds a suburb at a time.
    world.table("tenant_profiles").update({"preferred_locations": preferred}).eq("user_id", TENANT).execute()
    signed_in(as_profile, users(world)[TENANT])

    body = ask(client, category="cleaner")

    assert body["context"]["places"] == places
    # Geelong's "Newtown" is in Victoria, and Tia means the one in NSW: Geelong Cleaning fits only a
    # Victorian place she named, by its state.
    shown = by_name(body).get("Geelong Cleaning")
    assert (shown["reasons"][0] if shown else None) == geelong
    assert by_name(body)["Sparkle Cleaning"]["reasons"][0] == "Serves Newtown"


@pytest.mark.parametrize("preferred, own, places", [
    # The first state saved after a suburb is its state, not a place of its own.
    (["Newtown", "Glebe", "VIC"], None, [ranking.Place("Newtown", None, "VIC"), ranking.Place("Glebe", None, "VIC")]),
    (["Newtown", "NSW", "Footscray", "VIC"], ranking.Place("Glebe", None, "NSW"),
     [ranking.Place("Newtown", None, "NSW"), ranking.Place("Footscray", None, "VIC")]),
    # A postcode saved with its state gives the state too, and is still a place.
    (["Newtown", "NSW 2042"], ranking.Place("Footscray", None, "VIC"),
     [ranking.Place("Newtown", None, "NSW"), ranking.Place(None, "2042", "NSW")]),
    # Without one after them, they are in the tenant's own state.
    (["Newtown", "2042"], ranking.Place("Glebe", "2037", "NSW"),
     [ranking.Place("Newtown", None, "NSW"), ranking.Place(None, "2042", "NSW")]),
    (["Footscray", "VIC", "Newtown"], ranking.Place("Glebe", None, "NSW"),
     [ranking.Place("Footscray", None, "VIC"), ranking.Place("Newtown", None, "NSW")]),
    # A state no suburb takes is a place of its own: anywhere in it.
    (["NSW"], ranking.Place("Glebe", None, "NSW"), [ranking.Place(None, None, "NSW")]),
    (["Newtown", "NSW", "VIC"], ranking.Place("Glebe", None, "NSW"),
     [ranking.Place("Newtown", None, "NSW"), ranking.Place(None, None, "VIC")]),
    # Nothing to tell the state by.
    (["Newtown"], None, [ranking.Place("Newtown")]),
    (["Newtown, VIC 3220"], ranking.Place("Glebe", None, "NSW"), [ranking.Place("Newtown", "3220", "VIC")]),
])
def test_preferred_suburbs_take_the_state_saved_after_them_or_the_tenants(preferred, own, places):
    assert ranking.preferred_places(preferred, own) == places


@pytest.mark.parametrize("text, place", [
    ("Newtown, NSW 2042", ranking.Place("Newtown", "2042", "NSW")),
    ("2042", ranking.Place(None, "2042", None)),
    ("New South Wales", ranking.Place(None, None, "NSW")),
    ("Victoria Park", ranking.Place("Victoria Park", None, None)),
    ("  ", None),
])
def test_a_typed_place_reads_as_its_suburb_postcode_and_state(text, place):
    assert ranking.place_from_text(text) == place


def test_a_tenant_names_no_property(client, world, as_profile):
    signed_in(as_profile, users(world)[TENANT])

    response = client.get(URL, params={"property_id": NEWTOWN})

    assert (response.status_code, response.json()["detail"]) == (400, "Only an owner can choose one of their properties.")


# ---------------------------------------------------------------------------
# Access and privacy
# ---------------------------------------------------------------------------
def test_signed_out_callers_get_401(client, world):
    assert client.get(URL).status_code == 401


@pytest.mark.parametrize("primary_role, allowed", [
    ("TENANT", True), ("LANDLORD", True), ("AGENT", True),
    ("SERVICE_PROVIDER", False), ("ADMIN", False), ("REGULATOR", False),
])
def test_only_owners_and_tenants_may_ask(client, world, primary_role, allowed):
    caller = uid(f"caller-{primary_role}")
    token = account(world, caller, f"{primary_role.lower()}@example.test", primary_role,
                    metadata={"location": "Newtown", "state": "NSW"})

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == (200 if allowed else 403), response.text
    if allowed:
        assert "Sparkle Cleaning" in names(response.json())


def test_no_contact_detail_or_street_address_reaches_the_response(client, world, as_profile):
    as_owner(as_profile, world)

    text = client.get(URL, params={"property_id": NEWTOWN}).text

    for private in ("@example.test", "0400 111 222", "Private Lane", REVIEWER, "Sparkle Cleaning Owner"):
        assert private not in text
