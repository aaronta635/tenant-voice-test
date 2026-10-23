import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEntry, ActivityPage } from '@/app/lib/admin-activity-api';
import { ApiError } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import AdminActivity from './AdminActivity';

const mocks = vi.hoisted(() => ({ activity: vi.fn() }));
vi.mock('@/app/lib/admin-activity-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-activity-api')>()),
  adminActivityApi: { activity: mocks.activity },
}));
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => '/admin/activity',
    useSearchParams: () => {
      const search = useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const decision: ActivityEntry = {
  id: 'e1', log: 'admin', actor: { id: 'ada', full_name: 'Ada Admin', role: 'admin' }, action: 'review.moderated',
  entity_type: 'review', entity_id: 'r1', summary: "Hid Mia Tenant's review of Harbour flat: Personal attack.",
  details: { source: 'web', decision: 'hidden', reason: 'Personal attack.', reports: 1 }, created_at: '2025-10-01T02:00:00Z',
};
const request: ActivityEntry = {
  id: 'e2', log: 'web', actor: { id: 'tia', full_name: 'Tia Nguyen', role: 'tenant' }, action: 'post:/api/v1/complaints',
  entity_type: null, entity_id: null, summary: 'POST /api/v1/complaints', details: { method: 'POST', status: 201 },
  created_at: '2025-10-01T03:00:00Z',
};

function pageOf(log: ActivityPage['log'], items: ActivityEntry[], total = items.length): ActivityPage {
  return { log, items, total, limit: 25, offset: 0 };
}

let leavePage = () => {};
function openPage(search = '') {
  leavePage();
  navigation.page = createFakeHistory(`/admin/activity${search}`);
  leavePage = navigation.page.install(window);
}

async function land() {
  await act(async () => { navigation.page.land(); });
  await settle();
}

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};

beforeEach(() => {
  vi.clearAllMocks();
  openPage();
  mocks.activity.mockImplementation(async ({ log }: { log: ActivityPage['log'] }) => (
    log === 'web' ? pageOf('web', [request]) : pageOf('admin', [decision], 41)));
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

describe('the activity log', () => {
  it('lists the admin log\'s decisions with who made them and why', async () => {
    const view = await render(<AdminActivity />);

    expect(mocks.activity).toHaveBeenCalledWith({ log: 'admin', actor: '', action: '', entity: '', from: '', to: '', page: 1 });
    expect(textOf(view)).toContain('41 entries');
    const entry = descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith('Ada Admin'))!;
    expect(textOf(entry)).toContain('Ada Admin (Admin)');
    expect(textOf(entry)).toContain('review.moderated');
    expect(textOf(entry)).toContain("Hid Mia Tenant's review of Harbour flat: Personal attack.");
    expect(textOf(entry)).toContain('Review r1');
    expect(textOf(entry)).toContain('reason:Personal attack.');
    expect(textOf(entry)).not.toContain('source:');
    expect(getByName(view, 'a', 'Next page')).toBeTruthy();
    // Reports go through mobile_report_review into the review, not the log.
    expect(textOf(view)).toContain('Decisions made in the admin consoles of both apps. Reported reviews wait in the review queue.');
    expect(textOf(view)).not.toContain('the reviews members reported');
  });

  it('switches to the web log, keeping the filters in the URL', async () => {
    openPage('?actor=tia&from=2025-10-01');
    const view = await render(<AdminActivity />);

    await click(getByName(view, 'a', 'Web activity'));
    await land();

    expect(navigation.page.location.search).toBe('?log=web&actor=tia&from=2025-10-01');
    expect(mocks.activity).toHaveBeenLastCalledWith({ log: 'web', actor: 'tia', action: '', entity: '', from: '2025-10-01', to: '', page: 1 });
    expect(textOf(view)).toContain('POST /api/v1/complaints');
    expect((field(view, 'Person') as FakeElement).value).toBe('tia');
  });

  it('writes the typed filters and the kind to the URL', async () => {
    const view = await render(<AdminActivity />);

    await typeInto(field(view, 'Person') as FakeElement, ' ada ');
    await typeInto(field(view, 'Action') as FakeElement, 'moderated');
    await typeInto(field(view, 'From') as FakeElement, '2025-10-01');
    await typeInto(field(view, 'To') as FakeElement, '2025-10-31');
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');
    await land();
    const kind = field(view, 'Kind') as FakeElement;
    kind.value = 'review';
    await dispatch(kind, 'change');
    await land();

    expect(navigation.page.location.search).toBe('?actor=ada&action=moderated&from=2025-10-01&to=2025-10-31&entity=review');
    expect(mocks.activity).toHaveBeenLastCalledWith({
      log: 'admin', actor: 'ada', action: 'moderated', entity: 'review', from: '2025-10-01', to: '2025-10-31', page: 1,
    });
  });

  it('says when nothing matches, and offers a retry when the log cannot load', async () => {
    openPage('?actor=nobody');
    mocks.activity.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.activity.mockResolvedValueOnce(pageOf('admin', []));
    const view = await render(<AdminActivity />);

    expect(textOf(view)).toContain("Couldn't load the activity log");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No entries found');
    await click(getByName(view, 'button', 'Clear the filters'));
    expect(navigation.page.location.search).toBe('');
  });

  it('keeps the log at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminActivity />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
