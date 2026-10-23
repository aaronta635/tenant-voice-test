"""Work opportunities for a provider (tracker assumption #19) on the strict shared schema.

Owners and landlords whose public area, or whose listings, are in an area
the provider serves (their own suburb, or a live service's service area)
are ranked by that match, then by their rating, verification and number of
listings. Each comes with the facts that place them. Only what a public
profile or listing shows is used: never repairs, tenants or contact details,
and never a member who hid their profile, declined the provider or is not
an active owner.
"""

import pytest

from app.services import provider_recommendations as service
from tests.factories_messaging import connection
from tests.factories_provider_core import provider_profile, review_row
from tests.factories_recommendations import member, offering, signed_in, uid
from tests.factories_reviews_complaints import complaint, listing, property_row, work_order

pytestmark = pytest.mark.usefixtures("strict_schema")

URL = "/api/v1/me/recommendations/provider/opportunities"
ME = uid("me")
LISTER, BASED, AGENT, VICTORIA, STATEWIDE, BONDI = (uid(name) for name in (
    "lister", "based", "agent", "victoria", "statewide", "bondi"))
FAR, HIDDEN, DECLINED, TENANT, SUSPENDED, DRAFTS, REVIEWER = (uid(name) for name in (
    "far", "hidden", "declined", "tenant", "suspended", "drafts", "reviewer"))


def _listings(db, owner_id: str, name: str, suburbs: list[str], state: str = "NSW", status: str = "PUBLISHED"):
    for index, suburb in enumerate(suburbs):
        prop, item = uid(f"{name}-property-{index}"), uid(f"{name}-listing-{index}")
        db.seed("properties", [property_row(prop, owner_id, suburb=suburb, state=state,
                                            address_line_1=f"{index + 1} Private Street")])
        db.seed("listings", [listing(item, prop, owner_id, title=f"{name} home {index}", status=status)])


@pytest.fixture
def market(fake_db, as_profile):
    me = member(ME, "service_provider", "Nina New", "Newtown", "NSW", email="nina@example.test")
    fake_db.seed("users", [
        me,
        member(LISTER, "landlord", "Ava Lister", "Parramatta", "NSW", email="ava@example.test", phone="0400111222"),
        member(BASED, "landlord", "Ben Based", "Newtown", "NSW", verification_status="APPROVED"),
        member(AGENT, "agent", "Cara Agent", "Marrickville", "NSW"),
        member(VICTORIA, "landlord", "Dan Victoria", "Geelong", "VIC"),
        member(STATEWIDE, "landlord", "Eve Statewide", "Wollongong", "NSW"),
        member(BONDI, "landlord", "Lou Bondi", "Bondi", "NSW"),
        member(FAR, "landlord", "Far Away", "Perth", "WA"),
        member(HIDDEN, "landlord", "Hidden Owner", "Newtown", "NSW", metadata={"privacy": {"public_profile": False}}),
        member(DECLINED, "landlord", "Declined Owner", "Newtown", "NSW"),
        member(TENANT, "tenant", "Tina Tenant", "Newtown", "NSW"),
        member(SUSPENDED, "landlord", "Sid Suspended", "Newtown", "NSW", status="SUSPENDED"),
        member(DRAFTS, "landlord", "Dora Drafts", "Perth", "WA"),
        member(REVIEWER, "tenant", "Rita Reviewer", "Glebe", "NSW"),
    ])
    fake_db.seed("service_provider_profiles", [provider_profile(ME, category="cleaner", business_name="Nina Cleans")])
    fake_db.seed("mobile_provider_services", [
        offering(uid("bond"), ME, "Bond clean", "Glebe, Marrickville", 1),
        offering(uid("windows"), ME, "Window clean", "VIC", 2),
        offering(uid("draft"), ME, "Carpet clean", "Bondi", 3, live=False),
    ])
    _listings(fake_db, LISTER, "ava", ["Glebe", "Glebe", "Parramatta"])
    _listings(fake_db, DRAFTS, "dora", ["Glebe"], status="DRAFT")
    _listings(fake_db, FAR, "far", ["Perth"], state="WA")
    fake_db.seed("reviews", [
        review_row(uid("review-1"), BASED, REVIEWER, 5), review_row(uid("review-2"), BASED, REVIEWER, 5),
        review_row(uid("review-3"), BASED, REVIEWER, 4), review_row(uid("review-4"), AGENT, REVIEWER, 3),
        review_row(uid("review-5"), AGENT, REVIEWER, 1, status="HIDDEN"),
    ])
    fake_db.seed("connection_requests", [connection(DECLINED, ME, "DECLINED")])
    # A repair of Ben's: private between him and his tenant, so it must never be read here.
    fake_db.seed("complaints", [complaint(uid("repair"), REVIEWER, description="Secret leak under the sink",
                                          against_user_id=BASED, metadata={"access_notes": "Gate code 4321"})])
    fake_db.seed("maintenance_work_orders", [work_order(uid("order"), uid("repair"), REVIEWER, landlord_user_id=BASED)])
    signed_in(as_profile, me)
    return fake_db


