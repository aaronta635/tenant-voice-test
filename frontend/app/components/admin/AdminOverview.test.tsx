import { cleanup, click, getByName, render, settle, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOverview as Overview } from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import AdminOverview from './AdminOverview';

const mocks = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock('@/app/lib/admin-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-api')>()),
  adminApi: { overview: mocks.overview },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const role = (name: string, total: number, over = {}) => ({
  role: name, total, active: total, pending_verification: 0, suspended: 0, deactivated: 0, ...over,
});

const OVERVIEW: Overview = {
  users_total: 9,
  closed_accounts: 2,
  roles: [
    role('tenant', 5, { active: 3, suspended: 1, pending_verification: 1 }), role('landlord', 2),
    role('service_provider', 1), role('admin', 1), role('officer', 0),
  ],
  pending_documents: 4,
  pending_document_people: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.overview.mockResolvedValue(OVERVIEW);
});
afterEach(cleanup);

describe('the admin overview', () => {
  it('shows accounts by role and status, and the documents in review', async () => {
    let finish!: (value: Overview) => void;
    mocks.overview.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await render(<AdminOverview />);
    expect(getByName(view, 'div', 'Loading the overview')).toBeTruthy();

    finish(OVERVIEW);
    await settle();

    expect(textOf(view)).toContain('Open accounts9');
    expect(textOf(view)).toContain('Documents in review4From 3 people');
    expect(textOf(view)).toContain('Closed accounts2');
    expect(textOf(view)).toContain('Tenants5');
    expect(textOf(view)).toContain('Suspended1');
    expect(getByName(view, 'a', 'View tenants').getAttribute('href')).toBe('/admin/users?role=tenant');
    expect(getByName(view, 'a', 'Review documents in the verification queue').getAttribute('href')).toBe('/admin/verification');
    // A role nobody has offers no list to open.
    expect(textOf(view)).not.toContain('View officers');
  });

  it('says when there are no accounts yet', async () => {
    mocks.overview.mockResolvedValue({ ...OVERVIEW, users_total: 0, roles: [], pending_documents: 0, pending_document_people: 0 });
    const view = await render(<AdminOverview />);

    expect(textOf(view)).toContain('There are no accounts yet.');
  });

  it('offers a retry when it cannot load', async () => {
    mocks.overview.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<AdminOverview />);

    expect(textOf(view)).toContain("Couldn't load the overview");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Open accounts9');
  });

  it('keeps its text at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminOverview />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
