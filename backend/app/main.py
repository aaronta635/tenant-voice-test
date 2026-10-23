import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError

from app.api.routes import (
    account_standing,
    admin,
    admin_alerts,
    admin_complaints,
    admin_moderation,
    admin_repairs,
    audit,
    auth,
    bookings,
    categories,
    complaint_categories,
    complaints,
    connections,
    content,
    conversations,
    dashboard,
    documents,
    health,
    housing_portal,
    inspections,
    invoices,
    leases,
    listing_imports,
    listing_views,
    maintenance,
    matching,
    onboarding,
    owner_assistant,
    password_reset,
    profiles,
    properties,
    property_applications,
    provider_availability,
    provider_jobs,
    provider_portfolio,
    provider_recommendations,
    provider_repairs,
    provider_services,
    provider_suggestions,
    public_profiles,
    red_flags,
    rent_ledger,
    reviews,
    saved_providers,
    scorecards,
    service_providers,
    subscriptions,
    support_chat,
    transactions,
    upload_scanning,
    uploads,
    verification_documents,
)
from app.core.audit_middleware import AuditMiddleware
from app.core.config import settings
from app.core.deps import SESSION_EXPIRED_HEADER

app = FastAPI(title=settings.app_name)
logger = logging.getLogger(__name__)

# Postgres/PostgREST error codes that mean "the client sent something invalid".
_BAD_INPUT_CODES = {"22P02", "22001", "22003", "22007", "22008", "22023", "23502", "23514", "23503"}


@app.exception_handler(APIError)
async def database_error(request: Request, exc: APIError) -> JSONResponse:
    """Turn database rejections into 4xx answers instead of a bare 500.

    Bad ids, unknown enum values and failed CHECK constraints are the caller's
    mistake; duplicates are conflicts. Details stay in the server log.
    """
    code = getattr(exc, "code", None)
    if code in _BAD_INPUT_CODES:
        return JSONResponse({"detail": "Some of the values sent are not valid."}, status_code=400)
    if code == "23505":
        return JSONResponse({"detail": "That already exists."}, status_code=409)
    if code == "PGRST116":
        return JSONResponse({"detail": "Not found."}, status_code=404)
    logger.error("database error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


# Outermost so it observes the final status code of every request.
app.add_middleware(AuditMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # The web reads it to refresh a session a public page's request found expired (core/deps.py).
    expose_headers=[SESSION_EXPIRED_HEADER],
)

routers = [
    health.router,
    auth.router,
    password_reset.router,
    profiles.router,
    onboarding.router,
    account_standing.router,
    public_profiles.router,
    service_providers.router,
    provider_services.router,
    verification_documents.router,
    documents.router,
    provider_availability.router,
    provider_portfolio.router,
    provider_recommendations.router,
    provider_suggestions.router,
    bookings.router,
    reviews.router,
    conversations.router,
    transactions.router,
    invoices.router,
    saved_providers.router,
    categories.router,
    properties.router,
    listing_views.router,
    listing_imports.router,
    property_applications.router,
    leases.router,
    connections.router,
    subscriptions.router,
    content.router,
    inspections.router,
    dashboard.router,
    uploads.router,
    upload_scanning.router,
    complaints.router,
    complaint_categories.router,
    audit.router,
    admin.router,
    admin_complaints.router,
    red_flags.router,
    admin_alerts.router,
    admin_moderation.router,
    admin_repairs.router,
    maintenance.router,
    provider_repairs.router,
    provider_jobs.router,
    owner_assistant.router,
    rent_ledger.router,
    matching.router,
    housing_portal.router,
    housing_portal.admin_router,
    support_chat.router,
    scorecards.router,
]
for router in routers:
    app.include_router(router, prefix=settings.api_prefix)


@app.get("/")
def root():
    return {"message": "TenantVoice API is running"}
