# RULES.md — Contribution Guide

TenantVoice | Group 36 | CSIT321 Capstone Project

---

## Git Workflow

### Branches

We use a simple branch model. No one pushes directly to `main`.

| Branch | Purpose |
|---|---|
| `main` | Production-ready code. Only updated via approved PRs. |
| `dev` | Integration branch. All feature branches merge here first. |
| `feature/*` | New screens, components, or features. |
| `fix/*` | Bug fixes. |
| `chore/*` | Non-feature work — config, docs, cleanup, dependencies. |

### Branch Naming

Format: `type/short-description`

Examples:
- `feature/provider-profile-page`
- `feature/booking-card-component`
- `fix/nav-bar-mobile-overflow`
- `chore/update-supabase-config`

Rules:
- Lowercase only
- Use hyphens, not underscores
- Keep it short but descriptive
- Include the screen or component name when possible

### Commits

Use conventional commits. Every commit message follows this format:

```
type: short description
```

Types:
- `feat:` — new feature or screen
- `fix:` — bug fix
- `style:` — visual/CSS changes only (no logic change)
- `refactor:` — code restructure without changing behavior
- `docs:` — documentation updates
- `chore:` — config, dependencies, tooling
- `test:` — adding or updating tests

Examples:
- `feat: add provider profile header section`
- `fix: correct rating display rounding`
- `style: adjust card spacing on category page`
- `chore: add eslint config`
- `docs: update README with setup instructions`

Rules:
- Lowercase after the type
- No period at the end
- Keep it under 72 characters
- One commit = one logical change (don't bundle unrelated stuff)

### Pull Requests

Every change goes through a PR. No exceptions.

**Before opening a PR:**
1. Pull the latest `dev` and rebase your branch
2. Make sure the app runs locally without errors
3. Check your own code — don't rely on the reviewer to catch obvious stuff

**PR title:** Same format as commits — `feat: add provider dashboard earnings card`

**PR description — include:**
- What this PR does (1–2 sentences)
- Screenshot or screen recording if it's a UI change
- Which Figma screen it matches (paste the Figma link)
- Any decisions you made that the reviewer should know about

**Review process:**
- Every PR needs at least one approval before merging
- Frontend PRs → reviewed by the other frontend dev
- Backend PRs → reviewed by the other backend dev
- If it touches both → one reviewer from each side
- Anh reviews UI-related PRs for design accuracy when available

**Merging:**
- Squash merge into `dev` (keeps history clean)
- Delete the feature branch after merge
- Only Tuan or the sprint lead merges `dev` → `main` at the end of each sprint

---

## Code Standards

### General

- No commented-out code in PRs. If you don't need it, delete it.
- No console.log in merged code. Use proper error handling.
- No hardcoded colors, spacing, or font sizes. Everything comes from the design tokens / Tailwind config.
- No inline styles unless there's a specific reason (and you explain it in the PR).

### Frontend

- Components go in `/app/components/` organized by feature area
- Shared/reusable components go in `/app/components/ui/`
- Pages go in the framework's routing folder
- Use the shared component library — don't build a one-off button when a reusable one exists
- Props should have clear names. No abbreviations unless they're obvious (`img` is fine, `prcCmpPct` is not)
- Each component gets its own file. No file with multiple exported components.

### Backend / Supabase

- All database queries go through a service layer — not directly in components
- Supabase client setup lives in one place, imported everywhere
- Row Level Security (RLS) policies must be set for every new table
- API calls should handle loading, error, and empty states

### File Naming

- Components: `PascalCase.tsx` (e.g. `ProviderCard.tsx`, `BookingList.tsx`)
- Utilities/helpers: `camelCase.ts` (e.g. `formatPrice.ts`, `calculateRating.ts`)
- Styles: match the component name (e.g. `ProviderCard.module.css` if using CSS modules)
- Database files: `snake_case.sql` (e.g. `seed_providers.sql`)

---

## Sprint Workflow

### Cadence

Each sprint is 2 weeks (Monday to Sunday).

| Day | Activity |
|---|---|
| Monday (Week 1) | Sprint planning — assign tasks, set goals |
| Daily | Async standup — post in group chat: yesterday / today / blockers |
| Thursday (Week 1) | Mid-sprint sync — 30 min call, frontend + backend alignment |
| Monday (Week 2) | Supervisor meeting — show progress, raise blockers |
| Thursday (Week 2) | Code freeze for the sprint — finish and merge open PRs |
| Friday (Week 2) | Sprint demo — show working increment to the team |

### Task Tracking

- All tasks live on the sprint board
- Every task must have: assignee, sprint, status, linked Figma screen (if UI)
- Move your own cards — don't wait for someone to ask
- Statuses: `To Do` → `In Progress` → `In Review` → `Done`

### Definition of Done

A task is only "done" when:
- Code is merged into `dev`
- It matches the Figma design (Anh confirms for UI tasks)
- It works — no broken states, no missing error handling
- It uses shared components (not custom one-offs)
- PR is approved and squash-merged

---

## Communication

- **Group chat** — daily standups, quick questions, blockers
- **Weekly supervisor meeting** — Mondays (existing slot)
- **PR comments** — for code-specific feedback (keep it constructive)
- **Tag people** — if you're blocked on someone, tag them directly, don't wait

### Asking for Help

If you're stuck for more than 30 minutes on something:
1. Write down what you tried
2. Post in the group chat with context
3. Tag whoever is most likely to know

Don't sit on blockers silently. That's how sprints slip.

---

## Two Fixed Rules

1. **Sprint 1 builds zero screens.** Component library and foundation only. Every screen built after Sprint 1 pulls from the same shared components.

2. **Week 13 is feature-frozen.** Testing, bug fixes, and demo prep only. Any feature not complete by end of Week 12 gets mocked for the demo, not rushed.

---

## Design System

- All design tokens (colors, typography, spacing, radii) come from the Figma file and are configured in Tailwind
- If a value isn't in the design tokens, ask Anh before inventing one
- Component library is the single source of truth — if a component looks wrong, fix the shared component, don't override it locally
- Before building a new component, check if one already exists that can be extended

---

*Last updated: June 2026 — will be revised at the start of Sprint 1.*
