"""The fake answers like the shared database's PostgREST (tests/fake_supabase.py, StrictSchema)."""

import uuid

import pytest
from postgrest.exceptions import APIError

from tests.fake_supabase import FakeSupabase, strict_tables

USER = "a1111111-1111-4111-8111-111111111111"
OTHER = "a2222222-2222-4222-8222-222222222222"
NOW = "2026-01-01T00:00:00+00:00"


def _fails(code: str, query, match: str | None = None) -> APIError:
    with pytest.raises(APIError) as caught:
        query.execute()
    assert caught.value.code == code, caught.value.message
    if match:
        assert match in caught.value.message
    return caught.value


def _user(id=USER, **over) -> dict:
    return {"id": id, "email": f"{id[:4]}@example.test", "updated_at": NOW, **over}


def _seed_listing(db, listing="b1111111-1111-4111-8111-111111111111", suburb="Newtown"):
    prop = str(uuid.uuid4())
    db.seed("properties", [{"id": prop, "owner_user_id": USER, "address_line_1": "1 Test St", "suburb": suburb,
                            "state": "NSW", "postcode": "2042", "updated_at": NOW}])
    db.seed("listings", [{"id": listing, "property_id": prop, "created_by_user_id": USER, "title": f"{suburb} flat",
                          "weekly_rent": 600, "updated_at": NOW}])
    return listing


# -- tables and schemas ------------------------------------------------------
def test_only_tables_of_the_shared_schemas_exist(strict_schema):
    _fails("PGRST205", strict_schema.table("bookings").select("*"), "'public.bookings'")
    _fails("PGRST205", strict_schema.schema("web").table("users").select("*"), "'web.users'")
    _fails("PGRST106", strict_schema.schema("legacy").table("users").select("*"))
    assert strict_schema.schema("web").table("bookings").select("*").execute().data == []
    strict_schema.seed("users", [_user()])
    assert strict_schema.schema("public").table("users").select("id").execute().data == [{"id": USER}]


# -- reads --------------------------------------------------------------------
def test_unknown_columns_fail_in_selects_filters_and_orders(strict_schema):
    users = strict_schema.table

    _fails("42703", users("users").select("id, full_name, role"), "column users.role does not exist")
    _fails("42703", users("users").select("*").eq("role", "tenant"))
    _fails("42703", users("users").select("*").in_("profile_id", [USER]))
    _fails("42703", users("users").select("*").or_("full_name.ilike.%a%,location.ilike.%a%"))
    _fails("42703", users("users").select("*").order("last_seen_at", desc=True))
    _fails("42703", users("users").select("*").eq("meta->>location", "Newtown"))
    assert users("users").select("*").eq("metadata->>location", "Newtown").execute().data == []


def test_enum_and_uuid_filters_must_be_valid_values(strict_schema):
    requests = strict_schema.table("connection_requests").select("id")

    _fails("22P02", requests.eq("status", "pending"), 'invalid input value for enum "ConnectionStatus": "pending"')
    _fails("22P02", strict_schema.table("connection_requests").select("id").in_("status", ["PENDING", "accepted"]))
    _fails("22P02", strict_schema.table("users").select("id").eq("id", "profile-1"),
           'invalid input syntax for type uuid: "profile-1"')
    _fails("22P02", strict_schema.table("users").select("id").or_(f"id.eq.{USER},id.eq.mei"))
    assert strict_schema.table("connection_requests").select("id").eq("status", "PENDING").execute().data == []
    assert strict_schema.table("users").select("id").is_("deleted_at", "null").execute().data == []


def test_a_column_list_returns_those_columns_with_aliases_and_json_keys(strict_schema):
    strict_schema.seed("users", [_user(full_name="Mei Lin", metadata={"location": "Newtown", "pets": 2})])

    rows = strict_schema.table("users").select("id, name:full_name, metadata->>location, pets:metadata->pets").execute()

    assert rows.data == [{"id": USER, "name": "Mei Lin", "location": "Newtown", "pets": 2}]


