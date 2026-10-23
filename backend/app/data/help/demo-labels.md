# Demo labels

## What a Demo label means
Page: /faqs
For: all
Keywords: demo, demo label, sample, simulated, fake, test, not real, placeholder, pill, notice

A Demo label, as a small pill or a notice with a reason, marks something on
TenantVoice that shows sample data or only works as a demonstration. The
reason says what is not real, for example that no money is moved or that a
choice is not saved yet. Everything without a Demo label works for real: the
pages show what the server saved, and actions change your records.

## Sample accounts
Page: /faqs
For: all
Keywords: demo account, sample account, fictional, walkthrough, test account, sample business
Demo: frontend/app/components/owner/OwnerShell.tsx, frontend/app/components/tenant/TenantShell.tsx, frontend/app/components/provider/DemoNotice.tsx, frontend/app/components/admin/AdminShell.tsx

Some accounts are fictional ones made for a TenantVoice walkthrough. While
you use one, a notice says the people, homes, bookings and messages are
sample data. Real accounts never carry that notice.

## Simulated payments and plans
Page: /faqs
For: all
Keywords: payment, pay, money, rent, subscription, plan, pass, billing, charge, refund, payout
Demo: frontend/app/(dashboard)/dashboard/finances/page.tsx, frontend/app/components/bookings/BookingList.tsx, frontend/app/components/tenant/TenantScreenTemplates.tsx, frontend/app/(owner)/owner/subscription/page.tsx

TenantVoice does not move money. Rent is paid directly between tenants and
landlords: a landlord records what they received on their Rent ledger, and a
tenant sees it under My rent. A provider's Finances page is a simulated ledger, and
completing a booking records a simulated payment and fee. Choosing a tenant
access pass or an owner plan records it without any payment, and its limits
and features are not enforced. Each of these carries a Demo label.

## The readiness score
Page: /tenant/scorecard
For: tenant
Keywords: readiness score, demo
Demo: frontend/app/components/tenant/TenantScreenTemplates.tsx

One tenant step is still a demonstration, with a Demo label. The readiness
score on the Scorecard page is worked out in your browser and is not saved.
It is not an owner's scorecard: those are real, and you ask for one from the
Scorecards card on your dashboard. Inspections, leases and review photos are
real: you book an inspection time your landlord published, your landlord
sends the lease, which you read and sign on your Leases page, and review
photos are uploaded with your review.

## Files are not virus-scanned yet
Page: /faqs
For: all
Keywords: virus, scan, malware, attachment, file, upload, safe, security
Demo: frontend/app/components/provider/UnscannedFilesNotice.tsx

While no virus scanner is connected, uploaded files, such as message
attachments, are stored without a virus scan; the provider inbox shows a Not
virus-scanned notice for this reason. Only open files from people you trust.

## The owner assistant chat
Page: /owner/help/ai-chat
For: landlord
Keywords: owner assistant, AI chat, ask AI, assistant, dashboard data
Demo: frontend/app/(owner)/owner/help/ai-chat/page.tsx

The owner assistant on the AI Chat tab is separate from this support chat.
It answers from your listings, applications, repairs and rent ledger: an AI
model once one is connected and your account is verified, otherwise fixed
rules, marked AI unavailable. A change it suggests is shown first and
happens only when you confirm it. Only replies it saved before it answered
from your records carry a Demo label.

## The provider demo workspace
Page: /dashboard
For: service_provider
Keywords: demo provider, sample business, walkthrough, sample bookings, sample earnings
Demo: frontend/app/components/provider/DemoNotice.tsx

On a sample provider account, every workspace page shows a notice that the
business, bookings, reviews and earnings are sample data for a TenantVoice
walkthrough. A real provider's workspace has no such notice.
