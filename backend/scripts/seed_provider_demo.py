"""Add a walkthrough dataset to the existing Amelia account; dry-run by default.

Run from backend: .venv/bin/python -m scripts.seed_provider_demo [--refresh] [--apply]

The rows are the shared database's. Bookings, invoices and payments go into
the web schema; threads, messages, reviews, connection requests and
notifications into public, as the API and the mobile app read them. They are
all between the demo accounts' users rows (Amelia Whitlock and ten
fictional clients, with the fixed ids below), which must already exist:
the script never creates or changes an account. Everything --apply writes
shows in the mobile app at once, so run it only against a disposable copy
of the shared project: demo rows must never be written to the live one
(docs/demo-features.md). --apply stops before connecting when SUPABASE_URL
names a protected project (PROTECTED_PROJECT_REFS, the shared production
project, and any ref the PROTECTED_PROJECT_REFS setting adds), unless
--allow-protected-project names that very project's ref.

Stable IDs make retries additive: existing rows, including edited demos, are kept.
--refresh also rewrites the demo notifications, review text and payment amounts
saved by an earlier version, by the same IDs, and the preview lists what each
row changes. Payments, fees and invoices follow each booking's saved price.
Bookings, threads and connections keep their walkthrough changes. Nothing is
written without --apply.
"""

import argparse
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

from app.core.config import settings
from app.core.supabase import web_table
from app.services.ledger import platform_fee
from app.services.maps_messaging import db_notification_category, marketplace_metadata
from app.services.shared_map import stamp_insert, stamp_update, web_role

# The Supabase projects --apply never writes to unless --allow-protected-project
# types the ref out: the shared production project, which the mobile app reads.
# settings.protected_project_refs adds more; it cannot take this one away.
PROTECTED_PROJECT_REFS = ("bwjhnjzczesjcebcdbdl",)
AMELIA_ID = "a0000000-0000-4000-8000-000000000001"
AMELIA_EMAIL = "amelia@demo.test"
CLIENT_IDS = [f"c0000000-0000-4000-8000-{i:012d}" for i in range(1, 8)]
CLIENT_IDS += [f"b0000000-0000-4000-8000-{i:012d}" for i in range(1, 4)]
CLIENT_NAMES = ["John Doe", "Sarah Jenkins", "Michael Chen", "Emily Davis", "David Kim",
                "Elena Rodriguez", "Amanda Thorne", "Jonathan Hayes", "Mei Lin", "Tom Whittaker"]
SERVICE_TITLES = ["Rental appraisal", "Open home attendance", "Tenant screening", "Listing preparation"]
# The tables in the order --apply writes them: a booking points at its thread
# and its review, and its invoice and payments at the booking.
TABLES = ("conversations", "conversation_participants", "messages", "reviews",
          "bookings", "transactions", "invoices", "connection_requests", "notifications")
WEB_TABLES = {"bookings", "transactions", "invoices"}
# What --refresh rewrites in saved demo rows. Notices come back unread and
# dated the day before --date; reviews and payments keep their dates, so they
# stay with their bookings, and replies made in a walkthrough are kept.
REFRESH_COLUMNS = {
    "notifications": ("category", "title", "body", "link", "is_read", "created_at"),
    "reviews": ("rating", "landlord_rating", "body"),
    "transactions": ("amount", "description"),
}


def demo_id(key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"tenantvoice:provider-walkthrough:v1:{key}"))


def timestamp(day: date, hour: int = 0) -> str:
    return datetime.combine(day, time(hour), tzinfo=timezone.utc).isoformat()


