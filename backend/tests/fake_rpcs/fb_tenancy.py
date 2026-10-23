"""Leases (tracker R26): stand-ins for the mobile lease functions, and the rules of the lease tables.

The stand-ins are written from output/shared-catalog/functions/<name>.sql.
The schema snapshot the strict fake reads has no CHECK or UNIQUE constraint
of a public table and no trigger, so this module also applies what a write to
a lease table meets in the database, from constraints.md, indexs.md,
triggers.md and the trigger functions' bodies:

- rent_agreements: guard_signed_rent_agreement, guard_rent_agreement_activation,
  notify_tenant_rent_agreement_activated, its CHECKs, the unique application
  and the one ACTIVE agreement per listing;
- tenant_lease_documents: guard_tenant_lease_documents,
  notify_tenant_lease_document_ready, the path CHECK, the unique path;
- tenant_lease_signatures: guard_tenant_lease_signatures,
  notify_owner_of_tenant_lease_signature, its CHECKs, one per agreement, the
  (document_id, agreement_id) foreign key;
- rent_agreement_owner_signatures: guard_rent_agreement_owner_signature, its
  CHECKs, one per agreement and per tenant signature, the same foreign key.

The stand-ins apply these rules to their own writes, so they never depend on
another emulation of the triggers. install(monkeypatch) applies them to the
backend's writes as well (a signature it inserts with the service role).
LeaseStorage is the tenant-lease-documents bucket as Storage keeps it.
"""

from __future__ import annotations

import copy
import re
import uuid
from datetime import date
from decimal import ROUND_DOWN, Decimal, InvalidOperation

from storage3.exceptions import StorageApiError

from tests import fake_supabase
from tests.fake_rpcs import rpc
from tests.fake_supabase import FakeTableQuery, api_error

BUCKET = "tenant-lease-documents"
# The bucket's settings (output/shared-storage-buckets.json).
BUCKET_LIMIT = 10 * 1024 * 1024
BUCKET_TYPES = ("application/pdf",)
SHA256 = re.compile(r"^[a-f0-9]{64}$")
# What a write's own checks see as now(); never stored.
_CHECK_TIME = "2026-01-01T00:00:00+00:00"


def _raise(message: str):
    """RAISE EXCEPTION '...' in plpgsql: SQLSTATE P0001."""
    raise api_error("P0001", message)


def _uid(value) -> str | None:
    """value::uuid::text: the canonical form, or None for a null."""
    if value is None:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise api_error("22P02", f'invalid input syntax for type uuid: "{value}"') from None


def _day(value) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise api_error("22007", f'invalid input syntax for type date: "{value}"') from None


class _Db:
    """The fake database as a function or trigger sees it: strict queries on public tables and their rows."""

    def __init__(self, tables: dict, strict):
        self.tables = tables
        self.strict = strict

    def table(self, name: str) -> FakeTableQuery:
        return FakeTableQuery(self.tables, name, "public", self.strict)

    def rows(self, name: str) -> list[dict]:
        return self.tables.get(name, [])

    def one(self, name: str, **match) -> dict | None:
        return next((row for row in self.rows(name) if all(row.get(k) == v for k, v in match.items())), None)


def _db_of(ctx) -> _Db:
    return _Db(ctx.db.tables, ctx.db.strict)


def _latest_document(db: _Db, agreement_id: str) -> dict | None:
    """ORDER BY created_at DESC, id DESC LIMIT 1."""
    rows = [row for row in db.rows("tenant_lease_documents") if row.get("agreement_id") == agreement_id]
    return max(rows, key=lambda row: (str(row.get("created_at")), str(row.get("id"))), default=None)


def has_matching_signatures(db: _Db, agreement_id: str) -> bool:
    """public.rent_agreement_has_matching_signatures(p_agreement_id)."""
    agreement = db.one("rent_agreements", id=agreement_id)
    if agreement is None:
        return False
    latest = _latest_document(db, agreement_id)
    for tenant in db.rows("tenant_lease_signatures"):
        if tenant.get("agreement_id") != agreement_id or tenant.get("signer_user_id") != agreement["tenant_user_id"]:
            continue
        document = db.one("tenant_lease_documents", id=tenant.get("document_id"), agreement_id=agreement_id)
        for owner in db.rows("rent_agreement_owner_signatures"):
            if (owner.get("agreement_id") == agreement_id and owner.get("tenant_signature_id") == tenant["id"]
                    and owner.get("owner_user_id") == agreement["owner_user_id"]
                    and document is not None
                    and owner.get("document_id") == tenant.get("document_id")
                    and owner.get("document_sha256") == tenant.get("document_sha256")
                    and tenant.get("document_storage_path") == document.get("storage_path")
                    and owner.get("document_storage_path") == document.get("storage_path")
                    and latest is not None and document["id"] == latest["id"]):
                return True
    return False


