"""The owner's rent ledger and the tenant's rent (tracker R27).

Charges are the ISSUED rent_charges of the owner's ACTIVE rent_agreements
(rent_agreements.owner_user_id, as the table's policy reads it). Only the
owner's "Create the next charge" makes one: it calls
generate_upcoming_rent_charges, which adds the next charge due within 7 days
and nothing when that charge exists. Reading, refreshing and exporting the
ledger never write a charge.

A receipt is a rent_payments row the owner records on one of those charges:
SUCCEEDED and verified as they record it (successful_payment_requires_verification),
provider OWNER_RECORDED, shown as "Recorded by owner". TenantVoice collects
no rent and takes no payment online. The idempotency key is the form's,
under the owner's id, so sending a form again returns the receipt it
recorded. A correction marks the receipt CANCELLED; nothing is deleted.
rent_payments has no column for the day the money arrived, how, its
reference or the notes: they are the web audit_log's rent_payment.recorded
and rent_payment.cancelled entries (docs/shared-db.md).

An expense is an owner workspace record (owner_assistant_records, kind
expense), created and cancelled through mobile_owner_assistant_action with
the owner's JWT, as the mobile owner tools do.

A charge's balance follows mobile_my_rent_summary: PAID once its counted
receipts (SUCCEEDED and verified) cover it, else OVERDUE once its due date
is before today in Sydney, else PARTIALLY_PAID or UNPAID. The tenant's page
reads mobile_my_rent_summary with their JWT and applies the same rule to its
amounts. The CSV export and the printed page are built from the ledger the
screen shows, so their totals are the screen's.
"""

from __future__ import annotations

import csv
import io
import logging
from collections.abc import Iterable
from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client, user_client, web_table
from app.services import audit
from app.services._common import select_all, select_in
from app.services.maps_messaging import is_uuid
from app.services.maps_rental import locality
from app.services.shared_map import address_of, stamp_insert, stamp_update

logger = logging.getLogger(__name__)

SYDNEY = ZoneInfo("Australia/Sydney")
AGREEMENTS = "rent_agreements"
CHARGES = "rent_charges"
PAYMENTS = "rent_payments"
RECORDS = "owner_assistant_records"
LISTINGS = "listings"
PROPERTIES = "properties"
USERS = "users"

ACTIVE_AGREEMENT = "ACTIVE"
ISSUED_CHARGE = "ISSUED"
SUCCEEDED = "SUCCEEDED"
CANCELLED = "CANCELLED"
# rent_payments.provider of a receipt the owner recorded; STRIPE is the mobile app's online payment.
OWNER_RECORDED = "OWNER_RECORDED"
STRIPE = "STRIPE"
SOURCE_LABELS = {
    "owner_recorded": "Recorded by owner",
    "stripe": "Stripe payment",
    "other": "Payment from another app",
}
EXPENSE_KIND = "expense"
EXPENSE_CANCELLED = "cancelled"
PAYMENT_STATUS_LABELS = {"PAID": "Paid", "OVERDUE": "Overdue", "PARTIALLY_PAID": "Part paid", "UNPAID": "Unpaid"}
RECEIPT_STATUS_LABELS = {SUCCEEDED: "Counted", CANCELLED: "Cancelled (corrected)"}
METHOD_LABELS = {"bank_transfer": "Bank transfer", "cash": "Cash", "cheque": "Cheque", "card": "Card", "other": "Other"}

# The web audit_log entries that hold what rent_payments cannot (docs/shared-db.md).
RECEIPT_RECORDED = "rent_payment.recorded"
RECEIPT_CORRECTED = "rent_payment.cancelled"
EXPENSE_CORRECTED = "rent_expense.cancelled"
CHARGES_CREATED = "rent_charges.created"
RECEIPT_ENTITY = "rent_payment"
RECORD_ENTITY = "owner_assistant_record"

AGREEMENT_FIELDS = ("id, listing_id, tenant_user_id, owner_user_id, rent_amount, rent_frequency, currency, "
                    "start_date, end_date, first_due_date, status, activated_at")
CHARGE_FIELDS = "id, agreement_id, period_start, period_end, due_date, amount_due, status"
PAYMENT_FIELDS = ("id, charge_id, amount, currency, status, provider, idempotency_key, verified_at, created_at, "
                  "updated_at")
PLACE_FIELDS = "id, address_line_1, address_line_2, suburb, state, postcode"

# 422; Starlette renamed its constant, so the number is spelled out.
UNPROCESSABLE = 422
CENT = Decimal("0.01")
ZERO = Decimal("0.00")
NOT_FOUND = {
    "agreement": "Tenancy not found",
    "charge": "Rent charge not found",
    "receipt": "Receipt not found",
    "expense": "Expense not found",
}

# How the shared functions' errors reach the browser: their message is for the person.
# P0001 is a plain RAISE EXCEPTION, which these functions use to refuse what was sent.
FUNCTION_ERRORS = {
    "42501": status.HTTP_403_FORBIDDEN,
    "P0002": status.HTTP_404_NOT_FOUND,
    "23505": status.HTTP_409_CONFLICT,
    "22023": UNPROCESSABLE,
    "23514": UNPROCESSABLE,
    "P0001": UNPROCESSABLE,
}


