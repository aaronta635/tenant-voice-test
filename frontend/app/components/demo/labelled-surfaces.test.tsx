/**
 * Every surface that shows sample data or a feature that only works as a demo,
 * rendered with the data that brings its Demo label out (docs/demo-features.md).
 * A case fails when its label is gone or falls below AA contrast; the last
 * test fails when a component renders a Demo label and has no case here.
 */
import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application, Booking, InvoiceDocument, Property, PublicProvider } from '@/app/lib/api';
import { getTenantScreen } from '@/app/lib/tenant-data';
import { demoLabelFiles } from '@/app/test-utils/demo-label-files';
import ProviderFinancesPage from '@/app/(dashboard)/dashboard/finances/page';
import ProviderOverviewPage from '@/app/(dashboard)/dashboard/page';
import OwnerAiChatPage from '@/app/(owner)/owner/help/ai-chat/page';
import OwnerHelpPage from '@/app/(owner)/owner/help/page';
import OwnerRecommendationsPage from '@/app/(owner)/owner/recommendations/page';
import OwnerSubscriptionPage from '@/app/(owner)/owner/subscription/page';
import ContactPage from '@/app/(public)/contact/page';
import TenantApplicationsPage from '@/app/(tenant)/tenant/applications/page';
import TenantRecommendationsPage from '@/app/(tenant)/tenant/recommendations/page';
import AdminShell from '@/app/components/admin/AdminShell';
import BookingList from '@/app/components/bookings/BookingList';
import SurveyPrototypeNotice from '@/app/components/housing/SurveyPrototypeNotice';
import TribunalOutcomes from '@/app/components/housing/TribunalOutcomes';
import OnboardingFrame from '@/app/components/onboarding/OnboardingFrame';
import OwnerShell from '@/app/components/owner/OwnerShell';
import ActionPreview from '@/app/components/owner/assistant/ActionPreview';
import DemoNotice from '@/app/components/provider/DemoNotice';
import InvoiceSheet from '@/app/components/provider/InvoiceSheet';
import ProviderShell from '@/app/components/provider/ProviderShell';
import UnscannedFilesNotice from '@/app/components/provider/UnscannedFilesNotice';
import PublicProviderProfileView from '@/app/components/providers/PublicProviderProfileView';
import PropertyDetail from '@/app/components/rental/PropertyDetail';
import PropertyMarketplace from '@/app/components/rental/PropertyMarketplace';
import RentalPipeline from '@/app/components/rental/RentalPipeline';
import ReviewWizard from '@/app/components/rental/ReviewWizard';
import SampleImportNotice from '@/app/components/rental/import/SampleImportNotice';
import TenantScreenTemplates from '@/app/components/tenant/TenantScreenTemplates';
import TenantShell from '@/app/components/tenant/TenantShell';

const DEMO_PROVIDER = 'a0000000-0000-4000-8000-000000000001';
const DEMO_TENANT = 'b0000000-0000-4000-8000-000000000001';
const DEMO_LANDLORD = 'c0000000-0000-4000-8000-000000000001';
const DEMO_ADMIN = 'd0000000-0000-4000-8000-000000000001';
const SAMPLE_CONTACT = { email: 'support@tenantvoice.test', phone: '1800 000 000' };
// How the web's owner assistant started each reply before a model was connected (lib/owner-assistant).
const WEB_REPLY = 'AI-labelled, read-only until you confirm a separate action.\n\nShared owner-assistant context: {}';

