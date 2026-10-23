from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.invoices import InvoiceCreate, InvoiceDocumentOut, InvoiceOut, InvoiceUpdate
from app.services import invoices as invoices_service
from app.services import service_providers as service_providers_service

router = APIRouter(prefix="/me/invoices", tags=["invoices"])


@router.get("", response_model=list[InvoiceOut])
def list_my_invoices(current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return invoices_service.list_my_invoices(provider["id"])


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_my_invoice(invoice_id: str, current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return invoices_service.get_my_invoice(invoice_id, provider["id"])


@router.get("/{invoice_id}/document", response_model=InvoiceDocumentOut)
def get_my_invoice_document(invoice_id: str, current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return invoices_service.invoice_document(invoice_id, provider)


@router.post("", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def create_my_invoice(
    payload: InvoiceCreate, current: CurrentProfile = Depends(require_role("service_provider"))
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return invoices_service.create_invoice(provider["id"], payload.model_dump(mode="json"))


@router.patch("/{invoice_id}", response_model=InvoiceOut)
def update_my_invoice(
    invoice_id: str,
    payload: InvoiceUpdate,
    current: CurrentProfile = Depends(require_role("service_provider")),
):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    return invoices_service.update_invoice(invoice_id, provider["id"], payload.model_dump(mode="json"))


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_invoice(invoice_id: str, current: CurrentProfile = Depends(require_role("service_provider"))):
    provider = service_providers_service.require_provider_by_profile_id(current.id)
    invoices_service.delete_invoice(invoice_id, provider["id"])
