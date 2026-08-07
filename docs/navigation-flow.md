# Navigation Flow — Owner/Landlord Section (Figma "Section 1")

Source: Figma file `Hifi-capstone` (`vVDzgkhfI1I2mVdlOILG6O`), node `399:20`.

Two kinds of navigation entries below:
- **[figma-prototype]** — read directly from Figma's real Prototype-mode `reactions` via the Plugin API (highest-confidence source available; this file did not exist before this audit).
- **[manual — TODO: confirm]** — not wired in Figma's prototype. Supplied manually by the project owner during this audit. Implementation should carry a `// TODO: no real Figma prototype connection — confirm with design` comment at the point this route is wired in code.

## Persistent navigation (present on every screen)
- "Dashboard" → HomeFlow - Dashboard **[figma-prototype]**
- "Subscription" → Manage Subscription **[figma-prototype]** (confirmed on 19 of 20 screens; Home's own copy has the click trigger but an empty action — **[manual — TODO: confirm]** same destination, and flag to design team as a Figma-source bug to fix, not just a code workaround)
- "Help & Support" → Help & Contact **[figma-prototype]**
- "Messages" → Messages **[figma-prototype]**
- "Properties" → Property Listings **[manual — TODO: confirm]** (unwired in Figma on every screen)
- "Network" → Network & Connections **[manual — TODO: confirm]** (unwired in Figma on every screen)
- Notification bell icon → Notifications (NotifyPro) **[manual — TODO: confirm]** (no real Figma prototype connection found anywhere into NotifyPro — none of the 58 real reactions pulled from Section 1 target it)

## Home (HomeFlow - Dashboard)
- "Ratings & Reviews" card → Scorecard **[figma-prototype]**
- "Properties" card → Property Listings **[figma-prototype]**
- "Rental Applications" card → Applications Dashboard **[figma-prototype]**
- "Search for Profiles" card → Profile **[figma-prototype]**
- "Recommendations" card → Recommendations **[figma-prototype]**
- "In-App Chat" card → Messages **[manual — TODO: confirm]**
- "Your Connections" card → Network & Connections **[manual — TODO: confirm]**
- "AI Assistant" card → AI Chat Support **[manual — TODO: confirm]**

## Applications
- Applications Dashboard —(Filter)→ Filter Applications **[figma-prototype]**
- Applications List —(Filter)→ Filter Applications **[figma-prototype]**
- Filter Applications —(apply)→ Applications List **[figma-prototype]**
- Filter Applications —(close)→ Applications Dashboard **[figma-prototype]**

## Property
- Property Analytics —(Get QR Code)→ Property QR Code **[figma-prototype]**
- Property Analytics —(button)→ Property Details **[figma-prototype]**
- Property QR Code —(button)→ Property Details **[figma-prototype]**
- Property Details —("Analytics" tab)→ Property Analytics **[figma-prototype]** (see "In-screen tab state" below for why this tab is different from its two siblings)
- Property Details —(applicant row action)→ Messages **[figma-prototype]**
- Property Details —("View All 8 Applications" bar)→ Applications List **[manual — TODO: confirm]**

### Property Details — in-screen tab state (not navigation)

Property Details has three tabs. Only one of them is a real route change — this is intentional, confirmed correct behaviour, not a wiring gap:

- **"Details"** — the default active tab. Selecting it does not navigate; it shows the details panel already present on the screen. No Figma prototype wiring, by design.
- **"Applications"** — in-screen state only. Swaps the panel content to the applicant list within the same screen. No route change. No Figma prototype wiring, by design.
- **"Analytics"** — the one exception. Property Analytics was designed as a separate Figma frame, so this tab genuinely navigates there. This is why it alone carries real prototype wiring.

Do not flag "Details" or "Applications" as missing navigation wiring in future audits — their lack of a prototype connection is correct, not an oversight.

## Create Listing (wizard)
- Create Listing - Property Details —(Continue)→ Create Listing - Photos & Description **[figma-prototype]**
- Create Listing - Photos & Description —(Continue)→ Create Listing - Rental Terms **[figma-prototype]**
- Create Listing - Photos & Description —(Save & exit)→ Profile **[figma-prototype]**
- Create Listing - Rental Terms —(Back)→ Create Listing - Photos & Description **[figma-prototype]**
- Create Listing - Rental Terms —(Submit/Publish)→ Property Listings **[manual — TODO: confirm]**

## Help & AI Chat
- Help & Contact —(Chat with AI)→ AI Chat Support **[figma-prototype]**
- AI Chat Support —(back)→ Help & Contact **[figma-prototype]**

## Notifications
- NotifyPro —(notification item)→ **out of scope**: navigates to a Messages screen inside `Tosan - Tenant Screens`. Not implemented — recorded per scope lock only, per the project's Figma scope-lock rule.

## Support contact details (Help & Contact)
Real support email and phone are not yet known. Do not invent them; do not derive a domain from the product name. To be stored in a single shared constants/config file (e.g. `frontend/app/lib/contact-info.ts`) with a `// TODO: confirm real support email/phone with team` comment, referenced by the Help & Contact screen — a Phase 5 implementation task, not done as part of this document.

## Status
No open/unresolved navigation items remain as of this audit.