def _items(client, **query):
    response = client.get(URL, params=query)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_owners_are_ranked_by_area_match_then_standing(client, market):
    items = _items(client)

    assert [(item["display_name"], item["match"]) for item in items] == [
        ("Ava Lister", "listing_in_area"),
        ("Ben Based", "based_in_area"),
        ("Cara Agent", "based_in_area"),
        ("Dan Victoria", "state_in_area"),
        ("Eve Statewide", "same_state"),
        ("Lou Bondi", "same_state"),
    ]


def test_within_a_match_the_rating_comes_first_then_verification_then_listings(client, fake_db, as_profile):
    me = member(ME, "service_provider", "Nina New", "Newtown", "NSW")
    rated, verified, portfolio, plain = (uid(name) for name in ("rated", "verified", "portfolio", "plain"))
    fake_db.seed("users", [
        me,
        member(rated, "landlord", "Zed Rated", "Newtown", "NSW"),
        member(verified, "landlord", "Yan Verified", "Newtown", "NSW", verification_status="APPROVED"),
        member(portfolio, "landlord", "Xia Portfolio", "Newtown", "NSW"),
        member(plain, "landlord", "Abe Plain", "Newtown", "NSW"),
        member(REVIEWER, "tenant", "Rita Reviewer", "Glebe", "NSW"),
    ])
    fake_db.seed("service_provider_profiles", [provider_profile(ME, category="cleaner")])
    # Two reviews of 5: counted as two fifths of full marks, still ahead of no rating at all.
    fake_db.seed("reviews", [review_row(uid("r1"), rated, REVIEWER, 5), review_row(uid("r2"), rated, REVIEWER, 5)])
    _listings(fake_db, portfolio, "xia", ["Perth"] * 3, state="WA")
    signed_in(as_profile, me)

    names = [item["display_name"] for item in _items(client)]

    assert names == ["Zed Rated", "Yan Verified", "Xia Portfolio", "Abe Plain"]


def test_each_owner_comes_with_the_facts_that_place_them(client, market):
    by_name = {item["display_name"]: item for item in _items(client)}

    assert by_name["Ava Lister"]["reasons"] == [
        "2 listings on TenantVoice in Glebe, an area your “Bond clean” service covers.",
        "3 listings on TenantVoice in all.",
    ]
    assert by_name["Ben Based"]["reasons"] == [
        "Based in Newtown, where you are based.",
        "Rated 4.7 out of 5 from 3 reviews.",
        "Verified by TenantVoice.",
    ]
    # A hidden review is no review.
    assert by_name["Cara Agent"]["reasons"] == [
        "Based in Marrickville, an area your “Bond clean” service covers.",
        "Rated 3.0 out of 5 from 1 review.",
    ]
    assert by_name["Dan Victoria"]["reasons"] == ["Based in VIC, which your “Window clean” service covers."]
    assert by_name["Eve Statewide"]["reasons"] == ["Based in NSW, the state you work in."]
    assert (by_name["Cara Agent"]["role_label"], by_name["Ben Based"]["role_label"]) == ("Agent", "Landlord")
    assert (by_name["Ben Based"]["rating_avg"], by_name["Ben Based"]["review_count"], by_name["Ben Based"]["verified"]) == (
        4.67, 3, True,
    )
    assert (by_name["Ava Lister"]["listing_count"], by_name["Ava Lister"]["location"]) == (3, "Parramatta")


def test_an_inactive_service_area_does_not_count(client, market):
    lou = next(item for item in _items(client) if item["display_name"] == "Lou Bondi")

    assert lou["match"] == "same_state"