def _db():
    return get_supabase_client()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def sydney_today(now: datetime | None = None) -> date:
    return (now or _now()).astimezone(SYDNEY).date()


def _call(client, name: str, params: dict):
    """A shared function's answer, or the HTTP error its SQLSTATE stands for."""
    try:
        return client.rpc(name, params).execute().data
    except APIError as exc:
        code = getattr(exc, "code", None)
        if code in FUNCTION_ERRORS:
            raise HTTPException(FUNCTION_ERRORS[code], exc.message or "The request was refused.") from exc
        raise


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------
def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT) if value is not None else ZERO


def _aud(value: Decimal) -> str:
    return f"${value:,.2f}"


def _day(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _moment(value) -> datetime | None:
    if not value:
        return None
    moment = datetime.fromisoformat(str(value))
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def payment_status(amount_due: Decimal, amount_paid: Decimal, due_date: date, today: date) -> str:
    """mobile_my_rent_summary's paymentStatus, with today as Sydney's calendar day."""
    if amount_paid >= amount_due:
        return "PAID"
    if due_date < today:
        return "OVERDUE"
    if amount_paid > 0:
        return "PARTIALLY_PAID"
    return "UNPAID"


def _counted(payment: dict) -> bool:
    """A payment mobile_my_rent_summary adds to the paid amount."""
    return payment.get("status") == SUCCEEDED and payment.get("verified_at") is not None


def _source(payment: dict) -> str:
    provider = str(payment.get("provider") or "").upper()
    if provider == OWNER_RECORDED:
        return "owner_recorded"
    return "stripe" if provider == STRIPE else "other"


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def _active_agreements(owner: str) -> list[dict]:
    return select_all(lambda: _db().table(AGREEMENTS).select(AGREEMENT_FIELDS)
                      .eq("owner_user_id", owner).eq("status", ACTIVE_AGREEMENT).order("id"))


def _places(property_ids: Iterable[str]) -> dict[str, dict]:
    rows = select_in(lambda: _db().table(PROPERTIES).select(PLACE_FIELDS).order("id"), "id", property_ids)
    return {row["id"]: row for row in rows}


def _address(prop: dict | None) -> str | None:
    """The owner's own property's full address, as the owner pages show it."""
    return (address_of(prop) or None) if prop else None


def _listings(owner: str, also: Iterable[str]) -> dict[str, dict]:
    """The owner's listings (their properties'), plus the listings also names, each with its place.

    A listing is {id, title, status, property_id, address, owned}: owned when
    its property is the owner's, which an expense needs.
    """
    owned_places = {row["id"]: row for row in select_all(
        lambda: _db().table(PROPERTIES).select(PLACE_FIELDS).eq("owner_user_id", owner).order("id"))}
    rows = select_in(lambda: _db().table(LISTINGS).select("id, title, status, property_id").order("id"),
                     "property_id", owned_places)
    found = {row["id"]: row for row in rows}
    others = [listing_id for listing_id in dict.fromkeys(also) if listing_id not in found]
    if others:
        found.update({row["id"]: row for row in select_in(
            lambda: _db().table(LISTINGS).select("id, title, status, property_id").order("id"), "id", others)})
    places = {**owned_places, **_places({row["property_id"] for row in found.values()} - set(owned_places))}
    return {
        listing_id: {
            "id": listing_id,
            "title": row.get("title") or "Untitled listing",
            "status": row.get("status"),
            "address": _address(places.get(row.get("property_id"))),
            "owned": row.get("property_id") in owned_places,
        }
        for listing_id, row in found.items()
    }


def _names(user_ids: Iterable[str]) -> dict[str, str | None]:
    rows = select_in(lambda: _db().table(USERS).select("id, full_name").order("id"), "id", user_ids)
    return {row["id"]: row.get("full_name") for row in rows}


def _charges(agreement_ids: list[str], from_date: date | None, to_date: date | None) -> list[dict]:
    def build():
        query = _db().table(CHARGES).select(CHARGE_FIELDS).eq("status", ISSUED_CHARGE)
        if from_date is not None:
            query = query.gte("due_date", from_date.isoformat())
        if to_date is not None:
            query = query.lte("due_date", to_date.isoformat())
        return query.order("id")

    return select_in(build, "agreement_id", agreement_ids)


def _payments(charge_ids: list[str]) -> list[dict]:
    return select_in(lambda: _db().table(PAYMENTS).select(PAYMENT_FIELDS).order("id"), "charge_id", charge_ids)


def _events(entity_type: str, actions: list[str], entity_ids: list[str]) -> dict[str, dict[str, dict]]:
    """{entity id: {action: its latest audit_log entry}} for the entities' ledger events."""
    rows = select_in(
        lambda: web_table(audit.TABLE).select("id, action, entity_id, metadata, created_at")
        .eq("entity_type", entity_type).in_("action", actions).order("id"),
        "entity_id", entity_ids,
    )
    latest: dict[str, dict[str, dict]] = {}
    for row in sorted(rows, key=lambda entry: (str(entry.get("created_at") or ""), entry["id"])):
        latest.setdefault(row["entity_id"], {})[row["action"]] = row
    return latest


def _expense_rows(owner: str) -> list[dict]:
    return select_all(lambda: _db().table(RECORDS).select("*")
                      .eq("owner_user_id", owner).eq("kind", EXPENSE_KIND).order("id"))


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------
def _receipt_out(payment: dict, events: dict[str, dict]) -> dict:
    details = (events.get(RECEIPT_RECORDED) or {}).get("metadata") or {}
    correction = events.get(RECEIPT_CORRECTED) if payment.get("status") == CANCELLED else None
    source = _source(payment)
    method = details.get("method")
    return {
        "id": payment["id"],
        "charge_id": payment["charge_id"],
        "amount": float(_money(payment.get("amount"))),
        "status": payment.get("status") or "PENDING",
        "counted": _counted(payment),
        "source": source,
        "source_label": SOURCE_LABELS[source],
        "received_on": _day(details.get("received_on")),
        "method": method if method in METHOD_LABELS else None,
        "reference": details.get("reference") or None,
        "note": details.get("note") or None,
        "recorded_at": _moment(payment.get("created_at")),
        "correctable": source == "owner_recorded" and payment.get("status") == SUCCEEDED,
        "corrected_at": _moment(correction.get("created_at")) if correction else None,
        "correction_note": ((correction.get("metadata") or {}).get("note") or None) if correction else None,
    }


def _within(day: date | None, from_date: date | None, to_date: date | None) -> bool:
    """Whether day is in the inclusive range; with either end set, an unknown day is not."""
    if from_date is None and to_date is None:
        return True
    return day is not None and (from_date is None or day >= from_date) and (to_date is None or day <= to_date)


def _expense_day(record: dict) -> date | None:
    """The day an expense was paid: its date, else the Sydney day it was recorded."""
    day = _day((record.get("payload") or {}).get("date"))
    if day is None and (created := _moment(record.get("created_at"))):
        day = created.astimezone(SYDNEY).date()
    return day


def _expense_out(record: dict, listing: dict | None, correction: dict | None) -> dict:
    data = record.get("payload") or {}
    cancelled = record.get("status") == EXPENSE_CANCELLED
    # A correction's note shows on the expense it cancelled.
    shown = cancelled and correction is not None
    return {
        "id": record["id"],
        "listing_id": record["listing_id"],
        "listing_title": (listing or {}).get("title") or "Listing",
        "title": record.get("title") or "Expense",
        "amount": float(_money(data.get("amount"))),
        "date": _expense_day(record),
        "category": data.get("category") or None,
        "note": data.get("note") or None,
        "status": record.get("status") or "recorded",
        "counted": not cancelled,
        "created_at": _moment(record.get("created_at")),
        "corrected_at": _moment(correction.get("created_at")) if shown else None,
        "correction_note": ((correction.get("metadata") or {}).get("note") or None) if shown else None,
    }


def _agreement_out(agreement: dict, listing: dict | None, tenant_name: str | None) -> dict:
    return {
        "id": agreement["id"],
        "listing_id": agreement["listing_id"],
        "listing_title": (listing or {}).get("title") or "Listing",
        "property_address": (listing or {}).get("address"),
        "tenant_id": agreement["tenant_user_id"],
        "tenant_name": tenant_name,
        "rent_amount": float(_money(agreement.get("rent_amount"))),
        "rent_frequency": agreement.get("rent_frequency"),
        "start_date": _day(agreement.get("start_date")),
        "end_date": _day(agreement.get("end_date")),
        "first_due_date": _day(agreement.get("first_due_date")),
    }


# ---------------------------------------------------------------------------
# The ledger
# ---------------------------------------------------------------------------
def ledger(owner: str, listing_id: str | None = None, tenant_id: str | None = None,
           from_date: date | None = None, to_date: date | None = None) -> dict:
    """The owner's charges, receipts and expenses in the filters, with their totals. Writes nothing.

    The filters are a listing, a tenant and due dates (from and to, inclusive).
    Rent follows all three. Expenses follow the listing and their own date;
    with a tenant chosen, the expenses of the homes that tenant rents.
    """
    if from_date and to_date and from_date > to_date:
        raise HTTPException(UNPROCESSABLE, "The start date must be on or before the end date.")
    now = _now()
    today = sydney_today(now)
    agreements = _active_agreements(owner)
    expense_rows = _expense_rows(owner)
    listings = _listings(owner, [row["listing_id"] for row in agreements])
    # As mobile_owner_workspace shows them: on listings of the owner's own properties.
    expense_rows = [row for row in expense_rows if (listings.get(row["listing_id"]) or {}).get("owned")]
    tenant_names = _names({row["tenant_user_id"] for row in agreements})

    shown = [row for row in agreements
             if (listing_id is None or row["listing_id"] == listing_id)
             and (tenant_id is None or row["tenant_user_id"] == tenant_id)]
    by_agreement = {row["id"]: row for row in shown}
    charges = _charges(list(by_agreement), from_date, to_date)
    payments = _payments([row["id"] for row in charges])
    receipt_events = _events(RECEIPT_ENTITY, [RECEIPT_RECORDED, RECEIPT_CORRECTED], [row["id"] for row in payments])
    payments_by_charge: dict[str, list[dict]] = {}
    for payment in sorted(payments, key=lambda row: (str(row.get("created_at") or ""), row["id"])):
        payments_by_charge.setdefault(payment["charge_id"], []).append(payment)

    charge_rows = []
    for charge in charges:
        agreement = by_agreement[charge["agreement_id"]]
        listing = listings.get(agreement["listing_id"]) or {}
        own_payments = payments_by_charge.get(charge["id"], [])
        due = _money(charge.get("amount_due"))
        paid = sum((_money(row.get("amount")) for row in own_payments if _counted(row)), ZERO)
        due_date = _day(charge["due_date"])
        charge_rows.append({
            "id": charge["id"],
            "agreement_id": agreement["id"],
            "listing_id": agreement["listing_id"],
            "listing_title": listing.get("title") or "Listing",
            "property_address": listing.get("address"),
            "tenant_id": agreement["tenant_user_id"],
            "tenant_name": tenant_names.get(agreement["tenant_user_id"]),
            "period_start": _day(charge["period_start"]),
            "period_end": _day(charge["period_end"]),
            "due_date": due_date,
            "_due": due,
            "_paid": paid,
            "amount_due": float(due),
            "amount_paid": float(paid),
            "amount_outstanding": float(max(due - paid, ZERO)),
            "payment_status": payment_status(due, paid, due_date, today),
            "receipts": [_receipt_out(row, receipt_events.get(row["id"], {})) for row in own_payments],
        })
    charge_rows.sort(key=lambda row: (row["due_date"], row["listing_title"], row["tenant_name"] or "", row["id"]))

    expense_listings = {listing_id} if listing_id is not None else None
    if tenant_id is not None:
        rented = {row["listing_id"] for row in agreements if row["tenant_user_id"] == tenant_id}
        expense_listings = rented if expense_listings is None else expense_listings & rented
    shown_expenses = [
        row for row in expense_rows
        if (expense_listings is None or row["listing_id"] in expense_listings)
        and _within(_expense_day(row), from_date, to_date)
    ]
    expense_events = _events(RECORD_ENTITY, [EXPENSE_CORRECTED], [row["id"] for row in shown_expenses])
    expenses = [
        _expense_out(row, listings.get(row["listing_id"]), expense_events.get(row["id"], {}).get(EXPENSE_CORRECTED))
        for row in shown_expenses
    ]
    expenses.sort(key=lambda row: (row["date"] or date.min, row["listing_title"], row["id"]))

    rent_due = sum((row["_due"] for row in charge_rows), ZERO)
    received = sum((row["_paid"] for row in charge_rows), ZERO)
    outstanding = sum((max(row["_due"] - row["_paid"], ZERO) for row in charge_rows), ZERO)
    overdue = sum((max(row["_due"] - row["_paid"], ZERO) for row in charge_rows if row["payment_status"] == "OVERDUE"),
                  ZERO)
    spent = sum((_money(row["amount"]) for row in expenses if row["counted"]), ZERO)
    for row in charge_rows:
        del row["_due"], row["_paid"]

    rented_listings = {row["listing_id"] for row in agreements}
    referenced = rented_listings | {row["listing_id"] for row in expense_rows}
    options = sorted(
        ({"id": item["id"], "title": item["title"], "property_address": item["address"],
          "rented": item["id"] in rented_listings, "takes_expenses": item["owned"]}
         for item in listings.values() if item["id"] in referenced or item["status"] != "ARCHIVED"),
        key=lambda item: (item["title"].lower(), item["id"]),
    )
    tenants = sorted(({"id": person, "name": name} for person, name in tenant_names.items()),
                     key=lambda item: ((item["name"] or "").lower(), item["id"]))
    agreements_out = sorted(
        (_agreement_out(row, listings.get(row["listing_id"]), tenant_names.get(row["tenant_user_id"]))
         for row in shown),
        key=lambda item: (item["listing_title"].lower(), item["id"]),
    )
    return {
        "today": today,
        "generated_at": now,
        "filters": {"listing_id": listing_id, "tenant_id": tenant_id, "from_date": from_date, "to_date": to_date},
        "listings": options,
        "tenants": tenants,
        "agreements": agreements_out,
        "charges": charge_rows,
        "expenses": expenses,
        "totals": {
            "charges": len(charge_rows),
            "rent_due": float(rent_due),
            "received": float(received),
            "outstanding": float(outstanding),
            "overdue": float(overdue),
            "expenses": float(spent),
            "net": float(received - spent),
        },
    }


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------
def _cell(value) -> str:
    """Text for a CSV cell; text a spreadsheet would run as a formula is quoted with a leading '."""
    text = "" if value is None else str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _amount(value: float) -> str:
    return f"{value:.2f}"


def csv_filename(data: dict) -> str:
    return f"rent-ledger-{data['today'].isoformat()}.csv"


def ledger_csv(data: dict) -> str:
    """The ledger the screen shows, as CSV: the filters, charges, receipts, expenses and the same totals."""
    out = io.StringIO()
    rows = csv.writer(out, lineterminator="\r\n")
    filters = data["filters"]
    listing_titles = {item["id"]: item["title"] for item in data["listings"]}
    tenant_names = {item["id"]: item["name"] for item in data["tenants"]}
    generated = data["generated_at"].astimezone(SYDNEY).strftime("%Y-%m-%d %H:%M")
    rows.writerow(["Rent ledger", "TenantVoice"])
    rows.writerow(["Generated", f"{generated} Sydney time"])
    rows.writerow(["Listing", _cell(listing_titles.get(filters["listing_id"], "Unknown listing"))
                   if filters["listing_id"] else "All listings"])
    rows.writerow(["Tenant", _cell(tenant_names.get(filters["tenant_id"]) or "Unknown tenant")
                   if filters["tenant_id"] else "All tenants"])
    rows.writerow(["Due from", filters["from_date"].isoformat() if filters["from_date"] else "Any date"])
    rows.writerow(["Due to", filters["to_date"].isoformat() if filters["to_date"] else "Any date"])
    rows.writerow(["Receipts", "Recorded by owner. TenantVoice does not collect rent."])
    rows.writerow([])
    rows.writerow(["Charges"])
    rows.writerow(["Due date", "Period start", "Period end", "Listing", "Tenant", "Amount due", "Received",
                   "Outstanding", "Status"])
    for charge in data["charges"]:
        rows.writerow([
            charge["due_date"].isoformat(), charge["period_start"].isoformat(), charge["period_end"].isoformat(),
            _cell(charge["listing_title"]), _cell(charge["tenant_name"]), _amount(charge["amount_due"]),
            _amount(charge["amount_paid"]), _amount(charge["amount_outstanding"]),
            PAYMENT_STATUS_LABELS[charge["payment_status"]],
        ])
    rows.writerow([])
    rows.writerow(["Receipts"])
    rows.writerow(["Charge due date", "Listing", "Tenant", "Received on", "Recorded at", "Amount", "Method",
                   "Reference", "Source", "Status", "Note", "Correction note"])
    for charge in data["charges"]:
        for receipt in charge["receipts"]:
            recorded = receipt["recorded_at"].astimezone(SYDNEY).strftime("%Y-%m-%d %H:%M") \
                if receipt["recorded_at"] else ""
            rows.writerow([
                charge["due_date"].isoformat(), _cell(charge["listing_title"]), _cell(charge["tenant_name"]),
                receipt["received_on"].isoformat() if receipt["received_on"] else "", recorded,
                _amount(receipt["amount"]), METHOD_LABELS.get(receipt["method"] or "", ""), _cell(receipt["reference"]),
                receipt["source_label"], RECEIPT_STATUS_LABELS.get(receipt["status"], receipt["status"].title()),
                _cell(receipt["note"]), _cell(receipt["correction_note"]),
            ])
    rows.writerow([])
    rows.writerow(["Expenses"])
    rows.writerow(["Date", "Listing", "Title", "Category", "Amount", "Status", "Note", "Correction note"])
    for expense in data["expenses"]:
        rows.writerow([
            expense["date"].isoformat() if expense["date"] else "", _cell(expense["listing_title"]),
            _cell(expense["title"]), _cell(expense["category"]), _amount(expense["amount"]),
            "Counted" if expense["counted"] else "Cancelled (corrected)", _cell(expense["note"]),
            _cell(expense["correction_note"]),
        ])
    totals = data["totals"]
    rows.writerow([])
    rows.writerow(["Totals"])
    rows.writerow(["Charges", str(totals["charges"])])
    for label, key in (("Rent due", "rent_due"), ("Received", "received"), ("Outstanding", "outstanding"),
                       ("Overdue", "overdue"), ("Expenses", "expenses"), ("Net (received less expenses)", "net")):
        rows.writerow([label, _amount(totals[key])])
    return out.getvalue()


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def _record_event(actor: str, action: str, entity_type: str, entity_id: str, metadata: dict) -> None:
    """One ledger entry in the web audit_log; unlike audit.record(), a failure is the request's (503)."""
    try:
        web_table(audit.TABLE).insert({
            "actor_id": actor, "action": action, "entity_type": entity_type, "entity_id": entity_id,
            "metadata": {"source": "web", **metadata},
        }).execute()
    except Exception as exc:
        logger.error("ledger entry %s for %s %s failed: %s", action, entity_type, entity_id, exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The ledger could not save the details. Please send it again.") from exc


def _agreement_of(owner: str, agreement_id: str) -> dict:
    """The owner's agreement; 404 for anyone else's, so another owner's tenancy is never confirmed to exist."""
    rows = (_db().table(AGREEMENTS).select(AGREEMENT_FIELDS).eq("id", agreement_id).eq("owner_user_id", owner)
            .limit(1).execute().data or []) if is_uuid(agreement_id) else []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["agreement"])
    return rows[0]


def _require_active(agreement: dict) -> None:
    if agreement.get("status") != ACTIVE_AGREEMENT or not agreement.get("activated_at"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This tenancy is not active, so it has no rent to record.")


def _charge_of(owner: str, charge_id: str) -> tuple[dict, dict]:
    """An ISSUED charge of the owner's ACTIVE agreement, and that agreement."""
    rows = (_db().table(CHARGES).select(CHARGE_FIELDS).eq("id", charge_id).limit(1).execute().data or []) \
        if is_uuid(charge_id) else []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["charge"])
    charge = rows[0]
    try:
        agreement = _agreement_of(owner, charge["agreement_id"])
    except HTTPException:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["charge"]) from None
    _require_active(agreement)
    if charge.get("status") != ISSUED_CHARGE:
        raise HTTPException(status.HTTP_409_CONFLICT, "This charge is not issued, so it takes no receipt.")
    return charge, agreement


