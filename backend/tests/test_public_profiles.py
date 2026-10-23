"""Public profiles (R22): browsing tenants, landlords and providers before sign-in.

Every test runs on the strict fake, so a wrong table, column or enum value
fails as it would on the shared database.
"""

import logging
from types import SimpleNamespace

import pytest

from app.services import badges, public_profiles
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")


@pytest.fixture(autouse=True)
def fresh_scans(monkeypatch):
    """Each search reads the fake again, unless a test turns the scan cache on."""
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)

NOW = "2026-01-01T00:00:00+00:00"
URL = "/api/v1/public/profiles"

TENANT = "a1000000-0000-4000-8000-000000000001"
LANDLORD = "a2000000-0000-4000-8000-000000000001"
AGENT = "a3000000-0000-4000-8000-000000000001"
PROVIDER = "a4000000-0000-4000-8000-000000000001"
VIEWER = "a5000000-0000-4000-8000-000000000001"
REVIEWER = "a6000000-0000-4000-8000-000000000001"

PUBLIC_FIELDS = {
    "id", "role", "role_label", "display_name", "business_name", "avatar_url", "areas", "about", "verified",
    "rating_avg", "review_count", "budget_min", "budget_max", "move_in_month", "categories", "pricing_summary",
    "service_area", "provider_slug",
}
REVIEW_FIELDS = {"id", "rating", "title", "body", "reviewer_label", "reply", "replied_at", "created_at", "reported"}


def member(id, role, full_name, metadata=None, **columns) -> dict:
    """A users row with private columns filled in, so a leak would show."""
    return {
        "id": id,
        "email": f"{id}@private.example",
        "full_name": full_name,
        "phone": "0400 123 456",
        "primary_role": role,
        "metadata": metadata if metadata is not None else {},
        "updated_at": NOW,
        **columns,
    }


def provider_profile(user_id, published=True, **columns) -> dict:
    metadata = columns.pop("metadata", {})
    return {"user_id": user_id, "metadata": {"is_published": published, **metadata}, "updated_at": NOW, **columns}


def review(id, about, rating, *, by=REVIEWER, created_at=NOW, **columns) -> dict:
    return {
        "id": id,
        "reviewed_user_id": about,
        "reviewer_user_id": by,
        "rating": rating,
        "landlord_rating": rating,
        "created_at": created_at,
        "updated_at": NOW,
        **columns,
    }


def uid(prefix: str, number: int) -> str:
    """A uuid per test group: prefix is two hex digits."""
    return f"{prefix}{number:06d}-0000-4000-8000-000000000000"


def ids(client, **params) -> list[str]:
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def by_id(client, **params) -> dict[str, dict]:
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return {item["id"]: item for item in response.json()["items"]}


def seed_private_tenant(db):
    """A tenant whose row holds every kind of private value the API must never send."""
    db.seed("users", [
        member(TENANT, "TENANT", "Zara Quinlan-Moss", {
            "location": "Marrickville", "state": "NSW", "postcode": "2204",
            "address": "12 Hidden Lane", "emergency_contact": {"name": "Ines Contact", "phone": "0411 222 333"},
            "employer": "Acme Widgets", "annual_income": 98765, "date_of_birth": "1990-02-03", "gender": "female",
            "privacy": {"public_profile": True},
        }, email="zara.quinlan@private.example", phone="0499 888 777", avatar_url="https://cdn.example/zara.png",
            verification_status="APPROVED"),
        member(REVIEWER, "LANDLORD", "Rhea Reviewer"),
    ])
    db.seed("tenant_profiles", [{
        "user_id": TENANT, "updated_at": NOW,
        # Past the one line that is shown: the rest of an about stays private.
        "about_me": "Quiet nurse who keeps a tidy home and loves a calm street.\n\nHappy to sign a long lease, and I "
                    "always leave a place better than I found it. Previous landlord: 7 Former Street, call 0422 444 555.",
        "budget_min": 500, "budget_max": 800, "preferred_locations": ["Newtown", "Glebe"],
        "move_in_date": "2026-11-21", "household_size": 3, "has_pets": True,
        "metadata": {"references": [{"name": "Olga Oldlandlord", "phone": "0433 666 777"}]},
    }])
    db.seed("reviews", [review(
        "b1000000-0000-4000-8000-000000000001", TENANT, 5, title="Great tenant", body="Paid on time, left it spotless.",
        is_verified_interaction=True, media_urls=["https://private.example/inspection-photo.jpg"],
        property_id=None,
    )])


