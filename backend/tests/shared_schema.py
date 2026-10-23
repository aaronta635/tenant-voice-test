"""A users row as the shared (mobile) schema stores it, for the messaging factories."""

from tests.factories import NOW


def shared_user(id, primary_role, full_name, **metadata):
    """A users row with every NOT NULL column it has no default for; metadata holds the person's area."""
    return {
        "id": id,
        "auth_user_id": id,
        "email": "private@example.test",
        "full_name": full_name,
        "primary_role": primary_role,
        "avatar_url": None,
        "phone": "0400 000 000",
        "status": "ACTIVE",
        "metadata": metadata,
        "created_at": NOW,
        "updated_at": NOW,
    }