def _charge_payments(charge_id: str) -> list[dict]:
    return select_all(lambda: _db().table(PAYMENTS).select("id, amount, status, verified_at, created_at")
                      .eq("charge_id", charge_id).order("id"))


def _counted_paid(charge_id: str) -> Decimal:
    return sum((_money(row.get("amount")) for row in _charge_payments(charge_id) if _counted(row)), ZERO)


OVERPAID_AT_ONCE = ("Another receipt on this charge was recorded at the same moment, and together they are more than "
                    "was owing, so this one was withdrawn. Reload the ledger.")
RESENT_WITHDRAWN = ("This receipt was withdrawn and does not count. Reload the ledger, and open a new receipt form "
                    "for any money still owing.")


def _more_than_owing_with_earlier(charge: dict, payment: dict) -> bool:
    """Whether the receipts recorded before this one, and this one, are more than the charge.

    Two receipt forms on one charge sent at once both read the same amount
    owing. Once both are in, each request sees them in the same order
    (created_at, then id), so only the later one is over.

    Best effort, not a lock: created_at is when an insert began, not when
    it became visible. A receipt whose insert began first but committed
    after the other request checked ranks first and is kept, and so is the
    other, which never saw it. Only a database function that checks and
    inserts under a lock on the charge closes that.
    """
    counted = sorted((row for row in _charge_payments(charge["id"]) if _counted(row)),
                     key=lambda row: (str(row.get("created_at") or ""), row["id"]))
    running = ZERO
    for row in counted:
        running += _money(row.get("amount"))
        if row["id"] == payment["id"]:
            break
    return running > _money(charge.get("amount_due"))


