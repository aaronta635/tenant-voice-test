# Browser E2E journeys

The role-based browser tests of tracker R44. One command starts the API on a
fake database with demo data, starts the website, and drives headless Chrome
through a journey per role, on a phone (390x844) and a desktop (1440x900).
It writes a screenshot per step and a report. No npm or Python package is
added: Node's own `fetch` and `WebSocket` drive Chrome over the DevTools
protocol.

## Run it

From `frontend/`:

```bash
npm run e2e                                         # every journey, phone and desktop
npm run e2e -- --only tenant,admin --viewport phone # some journeys, one size
npm run e2e -- --headed                             # watch Chrome do it
npm run e2e -- --explore /tenant/dashboard --as tenant   # what a page offers to locate, signed in or not
npm run e2e -- --keep                               # leave both servers running after the run
```

It needs:

- Node 24 (the one the frontend uses);
- Google Chrome, or `E2E_CHROME` set to a Chrome or Chromium executable;
- the backend's virtualenv: `E2E_PYTHON`, else `backend/.venv`, else the main
  checkout's `backend/.venv` (for a git worktree), else `python3`;
- `frontend/node_modules`.

The run exits 0 when every journey passes and 1 otherwise. Everything it
writes goes to `frontend/e2e/out/` (gitignored), which it empties first.
`--out <folder>` writes elsewhere, but only to a new or empty folder or one
an earlier run made (it holds `.tenantvoice-e2e-out`): the run refuses any
other, so it never deletes files it did not write.

| File | What it holds |
|---|---|
| `report.md` | Pass or fail per journey and size, then every step with its time, error and screenshot, the console errors and the failed requests |
| `report.json` | The same, for a script |
| `screenshots/` | One per step: the viewport for a step that passed, the whole page for one that failed |
| `backend.log`, `frontend.log` | The two servers' output |

`next dev` locks its folder: stop another `next dev` running in `frontend/`
before a run, or the run stops and says so. The developer's own app is not
affected: the suite never uses ports 3000 and 8000.

## What runs

### The API

`backend/scripts/e2e_server.py` serves the real app (`app.main`), with every
Supabase client it makes (the database, Storage and Auth) replaced by the
strict fake of `backend/tests/fake_supabase.py`. The fake answers like the
shared database (`docs/shared-db.md`, "In tests"), so a query the shared
schema would refuse fails here too. The server adds what a browser needs
beyond the tests' fake, in `E2ESupabase`:

- **Sign-in** with a demo password returns a signed, JWT-shaped token with an
  expiry, which the fake then accepts. Refresh tokens work once.
- **Password reset** emails go to an outbox instead of a mailbox. Their link
  carries a recovery session, so `/reset-password` works end to end.
- **Storage** keeps each file and serves it at the URLs Supabase would use:
  public buckets (listing photos) at `/storage/v1/object/public/...`, and
  private ones only through a signed link, until it expires.
- **The database clock** is the real one, and queries run one at a time.
- **The listing import's network** is fake too: only
  `https://listings.wattle-lane.example/rentals/12-bridge-road-glebe`
  answers, with the made-up page `backend/scripts/e2e_listing_page.html`, at
  a public-looking address. The import's own address checks and pinned
  connection run on it as they would on the internet; any other name is not
  found.

`backend/scripts/e2e_seed.py` makes the demo dataset through the app's own
routes: members sign up, fill in their profiles and upload documents; the
admin approves documents, so the verified accounts are verified by the real
rule; the landlord uploads photos and publishes listings; tenants apply, book,
message, review and report a repair; the provider confirms and finishes a
job. Only what no route makes comes from the test factories: the staff and
agent accounts, the web catalogue rows of `supabase/shared/0002_web_seed.sql`,
and the date of one past booking. Every name, address and document is made
up. The password of every account is `Demo-pass-2026`.

| Key | Account | Role | Verified |
|---|---|---|---|
| `tenant` | Tara Nguyen, `tara.nguyen@e2e.test` | Tenant | Yes |
| `applicant` | Mia Rossi, `mia.rossi@e2e.test` | Tenant | Yes |
| `tenant_pending` | Tom Becker, `tom.becker@e2e.test` | Tenant | No: passport in review |
| `landlord` | Lena Park, `lena.park@e2e.test` | Landlord | Yes |
| `landlord_pending` | Peter Walsh, `peter.walsh@e2e.test` | Landlord | No: documents in review |
| `agent` | Alex Chen, `alex.chen@e2e.test` | Agent (signs in as a landlord) | No |
| `provider` | Sam Okafor, Okafor Plumbing, `sam.okafor@e2e.test` | Service provider | Yes, published |
| `provider_pending` | Paula Brennan, Brennan Cleaning, `paula.brennan@e2e.test` | Service provider | No, not published |
| `admin` | Ada Admin, `ada.admin@e2e.test` | Admin (staff sign-in) | |
| `officer` | Oscar Officer, `oscar.officer@e2e.test` | Officer (Housing Portal, staff sign-in) | |