def build_dataset(provider_id: str, services: list[dict], anchor: date,
                  client_roles: dict[str, str] | None = None) -> dict[str, list[dict]]:
    """Every demo row, by table in TABLES order. All participants are the demo accounts.

    services are the provider's mobile_provider_services rows, and
    client_roles the clients' web roles, which their thread memberships name.
    """
    client_roles = client_roles or {}
    by_title = {s["title"]: s for s in services if s["provider_user_id"] == provider_id}
    selected = [by_title[title] for title in SERVICE_TITLES]
    rows = {table: [] for table in TABLES}
    addresses = [
        ("12 Example Terrace", "Newtown"), ("8 Sample Lane", "Marrickville"),
        ("24 Demo Street", "Erskineville"), ("6 Example Avenue", "Dulwich Hill"),
        ("18 Sample Road", "Enmore"), ("3 Demo Crescent", "Petersham"),
    ]
    review_comments = [
        "The appraisal included clear local comparisons and a realistic rental range. Helpful from start to finish.",
        "Amelia kept the open home organised and sent a useful summary of enquiries the same afternoon.",
        "Thorough screening and clear communication. We understood each step before making a decision.",
        "The listing was ready on schedule, with a practical checklist for presentation and photography.",
        "Friendly and well prepared. A little more notice about the appointment time would have helped.",
        "Clear advice without pressure. The open-home feedback made our next steps much easier.",
        "Good follow-up and detailed feedback on the applicants and their references.",
        "Efficient, professional and easy to reach. The listing preparation checklist was especially useful.",
        "A smooth experience overall. One small revision was needed and Amelia sorted it out quickly.",
    ]
    past_offsets = [2, 4, 7, 10, 14, 18, 34, 38, 44, 64, 70, 76, 94, 100, 106, 124, 136, 154]
    schedule = [("completed", -offset) for offset in past_offsets]
    schedule += [("in_progress", 0), ("confirmed", 1), ("confirmed", 2),
                 ("confirmed", 5), ("new_enquiry", 3), ("new_enquiry", 7)]

    for index, (status, offset) in enumerate(schedule):
        service = selected[index % len(selected)]
        day = anchor + timedelta(days=offset)
        created = min(day - timedelta(days=6), anchor - timedelta(days=2))
        client_id = CLIENT_IDS[index % len(CLIENT_IDS)]
        address, suburb = addresses[index % len(addresses)]
        booking_id = demo_id(f"booking-{index}")
        price = float(service["price"])
        reviewed = index < len(review_comments)
        thread_id = demo_id(f"conversation-{index}") if status != "completed" else None
        rows["bookings"].append({
            "id": booking_id, "provider_id": provider_id, "client_id": client_id,
            "service_id": service["id"], "status": status,
            "property_address": address, "property_suburb": suburb,
            "scheduled_date": day.isoformat(), "scheduled_time": f"{9 + index % 6:02d}:00:00",
            "price": price, "notes": "Demo booking. Please call on arrival; access details are in the conversation.",
            "completion_report": "Demo job completed. Summary and next steps discussed with the client." if status == "completed" else None,
            "conversation_id": thread_id, "review_id": demo_id(f"review-{index}") if reviewed else None,
            "created_at": timestamp(created), "updated_at": timestamp(min(day, anchor - timedelta(days=1))),
        })

        if status == "completed":
            fee = platform_fee(price)
            for kind, amount, description in (
                ("payment", price, f"Demo payment · {service['title']} · {suburb}"),
                ("platform_fee", fee, "Demo platform fee (8.5%)"),
            ):
                rows["transactions"].append({
                    "id": demo_id(f"{kind}-{index}"), "provider_id": provider_id,
                    "booking_id": booking_id, "type": kind, "amount": amount,
                    "description": description, "created_at": timestamp(day, 6),
                })
        if status in {"completed", "confirmed", "in_progress"}:
            rows["invoices"].append({
                "id": demo_id(f"invoice-{index}"), "provider_id": provider_id,
                "booking_id": booking_id, "number": f"DEMO-WP-{index + 1:03d}", "amount": price,
                "status": "paid" if status == "completed" else "issued",
                "issued_at": timestamp(created), "due_date": (day + timedelta(days=7)).isoformat(),
                "created_at": timestamp(created),
            })
        if reviewed:
            # A shared review of the provider, titled with the service booked (maps_bookings.booking_review).
            review_day = day + timedelta(days=1)
            replied = index % 3 != 0
            rating = 4 if index in {4, 8} else 5
            rows["reviews"].append({
                "id": demo_id(f"review-{index}"), "reviewer_user_id": client_id,
                "reviewed_user_id": provider_id, "property_id": None,
                "rating": rating, "landlord_rating": rating,
                "title": service["title"], "body": review_comments[index],
                "landlord_reply": "Thank you for the feedback. It was a pleasure helping with your property." if replied else None,
                "landlord_replied_at": timestamp(review_day, 8) if replied else None,
                "is_verified_interaction": True, "status": "PUBLISHED",
                "created_at": timestamp(review_day, 2), "updated_at": timestamp(review_day, 8 if replied else 2),
            })

        if thread_id:
            # The booking's marketplace thread, as conversations.marketplace_thread() opens one.
            message_day = anchor - timedelta(days=1)
            rows["conversations"].append({
                "id": thread_id, "conversation_type": "DIRECT", "subject": f"{service['title']} · {suburb}",
                "created_by_user_id": client_id,
                "metadata": marketplace_metadata(client_id, provider_id, booking_id),
                "created_at": timestamp(created), "updated_at": timestamp(message_day, 9),
            })
            # Both have read up to Amelia's reply: the client's last message is new to her.
            for side, member_id, role in (("client", client_id, client_roles.get(client_id)),
                                          ("provider", provider_id, "service_provider")):
                rows["conversation_participants"].append({
                    "id": demo_id(f"participant-{index}-{side}"), "conversation_id": thread_id,
                    "user_id": member_id, "role_label": role,
                    "joined_at": timestamp(created), "last_read_at": timestamp(message_day, 8),
                })
            texts = [
                f"Hi Amelia, could you help with {service['title'].lower()} at {address}, {suburb}? The requested date is {day.strftime('%d %b')}.",
                "Thanks for the details. I have the request and will check the access arrangements with you.",
                "Thank you! The property will be accessible. Please let me know if you need anything else before the visit.",
            ]
            for message_index, body in enumerate(texts):
                rows["messages"].append({
                    "id": demo_id(f"message-{index}-{message_index}"),
                    "conversation_id": thread_id,
                    "sender_user_id": provider_id if message_index == 1 else client_id,
                    "message_type": "TEXT", "content": body,
                    "created_at": timestamp(message_day, 7 + message_index),
                })

    # The table the Network page lists (app.services.connections), with the
    # shared ConnectionStatus labels.
    for index, client_id in enumerate(CLIENT_IDS[:7]):
        accepted = index < 4
        rows["connection_requests"].append({
            "id": demo_id(f"connection-{index}"),
            "sender_user_id": provider_id if index in {0, 1, 6} else client_id,
            "receiver_user_id": client_id if index in {0, 1, 6} else provider_id,
            "status": "ACCEPTED" if accepted else "PENDING",
            "context_type": "NETWORK",
            "created_at": timestamp(anchor - timedelta(days=12 - index)),
            "responded_at": timestamp(anchor - timedelta(days=10 - index)) if accepted else None,
        })
    # The shared notifications table: link, a NotificationCategory label, and a body.
    for index, (category, title, body, link) in enumerate([
        ("booking", "New service enquiries", "Review the demo enquiries awaiting your response.", "/dashboard/bookings"),
        ("message", "New client messages", "Access details have arrived for your upcoming visits.", "/dashboard/messages"),
        ("review", "Recent client feedback", "Read your latest demo reviews and add a reply.", "/dashboard/reviews"),
        ("account", "Grow your local network", "Review your demo connections and any pending requests.", "/dashboard/network"),
    ]):
        rows["notifications"].append({
            "id": demo_id(f"notification-{index}"), "user_id": provider_id,
            "category": db_notification_category(category), "title": title, "body": body, "link": link,
            "is_read": False, "created_at": timestamp(anchor - timedelta(days=1), 10 - index),
        })
    return rows


