"""The strict fake with the shared catalog's rules on (CATALOG_RULES, StrictSchema).

CHECK constraints, unique constraints and indexes, ON DELETE rules and
requests as transactions, from app/db/shared_catalog.json. The triggers are
in test_fake_catalog_triggers.py.
"""

import pytest
from postgrest.exceptions import APIError

from app.core import supabase as supabase_module
from app.db import catalog
from tests import conftest, fake_rpcs, fake_sql
from tests.factories_catalog import (
    AGREEMENT, APPLICATION, LISTING, NOW, OTHER_LISTING, OWNER, PROPERTY, TENANT, agreement, fails, home, listing,
    user,
)
from tests.fake_supabase import FakeSupabase, api_error, catalog_gaps


@pytest.fixture
def db(fake_db):
    fake_db.catalog_rules = True
    return fake_db


# -- the switch ------------------------------------------------------------------
def test_the_fake_follows_the_conftest_switch_unless_told(monkeypatch):
    monkeypatch.setattr(conftest, "CATALOG_RULES", True)
    assert FakeSupabase().catalog_rules is True
    assert FakeSupabase(catalog_rules=False).catalog_rules is False
    monkeypatch.setattr(conftest, "CATALOG_RULES", False)
    assert FakeSupabase().catalog_rules is False


def test_without_the_rules_the_fake_keeps_the_schema_only_checks(fake_db):
    fake_db.catalog_rules = False
    home(fake_db)

    fake_db.table("listings").update({"weekly_rent": -5}).eq("id", LISTING).execute()  # no CHECK without the rules
    fake_db.catalog_rules = True

    fails("23514", fake_db.table("listings").update({"weekly_rent": -6}).eq("id", LISTING),
           '"listings_nonnegative_amounts_check"')


# -- nothing is skipped --------------------------------------------------------------
def test_every_rule_of_the_snapshot_is_enforced():
    assert catalog_gaps() == []


def test_every_check_of_the_snapshot_is_read_by_the_evaluator():
    unreadable = []
    for table, rules in catalog.snapshot()["tables"].items():
        for check in rules["checks"]:
            try:
                fake_sql.compile_expression(check["expression"])
            except fake_sql.SqlUnreadable as exc:
                unreadable.append(f"{table}.{check['name']}: {exc}")
    assert unreadable == []


def test_the_rules_on_a_table_are_the_snapshots(db):
    listings = db.strict.table("public", "listings")
    work_orders = db.strict.table("public", "maintenance_work_orders")

    assert [check.name for check in listings.checks] == ["listings_nonnegative_amounts_check",
                                                         "listings_positive_lease_term_check"]
    assert [trigger.name for trigger in listings.triggers] == [
        "listings_application_consistency_guard", "listings_creator_access_guard",
        "listings_status_transition_guard"]
    assert [key.name for key in work_orders.keys] == ["maintenance_work_orders_pkey",
                                                      "maintenance_work_orders_complaint_id_key"]


# -- the evaluator ----------------------------------------------------------------------
UUID = "0f8fad5b-d9cb-469f-a165-70867728950e"
TYPES = {"status": "text", "n": "numeric", "i": "int32", "s": "text", "d": "date", "t": "timestamp with time zone",
         "u": "uuid", "m": "jsonb", "b": "boolean", "e": 'public."ProfileDocumentReviewStatus"'}
REJECTION = ("((e <> 'REJECTED'::\"ProfileDocumentReviewStatus\") OR "
             "(NULLIF(TRIM(BOTH FROM COALESCE(s, ''::text)), ''::text) IS NOT NULL))")
SUCCEEDED = "((status <> ALL (ARRAY['SUCCEEDED'::text, 'REFUNDED'::text])) OR (t IS NOT NULL))"


