from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client
from app.schemas.invoices import ALLOWED_TRANSITIONS
from app.services import _common

TABLE = "invoices"


def list_my_invoices(provider_id: str) -> list[dict]:
    return _common.list_owned(TABLE, provider_id, order_by="created_at", desc=True)


def get_my_invoice(invoice_id: str, provider_id: str) -> dict:
    return _common.get_owned(TABLE, invoice_id, provider_id)


def create_invoice(provider_id: str, payload: dict) -> dict:
    return _common.create_owned(TABLE, provider_id, payload)


def update_invoice(invoice_id: str, provider_id: str, payload: dict) -> dict:
    invoice = _common.get_owned(TABLE, invoice_id, provider_id)
    payload = {k: v for k, v in payload.items() if v is not None}

    new_status = payload.get("status")
    if new_status:
        allowed = ALLOWED_TRANSITIONS.get(invoice["status"], set())
        if new_status not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot transition invoice from {invoice['status']} to {new_status}",
            )
        if new_status == "issued":
            payload["issued_at"] = datetime.now(timezone.utc).isoformat()

    return _common.update_owned(TABLE, invoice_id, provider_id, payload)


def delete_invoice(invoice_id: str, provider_id: str) -> None:
    invoice = _common.get_owned(TABLE, invoice_id, provider_id)
    if invoice["status"] != "draft":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only draft invoices can be deleted")
    _common.delete_owned(TABLE, invoice_id, provider_id)
