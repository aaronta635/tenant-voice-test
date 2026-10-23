# Messaging feature — build plan

_Last updated: 2026-10-23. The first section describes messaging on the
shared database; the rest is the original plan (2026-08-04) for the web-only
project._

## On the shared database

Threads, messages, connections and notifications live in the tables the
mobile app uses too (migration plan §3 a3-a5). The API and its response
models are unchanged; `backend/app/services/maps_messaging.py` maps the rows.

- **Threads.** A thread is a `conversations` row whose members are
  `conversation_participants` rows, and only those rows decide who may read
  or write it. The web names its kind in `conversations.metadata`:
  `{kind: "marketplace", client_id, provider_id, booking_id}` for a client and
  a provider (a DIRECT thread), or `{kind: "rental", tenant_id, owner_id}`
  for a tenant and an owner about a listing (a PROPERTY thread with
  `listing_id`) or a network DM (DIRECT, the smaller id is `tenant_id`). A
  thread the mobile app opened has no such metadata: its parties come from
  the members' `users.primary_role`. Finding two people's thread takes only
  a DIRECT or PROPERTY thread with the two of them as its only members, never
  a GROUP thread or one with anyone else in it. Such a thread the mobile app
  opened is their thread about its listing (or their general one), whatever
  their roles suggest; one the web opened only serves its own kind, so a DM
  never takes a booking's thread.
- **Messages.** `messages.sender_user_id` and `content`, with `message_type`
  TEXT, SYSTEM (a note, possibly from nobody) or FILE; a file is a
  `message_attachments` row whose `file_url` is the Storage key in the
  private `message-attachments` bucket (`supabase/shared/0003_storage.sql`).
  `deleted_at` hides a message. Sending moves the thread's `updated_at`,
  which orders the inbox.
- **Read and unread.** Each member's `last_read_at`. Unread means other
  people's messages newer than it; reading a thread sets it to the newest
  message's `created_at`. A message is read once another member's
  `last_read_at` reaches it.
- **Connections.** `connection_requests` from `sender_user_id` to
  `receiver_user_id`, status PENDING, ACCEPTED or DECLINED (BLOCKED reads as
  declined; WITHDRAWN, a request taken back in the app, is none and never
  blocks a new request). Network DMs need an ACCEPTED one.
- **Notifications.** `notifications.link`, a body that is never null, and
  the shared category (`message` and `review` are social, `booking` and
  `application` project, the rest system); a read takes the web kind from
  the link.

For other areas (`backend/app/services/conversations.py`):

| Helper | Use |
|---|---|
| `marketplace_thread(client_id, provider_id, *, booking_id=None, subject=None, created_by=None)` | Find or open the client and provider's thread, one per booking (`None` for their general thread). Returns the thread's ConversationOut fields; keep its `id` in `web.bookings.conversation_id`. No checks: the caller knows the two may talk. |
| `post_message(conversation_id, sender_id, content, *, system=False, attachment=None)` | Write a TEXT, SYSTEM or FILE message and move the thread up the inbox. A file must be the sender's own upload (`uploads.message_attachment_folder(sender_id)` in `message-attachments`), else `ValueError`: readers show no other file, and a note from nobody carries none. No other checks and no notification: send one with `notifications.notify()`. |
| `unread_counts(profile_id, conversation_ids=None)` | Unread messages per thread for one person, by the inbox's rule. |
| `notifications.notify(user_id, category, title, body=None, link=None)` | One notice; `category` is a web kind. Never raises. |

## TL;DR — do we need WebSockets?

**No, not to start.** Ship **short polling** first (the frontend re-fetches an open
thread every few seconds through the existing JSON API). It needs zero new
infrastructure, reuses the JWT auth we just built, and respects the
"frontend talks only to the API, Supabase is backend-only" architecture. Real-time
push (Supabase Realtime or a FastAPI WebSocket relay) is a **stretch** you can add
later without throwing away the polling work.

## What already exists

- Tables `conversations` + `messages` (migration `0001_schema.sql`).
- API `conversations.py`: create/list/get conversations, list/create messages,
  all JWT-authed. A trigger bumps `conversations.last_message_at` on insert.

