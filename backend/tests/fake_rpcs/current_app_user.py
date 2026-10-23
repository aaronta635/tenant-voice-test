"""public.current_app_user_id(): the caller's users.id, from the JWT."""

from tests.fake_rpcs import rpc


@rpc("current_app_user_id")
def current_app_user_id(ctx, params):
    caller = ctx.caller
    return caller["id"] if caller else None
