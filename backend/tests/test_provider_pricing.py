"""How a service is priced (tracker assumption #10): a fixed price, an hourly rate or a "from" price.

mobile_provider_services.pricing_type is free text that both apps write.
The web writes flat, hourly and from, and reads the other spellings as one
of them, so the service form, the marketplace card and the provider's pages
always show the price on the same terms. An unknown value reads as a "from"
price, which never promises less than the provider may charge.
"""

import pytest

from app.services.maps_provider_core import PRICING_TYPES, web_pricing_type
from tests.factories_provider_core import category_row, jwt_for, seed_provider, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER = "a4000000-0000-4000-8000-000000000001"
API = "/api/v1"


def _service(name: str) -> str:
    return f"a4000000-0000-4000-8000-0000000000{name}"


@pytest.mark.parametrize("stored, read", [
    ("flat", "flat"), ("FLAT", "flat"), ("fixed", "flat"), ("Fixed price", "flat"), ("", "flat"), (None, "flat"),
    ("hourly", "hourly"), ("HOURLY", "hourly"), ("per hour", "hourly"), ("per-hour", "hourly"), ("Hourly rate", "hourly"),
    ("from", "from"), ("FROM", "from"), ("starting from", "from"), ("starting_at", "from"),
    ("quote", "from"), ("per_sqm", "from"),
])
def test_any_stored_pricing_type_reads_as_one_of_the_three(stored, read):
    assert web_pricing_type(stored) == read
    assert read in PRICING_TYPES


@pytest.fixture
def market(strict_schema):
    strict_schema.seed("service_categories", [category_row("cleaner")], schema="web")
    seed_provider(strict_schema, PROVIDER, "Nina New", business_name="Nina Cleans", slug="nina-cleans",
                  category="cleaner")
    return strict_schema


def _spelled(db, spellings: dict) -> None:
    """mobile_provider_services_pricing_type_check allows flat, hourly and from alone; a spelling from before
    it is put on the stored row after a seed the CHECK accepts."""
    for row in db.tables["mobile_provider_services"]:
        row["pricing_type"] = spellings.get(row["id"], row["pricing_type"])


def test_a_mobile_pricing_type_reads_the_same_on_every_page(client, market, as_profile):
    market.seed("mobile_provider_services", [
        service_row(_service("01"), PROVIDER, title="Window clean", price=60, pricing_type="hourly",
                    created_at="2026-01-01T00:00:00+00:00"),
        service_row(_service("02"), PROVIDER, title="Bond clean", price=320, pricing_type="flat",
                    created_at="2026-01-02T00:00:00+00:00"),
        service_row(_service("03"), PROVIDER, title="Carpet clean", price=150, pricing_type="from",
                    created_at="2026-01-03T00:00:00+00:00"),
    ])
    _spelled(market, {_service("01"): "Per Hour", _service("02"): "FIXED", _service("03"): "quote"})
    as_profile(id=PROVIDER, role="service_provider")

    mine = client.get(f"{API}/me/services").json()
    public = client.get(f"{API}/providers/nina-cleans/services").json()
    [card] = client.get(f"{API}/providers").json()

    expected = [("Window clean", "hourly"), ("Bond clean", "flat"), ("Carpet clean", "from")]
    assert [(service["title"], service["pricing_type"]) for service in mine] == expected
    assert [(service["title"], service["pricing_type"]) for service in public] == expected
    # The card's "from" price is the cheapest service, on its own terms.
    assert (card["from_price"], card["price_unit"]) == (60, "per hour")


def test_the_web_writes_only_the_three_pricing_types(client, market, as_profile):
    as_profile(id=PROVIDER, role="service_provider", access_token=jwt_for(market, PROVIDER))
    oven = {"title": "Oven clean", "price": 90, "description": "Racks and glass."}

    created = client.post(f"{API}/me/services", json={**oven, "pricing_type": "from"})
    refused = client.post(f"{API}/me/services", json={**oven, "pricing_type": "fixed"})

    assert created.status_code == 201, created.text
    assert created.json()["pricing_type"] == "from"
    [row] = market.tables["mobile_provider_services"]
    assert row["pricing_type"] == "from"
    assert refused.status_code == 422


def test_saving_a_mobile_service_on_the_web_stores_the_type_it_shows(client, market, as_profile):
    market.seed("mobile_provider_services", [service_row(_service("04"), PROVIDER, pricing_type="hourly")])
    _spelled(market, {_service("04"): "Hourly rate"})
    as_profile(id=PROVIDER, role="service_provider", access_token=jwt_for(market, PROVIDER))

    shown = client.get(f"{API}/me/services").json()[0]["pricing_type"]
    saved = client.patch(f"{API}/me/services/{_service('04')}", json={"pricing_type": shown, "price": 75})

    assert saved.status_code == 200, saved.text
    assert market.tables["mobile_provider_services"][0]["pricing_type"] == "hourly"


def test_a_fixed_price_card_says_fixed(client, market):
    market.seed("mobile_provider_services", [service_row(_service("05"), PROVIDER, price=99, pricing_type="flat")])

    [card] = client.get(f"{API}/providers").json()

    assert (card["from_price"], card["price_unit"]) == (99, "fixed")
