-- TenantVoice — demo seed data (LOCAL / DEV ONLY)
-- Apply order: 0001 -> 0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> seed.sql
--
-- This is the single source of truth for every screen in the app: there is no
-- mock data left in the frontend, so anything you want to see in the UI has to
-- exist here.
--
-- It inserts demo rows into auth.users directly, which the local Supabase stack
-- supports (`supabase db reset`). On a HOSTED project either run this with the
-- service role via the SQL editor (it works — auth.users is writable there), or
-- create the users through the Auth API first and re-run only the public.*
-- sections with the real UUIDs.
--
-- Password for every demo account: "password123".

-- ---------------------------------------------------------------------------
-- Helper: create an auth user + enrich the profile the trigger just made.
-- Dropped again at the end of this file.
-- ---------------------------------------------------------------------------
create or replace function public.seed_user(
  p_id       uuid,
  p_email    text,
  p_name     text,
  p_role     user_role,
  p_location text default null,
  p_state    text default null,
  p_postcode text default null,
  p_avatar   text default null,
  p_phone    text default null
) returns uuid language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('password123', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_name, 'role', p_role::text)
  )
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name, location, state, postcode, avatar_url, phone, created_at)
  values (p_id, p_role, p_name, p_location, p_state, p_postcode, p_avatar, p_phone, now() - interval '2 years')
  on conflict (id) do update set
    role       = excluded.role,
    full_name  = excluded.full_name,
    location   = excluded.location,
    state      = excluded.state,
    postcode   = excluded.postcode,
    avatar_url = excluded.avatar_url,
    phone      = excluded.phone,
    created_at = least(public.profiles.created_at, excluded.created_at);

  return p_id;
end $$;


-- ===========================================================================
-- 1. Reference data — categories, plans, FAQs, platform settings
-- ===========================================================================
insert into public.service_categories (slug, category, name, description, icon_bg, badge, sort_order) values
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
on conflict (slug) do update set
  name = excluded.name, description = excluded.description,
  icon_bg = excluded.icon_bg, badge = excluded.badge, sort_order = excluded.sort_order;

insert into public.subscription_plans (code, name, audience, price, billing_period, description, features, is_popular, sort_order) values
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
on conflict (code) do update set
  name = excluded.name, price = excluded.price, features = excluded.features,
  is_popular = excluded.is_popular, sort_order = excluded.sort_order;

insert into public.faqs (audience, question, answer, sort_order) values
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
on conflict do nothing;

insert into public.platform_settings (key, value, description) values
  ('support_email', 'support@tenantvoice.test', 'Support inbox shown on Help & Support'),
  ('support_phone', '1800 836 268', 'Support phone number shown on Help & Support'),
  ('marketplace_city_default', 'Sydney', 'Default city tab on the landing page')
on conflict (key) do update set value = excluded.value;


-- ===========================================================================
-- 2. People, providers, properties and everything they generate
-- ===========================================================================
do $$
declare
  -- service providers
  u_amelia  uuid := 'a0000000-0000-4000-8000-000000000001';
  u_daniel  uuid := 'a0000000-0000-4000-8000-000000000002';
  u_spark   uuid := 'a0000000-0000-4000-8000-000000000003';
  u_priya   uuid := 'a0000000-0000-4000-8000-000000000004';
  u_schen   uuid := 'a0000000-0000-4000-8000-000000000005';
  u_marcus  uuid := 'a0000000-0000-4000-8000-000000000006';

  -- tenants / clients
  u_jon     uuid := 'b0000000-0000-4000-8000-000000000001';
  u_mei     uuid := 'b0000000-0000-4000-8000-000000000002';
  u_tom     uuid := 'b0000000-0000-4000-8000-000000000003';
  u_vanessa uuid := 'b0000000-0000-4000-8000-000000000004';
  u_khoury  uuid := 'b0000000-0000-4000-8000-000000000005';
  u_ryan    uuid := 'b0000000-0000-4000-8000-000000000006';
  u_jane    uuid := 'b0000000-0000-4000-8000-000000000007';
  u_jsmith  uuid := 'b0000000-0000-4000-8000-000000000008';
  u_jessica uuid := 'b0000000-0000-4000-8000-000000000009';

  -- landlords / owners
  u_owner   uuid := 'c0000000-0000-4000-8000-000000000001';
  u_sarahj  uuid := 'c0000000-0000-4000-8000-000000000002';
  u_mchen   uuid := 'c0000000-0000-4000-8000-000000000003';
  u_emily   uuid := 'c0000000-0000-4000-8000-000000000004';
  u_dkim    uuid := 'c0000000-0000-4000-8000-000000000005';
  u_elena   uuid := 'c0000000-0000-4000-8000-000000000006';
  u_amanda  uuid := 'c0000000-0000-4000-8000-000000000007';
  u_admin   uuid := 'd0000000-0000-4000-8000-000000000001';

  -- provider records
  p_amelia uuid; p_daniel uuid; p_spark uuid; p_priya uuid; p_schen uuid; p_marcus uuid;

  -- Amelia's services
  s_appraisal uuid; s_openhome uuid; s_screening uuid; s_listing uuid; s_portfolio uuid;
  -- Daniel's services
  s_prestay uuid; s_poststay uuid; s_insurance uuid;

  -- bookings
  bk_vp uuid; bk_dr uuid; bk_jh uuid; bk_ml uuid; bk_tw uuid;
  bk_sk uuid; bk_rk uuid; bk_pb uuid; bk_an uuid;

  -- conversations
  cv_jh uuid; cv_ml uuid; cv_tw uuid; cv_vp uuid; cv_dr uuid;
  cv_rent_jane uuid; cv_rent_jon uuid;

  -- properties
  pr_loft uuid; pr_family uuid; pr_studio uuid;

  plan_pro uuid;
