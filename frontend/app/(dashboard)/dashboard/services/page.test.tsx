import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDashboard, ProviderService, ServiceProvider } from '@/app/lib/api';
import { ADD_SERVICE_HREF } from '@/app/lib/list-options';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ServicesPage from './page';

const mockApi = vi.hoisted(() => ({
  providers: { mine: vi.fn(), myServices: vi.fn(), createService: vi.fn(), updateService: vi.fn(), deleteService: vi.fn() },
  dashboard: { provider: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
/** The query useSearchParams reports; sync() hands a History API write to it, as Next does. */
const navigation = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    search: '',
    listeners,
    sync(search: string) { this.search = search; listeners.forEach((listener) => listener()); },
  };
});
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => { navigation.listeners.add(listener); return () => { navigation.listeners.delete(listener); }; };
  return {
    useRouter: () => ({ refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => navigation.search)),
  };
});

const provider = { id: 'prov-1', slug: 'harbour-cleans', business_name: 'Harbour Cleans', is_published: true } as ServiceProvider;
const bondClean: ProviderService = {
  id: 'bond', provider_id: 'prov-1', title: 'Bond clean', description: 'Bond-back cleans for apartments.', pricing_type: 'flat', price: 320,
  duration_minutes: 180, inclusions: null, exclusions: null, service_area: null, category: 'GENERAL', cancellation_policy: null,
  is_active: true, sort_order: 0, booking_count: 2, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
const stats = {
  active_bookings: 1, due_this_week: 0, month_earnings: 0, month_change_pct: null, booking_conversion_pct: null, decided_enquiries: 0,
} as ProviderDashboard;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const focused = () => document.activeElement as unknown as FakeElement;
const byId = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id);
/** The polite live region inside the element with this id. */
const statusIn = (view: FakeElement, id: string) => byId(view, id)
  ?.querySelectorAll('p').find((element) => element.getAttribute('role') === 'status');
const field = (view: FakeElement, placeholder: string) => descendants(view).find((element) => element.getAttribute('placeholder') === placeholder) as FakeElement;
/** Saves the open service editor, as its submit button does. */
const saveEditor = (view: FakeElement) => dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = '';
  mockApi.providers.mine.mockResolvedValue(provider);
  mockApi.providers.myServices.mockResolvedValue([bondClean]);
  mockApi.dashboard.provider.mockResolvedValue(stats);
});
afterEach(cleanup);