def test_every_filter_reads_a_json_key_as_text(strict_schema):
    # The recommendations directory filters members on users.metadata this way.
    strict_schema.seed("users", [_user(metadata={"state": "NSW", "pets": 2}), _user(OTHER, metadata={"state": "VIC"})])

    def ids(narrow):
        return [row["id"] for row in narrow(strict_schema.table("users").select("id")).order("id").execute().data]

    assert ids(lambda q: q.ilike("metadata->>state", "nsw")) == [USER]
    assert ids(lambda q: q.neq("metadata->>state", "NSW")) == [OTHER]
    assert ids(lambda q: q.in_("metadata->>state", ["VIC", "QLD"])) == [OTHER]
    assert ids(lambda q: q.eq("metadata->>pets", "2")) == [USER]
    assert ids(lambda q: q.is_("metadata->>pets", "null")) == [OTHER]


def test_rows_sort_with_postgres_null_order(strict_schema):
    strict_schema.seed("users", [_user(USER, full_name="B"), _user(OTHER, full_name=None),
                                 _user(str(uuid.uuid4()), full_name="A")])

    def names(**order):
        return [r["full_name"] for r in strict_schema.table("users").select("full_name").order("full_name", **order)
                .execute().data]

    assert names() == ["A", "B", None]
    assert names(desc=True) == [None, "B", "A"]
    assert names(desc=True, nullsfirst=False) == ["B", "A", None]
    assert names(nullsfirst=True) == [None, "A", "B"]


# -- writes -------------------------------------------------------------------
def test_inserts_fail_like_postgrest_and_postgres(strict_schema):
    notifications = strict_schema.table("notifications")
    good = {"user_id": USER, "title": "Hi", "body": "", "category": "social"}

    _fails("PGRST204", notifications.insert({**good, "link_href": "/x"}),
           "Could not find the 'link_href' column of 'notifications' in the schema cache")
    _fails("22P02", strict_schema.table("notifications").insert({**good, "category": "message"}),
           'invalid input value for enum "NotificationCategory": "message"')
    _fails("22P02", strict_schema.table("notifications").insert({**good, "user_id": "profile-1"}))
    _fails("23502", strict_schema.table("notifications").insert({**good, "body": None}),
           'null value in column "body" of relation "notifications" violates not-null constraint')
    _fails("23502", strict_schema.table("users").insert({"email": "x@example.test", "updated_at": NOW}),
           'column "id" of relation "users"')
    _fails("23502", strict_schema.table("users").insert({**_user(), "primary_role": None}))  # null beats a default
    assert not strict_schema.tables.get("notifications")


def test_inserts_get_the_column_defaults(strict_schema):
    web = strict_schema.schema("web")
    [user] = strict_schema.table("users").insert(_user()).execute().data
    strict_schema.seed("users", [_user(OTHER)])
    [booking] = web.table("bookings").insert({"client_id": USER, "provider_id": OTHER}).execute().data
    [entry] = web.table("audit_log").insert({"action": "auth.logged_in"}).execute().data
    [plan] = web.table("subscription_plans").insert({"code": "basic", "name": "Basic", "price": 9.99}).execute().data

    assert (user["primary_role"], user["status"], user["locale"], user["verification_status"]) == (
        "TENANT", "ACTIVE", "en-AU", "PENDING")
    assert (user["metadata"], user["deleted_at"], user["created_at"]) == (None, None, NOW)
    assert uuid.UUID(booking["id"]) and booking["status"] == "new_enquiry"
    assert booking["created_at"] == booking["updated_at"] > user["created_at"]  # the clock moves on
    assert (entry["metadata"], entry["actor_id"]) == ({}, None)
    assert (plan["audience"], plan["features"], plan["is_active"]) == ("landlord", [], True)


def test_a_web_check_list_rejects_other_values_with_23514(strict_schema):
    bookings = strict_schema.schema("web").table("bookings")

    _fails("23514", bookings.insert({"client_id": USER, "provider_id": OTHER, "status": "pending"}),
           'violates check constraint "bookings_status_check"')
    # Checked text is not an enum: a filter on another value just matches nothing.
    assert strict_schema.schema("web").table("bookings").select("id").eq("status", "pending").execute().data == []