const listing = {
  id: 'pr-1', owner_id: 'owner-1', title: 'Modern Loft in Newtown', description: null, address: '18 Wilson St',
  suburb: 'Newtown', state: 'NSW', postcode: '2042', property_type: 'apartment', bedrooms: 2, bathrooms: 1, parking: 1,
  price: 650, bond: 2600, lease_term: '12 months', available_from: null, amenities: [], photo_urls: [], status: 'available',
  rating_avg: 0, review_count: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
} as Property;
// The tenant's applications name their listing as the API does, from the listing each test shows.
const application = (status: Application['status']) => ({
  id: 'app-1', property_id: 'pr-1', tenant_id: 'me', status, annual_income: null, move_in_date: null, rent_offered: 650,
  tenant_score: null, shortlisted: false, has_pets: false, message: null, created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
  listing: (({ id, title, suburb, state, photo_urls, price }: Property) => ({
    id, title, suburb, state, photo_url: photo_urls?.[0] ?? null, weekly_rent: price, is_public: true,
  }))(data.properties[0] as Property),
}) as Application;
const booking = {
  id: 'b1', client_id: 'client-1', provider_id: 'provider-1', service_id: null, status: 'in_progress',
  property_address: '12 King St', property_suburb: 'Newtown', scheduled_date: '2025-01-06', scheduled_time: '09:00:00',
  price: 180, notes: null, completion_report: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
  client_name: 'Jane Doe', client_avatar_url: null, provider_name: 'Harbour Plumbing', service_title: 'Blocked drain',
  review_rating: null, unread_count: 0, conversation_id: null,
} as Booking;
const invoice = {
  id: 'invoice-1', number: 'INV-B1', status: 'paid', amount: 180, created_at: '2025-01-01T00:00:00Z',
  issued_at: '2025-01-01T00:00:00Z', due_date: '2025-01-13',
  provider: { name: 'Harbour Plumbing', abn: null, location: 'Newtown, NSW', phone: null },
  client: { name: 'Jane Doe', location: 'Newtown, NSW' },
  lines: [{ description: 'Blocked drain', detail: null, amount: 180 }],
} as InvoiceDocument;
const publicProvider = {
  id: 'prov-1', profile_id: DEMO_PROVIDER, slug: 'amelia-whitlock', business_name: 'Whitlock Property', category: 'real_estate_agent',
  category_name: 'Real Estate Agent', category_slug: 'real-estate-agent', tagline: null, bio: null, years_experience: null,
  languages: [], specialties: [], gallery_urls: [], service_radius_km: null, response_time: null, availability_note: null,
  rating_avg: 0, review_count: 0, completed_jobs: 0, created_at: '2026-01-01T00:00:00Z', verifications: [],
  profiles: { full_name: 'Amelia Whitlock', avatar_url: null, location: 'Newtown', state: 'NSW', postcode: '2042', phone: null },
} as unknown as PublicProvider;

// What the mocked API answers; each test starts from these values.
const data = vi.hoisted(() => ({
  me: null as Record<string, unknown> | null,
  contact: null as { email: string; phone: string } | null | Promise<never>,
  properties: [] as unknown[],
  applications: [] as unknown[],
  inspections: [] as unknown[],
  bookings: [] as unknown[],
  history: [] as unknown[],
  admin: null as Record<string, unknown> | null,
  token: null as string | null,
}));
const page = vi.hoisted(() => ({ pathname: '/', params: {} as Record<string, string> }));

