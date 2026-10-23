# TenantVoice

A rental property transparency platform for the NSW residential rental market.
TenantVoice connects tenants, landlords, service providers, and NSW Fair Trading
through verified reviews, complaint tracking, red-flag alerts, and AI-assisted
guidance.

**CSIT321 Capstone Project — Group 36, University of Wollongong.**
Supervisor: Dr Xueqiao Liu

## What's in this repo

This is a **two-service application**: a Next.js frontend and a FastAPI backend,
run separately. The frontend never talks to Supabase directly — all data access
goes through the backend.

| Directory | What it is |
|---|---|
| [`frontend/`](frontend/) | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4. Role-based sections: `(public)` marketplace, `(auth)`, `(dashboard)` service-provider workspace, `(owner)` landlord portal, `(tenant)` tenant portal. |
| [`backend/`](backend/) | FastAPI + Uvicorn. Routers under `/api/v1` (`app/api/routes/`), business logic in `app/services/`, Pydantic schemas in `app/schemas/`. Sole client of the Supabase database via the service-role key. |
| [`supabase/`](supabase/) | Database migrations (`0001`–`0010`), RLS policies, and `seed.sql` demo data. 24 tables across three domains — see [`supabase/README.md`](supabase/README.md). On the shared Supabase project, only [`supabase/shared/`](supabase/shared/README.md) applies: the web-only `web` schema. |
| [`docs/`](docs/) | Project documentation: [`SCOPE.md`](docs/SCOPE.md) (feature tiers), [`DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) (tokens & components), [`rules.md`](docs/rules.md) (coding conventions), [`navigation-flow.md`](docs/navigation-flow.md), [`messaging-plan.md`](docs/messaging-plan.md), [`shared-db.md`](docs/shared-db.md) (helpers and tests for the shared database). |

### Architecture at a glance

```
Browser ──▶ Next.js frontend (localhost:3000)
                 │  fetch
                 ▼
            FastAPI backend (localhost:8000/api/v1/*)
                 │  service-role key (backend only — never in the browser)
                 ▼
            Supabase (PostgreSQL + Auth + Storage, RLS on every table)
```

Auth is backend-proxied: the frontend calls FastAPI, which uses Supabase Auth
and returns a scoped user JWT. The service-role key bypasses RLS, so the RLS
policies are defence-in-depth for any direct database access, not the backend's
primary access control.

## Running locally

### Prerequisites

- **Node.js 20+**
- **Python 3.12+**
- A **Supabase project** (hosted, free tier is fine) or the
  [Supabase CLI](https://supabase.com/docs/guides/cli) for a local stack

### 1. Database

Apply the migrations **in order**, then the seed data:

- **Hosted project:** paste and run each of
  `supabase/migrations/0001…0010` in the Supabase SQL Editor, then `seed.sql`.
- **Local CLI:** `supabase start && supabase db reset` (runs migrations + seed
  automatically).

Details, reset instructions, and schema overview: [`supabase/README.md`](supabase/README.md).

### 2. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
# (Supabase dashboard → Project Settings → API)

uvicorn app.main:app --reload --port 8000
```

The API is now at `http://localhost:8000` — interactive docs at
[http://localhost:8000/docs](http://localhost:8000/docs).

### 3. Frontend

```bash
cd frontend
npm install

cp .env.example .env
# Default NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 works as-is

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional DeepSeek recommendations

Provider Recommendations work without an AI key: the recommendation assistant
asks guided questions and matching uses profile information. To let DeepSeek
run the assistant and rerank confirmed searches, set these backend-only values
in `backend/.env` and restart FastAPI:

```dotenv
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_SECONDS=12
```

Open `/dashboard/recommendations` as a service provider and describe who you want
to reach. The assistant asks for anything missing (who and which area), you
confirm the details, and only **Find matches** runs a search. Loading the page
does not call DeepSeek; unavailable AI falls back to guided questions and profile
matching. No database migration or new package is required. Never put the key in
a `NEXT_PUBLIC_*` variable.

Setup, data handling and limitations: [AI recommendations](docs/ai-recommendations.md).

### Demo accounts

`seed.sql` creates demo users for every role. The password for **all** demo
accounts is `password123`.

| Role | Email |
|---|---|
| Service provider | `amelia@demo.test` |
| Tenant | `jonathan@demo.test` |
| Landlord / owner | `owner@demo.test` |

### Verify it's working

1. `GET http://localhost:8000/api/v1/health` returns OK.
2. `http://localhost:3000` shows the public marketplace with seeded providers.
3. Sign in at `http://localhost:3000/login` with a demo account.

## Current status

The **Service Provider module** is complete end-to-end (public profile,
onboarding, dashboard, services, bookings, messaging, reviews, finance ledger,
document verification) and wired to live backend data. Owner/landlord and
tenant portals are in active development. Per project scope, payments are
mocked and lease signing is a typed acknowledgement — see
[`docs/SCOPE.md`](docs/SCOPE.md) for the full Base / Nice-to-have / Stretch
breakdown and explicit non-goals.

## Development conventions

- Branches: `main` / `dev` / `feature/*` / `fix/*` / `chore/*`; Conventional
  Commits; one-approval PR review.
- Schema changes always go through a **new** migration file in a PR — never
  edit an applied migration.
- UI work reuses shared components in `frontend/app/components/` and design
  tokens from [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — no one-off
  styling.

## Team

Nguyen Ta · Minh Quan Tran · Dat Cao · Trung Phong Hoang · Quang Dao Pham · Thi Ngoc Anh Nguyen

Roles and main contributions: [`AUTHORS.md`](AUTHORS.md).