def test_a_bulk_insert_writes_null_where_a_row_lacks_a_key(strict_schema):
    strict_schema.seed("users", [_user(), _user(OTHER)])
    rows = [{"client_id": USER, "provider_id": OTHER, "status": "confirmed"}, {"client_id": USER, "provider_id": OTHER}]

    _fails("23502", strict_schema.schema("web").table("bookings").insert(rows), 'column "status"')
    assert not strict_schema.schema_tables["web"].get("bookings")  # all or nothing
    inserted = strict_schema.schema("web").table("bookings").insert(rows, default_to_null=False).execute().data
    assert [row["status"] for row in inserted] == ["confirmed", "new_enquiry"]


def test_updates_check_keys_values_and_not_null(strict_schema):
    strict_schema.seed("users", [_user()])
    users = strict_schema.table

    _fails("PGRST204", users("users").update({"role": "tenant"}).eq("id", USER))
    _fails("22P02", users("users").update({"primary_role": "tenant"}).eq("id", USER))
    _fails("23502", users("users").update({"email": None}).eq("id", USER))
    updated = users("users").update({"full_name": "Mei"}).eq("id", USER).execute().data
    assert (updated[0]["full_name"], updated[0]["updated_at"]) == ("Mei", NOW)  # no trigger: callers stamp it


def test_web_updated_at_triggers_run(strict_schema):
    strict_schema.seed("users", [_user(), _user(OTHER)])
    web = strict_schema.schema("web")
    [booking] = web.table("bookings").insert({"client_id": USER, "provider_id": OTHER}).execute().data

    [updated] = web.table("bookings").update({"status": "confirmed"}).eq("id", booking["id"]).execute().data

    assert updated["updated_at"] > booking["updated_at"]
    _fails("23514", web.table("bookings").update({"status": "done"}).eq("id", booking["id"]))


def test_deletes_check_their_filters(strict_schema):
    strict_schema.seed("users", [_user(), _user(OTHER)])

    _fails("42703", strict_schema.table("users").delete().eq("role", "tenant"))
    removed = strict_schema.table("users").delete().eq("id", USER).execute().data
    assert [row["id"] for row in removed] == [USER]
    assert [row["id"] for row in strict_schema.tables["users"]] == [OTHER]


def test_seeds_are_stored_as_the_database_would_hold_them(strict_schema):
    strict_schema.seed("users", [_user()])

    assert strict_schema.tables["users"][0]["status"] == "ACTIVE"
    with pytest.raises(APIError, match="PGRST204"):
        strict_schema.seed("users", [{**_user(OTHER), "role": "tenant"}])
    with pytest.raises(APIError, match="23502"):
        strict_schema.seed("listings", [{"id": str(uuid.uuid4()), "title": "No property"}])


# -- keys and foreign keys ----------------------------------------------------
def test_a_repeated_primary_key_or_unique_value_fails_with_23505(strict_schema):
    strict_schema.seed("users", [_user()])
    faqs = strict_schema.schema("web")
    faq = {"audience": "all", "question": "How do I pay?", "answer": "By card."}

    _fails("23505", strict_schema.table("users").insert(_user(email="new@example.test")),
           'duplicate key value violates unique constraint "users_pkey"')
    [first] = faqs.table("faqs").insert(faq).execute().data
    error = _fails("23505", faqs.table("faqs").insert({**faq, "answer": "In cash."}), '"faqs_audience_question_key"')
    _fails("23505", faqs.table("faqs").insert([{**faq, "audience": "tenant"}, {**faq, "audience": "tenant"}]))
    [second] = faqs.table("faqs").insert({**faq, "audience": "tenant"}).execute().data
    _fails("23505", faqs.table("faqs").update({"audience": "all"}).eq("id", second["id"]))
    assert faqs.table("faqs").update({"answer": "By card or cash."}).eq("id", first["id"]).execute().data
    with pytest.raises(APIError, match="23505"):
        strict_schema.seed("users", [_user(email="again@example.test")])

    assert error.details == "Key (audience, question)=(all, How do I pay?) already exists."
    assert [row["audience"] for row in strict_schema.schema_tables["web"]["faqs"]] == ["all", "tenant"]
    assert len(strict_schema.tables["users"]) == 1