## The blocker you must fix first — the data model is provider-only

`conversations.provider_id` references **`service_providers`**, and the API derives
the caller's provider id from their service-provider profile. That models
**client ↔ service provider** chat for the marketplace. It **cannot** represent
**tenant ↔ owner** chat, which is what every "Message owner" / "Message" button in
the rental flow needs. So step 1 is a schema + API change, not UI.

### Recommended schema: generic participant-based threads

Add a migration (`0005_messaging.sql`) that generalises conversations to be between
two **profiles** and optionally about a **property**:

```sql
alter table public.conversations
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists owner_id    uuid references public.profiles(id)   on delete cascade,
  add column if not exists tenant_id   uuid references public.profiles(id)   on delete cascade;
-- provider_id / client_id stay for the existing marketplace threads; a thread is
-- either a marketplace thread (client_id+provider_id) or a rental thread
-- (owner_id+tenant_id+property_id).
```

A cleaner long-term alternative (more work) is a `conversation_participants` join
table so a conversation is "N profiles + a context", but the two-nullable-pairs
approach above is enough for the capstone and keeps the existing endpoints working.

Then add rental-scoped endpoints (or branch the existing ones on role):

- `POST /conversations/rental` — body `{ property_id, message }`. Tenant-initiated;
  server resolves the property's `owner_id`, finds-or-creates the thread, posts the
  first message.
- The existing `GET /conversations`, `GET /conversations/{id}/messages`,
  `POST /conversations/{id}/messages` work unchanged once list/get authorise the
  caller as **either** participant (client/provider **or** owner/tenant).
- `POST /conversations/{id}/read` — mark the other party's messages `is_read = true`
  (drives unread badges).

## Phase 1 — polling (base, ship this)

Frontend (all through `app/lib/api.ts`, same JWT cookie):

1. Add `api.conversations` methods: `list()`, `get(id)`, `messages(id)`,
   `send(id, body)`, `startRental(propertyId, body)`, `markRead(id)`.
2. **Thread list page** (`/tenant/messages`, `/owner/messages`): fetch `list()` on
   mount; show contact, last message, unread count. Poll every ~10s.
3. **Thread view**: fetch `messages(id)`; poll every ~3–5s **only while the tab is
   focused** (use `document.visibilityState` + `setInterval` in a `useEffect`;
   clear on unmount). Append optimistically on send, then reconcile with the next
   poll.
4. Wire the existing "Message owner" (tenant property detail) and "Message"
   (owner applications) buttons to `startRental(...)` / open the thread instead of
   the current static `/…/messages` links.

Why polling is fine here: threads are low-frequency, a 3–5s delay is invisible in
practice, and there's no connection/scaling/auth-over-socket complexity. This is the
right base-tier scope.

## Phase 2 — real-time push (stretch, optional)

Pick one when/if you want instant delivery:

- **Option A — Supabase Realtime (least code).** Subscribe on the frontend to
  `INSERT`s on `messages` filtered by `conversation_id`. Cost: you must expose the
  Supabase **anon key + URL** to the browser and rely on **RLS** to scope rows —
  a deliberate exception to the "no Supabase on the frontend" rule. Keep writes
  going through the FastAPI API; use Realtime for receive-only.
- **Option B — FastAPI WebSocket relay (keeps Supabase backend-only).** Add a
  `/ws/conversations/{id}` endpoint that authenticates the JWT on connect, then
  fans out new messages to subscribers. Simplest server-side transport is an
  in-process `asyncio` pub/sub (fine for a single-instance capstone deploy);
  multi-instance would need Redis pub/sub. More control, more moving parts.

Either way, keep polling as the fallback so the feature degrades gracefully.

## Suggested order of work

1. `0005_messaging.sql` migration + RLS (participant can read/write their threads).
2. Backend: generalise conversation auth + add rental endpoints + `read`.
3. Frontend: `api.conversations`, thread-list + thread-view with polling.
4. Wire the rental "Message" buttons.
5. (Stretch) Realtime via Option A or B.
```
