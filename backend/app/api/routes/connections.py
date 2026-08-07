from fastapi import APIRouter, Depends, Query, status

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.connections import (
    ConnectionCreate,
    ConnectionOut,
    ConnectionUpdate,
    ProfileSearchOut,
)
from app.services import connections as connections_service

router = APIRouter(tags=["connections"])


@router.get("/me/connections", response_model=list[ConnectionOut])
def list_my_connections(
    status_filter: str | None = Query(None, alias="status"),
    current: CurrentProfile = Depends(get_current_profile),
):
    return connections_service.list_connections(current.id, status_filter)


@router.post("/me/connections", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: ConnectionCreate, current: CurrentProfile = Depends(get_current_profile)
):
    return connections_service.create_connection(current.id, payload.addressee_id)


@router.patch("/me/connections/{connection_id}", response_model=ConnectionOut)
def respond_to_connection(
    connection_id: str,
    payload: ConnectionUpdate,
    current: CurrentProfile = Depends(get_current_profile),
):
    return connections_service.respond(connection_id, current.id, payload.status)


@router.delete("/me/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: str, current: CurrentProfile = Depends(get_current_profile)):
    connections_service.remove(connection_id, current.id)


@router.get("/profiles/search", response_model=list[ProfileSearchOut])
def search_profiles(
    search: str | None = None,
    role: str | None = None,
    limit: int = Query(24, ge=1, le=100),
    current: CurrentProfile = Depends(get_current_profile),
):
    return connections_service.search_profiles(current.id, search=search, role=role, limit=limit)