SECRETS = [
    "zara.quinlan@private.example", "0499 888 777", "Quinlan", "12 Hidden Lane", "Ines Contact", "0411 222 333",
    "Acme Widgets", "98765", "1990-02-03", "female", "2204", "Marrickville", "Former Street", "0422 444 555",
    "Olga Oldlandlord", "0433 666 777", "2026-11-21", "inspection-photo",
    '"email"', '"phone"', '"metadata"', '"household_size"', '"has_pets"', '"full_name"', '"media_urls"',
]
# The reviewer has a public card of their own, but a review never leads to it.
REVIEWER_SECRETS = [REVIEWER, "Rhea", "reviewer_user_id"]


def test_signed_out_and_signed_in_callers_get_only_the_public_fields(client, strict_schema):
    seed_private_tenant(strict_schema)
    token = strict_schema.add_auth_user("viewer@example.test", full_name="Vic Viewer", role="landlord")
    strict_schema.seed("users", [member(VIEWER, "LANDLORD", "Vic Viewer", auth_user_id=strict_schema.tokens[token])])

    for headers in ({}, {"Authorization": f"Bearer {token}"}, {"Authorization": "Bearer expired-token"}):
        listing = client.get(URL, headers=headers)
        detail = client.get(f"{URL}/{TENANT}", headers=headers)
        assert (listing.status_code, detail.status_code) == (200, 200), (listing.text, detail.text)

        [card] = [item for item in listing.json()["items"] if item["id"] == TENANT]
        assert set(card) == PUBLIC_FIELDS
        assert set(detail.json()) == PUBLIC_FIELDS | {"reviews", "scorecard"}
        assert [set(item) for item in detail.json()["reviews"]] == [REVIEW_FIELDS]
        for secret in SECRETS:
            assert secret not in listing.text
            assert secret not in detail.text
        for secret in REVIEWER_SECRETS:
            assert secret not in detail.text
        # No owner scorecard to show (R43, tests/test_scorecards.py).
        assert detail.json() == {**card, "reviews": detail.json()["reviews"], "scorecard": None}
        assert detail.json()["reviews"][0]["reviewer_label"] == "Verified landlord"

    assert card == {
        "id": TENANT, "role": "tenant", "role_label": "Tenant", "display_name": "Zara Q.", "business_name": None,
        "avatar_url": "https://cdn.example/zara.png", "areas": ["Newtown", "Glebe"],
        "about": "Quiet nurse who keeps a tidy home and loves a calm street. Happy to sign a long lease, and I always "
                 "leave a place better than I found it…",
        "verified": True,
        "rating_avg": 5.0, "review_count": 1, "budget_min": 500.0, "budget_max": 800.0, "move_in_month": "2026-11",
        "categories": [], "pricing_summary": None, "service_area": None, "provider_slug": None,
    }


def test_the_about_line_is_cut_before_anything_private_it_goes_on_to(client, strict_schema):
    long_about = "Friendly renter. " + "I love quiet streets and good coffee. " * 6 + "Bank: 062-000 12345678"
    strict_schema.seed("users", [member(TENANT, "TENANT", "Jane Doe")])
    strict_schema.seed("tenant_profiles", [{"user_id": TENANT, "about_me": long_about, "updated_at": NOW}])

    about = by_id(client)[TENANT]["about"]

    assert len(about) <= public_profiles.ABOUT_LENGTH and about.endswith("…")
    assert about.startswith("Friendly renter. I love quiet streets")
    assert "Bank" not in about and "12345678" not in client.get(URL).text