def _notify_once(db: _Db, user_id: str, title: str, body: str, link: str) -> None:
    """INSERT INTO notifications ... ON CONFLICT DO NOTHING.

    The lease-ready and lease-signed links have unique (user_id, link) indexes,
    so a second one is skipped. The activation link has none, but an agreement
    is activated once, so skipping a repeat also keeps another emulation of
    the same trigger from doubling it.
    """
    if any(row.get("user_id") == user_id and row.get("link") == link for row in db.rows("notifications")):
        return
    db.table("notifications").insert({
        "user_id": user_id, "title": title, "body": body, "category": "system", "link": link,
    }).execute()


# ---------------------------------------------------------------------------
# Constraints the snapshot lacks
# ---------------------------------------------------------------------------
def _check(ok: bool, table: str, constraint: str) -> None:
    if not ok:
        raise api_error("23514", f'new row for relation "{table}" violates check constraint "{constraint}"')


def _unique(rows: list[dict], others: list[dict], constraint: str, columns: tuple[str, ...], where=lambda row: True):
    taken = {tuple(row.get(c) for c in columns) for row in others
             if where(row) and all(row.get(c) is not None for c in columns)}
    for row in rows:
        if not where(row) or any(row.get(c) is None for c in columns):
            continue
        key = tuple(row.get(c) for c in columns)
        if key in taken:
            raise api_error("23505", f'duplicate key value violates unique constraint "{constraint}"',
                            f"Key ({', '.join(columns)})=({', '.join(map(str, key))}) already exists.")
        taken.add(key)


def _trimmed_length(value) -> int | None:
    """char_length(TRIM(BOTH FROM value)): TRIM takes spaces only."""
    return None if value is None else len(str(value).strip(" "))


def _document_key(db: _Db, row: dict, table: str, constraint: str) -> None:
    """FOREIGN KEY (document_id, agreement_id) REFERENCES tenant_lease_documents(id, agreement_id)."""
    if row.get("document_id") is None or row.get("agreement_id") is None:
        return
    if db.one("tenant_lease_documents", id=row["document_id"], agreement_id=row["agreement_id"]) is None:
        raise api_error("23503", f'insert or update on table "{table}" violates foreign key constraint "{constraint}"',
                        f"Key (document_id, agreement_id)=({row['document_id']}, {row['agreement_id']}) "
                        'is not present in table "tenant_lease_documents".')


def _sha_and_name(table: str, row: dict) -> None:
    _check(row.get("document_sha256") is None or bool(SHA256.match(row["document_sha256"])),
           table, f"{table}_document_sha256_check")
    length = _trimmed_length(row.get("signer_name"))
    _check(length is None or 2 <= length <= 160, table, f"{table}_signer_name_check")
    _check(row.get("signing_method") in (None, "TYPED_NAME"), table, f"{table}_signing_method_check")


def _agreement_constraints(db: _Db, rows: list[dict], others: list[dict]) -> None:
    table = "rent_agreements"
    for row in rows:
        _check(row.get("status") != "ACTIVE" or row.get("activated_at") is not None,
               table, "rent_agreement_active_requires_activation")
        _check(row.get("currency") in (None, "AUD"), table, "rent_agreements_currency_check")
        _check(row.get("rent_amount") is None or Decimal(str(row["rent_amount"])) > 0,
               table, "rent_agreements_rent_amount_check")
        _check(row.get("rent_frequency") in (None, "WEEKLY", "FORTNIGHTLY", "MONTHLY"),
               table, "rent_agreements_rent_frequency_check")
        _check(row.get("status") in (None, "DRAFT", "ACTIVE", "ENDED", "CANCELLED"), table, "rent_agreements_status_check")
        end, start = _day(row.get("end_date")), _day(row.get("start_date"))
        _check(end is None or start is None or end >= start, table, "valid_rent_agreement_dates")
    _unique(rows, others, "rent_agreements_application_id_key", ("application_id",))
    _unique(rows, others, "rent_agreements_one_active_listing_idx", ("listing_id",),
            where=lambda row: row.get("status") == "ACTIVE")


