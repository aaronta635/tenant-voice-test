"""Each tenant's and landlord's place in the web's onboarding (R19).

The wizards save the profile through profiles.update_my_profile and the
documents through documents.py. This module keeps only where the member is,
in users.metadata.onboarding.<role> = {step, completed_at}: the step to
resume at, and when they first finished. The role is the web role (an
agent's is landlord), so each role an account holds keeps its own place.
This module is the only writer of that key.

A save merges into users.metadata, which the mobile app writes too: every
other key stays as it was, and an onboarding value another app stored in
another shape is never overwritten (409). It applies only while the row is
as it was read (its updated_at), and starts again from the new row when
another write got there first, as the writes in profiles.py do.
"""

import re
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.schemas.onboarding import STEP_PATTERN
from app.services import profiles
from app.services.shared_map import stamp_update

KEY = "onboarding"
# The web roles that have this onboarding; a provider's wizard reads its provider profile instead.
ROLES = ("tenant", "landlord")
STEP = re.compile(STEP_PATTERN)
ANOTHER_SHAPE = "Your setup progress was saved by another app in a form the website cannot change."


def get_progress(user_id: str, role: str) -> dict:
    """The member's place in onboarding as OnboardingOut; not started when nothing readable is stored."""
    return _progress(_user(user_id), role)


def save_progress(user_id: str, role: str, step: str, completed: bool = False) -> dict:
    """Save the step to resume at and, with completed, that onboarding is finished; returns OnboardingOut.

    The first finish keeps its time: going through the steps again moves
    only the step. A save that changes nothing writes nothing.
    """
    for _ in range(profiles.WRITE_ATTEMPTS):
        user = _user(user_id)
        meta = _metadata(user)
        stored = _stored(meta, role)
        changes = {} if stored.get("step") == step else {"step": step}
        if completed and _completed_at(stored) is None:
            changes["completed_at"] = datetime.now(timezone.utc).isoformat()
        if not changes:
            return _progress(user, role)
        saved = _write(user, profiles.merged(meta, {KEY: {role: changes}}))
        if saved is not None:
            return _progress(saved, role)
    raise HTTPException(status.HTTP_409_CONFLICT, profiles.CHANGED_ELSEWHERE)


def _user(user_id: str) -> dict:
    user = profiles.get_user_row(user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return user


def _write(user: dict, metadata: dict) -> dict | None:
    """The users row with its new metadata, or None when another write changed it since it was read."""
    rows = (
        get_supabase_client()
        .table("users")
        .update(stamp_update("users", {"metadata": metadata}))
        .eq("id", user["id"])
        .eq("updated_at", user["updated_at"])
        .is_("deleted_at", "null")
        .execute()
        .data
    )
    return rows[0] if rows else None


def _metadata(row: dict) -> dict:
    meta = row.get("metadata")
    return dict(meta) if isinstance(meta, dict) else {}


def _stored(meta: dict, role: str) -> dict:
    """The role's stored progress, for a save to merge into; 409 when another app stored it in another shape."""
    onboarding = meta.get(KEY)
    state = onboarding.get(role) if isinstance(onboarding, dict) else None
    if (onboarding is not None and not isinstance(onboarding, dict)) or (
        state is not None and not isinstance(state, dict)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, ANOTHER_SHAPE)
    return state or {}


def _progress(user: dict, role: str) -> dict:
    """users.metadata.onboarding.<role> as OnboardingOut. What it cannot read counts as not saved."""
    onboarding = _metadata(user).get(KEY)
    state = onboarding.get(role) if isinstance(onboarding, dict) else None
    state = state if isinstance(state, dict) else {}
    step = state.get("step")
    return {
        "role": role,
        "step": step if isinstance(step, str) and STEP.fullmatch(step) else None,
        "completed_at": _completed_at(state),
    }


def _completed_at(state: dict) -> datetime | None:
    value = state.get("completed_at")
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None
