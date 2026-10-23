"""The owner's rent ledger and the tenant's rent (tracker R27).

Money is AUD with cents. A receipt the owner records is "Recorded by
owner": TenantVoice never collects rent or takes a payment online.
"""

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# mobile_my_rent_summary's paymentStatus, with "today" in Sydney.
PaymentStatus = Literal["PAID", "OVERDUE", "PARTIALLY_PAID", "UNPAID"]
# How the owner was paid; kept with the receipt's details.
ReceiptMethod = Literal["bank_transfer", "cash", "cheque", "card", "other"]
# Where a rent_payments row came from: the owner's own record, a Stripe
# payment the mobile app verified, or another app's row.
ReceiptSource = Literal["owner_recorded", "stripe", "other"]
ExpenseCategory = Literal[
    "repairs", "cleaning", "insurance", "council_rates", "strata", "utilities", "agent_fees", "other",
]
# What the database accepts (rent_payments_amount_check, mobile_owner_assistant_action): above zero,
# at most 99,999,999.99, whole cents.
Amount = Annotated[Decimal, Field(gt=0, le=Decimal("99999999.99"), decimal_places=2)]


class ReceiptIn(BaseModel):
    """A payment the owner says they received, recorded against one charge."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    amount: Amount
    # The day the money reached the owner, in Sydney; never in the future.
    received_on: dt.date
    method: ReceiptMethod
    reference: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=500)
    # Made once per receipt form: sending it again never records a second receipt.
    idempotency_key: uuid.UUID


class CorrectionIn(BaseModel):
    """Why a receipt is corrected: it stays in the ledger, cancelled, with this note."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    note: str = Field(min_length=3, max_length=500)


class ExpenseIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    listing_id: uuid.UUID
    title: str = Field(min_length=1, max_length=160)
    amount: Amount
    # The day the expense was paid, in Sydney; never in the future.
    date: dt.date
    category: ExpenseCategory
    note: str | None = Field(default=None, max_length=500)
    # Made once per expense form, as the mobile owner tools send p_request.
    request_id: uuid.UUID


class ExpenseCorrectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    note: str = Field(min_length=3, max_length=500)
    request_id: uuid.UUID


class ChargeRunOut(BaseModel):
    """What the owner's "Create the next charge" did: 0 or 1 new charge."""

    created: int
    message: str


class LedgerReceiptOut(BaseModel):
    id: str
    charge_id: str
    amount: float
    # rent_payments.status: SUCCEEDED, CANCELLED (a correction), or another app's status.
    status: str
    # Counts toward the charge's balance, as mobile_my_rent_summary counts it: SUCCEEDED and verified.
    counted: bool
    source: ReceiptSource
    # "Recorded by owner" for the owner's own receipts; never "collected" or "paid online".
    source_label: str
    received_on: dt.date | None = None
    method: ReceiptMethod | None = None
    reference: str | None = None
    note: str | None = None
    recorded_at: dt.datetime
    # Only the owner's own receipts can be corrected here.
    correctable: bool
    corrected_at: dt.datetime | None = None
    correction_note: str | None = None


class LedgerChargeOut(BaseModel):
    id: str
    agreement_id: str
    listing_id: str
    listing_title: str
    property_address: str | None = None
    tenant_id: str
    tenant_name: str | None = None
    period_start: dt.date
    period_end: dt.date
    due_date: dt.date
    amount_due: float
    amount_paid: float
    amount_outstanding: float
    payment_status: PaymentStatus
    receipts: list[LedgerReceiptOut]


class LedgerExpenseOut(BaseModel):
    id: str
    listing_id: str
    listing_title: str
    title: str
    amount: float
    date: dt.date | None = None
    category: str | None = None
    note: str | None = None
    # owner_assistant_records.status: recorded, or cancelled by a correction.
    status: str
    counted: bool
    created_at: dt.datetime
    corrected_at: dt.datetime | None = None
    correction_note: str | None = None


class LedgerAgreementOut(BaseModel):
    id: str
    listing_id: str
    listing_title: str
    property_address: str | None = None
    tenant_id: str
    tenant_name: str | None = None
    rent_amount: float
    rent_frequency: str
    start_date: dt.date
    end_date: dt.date | None = None
    first_due_date: dt.date


class LedgerListingOut(BaseModel):
    id: str
    title: str
    property_address: str | None = None
    # Whether an ACTIVE agreement bills rent on it.
    rented: bool
    # Expenses go only on a listing whose property the owner owns (mobile_owner_assistant_action).
    takes_expenses: bool


class LedgerTenantOut(BaseModel):
    id: str
    name: str | None = None


class LedgerFiltersOut(BaseModel):
    listing_id: str | None = None
    tenant_id: str | None = None
    from_date: dt.date | None = None
    to_date: dt.date | None = None


class LedgerTotalsOut(BaseModel):
    charges: int
    rent_due: float
    # The receipts that count, on the charges shown.
    received: float
    outstanding: float
    # What is still owed on OVERDUE charges.
    overdue: float
    expenses: float
    # Received less expenses.
    net: float


class RentLedgerOut(BaseModel):
    # The calendar day in Sydney that OVERDUE is measured against.
    today: dt.date
    generated_at: dt.datetime
    filters: LedgerFiltersOut
    listings: list[LedgerListingOut]
    tenants: list[LedgerTenantOut]
    agreements: list[LedgerAgreementOut]
    charges: list[LedgerChargeOut]
    expenses: list[LedgerExpenseOut]
    totals: LedgerTotalsOut


class TenantChargeOut(BaseModel):
    id: str
    period_start: dt.date
    period_end: dt.date
    due_date: dt.date
    amount_due: float
    amount_paid: float
    amount_outstanding: float
    payment_status: PaymentStatus


class TenantAgreementOut(BaseModel):
    id: str
    listing_id: str
    listing_title: str | None = None
    locality: str | None = None
    rent_amount: float
    rent_frequency: str
    start_date: dt.date
    first_due_date: dt.date
    charges: list[TenantChargeOut]


class TenantRentTotalsOut(BaseModel):
    rent_due: float
    paid: float
    outstanding: float
    overdue: float


class TenantRentOut(BaseModel):
    today: dt.date
    agreements: list[TenantAgreementOut]
    totals: TenantRentTotalsOut