describe('ServicesPage results', () => {
  it('moves focus to the row result once a change saves', async () => {
    mockApi.providers.updateService.mockResolvedValue({ ...bondClean, is_active: false });
    const view = await render(<ServicesPage />);
    const disable = getByName(view, 'button', 'Disable Bond clean');
    disable.focus();
    await click(disable);

    expect(focused().id).toBe('service-feedback-bond');
    expect(textOf(focused())).toBe('Bond clean saved as draft.');
  });

  it('leaves focus where the provider moved it while the change saved', async () => {
    const saved = deferred<ProviderService>();
    mockApi.providers.updateService.mockReturnValue(saved.promise);
    // The shell's header search sits outside the page.
    const view = await render(<><input aria-label="Search" /><ServicesPage /></>);
    const disable = getByName(view, 'button', 'Disable Bond clean');
    disable.focus();
    await click(disable);
    const search = getByName(view, 'input', 'Search');
    search.focus();

    await act(async () => saved.resolve({ ...bondClean, is_active: false }));
    await settle();
    expect(focused()).toBe(search);
    expect(textOf(view)).toContain('Bond clean saved as draft.');
  });

  it('has the page-wide live region in place before a removal returns, and writes the result into it', async () => {
    const removed = deferred<void>();
    mockApi.providers.deleteService.mockReturnValue(removed.promise);
    const view = await render(<ServicesPage />);
    const pageStatus = () => statusIn(view, 'service-feedback-global');
    await click(getByName(view, 'button', 'Remove Bond clean'));
    await click(getByName(view, 'button', 'Remove service'));

    // A live region added along with its text is often not read out.
    const status = pageStatus();
    expect(status).toBeDefined();
    expect(textOf(status as FakeElement)).toBe('');
    await act(async () => removed.resolve());
    await settle();
    expect(pageStatus()).toBe(status);
    expect(textOf(status as FakeElement)).toBe('Bond clean removed.');
  });

  it('has the row’s live region in place before an edit returns, and writes the result into it', async () => {
    const saved = deferred<ProviderService>();
    mockApi.providers.updateService.mockReturnValue(saved.promise);
    const view = await render(<ServicesPage />);
    const region = () => byId(view, 'service-feedback-bond') as FakeElement;
    const status = statusIn(view, 'service-feedback-bond');
    expect(status).toBeDefined();
    // Out of the row's flex flow while empty, so it adds no gap.
    expect(region().className).toBe('sr-only');
    await click(getByName(view, 'button', 'Edit Bond clean'));
    await saveEditor(view);

    expect(mockApi.providers.updateService).toHaveBeenCalledWith('bond', expect.objectContaining({ title: 'Bond clean' }));
    expect(statusIn(view, 'service-feedback-bond')).toBe(status);
    expect(textOf(status as FakeElement)).toBe('');
    await act(async () => saved.resolve(bondClean));
    await settle();
    expect(statusIn(view, 'service-feedback-bond')).toBe(status);
    expect(textOf(status as FakeElement)).toBe('Bond clean updated.');
    expect(region().className).not.toContain('sr-only');
  });

  it('clears the last result when the editor opens, so the same result is read out again', async () => {
    mockApi.providers.updateService.mockResolvedValueOnce(bondClean);
    const view = await render(<ServicesPage />);
    const status = statusIn(view, 'service-feedback-bond') as FakeElement;
    await click(getByName(view, 'button', 'Edit Bond clean'));
    await saveEditor(view);
    expect(textOf(status)).toBe('Bond clean updated.');

    const saved = deferred<ProviderService>();
    mockApi.providers.updateService.mockReturnValueOnce(saved.promise);
    await click(getByName(view, 'button', 'Edit Bond clean'));
    await saveEditor(view);
    expect(textOf(status)).toBe('');
    await act(async () => saved.resolve(bondClean));
    await settle();
    expect(textOf(status)).toBe('Bond clean updated.');
  });

  it('writes an added service’s result into the page-wide live region, in place before the save returns', async () => {
    mockApi.providers.myServices.mockResolvedValue([]);
    const created = deferred<ProviderService>();
    mockApi.providers.createService.mockReturnValue(created.promise);
    const view = await render(<ServicesPage />);
    const status = statusIn(view, 'service-feedback-global');
    // The empty state's button; the header has one too.
    await click(descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Add new service').at(-1) as FakeElement);
    await typeInto(field(view, 'e.g. Rental appraisal'), 'Window clean');
    await typeInto(field(view, 'What the client gets and how the job runs.'), 'Inside and out.');
    await typeInto(field(view, '99'), '80');
    await saveEditor(view);

    expect(mockApi.providers.createService).toHaveBeenCalledWith(expect.objectContaining({ title: 'Window clean', price: 80 }));
    expect(status).toBeDefined();
    expect(statusIn(view, 'service-feedback-global')).toBe(status);
    expect(textOf(status as FakeElement)).toBe('');
    await act(async () => created.resolve({ ...bondClean, id: 'window', title: 'Window clean', price: 80 }));
    await settle();
    expect(statusIn(view, 'service-feedback-global')).toBe(status);
    expect(textOf(status as FakeElement)).toBe('Window clean added.');
    expect(textOf(statusIn(view, 'service-feedback-window') as FakeElement)).toBe('');
    expect(focused().id).toBe('service-feedback-global');
  });
});

describe('ServicesPage opened from "List your service"', () => {
  let page: FakeHistory;
  let leavePage = () => {};
  /** A full load of the services page at `href`. */
  function open(href: string) {
    page = createFakeHistory(href);
    leavePage = page.install(window);
    navigation.search = page.location.search;
  }
  afterEach(() => { leavePage(); });
  const openDialog = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'));

  it('opens the new-service form once the profile has loaded, then drops ?new=1 so a reload shows the list', async () => {
    open(ADD_SERVICE_HREF);
    const view = await render(<ServicesPage />);

    const dialog = openDialog(view) as FakeElement;
    expect(textOf(descendants(dialog).find((element) => element.tagName === 'H2') as FakeElement)).toBe('Add a service');
    expect(page.stack()).toEqual(['>/dashboard/services']);
  });

  it('leaves the form closed on a plain visit', async () => {
    open('/dashboard/services');
    const view = await render(<ServicesPage />);
    expect(openDialog(view)).toBeUndefined();
  });

  it('opens the form when "List your service" is chosen on this page after it loaded', async () => {
    open('/dashboard/services');
    const view = await render(<ServicesPage />);
    expect(openDialog(view)).toBeUndefined();

    // The workspace List menu writes ?new=1 through the History API.
    await act(async () => {
      window.history.pushState(null, '', ADD_SERVICE_HREF);
      navigation.sync(page.location.search);
    });
    await settle();

    const dialog = openDialog(view) as FakeElement;
    expect(textOf(descendants(dialog).find((element) => element.tagName === 'H2') as FakeElement)).toBe('Add a service');
    expect(page.stack()).toEqual(['/dashboard/services', '>/dashboard/services']);
  });

  it('sends a provider with no profile yet through onboarding, which returns to the form', async () => {
    open(ADD_SERVICE_HREF);
    mockApi.providers.mine.mockResolvedValue(null);
    const view = await render(<ServicesPage />);

    expect(openDialog(view)).toBeUndefined();
    const onboarding = new URL(getByName(view, 'a', 'Start onboarding').getAttribute('href') as string, 'https://tenantvoice.test');
    expect(onboarding.pathname).toBe('/dashboard/onboarding');
    expect(onboarding.searchParams.get('next')).toBe(ADD_SERVICE_HREF);
    // Kept, so the form still opens if the profile turns up on a reload.
    expect(page.stack()).toEqual([`>${ADD_SERVICE_HREF}`]);
  });
});

describe('ServicesPage contrast', () => {
  it('keeps its text at AA contrast on the workspace background', async () => {
    // The provider shell's main area is #f8f9fa.
    const view = await render(<div className="bg-[#f8f9fa]"><ServicesPage /></div>);

    expect(textOf(view)).toContain('Provider workspace');
    expect(lowContrastText(view)).toEqual([]);
  });
});