def _payment_by_key(key: str) -> dict | None:
    rows = _db().table(PAYMENTS).select(PAYMENT_FIELDS).eq("idempotency_key", key).limit(1).execute().data or []
    return rows[0] if rows else None


def _receipt_key(owner: str, form_key) -> str:
    """The idempotency key a receipt is stored under: the form's, in the owner's own namespace."""
    return f"web:{owner}:{form_key}"


# generate_upcoming_rent_charges fails on these constraints with Postgres's own words: say what they mean.
CHARGE_REFUSALS = {
    "valid_rent_period": "The tenancy ends on the next due date, so there is no further rent to charge.",
    "unique_rent_charge_period": "A voided charge already covers the next rent period, so no new charge can be made for it.",
}


def create_next_charge(owner: str, agreement_id: str) -> dict:
    """The owner's explicit action: generate_upcoming_rent_charges for one of their active agreements."""
    agreement = _agreement_of(owner, agreement_id)
    _require_active(agreement)
    try:
        answer = _call(_db(), "generate_upcoming_rent_charges", {"p_agreement_id": agreement["id"]})
    except HTTPException as exc:
        plain = next((text for constraint, text in CHARGE_REFUSALS.items() if constraint in str(exc.detail)), None)
        if plain is None:
            raise
        raise HTTPException(exc.status_code, plain) from exc
    created = int(answer) if isinstance(answer, (int, float)) and not isinstance(answer, bool) else 0
    audit.record(owner, CHARGES_CREATED, "rent_agreement", agreement["id"], {"created": created})
    if created:
        return {"created": created, "message": "The next rent charge is in the ledger."}
    return {"created": 0,
            "message": "No new charge: the next one is not due within 7 days, or it is already in the ledger."}