def _document_constraints(db: _Db, rows: list[dict], others: list[dict]) -> None:
    for row in rows:
        path = row.get("storage_path")
        _check(path is None or row.get("agreement_id") is None or (
            path.split("/")[0] == str(row["agreement_id"])
            and re.fullmatch(r"[0-9a-f-]{36}/[^/]+\.pdf", path, re.IGNORECASE) is not None
        ), "tenant_lease_documents", "valid_lease_document_path")
    _unique(rows, others, "tenant_lease_documents_storage_path_key", ("storage_path",))


def _tenant_signature_constraints(db: _Db, rows: list[dict], others: list[dict]) -> None:
    for row in rows:
        _sha_and_name("tenant_lease_signatures", row)
    _unique(rows, others, "one_tenant_signature_per_agreement", ("agreement_id",))
    for row in rows:
        _document_key(db, row, "tenant_lease_signatures", "signature_document_matches_agreement")


def _owner_signature_constraints(db: _Db, rows: list[dict], others: list[dict]) -> None:
    table = "rent_agreement_owner_signatures"
    for row in rows:
        _sha_and_name(table, row)
        length = _trimmed_length(row.get("consent_text"))
        _check(length is None or length >= 20, table, f"{table}_consent_text_check")
    _unique(rows, others, "one_owner_signature_per_agreement", ("agreement_id",))
    _unique(rows, others, "rent_agreement_owner_signatures_tenant_signature_id_key", ("tenant_signature_id",))
    for row in rows:
        _document_key(db, row, table, "owner_signature_document_matches_agreement")


# ---------------------------------------------------------------------------
# Triggers
# ---------------------------------------------------------------------------
_TERMS = ("application_id", "listing_id", "tenant_user_id", "owner_user_id", "rent_amount", "rent_frequency",
          "currency", "start_date", "end_date", "first_due_date")


def _before_agreement(db: _Db, op: str, old: dict | None, new: dict | None) -> None:
    # protect_signed_rent_agreement (guard_signed_rent_agreement), BEFORE DELETE OR UPDATE.
    if op in ("UPDATE", "DELETE"):
        signed = any(row.get("agreement_id") == old["id"] for row in db.rows("tenant_lease_signatures"))
        if signed:
            if op == "DELETE":
                _raise("A signed rental agreement cannot be deleted")
            if any(new.get(key) != old.get(key) for key in _TERMS):
                _raise("Agreed rental terms cannot change after signing")
    # require_signatures_for_rent_activation (guard_rent_agreement_activation), BEFORE INSERT OR UPDATE.
    if op == "INSERT" and new.get("status") == "ACTIVE":
        _raise("New rental agreements cannot start as ACTIVE.")
    if op == "UPDATE" and new.get("status") == "ACTIVE" and old.get("status") != "ACTIVE":
        if not has_matching_signatures(db, new["id"]):
            _raise("Cannot activate agreement without matching tenant and owner signatures.")


def _after_agreement(db: _Db, op: str, old: dict | None, new: dict, columns: set) -> None:
    # notify_tenant_after_rent_activation, AFTER UPDATE OF status.
    if op == "UPDATE" and "status" in columns and new.get("status") == "ACTIVE" and old.get("status") != new.get("status"):
        _notify_once(db, new["tenant_user_id"], "Rental agreement activated",
                     "Both parties have recorded their electronic signatures. Your rental agreement is now "
                     "active in TenantVoice.", f"/agreements/activated/{new['id']}")


def _before_document(db: _Db, op: str, old: dict | None, new: dict | None) -> None:
    # protect_tenant_lease_documents (guard_tenant_lease_documents).
    if op != "INSERT":
        _raise("Lease document records cannot be edited or deleted")
    if db.one("rent_agreements", id=new.get("agreement_id")) is None:
        _raise("Rental agreement not found")
    if any(row.get("agreement_id") == new["agreement_id"] for row in db.rows("tenant_lease_signatures")):
        _raise("Cannot register documents after lease signing")


