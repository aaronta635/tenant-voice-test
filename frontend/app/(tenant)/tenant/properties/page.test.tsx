import { describe, expect, it, vi } from 'vitest';
import { componentNamed, find } from '@/app/test-utils/shallow-render';
import TenantPropertiesPage from './page';

// The listings and the workspace render client-side; the page hands the query on.
vi.mock('@/app/components/rental/PropertyMarketplace', () => ({ default: function PropertyMarketplace() { return null; } }));
vi.mock('@/app/components/tenant/TenantShell', () => ({ default: function TenantShell() { return null; } }));

const initialQuery = async (q?: string | string[]) =>
  find(await TenantPropertiesPage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) }), componentNamed('PropertyMarketplace')).props.initialQuery;

describe('the tenant rentals page', () => {
  it('searches the text in ?q, the first one when a link repeats it', async () => {
    expect(await initialQuery('Newtown')).toBe('Newtown');
    expect(await initialQuery(['Newtown', 'Glebe'])).toBe('Newtown');
    expect(await initialQuery([])).toBe('');
    expect(await initialQuery()).toBe('');
  });
});
