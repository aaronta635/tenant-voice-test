"""The fake's RPC plumbing: per-client tokens, stand-ins, fixed answers and unhandled calls."""

import pytest
from postgrest.exceptions import APIError

from app.core import supabase as supabase_module
from app.core.supabase import user_client
from tests import fake_rpcs
from tests.fake_supabase import api_error

AUTH_ID = "a0000000-0000-4000-8000-000000000001"
USER_ID = "b0000000-0000-4000-8000-000000000001"


def seed_user(fake_db, status="ACTIVE"):
    fake_db.seed("users", [{
        "id": USER_ID, "auth_user_id": AUTH_ID, "email": "tess@example.com", "primary_role": "TENANT",
        "status": status, "updated_at": "2026-10-23T00:00:00+00:00",
    }])
    fake_db.tokens["jwt-tess"] = AUTH_ID


def test_a_user_client_rpc_runs_as_that_user(fake_db):
    seed_user(fake_db)

    assert user_client("jwt-tess").rpc("current_app_user_id", {}).execute().data == USER_ID
    assert fake_db.rpc_callers[-1] == ("current_app_user_id", AUTH_ID)


def test_the_service_role_has_no_app_user(fake_db):
    seed_user(fake_db)

    assert supabase_module.get_supabase_client().rpc("current_app_user_id", {}).execute().data is None
    assert fake_db.rpc_callers[-1] == ("current_app_user_id", None)


def test_an_inactive_account_has_no_app_user(fake_db):
    seed_user(fake_db, status="SUSPENDED")

    assert user_client("jwt-tess").rpc("current_app_user_id", {}).execute().data is None


def test_each_client_keeps_its_own_token(fake_db):
    seed_user(fake_db)
    service = supabase_module.get_supabase_client()
    user_client("jwt-tess")

    assert service.postgrest.token is None
    assert fake_db.postgrest.auth_tokens == ["jwt-tess"]


def test_a_fixed_answer_wins_over_the_stand_in(fake_db):
    seed_user(fake_db)
    fake_db.rpc_results["current_app_user_id"] = "fixed"

    assert user_client("jwt-tess").rpc("current_app_user_id", {}).execute().data == "fixed"


def test_a_stand_in_error_is_raised_when_the_call_runs(fake_db, monkeypatch):
    def refuse(ctx, params):
        raise api_error("42501", "Please sign in first.")

    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_my_applications", refuse)
    query = supabase_module.get_supabase_client().rpc("mobile_my_applications", {})

    with pytest.raises(APIError) as caught:
        query.execute()
    assert caught.value.code == "42501"


def test_an_rpc_without_a_stand_in_is_listed(fake_db):
    assert supabase_module.get_supabase_client().rpc("mobile_my_applications", {}).execute().data == []
    assert fake_db.rpc_unhandled == ["mobile_my_applications"]


def test_unknown_parameters_still_fail_like_postgrest(fake_db):
    with pytest.raises(APIError) as caught:
        supabase_module.get_supabase_client().rpc("current_app_user_id", {"p_extra": 1}).execute()
    assert caught.value.code == "PGRST202"


def test_a_name_gets_one_stand_in():
    with pytest.raises(ValueError, match="two stand-ins"):
        fake_rpcs.rpc("current_app_user_id")(lambda ctx, params: None)