vi.mock('next/navigation', () => ({
  usePathname: () => page.pathname,
  useParams: () => page.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} /> }));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => null,
}));
// The recommendation lists are the network area's; these tests cover the pages around them.
vi.mock('@/app/components/tenant/NetworkRecommendations', () => ({ default: () => null }));
// The provider suggestions beside them (R31) are real and tested on their own; they ask the API.
vi.mock('@/app/(owner)/owner/recommendations/OwnerProviderSuggestions', () => ({ default: () => null }));
vi.mock('@/app/components/tenant/TenantProviderSuggestions', () => ({ default: () => null }));
// Uploads are stored unscanned while no virus scanner is connected.
vi.mock('@/app/lib/upload-scanning', () => ({ uploadScanning: async () => ({ enabled: false }) }));
// The tenant dashboard's scorecards are real (R43) and have no label.
vi.mock('@/app/lib/scorecards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/scorecards')>()),
  scorecards: { list: async () => [] },
}));
vi.mock('@/app/lib/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-api')>()),
  adminApi: { me: async () => data.admin },
}));
// The tenant dashboard's "Finish setup" reads the onboarding progress.
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: async () => ({ role: 'tenant', step: null, completed_at: null }), save: async () => ({}) },
}));
// Inspection times come from their own calls (lib/inspections).
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: {
    publicSlots: async () => data.inspections, openSlots: async () => data.inspections, myBookings: async () => [],
  },
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  getAuthToken: () => data.token,
  api: {
    profiles: { me: async () => data.me },
    providers: {
      mine: async () => ({ id: 'provider-1', slug: 'harbour-plumbing', business_name: 'Harbour Plumbing', is_published: true, profile_completion: 100 }),
      myReviews: async () => [], busyTimes: async () => [],
    },
    dashboard: {
      provider: async () => ({ active_bookings: 1, new_enquiries: 0, due_this_week: 0, overdue_bookings: 0, month_earnings: 180, month_change_pct: null, rating_avg: 0, review_count: 0 }),
      providerFinance: async () => ({ available_balance: 164.7, pending_payments: 0, month_earnings: 180, total_payouts: 0, upcoming_payouts: 164.7, ytd_earnings: 164.7, lifetime_earnings: 164.7, yoy_change_pct: null, monthly: [] }),
      owner: async () => ({ property_count: 1, available_count: 1, rented_count: 0, application_count: 2, new_application_count: 1, active_lease_count: 0, unread_messages: 0, pending_connections: 0, unread_notifications: 0 }),
      ownerBadges: async () => ({ new_application_count: 1, unread_messages: 0, pending_connections: 0, unread_notifications: 0 }),
    },
    finance: { transactions: async () => [], invoices: async () => [] },
    bookings: { list: async () => data.bookings },
    conversations: { list: async () => [] },
    notifications: { list: async () => [] },
    connections: { list: async () => [] },
    ownerAssistant: { workspace: async () => ({ history: data.history }) },
    content: { faqs: async () => [], supportContact: async () => data.contact },
    subscriptions: {
      plans: async () => [{ id: 'plan-1', code: 'basic', name: 'Basic', audience: 'landlord', price: 9.99, billing_period: 'month', description: null, features: [], is_popular: false, sort_order: 1, is_current: false }],
      mine: async () => null,
    },
    applications: { listMine: async () => data.applications },
    properties: {
      listPublic: async () => data.properties,
      getPublic: async () => data.properties[0],
      reviews: async () => [],
    },
  },
}));