def test_only_active_members_who_have_not_opted_out_are_listed(client, strict_schema):
    shown = {
        uid("c0", 1): member(uid("c0", 1), "TENANT", "Ada Active"),
        uid("c0", 2): member(uid("c0", 2), "TENANT", "Ollie Optin", {"privacy": {"public_profile": True}}),
        LANDLORD: member(LANDLORD, "LANDLORD", "Lena Landlord"),
        AGENT: member(AGENT, "AGENT", "Andy Agent"),
        PROVIDER: member(PROVIDER, "SERVICE_PROVIDER", "Pia Provider"),
    }
    hidden = {
        uid("d0", 1): member(uid("d0", 1), "TENANT", "Sam Suspended", status="SUSPENDED"),
        uid("d0", 2): member(uid("d0", 2), "TENANT", "Dee Deactivated", status="DEACTIVATED"),
        uid("d0", 3): member(uid("d0", 3), "TENANT", "Pat Pending", status="PENDING_VERIFICATION"),
        uid("d0", 4): member(uid("d0", 4), "LANDLORD", "Del Deleted", deleted_at=NOW),
        uid("d0", 5): member(uid("d0", 5), "ADMIN", "Ada Admin"),
        uid("d0", 6): member(uid("d0", 6), "REGULATOR", "Reg Regulator"),
        uid("d0", 7): member(uid("d0", 7), "TENANT", "Otto Optout", {"privacy": {"public_profile": False}}),
        uid("d0", 8): member(uid("d0", 8), "SERVICE_PROVIDER", "Dora Draft"),
        uid("d0", 9): member(uid("d0", 9), "SERVICE_PROVIDER", "Una Unflagged"),
        uid("d0", 10): member(uid("d0", 10), "SERVICE_PROVIDER", "Nora Noprofile"),
    }
    strict_schema.seed("users", [*shown.values(), *hidden.values()])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER),
        provider_profile(uid("d0", 8), published=False),
        # A row without the flag: only a provider that went live is public.
        {"user_id": uid("d0", 9), "metadata": {}, "updated_at": NOW},
    ])

    assert sorted(ids(client)) == sorted(shown)
    assert sorted(ids(client, role="all")) == sorted(shown)
    for user_id in shown:
        assert client.get(f"{URL}/{user_id}").status_code == 200
    unknown = uid("e0", 1)
    for user_id in [*hidden, unknown, "not-a-uuid", "provider-slug"]:
        response = client.get(f"{URL}/{user_id}")
        assert (response.status_code, response.json()) == (404, {"detail": "Profile not found"}), user_id


def test_agents_are_listed_with_landlords_and_labelled_agent(client, strict_schema):
    strict_schema.seed("users", [
        member(LANDLORD, "LANDLORD", "Lena Landlord", {"location": "Parramatta", "state": "NSW"}),
        member(AGENT, "AGENT", "Andy Agent", {"location": "Chatswood"}),
        member(TENANT, "TENANT", "Tia Tenant"),
        member(PROVIDER, "SERVICE_PROVIDER", "Pia Provider"),
    ])
    strict_schema.seed("landlord_profiles", [{"user_id": LANDLORD, "agency_name": "Lena Homes", "updated_at": NOW}])
    strict_schema.seed("agent_profiles", [
        {"user_id": AGENT, "agency_name": "Harbour Realty", "market_area": "North Shore", "updated_at": NOW,
         "metadata": {"bio": "Leasing agent for Sydney's north."}},
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(PROVIDER)])

    landlords = by_id(client, role="landlord")

    assert set(landlords) == {LANDLORD, AGENT}
    assert {key: landlords[AGENT][key] for key in ("role", "role_label", "display_name", "business_name", "areas", "about")} == {
        "role": "landlord", "role_label": "Agent", "display_name": "Andy Agent", "business_name": "Harbour Realty",
        "areas": ["North Shore", "Chatswood"], "about": "Leasing agent for Sydney's north.",
    }
    assert (landlords[LANDLORD]["role_label"], landlords[LANDLORD]["business_name"]) == ("Landlord", "Lena Homes")
    assert ids(client, role="tenant") == [TENANT]
    assert ids(client, role="provider") == [PROVIDER]
    assert client.get(URL, params={"role": "admin"}).status_code == 422


