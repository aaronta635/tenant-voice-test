"""Listing auto-fill (R32): POST /me/listing-imports/url and /pdf, for landlords only (services/listing_import.py).

An import reads a listing into the create-listing wizard's fields, each
found, inferred or missing with its evidence, and writes nothing. Pages are
served by FakeWeb and PDFs are built here (tests/factories_listing_import.py);
the model never runs: a stub answers in its place, behind the paid_ai gate.
How a link may be read is tests/test_listing_import_safety.py.
"""

import copy
import json
import time
from datetime import date

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services import listing_import
from tests import fake_supabase
from tests.factories_identity import account, users_row
from tests.factories_listing_import import PUBLIC, FakeWeb, Reply, html, pdf_bytes

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/listing-imports"
OWNER = "d5555555-5555-4555-8555-555555555555"
TODAY = date(2026, 10, 23)

APARTMENT = """<!doctype html><html><head>
<title>Harbour flat | Coast Realty</title>
<meta property="og:site_name" content="Coast Realty">
<meta property="og:image" content="https://cdn.coast.example/photos/harbour-1.jpg">
<script type="application/ld+json">{
 "@context": "https://schema.org", "@type": ["Apartment", "Product"],
 "name": "Harbour flat with water views",
 "description": "A bright two-bedroom flat <b>by the harbour</b> &amp; the beach.",
 "image": ["https://cdn.coast.example/photos/harbour-2.jpg"],
 "address": {"@type": "PostalAddress", "streetAddress": "4/1 Harbour Street", "addressLocality": "Wollongong",
             "addressRegion": "New South Wales", "postalCode": "2500"},
 "numberOfBedrooms": 2, "numberOfBathroomsTotal": "1",
 "floorSize": {"@type": "QuantitativeValue", "value": 78, "unitCode": "MTK"},
 "petsAllowed": false,
 "amenityFeature": [{"@type": "LocationFeatureSpecification", "name": "Balcony", "value": true},
                    {"@type": "LocationFeatureSpecification", "name": "Pool", "value": false}, "Dishwasher"],
 "offers": {"@type": "Offer", "priceCurrency": "AUD", "availabilityStarts": "2026-12-01", "leaseLength": "P12M",
            "priceSpecification": {"@type": "UnitPriceSpecification", "price": 650, "priceCurrency": "AUD",
                                   "unitCode": "WEE"}}
}</script></head><body><h1>4/1 Harbour Street, Wollongong NSW 2500</h1><p>Bond: $2,600</p></body></html>"""


@pytest.fixture(autouse=True)
def web(monkeypatch) -> FakeWeb:
    return FakeWeb().install(monkeypatch)


@pytest.fixture(autouse=True)
def calendar(monkeypatch):
    monkeypatch.setattr(listing_import, "_today", lambda: TODAY)


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    """Never contact DeepSeek, even with a local key."""
    listing_import.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))

    def unexpected(_payload):
        raise AssertionError("This test must not contact the model")

    monkeypatch.setattr(listing_import, "call_model", unexpected)
    yield
    listing_import.clear_caches()


@pytest.fixture
def owner(strict_schema, as_profile):
    """A verified landlord: reading with the model is the paid AI (R18)."""
    strict_schema.seed("users", [users_row(OWNER, "olly@example.test", "LANDLORD", verification_status="APPROVED")])
    return as_profile(id=OWNER, role="landlord", full_name="Olly Owner")


def from_link(client, url="https://coast.example/listings/1", use_ai=False):
    return client.post(f"{API}/url", json={"url": url, "use_ai": use_ai})


def from_pdf(client, data: bytes, name="listing.pdf", use_ai=False, content_type="application/pdf"):
    return client.post(f"{API}/pdf", files={"file": (name, data, content_type)},
                       data={"use_ai": "true" if use_ai else "false"})


