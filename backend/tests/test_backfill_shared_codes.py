"""scripts/backfill_shared_codes.py: rows the web wrote before the shared codes get them.

A provider the old web saved with service_categories ['tradie'] is never
listed by mobile_repair_providers, and a repair saved as 'heating_cooling'
finds no provider at all. The script lists what it would change, writes
only with --apply, and a second run finds nothing.
"""

import pytest

from scripts import backfill_shared_codes as backfill
from tests.factories_repairs import OWNER, PLUMBER, REPAIR, REQUEST, TENANT, seed_repair, seed_world, sign_in

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/maintenance"
OLD_TRADIE = "a6000000-0000-4000-8000-000000000011"
OLD_CLEANER = "a6000000-0000-4000-8000-000000000012"
NEW_PROVIDER = "a6000000-0000-4000-8000-000000000013"
NOW = "2026-01-01T00:00:00+00:00"


def _provider(db, user_id, name, codes, **meta):
    db.seed("users", [{"id": user_id, "email": f"{user_id}@example.test", "full_name": name,
                       "primary_role": "SERVICE_PROVIDER", "status": "ACTIVE", "verification_status": "APPROVED",
                       "updated_at": NOW}])
    db.seed("service_provider_profiles", [{"user_id": user_id, "company_name": name, "service_categories": codes,
                                           "verification_status": "APPROVED", "metadata": meta,
                                           "updated_at": NOW}])


@pytest.fixture
def world(strict_schema):
    seed_world(strict_schema)
    _provider(strict_schema, OLD_TRADIE, "Old Trades", ["tradie"])
    _provider(strict_schema, OLD_CLEANER, "Old Cleans", ["cleaner"], category="cleaner", is_published=True)
    _provider(strict_schema, NEW_PROVIDER, "New Plumbing", ["PLUMBING", "GENERAL"], category="tradie")
    return strict_schema


def _profile(db, user_id) -> dict:
    return next(row for row in db.tables["service_provider_profiles"] if row["user_id"] == user_id)


@pytest.mark.parametrize("stored, code", [
    ("heating_cooling", "HVAC"), ("plumbing", "PLUMBING"), ("structural", "GENERAL"), ("pest", "GENERAL"),
    ("grounds", "GENERAL"), ("other", "GENERAL"), ("LEAK", "LEAK"), (None, "GENERAL"),
])
def test_an_old_repair_category_reads_as_a_shared_code(stored, code):
    assert backfill.repair_code(stored) == code


def test_the_plan_lists_old_providers_and_repairs_and_writes_nothing(world):
    seed_repair(world, category="heating_cooling")
    # A complaint with no work order is not a repair: its category stays.
    world.seed("complaints", [{"id": "c6000000-0000-4000-8000-000000000099", "reporter_user_id": TENANT,
                               "category": "safety", "description": "The stairs are loose.", "lodged_at": NOW}])

    providers, repairs = backfill.plan()

    assert {change["user_id"]: change["service_categories"] for change in providers} == {
        OLD_TRADIE: list(backfill.REPAIR_CATEGORIES), OLD_CLEANER: ["GENERAL"],
    }
    assert {change["user_id"]: change["metadata"]["category"] for change in providers} == {
        OLD_TRADIE: "tradie", OLD_CLEANER: "cleaner",
    }
    assert repairs == [{"id": REPAIR, "category": "HVAC"}]
    assert _profile(world, OLD_TRADIE)["service_categories"] == ["tradie"]


def test_applying_makes_the_old_provider_and_repair_assignable(client, world, as_profile, capsys):
    seed_repair(world, category="plumbing")
    sign_in(as_profile, world, OWNER)
    # Before: the old tradie is not listed for the repair.
    assert OLD_TRADIE not in {row["id"] for row in client.get(f"{API}/{REQUEST}/providers").json()}

    assert backfill.main(["--apply"]) == 0

    assert _profile(world, OLD_TRADIE)["service_categories"] == list(backfill.REPAIR_CATEGORIES)
    assert _profile(world, OLD_TRADIE)["metadata"] == {"category": "tradie"}
    assert _profile(world, OLD_CLEANER)["metadata"] == {"category": "cleaner", "is_published": True}
    assert _profile(world, NEW_PROVIDER)["service_categories"] == ["PLUMBING", "GENERAL"]
    assert next(row for row in world.tables["complaints"] if row["id"] == REPAIR)["category"] == "PLUMBING"
    listed = {row["id"] for row in client.get(f"{API}/{REQUEST}/providers").json()}
    assert {OLD_TRADIE, PLUMBER} <= listed
    assigned = client.post(f"{API}/{REQUEST}/assign", json={"provider_id": OLD_TRADIE})
    assert assigned.status_code == 200, assigned.text
    assert "to change: 2 provider(s), 1 repair(s)" in capsys.readouterr().out
    # A second run finds nothing.
    assert backfill.plan() == ([], [])


def test_without_apply_nothing_is_written(world, capsys):
    seed_repair(world, category="other")

    assert backfill.main([]) == 0

    assert _profile(world, OLD_TRADIE)["service_categories"] == ["tradie"]
    assert next(row for row in world.tables["complaints"] if row["id"] == REPAIR)["category"] == "other"
    assert "nothing written" in capsys.readouterr().out