def test_nobody_outside_the_areas_hidden_declined_or_not_an_owner_appears(client, market):
    names = {item["display_name"] for item in _items(client)}

    assert not names & {"Far Away", "Hidden Owner", "Declined Owner", "Tina Tenant", "Sid Suspended", "Dora Drafts"}


def test_no_contact_repair_or_tenant_detail_reaches_the_response(client, market):
    body = client.get(URL).text

    for private in ("ava@example.test", "0400111222", "Private Street", "Secret leak", "Gate code", "Rita", "nina@example.test"):
        assert private not in body
    assert set(_items(client)[0]) == {
        "id", "display_name", "role_label", "location", "state", "verified", "rating_avg", "review_count",
        "listing_count", "match", "reasons",
    }


def test_the_response_names_the_areas_it_used(client, market):
    assert client.get(URL).json()["areas"] == ["Newtown", "Glebe", "Marrickville", "VIC"]


def test_the_limit_caps_the_list_after_ranking(client, market):
    assert [item["display_name"] for item in _items(client, limit=2)] == ["Ava Lister", "Ben Based"]
    assert client.get(URL, params={"limit": 0}).status_code == 422
    assert client.get(URL, params={"limit": 25}).status_code == 422


def test_a_provider_without_any_area_gets_an_empty_list(client, fake_db, as_profile):
    me = member(ME, "service_provider", "Nina New")
    fake_db.seed("users", [me, member(BASED, "landlord", "Ben Based", "Newtown", "NSW")])
    fake_db.seed("service_provider_profiles", [provider_profile(ME, category="cleaner")])
    signed_in(as_profile, me)

    assert client.get(URL).json()["items"] == [] and client.get(URL).json()["areas"] == []


def test_the_profile_service_area_counts_too(client, fake_db, as_profile):
    me = member(ME, "service_provider", "Nina New")
    fake_db.seed("users", [me, member(BASED, "landlord", "Ben Based", "Surry Hills", "NSW")])
    fake_db.seed("service_provider_profiles", [{**provider_profile(ME, category="cleaner"), "service_area": "Surry Hills"}])
    signed_in(as_profile, me)

    [item] = _items(client)
    assert (item["display_name"], item["reasons"][0]) == (
        "Ben Based", "Based in Surry Hills, an area your profile says you serve.",
    )


def test_each_reason_names_where_the_area_it_matched_comes_from(client, fake_db, as_profile):
    # Nina is based in Newtown; her profile serves Surry Hills and her service Glebe.
    me = member(ME, "service_provider", "Nina New", "Newtown", "NSW")
    fake_db.seed("users", [
        me,
        member(BASED, "landlord", "Ben Based", "Newtown", "NSW"),
        member(LISTER, "landlord", "Ava Lister", "Perth", "WA"),
        member(AGENT, "agent", "Cara Agent", "Glebe", "NSW"),
        member(VICTORIA, "landlord", "Dan Victoria", "Geelong", "VIC"),
    ])
    fake_db.seed("service_provider_profiles", [
        {**provider_profile(ME, category="cleaner"), "service_area": "Surry Hills, VIC"},
    ])
    fake_db.seed("mobile_provider_services", [offering(uid("bond"), ME, "Bond clean", "Glebe", 1)])
    _listings(fake_db, LISTER, "ava", ["Surry Hills"])
    signed_in(as_profile, me)

    reasons = {item["display_name"]: item["reasons"][0] for item in _items(client)}

    assert reasons == {
        "Ben Based": "Based in Newtown, where you are based.",
        "Ava Lister": "1 listing on TenantVoice in Surry Hills, an area your profile says you serve.",
        "Cara Agent": "Based in Glebe, an area your “Bond clean” service covers.",
        "Dan Victoria": "Based in VIC, which your profile says you serve.",
    }


def _home(db, owner_id: str, property_id: str, listing_id: str, suburb: str, state: str = "NSW"):
    db.seed("properties", [property_row(property_id, owner_id, suburb=suburb, state=state)])
    db.seed("listings", [listing(listing_id, property_id, owner_id, title=f"{suburb} home")])


