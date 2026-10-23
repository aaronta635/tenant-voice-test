# TenantVoice frontend

The TenantVoice website: Next.js 16 (App Router), React 19, TypeScript and Tailwind CSS v4. It talks only to the FastAPI backend; it has no Supabase client and no keys. Setup for the whole repository, including the backend and the database, is in the root [`README.md`](../README.md).

## Run it

```bash
npm install
npm run dev                  # http://localhost:3000
```

The only setting is `NEXT_PUBLIC_API_URL`, the backend's API base (put it in `.env.local` to change it). It defaults to `http://localhost:8000/api/v1`.

## Check it

```bash
npm run lint        # ESLint
npx tsc --noEmit    # type check
npm test            # Vitest unit and component tests
npm run e2e         # browser journeys per role on a fake backend (see ../docs/e2e.md)
npm run build       # production build
```

## Where things are

| Path | What it holds |
|---|---|
| `app/(public)/` | Public pages: home, search, properties, provider and member profiles, help pages |
| `app/(auth)/` | Sign in, register, password reset |
| `app/(dashboard)/dashboard/` | The service provider workspace |
| `app/(owner)/owner/` | The landlord and owner workspace |
| `app/(tenant)/tenant/` | The tenant workspace |
| `app/(admin)/admin/` | The admin console |
| `app/components/` | Shared `ui/` primitives and feature components |
| `app/lib/` | The typed API client (`api.ts`) and helpers |
| `e2e/` | The dependency-free browser E2E harness |

Design tokens live in `app/globals.css` (`@theme`); the design system is described in [`../docs/DESIGN_SYSTEM.md`](../docs/DESIGN_SYSTEM.md).

Next.js 16 changed several APIs and conventions from earlier versions. When unsure, check the guides for this version in `node_modules/next/dist/docs/`.