def test_a_partial_unique_index_compares_only_the_rows_its_where_fits(strict_schema):
    strict_schema.seed("users", [_user(), _user(OTHER)])
    web = strict_schema.schema("web").table
    [booking] = web("bookings").insert({"client_id": USER, "provider_id": OTHER}).execute().data
    invoice = {"provider_id": OTHER, "booking_id": booking["id"], "amount": 120}
    payment = {"provider_id": OTHER, "booking_id": booking["id"], "type": "payment", "amount": 120}

    web("invoices").insert({**invoice, "number": "INV-1"}).execute()
    _fails("23505", web("invoices").insert({**invoice, "number": "INV-2"}), '"uq_invoices_booking"')
    web("invoices").insert([{**invoice, "booking_id": None, "number": f"INV-{n}"} for n in (3, 4)]).execute()
    web("transactions").insert([payment, {**payment, "type": "platform_fee", "amount": -12}]).execute()
    _fails("23505", web("transactions").insert(payment), '"uq_transactions_booking_type"')
    web("transactions").insert([{**payment, "type": "refund", "amount": -60} for _ in range(2)]).execute()
    _fails("23505", web("transactions").update({"type": "payment"}).eq("type", "refund"))

    assert sorted(row["type"] for row in strict_schema.schema_tables["web"]["transactions"]) == [
        "payment", "platform_fee", "refund", "refund"]


def test_a_foreign_key_must_point_at_a_row_that_exists(strict_schema):
    strict_schema.seed("users", [_user()])
    web = strict_schema.schema("web").table
    approver, approved = str(uuid.uuid4()), str(uuid.uuid4())

    error = _fails("23503", web("bookings").insert({"client_id": USER, "provider_id": OTHER}),
                   'insert or update on table "bookings" violates foreign key constraint "bookings_provider_id_fkey"')
    _fails("23503", strict_schema.table("notifications").insert(
        {"user_id": OTHER, "title": "Hi", "body": "", "category": "social"}), '"notifications_user_id_fkey"')
    _fails("23503", web("invoices").insert({"provider_id": USER, "booking_id": OTHER, "number": "1", "amount": 1}),
           '"invoices_booking_id_fkey"')
    [booking] = web("bookings").insert({"client_id": USER, "provider_id": USER}).execute().data
    _fails("23503", web("bookings").update({"provider_id": OTHER}).eq("id", booking["id"]))
    assert web("audit_log").insert({"action": "auth.logged_in", "actor_id": None}).execute().data
    strict_schema.table("users").insert([_user(approver), _user(approved, approved_by_user_id=approver)]).execute()

    assert error.details == f'Key (provider_id)=({OTHER}) is not present in table "users".'
    assert [row["provider_id"] for row in strict_schema.schema_tables["web"]["bookings"]] == [USER]


def test_seeds_skip_foreign_keys_and_updates_check_only_keys_they_change(strict_schema):
    booking = str(uuid.uuid4())
    strict_schema.seed("bookings", [{"id": booking, "client_id": USER, "provider_id": OTHER}], schema="web")
    bookings = strict_schema.schema("web").table

    assert bookings("bookings").update({"status": "confirmed", "provider_id": OTHER}).eq("id", booking).execute().data
    _fails("23503", bookings("bookings").update({"client_id": OTHER}).eq("id", booking))


def test_deleting_a_row_still_pointed_at_fails_with_23503(strict_schema):
    # Without the catalog's rules (CATALOG_RULES off), a public foreign key's ON DELETE is unknown.
    strict_schema.catalog_rules = False
    strict_schema.seed("users", [_user(), _user(OTHER)])
    web = strict_schema.schema("web").table
    [plan] = web("subscription_plans").insert({"code": "basic", "name": "Basic", "price": 9.99}).execute().data
    web("user_subscriptions").insert({"user_id": USER, "plan_id": plan["id"]}).execute()
    web("provider_availability").insert({"provider_id": OTHER, "day_of_week": 1, "start_time": "09:00",
                                         "end_time": "17:00"}).execute()
    strict_schema.seed("notifications", [{"user_id": OTHER, "title": "Hi", "body": "", "category": "social"}])

    restricted = _fails("23503", web("subscription_plans").delete().eq("id", plan["id"]),  # on delete restrict
                        'update or delete on table "subscription_plans" violates foreign key constraint '
                        '"user_subscriptions_plan_id_fkey" on table "user_subscriptions"')
    # Public rules are unknown, so NO ACTION; the availability cascade is undone with the rest.
    unknown = _fails("23503", strict_schema.table("users").delete().eq("id", OTHER), '"notifications_user_id_fkey"')

    assert restricted.details == f'Key (id)=({plan["id"]}) is still referenced from table "user_subscriptions".'
    assert "Appendix A4" in unknown.hint and restricted.hint is None
    assert len(strict_schema.tables["users"]) == 2
    assert len(strict_schema.schema_tables["web"]["provider_availability"]) == 1


