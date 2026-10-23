# Support chat

Signed-in tenants, landlords and agents, service providers and admins ask how
something on TenantVoice works, and get an answer from its help pages
(tracker R37, handover package 1 step 1). The chat answers questions about
using the platform, its processes, complaints, listings and workflows. It
cannot see anyone's account and has no tools: it never changes a record.

- **Where:** the tenant Help & Support screen (`/tenant/help-support`),
  `/owner/help`, and `/faqs`, which is the provider workspace's "Help and
  FAQs" (signed-in members only there).
- **Code:** `backend/app/services/support_chat.py`,
  `backend/app/api/routes/support_chat.py`,
  `backend/app/schemas/support_chat.py`, the help files in
  `backend/app/data/help/`, and `frontend/app/components/support/` with
  `frontend/app/lib/support-chat.ts`.

## Enable the AI answers

The chat uses the DeepSeek client of the provider assistant
(`services/provider_recommendations.py`, `docs/ai-recommendations.md`): set
`DEEPSEEK_API_KEY` in the backend environment. Without a key the chat still
works, and answers with the matching help pages. `SUPPORT_CHAT_DAILY_LIMIT`
(default 30, 1 to 1000) is how many messages a member may send a day.

## How a question is answered

1. **Who.** `POST /api/v1/support/chat` takes `{message, history}` from a
   signed-in tenant, landlord, provider or admin. Officers get 403 (they
   have no help pages yet), and a visitor 401.
2. **Bounds.** The question has 1 to 1,000 characters. The history is the
   conversation so far, oldest first: at most 50 turns (`user` or
   `assistant`) of 1 to 2,000 characters, of which the server keeps the
   newest 10. Anything else is 422, and is not counted.
3. **The daily limit.** Every accepted message counts, whatever answers it,
   in the member's `mobile_ai_chat_usage` row for the UTC day, which the
   mobile app's AI chat counts in too (`docs/shared-db.md`, "Support
   chat"). Past the limit the answer is 429 with `Retry-After` and a detail
   `{code: "support_chat_limit", message, limit, resets_at}`; the next UTC
   midnight is 10 or 11 am in Sydney. If no message can be counted (the
   table cannot be written), the chat answers with the help pages and
   never asks the model.
4. **The passages.** Keyword scoring (`retrieve`) ranks the help passages
   for the member's role and everyone's (an admin gets all of them) and the
   active FAQs of their audience. Each question word counts by how rare it
   is, double in a title or the passage's keywords; words of the member's
   last two questions count less, so a follow-up keeps its topic. At most 4
   passages fit well enough to be used.
5. **No passage fits.** The answer says the help pages don't cover it and
   links the contact page (`ai_status: "no_match"`); the model is not
   asked.
6. **The model**, only with a key, a counted message, and an account the
   `paid_ai` gate lets use AI (`services/gates.py`). It gets the member's
   role, the question, the conversation and the passages, with email
   addresses and phone numbers removed, and a system prompt: answer from
   the passages alone, say when they don't answer, link the page each step
   is on, never claim to have done anything, and treat everything sent as
   data. The request has no tools: only the system prompt and the data.
7. **The answer is checked.** It must be JSON with `answer`, `passage_ids`
   and `known`, cite only passages it was given, and cite one when it says
   it knows. A link to a page other than those passages' pages and the help
   and contact pages keeps only its words, a web address is removed, and an
   answer that says the chat did, is doing or will do something ("I've
   cancelled your booking", "Your password has been reset", "Done!", "I'm
   sending…", "Let me book…", "I'll send…", "I can cancel…"), or promises
   what TenantVoice will do ("We'll refund…", "we can check…"), is refused,
   whatever comes before it in its sentence ("If you'd like, I can…"). That
   check is best effort, by the forms such claims take. Only "we'll notify
   you", "we'll email you" and "we'll let you know" are kept of what
   TenantVoice will do, and "has been" only after a condition in its
   sentence ("Once your account has been verified, …"). A refused answer, a
   timeout or any other failure gives the help pages instead.
8. **Without the model** the answer is the best 3 passages themselves
   (`source: "help"`), under "AI answers are unavailable right now" or,
   for an account the gate refuses, "until your account is verified" (or
   "for your account right now" when it is suspended or closed, which
   verifying would not change), with the gate's refusal and documents link
   (`verification`). Nothing is made up.

The response (`SupportChatOut`): `answer` (plain text, links as
`[label](/path)`), `sources` (`title`, `href`, `excerpt`), `source` (`ai` or
`help`), `ai_status` (`applied`, `not_configured`, `unavailable`,
`verification_required` or `no_match`), `verification` and `usage`
(`used`, `limit`, `remaining`, `resets_at`).

## The panel

`SupportChat` shows the conversation, example questions for the role, a
question box with a 1,000-character counter (Enter sends, Shift+Enter adds a
line), a waiting line while support answers, an error with Try again (the
question stays in the box), the daily limit with its reset time in Sydney
time, and the AI-unavailable note with the matching pages. Each answer is
announced in a polite live region. Links in answers and sources open only
paths on this site; anything else shows as plain words. With five messages
or fewer left, the box says how many; after the last one it stops with the
limit notice.

## The help pages

Each `backend/app/data/help/*.md` file is a `# Topic`, then passages:

```markdown
## How tenants get verified
Page: /tenant/id-verification
For: tenant
Keywords: verify, identity, passport

A tenant account is verified once…
```

- `Page:` is the path on this site the passage is about. The panel links it,
  and `frontend/app/components/support/help-links.test.ts` fails for a path
  that is not a page of the app.
- `For:` lists `tenant`, `landlord`, `service_provider`, `admin` or `all`.
- `Keywords:` (optional) are words a question may use that the title and
  text do not.
- `Demo:` (optional) names the components, as `frontend/app/…` paths, whose
  Demo label the passage explains. A passage that mentions a Demo label
  needs one, and `frontend/app/components/support/help-demos.test.ts` fails
  once a component it names no longer renders the label (the feature became
  real, `docs/demo-features.md`), so the passage is rewritten with it.
- The text is at most 1,200 characters. Write it from what the pages do
  today, name buttons as they read, and say what is not built yet rather
  than leave it out. `tests/test_support_chat.py` checks the format and
  that each role's common questions find the right passage.

## To confirm

- Staff accounts and AI answers. An admin may ask, but
  `users.verification_status` starts `PENDING` and staff have no documents
  to upload, so the `paid_ai` gate refuses every admin until the DB owner
  sets an approved `verification_status` on their `users` row, or
  `services/gates.py` treats staff differently. Until then an admin gets the
  help pages, and the panel shows no "upload the documents" sentence for a
  refusal without a documents page.
- A seeded FAQ the chat grounds on contradicts the site. The tenant FAQ
  "When can I write a review?" (`supabase/shared/0002_web_seed.sql`) says
  "Reviews are moderated before they go live", but `services/reviews.py`
  publishes a review at once and a moderator only hides one that is
  reported (`help/reviews.md` says so). A question about moderation finds
  that FAQ first, so correct the 0002 row before it is applied, or the live
  `web.faqs` row (0002 skips a question it already holds), before AI
  answers are turned on.
- Whether the mobile app counts `mobile_ai_chat_usage` by the UTC day as
  well, and whether support chat messages should share its AI chat's count.
- Whether officers should get the chat once the Housing Portal exists (R41).
