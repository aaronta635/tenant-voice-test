# TenantVoice — Design System

This file is the working documentation of the TenantVoice design system. The **Figma file is the source of truth**; this document exists to give developers (and Claude Code) a fast reference without opening Figma every time.

If Figma and this file disagree, Figma wins — then update this file. Do not update the code to match Figma without also updating this file.

**Owner:** Thi Ngoc Anh Nguyen (UI/UX Designer).

---

## How to use this doc

- **Frontend devs & Claude Code:** use the tokens and component list here first. Only open Figma when this doc is ambiguous.
- **Designer:** when you change something in Figma, add a note in the `Changelog` section at the bottom and update the affected section.
- **Everyone:** if you're about to hard-code a hex value, spacing, or font size — stop. Check this doc, then Figma, then ask.

---

## 1. Design principles

Four principles inherited from the existing Owner and Tenant screens. All new work — including the Service Provider section — must feel like it belongs to the same product.

1. **Consistency over cleverness.** Reuse patterns before inventing new ones.
2. **Clarity over density.** Whitespace is not wasted space. Fewer elements per screen, better hierarchy.
3. **Trust is visual.** Verification badges, verified reviews, and clear pricing are the product. UI must reinforce them.
4. **One primary action per screen.** The user should always know what to do next.

---

## 2. Colour tokens

Tokens are implemented in `frontend/app/globals.css` under `@theme` (Tailwind v4 — there is **no** `tailwind.config.ts`). The values below are the current, authoritative ones. If Figma changes, update `globals.css` **and** this table together.

### Brand

| Token | Hex | Tailwind class | Usage |
|---|---|---|---|
| `primary` | `#636ae8` | `bg-primary` `text-primary` | Primary CTAs, active nav, key links |
| `navy` | `#0e2a48` | `bg-navy` `text-navy` | Dark headers, footer, high-contrast surfaces |

### Text

| Token | Hex | Tailwind class | Usage |
|---|---|---|---|
| `text-dark` | `#171a1f` | `text-text-dark` | Primary text (also the default `body` colour) |
| `text-body` | `#565d6d` | `text-text-body` | Body copy |
| `text-muted` | `#565d6d` | `text-text-muted` | Secondary text (same value as body today) |
| `text-subtle` | `#8c97a2` | `text-text-subtle` | Captions, metadata, placeholders |

### Surfaces & borders

| Token | Hex | Tailwind class | Usage |
|---|---|---|---|
| `background` | `#fafafe` | `bg-background` | Page background (applied to `body`) |
| `surface` | `#eeeffd` | `bg-surface` | Cards, raised panels, subtle fills |
| `border` | `#efeff2` | `border-border` | Borders, dividers |

### Semantic

| Token | Hex | Tailwind class | Usage |
|---|---|---|---|
| `success` | `#1b7c4f` | `bg-success` `text-success` | Verified badges, success states |

> **Not yet defined in code.** `warning`, `danger`, and `info` are used conceptually by components (alerts, red-flag indicators, pending states) but are **not** in `globals.css` yet. Add them to the `@theme` block (`--color-warning`, `--color-danger`, `--color-info`) before first use — do not hardcode a hex in a component.

### Rules

- **Never use raw hex codes** in components. Use the token classes above.
- **Never introduce a new colour** without adding it to `@theme` in `globals.css` first, then recording it here.
- **Accessible contrast:** all text-on-background combinations must meet WCAG AA (4.5:1 for body, 3:1 for large text).

---

## 3. Typography

**Font families** (defined in `frontend/app/globals.css`, loaded in `frontend/app/layout.tsx`):
- **Body:** `Inter` → `--font-sans`, use `font-sans`
- **Headings:** `Archivo` → `--font-heading`, use `font-heading`

### Scale

| Token | Size / Line height | Weight | Usage |
|---|---|---|---|
| `display` | 48 / 56 | 700 | Landing hero |
| `h1` | 36 / 44 | 700 | Page titles |
| `h2` | 28 / 36 | 600 | Section titles |
| `h3` | 22 / 30 | 600 | Card titles, dashboard section headers |
| `h4` | 18 / 26 | 600 | Sub-sections, form section headers |
| `body-lg` | 18 / 28 | 400 | Lead paragraphs |
| `body` | 16 / 24 | 400 | Default body text |
| `body-sm` | 14 / 20 | 400 | Secondary text, captions |
| `caption` | 12 / 16 | 500 | Labels, metadata, badges |
| `button` | 16 / 24 | 600 | Button labels |

Define these as Tailwind v4 tokens in `frontend/app/globals.css` (`@theme`) and use them as `text-h1`, `text-body`, etc. Not all scale tokens exist in code yet — add them to `@theme` as screens need them.

### Rules