def _receipt_view(payment: dict) -> dict:
    events = _events(RECEIPT_ENTITY, [RECEIPT_RECORDED, RECEIPT_CORRECTED], [payment["id"]])
    return _receipt_out(payment, events.get(payment["id"], {}))


def _details(payload: dict) -> dict:
    return {
        "received_on": payload["received_on"].isoformat(),
        "method": payload["method"],
        "reference": payload.get("reference") or None,
        "note": payload.get("note") or None,
    }


def _replayed(owner: str, existing: dict, charge_id: str, payload: dict) -> dict:
    """The receipt a form with this key already recorded.

    409 when the form now says something else, or when the receipt no longer
    counts (withdrawn as more than was owing, or corrected): sending its form
    again must not read as recorded.
    """
    if existing["charge_id"] != charge_id or _money(existing.get("amount")) != _money(payload["amount"]):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This receipt was already sent with other details. Open a new receipt form.")
    events = _events(RECEIPT_ENTITY, [RECEIPT_RECORDED], [existing["id"]]).get(existing["id"], {})
    if RECEIPT_RECORDED not in events:
        # Its details failed to save when it was recorded: this retry saves them.
        _record_event(owner, RECEIPT_RECORDED, RECEIPT_ENTITY, existing["id"],
                      {"charge_id": charge_id, "amount": float(_money(existing.get("amount"))), **_details(payload)})
    if existing.get("status") == CANCELLED:
        raise HTTPException(status.HTTP_409_CONFLICT, RESENT_WITHDRAWN)
    return _receipt_view(existing)


