from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    auth,
    bookings,
    categories,
    connections,
    content,
    conversations,
    dashboard,
    health,
    invoices,
    profiles,
    properties,
    property_applications,
    provider_availability,
    provider_portfolio,
    provider_services,
    reviews,
    saved_providers,
    service_providers,
    subscriptions,
    transactions,
    verification_documents,
)
from app.core.config import settings

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

routers = [
    health.router,
    auth.router,
    profiles.router,
    service_providers.router,
    provider_services.router,
    verification_documents.router,
    provider_availability.router,
    provider_portfolio.router,
    bookings.router,
    reviews.router,
    conversations.router,
    transactions.router,
    invoices.router,
    saved_providers.router,
    categories.router,
    properties.router,
    property_applications.router,
    connections.router,
    subscriptions.router,
    content.router,
    dashboard.router,
]
for router in routers:
    app.include_router(router, prefix=settings.api_prefix)


@app.get("/")
def root():
    return {"message": "TenantVoice API is running"}