- **Only these sizes.** No arbitrary `text-[17px]` or `text-[19px]` anywhere.
- **Line-height is fixed per token.** Do not override with `leading-*` unless documented here.
- **Hierarchy is enforced by size, not by weight alone.** Never bold body text to create emphasis where a heading is appropriate.

---

## 4. Spacing

Base unit: **4px.** All spacing must be a multiple.

| Token | Value | Tailwind |
|---|---|---|
| `space-0` | 0 | `p-0` |
| `space-1` | 4px | `p-1` |
| `space-2` | 8px | `p-2` |
| `space-3` | 12px | `p-3` |
| `space-4` | 16px | `p-4` |
| `space-6` | 24px | `p-6` |
| `space-8` | 32px | `p-8` |
| `space-12` | 48px | `p-12` |
| `space-16` | 64px | `p-16` |
| `space-24` | 96px | `p-24` |

### Rules

- **Component-internal padding:** typically `space-4` (16px).
- **Between cards / list items:** typically `space-4` or `space-6`.
- **Between page sections:** typically `space-12` or `space-16`.
- **Never use arbitrary values** like `p-[13px]`.

---

## 5. Radii

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 4px | Tags, small badges |
| `radius-md` | 8px | Inputs, buttons |
| `radius-lg` | 12px | Cards |
| `radius-xl` | 16px | Modals, large surfaces, dashboard quick-link cards (confirmed against Figma — the `Card` `dashboard` variant uses this radius, not `radius-lg`) |
| `radius-full` | 9999px | Pills, avatars |

---

## 6. Shadows

| Token | Value | Usage |
|---|---|---|
| `shadow-sm` | `0px 2px 2.5px rgba(23,26,31,0.09), 0px 0px 1px rgba(23,26,31,0.12)` | Cards at rest |
| `shadow-md` | 4px offset | Hover state, dropdowns |
| `shadow-lg` | 8px offset | Modals, dialogs |
| `shadow-focus` | 3px ring | Focused inputs and buttons |

_(`shadow-sm` confirmed exact from Figma. `shadow-md`/`shadow-lg`/`shadow-focus` still to be exported.)_

---

## 7. Component library

Components live under `frontend/app/components/` (`ui/` primitives, plus `public/`, `providers/`, `provider/` feature folders) with **PascalCase `.tsx`** filenames. Every screen composes from these — no ad-hoc styling. The tables below are the intended library; some entries are not built yet — check the folder before assuming a component exists.

### Primitives

| Component | Path | Notes |
|---|---|---|
| `Button` | `/components/ui/button.tsx` | Variants: `primary`, `secondary`, `ghost`, `destructive`. Sizes: `sm`, `md`, `lg`. |
| `Input` | `/components/ui/input.tsx` | Text, email, password, number. Include `Label` and error state. |
| `Textarea` | `/components/ui/textarea.tsx` | Auto-grow optional. |
| `Select` | `/components/ui/select.tsx` | Single + multi-select. |
| `Checkbox` | `/components/ui/checkbox.tsx` | Include label association. |
| `Radio` | `/components/ui/radio.tsx` | Grouped radios. |
| `Switch` | `/components/ui/switch.tsx` | On/off. |
| `Badge` | `/components/ui/badge.tsx` | Variants: `default`, `success`, `warning`, `danger`, `verified`. |
| `Avatar` | `/components/ui/avatar.tsx` | Circle. Fallback to initials. |
| `Tag` | `/components/ui/tag.tsx` | Category and filter chips. |

### Layout

| Component | Path | Notes |
|---|---|---|
| `Card` | `/components/ui/card.tsx` | Composed with `CardHeader`, `CardBody`, `CardFooter`. |
| `Divider` | `/components/ui/divider.tsx` | Horizontal and vertical. |
| `Container` | `/components/ui/container.tsx` | Page max-width wrapper. |
| `Grid` | `/components/ui/grid.tsx` | Responsive column grid. |
| `Stack` | `/components/ui/stack.tsx` | Vertical/horizontal flex helper. |

### Feedback

| Component | Path | Notes |
|---|---|---|
| `Toast` | `/components/ui/toast.tsx` | Global toast provider. |
| `Alert` | `/components/ui/alert.tsx` | Inline messages. Variants match semantic colours. |
| `Skeleton` | `/components/ui/skeleton.tsx` | Loading placeholders. |
| `Spinner` | `/components/ui/spinner.tsx` | Inline loading. |
| `EmptyState` | `/components/ui/empty-state.tsx` | Icon + heading + description + optional CTA. |
| `ErrorState` | `/components/ui/error-state.tsx` | For failed data loads. |

### Navigation

| Component | Path | Notes |
|---|---|---|
| `Nav` | `/components/ui/nav.tsx` | Top navigation. |
| `Sidebar` | `/components/ui/sidebar.tsx` | Dashboard side nav. |
| `Breadcrumbs` | `/components/ui/breadcrumbs.tsx` | Page trail. |
| `Tabs` | `/components/ui/tabs.tsx` | Tabbed sections. |
| `Pagination` | `/components/ui/pagination.tsx` | List pagination. |

