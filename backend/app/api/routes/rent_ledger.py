"""The owner's rent ledger and the tenant's rent (tracker R27): services/rent_ledger.py.

Every route reads the caller's own rows only. The GETs write nothing: a
charge is created only by POST /me/rent/agreements/{id}/charges.
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.rent_ledger import (
    ChargeRunOut,
    CorrectionIn,
    ExpenseCorrectionIn,
    ExpenseIn,
    LedgerExpenseOut,
    LedgerReceiptOut,
    ReceiptIn,
    RentLedgerOut,
    TenantRentOut,
)
from app.services import rent_ledger as service

router = APIRouter(prefix="/me/rent", tags=["rent"])

owner_only = require_role("landlord")
tenant_only = require_role("tenant")


def ledger_filters(
    listing_id: UUID | None = None,
    tenant_id: UUID | None = None,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
) -> dict:
    """The ledger's filters: a listing, a tenant and due dates in Sydney (inclusive)."""
    return {
        "listing_id": str(listing_id) if listing_id else None,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "from_date": from_date,
        "to_date": to_date,
    }


@router.get("", response_model=TenantRentOut)
def my_rent(current: CurrentProfile = Depends(tenant_only)):
    """The tenant's active tenancies and their charges (mobile_my_rent_summary, as the tenant)."""
    return service.tenant_rent(current.access_token)


@router.get("/ledger", response_model=RentLedgerOut)
def owner_ledger(filters: dict = Depends(ledger_filters), current: CurrentProfile = Depends(owner_only)):
    return service.ledger(current.id, **filters)


@router.get("/ledger.csv", response_class=Response)
def owner_ledger_csv(filters: dict = Depends(ledger_filters), current: CurrentProfile = Depends(owner_only)):
    """The ledger the screen shows for these filters, as CSV, with the same totals."""
    data = service.ledger(current.id, **filters)
    # The byte order mark lets spreadsheet apps read the names as UTF-8.
    return Response(
        content="﻿" + service.ledger_csv(data),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{service.csv_filename(data)}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/agreements/{agreement_id}/charges", response_model=ChargeRunOut)
def create_next_charge(agreement_id: str, current: CurrentProfile = Depends(owner_only)):
    """The owner asks for the tenancy's next charge (generate_upcoming_rent_charges): one due within 7 days, once."""
    return service.create_next_charge(current.id, agreement_id)


@router.post("/charges/{charge_id}/receipts", response_model=LedgerReceiptOut, status_code=status.HTTP_201_CREATED)
def record_receipt(charge_id: str, payload: ReceiptIn, response: Response,
                   current: CurrentProfile = Depends(owner_only)):
    """A payment the owner received, recorded by them. The same form sent again answers 200 with that receipt."""
    receipt, created = service.record_receipt(current.id, charge_id, payload.model_dump())
    if not created:
        response.status_code = status.HTTP_200_OK
    return receipt


@router.post("/receipts/{receipt_id}/correction", response_model=LedgerReceiptOut)
def correct_receipt(receipt_id: str, payload: CorrectionIn, current: CurrentProfile = Depends(owner_only)):
    """Cancel a receipt the owner recorded, with a note: it stays in the ledger and no longer counts."""
    return service.correct_receipt(current.id, receipt_id, payload.note)


@router.post("/expenses", response_model=LedgerExpenseOut, status_code=status.HTTP_201_CREATED)
def create_expense(payload: ExpenseIn, current: CurrentProfile = Depends(owner_only)):
    return service.create_expense(current.id, current.access_token, payload.model_dump())


@router.post("/expenses/{expense_id}/correction", response_model=LedgerExpenseOut)
def correct_expense(expense_id: str, payload: ExpenseCorrectionIn, current: CurrentProfile = Depends(owner_only)):
    return service.correct_expense(current.id, current.access_token, expense_id, payload.model_dump())
