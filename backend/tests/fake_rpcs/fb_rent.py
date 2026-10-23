"""Stand-ins for the rent ledger's functions (tracker R27).

Written from the bodies in output/shared-catalog/functions (2026-10-23):

- generate_upcoming_rent_charges(p_agreement_id): the agreement's next
  charge, when it falls due within 7 days (service role);
- mobile_my_rent_summary(): the caller's ACTIVE agreements as tenant, with
  each ISSUED charge and its balance (JWT).

The ledger's expenses go through mobile_owner_assistant_action, whose
stand-in is the owner assistant's (fb_owner_ai.py): one stand-in per
function.

CURRENT_DATE and now() are the database's: the UTC date and time of
ctx.now(). A Postgres transaction is all or nothing, so each stand-in checks
everything before its first write.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from tests.fake_rpcs import rpc
from tests.fake_supabase import api_error


# ---------------------------------------------------------------------------
# What SQL does to values
# ---------------------------------------------------------------------------
def _now(ctx) -> datetime:
    return datetime.fromisoformat(ctx.now()).astimezone(timezone.utc)


def _current_date(ctx) -> date:
    """CURRENT_DATE: the database session's date, which is UTC."""
    return _now(ctx).date()


def _date(value) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


def _utc_date(value) -> date:
    """timestamptz::date in a UTC session."""
    moment = datetime.fromisoformat(str(value))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).date()


def _add_months(day: date, months: int) -> date:
    """date + make_interval(months => n): past the month's end, its last day."""
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def _decimal(value) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


def _number(value: Decimal):
    """A numeric as PostgREST returns it in JSON."""
    return int(value) if value == value.to_integral_value() else float(value)


# ---------------------------------------------------------------------------
# generate_upcoming_rent_charges(p_agreement_id uuid) RETURNS integer
# ---------------------------------------------------------------------------
@rpc("generate_upcoming_rent_charges")
def generate_upcoming_rent_charges(ctx, params):
    """Adds the agreement's next ISSUED charge if it falls due within 7 days; returns how many it added (0 or 1)."""
    today = _current_date(ctx)
    added = 0
    agreements = [row for row in ctx.rows("rent_agreements")
                  if row["status"] == "ACTIVE" and row.get("activated_at") is not None
                  and row["id"] == params["p_agreement_id"]]
    for agreement in agreements:
        first_due = _date(agreement["first_due_date"])
        # Never create historical charges before activation.
        cutoff = max(today, first_due, _date(agreement["start_date"]), _utc_date(agreement["activated_at"]))
        if agreement["rent_frequency"] in ("WEEKLY", "FORTNIGHTLY"):
            step = 7 if agreement["rent_frequency"] == "WEEKLY" else 14
            days = (cutoff - first_due).days
            due = first_due + timedelta(days=((days + step - 1) // step) * step)
            period_end = due + timedelta(days=step - 1)
        elif agreement["rent_frequency"] == "MONTHLY":
            months = max((cutoff.year - first_due.year) * 12 + cutoff.month - first_due.month, 0)
            due = _add_months(first_due, months)
            if due < cutoff:
                months += 1
                due = _add_months(first_due, months)
            period_end = _add_months(first_due, months + 1) - timedelta(days=1)
        else:
            continue
        # Generate only charges due within the next 7 days.
        if due > today + timedelta(days=7):
            continue
        # Do not bill after a tenancy's end date.
        if agreement.get("end_date") is not None:
            end = _date(agreement["end_date"])
            if due > end:
                continue
            period_end = min(period_end, end)
        charges = [row for row in ctx.rows("rent_charges") if row["agreement_id"] == agreement["id"]]
        # ON CONFLICT (agreement_id, due_date) WHERE status = 'ISSUED' DO NOTHING
        if any(_date(row["due_date"]) == due and row["status"] == "ISSUED" for row in charges):
            continue
        # The other keys and checks are not the conflict target: they fail the call.
        if any(_date(row["period_start"]) == due for row in charges):
            raise api_error("23505", 'duplicate key value violates unique constraint "unique_rent_charge_period"',
                            f"Key (agreement_id, period_start)=({agreement['id']}, {due}) already exists.")
        if period_end <= due:
            raise api_error("23514",
                            'new row for relation "rent_charges" violates check constraint "valid_rent_period"')
        ctx.table("rent_charges").insert({
            "agreement_id": agreement["id"],
            "period_start": due.isoformat(),
            "period_end": period_end.isoformat(),
            "due_date": due.isoformat(),
            "amount_due": agreement["rent_amount"],
            "status": "ISSUED",
            "issued_at": _now(ctx).isoformat(),
        }).execute()
        added += 1
    return added


# ---------------------------------------------------------------------------
# mobile_my_rent_summary() RETURNS jsonb
# ---------------------------------------------------------------------------
@rpc("mobile_my_rent_summary")
def mobile_my_rent_summary(ctx, params):
    """The caller's ACTIVE agreements as tenant, newest start first, each with its ISSUED charges by due date."""
    caller = ctx.caller
    if caller is None:  # current_app_user_id() is null: no agreement matches
        return []
    today = _current_date(ctx)
    payments = ctx.rows("rent_payments")
    agreements = sorted(
        (row for row in ctx.rows("rent_agreements")
         if row["tenant_user_id"] == caller["id"] and row["status"] == "ACTIVE"),
        key=lambda row: _date(row["start_date"]), reverse=True,
    )
    summary = []
    for agreement in agreements:
        charges = sorted((row for row in ctx.rows("rent_charges")
                          if row["agreement_id"] == agreement["id"] and row["status"] == "ISSUED"),
                         key=lambda row: _date(row["due_date"]))
        entries = []
        for charge in charges:
            due = _decimal(charge["amount_due"])
            paid = sum((_decimal(row["amount"]) for row in payments
                        if row["charge_id"] == charge["id"] and row["status"] == "SUCCEEDED"
                        and row.get("verified_at") is not None), Decimal(0))
            if paid >= due:
                status = "PAID"
            elif _date(charge["due_date"]) < today:
                status = "OVERDUE"
            elif paid > 0:
                status = "PARTIALLY_PAID"
            else:
                status = "UNPAID"
            entries.append({
                "chargeId": charge["id"],
                "periodStart": str(charge["period_start"])[:10],
                "periodEnd": str(charge["period_end"])[:10],
                "dueDate": str(charge["due_date"])[:10],
                "amountDue": _number(due),
                "amountPaid": _number(paid),
                "amountOutstanding": _number(max(due - paid, Decimal(0))),
                "paymentStatus": status,
            })
        summary.append({
            "agreementId": agreement["id"],
            "listingId": agreement["listing_id"],
            "applicationId": agreement["application_id"],
            "rentAmount": agreement["rent_amount"],
            "rentFrequency": agreement["rent_frequency"],
            "currency": agreement["currency"],
            "startDate": str(agreement["start_date"])[:10],
            "firstDueDate": str(agreement["first_due_date"])[:10],
            "agreementStatus": agreement["status"],
            "charges": entries,
        })
    return summary