### Data display

| Component | Path | Notes |
|---|---|---|
| `Table` | `/components/ui/table.tsx` | Sortable columns, empty state. |
| `List` | `/components/ui/list.tsx` | Ordered/unordered. |
| `Rating` | `/components/ui/rating.tsx` | Star display, read-only and interactive. |
| `Modal` | `/components/ui/modal.tsx` | Uses portal. Traps focus. |
| `Drawer` | `/components/ui/drawer.tsx` | Side panel. |
| `Tooltip` | `/components/ui/tooltip.tsx` | Hover/focus. |
| `Popover` | `/components/ui/popover.tsx` | Click-triggered. |

### Domain-specific

| Component | Path | Notes |
|---|---|---|
| `PropertyCard` | `/components/features/property-card.tsx` | Listing preview. |
| `ProviderCard` | `/components/features/provider-card.tsx` | Service Provider preview. |
| `ReviewItem` | `/components/features/review-item.tsx` | Star rating + comment. |
| `VerifiedBadge` | `/components/features/verified-badge.tsx` | ID / ABN / Licence / Insurance verification. |
| `BookingStatusBadge` | `/components/features/booking-status-badge.tsx` | Enquiry → In progress → Completed. |
| `PriceLabel` | `/components/features/price-label.tsx` | Fixed / from / per hour formatting. |
| `RedFlagIndicator` | `/components/features/red-flag-indicator.tsx` | Regulator + admin dashboards. |

---

## 8. States

Every interactive component must define these states. If a state isn't in Figma, ask the designer.

- **Default** — resting appearance
- **Hover** — pointer over
- **Focus** — keyboard focus ring (never remove the outline; restyle it)
- **Active** — being clicked / pressed
- **Disabled** — reduced opacity, no pointer events
- **Loading** — spinner or skeleton
- **Error** — semantic-red border + inline message
- **Empty** — for lists/tables/searches with no results

---

## 9. Breakpoints

Mobile-first, though the initial demo focus is desktop.

| Breakpoint | Min width | Tailwind |
|---|---|---|
| `sm` | 640px | `sm:` |
| `md` | 768px | `md:` |
| `lg` | 1024px | `lg:` |
| `xl` | 1280px | `xl:` |
| `2xl` | 1536px | `2xl:` |

Design first at `lg` (desktop), then verify at `md` (tablet) and `sm` (mobile).

---

## 10. Iconography

- Library: **Lucide Icons** (`lucide-react`)
- Default size: 20px inside body text, 16px inside buttons and badges
- Colour: inherit from parent text colour (`currentColor`)
- Do not use decorative icons at more than one size per screen

---

## 11. Motion

- **Duration:** 150ms (micro), 200ms (standard), 300ms (large)
- **Easing:** `ease-out` for enters, `ease-in` for exits, `ease-in-out` for continuous
- **No animation** on skeletons that flash faster than 400ms — it's more distracting than helpful
- **Respect** `prefers-reduced-motion` — provide non-animated fallback

---

## 12. Accessibility (non-negotiable)

- **Contrast:** WCAG AA (4.5:1 body, 3:1 large text)
- **Keyboard navigation:** every interactive element must be reachable and operable by keyboard
- **Focus visible:** never remove focus rings — restyle them if needed
- **ARIA labels:** all icon-only buttons must have `aria-label`
- **Form fields:** every input has a visible label (not just placeholder)
- **Modal focus trap:** focus stays inside modal until dismissed
- **Colour is never the only signal:** pair with icon, text, or shape

---

## 13. Figma reference

Structure of the Figma file:

- **Cover** — file overview
- **Design tokens** — colours, type scale, spacing
- **Component library** — primitives, layout, feedback, navigation
- **Owner screens** — reference for consistency
- **Tenant screens** — reference for consistency
- **Service Provider screens** — current build focus
- **Public / pre-login screens** — landing, listings, search
- **Officer screens** — regulator portal
- **Admin screens**

Frame-level links per section are maintained in `/design/figma-links.md`.

---

## 14. Changelog

Track changes here so devs know when to re-sync tokens.

| Date | Change | Author |
|---|---|---|
| _yyyy-mm-dd_ | Initial version. | _Name_ |
| 2026-08-04 | Corrected `text-dark` (`#1b1b1f`→`#171a1f`) and `text-body`/`text-muted` (`#5f6b76`→`#565d6d`) to match real values sampled from Figma's Owner Home screen. Filled in exact `shadow-sm` value (confirmed from Figma, matches existing `Card` `dashboard` variant). Noted `radius-xl` also covers dashboard quick-link cards. | Claude Code (Phase 5, Feature 1 — shared foundation) |