def record_receipt(owner: str, charge_id: str, payload: dict) -> tuple[dict, bool]:
    """A receipt the owner records on their charge; returns it and whether this call recorded it.

    The same form sent again (its idempotency key) returns the receipt it
    recorded, so a double click or a retry never adds to the paid amount.
    """
    key = _receipt_key(owner, payload["idempotency_key"])
    existing = _payment_by_key(key)
    if existing is not None:
        return _replayed(owner, existing, charge_id, payload), False
    charge, agreement = _charge_of(owner, charge_id)
    amount = _money(payload["amount"])
    now = _now()
    if payload["received_on"] > sydney_today(now):
        raise HTTPException(UNPROCESSABLE, "The day you received it cannot be in the future.")
    owing = _money(charge.get("amount_due")) - _counted_paid(charge["id"])
    if owing <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "This charge is already paid in full.")
    if amount > owing:
        raise HTTPException(UNPROCESSABLE,
                            f"The receipt is more than the {_aud(owing)} still owing on this charge.")
    row = stamp_insert(PAYMENTS, {
        "charge_id": charge["id"],
        "amount": float(amount),
        "currency": "AUD",
        # Verified as the owner records it: a SUCCEEDED payment needs verified_at.
        "status": SUCCEEDED,
        "verified_at": now.isoformat(),
        "provider": OWNER_RECORDED,
        "idempotency_key": key,
    }, now)
    try:
        payment = _db().table(PAYMENTS).insert(row).execute().data[0]
    except APIError as exc:
        if getattr(exc, "code", None) != "23505" or (existing := _payment_by_key(key)) is None:
            raise
        # The same form, sent twice at once: the other request recorded it.
        return _replayed(owner, existing, charge_id, payload), False
    _record_event(owner, RECEIPT_RECORDED, RECEIPT_ENTITY, payment["id"], {
        "charge_id": charge["id"], "agreement_id": agreement["id"], "amount": float(amount), **_details(payload),
    })
    if _more_than_owing_with_earlier(charge, payment):
        # Kept as a corrected receipt, so the ledger shows what happened; it no longer counts.
        _db().table(PAYMENTS).update(stamp_update(PAYMENTS, {"status": CANCELLED})) \
            .eq("id", payment["id"]).eq("status", SUCCEEDED).execute()
        _record_event(owner, RECEIPT_CORRECTED, RECEIPT_ENTITY, payment["id"], {
            "note": "Withdrawn: recorded at the same moment as another receipt, together more than was owing.",
            "amount": float(amount), "charge_id": charge["id"], "from_status": SUCCEEDED, "to_status": CANCELLED,
        })
        raise HTTPException(status.HTTP_409_CONFLICT, OVERPAID_AT_ONCE)
    return _receipt_view(payment), True