def test_ratings_count_the_reviews_a_profile_lists(client, strict_schema):
    # Published and flagged reviews, as the marketplace counts a provider's:
    # hidden and archived ones are moderators' decisions.
    other_tenant, other_provider = uid("f0", 1), uid("f0", 2)
    strict_schema.seed("users", [
        member(LANDLORD, "LANDLORD", "Lena Landlord"),
        member(TENANT, "TENANT", "Hidden Reviews"),
        member(other_tenant, "TENANT", "Tom Tenant"),
        member(other_provider, "SERVICE_PROVIDER", "Sid Sparky"),
    ])
    strict_schema.seed("reviews", [
        review(uid("b0", 1), LANDLORD, 5, by=other_tenant, is_verified_interaction=True,
               created_at="2026-03-01T00:00:00+00:00", body="Fixed the heater within a day.",
               landlord_reply="Thanks Tom!", landlord_replied_at="2026-03-02T00:00:00+00:00"),
        review(uid("b0", 2), LANDLORD, 4, by=other_provider, created_at="2026-04-01T00:00:00+00:00"),
        review(uid("b0", 3), LANDLORD, 1, by=other_tenant, status="HIDDEN", body="hidden by a moderator"),
        review(uid("b0", 4), LANDLORD, 1, by=other_tenant, status="FLAGGED", body="flagged for review"),
        review(uid("b0", 5), LANDLORD, 1, by=other_tenant, status="ARCHIVED", body="archived"),
        review(uid("b0", 6), TENANT, 2, by=other_provider, status="HIDDEN"),
    ])

    cards = by_id(client)
    detail = client.get(f"{URL}/{LANDLORD}").json()

    assert (cards[LANDLORD]["rating_avg"], cards[LANDLORD]["review_count"]) == (3.33, 3)
    assert (detail["rating_avg"], detail["review_count"]) == (3.33, 3)
    assert (cards[TENANT]["rating_avg"], cards[TENANT]["review_count"]) == (None, 0)
    assert [(item["id"], item["rating"], item["reviewer_label"]) for item in detail["reviews"]] == [
        (uid("b0", 2), 4, "Service provider"),
        (uid("b0", 1), 5, "Verified tenant"),
        (uid("b0", 4), 1, "Tenant"),
    ]
    # A reported review stays up until a moderator decides, marked as reported.
    assert [item["reported"] for item in detail["reviews"]] == [False, False, True]
    assert detail["reviews"][1]["body"] == "Fixed the heater within a day."
    assert detail["reviews"][1]["reply"] == "Thanks Tom!"
    text = client.get(f"{URL}/{LANDLORD}").text
    assert "hidden by a moderator" not in text and "archived" not in text
    assert other_tenant not in text and "Tom Tenant" not in text


def test_the_verified_badge_needs_an_approved_account(client, strict_schema):
    statuses = {uid("a7", 1): "APPROVED", uid("a7", 2): "VERIFIED", uid("a7", 3): "PENDING",
                uid("a7", 4): "REJECTED", uid("a7", 5): "PENDING_VERIFICATION"}
    # users_verification_status_check allows PENDING, APPROVED and REJECTED; the badge reads another
    # spelling (one stored before the CHECK, say) the same way, so those are put on the stored rows after.
    checked = {"PENDING", "APPROVED", "REJECTED"}
    strict_schema.seed("users", [
        member(user_id, "LANDLORD", f"Owner {index}", verification_status=value if value in checked else "PENDING")
        for index, (user_id, value) in enumerate(statuses.items())
    ])
    for row in strict_schema.tables["users"]:
        row["verification_status"] = statuses.get(row["id"], row["verification_status"])

    cards = by_id(client)

    assert {user_id: card["verified"] for user_id, card in cards.items()} == {
        uid("a7", 1): True, uid("a7", 2): True, uid("a7", 3): False, uid("a7", 4): False, uid("a7", 5): False,
    }
    assert client.get(f"{URL}/{uid('a7', 2)}").json()["verified"] is True
    assert badges.is_verified(" approved ") and not badges.is_verified(None) and not badges.is_verified("")


