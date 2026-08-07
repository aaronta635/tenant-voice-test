# TenantVoice — Scope

This document defines what belongs in each delivery tier. It is the authoritative scope reference — if it conflicts with anything else, this file wins until it is updated by the coordinator.

**Owner:** Nguyen Ta (Project Coordinator).
**Last confirmed with supervisor:** _to be dated at supervisor sign-off._

---

## How to read this

Three tiers:

- **Base** — must work end-to-end at the final demo. These features are the product.
- **Nice-to-have** — build if capacity allows once Base is complete and stable. Not required for a successful demo.
- **Stretch** — designed, mocked, or partially scaffolded. Not fully implemented under capstone scope. Shown at the demo as architecture and UI, not working functionality.

### For anyone (including Claude Code) about to build a feature

1. Find it below. Which tier is it in?
2. If it's **Base**, build it fully.
3. If it's **Nice-to-have**, confirm Base is complete before starting.
4. If it's **Stretch**, do not implement real integrations. Build the UI, stub the backend, and note it in the demo script.
5. If it's not listed, do not build it. Ask the coordinator first.

---

## Sequencing (which section to build first)

Per supervisor direction:

1. **Service Provider section** — current focus
2. **Public / pre-login pages** — needed to browse SP profiles
3. **Landlord / Owner dashboard**
4. **Tenant dashboard**
5. **Admin dashboard**
6. **NSW Fair Trading Officer portal**

Sequencing does not change the tier of any feature — it changes the order in which tiers are built.

---

## 1. Public (Pre-login)

### Base
- Landing page with clear value proposition
- Browse property listings (grid + list view)
- Property search with filters: location, price, type, bedrooms
- View public property listing detail
- Browse service provider categories
- View public service provider profile (Airbnb-style)
- Search service providers by category, location, rating, price
- Read verified reviews on properties and providers
- Static information pages: FAQs, rental rights, how-it-works, contact
- Signup and login (tenant / landlord / service provider)

### Nice-to-have
- Save favourite properties and providers (requires auth)
- Sort options beyond default (most reviewed, newest, cheapest)
- Neighbourhood insights on listings (aggregate rent, response times)

### Stretch
- Map view alongside listings and providers
- Auto-fill listing data from an external URL (realestate.com.au, Domain)

---

## 2. Service Provider

### Base

**Public profile (Airbnb-style)**
- Profile header: photo, name, category, location, verification badges, rating, review count, "Contact" CTA
- About section: full bio, experience, service area, languages, specialties
- Services offered with fixed prices, descriptions, durations
- Reviews list with overall rating, individual reviews, provider replies

**Onboarding (post-signup)**
- Step 1: select provider category
- Step 2: business details (business name, ABN, contact, service location)
- Step 3: add at least one service with fixed price
- Step 4: upload verification documents (ID, licence, insurance)
- Step 5: set availability (days, hours, service radius)
- Step 6: preview and publish

**Dashboard**
- Welcome / profile summary card with profile completion percentage
- Booking / enquiry summary counters (new, pending, active, completed)
- Earnings summary (available, pending, this month, lifetime)
- Recent messages preview
- Recent reviews preview

**Manage services**
- List, add, edit, delete fixed-price services
- Set service area and availability per service

**Bookings**
- View incoming enquiries and booking requests
- Accept / decline / suggest new time
- Track booking status: enquiry → confirmed → in progress → completed
- View booking history

**Messages**
- Conversation list (last message, unread badge)
- Chat view with a client, per booking
- Send text messages
- Send file attachments

**Reviews**
- View all received reviews with rating breakdown
- Reply to reviews
- Flag inappropriate reviews for admin

**Finance (mocked totals, real ledger structure)**
- Earnings overview
- Transaction history (payments received, refunds, platform fees)
- Invoices list with download

**Verification**
- Upload and manage documents
- Show status of each: pending, verified, rejected
- Verification badges appear on public profile

### Nice-to-have