def _payment_of(owner: str, payment_id: str) -> dict:
    """A payment on a charge of the owner's agreement; 404 for anyone else's."""
    rows = (_db().table(PAYMENTS).select(PAYMENT_FIELDS).eq("id", payment_id).limit(1).execute().data or []) \
        if is_uuid(payment_id) else []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["receipt"])
    charges = _db().table(CHARGES).select(CHARGE_FIELDS).eq("id", rows[0]["charge_id"]).limit(1).execute().data or []
    try:
        if not charges:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["receipt"])
        _agreement_of(owner, charges[0]["agreement_id"])
    except HTTPException:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["receipt"]) from None
    return rows[0]


def correct_receipt(owner: str, payment_id: str, note: str) -> dict:
    """Cancel a receipt the owner recorded, with why; it stays in the ledger and stops counting."""
    payment = _payment_of(owner, payment_id)
    if _source(payment) != "owner_recorded":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a receipt you recorded can be corrected here.")
    if payment.get("status") == CANCELLED:
        if RECEIPT_CORRECTED in _events(RECEIPT_ENTITY, [RECEIPT_CORRECTED], [payment["id"]]).get(payment["id"], {}):
            raise HTTPException(status.HTTP_409_CONFLICT, "This receipt is already corrected.")
    elif payment.get("status") != SUCCEEDED:
        raise HTTPException(status.HTTP_409_CONFLICT, "This receipt cannot be corrected.")
    else:
        changed = (_db().table(PAYMENTS).update(stamp_update(PAYMENTS, {"status": CANCELLED}))
                   .eq("id", payment["id"]).eq("status", SUCCEEDED).execute().data or [])
        if not changed:
            raise HTTPException(status.HTTP_409_CONFLICT, "This receipt changed meanwhile. Reload the ledger.")
        payment = changed[0]
    # A receipt cancelled before its note was saved gets it now.
    _record_event(owner, RECEIPT_CORRECTED, RECEIPT_ENTITY, payment["id"], {
        "note": note, "amount": float(_money(payment.get("amount"))), "charge_id": payment["charge_id"],
        "from_status": SUCCEEDED, "to_status": CANCELLED,
    })
    return _receipt_view(payment)


