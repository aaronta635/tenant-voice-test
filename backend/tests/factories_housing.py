"""Rows the Housing Portal reads (tracker R41), and a portal with one of each.

Each holds every NOT NULL column without a default, so strict seeds take
them (docs/shared-db.md). Pass the rest as keyword arguments.
"""

from tests.factories import NOW
from tests.factories_admin import issue_category
from tests.factories_reviews_complaints import complaint, property_row, review, user

OFFICER = "e1000000-0000-4000-8000-000000000001"
ADMIN = "e1000000-0000-4000-8000-000000000002"
TENANT = "e1000000-0000-4000-8000-000000000003"
OWNER = "e1000000-0000-4000-8000-000000000004"
HOME = "e2000000-0000-4000-8000-000000000001"
COMPLAINT = "e3000000-0000-4000-8000-000000000001"
CATEGORY = "e4000000-0000-4000-8000-000000000001"
ALERT = "e5000000-0000-4000-8000-000000000001"
REFERRAL = "e6000000-0000-4000-8000-000000000001"
RULE = "e7000000-0000-4000-8000-000000000001"
EVENT = "e8000000-0000-4000-8000-000000000001"
FLAG = "RF-1001"
SURVEY = "SV-2001"


def alert(id, complaint_id, severity="CRITICAL", **over) -> dict:
    """A mobile_admin_alerts row an admin escalated."""
    return {"id": id, "complaint_id": complaint_id, "category_id": CATEGORY, "severity": severity, "status": "ESCALATED",
            "title": "Mould and no hot water", "reason": "Open 21 days with 3 complaints at the same home.",
            "threshold_snapshot": {"daysOpen": 21, "propertyOpenComplaints": 3, "ownerOpenComplaints": 4},
            "metadata": {"area": "Glebe", "routingTeam": "Housing Resolution Team"},
            "created_at": NOW, "updated_at": NOW, **over}


def referral(id, alert_id, complaint_id, status="REFERRED", **over) -> dict:
    """A mobile_admin_referral_packages row, as mobile_admin_escalate_alert prepares it."""
    return {
        "id": id, "alert_id": alert_id, "complaint_id": complaint_id, "status": status,
        "prepared_snapshot": {
            "caseReference": "TV-E5000000",
            "complaint": {"id": complaint_id, "title": "Mould and no hot water", "description": "Mould in every room.",
                          "category": "MAINTENANCE", "severity": "CRITICAL", "status": "ESCALATED", "lodgedAt": NOW},
            "property": {"id": HOME, "address": "12 Harbour St, Glebe, NSW, 2037", "area": "Glebe"},
            "parties": {"tenantId": TENANT, "tenantName": "Tess Tenant", "ownerId": OWNER, "ownerName": "Owen Owner"},
            "routingTeam": "Housing Resolution Team", "preparedAt": NOW,
        },
        "evidence_snapshot": {
            "triggerReason": "Open 21 days with 3 complaints at the same home.",
            "thresholds": {"daysOpen": 21, "propertyOpenComplaints": 3, "ownerOpenComplaints": 4},
            "photos": ["repair-photos/e1/one.jpg", "repair-photos/e1/two.jpg"],
            "documentsVerified": True,
            "workOrderStatus": "OPEN",
            "complaintEvents": [{"type": "LODGED", "note": "Lodged by the tenant.", "createdAt": NOW}],
        },
        "admin_note": "Owner has not answered in three weeks.", "referred_by": ADMIN, "referred_at": NOW,
        "updated_at": NOW, **over,
    }


def rule(id, name="Repeated complaints", **over) -> dict:
    return {"id": id, "rule_key": f"rule_{id[:8]}", "name": name, "updated_at": NOW, **over}


def event(id, rule_id, property_id, status="OPEN", **over) -> dict:
    """A red_flag_events row as evaluate_red_flag_rule_for_property writes it."""
    return {"id": id, "rule_id": rule_id, "property_id": property_id, "summary": "Repeated complaints: complaint threshold reached",
            "status": status, "triggered_at": NOW,
            "evidence": {"details": "3 complaints were recorded for this property within 30 days.", "complaintCount": 3,
                         "thresholdCount": 3, "triggerMode": "WINDOW", "windowDays": 30}, **over}


def flag(id, status="New", **over) -> dict:
    return {"id": id, "severity": "high", "title": "Bond complaints rising", "area": "Parramatta", "category": "Bonds",
            "reports": 12, "threshold": 10, "status": status, "raised_at": NOW, **over}


def survey(id, status="Draft", **over) -> dict:
    return {"id": id, "title": "Rental repairs pulse", "audience": "Tenants", "status": status, "created_at": NOW, **over}


def question(id, survey_id, sort_order, text) -> dict:
    return {"id": id, "survey_id": survey_id, "sort_order": sort_order, "question_text": text}


def seed_case(db) -> None:
    """The people, a home in Glebe, a complaint about it, its escalated alert and the referral package."""
    db.seed("users", [user(TENANT, "Tess Tenant"), user(OWNER, "Owen Owner", "LANDLORD"),
                      user(ADMIN, "Ada Admin", "ADMIN")])
    db.seed("properties", [property_row(HOME, OWNER, suburb="Glebe", postcode="2037")])
    db.seed("mobile_admin_issue_categories", [issue_category(CATEGORY, "MAINTENANCE", "Maintenance")])
    db.seed("complaints", [complaint(COMPLAINT, TENANT, property_id=HOME, category="MAINTENANCE", severity="CRITICAL",
                                     status="ESCALATED")])
    db.seed("mobile_admin_alerts", [alert(ALERT, COMPLAINT)])
    db.seed("mobile_admin_referral_packages", [referral(REFERRAL, ALERT, COMPLAINT)])


def seed_portal(db) -> None:
    """seed_case, plus a review, a red-flag event, a regulatory alert and a survey."""
    seed_case(db)
    db.seed("reviews", [review("e9000000-0000-4000-8000-000000000001", TENANT, OWNER, rating=2, property_id=HOME)])
    db.seed("red_flag_rules", [rule(RULE)])
    db.seed("red_flag_events", [event(EVENT, RULE, HOME, complaint_id=COMPLAINT)])
    db.seed("regulatory_red_flags", [flag(FLAG)])
    db.seed("regulatory_surveys", [survey(SURVEY)])
    db.seed("regulatory_survey_questions", [question(1, SURVEY, 1, "How quickly was your repair done?")])
