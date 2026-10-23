"""Rows the admin console's moderation reads, and how tests sign its people in.

Each row holds every NOT NULL column without a default, so strict seeds take
them (docs/shared-db.md). Pass the rest as keyword arguments.
"""

from tests.factories import NOW
from tests.factories_identity import account


def issue_category(id, code, name, **over) -> dict:
    """A mobile_admin_issue_categories row, active unless told otherwise."""
    return {"id": id, "code": code, "name": name, "severity": "NORMAL", "sla_hours": 72,
            "source_categories": [code], "keywords": [], "created_at": NOW, "updated_at": NOW, **over}


def audit_entry(id, actor_id, action, entity_type, entity_id, **over) -> dict:
    """A mobile_admin_audit_entries row, such as a review report."""
    return {"id": id, "actor_user_id": actor_id, "action": action, "entity_type": entity_type,
            "entity_id": entity_id, "summary": action, "metadata": {}, "created_at": NOW, **over}


def bearer(fake_db, user_id, email, primary_role="TENANT", **over) -> dict:
    """The headers of a signed-in account: an auth user and its users row (tests.factories_identity.account)."""
    return {"Authorization": f"Bearer {account(fake_db, user_id, email, primary_role, **over)}"}


def named_trail(fake_db) -> list[dict]:
    """The web audit_log's named entries, leaving out AuditMiddleware's per-request ones."""
    return [entry for entry in fake_db.schema_tables.get("web", {}).get("audit_log", []) if ":" not in entry["action"]]


def shared_trail(fake_db, action=None) -> list[dict]:
    """mobile_admin_audit_entries, of one action if given."""
    return [entry for entry in fake_db.tables.get("mobile_admin_audit_entries", [])
            if action is None or entry["action"] == action]


def lands_first(monkeypatch, module, change) -> None:
    """Run change() once, just before module's next write: another admin's change landing between its read and write.

    It hooks module.stamp_update, which every admin write passes its changes
    through after reading the row and before sending the update.
    """
    stamp = module.stamp_update
    pending = [change]

    def stamped(table, changes, *args):
        if pending:
            pending.pop()()
        return stamp(table, changes, *args)

    monkeypatch.setattr(module, "stamp_update", stamped)