def test_with_the_catalog_a_public_delete_follows_its_own_rules(strict_schema):
    from tests.factories_rental import property_row

    strict_schema.catalog_rules = True
    strict_schema.seed("users", [_user(), _user(OTHER)])
    web = strict_schema.schema("web").table
    web("provider_availability").insert({"provider_id": OTHER, "day_of_week": 1, "start_time": "09:00",
                                         "end_time": "17:00"}).execute()
    strict_schema.seed("notifications", [{"user_id": OTHER, "title": "Hi", "body": "", "category": "social"}])
    home = property_row(OTHER)
    strict_schema.seed("properties", [home])

    # properties.owner_user_id is ON DELETE RESTRICT; the cascades are undone with the rest.
    _fails("23503", strict_schema.table("users").delete().eq("id", OTHER), '"properties_owner_user_id_fkey"')
    assert len(strict_schema.tables["users"]) == 2 and len(strict_schema.tables["notifications"]) == 1
    assert len(strict_schema.schema_tables["web"]["provider_availability"]) == 1

    strict_schema.table("properties").delete().eq("id", home["id"]).execute()
    strict_schema.table("users").delete().eq("id", OTHER).execute()

    # notifications.user_id is ON DELETE CASCADE.
    assert [row["id"] for row in strict_schema.tables["users"]] == [USER]
    assert strict_schema.tables["notifications"] == []
    assert strict_schema.schema_tables["web"]["provider_availability"] == []


def test_a_delete_cascades_or_sets_null_where_the_web_schema_says_so(strict_schema):
    strict_schema.seed("users", [_user(), _user(OTHER)])
    conversation = str(uuid.uuid4())
    strict_schema.seed("conversations", [{"id": conversation, "conversation_type": "DIRECT", "updated_at": NOW}])
    web = strict_schema.schema("web").table
    web("provider_availability").insert({"provider_id": OTHER, "day_of_week": 1, "start_time": "09:00",
                                         "end_time": "17:00"}).execute()
    [booking] = web("bookings").insert({"client_id": USER, "provider_id": OTHER,
                                        "conversation_id": conversation}).execute().data
    web("invoices").insert({"provider_id": USER, "booking_id": booking["id"], "number": "1", "amount": 1}).execute()
    web("audit_log").insert({"actor_id": OTHER, "action": "booking.created"}).execute()
    stored = strict_schema.schema_tables["web"]

    strict_schema.table("conversations").delete().eq("id", conversation).execute()  # set null, trigger runs
    assert stored["bookings"][0]["conversation_id"] is None
    assert stored["bookings"][0]["updated_at"] > booking["updated_at"]
    strict_schema.table("users").delete().eq("id", OTHER).execute()  # provider_id: cascade, then booking_id: set null
    assert (stored["bookings"], stored["provider_availability"]) == ([], [])
    assert [(row["booking_id"], row["provider_id"]) for row in stored["invoices"]] == [(None, USER)]
    assert stored["audit_log"][0]["actor_id"] is None