beforeEach(() => {
  Object.assign(data, { me: { id: 'me', full_name: 'Sam Sample', role: 'tenant' }, contact: SAMPLE_CONTACT, properties: [listing], applications: [], inspections: [], bookings: [], history: [], admin: null, token: null });
  Object.assign(page, { pathname: '/', params: {} });
  // ProviderShell only asks whether the viewport is desktop width.
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(cleanup);

const labelsIn = (view: FakeElement) => descendants(view).filter((element) => element.hasAttribute('data-demo-label'));

const SLOT = {
  id: 'slot-1', property_id: 'pr-1', owner_id: 'owner-1', starts_at: '2026-11-07T00:00:00Z', duration_minutes: 30, status: 'open',
  property_title: 'Modern Loft in Newtown', address: null, created_at: null, updated_at: null,
};

/** A step in the pipeline's step list, which reads "2Book inspectionnext": number, name, state. */
const pipelineStep = (view: FakeElement, step: string) => getByName(view, 'button', new RegExp(`^(?:\\d|✓)${step}(?:done|current|next)$`));

/** The pipeline opened at one of its steps, for a listing with an inspection time. */
async function pipelineAt(step: string) {
  data.inspections = [SLOT];
  const view = await render(<RentalPipeline />);
  await click(pipelineStep(view, step));
  return view;
}

type Surface = { name: string; file: string; show: () => Promise<FakeElement>; reasons: RegExp[] };

const SURFACES: Surface[] = [
  { name: 'the seeded provider notice', file: 'app/components/provider/DemoNotice.tsx', show: () => render(<DemoNotice />), reasons: [/Sample business, bookings, reviews and earnings/] },
  {
    name: 'a seeded provider\'s workspace', file: 'app/components/provider/ProviderShell.tsx', reasons: [/Sample business, bookings, reviews and earnings/],
    show: () => { data.me = { id: DEMO_PROVIDER, full_name: 'Amelia Whitlock' }; page.pathname = '/dashboard'; return render(<ProviderShell><p>Page</p></ProviderShell>); },
  },
  {
    name: 'a seeded provider\'s public profile', file: 'app/components/providers/PublicProviderProfileView.tsx', reasons: [/Sample business, bookings, reviews and earnings/],
    show: () => render(<PublicProviderProfileView provider={publicProvider} services={[]} reviews={[]} availability={[]} portfolio={[]} />),
  },
  {
    name: 'a seeded landlord\'s workspace', file: 'app/components/owner/OwnerShell.tsx', reasons: [/Sample account: the people, homes, bookings and messages here are fictional/],
    show: () => { data.me = { id: DEMO_LANDLORD, full_name: 'John Doe', role: 'landlord' }; page.pathname = '/owner'; return render(<OwnerShell><p>Page</p></OwnerShell>); },
  },
  {
    name: 'the seeded admin\'s console', file: 'app/components/admin/AdminShell.tsx', reasons: [/Sample account: this admin is fictional/],
    show: () => {
      Object.assign(data, { token: 'header.payload.signature', admin: { id: DEMO_ADMIN, full_name: 'Ada Admin', email: 'admin@demo.test' } });
      page.pathname = '/admin';
      return render(<AdminShell><p>Page</p></AdminShell>);
    },
  },
  {
    name: 'a seeded tenant\'s workspace', file: 'app/components/tenant/TenantShell.tsx', reasons: [/Sample account: the people, homes, bookings and messages here are fictional/],
    show: () => { data.me = { id: DEMO_TENANT, full_name: 'Jonathan Hayes', role: 'tenant' }; page.pathname = '/tenant/dashboard'; return render(<TenantShell><p>Page</p></TenantShell>); },
  },
  {
    name: 'a seeded member\'s onboarding', file: 'app/components/onboarding/OnboardingFrame.tsx', reasons: [/Sample account: the people, homes, bookings and messages here are fictional/],
    show: () => render(<OnboardingFrame accountId={DEMO_TENANT}><p>Step</p></OnboardingFrame>),
  },
  { name: 'the provider finances', file: 'app/(dashboard)/dashboard/finances/page.tsx', show: () => render(<ProviderFinancesPage />), reasons: [/Simulated ledger: bookings record payments, fees and payouts/] },
  { name: 'a printable invoice', file: 'app/components/provider/InvoiceSheet.tsx', show: () => render(<InvoiceSheet invoice={invoice} />), reasons: [/simulated invoice, not proof of a real payment/] },
  { name: 'the provider overview earnings', file: 'app/(dashboard)/dashboard/page.tsx', show: () => render(<ProviderOverviewPage />), reasons: [/Earnings are simulated ledger totals/] },
  { name: 'files in the provider inbox', file: 'app/components/provider/UnscannedFilesNotice.tsx', show: () => render(<UnscannedFilesNotice />), reasons: [/Not virus-scanned: files sent in messages/] },
  {
    name: 'completing a booking', file: 'app/components/bookings/BookingList.tsx', reasons: [/records a payment and the platform fee in the simulated ledger/],
    show: async () => {
      data.bookings = [booking];
      const view = await render(<BookingList scope="dashboard" />);
      await click(getByName(view, 'button', 'Mark done for Jane Doe'));
      return view;
    },
  },
  {
    name: 'the owner AI chat', file: 'app/(owner)/owner/help/ai-chat/page.tsx', reasons: [/saved owner-assistant data, not an AI answer/],
    show: () => { data.history = [{ question: 'How many listings do I have?', reply: WEB_REPLY }]; return render(<OwnerAiChatPage />); },
  },
  {
    name: 'an owner AI reminder before it is confirmed', file: 'app/components/owner/assistant/ActionPreview.tsx', reasons: [/no email or SMS is sent/],
    show: () => render(<ActionPreview action={{
      operation: 'create_record', payload: {},
      preview: { title: 'Create a reminder for Harbour flat', changes: [{ label: 'Due', value: 'Sat 2 Nov 2030, 9:30 am (Sydney time)' }], notes: [], demo: 'in-app reminder only; no email or SMS is sent' },
    }} />),
  },
  { name: 'the owner help page', file: 'app/(owner)/owner/help/page.tsx', show: () => render(<OwnerHelpPage />), reasons: [/Sample support contact/] },
  { name: 'the contact page', file: 'app/(public)/contact/page.tsx', show: async () => render(await ContactPage({ searchParams: Promise.resolve({}) })), reasons: [/Sample support contact/] },
  {
    name: 'the Housing Portal tribunal outcomes', file: 'app/components/housing/TribunalOutcomes.tsx', show: () => render(<TribunalOutcomes />),
    reasons: [/Sample tribunal outcomes: TenantVoice receives no NCAT decisions yet/, /sample outcome, not a real tribunal decision/],
  },
  { name: 'the Housing Portal surveys', file: 'app/components/housing/SurveyPrototypeNotice.tsx', show: () => render(<SurveyPrototypeNotice />), reasons: [/Prototype surveys: no survey is sent to anyone/] },
  { name: 'the owner plans', file: 'app/(owner)/owner/subscription/page.tsx', show: () => render(<OwnerSubscriptionPage />), reasons: [/No payment is taken: choosing a plan/] },
  { name: 'the owner recommendations', file: 'app/(owner)/owner/recommendations/page.tsx', show: () => render(<OwnerRecommendationsPage />), reasons: [/do not use your network activity yet/] },
  { name: 'the tenant recommendations', file: 'app/(tenant)/tenant/recommendations/page.tsx', show: () => render(<TenantRecommendationsPage />), reasons: [/do not use your saved preferences or activity yet/] },
  { name: 'the tenant score', file: 'app/components/tenant/TenantScreenTemplates.tsx', show: () => render(<TenantScreenTemplates screen={getTenantScreen('scorecard')!} />), reasons: [/worked out on this page from your profile, applications and connections/, /ask an owner for one from the Scorecards card on your dashboard/] },
  { name: 'the tenant access passes', file: 'app/components/tenant/TenantScreenTemplates.tsx', show: () => render(<TenantScreenTemplates screen={getTenantScreen('manage-subscription')!} />), reasons: [/No payment is taken: choosing a pass/] },
  { name: 'a sample listing import', file: 'app/components/rental/import/SampleImportNotice.tsx', show: () => render(<SampleImportNotice />), reasons: [/Sample import: these details are a made-up listing, not the one you linked/] },
];

describe('Demo labels on every sample or simulated surface', () => {
  it.each(SURFACES)('labels $name at AA contrast', async ({ show, reasons }) => {
    const labels = labelsIn(await show());

    for (const reason of reasons) {
      const label = labels.find((element) => reason.test(textOf(element)));
      expect(label, `no Demo label reads ${reason}`).toBeDefined();
      expect(textOf(label as FakeElement)).toMatch(/^Demo: /);
      expect(lowContrastText(label as FakeElement)).toEqual([]);
    }
  });

  it('renders every component that shows a Demo label', () => {
    expect([...new Set(SURFACES.map((surface) => surface.file))].sort()).toEqual(demoLabelFiles());
  });
});

describe('Demo labels that depend on the data', () => {
  it.each([
    ['OwnerShell', () => render(<OwnerShell><p>Page</p></OwnerShell>)],
    ['TenantShell', () => render(<TenantShell><p>Page</p></TenantShell>)],
    ['ProviderShell', () => { page.pathname = '/dashboard'; return render(<ProviderShell><p>Page</p></ProviderShell>); }],
  ])('leaves the %s of a real account unlabelled', async (_shell, show) => {
    data.me = { id: '3f6c2a1e-9b7d-4c1a-8e2f-5d4b3a291c0e', full_name: 'Sam Sample' };

    expect(labelsIn(await show())).toEqual([]);
  });

  it.each([
    ['OwnerShell', { id: DEMO_LANDLORD, full_name: 'John Doe', role: 'landlord' }, () => render(<OwnerShell><p>Page</p></OwnerShell>)],
    ['TenantShell', { id: DEMO_TENANT, full_name: 'Jonathan Hayes', role: 'tenant' }, () => render(<TenantShell><p>Page</p></TenantShell>)],
  ])('keeps the %s of a seeded account unlabelled on public pages, which may be real', async (_shell, me, show) => {
    // The public layout wraps every page in the signed-in member's shell.
    data.me = me;

    for (const pathname of ['/terms', '/providers/harbour-plumbing']) {
      page.pathname = pathname;
      expect(labelsIn(await show()), pathname).toEqual([]);
      cleanup();
    }
  });

  it('leaves the console of a real admin unlabelled', async () => {
    Object.assign(data, { token: 'header.payload.signature', admin: { id: '3f6c2a1e-9b7d-4c1a-8e2f-5d4b3a291c0e', full_name: 'Ada Admin', email: 'ada@example.test' } });
    page.pathname = '/admin';
    const view = await render(<AdminShell><p>Page</p></AdminShell>);

    expect(textOf(view)).toContain('Admin console');
    expect(labelsIn(view)).toEqual([]);
  });

  it('labels a real address beside a sample phone number as the phone only', async () => {
    // web.platform_settings has a real support_email row, but no support_phone row yet.
    data.contact = { email: 'help@tenantvoice.com.au', phone: '1800 000 000' };

    const [label] = labelsIn(await render(await ContactPage({ searchParams: Promise.resolve({}) })));
    expect(textOf(label)).toMatch(/the phone number is a placeholder/);
    expect(textOf(label)).not.toMatch(/email/);
    expect(labelsIn(await render(<OwnerHelpPage />)).map(textOf)).toContainEqual(expect.stringMatching(/the phone number is a placeholder/));
  });

  it('labels the support contact only while it is the sample one', async () => {
    data.contact = { email: 'help@tenantvoice.com.au', phone: '02 9000 0000' };

    expect(labelsIn(await render(await ContactPage({ searchParams: Promise.resolve({}) })))).toEqual([]);
    // The Chat with AI card is real (R29): no label left on the page.
    expect(labelsIn(await render(<OwnerHelpPage />)).map(textOf)).toEqual([]);
  });

  it('says nothing about the support contact while it is loading', async () => {
    // Until it loads, the form's address is the fallback one, which is a sample.
    data.contact = new Promise<never>(() => {});

    expect(labelsIn(await render(<OwnerHelpPage />)).map(textOf)).toEqual([]);
  });

  it('keeps the owner chat at AA contrast around its labels, replies included', async () => {
    data.history = [{ question: 'How many listings do I have?', reply: WEB_REPLY }];

    expect(lowContrastText(await render(<OwnerAiChatPage />))).toEqual([]);
  });

  it('marks only the owner chat replies this page wrote as saved data', async () => {
    // The history is shared with the mobile assistant, whose replies this page did not write.
    data.history = [
      { question: 'How many listings do I have?', reply: WEB_REPLY },
      { question: 'Which tenant pays late?', reply: 'From the mobile app: two tenants paid late this year.' },
    ];
    const view = await render(<OwnerAiChatPage />);

    expect(labelsIn(view).map(textOf)).toEqual(['Demo: saved owner-assistant data, not an AI answer']);
  });

  it('labels an owner AI action only for what stays a demo', async () => {
    const action = (demo: string | null) => ({
      operation: 'create_record', payload: {}, preview: { title: 'Save a lease agreement draft for Harbour flat', changes: [], notes: [], demo },
    });

    expect(labelsIn(await render(<ActionPreview action={action(null)} />))).toEqual([]);
    expect(labelsIn(await render(<ActionPreview action={action('recorded by you; TenantVoice does not collect rent')} />)).map(textOf))
      .toEqual(['Demo: recorded by you; TenantVoice does not collect rent']);
  });

  it('labels the owner help form\'s fallback address when the contact cannot be read', async () => {
    data.contact = null;

    expect(labelsIn(await render(<OwnerHelpPage />)).map(textOf)).toContainEqual(expect.stringMatching(/Sample support contact/));
  });

  it.each([
    ['listing cards', () => render(<PropertyMarketplace />)],
    ['tenant applications', () => { data.applications = [application('new')]; return render(<TenantApplicationsPage />); }],
    ['listing page', () => { page.params = { propertyId: 'pr-1' }; return render(<PropertyDetail />); }],
  ])('shows a listing\'s own photo on the %s without a label', async (_surface, show) => {
    data.properties = [{ ...listing, photo_urls: ['https://abcd.supabase.co/storage/v1/object/public/property-images/owner/1.png'] }];

    expect(labelsIn(await show())).toEqual([]);
  });

  it('shows no stock photo and no label on the review wizard, which names the homes without photos', async () => {
    // The review form (mobile_reviewable_homes) lists the homes by name; no listing photo stands in for one.
    data.applications = [application('approved')];
    data.properties = [{ ...listing, photo_urls: [] }];
    const view = await render(<ReviewWizard />);

    expect(descendants(view).filter((element) => element.hasAttribute('data-src')).length).toBe(0);
    expect(labelsIn(view)).toEqual([]);
  });

  it.each([
    ['listing cards', () => render(<PropertyMarketplace />)],
    ['tenant applications', () => { data.applications = [application('new')]; return render(<TenantApplicationsPage />); }],
    ['listing page', () => { page.params = { propertyId: 'pr-1' }; return render(<PropertyDetail />); }],
  ])('says "No photo yet" on the %s for a listing without photos, with no stock photo or label', async (_surface, show) => {
    data.properties = [{ ...listing, photo_urls: [] }];
    const view = await show();

    const placeholders = descendants(view).filter((element) => textOf(element) === 'No photo yet');
    expect(placeholders.length).toBeGreaterThan(0);
    // next/image is mocked as a span with data-src: no image at all stands in for the home.
    expect(descendants(view).filter((element) => element.hasAttribute('data-src')).length).toBe(0);
    expect(labelsIn(view)).toEqual([]);
    for (const placeholder of placeholders) expect(lowContrastText(placeholder)).toEqual([]);
  });

  it.each([{ times: 'none', slots: [] as unknown[] }, { times: 'one', slots: [SLOT] }])('labels no inspection times ($times): they book for real', async ({ slots }) => {
    data.inspections = slots;
    const view = await render(<RentalPipeline />);
    await click(pipelineStep(view, 'Book inspection'));

    expect(labelsIn(view)).toEqual([]);
  });

  it.each(['Lease agreement', 'Move in'])('labels no pipeline step %s: it follows the real lease', async (step) => {
    expect(labelsIn(await pipelineAt(step))).toEqual([]);
  });
});

describe('the words beside a Demo label', () => {
  it('claim nothing the label says the feature does not do', async () => {
    data.history = [{ question: 'How many listings do I have?', reply: WEB_REPLY }];
    const chat = await render(<OwnerAiChatPage />);
    const help = await render(<OwnerHelpPage />);

    expect(textOf(await render(<OwnerRecommendationsPage />))).not.toMatch(/based on your network activity/i);
    expect(textOf(await render(<TenantRecommendationsPage />))).not.toMatch(/based on your activity/i);
    // The reply's heading beside "not an AI answer".
    expect(descendants(chat).filter((element) => textOf(element) === 'AI')).toEqual([]);
    expect(textOf(chat)).toContain('Owner assistant');
    // The card leads to the contact page, which has no chat.
    expect(textOf(help)).not.toContain('Live Chat');
    expect(getByName(help, 'a', /Contact us/).getAttribute('href')).toBe('/contact');
  });
});