@pytest.mark.parametrize(("expression", "row", "expected"), [
    ("(status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text]))", {"status": "OPEN"}, True),
    ("(status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text]))", {"status": "COMPLETED"}, False),
    ("(status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text]))", {"status": None}, None),
    (SUCCEEDED, {"status": "SUCCEEDED", "t": None}, False),
    (SUCCEEDED, {"status": "PENDING", "t": None}, True),
    ("((i >= 15) AND (i <= 1440))", {"i": 14}, False),
    ("((i >= 15) AND (i <= 1440))", {"i": "15"}, True),
    ("(n > (0)::numeric)", {"n": "0.00"}, False),
    ("((n > (0)::numeric) AND (n <= 99999999.99))", {"n": 650}, True),
    ("((n IS NULL) OR (n >= ('-90'::integer)::numeric))", {"n": -90.0}, True),
    ("((n IS NULL) OR (n >= ('-90'::integer)::numeric))", {"n": -90.5}, False),
    ("(NOT (b IS TRUE))", {"b": None}, True),
    ("(char_length(TRIM(BOTH FROM s)) >= 2)", {"s": " a\t"}, True),  # TRIM takes spaces only
    ("(char_length(TRIM(BOTH FROM s)) >= 2)", {"s": "  a  "}, False),
    ("(length(s) <= 3)", {"s": "abcd"}, False),
    ("(btrim(s) = 'x'::text)", {"s": "  x  "}, True),
    (REJECTION, {"e": "REJECTED", "s": "   "}, False),
    (REJECTION, {"e": "REJECTED", "s": None}, False),
    (REJECTION, {"e": "REJECTED", "s": "The photo is blurred."}, True),
    (REJECTION, {"e": "APPROVED", "s": None}, True),
    ("(s ~ '^[a-f0-9]{64}$'::text)", {"s": "a" * 64}, True),
    ("(s ~ '^[a-f0-9]{64}$'::text)", {"s": "a" * 64 + "\n"}, False),  # $ is the very end in Postgres
    ("(s ~ '^[a-f0-9]{64}$'::text)", {"s": "A" * 64}, False),
    ("(s ~* '^[0-9a-f-]{36}/[^/]+\\.pdf$'::text)", {"s": f"{UUID.upper()}/Lease.PDF"}, True),
    ("((split_part(s, '/'::text, 1) = (u)::text) AND (s ~* '^[0-9a-f-]{36}/[^/]+\\.pdf$'::text))",
     {"s": f"{UUID}/lease.pdf", "u": UUID.upper()}, True),
    ("(s = ((u)::text || '/lease-with-signing-evidence.pdf'::text))",
     {"s": f"{UUID}/lease-with-signing-evidence.pdf", "u": UUID}, True),
    ("((d IS NULL) OR (d >= '2026-01-01'::date))", {"d": "2025-12-31"}, False),
    ("(t > '2026-01-01 00:00:00+00'::timestamp with time zone)", {"t": "2026-01-01T11:00:00+11:00"}, False),
    ("(link ~~ '/payments/verified/%'::text)", {"link": "/payments/verified/1"}, True),
    ("(link ~~ '/payments/verified/%'::text)", {"link": "/payments/other/1"}, False),
    ("((m ->> 'key'::text) IS NOT NULL)", {"m": {"key": 5}}, True),
    ("((m ->> 'key'::text) IS NOT NULL)", {"m": {}}, False),
    ("(s IN ('a'::text, 'b'::text))", {"s": "b"}, True),
    ("(i NOT BETWEEN 1 AND 5)", {"i": 6}, True),
    ("(s IS DISTINCT FROM 'a'::text)", {"s": None}, True),
    ("is_primary", {"is_primary": True}, True),
])
def test_the_evaluator_reads_the_catalogs_shapes_with_three_valued_logic(expression, row, expected):
    assert fake_sql.compile_expression(expression)(row, {**TYPES, "is_primary": "boolean"}) is expected


@pytest.mark.parametrize("expression", [
    "(CASE WHEN (a > 1) THEN true ELSE false END)",
    "(created_at <= now())",
    "(EXISTS (SELECT 1 FROM users))",
    "(a ~ '[[:alpha:]]'::text)",
    "((a)::interval > '1 day'::interval)",
    "(a @> ARRAY[1])",
])
def test_a_shape_the_evaluator_cannot_read_fails_when_it_compiles(expression):
    with pytest.raises(fake_sql.SqlUnreadable):
        fake_sql.compile_expression(expression)


