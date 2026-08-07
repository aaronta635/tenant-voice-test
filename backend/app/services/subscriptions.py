from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client

PLANS_TABLE = "subscription_plans"
SUBS_TABLE = "user_subscriptions"


def _plan(plan_id: str) -> dict:
    supabase = get_supabase_client()
    result = supabase.table(PLANS_TABLE).select("*").eq("id", plan_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return result.data[0]


def get_my_subscription(profile_id: str) -> dict | None:
    supabase = get_supabase_client()
    result = supabase.table(SUBS_TABLE).select("*").eq("user_id", profile_id).limit(1).execute()
    if not result.data:
        return None
    subscription = result.data[0]
    subscription["plan"] = _plan(subscription["plan_id"])
    return subscription


def list_plans(profile_id: str | None = None, audience: str | None = None) -> list[dict]:
    supabase = get_supabase_client()
    query = supabase.table(PLANS_TABLE).select("*").eq("is_active", True)
    if audience:
        query = query.eq("audience", audience)
    plans = query.order("sort_order").execute().data or []

    current_plan_id = None
    if profile_id:
        subscription = get_my_subscription(profile_id)
        if subscription and subscription["status"] == "active":
            current_plan_id = subscription["plan_id"]

    for plan in plans:
        plan["is_current"] = plan["id"] == current_plan_id
    return plans


def select_plan(profile_id: str, plan_id: str) -> dict:
    plan = _plan(plan_id)
    supabase = get_supabase_client()

    renews_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    payload = {
        "user_id": profile_id,
        "plan_id": plan["id"],
        "status": "active",
        "renews_at": renews_at,
    }

    existing = supabase.table(SUBS_TABLE).select("id").eq("user_id", profile_id).limit(1).execute()
    if existing.data:
        result = supabase.table(SUBS_TABLE).update(payload).eq("user_id", profile_id).execute()
    else:
        result = supabase.table(SUBS_TABLE).insert(payload).execute()

    subscription = result.data[0]
    subscription["plan"] = plan
    return subscription


def cancel(profile_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table(SUBS_TABLE)
        .update({"status": "cancelled"})
        .eq("user_id", profile_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No subscription to cancel")
    subscription = result.data[0]
    subscription["plan"] = _plan(subscription["plan_id"])
    return subscription