def _expense_view(record: dict, owner: str) -> dict:
    listing = _listings(owner, [record["listing_id"]]).get(record["listing_id"])
    correction = _events(RECORD_ENTITY, [EXPENSE_CORRECTED], [record["id"]]).get(record["id"], {})
    return _expense_out(record, listing, correction.get(EXPENSE_CORRECTED))


def create_expense(owner: str, access_token: str, payload: dict) -> dict:
    """An expense record, made by mobile_owner_assistant_action as the owner (create_record, kind expense)."""
    data = {"amount": float(payload["amount"]), "date": payload["date"].isoformat(), "category": payload["category"]}
    if payload.get("note"):
        data["note"] = payload["note"]
    answer = _call(user_client(access_token), "mobile_owner_assistant_action", {
        "p_request": str(payload["request_id"]),
        "p_operation": "create_record",
        "p_payload": {"listingId": str(payload["listing_id"]), "kind": EXPENSE_KIND, "title": payload["title"],
                      "data": data},
        "p_confirmed": True,
    })
    record = (answer or {}).get("record") if isinstance(answer, dict) else None
    if not record:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The expense could not be confirmed. Reload the ledger.")
    return _expense_view(record, owner)


def _expense_of(owner: str, record_id: str) -> dict:
    rows = (_db().table(RECORDS).select("*").eq("id", record_id).eq("owner_user_id", owner).eq("kind", EXPENSE_KIND)
            .limit(1).execute().data or []) if is_uuid(record_id) else []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND["expense"])
    return rows[0]


def correct_expense(owner: str, access_token: str, record_id: str, payload: dict) -> dict:
    """Cancel an expense through mobile_owner_assistant_action (cancel_record), and keep why."""
    record = _expense_of(owner, record_id)
    if record.get("status") == EXPENSE_CANCELLED and EXPENSE_CORRECTED in _events(
            RECORD_ENTITY, [EXPENSE_CORRECTED], [record["id"]]).get(record["id"], {}):
        raise HTTPException(status.HTTP_409_CONFLICT, "This expense is already corrected.")
    if record.get("status") != EXPENSE_CANCELLED:
        answer = _call(user_client(access_token), "mobile_owner_assistant_action", {
            "p_request": str(payload["request_id"]),
            "p_operation": "cancel_record",
            "p_payload": {"recordId": record["id"]},
            "p_confirmed": True,
        })
        record = ((answer or {}).get("record") if isinstance(answer, dict) else None) or _expense_of(owner, record_id)
    _record_event(owner, EXPENSE_CORRECTED, RECORD_ENTITY, record["id"], {
        "note": payload["note"], "amount": float(_money((record.get("payload") or {}).get("amount"))),
        "listing_id": record["listing_id"],
    })
    return _expense_view(record, owner)


# ---------------------------------------------------------------------------
# The tenant's rent
# ---------------------------------------------------------------------------
def tenant_rent(access_token: str) -> dict:
    """The tenant's ACTIVE agreements and charges, from mobile_my_rent_summary as the tenant."""
    summary = _call(user_client(access_token), "mobile_my_rent_summary", {}) or []
    today = sydney_today()
    listing_rows = select_in(lambda: _db().table(LISTINGS).select("id, title, property_id").order("id"), "id",
                             [item["listingId"] for item in summary if item.get("listingId")])
    places = _places({row["property_id"] for row in listing_rows})
    listings = {row["id"]: row for row in listing_rows}
    agreements, due_total, paid_total, outstanding_total, overdue_total = [], ZERO, ZERO, ZERO, ZERO
    for item in summary:
        listing = listings.get(item.get("listingId")) or {}
        charges = []
        for charge in item.get("charges") or []:
            due, paid = _money(charge.get("amountDue")), _money(charge.get("amountPaid"))
            outstanding = max(due - paid, ZERO)
            state = payment_status(due, paid, _day(charge["dueDate"]), today)
            due_total += due
            paid_total += paid
            outstanding_total += outstanding
            if state == "OVERDUE":
                overdue_total += outstanding
            charges.append({
                "id": charge["chargeId"], "period_start": _day(charge.get("periodStart")),
                "period_end": _day(charge.get("periodEnd")), "due_date": _day(charge["dueDate"]),
                "amount_due": float(due), "amount_paid": float(paid), "amount_outstanding": float(outstanding),
                "payment_status": state,
            })
        agreements.append({
            "id": item["agreementId"],
            "listing_id": item.get("listingId"),
            "listing_title": listing.get("title"),
            "locality": locality(places[listing["property_id"]]) if listing.get("property_id") in places else None,
            "rent_amount": float(_money(item.get("rentAmount"))),
            "rent_frequency": item.get("rentFrequency"),
            "start_date": _day(item.get("startDate")),
            "first_due_date": _day(item.get("firstDueDate")),
            "charges": charges,
        })
    return {
        "today": today,
        "agreements": agreements,
        "totals": {"rent_due": float(due_total), "paid": float(paid_total), "outstanding": float(outstanding_total),
                   "overdue": float(overdue_total)},
    }
