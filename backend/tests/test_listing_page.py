"""The public listing page and catalogue (R25), under the strict fake.

A signed-out visitor never gets a street address or anyone's contact
details; a signed-in member gets the street. The page names the landlord as
their public profile does, says what the viewer has done (liked, applied),
and answers 404 for a listing nobody may open. Likes are listing_favorites
rows, for tenants only.
"""

import json

import pytest

from app.core.deps import CurrentProfile, get_optional_profile
from app.main import app
from tests.factories_identity import account
from tests.factories_rental import (
    NOW,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    new_id,
    seed_listing,
    seed_people,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
STREET = "12 Kingfisher Lane"
OWNER_EMAIL = "olivia.owner@private.example"
OWNER_PHONE = "0412 555 019"


@pytest.fixture
def listing(strict_schema):
    """A published listing titled with its street, whose landlord keeps an email and a phone number."""
    seed_people(strict_schema)
    for user in strict_schema.tables["users"]:
        if user["id"] == OWNER:
            user.update(email=OWNER_EMAIL, phone=OWNER_PHONE, verification_status="APPROVED")
    listing_id, _ = seed_listing(
        strict_schema,
        listing={"title": f"{STREET}, Wollongong"},
        prop={"address_line_1": STREET, "address_line_2": "Unit 4", "bedrooms": 2},
    )
    return listing_id


def _as_viewer(id: str, role: str) -> None:
    """Sign the request in for the routes that read an optional viewer, as as_profile does for the rest."""
    profile = CurrentProfile(id=id, role=role, full_name="Viewer", raw={"id": id})
    app.dependency_overrides[get_optional_profile] = lambda: profile


def _contact_free(text: str) -> None:
    for secret in (STREET.lower(), "kingfisher", "unit 4", OWNER_EMAIL, OWNER_PHONE, '"email"', '"phone"'):
        assert secret not in text.lower(), secret


# -- signed out ---------------------------------------------------------------------
def test_a_signed_out_visitor_gets_no_street_address_or_contact_details(client, listing):
    response = client.get(f"{API}/properties/{listing}")

    assert response.status_code == 200, response.text
    _contact_free(response.text)
    body = response.json()
    assert (body["address"], body["address_hidden"]) == ("Wollongong, NSW 2500", True)
    # The title named the street, so it describes the home instead.
    assert body["title"] == "2-bedroom apartment in Wollongong"
    assert (body["suburb"], body["state"], body["postcode"]) == ("Wollongong", "NSW", "2500")


def test_the_signed_out_catalogue_holds_no_street_address_either(client, listing):
    response = client.get(f"{API}/properties")

    assert response.status_code == 200, response.text
    _contact_free(response.text)
    [card] = response.json()
    assert (card["id"], card["address"], card["address_hidden"]) == (listing, "Wollongong, NSW 2500", True)


@pytest.mark.parametrize("address, title", [
    ("Unit 4, 12 Kingfisher Lane", "12 Kingfisher Lane"),
    ("4/12 Kingfisher Lane", "Unit 4, 12 Kingfisher Lane"),
    ("12 Kingfisher Lane", "12 Kingfisher Ln, Wollongong"),
    ("12 Kingfisher Lane", "Bright 2-bed at 12 Kingfisher"),
    ("12 Kingfisher Lane", "Quiet flat on Kingfisher Lane"),
    ("12 Kingfisher Lane", "12 KINGFISHER LN"),
])
def test_a_title_naming_the_street_in_any_form_is_replaced_for_visitors(client, strict_schema, address, title):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, listing={"title": title}, prop={"address_line_1": address, "bedrooms": 2})

    shown = client.get(f"{API}/properties/{listing_id}").json()["title"]
    [card] = client.get(f"{API}/properties").json()

    assert shown == card["title"] == "2-bedroom apartment in Wollongong"


@pytest.mark.parametrize("title", ["Sunny flat near Kingfisher Park", "2-bedroom flat by the beach", "Kingfisher"])
def test_a_title_that_only_shares_a_word_with_the_street_stays(client, strict_schema, title):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, listing={"title": title}, prop={"address_line_1": "12 Kingfisher Lane"})

    assert client.get(f"{API}/properties/{listing_id}").json()["title"] == title


def test_a_title_without_the_street_is_shown_as_the_landlord_wrote_it(client, strict_schema):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, listing={"title": "Sunny flat by the beach"},
                                 prop={"address_line_1": "1 Harbour Street"})

    assert client.get(f"{API}/properties/{listing_id}").json()["title"] == "Sunny flat by the beach"