# -- embeds ---------------------------------------------------------------------
def test_embeds_follow_foreign_keys_both_ways(strict_schema):
    listing = _seed_listing(strict_schema)
    conversation = str(uuid.uuid4())
    strict_schema.seed("conversations", [{"id": conversation, "conversation_type": "DIRECT", "updated_at": NOW}])
    strict_schema.seed("conversation_participants", [
        {"id": str(uuid.uuid4()), "conversation_id": conversation, "user_id": uid} for uid in (USER, OTHER)
    ])

    [row] = strict_schema.table("listings").select("id, properties(suburb, address_line_1)").execute().data
    [thread] = (
        strict_schema.table("conversations").select("id, conversation_participants(user_id)")
        .order("user_id", foreign_table="conversation_participants").execute().data
    )

    assert row == {"id": listing, "properties": {"suburb": "Newtown", "address_line_1": "1 Test St"}}
    assert thread == {"id": conversation, "conversation_participants": [{"user_id": USER}, {"user_id": OTHER}]}
    _fails("42703", strict_schema.table("listings").select("id, properties(title)"), "column properties.title")


def test_an_embed_through_a_primary_key_is_one_object_or_null(strict_schema):
    # user_id is the primary key of both profile tables: one profile per user at most.
    strict_schema.seed("users", [_user(), _user(OTHER)])
    strict_schema.seed("service_provider_profiles", [{"user_id": USER, "company_name": "Sparkle", "updated_at": NOW}])
    strict_schema.seed("tenant_profiles", [{"user_id": OTHER, "updated_at": NOW}])

    rows = (strict_schema.table("users").select("id, service_provider_profiles(user_id, company_name), "
                                                "tenant_profiles(has_pets)").order("id").execute().data)
    providers = strict_schema.table("users").select("id, service_provider_profiles!inner(user_id)").execute().data

    assert rows == [
        {"id": USER, "service_provider_profiles": {"user_id": USER, "company_name": "Sparkle"},
         "tenant_profiles": None},
        {"id": OTHER, "service_provider_profiles": None, "tenant_profiles": {"has_pets": False}},
    ]
    assert providers == [{"id": USER, "service_provider_profiles": {"user_id": USER}}]


def test_an_embed_through_any_other_foreign_key_is_a_list(strict_schema):
    # notifications.user_id is no key; mobile_ai_chat_usage.user_id is only part of (user_id, usage_date).
    strict_schema.seed("users", [_user(), _user(OTHER)])
    strict_schema.seed("notifications", [{"user_id": USER, "title": title, "body": "", "category": "social"}
                                         for title in ("A", "B")])
    strict_schema.seed("mobile_ai_chat_usage", [{"user_id": USER, "usage_date": "2026-01-01", "calls": 2}])

    rows = (strict_schema.table("users").select("id, notifications(title), mobile_ai_chat_usage(calls)").order("id")
            .order("title", foreign_table="notifications").execute().data)

    assert rows == [
        {"id": USER, "notifications": [{"title": "A"}, {"title": "B"}], "mobile_ai_chat_usage": [{"calls": 2}]},
        {"id": OTHER, "notifications": [], "mobile_ai_chat_usage": []},
    ]


def test_a_unique_index_still_embeds_a_list(strict_schema):
    # One invoice per booking (uq_invoices_booking), but PostgREST reads constraints, not indexes.
    booking = str(uuid.uuid4())
    strict_schema.seed("bookings", [{"id": booking, "client_id": USER, "provider_id": OTHER}], schema="web")
    strict_schema.seed("invoices", [{"provider_id": OTHER, "booking_id": booking, "number": "1", "amount": 1}],
                       schema="web")

    rows = strict_schema.schema("web").table("bookings").select("id, invoices(number)").execute().data

    assert rows == [{"id": booking, "invoices": [{"number": "1"}]}]


def test_one_to_one_needs_the_whole_primary_key_or_a_unique_constraint():
    tables = strict_tables()

    assert tables[("public", "tenant_profiles")].one_to_one(("user_id",))
    assert not tables[("public", "mobile_ai_chat_usage")].one_to_one(("user_id",))
    assert tables[("web", "user_subscriptions")].one_to_one(("user_id",))  # "user_id ... unique"
    assert not tables[("web", "bookings")].one_to_one(("provider_id",))
    assert not tables[("web", "invoices")].one_to_one(("booking_id",))  # uq_invoices_booking is an index
    assert [key.name for key in tables[("web", "faqs")].keys] == ["faqs_pkey", "faqs_audience_question_key"]
    assert [key.columns for key in tables[("public", "mobile_ai_chat_usage")].keys] == [("user_id", "usage_date")]


