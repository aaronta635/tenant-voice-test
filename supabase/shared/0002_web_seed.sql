-- TenantVoice — catalogue rows for the web schema on the shared Supabase project
-- Run after 0001_web_schema.sql (README.md).
--
-- The marketplace categories, subscription plans, FAQs and platform settings
-- the web shows, copied from supabase/seed.sql (section 1) into web.*. Only
-- these: the rest of seed.sql is demo people and data for the old project
-- and must never run on the shared one.
--
-- Safe to re-run: a row whose key already exists (slug, code,
-- audience + question, key) is left as it is, edits included.

begin;

-- As in 0001: wait at most 5 s for a lock, then fail and roll back. These
-- inserts lock only the web catalogue tables. On a timeout, run again.
set local lock_timeout = '5s';

insert into web.service_categories (slug, category, name, description, icon_bg, badge, sort_order) values
  ('co-host-inspector', 'co_host_inspector', 'Co-Host Inspector',
   'Pre-stay walkthroughs, damage reports and listing audits for Airbnb hosts.', '#eeeffd', 'NEW', 1),
  ('real-estate-agent', 'real_estate_agent', 'Real Estate Agent',
   'Sales, rentals and appraisals from licensed agents in your suburb.', '#eef2f5', null, 2),
  ('real-estate-accountant', 'accountant', 'Real Estate Accountant',
   'Tax, structuring and depreciation schedules tailored to property investors.', '#e6f0ea', null, 3),
  ('tradies', 'tradie', 'Tradies',
   'Electricians, plumbers, painters and handymen with clear upfront pricing.', '#f5ede2', null, 4),
  ('cleaning-provider', 'cleaner', 'Cleaning Provider',
   'Bond cleans, recurring service, end-of-stay turnovers, deep cleans.', '#f7f0e6', null, 5),
  ('property-maintenance', 'property_manager', 'Property Maintenance',
   'Gardens, gutters, smoke alarms and seasonal inspections on schedule.', '#e6f0ea', null, 6),
  ('legal-tenancy-support', 'conveyancer', 'Legal & Tenancy Support',
   'Tenancy disputes, lease reviews, NCAT representation and bond recovery.', '#eeeffd', null, 7),
  ('photographer', 'photographer', 'Photographer',
   'Listing photography, floor plans and virtual tours.', '#f7f1e6', null, 8),
  ('other', 'other', 'Other',
   'Additional property-related services.', '#f4f4f8', null, 9)
on conflict (slug) do nothing;

insert into web.subscription_plans (code, name, audience, price, billing_period, description, features, is_popular, sort_order) values
  ('owner_basic', 'Basic', 'landlord', 9.99, 'month', 'Get your first listings online.',
   array['Up to 2 property listings','Basic analytics','Email support','Standard tenant screening'], false, 1),
  ('owner_professional', 'Professional', 'landlord', 29.99, 'month', 'For growing portfolios.',
   array['Up to 10 property listings','Advanced analytics & insights','Priority email support','Advanced tenant screening'], true, 2),
  ('owner_premium', 'Premium', 'landlord', 49.99, 'month', 'Everything, unlimited.',
   array['Unlimited property listings','Full analytics suite','24/7 priority support','Premium tenant screening','QR code generation'], false, 3),
  ('tenant_day_pass', '24 Hours Access', 'tenant', 9.99, 'one-time', 'One-time purchase.',
   array['24 hours of full review access','Read every verified building review'], false, 1),
  ('tenant_quarter_pass', '3 Months Access', 'tenant', 19.99, 'one-time', 'One-time purchase.',
   array['3 months of full review access','Read every verified building review','Save searches'], false, 2)
on conflict (code) do nothing;

insert into web.faqs (audience, question, answer, sort_order) values
  ('landlord', 'How do I create a property listing?',
   'Go to Properties and click "Add Property". Follow the step-by-step wizard to add details, photos, and rental terms, then publish.', 1),
  ('landlord', 'How long does identity verification take?',
   'Most identity verifications complete within 1-2 business days once all required documents are submitted.', 2),
  ('landlord', 'Can I edit a published listing?',
   'Yes — open the listing from Properties and use the Edit option to update details, photos, or rental terms at any time.', 3),
  ('landlord', 'What payment methods are supported for rent?',
   'Rent collection is not available in this release. Arrange payments directly with your tenant; TenantVoice does not collect rent.', 4),
  ('landlord', 'How do I contact my tenant directly?',
   'Use the Messages section to start or continue a conversation with any tenant.', 5),
  ('tenant', 'How do I apply for a property?',
   'Open the listing from Properties and use "Apply for this property". You can attach income details and a message to the landlord.', 1),
  ('tenant', 'When can I write a review?',
   'Once a tenancy is confirmed you can submit a review from Ratings & Reviews. Reviews are moderated before they go live.', 2),
  ('service_provider', 'When do I get paid?',
   'Payments and payouts are simulated in this capstone release; no money is transferred. Finances shows the demonstration ledger for completed bookings.', 1),
  ('all', 'How do I delete my account?',
   'Use the Contact support page to request account deletion. Include your account email; the support team will explain the next steps.', 9)
on conflict (audience, question) do nothing;

insert into web.platform_settings (key, value, description) values
  ('support_email', 'support@tenantvoice.test', 'Support inbox shown on Help & Support'),
  ('support_phone', '1800 836 268', 'Support phone number shown on Help & Support'),
  ('marketplace_city_default', 'Sydney', 'Default city tab on the landing page')
on conflict (key) do nothing;

commit;