def _after_document(db: _Db, op: str, old: dict | None, new: dict, columns: set) -> None:
    # notify_tenant_after_lease_document_upload (notify_tenant_lease_document_ready), AFTER INSERT.
    agreement = db.one("rent_agreements", id=new["agreement_id"])
    if agreement is None or agreement.get("tenant_user_id") is None or agreement.get("status") != "DRAFT":
        return
    if any(row.get("agreement_id") == new["agreement_id"] for row in db.rows("tenant_lease_signatures")):
        return
    _notify_once(db, agreement["tenant_user_id"], "Lease document ready for review",
                 "Your property owner has uploaded a lease PDF. Review the document before deciding whether to "
                 "electronically sign.", f"/documents/lease-ready/{new['agreement_id']}/{new['id']}")


def _before_tenant_signature(db: _Db, op: str, old: dict | None, new: dict | None) -> None:
    # protect_tenant_lease_signatures (guard_tenant_lease_signatures).
    if op != "INSERT":
        _raise("Recorded signatures cannot be edited or deleted")
    agreement = db.one("rent_agreements", id=new.get("agreement_id"))
    if agreement is None:
        _raise("Rental agreement not found")
    if agreement.get("status") != "DRAFT":
        _raise("Only draft agreements can be signed")
    if agreement.get("tenant_user_id") != new.get("signer_user_id"):
        _raise("Signer is not the agreement tenant")
    latest = _latest_document(db, new["agreement_id"])
    if (latest or {}).get("id") != new.get("document_id") or (latest or {}).get("storage_path") != new.get("document_storage_path"):
        _raise("Lease document has changed; review the latest PDF")


def _after_tenant_signature(db: _Db, op: str, old: dict | None, new: dict, columns: set) -> None:
    # notify_owner_after_tenant_lease_signature (notify_owner_of_tenant_lease_signature), AFTER INSERT.
    agreement = db.one("rent_agreements", id=new["agreement_id"])
    if agreement is None or agreement.get("owner_user_id") is None:
        _raise("Agreement owner not found")
    _notify_once(db, agreement["owner_user_id"], "Tenant electronically signed a lease",
                 f"{new['signer_name']} has electronically signed the lease PDF. Review the signing record and "
                 "continue the lease process.", f"/applications/lease-signed/{new['agreement_id']}")


def _before_owner_signature(db: _Db, op: str, old: dict | None, new: dict | None) -> None:
    # protect_rent_agreement_owner_signatures (guard_rent_agreement_owner_signature).
    if op != "INSERT":
        _raise("Recorded owner signatures cannot be edited or deleted")
    agreement = db.one("rent_agreements", id=new.get("agreement_id"))
    if agreement is None:
        _raise("Rental agreement not found")
    if agreement.get("status") != "DRAFT":
        _raise("Only draft agreements can be signed")
    if new.get("owner_user_id") != agreement.get("owner_user_id"):
        _raise("Signer is not the agreement owner")
    owner = db.one("users", id=new.get("owner_user_id"))
    if owner is None or owner.get("status") != "ACTIVE" or owner.get("deleted_at") is not None:
        _raise("Active owner account required")
    tenant = db.one("tenant_lease_signatures", agreement_id=new["agreement_id"])
    if tenant is None:
        _raise("Tenant must sign before the owner")
    if any(new.get(key) != tenant.get(source) for key, source in (
            ("tenant_signature_id", "id"), ("document_id", "document_id"),
            ("document_storage_path", "document_storage_path"), ("document_sha256", "document_sha256"))):
        _raise("Owner and tenant signatures must reference the same PDF")
    if (_latest_document(db, new["agreement_id"]) or {}).get("id") != new.get("document_id"):
        _raise("The document version has changed")


# table -> (BEFORE trigger, AFTER trigger, constraints)
_RULES = {
    "rent_agreements": (_before_agreement, _after_agreement, _agreement_constraints),
    "tenant_lease_documents": (_before_document, _after_document, _document_constraints),
    "tenant_lease_signatures": (_before_tenant_signature, _after_tenant_signature, _tenant_signature_constraints),
    "rent_agreement_owner_signatures": (_before_owner_signature, lambda *args: None, _owner_signature_constraints),
}


def _matched(query: FakeTableQuery) -> list[dict]:
    """The rows an update's or a delete's filters match, as they are now."""
    select = FakeTableQuery(query._tables, query._name, query._schema, query._strict)
    select._filter_specs = list(query._filter_specs)
    return select.execute().data