def test_an_inner_embed_with_a_filter_keeps_matching_rows_only(strict_schema):
    _seed_listing(strict_schema, "b1111111-1111-4111-8111-111111111111", "Newtown")
    other = _seed_listing(strict_schema, "b2222222-2222-4222-8222-222222222222", "Enmore")

    def listings(select):
        return strict_schema.table("listings").select(select).eq("properties.suburb", "Enmore")

    assert [r["id"] for r in listings("id, properties!inner(suburb)").execute().data] == [other]
    assert [r["properties"] for r in listings("id, properties(suburb)").execute().data] == [None, {"suburb": "Enmore"}]
    _fails("PGRST108", strict_schema.table("listings").select("id").eq("properties.suburb", "Enmore"))


def test_an_ambiguous_or_missing_relationship_fails(strict_schema):
    _fails("PGRST201", strict_schema.table("reviews").select("id, users(full_name)"))
    assert strict_schema.table("reviews").select("id, users!reviewer_user_id(full_name)").execute().data == []
    _fails("PGRST200", strict_schema.table("users").select("id, bookings(id)"))
    with pytest.raises(AssertionError, match="another schema"):
        strict_schema.schema("web").table("bookings").select("id, users(full_name)").execute()
    assert strict_schema.schema("web").table("invoices").select("id, bookings(status)").execute().data == []


def test_counts_heads_and_embedded_pages(strict_schema):
    conversation = str(uuid.uuid4())
    strict_schema.seed("conversations", [{"id": conversation, "conversation_type": "GROUP", "updated_at": NOW}])
    strict_schema.seed("conversation_participants", [
        {"id": str(uuid.uuid4()), "conversation_id": conversation, "user_id": str(uuid.uuid4())} for _ in range(3)
    ])

    paged = (
        strict_schema.table("conversations").select("id, conversation_participants(user_id)", count="exact")
        .limit(2, foreign_table="conversation_participants").execute()
    )
    head = strict_schema.table("conversation_participants").select("id", count="exact", head=True).execute()

    assert (paged.count, len(paged.data[0]["conversation_participants"])) == (1, 2)
    assert (head.data, head.count) == ([], 3)


def test_or_terms_the_fake_cannot_evaluate_fail_loudly(strict_schema):
    with pytest.raises(AssertionError, match="only, not is"):
        strict_schema.table("users").select("id").or_("deleted_at.is.null,status.eq.ACTIVE").execute()


# -- rpc, auth and no lenient mode ----------------------------------------------
def test_rpcs_must_exist_with_their_parameters(strict_schema):
    strict_schema.rpc_results["get_unread_message_count"] = 3

    assert strict_schema.rpc("get_unread_message_count", {"p_user_id": USER}).execute().data == 3
    _fails("PGRST202", strict_schema.rpc("get_unread_messages", {"p_user_id": USER}))
    _fails("PGRST202", strict_schema.rpc("get_unread_message_count", {"user_id": USER}),
           "public.get_unread_message_count(user_id)")
    _fails("PGRST202", strict_schema.rpc("mark_conversation_read", {"p_user_id": USER}))
    _fails("22P02", strict_schema.rpc("get_unread_message_count", {"p_user_id": "me"}))
    _fails("PGRST202", strict_schema.schema("web").rpc("get_unread_message_count", {"p_user_id": USER}))
    assert strict_schema.rpc_calls[0] == ("get_unread_message_count", {"p_user_id": USER})


def test_the_fake_does_not_invent_a_users_row_for_new_auth_users(strict_schema):
    strict_schema.add_auth_user("new@example.test", full_name="New", role="tenant")

    assert not strict_schema.tables.get("users")


def test_every_fake_answers_like_the_shared_database(fake_db):
    # No test can fall back on a fake that takes any table, column or key.
    for db in (fake_db, FakeSupabase()):
        _fails("PGRST205", db.table("profiles").select("id"), "'public.profiles'")
        _fails("PGRST204", db.table("users").insert({**_user(), "role": "tenant"}))
        _fails("23505", db.table("users").insert([_user(), _user()]))
