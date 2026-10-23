"""Records every mutating request in the audit trail.

Belt-and-braces coverage for SCOPE.md's "every user action has an audit trail
entry": service code names the interesting events, and this catches everything
else so a newly added route is never silently untracked.

Only successful mutations are recorded. Failed and unauthenticated attempts are
not user *actions* on data, and logging them would drown the trail in noise.

The rows go to the web schema's audit_log (audit.record), never to the shared
mobile_admin_audit_entries: one row per request would flood the log that the
mobile admin console reads.
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.services import audit

logger = logging.getLogger(__name__)

MUTATING_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if request.method not in MUTATING_METHODS:
            return response
        if any(part in request.url.path for part in audit.IGNORED_PATH_PARTS):
            return response
        if response.status_code >= 400:
            return response

        actor_id = getattr(request.state, "actor_id", None)
        if actor_id is None:
            # Unauthenticated mutation (login, register). The auth service logs
            # those itself, where the resulting user id is actually known.
            return response

        audit.record(
            actor_id=actor_id,
            action=f"{request.method.lower()}:{request.url.path}",
            metadata={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
            },
        )
        return response