def test_pages_follow_one_stable_order_and_the_limit_is_capped(client, strict_schema):
    landlords = [uid("a8", number) for number in range(30)]
    strict_schema.seed("users", [member(user_id, "LANDLORD", f"Lee {number:02d}") for number, user_id in enumerate(landlords)])
    strict_schema.seed("reviews", [
        *(review(uid("b0", 10 + n), landlords[5], 4) for n in range(3)),
        *(review(uid("b0", 20 + n), landlords[10], 5) for n in range(3)),
        review(uid("b0", 30), landlords[20], 5),
        review(uid("b0", 31), landlords[25], 3),
    ])
    # Most reviews first, then the better average, then the name.
    expected = [landlords[10], landlords[5], landlords[20], landlords[25]]
    expected += [user_id for user_id in landlords if user_id not in expected]

    first = client.get(URL, params={"limit": 24}).json()
    capped = client.get(URL, params={"limit": 100}).json()
    rest = client.get(URL, params={"limit": 24, "offset": 24}).json()

    assert (first["total"], first["limit"], first["offset"], len(first["items"])) == (30, 24, 0, 24)
    assert (capped["limit"], capped["items"]) == (24, first["items"])
    assert [item["id"] for item in first["items"] + rest["items"]] == expected
    assert sum((ids(client, limit=7, offset=offset) for offset in range(0, 30, 7)), []) == expected
    assert client.get(URL, params={"offset": 30}).json()["items"] == []
    assert client.get(URL).json()["limit"] == public_profiles.DEFAULT_LIMIT
    assert client.get(URL, params={"limit": 0}).status_code == 422
    assert client.get(URL, params={"offset": -1}).status_code == 422


def test_every_listed_member_and_review_is_read_page_by_page(client, strict_schema, monkeypatch, caplog):
    monkeypatch.setattr(public_profiles, "PAGE_SIZE", 4)
    landlords = [uid("a8", number) for number in range(10)]
    strict_schema.seed("users", [member(user_id, "LANDLORD", f"Lee {number:02d}") for number, user_id in enumerate(landlords)])
    # The best-reviewed member and most of their reviews are on the last pages read.
    strict_schema.seed("reviews", [review(uid("b0", 90 + n), landlords[9], 5) for n in range(6)])

    page = client.get(URL, params={"limit": 3}).json()

    assert (page["total"], page["items"][0]["id"], page["items"][0]["review_count"]) == (10, landlords[9], 6)
    monkeypatch.setattr(public_profiles, "MAX_SCAN", 8)
    with caplog.at_level(logging.WARNING, logger="app.services.public_profiles"):
        assert client.get(URL).json()["total"] == 8
    assert "read only the first 8 members" in caplog.text


def test_cards_and_profile_pages_count_the_same_published_reviews(client, strict_schema, max_rows):
    # max_rows answers each select with one row: a card's count must not
    # depend on how many rows a request returns.
    landlords = [uid("a8", number) for number in range(5)]
    staff, suspended = uid("d0", 1), uid("d0", 2)
    strict_schema.seed("users", [
        *(member(user_id, "LANDLORD", f"Lee {number:02d}") for number, user_id in enumerate(landlords)),
        member(staff, "ADMIN", "Ada Admin"),
        member(suspended, "LANDLORD", "Sam Suspended", status="SUSPENDED"),
    ])
    # Reviews of members who are not listed come first by id: they never
    # crowd a listed member's own out of the count.
    strict_schema.seed("reviews", [
        *(review(uid("b1", n), staff if n % 2 else suspended, 1) for n in range(40)),
        *(review(uid("b2", n), landlords[n % 5], 4 if n % 3 else 5) for n in range(23)),
        *(review(uid("b3", n), landlords[0], 1, status="HIDDEN") for n in range(4)),
    ])
    published = {user_id: sum(1 for n in range(23) if landlords[n % 5] == user_id) for user_id in landlords}

    cards = by_id(client, limit=24)

    assert {user_id: card["review_count"] for user_id, card in cards.items()} == published
    for user_id, card in cards.items():
        detail = client.get(f"{URL}/{user_id}").json()
        assert (detail["rating_avg"], detail["review_count"]) == (card["rating_avg"], card["review_count"])