Lena has four published listings, three with photos. The fourth, a
Newtown apartment over Tara's budget, fits every other must of hers and has
no photo yet, so her matches leave it out for its rent alone and its card
says "No photo yet". Mia's application waits on the Newtown one; Tara's on
the Glebe studio is approved, and Tara reviewed the studio, which Lena
reported. Alex manages the studio (the mobile app records a manager), so
Tara may ask either of them for a scorecard; she has asked Lena, whose
request waits. Sam has three services and weekly hours, a
finished job that Mia reviewed, Tara's enquiry and a confirmed visit for
Lena, and the repair Tara reported that Lena assigned him. Tara has a thread
with Lena, a complaint about the studio's heater and a connection request
from Mia, who complained about Sam arriving late. Tara's private
details (employment, income, emergency contact, rental history) are filled
in, so the visitor journey can check that none reaches her public profile.

The server has its own routes beside the app's:

| Route | What it does |
|---|---|
| `GET /e2e/fixtures` | The accounts with their ids, the password, the ids of the seeded listings, bookings, reviews, repairs, threads and scorecard request, and the listing page the import reads |
| `POST /e2e/reset` | A fresh copy of the dataset, with new ids; old sessions stop working. The runner calls it before every journey |
| `GET /e2e/outbox` | The password reset emails Auth would have sent |

Run it on its own with
`cd backend && .venv/bin/python -m scripts.e2e_server --port 8123 --frontend-origin http://127.0.0.1:3123`.

### The website and the browser

`frontend/e2e/run.mjs` starts `next dev` on a free port with
`NEXT_PUBLIC_API_URL` pointing at the E2E API, waits for both servers,
compiles the journeys' pages once, then runs each journey at each size in a
fresh browser context: no cookies or storage carry over from one to the next.

`frontend/e2e/driver.mjs` drives Chrome, headless, with a throwaway profile.
It finds elements as a person does: `role('button', 'Save preferences')` by
role and accessible name, `label('Email')` by label, `text('Pending: request
sent')` by visible text, and `css()` when nothing else names it. Names match
exactly first, then as a part, in any case. Every action (click, fill,
choose) waits for its element to be visible, enabled and on top, so a field
behind an overlay is never typed into, then clicks or types with real input
events; a picker's field (date, time) and a select get their value set, as
the picker would. An upload gives a file input its files, hidden or not, as
the file picker does. It records console errors, exceptions and failed requests with the
step they happened in, checks that a page does not scroll sideways, and takes
screenshots.

### The journeys

| Journey | Steps |
|---|---|
| Visitor | Search profiles from the homepage; browse profiles of every role, then tenants only; open a tenant's public profile, where the private details are placeholders and none of their values is anywhere in the page; follow its sign-up prompt; a listing without photos says "No photo yet"; forgot password sends a reset link; the emailed link sets a new password; the new password signs in |
| Tenant | Sign in; save rental preferences (checked after a reload); matches show the reasons they fit, a home over the budget that fits every other must is left out, and the service providers near her are suggested (R31); open a matched property; apply with the form the profile fills (the private income left out of it), whose answer takes the focus; find the application in the list; message the landlord; upload a document; ask the landlord to connect; with Lena's scorecard waiting, ask the studio's agent for one (R43); the support chat answers from the help pages, saying AI answers are unavailable (R37, no model here) |
| Landlord | An unverified landlord signs in and creates a listing with the wizard; publishing is refused with the verification gate's message (R18); the listing is kept unpublished; a verified landlord publishes one and finds it in the rentals search; applications wait under their property; approve one with a note; providers are suggested for the properties (R31); complete Tara's scorecard, opened from the menu (R43); import a listing from its link into the wizard, whose form then holds what was kept (R32) |
| Service provider | Sign in; see the services and add one; find the incoming booking; confirm it; book the visit of an assigned repair, whose access notes show only then |
| Admin | An officer signs in through the staff sign-in to the Housing Portal's overview (R41) and is kept out of the admin console; staff sign in; find an account among the users; approve a document in the verification queue, which verifies the account; reject another with a reason; hide a reported review; restore it; find the decisions in the activity log |