def test_an_invalid_token_is_treated_as_signed_out(client, listing):
    response = client.get(f"{API}/properties/{listing}", headers={"Authorization": "Bearer expired"})

    assert response.status_code == 200, response.text
    _contact_free(response.text)
    assert response.json()["viewer"] == {"role": None, "is_owner": False, "liked": False, "application": None}


def test_a_refused_token_says_so_for_the_web_to_refresh_it(client, strict_schema, listing):
    member = account(strict_schema, new_id(), "reader@example.test")
    suspended = account(strict_schema, new_id(), "suspended@example.test", status="SUSPENDED")

    for path in (f"{API}/properties/{listing}", f"{API}/properties"):
        expired = client.get(path, headers={"Authorization": "Bearer expired"})
        valid = client.get(path, headers={"Authorization": f"Bearer {member}"})
        blocked = client.get(path, headers={"Authorization": f"Bearer {suspended}"})
        signed_out = client.get(path)

        assert (expired.status_code, expired.headers.get("X-Session-Expired")) == (200, "1")
        # A token it took, an account it refuses (403) and no token at all are no session to refresh.
        assert [response.headers.get("X-Session-Expired") for response in (valid, blocked, signed_out)] == [None] * 3
        _contact_free(blocked.text)


def test_the_web_may_read_the_refresh_signal_across_origins(client, listing):
    response = client.get(f"{API}/properties/{listing}",
                          headers={"Authorization": "Bearer expired", "Origin": "http://localhost:3000"})

    assert "x-session-expired" in response.headers.get("access-control-expose-headers", "").lower()