def test_every_member_is_read_when_postgrest_answers_fewer_rows_than_asked(client, strict_schema, max_rows):
    # max_rows answers each select with one row, as a project whose max_rows
    # is below PAGE_SIZE would: a short page alone is not the last one.
    landlords = [uid("a8", number) for number in range(5)]
    strict_schema.seed("users", [member(user_id, "LANDLORD", f"Lee {number:02d}") for number, user_id in enumerate(landlords)])
    strict_schema.seed("reviews", [review(uid("b0", n), landlords[4], 5) for n in range(3)])

    page = client.get(URL, params={"limit": 24}).json()

    assert (page["total"], len(page["items"])) == (5, 5)
    assert (page["items"][0]["id"], page["items"][0]["review_count"]) == (landlords[4], 3)


def test_one_read_serves_the_searches_of_the_next_few_seconds(client, strict_schema, monkeypatch):
    clock = SimpleNamespace(now=100.0)
    monkeypatch.setattr(public_profiles, "time", SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 5)
    reads = []
    listed_rows = public_profiles._listed_rows
    monkeypatch.setattr(public_profiles, "_listed_rows", lambda roles: reads.append(list(roles)) or listed_rows(roles))
    strict_schema.seed("users", [member(TENANT, "TENANT", "Jane Doe"), member(LANDLORD, "LANDLORD", "Sam Lee")])

    # Typing searches again at each pause; the tab's members are read once.
    assert ids(client, q="ja") == [TENANT]
    assert ids(client, q="jane") == [TENANT]
    assert ids(client, q="sam", offset=0) == [LANDLORD]
    assert len(reads) == 1
    assert ids(client, role="tenant") == [TENANT]
    assert len(reads) == 2

    strict_schema.seed("users", [member(AGENT, "AGENT", "Andy Agent")])
    clock.now += 4.9
    assert AGENT not in ids(client)
    clock.now += 0.2
    assert AGENT in ids(client)
    assert len(reads) == 3
    # A profile page always reads the member itself.
    assert client.get(f"{URL}/{AGENT}").status_code == 200


def test_search_matches_the_text_a_card_shows_only(client, strict_schema):
    strict_schema.seed("users", [
        member(TENANT, "TENANT", "Jane Doe"),
        member(LANDLORD, "LANDLORD", "Sam Lee"),
        member(PROVIDER, "SERVICE_PROVIDER", "Pat Brown"),
    ])
    strict_schema.seed("tenant_profiles", [{
        "user_id": TENANT, "updated_at": NOW,
        "about_me": "Nurse who loves gardening. " + "Very tidy and quiet. " * 8 + "Secretword at the end.",
    }])
    strict_schema.seed("landlord_profiles", [{"user_id": LANDLORD, "agency_name": "Harbour Homes", "updated_at": NOW}])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER, company_name="Sparky Electrical", metadata={"bio": "Licensed electrician, 50% off call-outs"}),
    ])

    assert ids(client, q="jane") == [TENANT]
    assert ids(client, q="  JANE   d. ") == [TENANT]
    assert ids(client, q="doe") == []  # a tenant's surname is not public
    assert ids(client, q="harbour") == [LANDLORD]
    assert ids(client, q="gardening") == [TENANT]
    assert ids(client, q="secretword") == []  # past the about line that is shown
    assert ids(client, q="ELECTRICIAN") == [PROVIDER]
    assert ids(client, q="pat brown") == []  # a provider is shown by business name
    # Literal text: wildcards and PostgREST syntax match only themselves.
    assert ids(client, q="50%") == [PROVIDER]
    assert ids(client, q="%") == [PROVIDER]
    assert ids(client, q="j_ne") == []
    assert ids(client, q="ja%e") == []
    assert ids(client, q="a,b),or(id.eq.1") == []
    assert ids(client, q="lee", role="tenant") == []