def execute(query: FakeTableQuery, run=lambda query: query.execute()):
    """query's result, with the rules of its table around the write: BEFORE triggers, constraints, AFTER triggers.

    A select, a table without rules, or a query already under them is run as it is.
    """
    rules = _RULES.get(query._name) if query._schema == "public" else None
    if rules is None or query._op == "select" or getattr(query, "_lease_rules", False):
        return run(query)
    query._lease_rules = True
    before, after, constraints = rules
    db = _Db(query._tables, query._strict)
    spec = query._strict.table("public", query._name)
    if query._op == "insert":
        payloads = query._payload if isinstance(query._payload, list) else [query._payload]
        news = [query._strict.row(spec, payload, now=_CHECK_TIME) for payload in payloads]
        for new in news:
            before(db, "INSERT", None, new)
        constraints(db, news, db.rows(query._name))
        result = run(query)
        for new in result.data:
            after(db, "INSERT", None, new, set(new))
        return result
    olds = _matched(query)
    if query._op == "delete":
        for old in olds:
            before(db, "DELETE", old, None)
        return run(query)
    changes = copy.deepcopy(query._payload)
    news = [{**old, **changes} for old in olds]
    for old, new in zip(olds, news):
        before(db, "UPDATE", old, new)
    changed = {old["id"] for old in olds}
    constraints(db, news, [row for row in db.rows(query._name) if row.get("id") not in changed])
    result = run(query)
    by_id = {old["id"]: old for old in olds}
    for new in result.data:
        after(db, "UPDATE", by_id.get(new["id"]), new, set(changes))
    return result


def install(monkeypatch) -> None:
    """Apply the lease tables' rules to every write in the test, the backend's own included."""
    original = fake_supabase.FakeTableQuery.execute

    def execute_with_rules(self):
        if getattr(self, "_lease_rules", False):
            return original(self)
        return execute(self, original)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", execute_with_rules)


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
def object_meta(db) -> dict:
    """What storage.objects keeps of each object besides its bytes, by (bucket, name): owner_id and mimetype."""
    return db.storage.__dict__.setdefault("lease_object_meta", {})


def _app_user(db, auth_uid: str | None) -> dict | None:
    """public.current_app_user_id() for a token's user."""
    if auth_uid is None:
        return None
    return next((row for row in db.tables.get("users", []) if row.get("auth_user_id") == auth_uid
                 and row.get("status") == "ACTIVE" and row.get("deleted_at") is None), None)


class LeaseStorage:
    """Storage as services/leases.py reaches it: the service role's (token None) or a user's (user_storage).

    Objects go to the fake's storage (db.storage.objects), and their owner
    (the uid of the token that stored them; None for the service role) and
    mimetype to object_meta(db). tenant-lease-documents keeps to its limits
    (10 MB, PDF only) and, for a user, to its policies: an insert only into
    the folder of a draft the user owns that the tenant has neither confirmed
    nor signed, one folder deep, as a .pdf; no update and no delete.
    """

    def __init__(self, db, token: str | None = None):
        self.db = db
        self.token = token
        self.auth_uid = db.tokens.get(token) if token else None

    @property
    def storage(self) -> LeaseStorage:
        """As a client's .storage: services/leases.py reaches Storage through it."""
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def from_(self, bucket: str) -> _LeaseBucket:
        return _LeaseBucket(self, bucket)