# -- CHECK constraints -------------------------------------------------------------------
def test_a_check_refuses_an_insert_and_names_its_constraint(db):
    home(db)
    order = {"complaint_id": "f1000000-0000-4000-8000-000000000001", "listing_id": LISTING, "tenant_user_id": TENANT,
             "status": "COMPLETED", "updated_at": NOW}
    db.seed("complaints", [{"id": order["complaint_id"], "reporter_user_id": TENANT, "category": "MAINTENANCE",
                            "description": "Leak"}])

    error = fails("23514", db.table("maintenance_work_orders").insert(order),
                   'new row for relation "maintenance_work_orders" violates check constraint '
                   '"maintenance_work_orders_status_check"')
    [stored] = db.table("maintenance_work_orders").insert({**order, "status": "RESOLVED"}).execute().data

    assert error.details.startswith("Failing row contains (")
    assert stored["status"] == "RESOLVED"


def test_a_check_refuses_an_update_but_null_passes(db):
    home(db)

    fails("23514", db.table("listings").update({"lease_term_months": 0}).eq("id", LISTING),
           '"listings_positive_lease_term_check"')
    db.table("listings").update({"lease_term_months": None, "bond_amount": None}).eq("id", LISTING).execute()

    assert db.tables["listings"][0]["lease_term_months"] is None


def test_a_check_spanning_columns_reads_the_whole_new_row(db):
    db.seed("users", [user(TENANT)])
    db.seed("tenant_profiles", [{"user_id": TENANT, "budget_min": 300, "budget_max": 500, "updated_at": NOW}])

    fails("23514", db.table("tenant_profiles").update({"budget_min": 600}).eq("user_id", TENANT),
           '"tenant_profiles_budget_range_check"')
    db.table("tenant_profiles").update({"budget_min": 500}).eq("user_id", TENANT).execute()


def test_a_seed_the_database_could_not_hold_fails(db):
    with pytest.raises(APIError) as caught:
        db.seed("users", [user(TENANT, verification_status="VERIFIED")])

    assert caught.value.code == "23514" and not db.tables.get("users")
    db.seed("users", [user(TENANT, verification_status="APPROVED")])


def test_a_value_its_type_cannot_hold_is_22p02_when_a_check_reads_it(db):
    home(db)

    fails("22P02", db.table("listings").update({"weekly_rent": "six hundred"}).eq("id", LISTING),
           'invalid input syntax for type numeric: "six hundred"')


# -- unique constraints and unique indexes ---------------------------------------------------
def test_a_unique_constraint_refuses_a_second_row_with_its_values(db):
    home(db)
    db.seed("listings", [listing(OTHER_LISTING, title="Other")])
    likes = db.table("listing_favorites")
    likes.insert({"user_id": TENANT, "listing_id": LISTING}).execute()

    error = fails("23505", db.table("listing_favorites").insert({"user_id": TENANT, "listing_id": LISTING}),
                   '"listing_favorites_user_id_listing_id_key"')
    db.table("listing_favorites").insert({"user_id": TENANT, "listing_id": OTHER_LISTING}).execute()

    assert error.details == f"Key (user_id, listing_id)=({TENANT}, {LISTING}) already exists."
    assert len(db.tables["listing_favorites"]) == 2


def test_a_partial_unique_index_compares_only_the_rows_its_where_takes(db):
    home(db)
    db.seed("rent_agreements", [agreement(status="ACTIVE", activated_at=NOW)])
    second = "e1000000-0000-4000-8000-000000000002"
    other_application = "d1000000-0000-4000-8000-000000000002"

    db.seed("rent_agreements", [agreement(id=second, application_id=other_application, status="CANCELLED")])
    with pytest.raises(APIError) as caught:
        db.seed("rent_agreements", [agreement(id="e1000000-0000-4000-8000-000000000003",
                                               application_id="d1000000-0000-4000-8000-000000000003",
                                               status="ACTIVE", activated_at=NOW)])

    assert caught.value.code == "23505" and '"rent_agreements_one_active_listing_idx"' in caught.value.message