def test_one_search_box_also_finds_members_by_role_area_and_category(client, strict_schema):
    # The homepage sends its single box as q, so areas and roles are matched too.
    strict_schema.seed("service_categories", [
        {"slug": "tradies", "category": "tradie", "name": "Tradies", "description": "Electricians and plumbers."},
    ], schema="web")
    strict_schema.seed("users", [
        member(TENANT, "TENANT", "Tia Quinlan", {"location": "Marrickville", "postcode": "2204"}),
        member(LANDLORD, "LANDLORD", "Lena Landlord", {"location": "Parramatta", "state": "NSW"}),
        member(AGENT, "AGENT", "Andy Smith"),
        member(PROVIDER, "SERVICE_PROVIDER", "Pat Brown"),
    ])
    strict_schema.seed("tenant_profiles", [{"user_id": TENANT, "preferred_locations": ["Newtown"], "updated_at": NOW}])
    strict_schema.seed("agent_profiles", [{"user_id": AGENT, "market_area": "North Shore", "updated_at": NOW}])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER, company_name="Sparky", service_categories=["tradie"], service_area="Inner West"),
    ])

    assert ids(client, q="newtown") == [TENANT]
    assert ids(client, q="parramatta") == [LANDLORD]
    assert ids(client, q="north shore") == [AGENT]
    assert ids(client, q="inner west") == [PROVIDER]
    assert ids(client, q="tradies") == [PROVIDER]
    assert ids(client, q="agent") == [AGENT]
    assert ids(client, q="landlord") == [LANDLORD]
    assert ids(client, q="service provider") == [PROVIDER]
    # What a card leaves out still cannot be found.
    assert ids(client, q="marrickville") == []
    assert ids(client, q="2204") == []
    assert ids(client, q="quinlan") == []
    assert ids(client, q="tradie,") == []


def test_location_matches_the_shown_suburbs_and_areas(client, strict_schema):
    strict_schema.seed("users", [
        member(TENANT, "TENANT", "Tia Tenant", {"location": "Marrickville", "state": "NSW"}),
        member(LANDLORD, "LANDLORD", "Lena Landlord", {"location": "Parramatta", "state": "NSW", "postcode": "2150",
                                                       "address": "4 Private Road"}),
        member(PROVIDER, "SERVICE_PROVIDER", "Pia Provider", {"location": "Enmore"}),
        member(AGENT, "AGENT", "Andy Agent"),
    ])
    strict_schema.seed("tenant_profiles", [
        {"user_id": TENANT, "preferred_locations": ["Newtown", " Glebe ", "newtown"], "updated_at": NOW},
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(PROVIDER, service_area="Inner West")])
    strict_schema.seed("agent_profiles", [{"user_id": AGENT, "market_area": "North Shore", "updated_at": NOW}])

    cards = by_id(client)

    assert cards[TENANT]["areas"] == ["Newtown", "Glebe"]
    assert cards[LANDLORD]["areas"] == ["Parramatta, NSW"]
    assert (cards[PROVIDER]["areas"], cards[PROVIDER]["service_area"]) == (["Enmore"], "Inner West")
    assert ids(client, location="glebe") == [TENANT]
    assert ids(client, location="marrickville") == []  # the tenant's own suburb is not shown
    assert ids(client, location="Parramatta, NSW") == [LANDLORD]
    assert ids(client, location="2150") == []  # postcodes are not public
    assert ids(client, location="private road") == []
    assert ids(client, location="inner west") == [PROVIDER]
    assert ids(client, location="enmore") == [PROVIDER]
    assert ids(client, location="north shore") == [AGENT]
    assert ids(client, location="newtown", q="tia") == [TENANT]
    assert ids(client, location="newtown", q="lena") == []