class _LeaseBucket:
    def __init__(self, storage: LeaseStorage, bucket: str):
        self.storage = storage
        self.bucket = bucket

    def _insert_allowed(self, path: str) -> bool:
        if self.storage.token is None:
            return True  # the service role bypasses the policies
        user = _app_user(self.storage.db, self.storage.auth_uid)
        folders = path.split("/")[:-1]
        if user is None or not re.search(r"\.pdf\Z", path, re.IGNORECASE) or len(folders) != 1:
            return False
        agreement = next((row for row in self.storage.db.tables.get("rent_agreements", [])
                          if str(row.get("id")) == folders[0]), None)
        if (agreement is None or agreement.get("owner_user_id") != user["id"] or agreement.get("status") != "DRAFT"
                or agreement.get("tenant_confirmed_at") is not None):
            return False
        # tenant_lease_storage_no_upload_after_signing
        return not any(str(row.get("agreement_id")) == folders[0]
                       for row in self.storage.db.tables.get("tenant_lease_signatures", []))

    def upload(self, path: str, data: bytes, options: dict | None = None):
        options = options or {}
        objects = self.storage.db.storage.objects
        mimetype = options.get("content-type") or "text/plain"
        if self.bucket == BUCKET:
            if len(data) > BUCKET_LIMIT:
                raise StorageApiError("The object exceeded the maximum allowed size", "Payload too large", 413)
            if mimetype not in BUCKET_TYPES:
                raise StorageApiError(f"mime type {mimetype} is not supported", "invalid_mime_type", 415)
            if not self._insert_allowed(path):
                raise StorageApiError("new row violates row-level security policy", "Unauthorized", 403)
        if (self.bucket, path) in objects and str(options.get("upsert", "false")).lower() != "true":
            raise StorageApiError("The resource already exists", "Duplicate", 409)
        objects[(self.bucket, path)] = bytes(data)
        object_meta(self.storage.db)[(self.bucket, path)] = {
            "owner_id": self.storage.auth_uid, "mimetype": mimetype, "metadata": options.get("metadata"),
        }
        return {"path": path, "Key": f"{self.bucket}/{path}"}

    def download(self, path: str) -> bytes:
        data = self.storage.db.storage.objects.get((self.bucket, path))
        if data is None:
            raise StorageApiError("Object not found", "not_found", 404)
        return data

    def remove(self, paths: list[str]) -> list[dict]:
        if self.storage.token is not None and self.bucket == BUCKET:
            return []  # tenant_lease_storage_no_delete: a user removes nothing
        removed = []
        for path in paths:
            if self.storage.db.storage.objects.pop((self.bucket, path), None) is not None:
                object_meta(self.storage.db).pop((self.bucket, path), None)
                removed.append({"name": path})
        return removed


def use_storage(monkeypatch, db) -> None:
    """Point services/leases.py's storage at LeaseStorage: the service role's and each user's."""
    from app.services import leases

    monkeypatch.setattr(leases, "_service", lambda: LeaseStorage(db))
    monkeypatch.setattr(leases, "user_storage", lambda token: LeaseStorage(db, token))


# ---------------------------------------------------------------------------
# The functions
# ---------------------------------------------------------------------------
def _write(query: FakeTableQuery) -> list[dict]:
    return execute(query).data


@rpc("mobile_create_rent_agreement_draft")
def mobile_create_rent_agreement_draft(ctx, params):
    actor = (ctx.caller or {}).get("id")
    if actor is None:
        _raise("Please sign in first.")
    try:
        amount = Decimal(str(params["p_rent_amount"])) if params.get("p_rent_amount") is not None else None
    except InvalidOperation:
        raise api_error("22P02", f'invalid input syntax for type numeric: "{params["p_rent_amount"]}"') from None
    if (amount is None or amount <= 0 or amount > Decimal("9999999999.99")
            or amount != amount.quantize(Decimal("0.01"), rounding=ROUND_DOWN)):
        _raise("Enter a valid rent amount.")
    # trim() takes spaces only: a tab or a newline stays, and the frequency is then not one of the three.
    frequency = str(params.get("p_rent_frequency") or "").strip(" ").upper()
    if frequency not in ("WEEKLY", "FORTNIGHTLY", "MONTHLY"):
        _raise("Invalid rent frequency.")
    start, first_due, end = (_day(params.get(key)) for key in ("p_start_date", "p_first_due_date", "p_end_date"))
    if start is None or first_due is None:
        _raise("Start date and first due date are required.")
    if end is not None and end < start:
        _raise("End date cannot precede start date.")

    db = _db_of(ctx)
    application_id = _uid(params.get("p_application_id"))
    application = db.one("rental_applications", id=application_id, status="APPROVED")
    listing = db.one("listings", id=application["listing_id"]) if application else None
    prop = db.one("properties", id=listing["property_id"]) if listing else None
    if prop is None or prop.get("owner_user_id") != actor:
        _raise("Approved application not available for this owner.")

    [agreement] = _write(db.table("rent_agreements").insert({
        "application_id": application_id,
        "listing_id": application["listing_id"],
        "tenant_user_id": application["applicant_user_id"],
        "owner_user_id": prop["owner_user_id"],
        "rent_amount": params["p_rent_amount"],
        "rent_frequency": frequency,
        "start_date": start.isoformat(),
        "first_due_date": first_due.isoformat(),
        "end_date": end.isoformat() if end else None,
        "status": "DRAFT",
    }))
    return agreement["id"]