def test_an_expression_index_compares_the_json_key_and_nulls_never_clash(db):
    def conversation(id, metadata):
        return {"id": id, "conversation_type": "DIRECT", "metadata": metadata, "updated_at": NOW}

    conversations = [conversation(f"f2000000-0000-4000-8000-00000000000{n}", metadata) for n, metadata in enumerate(
        [{"maintenanceComplaintId": "c-1"}, {"maintenanceComplaintId": "c-2"}, {}, None])]
    db.table("conversations").insert(conversations).execute()

    fails("23505", db.table("conversations").insert(conversation("f2000000-0000-4000-8000-000000000009",
                                                                  {"maintenanceComplaintId": "c-1"})),
           '"conversations_maintenance_complaint_key"')
    db.table("conversations").insert(conversation("f2000000-0000-4000-8000-00000000000a", {})).execute()


def test_keys_compare_values_as_their_types_hold_them(db):
    auth_user = "9a000000-0000-4000-8000-0000000000ab"
    db.seed("users", [user(OWNER, auth_user_id=auth_user)])

    fails("23505", db.table("users").insert(user(TENANT, auth_user_id=auth_user.upper())),
           '"users_auth_user_id_key"')


def test_a_unique_constraint_embeds_one_to_one_as_postgrest_reads_it(fake_db):
    for rules, expected in ((False, [{"status": "DRAFT"}]), (True, {"status": "DRAFT"})):
        fake_db.catalog_rules = rules
        fake_db.tables.clear()
        home(fake_db)
        fake_db.seed("rent_agreements", [agreement()])

        [application] = fake_db.table("rental_applications").select("id, rent_agreements(status)").execute().data

        assert application["rent_agreements"] == expected


# -- ON DELETE rules -----------------------------------------------------------------------
def test_a_delete_cascades_and_sets_null_as_each_foreign_key_says(db):
    home(db)
    complaint = "f1000000-0000-4000-8000-000000000001"
    db.seed("complaints", [{"id": complaint, "reporter_user_id": TENANT, "property_id": PROPERTY,
                            "category": "MAINTENANCE", "description": "Leak"}])
    db.table("listing_favorites").insert({"user_id": TENANT, "listing_id": LISTING}).execute()

    db.table("properties").delete().eq("id", PROPERTY).execute()

    # listings cascade, and with them the application and the like; the complaint keeps, unlinked.
    assert [db.tables[name] for name in ("listings", "rental_applications", "listing_favorites")] == [[], [], []]
    assert db.tables["complaints"][0]["property_id"] is None


def test_a_restricting_foreign_key_refuses_the_delete_and_undoes_its_cascades(db):
    home(db)
    db.table("notifications").insert({"user_id": OWNER, "title": "Hi", "body": "", "category": "system"}).execute()

    error = fails("23503", db.table("users").delete().eq("id", OWNER),
                   'update or delete on table "users" violates foreign key constraint')

    assert "is still referenced from table" in error.details
    assert len(db.tables["users"]) == 2 and len(db.tables["notifications"]) == 1  # the cascade is undone


def test_a_no_action_foreign_key_refuses_a_delete_it_still_points_from(db):
    home(db)
    db.seed("rent_agreements", [agreement()])

    fails("23503", db.table("listings").delete().eq("id", LISTING), '"rent_agreements_')

    assert len(db.tables["listings"]) == 1 and len(db.tables["rental_applications"]) == 1


def test_a_multi_column_foreign_key_needs_the_pair_in_one_target_row(db):
    home(db)
    document = "f3000000-0000-4000-8000-000000000001"
    db.seed("tenant_lease_documents", [{"id": document, "agreement_id": AGREEMENT,
                                        "storage_path": f"{AGREEMENT}/lease.pdf", "original_filename": "lease.pdf",
                                        "uploaded_by_user_id": OWNER}])
    signatures = db.strict.table("public", "tenant_lease_signatures")
    [pair] = [key for key in signatures.foreign_keys if key.name == "signature_document_matches_agreement"]
    signature = {"agreement_id": AGREEMENT, "document_id": document, "signer_user_id": TENANT}

    db.seed("rent_agreements", [agreement()])
    db.strict._check_foreign_keys(signatures, [signature])  # the document is the agreement's
    with pytest.raises(APIError) as caught:
        db.strict._check_foreign_keys(signatures, [{**signature, "agreement_id": OTHER_LISTING}])

    assert pair.columns == ("document_id", "agreement_id")
    assert caught.value.code == "23503" and '"signature_document_matches_agreement"' in caught.value.message


