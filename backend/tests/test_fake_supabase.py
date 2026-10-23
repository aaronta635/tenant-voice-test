"""The fake evaluates or_() terms as PostgREST does, where a difference would hide a bug."""

import uuid

A, B, C = (str(uuid.UUID(int=n)) for n in (0xA, 0xB, 0xC))
T1, T2 = (str(uuid.UUID(int=n)) for n in (0x71, 0x72))


def test_or_filters_match_and_groups(fake_db):
    # connections.create_connection looks a pair up in either direction this way.
    a_to_b, b_to_c = str(uuid.uuid4()), str(uuid.uuid4())
    fake_db.seed("connection_requests", [
        {"id": a_to_b, "sender_user_id": A, "receiver_user_id": B},
        {"id": b_to_c, "sender_user_id": B, "receiver_user_id": C},
    ])

    def pair(x, y):
        return fake_db.table("connection_requests").select("id").or_(
            f"and(sender_user_id.eq.{x},receiver_user_id.eq.{y}),and(sender_user_id.eq.{y},receiver_user_id.eq.{x})"
        ).execute().data

    assert pair(A, B) == pair(B, A) == [{"id": a_to_b}]
    assert pair(A, C) == []
    either = fake_db.table("connection_requests").select("id").or_(f"sender_user_id.eq.{C},receiver_user_id.eq.{C}")
    assert either.execute().data == [{"id": b_to_c}]


def test_or_terms_compare_timestamps_and_numbers_as_postgres_does(fake_db):
    # conversations._unread_by_thread asks for each thread's messages after its own time this way.
    early, late, other = (str(uuid.UUID(int=n)) for n in (1, 2, 3))
    fake_db.seed("messages", [
        {"id": early, "conversation_id": T1, "created_at": "2025-12-31T09:59:59.5+00:00"},
        {"id": late, "conversation_id": T1, "created_at": "2025-12-31T10:00:00.25+00:00"},
        {"id": other, "conversation_id": T2, "created_at": "2025-12-31T08:00:00+00:00"},
    ])

    def ids(table, conditions):
        rows = fake_db.table(table).select("id").or_(conditions).order("id").execute().data
        return [row["id"] for row in rows]

    assert ids("messages", f"and(conversation_id.eq.{T1},created_at.gt.2025-12-31T10:00:00Z)") == [late]
    assert ids("messages", f"and(conversation_id.eq.{T1},created_at.lte.2025-12-31T10:00:00+00:00),"
                           f"conversation_id.eq.{T2}") == [early, other]
    assert fake_db.table("messages").select("id").gt("created_at", "2025-12-31T09:00:00+00:00").lt(
        "created_at", "2025-12-31T10:00:00+00:00").execute().data == [{"id": early}]

    fake_db.seed("mobile_provider_services", [
        {"id": id, "provider_user_id": A, "title": "Job", "price": price, "inclusions": [], "exclusions": []}
        for id, price in ((early, 9), (late, 10))
    ])
    assert ids("mobile_provider_services", "price.gt.9.5") == [late]  # as numbers: as text, "10" sorts before "9.5"