- Availability calendar view (like Airbnb)
- Search "client requests / find work" — property owners posting service needs (fixed-price offers only, no bidding)
- Save opportunities / invitations
- Portfolio / work samples on public profile (photos, before/after, certificates)
- Reply-to-review AI writing assistance
- Detailed earnings analytics by service, client, time period
- Custom pricing packages (bundles, tiered pricing)

### Stretch

- Real payment processing (Stripe/PayPal)
- Real withdrawal / payout to bank
- Tax reporting exports (BAS-ready)
- Real invoice generation with PDF and email
- Automatic dispute resolution workflow
- Google Calendar / iCal sync
- Public API for provider integrations

---

## 3. Landlord / Owner

### Base

**Dashboard**
- Portfolio overview: number of properties, occupancy, active complaints, upcoming inspections
- Recent activity feed

**Property portfolio management**
- Add, edit, delete property listings
- Upload property photos
- Mark property as available / rented / off-market
- View property performance (views, applications, reviews)

**Applications**
- List of incoming tenant applications per property
- View application detail: profile, rental history, verification status
- Approve / decline application

**Digital lease**
- Draft a lease from a template
- Send to tenant for signing
- View signed leases
- (Signatures are captured as typed acknowledgement + timestamp — not a real e-signature product)

**Rent tracking**
- View rent status per tenant: paid / unpaid / overdue
- Log manual payments
- Rent history and ledger per property

**Maintenance**
- View maintenance requests submitted by tenants
- Assign a service provider from the platform
- Track request status: open → in progress → resolved
- Communicate with tenant and provider on the request

**Reviews and complaints**
- View reviews on their properties
- View complaints logged against them
- Respond to reviews and complaints

**Inspections**
- Schedule inspections with automated reminders to tenant
- Log inspection reports

**Search service providers**
- Filter and search the SP marketplace by category, rating, location, price

### Nice-to-have

- Multi-property batch operations (bulk messages, bulk rent reminders)
- Auto rental ledger export to CSV/PDF
- Advanced financial dashboard (revenue, expenses, ROI per property)
- Tenant screening tools (AI-assisted risk scoring)
- Broadcast announcements to all current tenants

### Stretch

- AI Property Management Assistant (agentic — creates listings, sends reminders, evaluates applications, manipulates dashboard on command)
- Real online rent collection with direct debit
- Real e-signature product (DocuSign integration)
- Virtual / 360° property inspections
- Immediate unit access via integrated smart locks
- Automated rental price recommendation
- Predictive maintenance from historical data

---

## 4. Tenant

### Base

**Dashboard**
- Overview: current lease, next rent due, open maintenance requests, recent messages

**Profile**
- Personal details, verification (ID)
- Rental history (past tenancies with property + landlord)
- Documents storage (ID, reference letters, payslips)

**Property search and application**
- Search properties (same as public search)
- Save favourites
- Submit application to a property using stored profile
- Track application status

**Digital lease signing**
- View lease sent by landlord
- Sign (typed acknowledgement + timestamp)
- Access signed lease anytime

**Rent payment**
- View rent status
- Log a payment as paid (mocked confirmation; no real transaction)
- View payment history

**Maintenance requests**
- Submit a request with description, category, photos
- Track request status
- Message with landlord and assigned provider

**Reviews**
- Submit verified review of landlord and property after lease is confirmed
- Rate: responsiveness, property condition, communication
- View past reviews submitted

**Messages**
- Chat with landlord, service providers assigned to their maintenance, and platform support

**Complaints**
- Submit a formal complaint (separate from a review)
- Categorise: safety, maintenance, harassment, other
- Track resolution status

### Nice-to-have

- Smart matching: recommendation of properties based on preferences and history
- Compatibility score per property
- One-click application using saved profile
- Automated notifications and reminders
- AI chat assistant for common questions (rights, process, application help)
- Network / connections: find potential housemates

### Stretch

- Real rent payment via direct debit or card
- AR/VR virtual property inspection
- AI-powered rental rights advice with citations to NSW legislation
- Sentiment-aware review submission (detect and moderate emotional language)

---

## 5. NSW Fair Trading Officer

### Base

