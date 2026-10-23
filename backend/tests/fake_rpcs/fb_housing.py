"""The Housing Portal's functions (tracker R41), from output/shared-catalog/functions (2026-10-23).

- mobile_require_housing_officer(): the caller's users.id when they are an
  ACTIVE, undeleted REGULATOR or ADMIN, else 42501;
- mobile_housing_red_flag_referrals(): every referral package joined to its
  alert and the alert's category, as a jsonb list;
- mobile_housing_update_referral(p_referral_id, p_action, p_note): moves one
  package and logs it through mobile_admin_log_action.
"""

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error

PACKAGES = "mobile_admin_referral_packages"
# The functions' "case r.status when ... else 'Closed' end".
LABELS = {"REFERRED": "New", "UNDER_REVIEW": "Under review", "PACKAGE_READY": "Package ready"}
# The order by: status, then CRITICAL first, then the newest referral.
STATUS_RANK = {"REFERRED": 0, "UNDER_REVIEW": 1, "PACKAGE_READY": 2}
ACTIONS = {"START_REVIEW": "UNDER_REVIEW", "PREPARE_PACKAGE": "PACKAGE_READY", "CLOSE": "CLOSED"}


def require_housing_officer(ctx) -> str:
    """mobile_require_housing_officer's check: current_app_user_id() and its role."""
    caller = ctx.caller  # current_app_user_id(): ACTIVE, undeleted, auth_user_id = auth.uid()
    if caller is None or caller.get("primary_role") not in ("REGULATOR", "ADMIN") \
            or caller.get("status") != "ACTIVE" or caller.get("deleted_at") is not None:
        raise api_error("42501", "Housing Portal access is required.")
    return caller["id"]


def _label(package_status: str) -> str:
    return LABELS.get(package_status, "Closed")


def _text(value):
    """jsonb ->> key: a string as it is, any other value as its JSON text, a missing key as null."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _field(document, *path):
    """document -> path[0] -> ... ->> path[-1], null wherever a step is not an object."""
    for key in path[:-1]:
        document = document.get(key) if isinstance(document, dict) else None
    return _text(document.get(path[-1])) if isinstance(document, dict) else None


def _clip_note(note) -> str | None:
    """nullif(left(trim(coalesce(p_note, '')), 500), '')."""
    clipped = (note or "").strip(" ")[:500]
    return clipped or None


@rpc("mobile_require_housing_officer")
def mobile_require_housing_officer(ctx, params):
    return require_housing_officer(ctx)


@rpc("mobile_housing_red_flag_referrals")
def mobile_housing_red_flag_referrals(ctx, params):
    require_housing_officer(ctx)
    alerts = {row["id"]: row for row in ctx.rows("mobile_admin_alerts")}
    categories = {row["id"]: row for row in ctx.rows("mobile_admin_issue_categories")}
    items = []
    for package in ctx.rows(PACKAGES):
        alert = alerts.get(package["alert_id"])
        if alert is None:  # join public.mobile_admin_alerts
            continue
        category = categories.get(alert.get("category_id"))  # left join the category
        prepared = package.get("prepared_snapshot")
        items.append((package, alert, {
            "id": package["id"],
            "alertId": package["alert_id"],
            "complaintId": package["complaint_id"],
            "caseReference": _field(prepared, "caseReference"),
            "severity": (alert.get("severity") or "").lower(),
            "status": _label(package["status"]),
            "packageStatus": package["status"],
            "title": alert.get("title"),
            "reason": alert.get("reason"),
            "area": _field(prepared, "property", "area") or _field(alert.get("metadata"), "area"),
            "address": _field(prepared, "property", "address"),
            "category": (category or {}).get("name") or "Complaint",
            "assignedTeam": package.get("assigned_team"),
            "adminNote": package.get("admin_note"),
            "regulatorNote": package.get("regulator_note"),
            "preparedSnapshot": prepared,
            "evidenceSnapshot": package.get("evidence_snapshot"),
            "referredAt": package.get("referred_at"),
            "updatedAt": package.get("updated_at"),
        }))
    items.sort(key=lambda item: item[0].get("referred_at") or "", reverse=True)
    items.sort(key=lambda item: (STATUS_RANK.get(item[0]["status"], 3), 0 if item[1].get("severity") == "CRITICAL" else 1))
    return [item for _, _, item in items]


@rpc("mobile_housing_update_referral")
def mobile_housing_update_referral(ctx, params):
    officer = require_housing_officer(ctx)
    action = (params.get("p_action") or "").strip(" ").upper()
    new_status = ACTIONS.get(action)
    if new_status is None:
        raise api_error("22023", "Choose a valid referral action.")
    found = [row for row in ctx.rows(PACKAGES) if row["id"] == params["p_referral_id"]]
    if not found:
        raise api_error("P0002", "Referral package not found.")
    now = ctx.now()
    row = ctx.table(PACKAGES).update({
        "status": new_status,
        "reviewed_by": officer,
        "reviewed_at": found[0].get("reviewed_at") or now,
        "regulator_note": _clip_note(params.get("p_note")) or found[0].get("regulator_note"),
        "updated_at": now,
    }).eq("id", params["p_referral_id"]).execute().data[0]
    # mobile_admin_log_action(v_officer, 'HOUSING_REFERRAL_' || v_action, 'referral_package', v_row.id, ...)
    ctx.table("mobile_admin_audit_entries").insert({
        "actor_user_id": officer,
        "action": f"HOUSING_REFERRAL_{action}"[:80],
        "entity_type": "referral_package",
        "entity_id": row["id"],
        "summary": f"Housing Portal changed a referral package to {new_status}.",
        "metadata": {"complaintId": row["complaint_id"], "note": row["regulator_note"]},
    }).execute()
    return {
        "id": row["id"],
        "status": _label(row["status"]),
        "packageStatus": row["status"],
        "regulatorNote": row["regulator_note"],
        "updatedAt": row["updated_at"],
    }
