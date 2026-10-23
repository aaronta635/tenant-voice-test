"""Give rows the web wrote before the shared codes those codes; dry-run by default.

Run from backend: .venv/bin/python -m scripts.backfill_shared_codes [--apply]

Before the shared contract, the web wrote a provider's web category into
service_provider_profiles.service_categories (['tradie']) and a repair's
category in its own lower-case words ('heating_cooling', 'other'). The shared
functions read only the eight repair codes there, so mobile_repair_providers
never lists such a provider, assign_maintenance_work_order refuses them, and
such a repair finds no provider at all (docs/shared-db.md, "Services and
categories" and "Repairs").

- A provider's service_categories become the codes of its web category
  (maps_provider_core.category_codes), the label read from
  metadata.category or else from the old value, which metadata.category
  then keeps.
- A repair's complaints.category (a complaint with a work order) that is not
  one of the codes becomes the one it reads as (repair_code).

Nothing is written without --apply; a second run finds nothing to change.
"""

import argparse

from app.core.supabase import get_supabase_client
from app.services import _common
from app.services.maps_provider_core import (
    GENERAL_CATEGORY,
    REPAIR_CATEGORIES,
    WEB_CATEGORIES,
    WEB_CATEGORY_KEY,
    category_codes,
)
from app.services.shared_map import stamp_update

PROVIDERS = "service_provider_profiles"
COMPLAINTS = "complaints"
WORK_ORDERS = "maintenance_work_orders"
# The web's repair categories before the codes, as the codes the mobile app has for them;
# any other word reads as GENERAL, as maps_provider_core.repair_category shows it.
OLD_REPAIR_WORDS = {"heating_cooling": "HVAC", "heating": "HVAC", "cooling": "HVAC", "locks": "LOCKS_SECURITY",
                    "security": "LOCKS_SECURITY", "leak": "LEAK"}


def repair_code(value) -> str:
    """The shared repair code a stored category reads as."""
    word = value.strip() if isinstance(value, str) else ""
    if word.upper() in REPAIR_CATEGORIES:
        return word.upper()
    return OLD_REPAIR_WORDS.get(word.lower(), GENERAL_CATEGORY)


def _web_label(row: dict) -> str | None:
    """The provider's web category: metadata.category, else a web category in the old service_categories."""
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    label = meta.get(WEB_CATEGORY_KEY)
    if isinstance(label, str) and label.strip().lower() in WEB_CATEGORIES:
        return label.strip().lower()
    codes = row.get("service_categories") if isinstance(row.get("service_categories"), list) else []
    return next((code.strip().lower() for code in codes
                 if isinstance(code, str) and code.strip().lower() in WEB_CATEGORIES), None)


def provider_changes(rows: list[dict]) -> list[dict]:
    """{user_id, service_categories, metadata} for each provider whose codes are not all shared ones."""
    changes = []
    for row in rows:
        codes = row.get("service_categories") if isinstance(row.get("service_categories"), list) else []
        if all(isinstance(code, str) and code in REPAIR_CATEGORIES for code in codes):
            continue
        label = _web_label(row)
        meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        new_codes = category_codes(label) if label else sorted(
            {repair_code(code) for code in codes if isinstance(code, str)} or {GENERAL_CATEGORY}
        )
        changes.append({
            "user_id": row["user_id"],
            "service_categories": new_codes,
            "metadata": {**meta, WEB_CATEGORY_KEY: label} if label else meta,
        })
    return changes


def repair_changes(complaints: list[dict]) -> list[dict]:
    """{id, category} for each repair whose category is not one of the codes."""
    return [{"id": row["id"], "category": repair_code(row.get("category"))}
            for row in complaints if row.get("category") not in REPAIR_CATEGORIES]


def plan() -> tuple[list[dict], list[dict]]:
    """What --apply would write: (provider changes, repair changes)."""
    supabase = get_supabase_client()
    providers = _common.select_all(
        lambda: supabase.table(PROVIDERS).select("user_id, service_categories, metadata").order("user_id")
    )
    orders = _common.select_all(lambda: supabase.table(WORK_ORDERS).select("complaint_id").order("id"))
    complaint_ids = sorted({row["complaint_id"] for row in orders if row.get("complaint_id")})
    complaints = _common.select_in(
        lambda: supabase.table(COMPLAINTS).select("id, category").order("id"), "id", complaint_ids
    )
    return provider_changes(providers), repair_changes(complaints)


def apply(providers: list[dict], repairs: list[dict]) -> None:
    supabase = get_supabase_client()
    for change in providers:
        update = {"service_categories": change["service_categories"], "metadata": change["metadata"]}
        supabase.table(PROVIDERS).update(stamp_update(PROVIDERS, update)).eq("user_id", change["user_id"]).execute()
    for change in repairs:
        supabase.table(COMPLAINTS).update(stamp_update(COMPLAINTS, {"category": change["category"]})).eq(
            "id", change["id"]
        ).execute()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="write the changes (default: list them)")
    args = parser.parse_args(argv)
    providers, repairs = plan()
    for change in providers:
        print(f"provider {change['user_id']}: service_categories -> {change['service_categories']}")
    for change in repairs:
        print(f"repair {change['id']}: category -> {change['category']}")
    print(f"to change: {len(providers)} provider(s), {len(repairs)} repair(s)")
    if args.apply:
        apply(providers, repairs)
        print("written")
    else:
        print("nothing written: run again with --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
