# TenantVoice

A rental property transparency platform for the NSW residential rental market. Connects tenants, landlords, service providers, and NSW Fair Trading through verified reviews, complaint tracking, red-flag alerts, and AI-assisted guidance.

CSIT321 Capstone Project — Group 36, University of Wollongong.

---

## For Claude Code

Read this file first, then `rules.md`, `SCOPE.md`, and `DESIGN_SYSTEM.md` (all in this `docs/` folder) before generating code. When implementing a screen, always cross-reference the Figma design — do not invent UI. Reuse the existing components in `frontend/app/components/` rather than creating one-off styles.

This is a **two-service repo**: a FastAPI backend and a Next.js frontend. Know which side you're working on before you start. See **Architecture** below.

---

## Current phase

**Spring build phase, 2026.** Six two-week sprints plus one integration/demo week. The sprint *sequence* is stable; the *dates* are guidance and will shift with actual progress.

**Current priority: Service Provider section.** Directed by the supervisor. Landlord and Tenant dashboards come after the SP module is complete and integrated. Do not start Landlord/Tenant work until SP is signed off.

**Where things stand right now:**
- **Frontend** — SP screens (public marketplace, auth, provider dashboard) are built and styled, running entirely on **hardcoded mock data**. No auth, no data fetching, not yet wired to the backend.
- **Backend** — FastAPI skeleton. Only `GET /` and `GET /api/v1/health` are live. The Supabase client is wired but unused. Auth, business routes, and models are still to be built.
- **Next integration work** — connect the frontend to the backend (auth, real data fetching, replacing mock data).

See `SCOPE.md` for what belongs in each tier.

---

## Product scope

Five user types plus admin, each with a role-based dashboard:

| Role | Purpose |
|---|---|
| **Public (pre-login)** | Browse listings and provider profiles, view reviews, search/filter. |
| **Tenant** | Rent payments, digital lease signing, maintenance requests, verified reviews, rental history, applications. |
| **Landlord / Owner** | Portfolio management, digital leases, rent tracking, maintenance coordination, reviews and complaints management. |
| **Service Provider** | Public profile, fixed-price service listings, bookings, messaging, reviews, finance. |
| **NSW Fair Trading Officer** | Regulatory portal: aggregate dashboards, red-flag alerts, de-identified data, housing surveys. |
| **Admin** | Platform activity, moderation, red-flag oversight. |

Build order (per supervisor): **Service Provider → Public → Landlord → Tenant → Admin → Officer.** Full feature breakdown by tier: see `SCOPE.md`.

---

## Architecture

A **FastAPI backend** and a **Next.js frontend**, deployed and run as separate services. The frontend calls the backend over HTTP; the backend is the only side that talks to Supabase (holding the service-role key server-side). This includes **auth**: the frontend posts credentials to `/api/v1/auth/register` and `/api/v1/auth/login`, and the backend proxies those to Supabase Auth (`admin.create_user` / `sign_in_with_password`), returning the Supabase-issued user JWT. The frontend stores that JWT in the `tv_token` cookie (`frontend/app/lib/api.ts`) and sends it as `Authorization: Bearer <jwt>` on every subsequent request; FastAPI validates it via `supabase.auth.get_user` (`backend/app/core/deps.py`). No Supabase client and no Supabase key of any kind exists in the frontend.

```
Browser ──▶ Next.js frontend (localhost:3000)
                 │  HTTP  (fetch → /api/v1/*)
                 ▼
            FastAPI backend (localhost:8000)
                 │  service-role key
                 ▼
            Supabase (PostgreSQL + Auth + Storage + RLS)
```

> **Note:** the frontend is not yet making these HTTP calls — it renders from mock data today. Wiring this path is the current integration task.

### Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js 16** (App Router) + **React 19** + **TypeScript** | In `frontend/`. Bleeding-edge Next — read `frontend/AGENTS.md` before coding. |
| Styling | **Tailwind CSS v4** | Design tokens are defined inline in `frontend/app/globals.css` via `@theme` (no `tailwind.config.ts`). Mirror the Figma design system — see `DESIGN_SYSTEM.md`. |
| Frontend components | `frontend/app/components/` | `ui/` primitives + `public/`, `providers/`, `provider/` feature components. Build/reuse these; no one-off styling. |
| Backend | **FastAPI** (Python) + Uvicorn | In `backend/`. `pydantic-settings` for config, `supabase` Python client. |
| API layer | FastAPI routers under `/api/v1` | Business logic belongs in `backend/app/services/`, not in route handlers or the frontend. |
| Database | **Supabase** (PostgreSQL + Auth + Storage + Row-Level Security) | Accessed **only from the backend** using the service-role key. |
| AI features | Anthropic Claude API (LLM-wrapper only for Base scope) | Not agentic. Answers questions, guides users, helps draft messages. |
| Version control | GitHub | See `rules.md`. |
| Design source | Figma | Single source of truth for UI. |

---

## Repository structure

