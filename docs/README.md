# TenantVoice developer guide

A rental property transparency platform for the NSW residential rental market. Connects tenants, landlords, service providers and NSW Fair Trading through verified reviews, complaint tracking, red-flag alerts and AI-assisted guidance.

CSIT321 Capstone Project — Group 36, University of Wollongong. Supervisor: Dr Xueqiao Liu.

This folder documents how the system is built. Setup steps for the whole repository are in the root [`README.md`](../README.md).

---

## Read first

Before changing code, read [`rules.md`](rules.md) (branches, commits, reviews, definition of done), [`SCOPE.md`](SCOPE.md) (Base, Nice-to-have and Stretch tiers), [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (tokens and components) and [`shared-db.md`](shared-db.md) (how each area uses the shared database). When implementing a screen, cross-reference the Figma design and reuse the components in `frontend/app/components/` rather than creating one-off styles.

This is a **two-service repo**: a FastAPI backend and a Next.js frontend. Know which side you are working on before you start. See **Architecture** below.

---

## Product scope

Five user types plus admin, each with a role-based workspace:

| Role | Purpose |
|---|---|
| **Public (pre-login)** | Browse listings and provider profiles, view reviews, search and filter. |
| **Tenant** | Rental profile and history, property search and applications, digital lease acknowledgement, maintenance requests, verified reviews, complaints. |
| **Landlord / Owner** | Portfolio and listings, applications, digital leases, maintenance coordination, scorecards, reviews and complaints. |
| **Service Provider** | Public profile, fixed-price service listings, bookings, messaging, reviews, assigned repairs, finance ledger. |
| **NSW Fair Trading Officer** | Regulatory portal: aggregate dashboards, red-flag alerts, de-identified data. |
| **Admin** | Platform activity, verification, moderation, complaints and red-flag oversight. |

Build order agreed with the supervisor: **Service Provider → Public → Landlord → Tenant → Admin → Officer.** Feature tiers are in `SCOPE.md`; what is simulated rather than real is listed in [`demo-features.md`](demo-features.md).

---

## Architecture

A **FastAPI backend** and a **Next.js frontend**, run as separate services. The frontend calls the backend over HTTP; the backend is the only side that talks to Supabase, holding the service-role key server-side. This includes **auth**: the frontend posts credentials to `/api/v1/auth/register` and `/api/v1/auth/login`, and the backend proxies them to Supabase Auth, returning the Supabase-issued user JWT. The frontend stores that JWT in the `tv_token` cookie (`frontend/app/lib/api.ts`) and sends it as `Authorization: Bearer <jwt>` on every request; FastAPI validates it with `supabase.auth.get_user` (`backend/app/core/deps.py`). No Supabase client and no Supabase key exists in the frontend.

```
Browser ──▶ Next.js frontend (localhost:3000)
                 │  HTTP  (fetch → /api/v1/*)
                 ▼
            FastAPI backend (localhost:8000)
                 │  service-role key, or the user's JWT for the mobile app's functions
                 ▼
            Supabase (PostgreSQL + Auth + Storage + RLS), shared with the mobile app
```

The Supabase project is shared with the TenantVoice mobile app. The web app reads and writes the shared `public` tables the way the mobile app does, and keeps its own tables in a separate `web` schema ([`supabase/shared/`](../supabase/shared/README.md)). [`shared-db.md`](shared-db.md) explains the mapping area by area.

### Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js 16** (App Router) + **React 19** + **TypeScript** | In `frontend/`. Next.js 16 changed several APIs and conventions; when unsure, check the guides for this version in `frontend/node_modules/next/dist/docs/`. |
| Styling | **Tailwind CSS v4** | Design tokens are defined inline in `frontend/app/globals.css` via `@theme` (no `tailwind.config.ts`). Mirror the Figma design system — see `DESIGN_SYSTEM.md`. |
| Frontend components | `frontend/app/components/` | `ui/` primitives plus feature folders (`provider/`, `owner/`, `tenant/`, `admin/`, `messaging/`, …). Build on these; no one-off styling. |
| Backend | **FastAPI** (Python 3.12) + Uvicorn | In `backend/`. `pydantic-settings` for config, `supabase` Python client. |
| API layer | FastAPI routers under `/api/v1` | Business logic belongs in `backend/app/services/`, not in route handlers or the frontend. |
| Database | **Supabase** (PostgreSQL + Auth + Storage + Row-Level Security) | Accessed **only from the backend**. |
| AI features | A hosted language-model API, called only from backend services | Configured by `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` (see `backend/.env.example`). Not agentic: it answers support questions from the help pages, helps providers describe the clients they want, can re-order a tenant's best matches and can read a listing link or PDF into the listing form. Every call first passes the `paid_ai` verification gate, and each feature still works without the API. |
| Tests | pytest, Vitest, ESLint, TypeScript, a browser E2E harness | See [`e2e.md`](e2e.md) and the root README. |
| Version control | GitHub | See `rules.md`. CI runs `.github/workflows/ci.yml`. |
| Design source | Figma | Single source of truth for UI. |

---

## Repository structure

```
/
├── backend/                    # FastAPI service
│   ├── app/
│   │   ├── main.py             # App entrypoint: CORS, middleware, routers under /api/v1
│   │   ├── core/               # Settings, Supabase clients, auth dependencies
│   │   ├── api/routes/         # Thin route handlers, one module per area
│   │   ├── services/           # Business logic
│   │   ├── schemas/            # Pydantic request and response models
│   │   ├── db/                 # Shared schema snapshot used by the tests
│   │   └── data/help/          # Help pages the support chat answers from
│   ├── tests/                  # pytest suite on a strict in-memory fake of the database
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/                   # Next.js service
│   ├── app/                    # App Router: (public), (auth), (dashboard), (owner),
│   │                           #   (tenant), (admin), (onboarding), (notice-links)
│   ├── app/components/         # Shared and feature components
│   ├── app/lib/                # Typed API client and helpers
│   ├── e2e/                    # Browser journeys per role (npm run e2e)
│   └── package.json
│
├── supabase/
│   ├── migrations/, seed.sql   # Local, stand-alone database only
│   └── shared/                 # SQL for the shared project: the web schema
│
└── docs/                       # This folder
```

---

## Key rules

1. **Compose from the component library.** Every screen builds on `frontend/app/components/` — no one-off styling. This is how many screens built by six people stay visually consistent.
2. **Final week is feature-frozen.** Testing, bug-fixing and demo preparation only. Anything not shipped by the end of the previous sprint is mocked for the demo, not coded.
3. **Design fidelity to Figma is required.** If the Figma is ambiguous, ask the designer (Thi Ngoc Anh Nguyen) — do not improvise.
4. **Authorisation happens on the server.** The backend checks every role and ownership rule; RLS is defence-in-depth for any direct database access, and UI-level checks are only for display.
5. **Fixed pricing, not quote-based.** Service providers set flat, hourly or "from" prices. Do not build bidding, quoting or negotiation flows.
6. **Stretch features are mocked, not implemented.** See `SCOPE.md`. Never wire real payments or legally binding signatures under capstone scope.
7. **Supabase is backend-only.** The service-role key never reaches the browser. The frontend talks to FastAPI; FastAPI talks to Supabase — for data *and* for auth.

Full contribution rules (branches, commits, PRs, sprint cadence, Definition of Done): see `rules.md`.

---

## Working on the code

**Before writing code:**
- Check `SCOPE.md` to confirm the feature is in Base (or explicitly approved).
- Check the relevant Figma frame.
- Check `DESIGN_SYSTEM.md` for the correct tokens; the implemented values live in `frontend/app/globals.css`.
- Check `frontend/app/components/` for existing components to reuse.
- Decide which service you're in — `frontend/` (Next.js) or `backend/` (FastAPI).

**Frontend work:**
- Use the App Router structure.
- Import from `frontend/app/components/`. If a needed component doesn't exist, propose adding it first rather than inlining styles.
- Use Tailwind classes from the `@theme` tokens in `globals.css` — no arbitrary hex codes, no inline styles.
- Type everything. No `any`.
- Data fetching goes to the FastAPI backend (`/api/v1/*`) through the typed client in `app/lib/api.ts`, which attaches the stored JWT as `Authorization: Bearer <jwt>`. Do not add a Supabase client to the frontend.

**Backend work:**
- Route handlers stay thin. Business logic goes in `backend/app/services/`.
- Database access goes through the clients in `backend/app/core/supabase.py`.
- Never expose the service-role key.
- Test every change that touches the shared database against the strict fake in `backend/tests/fake_supabase.py`, which answers like the shared database does.

**Do not:**
- Install a new dependency without a note in the PR explaining why an existing one wouldn't do.
- Add a state-management library — React state and backend calls are enough.
- Build features outside Base without explicit approval (see `SCOPE.md`).
- Put a Supabase client or secrets in the frontend. Its only environment variable is `NEXT_PUBLIC_API_URL`.

---

## Local development

The full setup, including the shared database and its SQL files, is in the root [`README.md`](../README.md). In short, run the two services in separate terminals:

```bash
# Backend (FastAPI)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in the Supabase values
uvicorn app.main:app --reload # http://localhost:8000  (docs at /docs)

# Frontend (Next.js)
cd frontend
npm install
npm run dev                   # http://localhost:3000
npm run lint && npm test      # before pushing
```

The backend allows `http://localhost:3000` via CORS by default (`CORS_ORIGINS` in `.env`).

---

## Team

| Name | Role |
|---|---|
| Nguyen Ta | Project Coordinator |
| Minh Quan Tran | Frontend Developer |
| Dat Cao | Frontend Developer |
| Trung Phong Hoang | Backend Developer |
| Quang Dao Pham | Backend Developer |
| Thi Ngoc Anh Nguyen | UI/UX Designer |

**Supervisor:** Dr Xueqiao Liu. Roles and main contributions: [`AUTHORS.md`](../AUTHORS.md).

---

## Documents in this folder

| File | What it covers |
|---|---|
| [`rules.md`](rules.md) | Contribution guide: branches, commits, reviews, sprints, definition of done |
| [`SCOPE.md`](SCOPE.md) | Base, Nice-to-have and Stretch feature tiers |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Colours, typography, spacing and component specification |
| [`navigation-flow.md`](navigation-flow.md) | Owner/landlord navigation flow |
| [`shared-db.md`](shared-db.md) | How each area reads and writes the shared database |
| [`demo-features.md`](demo-features.md) | What is simulated, and the sample data |
| [`verification.md`](verification.md) | Verification documents, badges and gates |
| [`ai-recommendations.md`](ai-recommendations.md) | The provider recommendation assistant |
| [`support-chat.md`](support-chat.md) | The support chat and its help pages |
| [`tenant-matching.md`](tenant-matching.md) | Tenant matching and match alerts |
| [`listing-import.md`](listing-import.md) | Listing auto-fill from a link or PDF |
| [`password-reset.md`](password-reset.md) | Password reset |
| [`messaging-plan.md`](messaging-plan.md) | The messaging feature's build plan |
| [`e2e.md`](e2e.md) | Browser E2E journeys |