@rpc("mobile_register_tenant_lease_document")
def mobile_register_tenant_lease_document(ctx, params):
    user_id = (ctx.caller or {}).get("id")
    if user_id is None or ctx.auth_uid is None:
        _raise("Authentication required.")
    db = _db_of(ctx)
    agreement_id = _uid(params.get("p_agreement_id"))
    agreement = db.one("rent_agreements", id=agreement_id)
    if (agreement is None or agreement.get("owner_user_id") != user_id or agreement.get("status") != "DRAFT"
            or agreement.get("tenant_confirmed_at") is not None):
        _raise("Agreement unavailable for document upload.")

    path = params.get("p_storage_path")
    # Postgres's ~* '\.pdf$' ends at the end of the text, as \Z does; Python's $ also matches before a final newline.
    if (path is None or not path.startswith(f"{agreement_id}/") or not re.search(r"\.pdf\Z", path, re.IGNORECASE)
            or len(path.split("/")) != 2):
        _raise("Invalid lease document path.")
    filename = params.get("p_original_filename")
    # LIKE '%\%' matches a name that ends in a percent sign: backslash is LIKE's escape.
    if (filename is None or not filename.strip(" ") or len(filename) > 200
            or not re.search(r"\.pdf\Z", filename, re.IGNORECASE) or "/" in filename or filename.endswith("%")):
        _raise("Invalid PDF filename.")

    stored = object_meta(ctx.db).get((BUCKET, path))
    if ((BUCKET, path) not in ctx.db.storage.objects or stored is None
            or stored.get("owner_id") != str(ctx.auth_uid) or stored.get("mimetype") != "application/pdf"):
        _raise("Uploaded PDF was not found or is not authorised.")

    [document] = _write(db.table("tenant_lease_documents").insert({
        "agreement_id": agreement_id,
        "storage_path": path,
        "original_filename": filename.strip(" "),
        "uploaded_by_user_id": user_id,
    }))
    return document["id"]


@rpc("mobile_tenant_confirm_rent_agreement")
def mobile_tenant_confirm_rent_agreement(ctx, params):
    actor = (ctx.caller or {}).get("id")
    if actor is None:
        _raise("Authentication required.")
    db = _db_of(ctx)
    agreement_id = _uid(params.get("p_agreement_id"))
    agreement = db.one("rent_agreements", id=agreement_id, tenant_user_id=actor, status="DRAFT")
    approved = agreement is not None and agreement.get("tenant_confirmed_at") is None and db.one(
        "rental_applications", id=agreement["application_id"], listing_id=agreement["listing_id"],
        applicant_user_id=actor, status="APPROVED",
    ) is not None
    if not approved:
        _raise("Agreement unavailable for confirmation.")
    now = ctx.now()
    _write(db.table("rent_agreements").update({"tenant_confirmed_at": now, "updated_at": now}).eq("id", agreement_id))
    return agreement_id


@rpc("mobile_owner_activate_rent_agreement")
def mobile_owner_activate_rent_agreement(ctx, params):
    actor = (ctx.caller or {}).get("id")
    if actor is None:
        _raise("Authentication required.")
    db = _db_of(ctx)
    agreement_id = _uid(params.get("p_agreement_id"))
    agreement = db.one("rent_agreements", id=agreement_id, owner_user_id=actor, status="DRAFT")
    owner = db.one("users", id=actor)
    owner_active = (owner is not None and owner.get("status") == "ACTIVE" and owner.get("deleted_at") is None
                    and owner.get("primary_role") in ("LANDLORD", "AGENT"))
    application = db.one("rental_applications", id=agreement["application_id"]) if agreement else None
    listing = db.one("listings", id=application["listing_id"]) if application else None
    prop = db.one("properties", id=listing["property_id"]) if listing else None
    approved = (application is not None and application.get("listing_id") == agreement["listing_id"]
                and application.get("applicant_user_id") == agreement["tenant_user_id"]
                and application.get("status") == "APPROVED" and prop is not None
                and prop.get("owner_user_id") == actor)
    if agreement is None or not owner_active or not approved or not has_matching_signatures(db, agreement_id):
        _raise("Activation requires an approved application, active owner and matching tenant and owner signatures.")
    now = ctx.now()
    _write(db.table("rent_agreements").update({"status": "ACTIVE", "activated_at": now, "updated_at": now})
           .eq("id", agreement_id))
    return agreement_id