def test_a_cap_drops_the_weakest_matches_never_a_local_one(client, fake_db, as_profile, monkeypatch):
    monkeypatch.setattr(service, "AREA_OWNER_LIMIT", 5)
    monkeypatch.setattr(service, "LISTING_SCAN_LIMIT", 2)
    me = member(ME, "service_provider", "Nina New", "Newtown", "NSW")
    # Six owners who only share Nina's state, with ids before Lucy's and Lena's.
    statewide = [f"00000000-0000-4000-8000-00000000000{index}" for index in range(6)]
    lucy, lena = "ffffffff-0000-4000-8000-000000000001", "ffffffff-0000-4000-8000-000000000002"
    fake_db.seed("users", [
        me,
        member(lucy, "landlord", "Lucy Local", "Newtown", "NSW"),
        member(lena, "landlord", "Lena Lister", "Perth", "WA"),
        *(member(owner, "landlord", f"State Owner {index}", "Wollongong", "NSW") for index, owner in enumerate(statewide)),
    ])
    fake_db.seed("service_provider_profiles", [provider_profile(ME, category="cleaner")])
    # Listings elsewhere in the state come first by id; Lena's is the one in Newtown.
    for index, owner in enumerate(statewide[:3]):
        _home(fake_db, owner, f"10000000-0000-4000-8000-00000000000{index}",
              f"20000000-0000-4000-8000-00000000000{index}", "Wollongong")
    _home(fake_db, lena, "f0000000-0000-4000-8000-000000000001", "f1000000-0000-4000-8000-000000000001", "Newtown")
    signed_in(as_profile, me)

    items = _items(client)

    assert [(item["display_name"], item["match"]) for item in items[:2]] == [
        ("Lena Lister", "listing_in_area"), ("Lucy Local", "based_in_area"),
    ]
    assert {item["match"] for item in items[2:]} == {"same_state"}


def test_a_suburb_written_with_punctuation_still_matches(client, fake_db, as_profile):
    # No state of Nina's to find Ben by: only his suburb can.
    me = member(ME, "service_provider", "Nina New", "O'Connor")
    fake_db.seed("users", [
        me, member(BASED, "landlord", "Ben Based", "O'Connor", "ACT"), member(LISTER, "landlord", "Ava Lister", "Perth", "WA"),
    ])
    fake_db.seed("service_provider_profiles", [provider_profile(ME, category="cleaner")])
    fake_db.seed("mobile_provider_services", [offering(uid("bond"), ME, "Bond clean", "St Ives", 1)])
    _listings(fake_db, LISTER, "ava", ["St. Ives", "Perth"], state="NSW")
    signed_in(as_profile, me)

    reasons = {item["display_name"]: item["reasons"] for item in _items(client)}

    assert reasons == {
        "Ben Based": ["Based in O'Connor, where you are based."],
        "Ava Lister": ["1 listing on TenantVoice in St. Ives, an area your “Bond clean” service covers.",
                       "2 listings on TenantVoice in all."],
    }


@pytest.mark.parametrize("role", ["tenant", "landlord", "admin"])
def test_only_providers_get_work_opportunities(client, as_profile, role):
    as_profile(id=TENANT, role=role)

    assert client.get(URL).status_code == 403


def test_signed_out_callers_are_refused(client):
    assert client.get(URL).status_code == 401


def test_a_provider_needs_their_own_business_profile(client, fake_db, as_profile):
    me = member(ME, "service_provider", "Nina New", "Newtown", "NSW")
    fake_db.seed("users", [me])
    signed_in(as_profile, me)

    assert client.get(URL).status_code == 404


def test_the_ranking_reads_neither_repairs_nor_tenant_profiles(market, monkeypatch, client):
    from tests.fake_supabase import FakeTableQuery

    read = []
    execute = FakeTableQuery.execute

    def recording(query):
        read.append(query._name)
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", recording)
    _items(client)

    assert not set(read) & {"maintenance_work_orders", "complaints", "tenant_profiles", "rental_applications"}


def test_area_matching_is_whole_words_not_substrings(client, fake_db, as_profile):
    me = member(ME, "service_provider", "Nina New", "Newtown", "NSW")
    fake_db.seed("users", [me, member(BASED, "landlord", "Ben Based", "Newtown West", "TAS")])
    fake_db.seed("service_provider_profiles", [provider_profile(ME, category="cleaner")])
    signed_in(as_profile, me)

    assert _items(client) == []


def test_ranking_helpers_never_place_an_owner_without_a_shared_area():
    places, states, _labels = service._service_areas(
        type("Current", (), {"raw": {"location": "Newtown"}})(), [], None,
    )
    row = {"id": BASED, "full_name": "Ben", "primary_role": "LANDLORD", "location": "Perth", "state": "WA"}

    assert service._opportunity(row, [], {}, places, states, "NSW") is None