# -- one request, one transaction -------------------------------------------------------------
@pytest.fixture
def review_stand_in(monkeypatch):
    """Replace the stand-in of review_rental_application for one test."""
    fake_rpcs.handler("current_app_user_id")  # load every stand-in module first

    def use(stand_in):
        monkeypatch.setitem(fake_rpcs._STAND_INS, "review_rental_application", stand_in)

    return use


REVIEW = {"p_application_id": APPLICATION, "p_landlord_id": OWNER, "p_status": "APPROVED", "p_note": "",
          "p_now": NOW}


def test_an_rpc_commits_its_writes_together_and_checks_deferred_rules_last(db, review_stand_in):
    home(db)

    def approve_and_lease(ctx, params):
        ctx.table("rental_applications").update({"status": "APPROVED"}).eq("id", APPLICATION).execute()
        ctx.table("listings").update({"status": "LEASED"}).eq("id", LISTING).execute()
        return {"status": "APPROVED"}

    review_stand_in(approve_and_lease)
    supabase_module.get_supabase_client().rpc("review_rental_application", REVIEW).execute()

    assert (db.tables["rental_applications"][0]["status"], db.tables["listings"][0]["status"]) == (
        "APPROVED", "LEASED")


def test_an_rpc_that_breaks_a_deferred_rule_fails_and_writes_nothing(db, review_stand_in):
    home(db)

    def approve_only(ctx, params):
        ctx.table("rental_applications").update({"status": "APPROVED"}).eq("id", APPLICATION).execute()

    review_stand_in(approve_only)
    query = supabase_module.get_supabase_client().rpc("review_rental_application", REVIEW)

    with pytest.raises(APIError) as caught:
        query.execute()

    assert (caught.value.code, caught.value.message) == (
        "23514", "An approved application requires a leased or archived listing")
    assert db.tables["rental_applications"][0]["status"] == "SUBMITTED"


def test_an_error_undoes_every_write_of_its_request_triggers_included(db, review_stand_in):
    def create_then_refuse(ctx, params):
        ctx.table("users").insert(user(OWNER)).execute()  # its trigger adds the role assignment
        raise api_error("42501", "Only the listing's owner can review its applications.")

    review_stand_in(create_then_refuse)

    with pytest.raises(APIError):
        supabase_module.get_supabase_client().rpc("review_rental_application", REVIEW).execute()

    assert not db.tables.get("users") and not db.tables.get("user_role_assignments")


def test_a_failed_statement_a_stand_in_catches_is_undone_and_the_rest_commits(db, review_stand_in):
    home(db)
    db.table("notifications").insert({"user_id": OWNER, "title": "Hi", "body": "", "category": "system"}).execute()

    def delete_then_go_on(ctx, params):  # as a plpgsql EXCEPTION block: the statement is a savepoint
        try:
            ctx.table("users").delete().eq("id", OWNER).execute()  # cascades the notice, then RESTRICT refuses
        except APIError:
            pass
        ctx.table("listings").update({"title": "Still listed"}).eq("id", LISTING).execute()

    review_stand_in(delete_then_go_on)
    supabase_module.get_supabase_client().rpc("review_rental_application", REVIEW).execute()

    assert (len(db.tables["users"]), len(db.tables["notifications"])) == (2, 1)
    assert db.tables["listings"][0]["title"] == "Still listed"


def test_a_seed_runs_no_trigger(db):
    db.seed("users", [user(OWNER)])
    db.table("users").insert(user(TENANT)).execute()

    assert [row["user_id"] for row in db.tables["user_role_assignments"]] == [TENANT]