def _table(db, name: str):
    """A demo table's query: the web schema's or the shared public one's."""
    return web_table(name) if name in WEB_TABLES else db.table(name)


def _priced_as_booked(db, dataset: dict[str, list[dict]]) -> None:
    """Price each payment, fee and invoice from its booking as saved.

    build_dataset prices from today's service prices, which a walkthrough may
    have edited since; a saved booking and its invoice keep the old price.
    """
    ids = [booking["id"] for booking in dataset["bookings"]]
    saved = _table(db, "bookings").select("id, price").in_("id", ids).execute().data or []
    prices = {row["id"]: float(row["price"]) for row in saved if row["price"] is not None}
    for row in dataset["transactions"] + dataset["invoices"]:
        price = prices.get(row["booking_id"])
        if price is not None:
            row["amount"] = platform_fee(price) if row.get("type") == "platform_fee" else price


def _shown(value) -> str:
    """A saved or demo value as the preview prints it, cut short."""
    text = repr(value)
    return text if len(text) <= 60 else f"{text[:57]}..."


def _connected_pairs(db) -> set[frozenset]:
    """The people Amelia already has a connection request with, either way round."""
    saved = db.table("connection_requests").select("sender_user_id, receiver_user_id").or_(
        f"sender_user_id.eq.{AMELIA_ID},receiver_user_id.eq.{AMELIA_ID}"
    ).execute().data or []
    return {frozenset((row["sender_user_id"], row["receiver_user_id"])) for row in saved}