```
/
├── backend/                    # FastAPI service
│   ├── app/
│   │   ├── main.py             # App entrypoint: CORS + routers, mounts /api/v1
│   │   ├── core/
│   │   │   ├── config.py       # Settings from .env (supabase creds, CORS, api_prefix)
│   │   │   └── supabase.py     # Cached Supabase client (service-role key)
│   │   ├── api/routes/         # Route handlers — health.py live; more to come
│   │   └── services/           # Business logic layer (currently empty)
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/                   # Next.js service
│   ├── app/                    # App Router
│   │   ├── (public)/           # Landing, categories/[slug], providers/[slug]
│   │   ├── (auth)/             # login, register (mock — no real auth yet)
│   │   ├── (dashboard)/        # Provider dashboard: bookings, finances, messages,
│   │   │                       #   onboarding, profile, reviews, services, settings
│   │   ├── components/
│   │   │   ├── ui/             # Button, Card, Input — shared primitives
│   │   │   ├── public/         # PublicHeader, PublicFooter, CityTabs
│   │   │   ├── providers/      # ProviderCard, CategoryCard, BookingCard, filters
│   │   │   └── provider/       # ProviderShell (dashboard chrome)
│   │   ├── lib/                # Mock data (providers-data.ts, provider-data.ts)
│   │   ├── globals.css         # Tailwind v4 + @theme design tokens
│   │   └── layout.tsx
│   ├── package.json
│   ├── next.config.ts
│   └── AGENTS.md               # Next.js version warning — read before coding
│
└── docs/                       # Project documentation (this folder)
    ├── README.md               # This file
    ├── SCOPE.md                # Base / Nice-to-have / Stretch feature tiers
    ├── DESIGN_SYSTEM.md        # Colours, typography, spacing, component spec
    └── rules.md                # Contribution guide (git, sprints, standards)
```

---

## Key rules (non-negotiable)

1. **Sprint 1 builds zero screens.** Component library first. Every screen thereafter composes from `frontend/app/components/` — no one-off styling. This is how ~50 screens across six people stay visually consistent.
2. **Final week is feature-frozen.** Testing, bug-fixing, demo prep only. Anything not shipped by the end of the previous sprint is mocked for the demo, not coded.
3. **Design fidelity to Figma is required.** If the Figma is ambiguous, ask the designer (Thi Ngoc Anh) — do not improvise.
4. **RLS is not optional.** Every Supabase table needs Row-Level Security policies. UI-level role checks are defence-in-depth, not the primary gate.
5. **Fixed pricing, not quote-based.** Service Providers set prices; TenantVoice is not Airtasker. Do not build bidding, quoting, or negotiation flows.
6. **Stretch features are mocked, not implemented.** See `SCOPE.md`. Never wire real payments or legally binding signatures under capstone scope.
7. **Supabase is backend-only.** The service-role key never reaches the browser. The frontend talks to FastAPI; FastAPI talks to Supabase — for data *and* for auth, which is proxied through `/api/v1/auth/*`. The frontend holds only the user JWT the backend hands back. See "Architecture" above.

Full contribution rules (branches, commits, PRs, sprint cadence, Definition of Done): see `rules.md`.

---

## Working with Claude Code

**Before writing code:**
- Check `SCOPE.md` to confirm the feature is in Base (or explicitly approved).
- Check the relevant Figma frame.
- Check `DESIGN_SYSTEM.md` for the correct tokens; the implemented values live in `frontend/app/globals.css`.
- Check `frontend/app/components/` for existing components to reuse.
- Decide which service you're in — `frontend/` (Next.js) or `backend/` (FastAPI).

**Frontend work:**
- Use the App Router structure. Read `frontend/AGENTS.md` first — this is a newer Next.js than your training data.
- Import from `frontend/app/components/`. If a needed component doesn't exist, propose adding it first rather than inlining styles.
- Use Tailwind classes from the `@theme` tokens in `globals.css` — no arbitrary hex codes, no inline styles.
- Type everything. No `any`.
- Data fetching goes to the FastAPI backend (`/api/v1/*`) through the typed client in `app/lib/api.ts`, which attaches the stored JWT as `Authorization: Bearer <jwt>`. Do not add a Supabase client to the frontend — auth is proxied by the backend too.

**Backend work:**
- Route handlers stay thin. Business logic goes in `backend/app/services/`.
- Database access goes through the cached client in `backend/app/core/supabase.py`.
- Never expose the service-role key. Never bypass RLS to "make it work" — fix the policy instead.

**AI features (Base scope):** a Claude API call from a backend route. No function-calling or agentic behaviour.

**Do not:**
- Do not install a new dependency without a note in the PR explaining why an existing one wouldn't do.
- Do not add a state-management library — React state + backend calls are sufficient for Base scope.
- Do not build features not in Base without explicit approval (see `SCOPE.md`).
- Do not put a Supabase client or secrets in the frontend. Its only env var is `NEXT_PUBLIC_API_URL`.

---

## Local development

Run the two services in separate terminals.

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
uvicorn app.main:app --reload # http://localhost:8000  (docs at /docs)
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
npm run lint                  # before pushing
```

The backend allows `http://localhost:3000` via CORS by default (`CORS_ORIGINS` in `.env`).

See `rules.md` for branch naming, commit conventions, and PR process.

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

**Supervisor:** Wajeeha Saeed.

---

## References

- Scope tiers: `SCOPE.md`
- Design system: `DESIGN_SYSTEM.md` (implemented tokens in `frontend/app/globals.css`)
- Contribution rules: `rules.md`
- Next.js version notes: `frontend/AGENTS.md`
- Design source: Figma (single source of truth for UI)