def test_provider_cards_show_categories_prices_and_area_from_the_provider_profile(client, strict_schema):
    strict_schema.seed("service_categories", [
        {"slug": "tradies", "category": "tradie", "name": "Tradies", "description": "Electricians and plumbers."},
    ], schema="web")
    strict_schema.seed("users", [member(PROVIDER, "SERVICE_PROVIDER", "Pat Brown", avatar_url="storage/key.png")])
    strict_schema.seed("service_provider_profiles", [provider_profile(
        PROVIDER, company_name="Sparky Electrical", service_categories=["tradie", "PEST_CONTROL", "tradie"],
        pricing_summary="From $120 a call-out", service_area="Inner West",
        metadata={"slug": "sparky-electrical", "bio": "Licensed electrician.", "abn": "12 345 678 901"},
    )])

    card = by_id(client, role="provider")[PROVIDER]
    detail = client.get(f"{URL}/{PROVIDER}")

    assert {key: card[key] for key in ("role", "role_label", "display_name", "business_name", "categories",
                                       "pricing_summary", "service_area", "provider_slug", "about", "avatar_url")} == {
        "role": "provider", "role_label": "Service provider", "display_name": "Sparky Electrical",
        "business_name": None, "categories": ["Tradies", "Pest control"], "pricing_summary": "From $120 a call-out",
        "service_area": "Inner West", "provider_slug": "sparky-electrical", "about": "Licensed electrician.",
        "avatar_url": None,
    }
    assert detail.json()["categories"] == ["Tradies", "Pest control"]
    assert "12 345 678 901" not in detail.text and "Pat Brown" not in detail.text


def test_names_show_as_assumption_one_says(client, strict_schema):
    strict_schema.seed("users", [
        member(uid("a9", 1), "TENANT", "Jane Mary Doe"),
        member(uid("a9", 2), "TENANT", "Prince"),
        member(uid("a9", 3), "TENANT", "jane.doe@mail.example"),
        member(uid("a9", 4), "TENANT", None),
        member(uid("a9", 5), "LANDLORD", "lena@mail.example"),
        member(uid("a9", 6), "LANDLORD", "  Lena   Landlord  "),
        member(uid("a9", 7), "LANDLORD", "0412 345 678"),
        member(uid("a9", 8), "TENANT", "+61 412 345 678"),
        member(uid("a9", 9), "SERVICE_PROVIDER", "Pat Brown"),
    ])
    strict_schema.seed("service_provider_profiles", [provider_profile(uid("a9", 9), company_name="24/7 Plumbing")])

    names = {user_id: card["display_name"] for user_id, card in by_id(client).items()}

    assert names == {
        uid("a9", 1): "Jane D.", uid("a9", 2): "Prince", uid("a9", 3): "TenantVoice member",
        uid("a9", 4): "TenantVoice member", uid("a9", 5): "TenantVoice member", uid("a9", 6): "Lena Landlord",
        uid("a9", 7): "TenantVoice member", uid("a9", 8): "TenantVoice member", uid("a9", 9): "24/7 Plumbing",
    }
    text = client.get(URL).text
    assert "mail.example" not in text and "345" not in text and "412" not in text


def test_a_provider_card_names_the_web_category_and_a_mobile_row_its_repair_codes(client, strict_schema):
    # The web keeps the provider's own category in metadata beside the shared codes it writes.
    strict_schema.seed("service_categories", [
        {"slug": "cleaning-provider", "category": "cleaner", "name": "Cleaning Provider", "description": "Cleans."},
    ], schema="web")
    mobile = uid("a8", 2)
    strict_schema.seed("users", [member(PROVIDER, "SERVICE_PROVIDER", "Pat Brown"),
                                 member(mobile, "SERVICE_PROVIDER", "Mo Bile")])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER, company_name="Spotless", service_categories=["GENERAL"],
                         metadata={"slug": "spotless", "category": "cleaner"}),
        provider_profile(mobile, company_name="Mo Fix", service_categories=["HVAC", "LOCKS_SECURITY"],
                         metadata={"slug": "mo-fix"}),
    ])

    cards = by_id(client, role="provider")

    assert cards[PROVIDER]["categories"] == ["Cleaning Provider"]
    assert cards[mobile]["categories"] == ["Heating & Cooling", "Locks / Security"]
    assert ids(client, q="cleaning provider") == [PROVIDER]