def _demo_accounts(db) -> tuple[dict[str, str], list[dict]]:
    """The clients' web roles and Amelia's services, once every demo account checks out.

    Exits before writing anything when Amelia, her business, a client or one
    of the demo services is not the seed account it should be.
    """
    amelia = (db.table("users").select("id, email, primary_role").eq("id", AMELIA_ID)
              .is_("deleted_at", "null").execute().data)
    if not amelia or amelia[0]["primary_role"] != "SERVICE_PROVIDER" or amelia[0]["email"].lower() != AMELIA_EMAIL:
        raise SystemExit("Expected Amelia seed account not found. No rows were written.")
    business = db.table("service_provider_profiles").select("company_name").eq("user_id", AMELIA_ID).execute().data
    if not business or business[0]["company_name"] != "Whitlock Property":
        raise SystemExit("Expected Whitlock Property seed provider not found. No rows were written.")
    clients = (db.table("users").select("id, primary_role, full_name").in_("id", CLIENT_IDS)
               .is_("deleted_at", "null").execute().data or [])
    if {p["id"] for p in clients} != set(CLIENT_IDS) or any(p["primary_role"] not in {"LANDLORD", "TENANT"} for p in clients):
        raise SystemExit("Required fictional client profiles are missing. No rows were written.")
    expected_names = dict(zip(CLIENT_IDS, CLIENT_NAMES, strict=True))
    if any(p["full_name"] != expected_names[p["id"]] for p in clients):
        raise SystemExit("A client fixture was renamed. No rows were written.")
    services = (db.table("mobile_provider_services").select("id, provider_user_id, title, price")
                .eq("provider_user_id", AMELIA_ID).execute().data or [])
    missing = [title for title in SERVICE_TITLES if title not in {s["title"] for s in services}]
    if missing:
        raise SystemExit(f"Amelia's demo services are missing: {', '.join(missing)}. No rows were written.")
    return {p["id"]: web_role(p["primary_role"]) for p in clients}, services


def protected_refs() -> set[str]:
    """PROTECTED_PROJECT_REFS and the refs the protected_project_refs setting adds, in lower case."""
    extra = (ref.strip().lower() for ref in settings.protected_project_refs.split(","))
    return {*PROTECTED_PROJECT_REFS, *(ref for ref in extra if ref)}


def protected_project(url: str) -> str | None:
    """The ref of the protected project a Supabase URL names, if it names one.

    A project's API URL is https://<ref>.supabase.co. Any label of the host
    that is a protected ref counts, so a URL written without its scheme, or
    one of the project's other hosts, is caught too.
    """
    text = (url or "").strip()
    host = urlsplit(text if "//" in text else f"//{text}").hostname or ""
    refs = protected_refs()
    return next((label for label in host.split(".") if label in refs), None)