begin
  -- -------------------------------------------------------------------------
  -- Accounts
  -- -------------------------------------------------------------------------
  perform public.seed_user(u_amelia,  'amelia@demo.test',   'Amelia Whitlock',        'service_provider', 'Newtown',      'NSW', '2042', null, '+61 412 555 018');
  perform public.seed_user(u_daniel,  'daniel@demo.test',   'Daniel Russo',           'service_provider', 'Inner West',   'NSW', '2204', null, '+61 412 555 021');
  perform public.seed_user(u_spark,   'spark@demo.test',    'Bright Spark Electrical','service_provider', 'Marrickville', 'NSW', '2204', null, '+61 412 555 034');
  perform public.seed_user(u_priya,   'priya@demo.test',    'Priya Basu, CPA',        'service_provider', 'Sydney CBD',   'NSW', '2000', null, '+61 412 555 047');
  perform public.seed_user(u_schen,   'sarahchen@demo.test','Sarah Chen',             'service_provider', 'Newtown',      'NSW', '2042', null, '+61 412 555 059');
  perform public.seed_user(u_marcus,  'marcus@demo.test',   'Marcus Lee',             'service_provider', 'Surry Hills',  'NSW', '2010', null, '+61 412 555 062');

  perform public.seed_user(u_jon,     'jonathan@demo.test', 'Jonathan Hayes', 'tenant', 'Marrickville', 'NSW', '2204', null, '+61 400 111 001');
  perform public.seed_user(u_mei,     'mei@demo.test',      'Mei Lin',        'tenant', 'Newtown',      'NSW', '2042', null, '+61 400 111 002');
  perform public.seed_user(u_tom,     'tom@demo.test',      'Tom Whittaker',  'tenant', 'Petersham',    'NSW', '2049', null, '+61 400 111 003');
  perform public.seed_user(u_vanessa, 'vanessa@demo.test',  'Vanessa Park',   'tenant', 'Stanmore',     'NSW', '2048', null, '+61 400 111 004');
  perform public.seed_user(u_khoury,  'sarahk@demo.test',   'Sarah Khoury',   'tenant', 'Newtown',      'NSW', '2042', null, '+61 400 111 005');
  perform public.seed_user(u_ryan,    'ryan@demo.test',     'Ryan Kelly',     'tenant', 'Marrickville', 'NSW', '2204', null, '+61 400 111 006');
  perform public.seed_user(u_jane,    'client@demo.test',   'Jane Doe',       'tenant', 'Sydney',       'NSW', '2000', null, '+61 400 111 007');
  perform public.seed_user(u_jsmith,  'jsmith@demo.test',   'John Smith',     'tenant', 'Redfern',      'NSW', '2016', null, '+61 400 111 008');
  perform public.seed_user(u_jessica, 'jessica@demo.test',  'Jessica Lee',    'tenant', 'Erskineville', 'NSW', '2043', null, '+61 400 111 009');

  perform public.seed_user(u_owner,  'owner@demo.test',  'John Doe',         'landlord', 'Newtown',    'NSW', '2042', null, '+61 412 345 678');
  perform public.seed_user(u_sarahj, 'sarahj@demo.test', 'Sarah Jenkins',    'landlord', 'Glebe',      'NSW', '2037', null, '+61 400 222 001');
  perform public.seed_user(u_mchen,  'mchen@demo.test',  'Michael Chen',     'landlord', 'Petersham',  'NSW', '2049', null, '+61 400 222 002');
  perform public.seed_user(u_emily,  'emily@demo.test',  'Emily Davis',      'landlord', 'Glebe',      'NSW', '2037', null, '+61 400 222 003');
  perform public.seed_user(u_dkim,   'dkim@demo.test',   'David Kim',        'landlord', 'Ashfield',   'NSW', '2131', null, '+61 400 222 004');
  perform public.seed_user(u_elena,  'elena@demo.test',  'Elena Rodriguez',  'landlord', 'Leichhardt', 'NSW', '2040', null, '+61 400 222 005');
  perform public.seed_user(u_amanda, 'amanda@demo.test', 'Amanda Thorne',    'landlord', 'Balmain',    'NSW', '2041', null, '+61 400 222 006');
  perform public.seed_user(u_admin,  'admin@demo.test',  'TenantVoice Trust','admin',    'Wollongong', 'NSW', '2500', null, null);

  -- -------------------------------------------------------------------------
  -- Service provider profiles
  -- -------------------------------------------------------------------------
  insert into public.service_providers (
    profile_id, category, slug, business_name, abn, tagline, bio, headline, badge_label,
    years_experience, languages, skills, specialties, gallery_urls, service_radius_km,
    website, response_time, availability_note, is_online, is_published, profile_completion
  ) values
  (u_amelia, 'real_estate_agent', 'amelia-whitlock', 'Whitlock Property', '51 824 753 556',
   'Fixed-price appraisals and listing prep for Inner West owners',
   'Licensed agent helping Inner West owners with appraisals, listing prep and tenant screening. Fixed prices, same-day reports.',
   'Rental appraisals, listing prep & tenant screening', 'SUPER HOST',
   7, array['English'], array['Appraisals','Listing preparation','Tenant screening'],
   array['Rental appraisals','Listing preparation','Tenant screening','Open home attendance','Portfolio reviews'],
   array['/landing/gallery-1.png','/landing/gallery-2.png','/landing/gallery-3.png','/landing/gallery-4.png','/landing/hero.png'],
   15, 'whitlock.co', 'Under 2 hours', 'Books this week', true, true, 67),

  (u_daniel, 'co_host_inspector', 'daniel-russo', 'Russo Inspections', '73 118 902 445',
   'Pre-stay walkthroughs and damage reports across the Inner West',
   'Seven years inspecting short-stay properties across Sydney''s Inner West. Before TenantVoice I ran the inspections desk at a 200-listing Airbnb management company, so I know exactly what hosts need documented to avoid disputes.',
   'Pre-stay walkthroughs & damage reports', 'TOP RATED',
   7, array['English','Italian'], array['Inspections','Condition reports','Photography'],
   array['Pre-stay walkthroughs','Post-stay damage audits','Insurance evidence reports','Listing photo audits','Furniture & amenity inventory','Bond return disputes','Apartment buildings','Beachside properties'],
   array['/landing/gallery-1.png','/landing/gallery-2.png','/landing/gallery-3.png','/landing/gallery-4.png','/landing/hero.png'],
   10, 'russoinspections.test', 'Under 2 hours', 'Available tomorrow', true, true, 100),

  (u_spark, 'tradie', 'bright-spark-electrical', 'Bright Spark Electrical', '29 776 431 208',
   'Fixed-price electrical callouts, same day where possible',
   'Level 2 electricians covering the Inner West. Switchboards, smoke alarms, safety checks and rewires — all quoted as fixed-price jobs.',
   'Electrical callouts & safety checks', 'FAST RESPONSE',
   12, array['English'], array['Electrical','Smoke alarms','Switchboards'],
   array['Safety switch testing','Smoke alarm compliance','Switchboard upgrades','Emergency callouts'],
   array['/landing/gallery-2.png','/landing/gallery-3.png'],
   25, null, 'Under 1 hour', 'Same-day available', false, true, 92),

  (u_priya, 'accountant', 'priya-basu', 'Basu Property Accounting', '84 220 559 137',
   'Tax, structuring and depreciation for property investors',
   'CPA specialising in residential investment portfolios: depreciation schedules, trust structuring and end-of-year returns.',
   'Property tax, structuring & depreciation', 'NEW',
   9, array['English','Hindi','Bengali'], array['Taxation','Depreciation','Structuring'],
   array['Depreciation schedules','Trust structuring','Investment tax returns','Portfolio reviews'],
   array['/landing/gallery-4.png'],
   40, 'basupropertyaccounting.test', 'Same business day', 'Available next week', false, true, 88),

  (u_schen, 'co_host_inspector', 'sarah-chen', 'Chen Property Care', '61 305 774 992',
   'Detailed short-stay inspections with same-day reports',
   'Short-stay specialist covering Newtown and the surrounding suburbs. Same-day photo reports with a damage register and restock list.',
   'Short-stay inspections & condition reports', 'TOP RATED',
   5, array['English','Mandarin'], array['Inspections','Condition reports'],
   array['Pre-stay walkthroughs','Post-stay damage audits','Restock checklists'],
   array['/landing/gallery-1.png','/landing/gallery-3.png'],
   12, null, 'Under 4 hours', 'Available Thursday', false, true, 84),

  (u_marcus, 'co_host_inspector', 'marcus-lee', 'Lee Inspection Co', '17 664 220 815',
   'Fast, affordable short-stay inspections',
   'Inspections for apartment and terrace short-stays around Surry Hills and the CBD fringe.',
   'Affordable short-stay inspections', 'FAST RESPONSE',
   4, array['English'], array['Inspections','Photography'],
   array['Pre-stay walkthroughs','Listing photo audits'],
   array['/landing/gallery-2.png'],
   8, null, 'Under 6 hours', 'Available tomorrow', false, true, 76)
  on conflict (profile_id) do nothing;

  select id into p_amelia from public.service_providers where profile_id = u_amelia;
  select id into p_daniel from public.service_providers where profile_id = u_daniel;
  select id into p_spark  from public.service_providers where profile_id = u_spark;
  select id into p_priya  from public.service_providers where profile_id = u_priya;
  select id into p_schen  from public.service_providers where profile_id = u_schen;
  select id into p_marcus from public.service_providers where profile_id = u_marcus;

  -- Verification documents drive the "✓ ID / ABN / Licensed / Insured" badges.
  insert into public.verification_documents (provider_id, type, label, status, verified_at) values
    (p_amelia, 'id',        'NSW Driver Licence',              'verified', now() - interval '400 days'),
    (p_amelia, 'abn',       'ABN 51 824 753 556',              'verified', now() - interval '400 days'),
    (p_amelia, 'licence',   'NSW Real Estate Agent Licence',   'verified', now() - interval '395 days'),
    (p_amelia, 'insurance', 'Professional Indemnity',          'verified', now() - interval '120 days'),
    (p_daniel, 'id',        'NSW Photo Card',                  'verified', now() - interval '700 days'),
    (p_daniel, 'abn',       'ABN 73 118 902 445',              'verified', now() - interval '700 days'),
    (p_daniel, 'insurance', 'Public Liability $20m',           'verified', now() - interval '90 days'),
    (p_spark,  'abn',       'ABN 29 776 431 208',              'verified', now() - interval '500 days'),
    (p_spark,  'licence',   'NSW Electrical Licence',          'verified', now() - interval '500 days'),
    (p_spark,  'insurance', 'Public Liability $20m',           'verified', now() - interval '200 days'),
    (p_priya,  'id',        'Passport',                        'verified', now() - interval '300 days'),
    (p_priya,  'abn',       'ABN 84 220 559 137',              'verified', now() - interval '300 days'),
    (p_priya,  'licence',   'CPA Australia Membership',        'verified', now() - interval '300 days'),
    (p_schen,  'id',        'NSW Driver Licence',              'verified', now() - interval '250 days'),
    (p_schen,  'abn',       'ABN 61 305 774 992',              'verified', now() - interval '250 days'),
    (p_schen,  'insurance', 'Public Liability $10m',           'verified', now() - interval '100 days'),
    (p_marcus, 'id',        'NSW Photo Card',                  'verified', now() - interval '180 days'),
    (p_marcus, 'abn',       'ABN 17 664 220 815',              'verified', now() - interval '180 days'),
    (p_marcus, 'insurance', 'Public Liability $10m',           'verified', now() - interval '60 days');

  -- -------------------------------------------------------------------------
  -- Services
  -- -------------------------------------------------------------------------
  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, inclusions, exclusions, service_area, cancellation_policy, is_active, sort_order)
  values (p_amelia, 'Rental appraisal',
    'Evidence-based weekly rent range with recent comparable leases and listing recommendations.',
    'flat', 99, 60, 'Comparable lease analysis, written rent range, listing recommendations',
    'Marketing photography, listing upload', 'Inner West, 15km of Newtown',
    'Free cancellation up to 24 hours before the appointment.', true, 1)
  returning id into s_appraisal;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, inclusions, exclusions, is_active, sort_order)
  values (p_amelia, 'Open home attendance',
    'I run the open home, register every attendee and send a same-day feedback summary.',
    'flat', 200, 90, 'On-site hosting, attendee register, same-day feedback report',
    'Property styling, cleaning', true, 2)
  returning id into s_openhome;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, inclusions, exclusions, is_active, sort_order)
  values (p_amelia, 'Tenant screening',
    'Full applicant assessment: reference checks, employment verification and a written recommendation.',
    'flat', 150, 120, 'Reference checks, employment verification, written recommendation',
    'Credit reporting fees', true, 3)
  returning id into s_screening;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, inclusions, exclusions, is_active, sort_order)
  values (p_amelia, 'Listing preparation',
    'Everything needed before the listing goes live: copy, photo brief, styling notes and pricing.',
    'flat', 280, 180, 'Listing copy, photo brief, styling notes, pricing strategy',
    'Photographer fees, furniture hire', true, 4)
  returning id into s_listing;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, is_active, sort_order)
  values (p_amelia, 'Quarterly portfolio review',
    'Hourly review of an investment portfolio''s rents, vacancy and renewal strategy.',
    'hourly', 220, 60, false, 5)
  returning id into s_portfolio;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, inclusions, exclusions, is_active, sort_order)
  values (p_daniel, 'Pre-stay walkthrough',
    'Full property walkthrough before guest arrival, with same-day photographic report and restock checklist.',
    'flat', 129, 90, 'Room-by-room photo audit, damage register, restock checklist, same-day PDF report',
    'Cleaning or restocking, repairs or maintenance', true, 1)
  returning id into s_prestay;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, inclusions, exclusions, is_active, sort_order)
  values (p_daniel, 'Post-stay damage audit',
    'Detailed post-guest inspection documenting condition changes with insurance-ready evidence.',
    'flat', 149, 100, 'Timestamped photos, damage register, cost estimate notes',
    'Repairs, guest communication', true, 2)
  returning id into s_poststay;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, is_active, sort_order)
  values (p_daniel, 'Insurance evidence report',
    'Insurance-grade evidence pack for a claim or bond dispute.',
    'flat', 179, 120, true, 3)
  returning id into s_insurance;

  insert into public.provider_services (provider_id, title, description, pricing_type, price, duration_minutes, is_active, sort_order) values
    (p_spark,  'Electrical safety check',      'Safety switch, smoke alarm and switchboard inspection with compliance certificate.', 'flat', 89, 60, true, 1),
    (p_spark,  'Smoke alarm compliance visit', 'Annual smoke alarm test, battery replacement and compliance record.',                'flat', 129, 45, true, 2),
    (p_priya,  'Depreciation schedule',        'ATO-compliant depreciation schedule for a residential investment property.',         'flat', 250, 120, true, 1),
    (p_priya,  'Investment tax return',        'End-of-year return for an individual investor with up to three properties.',         'from', 450, 180, true, 2),
    (p_schen,  'Pre-stay walkthrough',         'Short-stay walkthrough with same-day photo report.',                                 'flat', 135, 90, true, 1),
    (p_schen,  'Post-stay damage audit',       'Post-guest condition audit with damage register.',                                   'flat', 155, 90, true, 2),
    (p_marcus, 'Pre-stay walkthrough',         'Fast short-stay walkthrough with photo report.',                                     'flat', 119, 60, true, 1),
    (p_marcus, 'Listing photo audit',          'Review of listing photos against the property''s current condition.',                'flat', 95, 45, true, 2);

  -- Weekday availability, 9am-5pm, for every provider.
  insert into public.provider_availability (provider_id, day_of_week, start_time, end_time)
  select p.id, d, time '09:00', time '17:00'
  from (values (p_amelia), (p_daniel), (p_spark), (p_priya), (p_schen), (p_marcus)) as p(id),
       generate_series(1, 5) as d;

  insert into public.provider_portfolio (provider_id, title, description, image_url, sort_order) values
    (p_daniel, 'Beachside terrace turnover', 'Post-stay audit for a three-bedroom short-stay terrace.', '/landing/gallery-1.png', 1),
    (p_daniel, 'Apartment condition report', 'Pre-stay walkthrough for a CBD-fringe apartment.',        '/landing/gallery-2.png', 2),
    (p_amelia, 'Newtown listing prep',       'Listing preparation for a renovated two-bedroom terrace.','/landing/gallery-3.png', 1);

  -- -------------------------------------------------------------------------
  -- Bookings (Amelia's workload — this is what the provider dashboard shows)
  -- -------------------------------------------------------------------------
  insert into public.bookings (client_id, provider_id, service_id, status, property_address, property_suburb, scheduled_date, scheduled_time, price, notes, created_at)
  values (u_vanessa, p_amelia, s_appraisal, 'new_enquiry', '14 Lord St', 'Stanmore, NSW', current_date + 4, time '14:00', 99,
          'Looking for an honest read on weekly rent — 2-bed terrace, recent reno.', now() - interval '2 hours')
  returning id into bk_vp;

  insert into public.bookings (client_id, provider_id, service_id, status, property_address, property_suburb, scheduled_date, scheduled_time, price, created_at)
  values (u_daniel, p_amelia, s_openhome, 'new_enquiry', '28 Renwick St', 'Marrickville, NSW', current_date + 5, time '11:00', 200, now() - interval '5 hours')
  returning id into bk_dr;

  insert into public.bookings (client_id, provider_id, service_id, status, property_address, property_suburb, scheduled_date, scheduled_time, price, notes, created_at)
  values (u_jon, p_amelia, s_appraisal, 'confirmed', '14 Lord St', 'Marrickville, NSW', current_date + 1, time '10:00', 99,
          'Just confirming the scheduled 10am appraisal is still good?', now() - interval '3 days')
  returning id into bk_jh;

  insert into public.bookings (client_id, provider_id, service_id, status, property_address, property_suburb, scheduled_date, price, created_at)
  values (u_mei, p_amelia, s_listing, 'in_progress', '7 Australia St', 'Newtown, NSW', current_date - 1, 280, now() - interval '6 days')
  returning id into bk_ml;

  insert into public.bookings (client_id, provider_id, service_id, status, property_address, property_suburb, scheduled_date, price, created_at)
  values (u_tom, p_amelia, s_screening, 'in_progress', '22 Audley St', 'Petersham, NSW', current_date, 150, now() - interval '4 days')
  returning id into bk_tw;

  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, completion_report, created_at)
  values (u_khoury, p_amelia, s_appraisal, 'completed', 'Newtown, NSW', current_date - 9, 99, 'Appraisal delivered with three comparable leases.', now() - interval '14 days')
  returning id into bk_sk;

  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, completion_report, created_at)
  values (u_ryan, p_amelia, s_listing, 'completed', 'Marrickville, NSW', current_date - 12, 250, 'Listing copy, photo brief and pricing delivered.', now() - interval '18 days')
  returning id into bk_rk;

  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, completion_report, created_at)
  values (u_jessica, p_amelia, s_openhome, 'completed', 'Stanmore, NSW', current_date - 14, 200, 'Open home hosted, 14 attendees registered.', now() - interval '20 days')
  returning id into bk_pb;

  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, created_at)
  values (u_jsmith, p_amelia, s_appraisal, 'cancelled', 'Enmore, NSW', current_date - 16, 99, now() - interval '22 days')
  returning id into bk_an;

  -- A little cross-provider activity so the marketplace stats aren't one-sided.
  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, created_at)
  select u_jane, p_daniel, s_prestay, 'completed', 'Bondi, NSW', current_date - 20, 129, now() - interval '25 days';
  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, created_at)
  select u_mei, p_daniel, s_poststay, 'completed', 'Newtown, NSW', current_date - 25, 149, now() - interval '30 days';
  insert into public.bookings (client_id, provider_id, service_id, status, property_suburb, scheduled_date, price, created_at)
  select u_tom, p_spark, null, 'completed', 'Marrickville, NSW', current_date - 8, 89, now() - interval '12 days';

  -- -------------------------------------------------------------------------
  -- Fictional provider histories predate every seeded completed booking.
  update public.service_providers set created_at = least(created_at, now() - interval '2 years')
  where profile_id in (u_amelia, u_daniel, u_spark, u_priya, u_schen, u_marcus);

  -- Reviews (the trigger recomputes rating_avg / review_count)
  -- -------------------------------------------------------------------------
  insert into public.reviews (booking_id, provider_id, client_id, rating, comment, provider_reply, replied_at, created_at) values
    (bk_sk, p_amelia, u_khoury, 5,
     'Excellent appraisal. Clear comps and practical recommendations for listing price.', null, null, now() - interval '8 days'),
    (bk_rk, p_amelia, u_ryan, 4,
     'Good service overall. Listing prep was thorough and Amelia was punctual. Could improve on follow-up communication.',
     'Thanks Ryan — appreciate the feedback on follow-ups. I''ll improve on that next time.', now() - interval '10 days', now() - interval '11 days'),
    (bk_pb, p_amelia, u_jessica, 5,
     'The open home was well organised and the same-day feedback summary was genuinely useful.',
     'Thank you Jessica! It was a pleasure working with you.', now() - interval '12 days', now() - interval '13 days');

  insert into public.reviews (booking_id, provider_id, client_id, rating, comment, created_at)
  select b.id, b.provider_id, b.client_id, 5, 'Thorough, on time, and the report arrived the same day.', now() - interval '18 days'
  from public.bookings b where b.provider_id = p_daniel and b.status = 'completed' and b.client_id = u_jane;

  insert into public.reviews (booking_id, provider_id, client_id, rating, comment, created_at)
  select b.id, b.provider_id, b.client_id, 5, 'Great damage register — made the bond claim painless.', now() - interval '24 days'
  from public.bookings b where b.provider_id = p_daniel and b.status = 'completed' and b.client_id = u_mei;

  insert into public.reviews (booking_id, provider_id, client_id, rating, comment, created_at)
  select b.id, b.provider_id, b.client_id, 4, 'Quick callout and a clear compliance certificate.', now() - interval '6 days'
  from public.bookings b where b.provider_id = p_spark and b.status = 'completed';

  -- -------------------------------------------------------------------------
  -- Money: transactions + invoices
  -- -------------------------------------------------------------------------
  insert into public.transactions (provider_id, booking_id, type, amount, description, created_at) values
    (p_amelia, bk_sk, 'payment',      99,   'Rental appraisal',      now() - interval '9 days'),
    (p_amelia, bk_sk, 'platform_fee', round(99::numeric * 0.085, 2), 'Platform fee',          now() - interval '9 days'),
    (p_amelia, bk_rk, 'payment',      250,  'Listing preparation',   now() - interval '12 days'),
    (p_amelia, bk_rk, 'refund',       250,  'Refunded — scope change', now() - interval '11 days'),
    (p_amelia, bk_pb, 'payment',      200,  'Open home attendance',  now() - interval '14 days'),
    (p_amelia, bk_pb, 'platform_fee', 17,   'Platform fee',          now() - interval '14 days'),
    (p_amelia, null,  'payment',      280,  'Listing preparation',   now() - interval '35 days'),
    (p_amelia, null,  'payment',      150,  'Tenant screening',      now() - interval '65 days'),
    (p_amelia, null,  'payment',      99,   'Rental appraisal',      now() - interval '95 days'),
    (p_amelia, null,  'payout',       350,  'Weekly payout',         now() - interval '20 days'),
    (p_daniel, null,  'payment',      129,  'Pre-stay walkthrough',  now() - interval '25 days'),
    (p_daniel, null,  'payment',      149,  'Post-stay damage audit',now() - interval '30 days'),
    (p_spark,  null,  'payment',      89,   'Electrical safety check', now() - interval '12 days');

  insert into public.invoices (provider_id, booking_id, number, amount, status, issued_at, due_date) values
    (p_amelia, bk_ml, 'INV-124-308', 280, 'issued', now() - interval '2 days', current_date + 12),
    (p_amelia, bk_tw, 'INV-124-309', 150, 'draft',  null,                      current_date + 20),
    (p_amelia, bk_pb, 'INV-124-305', 200, 'paid',   now() - interval '14 days', current_date - 1);

  -- -------------------------------------------------------------------------
  -- Properties (the owner's portfolio + the tenant marketplace)
  -- -------------------------------------------------------------------------
  insert into public.properties (owner_id, title, description, address, suburb, state, postcode, property_type, bedrooms, bathrooms, parking, price, bond, lease_term, available_from, amenities, photo_urls, status)
  values (u_owner, 'Modern Loft in Newtown',
    'Light-filled loft with open-plan living, updated kitchen, generous storage, and quick access to cafes and transport.',
    '5/18 Wilson St', 'Newtown', 'NSW', '2042', 'Apartment', 2, 2, 1, 720, 2880, '12 months', current_date + 30,
    array['Balcony','Secure parking','Pet friendly','Close to train','Internal laundry'],
    array['/tenant/application-modern-loft.png'], 'available')
  returning id into pr_loft;

  insert into public.properties (owner_id, title, description, address, suburb, state, postcode, property_type, bedrooms, bathrooms, parking, price, bond, lease_term, available_from, amenities, photo_urls, status)
  values (u_owner, 'Spacious Family Home',
    'Family-sized home with a quiet street setting, large backyard, refreshed interiors, and multiple living zones.',
    '12 Conie Ave', 'Baulkham Hills', 'NSW', '2153', 'House', 4, 2, 2, 860, 3440, '12 months', current_date + 24,
    array['Garden','Garage','Study nook','Solar panels','Air conditioning'],
    array['/tenant/application-family-home.png'], 'available')
  returning id into pr_family;

  insert into public.properties (owner_id, title, description, address, suburb, state, postcode, property_type, bedrooms, bathrooms, parking, price, bond, lease_term, available_from, amenities, photo_urls, status)
  values (u_owner, 'Cozy Studio near University',
    'Compact studio for a simple rental setup, close to campus, public transport, and everyday essentials.',
    '7/45 Missenden Rd', 'Camperdown', 'NSW', '2050', 'Studio', 1, 1, 0, 510, 2040, '6 months', current_date + 19,
    array['Furnished','Bills included','Shared laundry','Walk to campus'],
    array['/tenant/application-studio.png'], 'available')
  returning id into pr_studio;

  insert into public.property_inspections (property_id, starts_at, duration_minutes, capacity, notes)
  select p, s, 30, 12, null from (values
    (pr_loft,   (current_date + 2)::timestamptz + time '17:30'),
    (pr_loft,   (current_date + 3)::timestamptz + time '12:00'),
    (pr_loft,   (current_date + 5)::timestamptz + time '10:30'),
    (pr_family, (current_date + 2)::timestamptz + time '18:00'),
    (pr_family, (current_date + 6)::timestamptz + time '11:00'),
    (pr_studio, (current_date + 4)::timestamptz + time '16:00')
  ) as v(p, s);

  insert into public.property_applications (property_id, tenant_id, status, annual_income, move_in_date, rent_offered, tenant_score, shortlisted, has_pets, message, created_at) values
    (pr_loft,   u_jane,    'new',       92000,  current_date + 30, 720, 8.6, true,  false, 'Two working professionals, no pets, happy to sign a 12-month lease.', now() - interval '1 day'),
    (pr_loft,   u_jsmith,  'reviewing', 78000,  current_date + 35, 700, 7.4, false, true,  'One small indoor cat, excellent rental references.',                  now() - interval '3 days'),
    (pr_family, u_jessica, 'new',       118000, current_date + 24, 860, 9.1, true,  false, 'Family of four relocating for work, references available.',           now() - interval '2 days'),
    (pr_family, u_mei,     'approved',  105000, current_date + 24, 870, 8.9, true,  false, 'Happy to pay six months up front.',                                   now() - interval '9 days'),
    (pr_studio, u_ryan,    'declined',  46000,  current_date + 19, 500, 6.2, false, false, 'Postgraduate student with a guarantor.',                              now() - interval '6 days');

  -- -------------------------------------------------------------------------
  -- Conversations + messages
  -- -------------------------------------------------------------------------
  insert into public.conversations (client_id, provider_id, booking_id, subject)
  values (u_jon, p_amelia, bk_jh, 'Rental appraisal') returning id into cv_jh;
  insert into public.conversations (client_id, provider_id, booking_id, subject)
  values (u_mei, p_amelia, bk_ml, 'Listing preparation') returning id into cv_ml;
  insert into public.conversations (client_id, provider_id, booking_id, subject)
  values (u_tom, p_amelia, bk_tw, 'Tenant screening') returning id into cv_tw;
  insert into public.conversations (client_id, provider_id, booking_id, subject)
  values (u_vanessa, p_amelia, bk_vp, 'Rental appraisal') returning id into cv_vp;
  insert into public.conversations (client_id, provider_id, booking_id, subject)
  values (u_daniel, p_amelia, bk_dr, 'Open home attendance') returning id into cv_dr;

  insert into public.messages (conversation_id, sender_id, body, is_read, created_at) values
    (cv_jh, u_jon,    'Hi Amelia, just confirming our scheduled 10am rental appraisal. Is that still good?', true,  now() - interval '2 days'),
    (cv_jh, u_amelia, 'Hi Jonathan — yes, all confirmed. I''ll be there at 9:55. Anything specific you''d like me to look at?', true, now() - interval '2 days' + interval '7 minutes'),
    (cv_jh, u_amelia, 'Perfect, I''ll do a full walk-through and send the report within 24 hours.', true, now() - interval '2 days' + interval '28 minutes'),
    (cv_jh, u_jon,    'Just confirming the scheduled 10am appraisal is still good?', false, now() - interval '3 hours'),
    (cv_jh, u_jon,    'Also — should I be home, or can you collect the key from the agent?', false, now() - interval '2 hours'),
    (cv_ml, u_mei,    'Sent across the marketing photos — let me know what works.', true,  now() - interval '1 day'),
    (cv_ml, u_amelia, 'Got them, thanks Mei. I''ll pick the hero shot and send the listing copy tonight.', true, now() - interval '22 hours'),
    (cv_tw, u_tom,    'Two strong applicants so far, will forward references shortly.', false, now() - interval '1 day'),
    (cv_vp, u_vanessa,'Could you appraise this property before I prepare the listing?', true, now() - interval '4 days'),
    (cv_dr, u_amelia, 'Thanks for the enquiry. I will review the requested date and access details.', true, now() - interval '5 days');

  insert into public.conversations (owner_id, tenant_id, property_id, subject)
  values (u_owner, u_jane, pr_loft, 'Modern Loft in Newtown') returning id into cv_rent_jane;
  insert into public.conversations (owner_id, tenant_id, property_id, subject)
  values (u_owner, u_jsmith, pr_loft, 'Modern Loft in Newtown') returning id into cv_rent_jon;

  insert into public.messages (conversation_id, sender_id, body, is_read, created_at) values
    (cv_rent_jane, u_jane,  'Good morning! I received the updated lease agreement.', true, now() - interval '5 hours'),
    (cv_rent_jane, u_owner, 'Excellent! Let me know if you have any questions after reviewing it.', true, now() - interval '4 hours 58 minutes'),
    (cv_rent_jane, u_jane,  'I have a quick question about section 3.2. Can you clarify the maintenance responsibilities?', false, now() - interval '4 hours 55 minutes'),
    (cv_rent_jane, u_owner, 'Routine maintenance is on me; anything caused by damage sits with the tenant. I''ll send the breakdown.', true, now() - interval '4 hours 53 minutes'),
    (cv_rent_jane, u_jane,  'Perfect, that answers it. Is the inspection on Wednesday still going ahead?', false, now() - interval '40 minutes'),
    (cv_rent_jon,  u_jsmith,'Thanks for reviewing my application — happy to provide another payslip if useful.', false, now() - interval '1 day'),
    (cv_rent_jon,  u_owner, 'That would help, thanks John. Upload it whenever you get a chance.', true, now() - interval '23 hours');

  -- -------------------------------------------------------------------------
  -- Network (connections)
  -- -------------------------------------------------------------------------
  insert into public.connections (requester_id, addressee_id, status, created_at, responded_at) values
    (u_mchen,   u_owner, 'pending',  now() - interval '2 hours', null),
    (u_sarahj,  u_owner, 'pending',  now() - interval '1 day',   null),
    (u_dkim,    u_owner, 'pending',  now() - interval '2 days',  null),
    (u_elena,   u_owner, 'pending',  now() - interval '7 days',  null),
    (u_owner,   u_emily,   'accepted', now() - interval '40 days', now() - interval '39 days'),
    (u_owner,   u_jsmith,  'accepted', now() - interval '35 days', now() - interval '35 days'),
    (u_owner,   u_jessica, 'accepted', now() - interval '30 days', now() - interval '29 days'),
    (u_owner,   u_spark,   'accepted', now() - interval '25 days', now() - interval '25 days'),
    (u_owner,   u_amanda,  'accepted', now() - interval '20 days', now() - interval '19 days'),
    (u_mchen,   u_jane,  'pending',  now() - interval '2 hours', null),
    (u_sarahj,  u_jane,  'pending',  now() - interval '1 day',   null),
    (u_daniel,  u_jane,  'pending',  now() - interval '2 days',  null),
    (u_jane,    u_emily,   'accepted', now() - interval '18 days', now() - interval '18 days'),
    (u_jane,    u_jsmith,  'accepted', now() - interval '16 days', now() - interval '16 days'),
    (u_jane,    u_jessica, 'accepted', now() - interval '14 days', now() - interval '14 days'),
    (u_jane,    u_amanda,  'accepted', now() - interval '12 days', now() - interval '12 days'),
    (u_jane,    u_owner,   'accepted', now() - interval '10 days', now() - interval '10 days');

  -- -------------------------------------------------------------------------
  -- Subscriptions
  -- -------------------------------------------------------------------------
  select id into plan_pro from public.subscription_plans where code = 'owner_professional';
  insert into public.user_subscriptions (user_id, plan_id, status, started_at, renews_at)
  values (u_owner, plan_pro, 'active', now() - interval '60 days', now() + interval '10 days')
  on conflict (user_id) do update set plan_id = excluded.plan_id, status = excluded.status;

  -- -------------------------------------------------------------------------
  -- Notifications / activity feed
  -- -------------------------------------------------------------------------
  insert into public.notifications (user_id, category, title, body, link_href, is_read, created_at) values
    (u_owner, 'message',     'New message from Jane Doe',              'Perfect, that answers it. Is the inspection on Wednesday still going ahead?', '/owner/messages',      false, now() - interval '40 minutes'),
    (u_owner, 'application', 'New application for Modern Loft in Newtown', 'Jane Doe applied at $720/week.',                                         '/owner/applications',  false, now() - interval '1 day'),
    (u_owner, 'account',     'Identity verification approved',         'Your identity documents were verified by the trust team.',                    '/owner/profile',       true,  now() - interval '5 days'),
    (u_owner, 'property',    'Listing published',                      'Cozy Studio near University is now live in the marketplace.',                 '/owner/properties',    true,  now() - interval '9 days'),

    (u_jane, 'review',   'Your review of 123 Oak Street has been reported.',                             null, '/tenant/notifications', false, now() - interval '1 day'),
    (u_jane, 'review',   'Your report on the review of 456 Maple Avenue has been moderated.',            null, '/tenant/notifications', true,  now() - interval '2 days'),
    (u_jane, 'review',   'Update from moderators regarding your report on the review of 789 Pine Lane.', null, '/tenant/notifications', true,  now() - interval '3 days'),
    (u_jane, 'property', 'New property listing matching your preferences.',                              'Cozy Studio near University — $510/week.', '/tenant/properties', false, now() - interval '4 days'),
    (u_jane, 'review',   'Your submitted review is now live.',                                           null, '/tenant/notifications', true,  now() - interval '5 days'),

    (u_amelia, 'booking', 'New enquiry from Vanessa Park', 'Rental appraisal · Stanmore, NSW', '/dashboard/bookings', false, now() - interval '2 hours'),
    (u_amelia, 'message', 'New message from Jonathan Hayes', 'Just confirming the scheduled 10am appraisal is still good?', '/dashboard/messages?thread=' || cv_jh::text, false, now() - interval '3 hours'),
    (u_amelia, 'review',  'New 5-star review from Sarah Khoury', 'Excellent appraisal. Clear comps and practical recommendations.', '/dashboard/reviews', true, now() - interval '8 days');

  -- Keep the saved-providers screen non-empty.
  insert into public.saved_providers (user_id, provider_id) values
    (u_jane, p_daniel),
    (u_jane, p_amelia),
    (u_owner, p_spark)
  on conflict do nothing;

  -- Audit trail sample (cross-cutting Base requirement).
  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata) values
    (u_owner,  'property.published', 'property', pr_studio, '{"source":"seed"}'::jsonb),
    (u_amelia, 'provider.published', 'service_provider', p_amelia, '{"source":"seed"}'::jsonb);
end $$;

drop function if exists public.seed_user(uuid, text, text, user_role, text, text, text, text, text);