# -- signed in ---------------------------------------------------------------------
def test_a_signed_in_member_gets_the_street_address_but_no_contact_details(client, strict_schema, listing):
    token = account(strict_schema, new_id(), "member@example.test", "TENANT")

    response = client.get(f"{API}/properties/{listing}", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["address"] == f"{STREET}, Unit 4, Wollongong, NSW, 2500"
    assert (body["address_hidden"], body["title"]) == (False, f"{STREET}, Wollongong")
    assert body["viewer"]["role"] == "tenant"
    assert OWNER_EMAIL not in response.text and OWNER_PHONE not in response.text


def test_the_signed_in_catalogue_shows_street_addresses(client, strict_schema, listing):
    token = account(strict_schema, new_id(), "member@example.test", "LANDLORD")

    [card] = client.get(f"{API}/properties", headers={"Authorization": f"Bearer {token}"}).json()

    assert (card["address_hidden"], card["address"].startswith(STREET)) == (False, True)


def test_the_page_names_the_landlord_as_their_public_profile_does(client, strict_schema, listing):
    strict_schema.seed("reviews", [{
        "id": new_id(), "reviewer_user_id": TENANT, "reviewed_user_id": OWNER, "rating": 4, "landlord_rating": 4,
        "status": "PUBLISHED", "updated_at": NOW,
    }])

    landlord = client.get(f"{API}/properties/{listing}").json()["landlord"]

    assert landlord == {
        "id": OWNER, "display_name": "Olivia Owner", "role_label": "Landlord", "avatar_url": None,
        "verified": True, "rating_avg": 4.0, "review_count": 1,
    }


def test_a_landlord_off_public_profiles_is_not_named(client, strict_schema, listing):
    for user in strict_schema.tables["users"]:
        if user["id"] == OWNER:
            user["metadata"] = {"privacy": {"public_profile": False}}

    response = client.get(f"{API}/properties/{listing}")

    assert response.json()["landlord"] is None
    assert "Olivia" not in response.text


def test_the_page_says_what_the_viewer_has_done(client, strict_schema, listing):
    application = application_row(listing, TENANT, status="SHORTLISTED", created_at="2026-02-01T00:00:00+00:00")
    strict_schema.seed("rental_applications", [application])
    strict_schema.seed("listing_favorites", [{"user_id": TENANT, "listing_id": listing}])

    _as_viewer(TENANT, "tenant")
    tenant = client.get(f"{API}/properties/{listing}").json()
    _as_viewer(OWNER, "landlord")
    owner = client.get(f"{API}/properties/{listing}").json()

    assert tenant["viewer"] == {
        "role": "tenant", "is_owner": False, "liked": True,
        "application": {"id": application["id"], "stage": "shortlisted", "can_withdraw": True,
                        "created_at": "2026-02-01T00:00:00Z"},
    }
    assert owner["viewer"] == {"role": "landlord", "is_owner": True, "liked": False, "application": None}
    assert tenant["like_count"] == owner["like_count"] == 1


def test_a_listing_closed_to_applications_opens_but_takes_none(client, strict_schema):
    seed_people(strict_schema)
    published, _ = seed_listing(strict_schema)
    closed, _ = seed_listing(strict_schema, status="APPLICATIONS_CLOSED")

    assert client.get(f"{API}/properties/{published}").json()["accepting_applications"] is True
    body = client.get(f"{API}/properties/{closed}").json()
    assert (body["accepting_applications"], body["listing_status"]) == (False, "applications_closed")


# -- not found ----------------------------------------------------------------------
@pytest.mark.parametrize("status", ["DRAFT", "PAUSED", "LEASED", "ARCHIVED"])
def test_a_listing_nobody_may_open_is_not_found(client, strict_schema, status):
    seed_people(strict_schema)
    listing_id, _ = seed_listing(strict_schema, status=status)

    response = client.get(f"{API}/properties/{listing_id}")

    assert (response.status_code, response.json()["detail"]) == (404, "Property not found")


@pytest.mark.parametrize("listing_id", [new_id(), "prop1", "does-not-exist-xyz"])
def test_an_unknown_or_malformed_listing_id_is_not_found(client, listing_id):
    assert client.get(f"{API}/properties/{listing_id}").status_code == 404


# -- likes ----------------------------------------------------------------------------
def _likes(db, listing_id: str) -> list[str]:
    return sorted(row["user_id"] for row in db.tables.get("listing_favorites", []) if row["listing_id"] == listing_id)


def test_a_tenant_likes_a_listing_once_and_can_take_it_back(client, strict_schema, as_profile, listing):
    as_profile(id=TENANT, role="tenant")

    first = client.put(f"{API}/properties/{listing}/like")
    again = client.put(f"{API}/properties/{listing}/like")

    assert (first.status_code, first.json()) == (200, {"liked": True, "like_count": 1})
    assert again.json() == {"liked": True, "like_count": 1}
    assert _likes(strict_schema, listing) == [TENANT]
    assert client.delete(f"{API}/properties/{listing}/like").json() == {"liked": False, "like_count": 0}
    assert _likes(strict_schema, listing) == []


def test_two_likes_sent_at_once_leave_one_row(client, strict_schema, as_profile, listing, monkeypatch):
    from app.services import properties

    strict_schema.catalog_rules = True  # listing_favorites_user_id_listing_id_key
    liked = properties._liked
    monkeypatch.setattr(properties, "_liked", lambda *args: False)
    # The other request's insert landed between this one's check and its insert.
    strict_schema.seed("listing_favorites", [{"user_id": TENANT, "listing_id": listing}])
    as_profile(id=TENANT, role="tenant")

    response = client.put(f"{API}/properties/{listing}/like")

    assert response.json() == {"liked": True, "like_count": 1}
    assert _likes(strict_schema, listing) == [TENANT]
    assert liked(listing, TENANT) is True


def test_only_a_listing_anyone_may_open_can_be_liked(client, strict_schema, as_profile):
    seed_people(strict_schema)
    paused, _ = seed_listing(strict_schema, status="PAUSED")
    as_profile(id=TENANT, role="tenant")

    assert client.put(f"{API}/properties/{paused}/like").status_code == 404
    assert client.put(f"{API}/properties/not-a-listing/like").status_code == 404
    assert not strict_schema.tables.get("listing_favorites")


def test_a_like_comes_off_a_listing_that_is_no_longer_advertised(client, strict_schema, as_profile):
    seed_people(strict_schema)
    leased, _ = seed_listing(strict_schema, status="LEASED")
    strict_schema.seed("listing_favorites", [{"user_id": TENANT, "listing_id": leased}])
    as_profile(id=TENANT, role="tenant")

    assert client.delete(f"{API}/properties/{leased}/like").json() == {"liked": False, "like_count": 0}


@pytest.mark.parametrize("role", ["landlord", "service_provider"])
def test_only_tenants_like_listings(client, strict_schema, as_profile, listing, role):
    as_profile(id=STRANGER, role=role)

    assert client.put(f"{API}/properties/{listing}/like").status_code == 403
    assert client.delete(f"{API}/properties/{listing}/like").status_code == 403
    assert not strict_schema.tables.get("listing_favorites")


def test_signed_out_visitors_see_the_count_but_cannot_like(client, strict_schema, listing):
    strict_schema.seed("listing_favorites", [{"user_id": TENANT, "listing_id": listing},
                                             {"user_id": STRANGER, "listing_id": listing}])

    assert client.put(f"{API}/properties/{listing}/like").status_code == 401
    body = client.get(f"{API}/properties/{listing}").json()
    assert (body["like_count"], body["viewer"]["liked"]) == (2, False)
    assert TENANT not in json.dumps(body)
