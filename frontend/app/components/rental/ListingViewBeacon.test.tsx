import { cleanup, render } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicPropertyDetailPage from '@/app/(public)/properties/[propertyId]/page';
import TenantPropertyDetailPage from '@/app/(tenant)/tenant/properties/[propertyId]/page';
import ListingViewBeacon from './ListingViewBeacon';

const mocks = vi.hoisted(() => ({ record: vi.fn(), params: { propertyId: 'pr-1' } as { propertyId: string | string[] } }));

vi.mock('next/navigation', () => ({ useParams: () => mocks.params }));
vi.mock('@/app/lib/listing-views', () => ({ recordListingView: mocks.record }));
// The pages' other parts are tested on their own.
vi.mock('@/app/components/rental/PropertyDetail', () => ({ default: () => null }));
vi.mock('@/app/components/tenant/TenantShell', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = { propertyId: 'pr-1' };
  mocks.record.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('the listing view beacon', () => {
  it("counts the route's listing once when the page loads", async () => {
    await render(<ListingViewBeacon />);

    expect(mocks.record.mock.calls).toEqual([['pr-1']]);
  });

  it('reads a catch-all id as its first segment', async () => {
    mocks.params = { propertyId: ['pr-2', 'extra'] };
    await render(<ListingViewBeacon />);

    expect(mocks.record.mock.calls).toEqual([['pr-2']]);
  });

  it.each([
    ['the public listing page', PublicPropertyDetailPage],
    ["the tenant's listing page", TenantPropertyDetailPage],
  ])('is on %s', async (_page, Page) => {
    await render(<Page />);

    expect(mocks.record.mock.calls).toEqual([['pr-1']]);
  });
});