**Access**
- Secure login (verified account — for capstone, a manually flagged role in `profiles`)
- Regulatory portal with distinct navigation from other roles

**Dashboards**
- Aggregate statistics: number of properties, complaints, red-flag alerts
- Complaint trends over time
- Rating distributions across landlords and properties
- Download data as CSV / PDF

**Ratings and complaints monitoring**
- Search and filter all complaints across the platform
- View complaint detail (de-identified where required)
- View tribunal-linked outcomes

**Red-flag alerts**
- Automated alerts when a landlord or property crosses a defined threshold (e.g. N unresolved complaints)
- Alert list with severity and recommended action
- Mark alerts as reviewed

**De-identified data access**
- Aggregated rental data by suburb / postcode
- Complaint category breakdowns

### Nice-to-have

- Request datapoint updates from admin (e.g. new complaint category)
- Create and distribute housing surveys to platform users
- Custom threshold configuration for red-flag alerts
- Export scheduled reports on a recurring basis

### Stretch

- Real integration with NSW Fair Trading systems
- Automated case creation in tribunal workflow
- Real-time market rent monitoring for policy input
- Predictive analytics on regulatory hotspots

---

## 6. Admin

### Base

**Platform activity**
- Overview: users by role, active sessions, recent signups, error logs

**Moderation**
- Review flagged reviews and complaints
- Ban / suspend users
- Restore content

**Complaints and analytics**
- Global complaint list with filters
- Complaint resolution time metrics

**Red-flag oversight**
- View all red-flag alerts across the platform
- Adjust thresholds (basic)

**Category management**
- Manage service provider categories
- Manage maintenance issue categories

### Nice-to-have

- User support tools: impersonate user for debugging, send platform-wide announcements
- Audit log of all admin actions
- Bulk user actions

### Stretch

- Full CMS for static content (FAQs, rental rights pages)
- Advanced fraud detection with ML
- Automated moderation using AI

---

## 7. AI features

### Base
- **Support chatbot** (LLM-wrapper) — answers common questions about using the platform, rental rights, and process. Available to tenants, landlords, and providers.
- **Draft-message assistant** — user asks for help writing a message; AI drafts, user edits, user sends. No autonomous sending.

### Nice-to-have
- **Smart matching (rules-based)** — score tenant/property compatibility on preferences, budget, verification. Not ML — heuristic scoring.
- **Provider recommendation** — rank providers by rating × proximity × price match.
- **Review reply assistant** — help providers draft replies to reviews.

### Stretch
- **Agentic AI Property Management Assistant** — creates listings, sends reminders, evaluates applications, manipulates dashboard on command.
- **AI applicant scoring** — ML model predicting tenancy risk.
- **Sentiment analysis on complaints and reviews** — surface systemic issues.
- **AI predictive maintenance** — analyse history to predict failures.
- **Automated legal compliance checking** — validate leases against NSW law.

---

## 8. Cross-cutting requirements (all Base)

- Role-based access control enforced at RLS layer, not just UI
- Responsive design (desktop-first, verified at tablet and mobile widths)
- Accessibility: WCAG AA compliance
- All uploads virus-scanned and size-limited
- All PII fields encrypted at rest (Supabase default)
- Error states, empty states, and loading states on every data view
- Every user action has an audit trail entry (who, what, when)

---

## 9. Explicit non-goals

To prevent scope drift, we are **explicitly not building**:

- Real money movement of any kind — rent, payouts, deposits, service fees
- Legally binding e-signatures (real DocuSign / RightSignature integration)
- Real integration with NSW Fair Trading production systems
- Real integration with realestate.com.au / Domain / Airbnb
- Smart lock hardware integration
- Native iOS / Android apps (web-only, responsive)
- Multi-tenant / multi-region infrastructure
- Multi-language support
- Real credit / background check integration

If a user story implies any of the above, it belongs in Stretch as a mocked flow.

---

## 10. Change log

| Date | Change | Author |
|---|---|---|
| _yyyy-mm-dd_ | Initial tier list based on supervisor's scope brief and A2 requirements. | _Name_ |
