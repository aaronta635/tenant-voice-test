from app.services import _common

TABLE = "verification_documents"


def list_my_documents(provider_id: str) -> list[dict]:
    return _common.list_owned(TABLE, provider_id, order_by="created_at", desc=True)


def create_document(provider_id: str, payload: dict) -> dict:
    return _common.create_owned(TABLE, provider_id, payload)


def update_document(document_id: str, provider_id: str, payload: dict) -> dict:
    return _common.update_owned(TABLE, document_id, provider_id, payload)


def delete_document(document_id: str, provider_id: str) -> None:
    _common.delete_owned(TABLE, document_id, provider_id)