def check_target(apply: bool, typed_ref: str | None) -> None:
    """Exit before connecting when --apply would write to a protected project its ref was not typed out for."""
    ref = protected_project(settings.supabase_url) if apply else None
    if ref is None or (typed_ref or "").strip().lower() == ref:
        return
    if typed_ref:
        raise SystemExit(f"--allow-protected-project names {typed_ref.strip()}, but SUPABASE_URL is the protected "
                         f"project {ref}. No rows were written.")
    raise SystemExit(f"SUPABASE_URL is the protected project {ref}, which the mobile app reads: demo rows must "
                     "never reach it. No rows were written. Point SUPABASE_URL at a disposable copy, or add "
                     "--allow-protected-project with this project's ref typed out.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write the previewed rows; otherwise preview only")
    parser.add_argument("--refresh", action="store_true",
                        help="Also rewrite saved demo notifications, review text and payment amounts")
    parser.add_argument("--date", type=date.fromisoformat, default=date.today(), help="Calendar anchor (YYYY-MM-DD)")
    parser.add_argument("--allow-protected-project", metavar="REF",
                        help="Let --apply write to a protected project (PROTECTED_PROJECT_REFS): its ref, typed out")
    args = parser.parse_args()
    check_target(args.apply, args.allow_protected_project)
    from app.core.supabase import get_supabase_client

    db = get_supabase_client()
    client_roles, services = _demo_accounts(db)
    dataset = build_dataset(AMELIA_ID, services, args.date, client_roles)
    _priced_as_booked(db, dataset)
    # Preview all tables first. Skip both directions of existing network relationships.
    pairs = _connected_pairs(db)
    pending, stale, reasons = {}, {}, {}
    for table, rows in dataset.items():
        columns = REFRESH_COLUMNS.get(table, ()) if args.refresh else ()
        query = _table(db, table).select(", ".join(("id", *columns))).in_("id", [r["id"] for r in rows])
        saved = {row["id"]: row for row in (query.execute().data if rows else [])}
        pending[table] = [r for r in rows if r["id"] not in saved and (
            table != "connection_requests" or frozenset((r["sender_user_id"], r["receiver_user_id"])) not in pairs
        )]
        changed = {r["id"]: [c for c in columns if saved[r["id"]][c] != r[c]] for r in rows if r["id"] in saved}
        stale[table] = [r for r in rows if changed.get(r["id"])]
        # Each refresh with the values it replaces, so the preview says why.
        reasons[table] = [
            f"{r['id']}: " + "; ".join(f"{c} {_shown(saved[r['id']][c])} -> {_shown(r[c])}" for c in changed[r["id"]])
            for r in stale[table]
        ]
    print(f"{'APPLY' if args.apply else 'PREVIEW'}: Amelia / Whitlock Property; anchor {args.date}"
          f"{'; refresh' if args.refresh else ''}")
    for table, rows in dataset.items():
        new, old = len(pending[table]), len(stale[table])
        if args.refresh and table in REFRESH_COLUMNS:
            counts = f"{new} new, {old} to refresh, {len(rows) - new - old} unchanged"
        else:
            counts = f"{new} new, {len(rows) - new} already present"
        print(f"  {table}: {counts}")
        for reason in reasons[table]:
            print(f"    {reason}")
    if not args.apply:
        print("No changes made. Add --apply to write them.")
        return
    for table in TABLES:
        shared = table not in WEB_TABLES
        if pending[table]:
            _table(db, table).insert([stamp_insert(table, row) if shared else row for row in pending[table]]).execute()
        for row in stale[table]:
            changes = {c: row[c] for c in REFRESH_COLUMNS[table]}
            _table(db, table).update(stamp_update(table, changes) if shared else changes).eq("id", row["id"]).execute()
    kept = "Other saved rows" if args.refresh else "Existing rows"
    print(f"Done. {kept} and credentials were preserved; no payments or emails were sent.")


if __name__ == "__main__":
    main()