Every page a journey opens or is sent to, and the page each step ends on,
is also checked for sideways scrolling (`Page.checkScroll`, which
`report.mjs` turns on for a journey's page).

### What fails a journey

A journey fails when a step fails (the rest are then skipped), when the
browser logs a console error or an exception, or when a request fails
outright or answers 5xx. A journey declares what it makes fail on purpose
(`expectRequest`, `expectConsole`): the report lists those as expected, with
the reason. Other 4xx answers are listed without failing the journey, since
the app answers 401, 403 and 404 by design in places. So an application bug
that only logs, such as a React key warning, still fails the run.

## Nothing real is reached

- **Ports.** Both servers listen on 127.0.0.1, on free ports, never on 3000
  or 8000. `e2e_server.py` refuses those ports and an origin on them.
- **No real project or key.** `e2e_server.py` refuses to start while any
  variable with `SUPABASE` in its name holds a URL of another machine or a
  key that is not its own fake one. It never reads `backend/.env`: it sets
  the settings that reach a service itself, all fake or empty, then makes
  the settings in an empty folder, so no `.env` is found. The runner also hands each server only
  `PATH`, `HOME`, `TMPDIR`, `USER`, `TERM`, the locale and what it sets, so no
  key of the shell reaches either.
- **No network.** The API refuses every connection and name lookup for
  another machine, and leaves the model and the virus scanner unconfigured.
  `next dev` runs with `e2e/offline.mjs` preloaded, which refuses the same
  from Node, with telemetry off and Google Fonts answered by
  `e2e/fonts.mjs`'s mocks (`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`). Chrome
  resolves no host name but `localhost` and has its background traffic off.

## What is not covered

- **The real shared database.** The fake answers like its schema, but the
  shared project's PostgREST, RLS, triggers, RPC bodies, Storage policies and
  unique constraints are not run. Checking writes on the disposable copy of
  the shared project (`docs/shared-db.md`, `docs/verification.md`) stays a
  separate step.
- **Email.** Reset emails go to the outbox; Supabase's templates, delivery
  and redirect settings are not run.
- **The model.** No model is configured, so the AI features answer with their
  non-model fallbacks (the rule order, the guided questions, the support
  chat's help pages and the listing import's own rules).
- **Reading real listing sites.** The import reads one made-up page through
  a fake network; real sites, TLS and DNS are not run.
- **Virus scanning**, payments and anything else `docs/demo-features.md`
  lists as simulated.
- **A production build.** The suite runs `next dev`, so React's development
  warnings count, and a production-only problem would not show.
- **Fonts and devices.** Pages render in a system font instead of Inter and
  Archivo, and the phone is Chrome's mobile emulation, not a phone. Safari and
  Firefox are not run.
- **The Housing Portal's own pages (R41).** The admin journey signs the
  officer in to the portal's overview and checks that the admin console
  keeps them out, but no journey works the referrals, red-flag alerts, data
  requests or surveys yet. Add one as for the handover's other end-to-end
  demonstrations (H-E2E).

## Writing a journey

A journey is a module in `frontend/e2e/journeys/`, listed in
`journeys/index.mjs`:

```js
export const tenant = {
  name: 'tenant',          // for --only
  title: 'Tenant',         // for the report
  workspace: 'Client',     // the role cookie its pages are compiled with
  routes: ['/tenant/dashboard'], // compiled before the run starts
  async run({ page, step, fixtures, url, web, api, out, expectRequest }) {
    await step('Sign in as a tenant', async () => {
      await signIn(page, web, fixtures, 'tenant');
      await page.waitFor(role('heading', 'Welcome back, Tara!'));
    });
  },
};
```

- Each journey starts from a fresh dataset, so it may change anything, and
  journeys never depend on each other. Ids come from `fixtures`.
- Name a step after what a person achieves, and end it on the check that
  proves it: `waitFor` brings the element into view, so the step's screenshot
  shows it.
- `journeys/support.mjs` has the shared steps: `signIn` through the real
  form, `visit` (open, and check for sideways scrolling), `expectNone` (no
  private value anywhere in the page) and `demoPdf` (a file to upload).
- `--explore <path> --as <account key>` prints the roles, names and labels a
  page offers, with a screenshot.

The harness has tests of its own. The backend's are in the backend suite
(`backend/tests/test_e2e_server.py`). The frontend's run with
`node --test "e2e/tests/*.test.mjs"` from `frontend/`; the ones that need
Chrome are skipped without it.
