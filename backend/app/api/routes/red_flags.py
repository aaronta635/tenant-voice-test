from fastapi import APIRouter, Depends, Query, Response, status

from app.core.admin import get_current_admin
from app.core.deps import CurrentProfile
from app.schemas.red_flags import (
    EvaluationOut,
    FlagAction,
    FlagDecisionIn,
    FlagStatus,
    RedFlagEventOut,
    RedFlagEventPageOut,
    RedFlagRuleActiveIn,
    RedFlagRuleIn,
    RedFlagRuleOut,
    RedFlagRuleUpdate,
)
from app.services import red_flags

# Every route here depends on get_current_admin, as /admin's others do (routes/admin.py).
router = APIRouter(prefix="/admin/red-flags", tags=["admin"])


@router.get("/rules", response_model=list[RedFlagRuleOut])
def list_rules(current: CurrentProfile = Depends(get_current_admin)):
    return red_flags.list_rules()


@router.post("/rules", response_model=RedFlagRuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(payload: RedFlagRuleIn, current: CurrentProfile = Depends(get_current_admin)):
    return red_flags.create_rule(current.id, payload.model_dump())


@router.patch("/rules/{rule_id}", response_model=RedFlagRuleOut)
def update_rule(rule_id: str, payload: RedFlagRuleUpdate, current: CurrentProfile = Depends(get_current_admin)):
    """Edit a rule, never its rule_key; 409 when it changed since the admin read it."""
    changes = payload.model_dump(exclude={"expected_updated_at"})
    return red_flags.update_rule(current.id, rule_id, changes, payload.expected_updated_at)


@router.post("/rules/{rule_id}/active", response_model=RedFlagRuleOut)
def set_rule_active(rule_id: str, payload: RedFlagRuleActiveIn, current: CurrentProfile = Depends(get_current_admin)):
    return red_flags.set_rule_active(current.id, rule_id, payload.is_active, payload.reason)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: str, current: CurrentProfile = Depends(get_current_admin)):
    """Delete a rule that never raised a flag; 409 for one that did."""
    red_flags.delete_rule(current.id, rule_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/rules/{rule_id}/evaluate", response_model=EvaluationOut)
def evaluate_rule(rule_id: str, current: CurrentProfile = Depends(get_current_admin)):
    """Run the rule over every property now, through evaluate_red_flag_rule."""
    return red_flags.evaluate_now(current.id, rule_id)


@router.get("/events", response_model=RedFlagEventPageOut)
def list_events(
    status: FlagStatus | None = None,
    rule_id: str | None = Query(default=None, max_length=40),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current: CurrentProfile = Depends(get_current_admin),
):
    """The flags the rules raised, newest first."""
    return red_flags.list_events(status, rule_id, limit, offset)


@router.post("/events/{event_id}/{action}", response_model=RedFlagEventOut)
def decide_event(event_id: str, action: FlagAction, payload: FlagDecisionIn,
                 current: CurrentProfile = Depends(get_current_admin)):
    """Acknowledge, resolve or dismiss a flag; 409 when it changed meanwhile."""
    return red_flags.decide(current.id, event_id, action, payload.note, payload.expected_status)