def fields(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()["fields"]


def values(response) -> dict:
    return {name: field["value"] for name, field in fields(response).items() if field["source"] != "missing"}


def sources(response) -> dict:
    return {name: field["source"] for name, field in fields(response).items()}


def refused(response, code: str, status: int) -> dict:
    assert response.status_code == status, response.text
    assert response.json()["detail"]["code"] == code
    return response.json()["detail"]


LISTING_PDF = pdf_bytes([
    "Sunny 2 bedroom unit in Newtown",
    "5/18 Wilson St, Newtown NSW 2042",
    "Rent: $650 per week. Bond $2,600.",
    "1 bathroom. Available from 1 December 2026. Pets allowed.",
    "This light-filled unit has an open-plan living room, a renovated kitchen with gas cooking, and a",
    "private balcony that looks over the park, close to cafes and the train.",
], title="Wilson St unit")


# ---------------------------------------------------------------------------
# Who may import
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("path, kwargs", [("url", {"json": {"url": "https://coast.example/1"}}),
                                          ("pdf", {"files": {"file": ("l.pdf", LISTING_PDF, "application/pdf")}})])
def test_signed_out_callers_get_401(client, web, path, kwargs):
    assert client.post(f"{API}/{path}", **kwargs).status_code == 401
    assert web.lookups == [] and web.connections == []


@pytest.mark.parametrize("role", ["tenant", "service_provider", "admin", "officer"])
@pytest.mark.parametrize("path, kwargs", [("url", {"json": {"url": "https://coast.example/1"}}),
                                          ("pdf", {"files": {"file": ("l.pdf", LISTING_PDF, "application/pdf")}})])
def test_only_landlords_import_listings(client, web, as_profile, role, path, kwargs):
    web.site("coast.example", html(APARTMENT))
    as_profile(id=OWNER, role=role)

    response = client.post(f"{API}/{path}", **kwargs)

    assert response.status_code == 403
    assert web.lookups == [] and web.connections == []


@pytest.mark.parametrize("primary_role", ["LANDLORD", "AGENT"])
def test_landlords_and_agents_import_with_their_own_sign_in(client, strict_schema, web, primary_role):
    web.site("coast.example", html(APARTMENT))
    token = account(strict_schema, OWNER, "olly@example.test", primary_role)

    response = client.post(f"{API}/url", json={"url": "https://coast.example/listings/1"},
                           headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200, response.text
    assert client.post(f"{API}/pdf", files={"file": ("l.pdf", LISTING_PDF, "application/pdf")},
                       headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_a_tenant_with_their_own_sign_in_is_refused(client, strict_schema, web):
    token = account(strict_schema, OWNER, "tess@example.test", "TENANT")

    response = client.post(f"{API}/url", json={"url": "https://coast.example/1"},
                           headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert web.connections == []


def test_the_request_takes_only_a_link_and_the_ai_choice(client, owner):
    response = client.post(f"{API}/url", json={"url": "https://coast.example/1", "save": True})

    assert response.status_code == 422


def test_one_import_per_owner_runs_at_a_time(client, owner, web):
    web.site("coast.example", html(APARTMENT))
    listing_import._importing.update({OWNER, "another-owner"})

    detail = refused(from_link(client), "busy", 429)

    assert "still running" in detail["message"]
    refused(from_pdf(client, LISTING_PDF), "busy", 429)
    assert web.lookups == [] and web.connections == []
    listing_import._importing.discard(OWNER)
    # Another owner's import in progress holds nobody else up.
    assert from_link(client).status_code == 200


def test_a_failed_import_lets_the_next_one_run(client, owner, web):
    web.site("coast.example", html("<p>Nothing to see.</p>"))
    refused(from_link(client), "not_a_listing", 422)
    refused(from_link(client, "https://www.domain.com.au/listing-1"), "blocked", 422)
    refused(from_pdf(client, b"not a pdf"), "unsupported_content", 415)

    web.serve(PUBLIC, html(APARTMENT))

    assert from_link(client).status_code == 200
    assert listing_import._importing == set()


# ---------------------------------------------------------------------------
# Reading a page
# ---------------------------------------------------------------------------
def test_structured_data_fills_the_fields_it_states_as_found(client, owner, web):
    web.site("coast.example", html(APARTMENT))

    response = from_link(client)

    assert values(response) == {
        "title": "Harbour flat with water views",
        "description": "A bright two-bedroom flat by the harbour & the beach.",
        "address": "4/1 Harbour Street", "suburb": "Wollongong", "state": "NSW", "postcode": "2500",
        "property_type": "Apartment", "bedrooms": 2, "bathrooms": 1, "price": 650.0, "bond": 2600.0,
        "lease_term": "12 months", "available_from": "2026-12-01", "amenities": ["Balcony", "Dishwasher"],
        "pets_allowed": False, "floor_area": 78.0,
    }
    assert set(sources(response).values()) == {"found"}
    body = fields(response)
    assert body["bedrooms"] == {"value": 2, "source": "found", "evidence": "numberOfBedrooms: 2", "via": "structured_data"}
    assert body["price"]["evidence"] == "price: 650 AUD (WEE)"
    assert body["bond"] == {"value": 2600.0, "source": "found", "evidence": "Bond: $2,600", "via": "text"}
    assert response.json()["counts"] == {"found": 16, "inferred": 0, "missing": 0}
    assert (response.json()["kind"], response.json()["demo"], response.json()["source_label"]) == (
        "url", False, "coast.example")


def test_photos_are_never_copied_from_the_source(client, owner, web):
    web.site("coast.example", html(APARTMENT))

    response = from_link(client)

    assert response.status_code == 200
    assert "cdn.coast.example" not in response.text
    assert "photo" not in response.json()["fields"]


def test_linked_structured_data_and_conversions_are_marked_inferred(client, owner, web):
    web.site("coast.example", html("""<html><head><script type="application/ld+json">
    {"@context": "https://schema.org", "@graph": [
      {"@type": "Offer", "itemOffered": {"@id": "#home"}, "availabilityStarts": "2027-01-15T00:00:00+11:00",
       "priceSpecification": {"@type": "UnitPriceSpecification", "price": "2,600", "priceCurrency": "AUD", "unitCode": "MON"}},
      {"@type": "http://schema.org/SingleFamilyResidence", "@id": "#home", "name": "Family home with garden",
       "numberOfRooms": 4, "numberOfFullBathrooms": 2, "petsAllowed": "Yes",
       "floorSize": {"@type": "QuantitativeValue", "value": 1500, "unitCode": "FTK"},
       "address": "12 Conie Ave, Baulkham Hills NSW 2153"}]}
    </script></head><body></body></html>"""))

    body = fields(from_link(client))

    assert {name: (field["value"], field["source"]) for name, field in body.items() if field["source"] != "missing"} == {
        "title": ("Family home with garden", "found"),
        "address": ("12 Conie Ave", "inferred"), "suburb": ("Baulkham Hills", "inferred"),
        "state": ("NSW", "inferred"), "postcode": ("2153", "inferred"),
        "property_type": ("House", "inferred"), "bedrooms": (4, "inferred"), "bathrooms": (2, "inferred"),
        "price": (600.0, "inferred"), "available_from": ("2027-01-15", "found"),
        "pets_allowed": (True, "found"), "floor_area": (139.4, "inferred"),
    }
    assert body["price"]["evidence"] == "price: 2,600 AUD (MON)"
    assert body["address"]["evidence"] == "address: 12 Conie Ave, Baulkham Hills NSW 2153"


@pytest.mark.parametrize("offer, expected", [
    ({"price": 3000, "priceCurrency": "USD"}, None),
    ({"price": 850000, "priceCurrency": "AUD"}, None),
    ({"price": 180, "priceCurrency": "AUD", "priceSpecification": {"price": 180, "unitText": "per night"}}, None),
    ({"price": 700, "priceCurrency": "AUD"}, (700.0, "inferred")),
    ({"@type": "AggregateOffer", "lowPrice": "$720", "priceCurrency": "AUD", "unitText": "WEEK"}, (720.0, "found")),
])
def test_a_price_is_a_weekly_rent_only_when_it_can_be(client, owner, web, offer, expected):
    data = {"@context": "https://schema.org", "@type": "House", "name": "A house", "numberOfBedrooms": 3, "offers": offer}
    web.site("coast.example", html(f'<script type="application/ld+json">{__import__("json").dumps(data)}</script>'))

    price = fields(from_link(client))["price"]

    assert (price["value"], price["source"]) == (expected or (None, "missing"))


def test_opengraph_and_meta_tags_fill_what_the_page_has_no_structured_data_for(client, owner, web):
    web.site("coast.example", html("""<html><head><title>ignored</title>
    <meta property="og:title" content="Bright studio near the beach - Coastal Realty">
    <meta property="og:site_name" content="Coastal Realty">
    <meta name="description" content="Bright studio, 1 bed 1 bath, $480 pw. Available now.">
    <meta property="og:street-address" content="3/7 Ocean Pde"><meta property="og:locality" content="Coogee">
    <meta property="og:region" content="NSW"><meta property="og:postal-code" content="2034">
    </head><body></body></html>"""))

    body = fields(from_link(client))

    assert body["title"] == {"value": "Bright studio near the beach", "source": "found",
                             "evidence": "og:title: Bright studio near the beach", "via": "page_meta"}
    assert (body["address"]["value"], body["suburb"]["value"], body["state"]["value"], body["postcode"]["value"]) == (
        "3/7 Ocean Pde", "Coogee", "NSW", "2034")
    assert {name: body[name]["via"] for name in ("address", "description")} == {"address": "page_meta", "description": "page_meta"}
    # The text rules read the description: "Available now" is today, worked out.
    assert (body["bedrooms"]["value"], body["bathrooms"]["value"], body["price"]["value"]) == (1, 1, 480.0)
    assert (body["available_from"]["value"], body["available_from"]["source"]) == ("2026-10-23", "inferred")
    assert (body["property_type"]["value"], body["property_type"]["source"]) == ("Studio", "inferred")


def test_text_rules_read_a_page_with_no_tags(client, owner, web):
    web.site("coast.example", html("""<html><body><h1>Spacious apartment for rent in Surry Hills NSW 2010</h1>
    <div>Bedrooms: 3</div><div>Bathrooms: 2</div>
    <p>Rent $2,600 per month. Bond: $2,400. 12 month lease. Date available: Monday, 5 January 2027. Pet friendly.</p>
    </body></html>"""))

    body = fields(from_link(client))

    assert {name: (field["value"], field["source"]) for name, field in body.items() if field["source"] != "missing"} == {
        "title": ("Spacious apartment for rent in Surry Hills NSW 2010", "found"),
        "suburb": ("Surry Hills", "inferred"), "state": ("NSW", "inferred"), "postcode": ("2010", "inferred"),
        "property_type": ("Apartment", "inferred"),
        "bedrooms": (3, "found"), "bathrooms": (2, "found"),
        "price": (600.0, "inferred"), "bond": (2400.0, "found"), "lease_term": ("12 months", "found"),
        "available_from": ("2027-01-05", "found"), "pets_allowed": (True, "found"),
    }
    assert body["bedrooms"]["evidence"] == "Bedrooms: 3"
    assert body["price"]["evidence"].startswith("Rent $2,600 per month.")


@pytest.mark.parametrize("text, expected", [
    ("3 bed 2 bath $650pw", {"bedrooms": 3, "bathrooms": 2, "price": 650.0}),
    ("Three bedrooms, two bathrooms. $1,300 per fortnight.", {"bedrooms": 3, "bathrooms": 2, "price": 650.0}),
    ("2BR / 1 bath. $700 p/w. No pets.", {"bedrooms": 2, "bathrooms": 1, "price": 700.0, "pets_allowed": False}),
    ("1 bed. Pets allowed. Available from 15th March. 6 month lease.",
     {"bedrooms": 1, "pets_allowed": True, "available_from": "2027-03-15", "lease_term": "6 months"}),
    ("2 bed. Available 01/12/2026. $650 per week", {"bedrooms": 2, "available_from": "2026-12-01", "price": 650.0}),
    ("2 bed. Pets: not permitted.", {"bedrooms": 2, "pets_allowed": False}),
    ("2 bed. Pets allowed: No. Pets considered for the garden.", {"bedrooms": 2, "pets_allowed": False}),
    ("2 bed. Pets: Yes", {"bedrooms": 2, "pets_allowed": True}),
    ("2 bed. Pets allowed. No smoking.", {"bedrooms": 2, "pets_allowed": True}),
])
def test_the_text_rules(client, owner, web, text, expected):
    web.site("coast.example", html(f"<html><body><p>{text}</p></body></html>"))

    found = values(from_link(client))

    assert {name: found.get(name) for name in expected} == expected


def test_a_date_without_a_year_is_inferred(client, owner, web):
    web.site("coast.example", html("<p>2 bedroom unit, $550 per week, available from 15th March.</p>"))

    available = fields(from_link(client))["available_from"]

    assert (available["value"], available["source"]) == ("2027-03-15", "inferred")


def test_nothing_is_made_up_for_what_the_page_does_not_say(client, owner, web):
    web.site("coast.example", html("<html><head><title>Unit in Glebe</title></head><body><p>2 bed unit.</p></body></html>"))

    body = fields(from_link(client))

    missing = {name for name, field in body.items() if field["source"] == "missing"}
    assert missing == {"description", "address", "suburb", "state", "postcode", "bathrooms", "price", "bond",
                       "lease_term", "available_from", "amenities", "pets_allowed", "floor_area"}
    assert all(body[name] == {"value": None, "source": "missing", "evidence": None, "via": None} for name in missing)


@pytest.mark.parametrize("page", [
    "<html><head><title>10 tips for renters</title><meta name='description' content='How to find a home'></head>"
    "<body><p>Renting is hard. Here are our tips for finding a house to rent.</p></body></html>",
    # A product page: a price with no period and a title word are only guesses.
    '<script type="application/ld+json">{"@type": "Product", "name": "Townhouse in Glebe", '
    '"offers": {"@type": "Offer", "price": 780, "priceCurrency": "AUD"}}</script>',
    "<html><body></body></html>",
])
def test_a_page_that_is_not_a_listing_is_said_so(client, owner, web, page):
    web.site("coast.example", html(page))

    detail = refused(from_link(client), "not_a_listing", 422)

    assert "couldn't find a listing's details at that link" in detail["message"]


def test_structured_data_naming_a_home_is_a_listing_however_little_it_says(client, owner, web):
    web.site("coast.example", html('<script type="application/ld+json">{"@type": "House", "name": "A house"}</script>'))

    assert values(from_link(client)) == {"title": "A house", "property_type": "House"}


def test_a_long_title_is_cut_at_a_word_and_marked_inferred(client, owner, web):
    title = "Renovated apartment " + "with views " * 20
    web.site("coast.example", html(f"<html><head><title>{title}</title></head><body><p>2 bed</p></body></html>"))

    field = fields(from_link(client))["title"]

    assert len(field["value"]) <= 120 and field["value"].endswith("views")
    assert field["source"] == "inferred"


# ---------------------------------------------------------------------------
# Text written to stall the rules
# ---------------------------------------------------------------------------
# Each of these took seconds to minutes before the rules stopped backtracking
# through long runs (a capitalised word, digits, spaces): the time grew with
# the square of the run, and nothing else in the process ran meanwhile.
LONG_RUN = 30_000


def answered_at_once(send):
    started = time.perf_counter()
    response = send()
    assert time.perf_counter() - started < 1.0
    return response


@pytest.mark.parametrize("text", ["A" * LONG_RUN, "1" * LONG_RUN, "$" + "1" * LONG_RUN],
                         ids=["capitals", "digits", "a dollar amount"])
def test_a_page_written_to_stall_the_text_rules_is_read_at_once(client, owner, web, text):
    web.site("coast.example", html(f"<html><head><title>{text}</title></head><body><h1>{text}</h1><p>{text}</p></body></html>"))

    refused(answered_at_once(lambda: from_link(client)), "not_a_listing", 422)


def test_a_number_padded_to_stall_its_reading_is_left_out_at_once(client, owner, web):
    padded = " " * LONG_RUN + "x"
    web.site("coast.example", html('<script type="application/ld+json">{"@type": "House", "name": "A house", '
                                   f'"numberOfBedrooms": "{padded}", "floorSize": "{padded}"}}</script>'))

    assert values(answered_at_once(lambda: from_link(client))) == {"title": "A house", "property_type": "House"}


def test_a_pdf_written_to_stall_the_text_rules_is_read_at_once(client, owner):
    response = answered_at_once(lambda: from_pdf(client, pdf_bytes(["A" * LONG_RUN])))

    refused(response, "not_a_listing", 422)


# Structured data whose nodes all point at one long node. The node was read again for each of them, and
# lists nest, so the 200 items a list is read to did not bound them (only the 2,000 nodes a page is read
# to did): a page under the size cap took seconds to minutes.
LONG_VALUE = 1_800_000


def offers(**offer) -> list:
    """1,990 offers, in nested lists of 199 as a page's @graph may hold them."""
    return [[{"@type": "Offer", **offer} for _ in range(199)] for _ in range(10)]


SHARED_NODES = {
    "an address": [{"@id": "#home", "address": "A" * LONG_VALUE}, offers(itemOffered="#home")],
    "a region": [{"@id": "#place", "@type": "PostalAddress", "addressRegion": "A" * LONG_VALUE}, offers(address="#place")],
    "a type": [{"@id": "#home", "@type": "A" * LONG_VALUE}, offers(itemOffered="#home")],
    "a list of types": [{"@id": "#home", "@type": [f"T{n}" for n in range(150_000)]}, offers(itemOffered="#home")],
    "a price unit": [{"@id": "#price", "price": 650, "unitText": "A" * LONG_VALUE}, offers(priceSpecification="#price")],
    "a padded price": [{"@id": "#price", "price": " " * LONG_VALUE + "650"}, offers(priceSpecification="#price")],
    "a lease unit": [{"@id": "#lease", "value": 12, "unitText": "A" * LONG_VALUE}, offers(leaseLength="#lease")],
}


def ld_page(data, kind: str) -> Reply:
    """data as a page's JSON-LD block, or as a JSON link's body."""
    text = json.dumps(data)
    if kind == "json":
        return Reply(body=text.encode(), headers={"Content-Type": "application/ld+json"})
    return html(f'<html><head><script type="application/ld+json">{text}</script></head><body></body></html>')


@pytest.mark.parametrize("kind", ["html", "json"])
@pytest.mark.parametrize("shared", SHARED_NODES)
def test_offers_that_share_one_long_node_are_read_at_once(client, owner, web, shared, kind):
    web.site("coast.example", ld_page({"@context": "https://schema.org", "@graph": SHARED_NODES[shared]}, kind))

    refused(answered_at_once(lambda: from_link(client)), "not_a_listing", 422)


@pytest.mark.parametrize("kind", ["html", "json"])
def test_a_long_amenity_listed_over_and_over_is_read_at_once(client, owner, web, kind):
    pool = {"@id": "#pool", "name": "A" * LONG_VALUE}
    web.site("coast.example", ld_page({"@graph": [pool, {"@type": "House", "amenityFeature": ["#pool"] * 20_000}]}, kind))

    assert values(answered_at_once(lambda: from_link(client))) == {"property_type": "House"}


def test_offers_that_share_a_home_and_a_price_read_as_one_offer_does(client, owner, web):
    home = {"@id": "#home", "@type": "House", "address": "12 Conie Ave, Baulkham Hills NSW 2153",
            "amenityFeature": ["#pool", "#pool", "Garden"]}
    price = {"@id": "#price", "price": 650, "priceCurrency": "AUD", "unitCode": "WEE"}
    pool = {"@id": "#pool", "name": "Pool"}
    graph = [home, price, pool, offers(itemOffered="#home", priceSpecification="#price")]
    web.site("coast.example", ld_page({"@graph": graph}, "html"))

    body = fields(answered_at_once(lambda: from_link(client)))

    assert {name: field["value"] for name, field in body.items() if field["source"] != "missing"} == {
        "address": "12 Conie Ave", "suburb": "Baulkham Hills", "state": "NSW", "postcode": "2153",
        "property_type": "House", "price": 650.0, "amenities": ["Pool", "Garden"],
    }
    assert body["price"]["evidence"] == "price: 650 AUD (WEE)"


def test_a_value_nested_past_the_recursion_limit_is_left_out_without_failing(client, owner, web):
    # JSON nests deeper than Python recurses: 1,200 QuantitativeValues, each the value of the next.
    deep = '{"value": ' * 1200 + "3" + "}" * 1200
    web.site("coast.example", html('<script type="application/ld+json">{"@type": "House", "name": "A house", '
                                   f'"numberOfBedrooms": {deep}, "floorSize": {deep}}}</script>'))

    assert values(from_link(client)) == {"title": "A house", "property_type": "House"}
    assert listing_import._number({"value": {"value": "650"}}) == 650


def test_evidence_nested_deeper_than_it_can_be_written_names_its_key_alone():
    deep: list = []
    for _ in range(20_000):
        deep = [deep]

    assert listing_import._ld_evidence("floorSize", deep) == "floorSize: …"


def test_a_street_number_and_a_suburb_are_still_read_whole():
    found: dict = {}

    listing_import._one_line_address("Unit 4/12 Kingfisher Lane, Mount Saint Thomas NSW 2500", found, "address", "text")

    assert {name: item.value for name, item in found.items()} == {
        "address": "Unit 4/12 Kingfisher Lane", "suburb": "Mount Saint Thomas", "state": "NSW", "postcode": "2500"}
    assert listing_import._number(" AUD 1,200.50 ") == 1200.5
    assert listing_import._number("$ 650 AUD") == 650


# ---------------------------------------------------------------------------
# A refusing site's sample (tracker assumption #7)
# ---------------------------------------------------------------------------
def test_the_sample_is_a_labelled_demo_of_the_same_fields(client, owner):
    detail = refused(from_link(client, "https://www.realestate.com.au/property-1"), "blocked", 422)

    sample = detail["sample"]
    assert sample == listing_import.sample_import()
    assert (sample["kind"], sample["demo"], sample["source_url"]) == ("sample", True, None)
    assert sample["fields"]["address"]["value"] == "1 Sample Street"
    assert sample["counts"] == {"found": 12, "inferred": 0, "missing": 4}


# ---------------------------------------------------------------------------
# PDFs
# ---------------------------------------------------------------------------
def test_a_pdf_fills_the_fields_its_text_states(client, owner):
    response = from_pdf(client, LISTING_PDF, name="Wilson St.pdf")

    body = fields(response)
    assert {name: (field["value"], field["source"]) for name, field in body.items() if field["source"] != "missing"} == {
        "title": ("Wilson St unit", "found"),
        "address": ("5/18 Wilson St", "inferred"), "suburb": ("Newtown", "inferred"),
        "state": ("NSW", "inferred"), "postcode": ("2042", "inferred"), "property_type": ("Unit", "inferred"),
        "bedrooms": (2, "found"), "bathrooms": (1, "found"), "price": (650.0, "found"), "bond": (2600.0, "found"),
        "available_from": ("2026-12-01", "found"), "pets_allowed": (True, "found"),
        "description": ("This light-filled unit has an open-plan living room, a renovated kitchen with gas cooking, "
                        "and a private balcony that looks over the park, close to cafes and the train.", "inferred"),
    }
    assert body["title"]["via"] == "pdf_metadata"
    assert body["bond"]["evidence"] == "Rent: $650 per week. Bond $2,600."
    assert (response.json()["kind"], response.json()["source_label"], response.json()["source_url"]) == (
        "pdf", "Wilson St.pdf", None)


def test_a_pdf_without_a_title_takes_its_first_line_as_a_guess(client, owner):
    response = from_pdf(client, pdf_bytes(["Modern Loft in Newtown", "2 bed, 1 bath, $720 per week"]))

    assert (fields(response)["title"]["value"], fields(response)["title"]["source"]) == ("Modern Loft in Newtown", "inferred")


def test_only_the_first_pages_of_a_long_pdf_are_read(client, owner, monkeypatch):
    monkeypatch.setattr(listing_import, "MAX_PDF_PAGES", 1)

    body = fields(from_pdf(client, pdf_bytes(["2 bed unit in Glebe"], ["Bond: $2,000"])))

    assert body["bedrooms"]["value"] == 2
    assert body["bond"]["source"] == "missing"


def test_a_pdf_with_a_password_cannot_be_read(client, owner):
    from io import BytesIO

    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter(clone_from=PdfReader(BytesIO(LISTING_PDF)))
    writer.encrypt(user_password="secret", algorithm="RC4-128")
    locked = BytesIO()
    writer.write(locked)

    detail = refused(from_pdf(client, locked.getvalue()), "unreadable_pdf", 422)

    assert "password" in detail["message"]


@pytest.mark.parametrize("data, code, status", [
    (pdf_bytes([]), "no_text", 422),
    (b"%PDF-1.4\n1 0 obj << /Type /Catalog >> broken", "unreadable_pdf", 422),
    (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "unsupported_content", 415),
    (b"<html><p>3 bed</p></html>", "unsupported_content", 415),
    (b"", "invalid_file", 422),
])
def test_a_file_that_is_not_a_readable_pdf_is_said_so(client, owner, data, code, status):
    refused(from_pdf(client, data), code, status)


def test_a_pdf_with_no_listing_in_it_is_said_so(client, owner):
    detail = refused(from_pdf(client, pdf_bytes(["Minutes of the strata meeting", "The meeting opened at 7pm."])),
                     "not_a_listing", 422)

    assert "in that PDF" in detail["message"]


def test_a_pdf_over_10_mb_is_refused_before_it_is_read(client, owner, monkeypatch):
    def unexpected(*_args, **_kwargs):
        raise AssertionError("an oversized form must not be parsed")

    monkeypatch.setattr("app.api.routes.listing_imports.MultiPartParser", unexpected)

    detail = refused(from_pdf(client, b"%PDF-1.4" + b"0" * (10 * 1024 * 1024 + 128 * 1024)), "too_large", 413)

    assert "larger than 10 MB" in detail["message"]


def test_a_pdf_just_over_10_mb_is_refused_when_read(client, owner):
    detail = refused(from_pdf(client, b"%PDF-1.4" + b"0" * (10 * 1024 * 1024)), "too_large", 413)

    assert "larger than 10 MB" in detail["message"]


def test_a_body_that_runs_past_the_limit_is_cut_off(client, owner, monkeypatch):
    from app.api.routes import listing_imports

    monkeypatch.setattr(listing_imports, "MAX_FORM_BYTES", 2000)

    def chunks():
        boundary = b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"l.pdf\"\r\n" \
                   b"Content-Type: application/pdf\r\n\r\n"
        yield boundary
        for _ in range(10):
            yield b"0" * 500

    # A streamed body has no Content-Length: the limit is counted as it arrives.
    response = client.post(f"{API}/pdf", content=chunks(), headers={"Content-Type": "multipart/form-data; boundary=b"})

    refused(response, "too_large", 413)


@pytest.mark.parametrize("kwargs", [
    {"json": {"file": "listing.pdf"}},
    {"data": {"use_ai": "true"}},
    {"files": {"document": ("l.pdf", LISTING_PDF, "application/pdf")}},
])
def test_a_pdf_import_needs_a_file(client, owner, kwargs):
    refused(client.post(f"{API}/pdf", **kwargs), "invalid_file", 422)


def test_the_file_name_shown_is_its_own_name_only(client, owner):
    response = from_pdf(client, LISTING_PDF, name="../../etc/Wilson St.pdf")

    assert response.json()["source_label"] == "Wilson St.pdf"
    assert listing_import._file_label("C:\\Users\\olly\\Wil\x07son.pdf") == "Wilson.pdf"
    assert listing_import._file_label(None) == "Listing PDF"


# ---------------------------------------------------------------------------
# The model (paid AI)
# ---------------------------------------------------------------------------
PROSE = """<html><head><title>Garden cottage</title></head><body>
<p>Charming garden cottage with three generous bedrooms and two renovated bathrooms, a north-facing deck and a fireplace.</p>
<p>The rent is six hundred dollars weekly and the bond is $2,400. A 12 month lease is offered.</p>
<p>Ready to move in on 1 February 2027. Located at 9 Rose Lane, Paddington.</p>
</body></html>"""


def enable_model(monkeypatch, answer):
    """A configured key and a stub model answering `answer` (a dict, or a function of the payload)."""
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []

    def call(payload):
        calls.append(copy.deepcopy(payload))
        if isinstance(answer, Exception):
            raise answer
        return answer(payload) if callable(answer) else answer

    monkeypatch.setattr(listing_import, "call_model", call)
    return calls


def test_the_model_is_never_asked_unless_the_owner_asks(client, owner, web, monkeypatch):
    calls = enable_model(monkeypatch, {"fields": {}})
    web.site("coast.example", html(PROSE))

    response = from_link(client)

    assert calls == []
    assert (response.json()["ai_status"], response.json()["message"]) == ("not_requested", None)


def test_without_a_key_the_rules_answer_and_say_so(client, owner, web):
    web.site("coast.example", html(PROSE))

    response = from_link(client, use_ai=True)

    assert response.json()["ai_status"] == "not_configured"
    assert "isn't connected" in response.json()["message"]


@pytest.mark.parametrize("verification, status", [("PENDING", "pending"), ("REJECTED", "rejected")])
def test_an_unverified_owner_gets_the_rule_result_and_the_model_is_never_asked(
    client, strict_schema, as_profile, web, monkeypatch, verification, status,
):
    calls = enable_model(monkeypatch, {"fields": {"bathrooms": {"value": 2, "evidence": "two renovated bathrooms"}}})
    strict_schema.seed("users", [users_row(OWNER, "olly@example.test", "LANDLORD", verification_status=verification)])
    as_profile(id=OWNER, role="landlord")
    web.site("coast.example", html(PROSE))

    response = from_link(client, use_ai=True)

    assert calls == []
    body = response.json()
    assert body["ai_status"] == "verification_required"
    assert (body["verification"]["code"], body["verification"]["action"], body["verification"]["status"],
            body["verification"]["documents_href"]) == ("verification_required", "paid_ai", status,
                                                         "/owner/profile/verification")
    assert body["fields"]["bathrooms"]["source"] == "missing"
    assert body["fields"]["bond"]["value"] == 2400.0


def test_a_verified_owner_gets_the_fields_the_model_reads_from_the_text_marked_inferred(client, owner, web, monkeypatch):
    calls = enable_model(monkeypatch, {"fields": {
        "bedrooms": {"value": 3, "evidence": "three generous bedrooms"},
        "bathrooms": {"value": "2", "evidence": "two renovated bathrooms"},
        "available_from": {"value": "2027-02-01", "evidence": "Ready to move in on 1 February 2027"},
        "address": {"value": "9 Rose Lane", "evidence": "Located at 9 Rose Lane, Paddington"},
        "suburb": {"value": "Paddington", "evidence": "9 Rose Lane, Paddington"},
        "amenities": {"value": ["north-facing deck", "fireplace", "swimming pool"], "evidence": "a north-facing deck and a fireplace"},
    }})
    web.site("coast.example", html(PROSE))

    body = from_link(client, use_ai=True).json()

    [payload] = calls
    assert "three generous bedrooms" in payload["text"]
    # Asked only for what the rules left missing: the bond and the lease were found.
    assert "bond" not in payload["fields"] and "lease_term" not in payload["fields"] and "title" not in payload["fields"]
    assert set(payload["fields"]) == {name for name, field in body["fields"].items()
                                      if field["via"] in ("ai", None)}
    assert {name: (field["value"], field["source"], field["via"]) for name, field in body["fields"].items()
            if field["via"] == "ai"} == {
        "bedrooms": (3, "inferred", "ai"), "bathrooms": (2, "inferred", "ai"),
        "available_from": ("2027-02-01", "inferred", "ai"), "address": ("9 Rose Lane", "inferred", "ai"),
        "suburb": ("Paddington", "inferred", "ai"), "amenities": (["north-facing deck", "fireplace"], "inferred", "ai"),
    }
    assert body["fields"]["bedrooms"]["evidence"] == "three generous bedrooms"
    assert body["fields"]["bond"] == {"value": 2400.0, "source": "found", "evidence": "The rent is six hundred dollars weekly and the bond is $2,400. A 12 month lease is offered.", "via": "text"}
    assert (body["ai_status"], body["message"]) == ("applied", "AI read the listing too and filled 6 more details, each marked inferred.")


@pytest.mark.parametrize("name, value, evidence", [
    ("bedrooms", 4, "three generous bedrooms"),              # the quote says another number
    ("bedrooms", "many", "three generous bedrooms"),         # not the field's kind
    ("bedrooms", True, "three generous bedrooms"),
    ("bathrooms", 2, "two luxurious bathrooms"),             # a quote that is not in the text
    ("price", 600, "six hundred dollars weekly"),            # no number to check it against
    ("price", 600, "the bond is $2,400"),                     # a conversion the text does not state
    ("description", "A lovely cottage in a leafy street.", "Charming garden cottage"),  # written, not copied
    ("available_from", "2027-03-01", "Ready to move in on 1 February 2027"),
    ("state", "VIC", "Paddington"),
    ("postcode", "2021", "Paddington"),
    ("property_type", "Villa", "garden cottage"),
    ("pets_allowed", True, "a fireplace"),
    ("floor_area", 120, "a north-facing deck"),
    ("lease_term", "6 months", "A 12 month lease is offered"),
])
def test_a_model_value_the_text_does_not_state_is_dropped(client, owner, web, monkeypatch, name, value, evidence):
    enable_model(monkeypatch, {"fields": {name: {"value": value, "evidence": evidence}}})
    web.site("coast.example", html(PROSE))

    body = from_link(client, use_ai=True).json()

    assert body["fields"][name]["via"] != "ai"
    assert (body["ai_status"], body["message"]) == ("applied", "AI read the listing too and found nothing more it states.")


@pytest.mark.parametrize("name, value, quote, kept", [
    ("pets_allowed", True, "pets: not permitted", None),
    ("pets_allowed", False, "pets: not permitted", False),
    ("pets_allowed", True, "pets are welcome", True),
    ("pets_allowed", True, "a fireplace and a pet door", None),
    ("property_type", "Unit", "a community garden", None),
    ("property_type", "House", "a warehouse conversion", None),
    ("property_type", "House", "a house with a garden", "House"),
    ("property_type", "Apartment", "a sunny flat by the park", "Apartment"),
    ("state", "VIC", "a victorian terrace", None),
    ("state", "VIC", "melbourne, victoria", "VIC"),
    ("state", "NSW", "glebe nsw 2037", "NSW"),
    ("state", "VIC", "Richmond Vic 3121", "VIC"),
    # Codes that are words too count only in capitals.
    ("state", "ACT", "leased under the Residential Tenancies Act 2010", None),
    ("state", "ACT", "Braddon ACT 2612", "ACT"),
    ("state", "SA", "Norwood SA 5067", "SA"),
])
def test_the_model_keeps_a_value_only_where_its_quote_states_it(name, value, quote, kept):
    # quote is as the text writes it.
    assert listing_import._ai_value(name, value, listing_import._normal(quote), quote) == kept


@pytest.mark.parametrize("evidence", ["Residential Tenancies Act 2010", "Residential Tenancies ACT 2010"])
def test_a_law_named_an_act_is_never_read_as_the_act(client, owner, web, monkeypatch, evidence):
    enable_model(monkeypatch, {"fields": {"state": {"value": "ACT", "evidence": evidence}}})
    web.site("coast.example", html(PROSE.replace("A 12 month lease is offered.",
                                                 "A 12 month lease under the Residential Tenancies Act 2010.")))

    body = from_link(client, use_ai=True).json()

    assert body["fields"]["state"] == {"value": None, "source": "missing", "evidence": None, "via": None}


@pytest.mark.parametrize("value, quote, kept", [
    (650, "rent: $650 a week", True),
    (650, "650 dollars weekly", True),
    (2600, "$2,600 per month", False),
    (600, "$2,600 per month, about $600 a week", False),
    (650, "$1,300 per fortnight", False),
    (650, "$650", False),
])
def test_the_model_gives_a_weekly_rent_only_from_a_quote_that_states_one(value, quote, kept):
    assert listing_import._ai_value("price", value, quote, quote) == (float(value) if kept else None)


@pytest.mark.parametrize("answer", [
    {"fields": {"parking": {"value": 1, "evidence": "a north-facing deck"}}},
    {"fields": {"bedrooms": {"value": 3, "evidence": "three generous bedrooms", "confidence": 0.9}}},
    {"fields": {"bedrooms": {"value": 3}}},
    {"fields": [], "note": "done"},
    {"listing": {"bedrooms": 3}},
    ["bedrooms", 3],
])
def test_an_answer_outside_the_field_schema_is_refused_whole(client, owner, web, monkeypatch, answer):
    enable_model(monkeypatch, answer)
    web.site("coast.example", html(PROSE))

    body = from_link(client, use_ai=True).json()

    assert body["ai_status"] == "unavailable"
    assert all(field["via"] != "ai" for field in body["fields"].values())
    assert body["fields"]["bond"]["value"] == 2400.0


def test_a_field_the_rules_found_is_never_replaced_by_the_model(client, owner, web, monkeypatch):
    enable_model(monkeypatch, {"fields": {"bond": {"value": 2400, "evidence": "the bond is $2,400"},
                                          "title": {"value": "Garden cottage", "evidence": "Garden cottage"}}})
    web.site("coast.example", html(PROSE))

    body = from_link(client, use_ai=True).json()

    assert (body["fields"]["bond"]["via"], body["fields"]["title"]["via"]) == ("text", "page_meta")


@pytest.mark.parametrize("failure", [httpx.ConnectError("down"), httpx.ReadTimeout("slow"), ValueError("Incomplete model response")])
def test_a_model_failure_keeps_the_rule_result(client, owner, web, monkeypatch, failure):
    enable_model(monkeypatch, failure)
    web.site("coast.example", html(PROSE))

    response = from_link(client, use_ai=True)

    assert response.status_code == 200
    assert response.json()["ai_status"] == "unavailable"
    assert response.json()["fields"]["bond"]["value"] == 2400.0


def test_a_listing_found_whole_does_not_ask_the_model(client, owner, web, monkeypatch):
    calls = enable_model(monkeypatch, {"fields": {}})
    web.site("coast.example", html(APARTMENT))

    assert from_link(client, use_ai=True).json()["ai_status"] == "not_needed"
    assert calls == []


def test_one_model_reading_per_owner_at_a_time(client, owner, web, monkeypatch):
    calls = enable_model(monkeypatch, {"fields": {}})
    web.site("coast.example", html(PROSE))

    assert from_link(client, use_ai=True).json()["ai_status"] == "applied"
    assert from_link(client, use_ai=True).json()["ai_status"] == "cooldown"
    assert len(calls) == 1


def test_the_model_may_find_a_listing_the_rules_could_not(client, owner, web, monkeypatch):
    enable_model(monkeypatch, {"fields": {"bedrooms": {"value": 3, "evidence": "three cosy bedrooms"}}})
    web.site("coast.example", html("<html><head><title>Cottage</title></head><body>"
                                   "<p>A cottage with three cosy bedrooms near the park.</p></body></html>"))

    response = from_link(client, use_ai=True)

    assert response.status_code == 200
    assert response.json()["fields"]["bedrooms"]["value"] == 3


def test_the_model_is_sent_a_bounded_part_of_the_text(client, owner, web, monkeypatch):
    calls = enable_model(monkeypatch, {"fields": {}})
    web.site("coast.example", html(PROSE.replace("</body>", "<p>" + "Lorem ipsum dolor sit amet. " * 3000 + "</p></body>")))

    from_link(client, use_ai=True)

    assert len(calls[0]["text"].encode("utf-8")) <= listing_import.MODEL_TEXT_BYTES


def test_a_pdf_import_asks_the_model_the_same_way(client, owner, monkeypatch):
    calls = enable_model(monkeypatch, {"fields": {"lease_term": {"value": "12 months", "evidence": "12 month lease"}}})

    response = from_pdf(client, pdf_bytes(["2 bed unit in Glebe", "Bond: $2,000. 12 month lease."]), use_ai=True)

    assert calls and response.json()["ai_status"] == "applied"
    assert response.json()["fields"]["lease_term"]["source"] == "found"


# ---------------------------------------------------------------------------
# Nothing is saved
# ---------------------------------------------------------------------------
@pytest.fixture
def writes(monkeypatch) -> list[tuple[str, str]]:
    """Every insert, update and delete any query runs, as (schema.table, op)."""
    seen: list[tuple[str, str]] = []
    execute = fake_supabase.FakeTableQuery.execute

    def recording(query):
        if query._op != "select":
            seen.append((f"{query._schema}.{query._name}", query._op))
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", recording)
    return seen


@pytest.mark.parametrize("request_import", [
    lambda client: from_link(client),
    lambda client: from_link(client, "https://www.domain.com.au/listing-1"),
    lambda client: from_link(client, "http://127.0.0.1/"),
    lambda client: from_pdf(client, LISTING_PDF),
    lambda client: from_pdf(client, b"not a pdf"),
    lambda client: from_link(client, use_ai=True),
])
def test_an_import_writes_nothing_anywhere(client, owner, strict_schema, web, writes, monkeypatch, request_import):
    enable_model(monkeypatch, {"fields": {}})
    web.site("coast.example", html(PROSE))
    before = copy.deepcopy(strict_schema.schema_tables)

    request_import(client)

    assert writes == []
    assert strict_schema.schema_tables == before
    assert strict_schema.storage.objects == {} and strict_schema.rpc_calls == []


def test_the_audit_trail_records_only_that_an_import_was_asked_for(client, strict_schema, web, writes):
    web.site("coast.example", html(APARTMENT))
    token = account(strict_schema, OWNER, "olly@example.test", "LANDLORD")

    response = client.post(f"{API}/url", json={"url": "https://coast.example/listings/1?owner=olly"},
                           headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert writes == [("web.audit_log", "insert")]
    [entry] = strict_schema.schema_tables["web"]["audit_log"]
    assert entry["metadata"] == {"method": "POST", "path": "/api/v1/me/listing-imports/url", "status": 200}
    assert "coast.example" not in str(entry) and "Harbour" not in str(entry)
