import { cleanup, click, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { Aggregates } from '@/app/lib/housing-api';
import HousingAggregates from './HousingAggregates';

const mocks = vi.hoisted(() => ({ aggregates: vi.fn(), download: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { aggregates: mocks.aggregates },
}));
vi.mock('@/app/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/csv')>()),
  downloadCsv: mocks.download,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const AGGREGATES: Aggregates = {
  threshold: 5, areas: 2, suppressed_cells: 1,
  cells: [
    { area: 'Glebe', state: 'NSW', category: 'Maintenance', category_code: 'MAINTENANCE', count: 7, suppressed: false },
    { area: 'Ryde', state: 'NSW', category: 'Safety', category_code: 'SAFETY', count: null, suppressed: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aggregates.mockResolvedValue(AGGREGATES);
});
afterEach(cleanup);

describe('the de-identified aggregates', () => {
  it('shows counts by suburb and category, and a hidden count as hidden', async () => {
    const view = await render(<HousingAggregates />);

    expect(textOf(view)).toContain('Suburbs2');
    expect(textOf(view)).toContain('Hidden counts1');
    expect(textOf(view)).toContain('GlebeNSWMaintenance7');
    expect(textOf(view)).toContain('RydeNSWSafetyHidden (suppressed)');
    expect(textOf(view)).toContain('A count under 5 is hidden.');
  });

  it('keeps a hidden count out of the CSV too', async () => {
    const view = await render(<HousingAggregates />);

    await click(getByName(view, 'button', 'Download CSV of complaints by suburb and category'));

    expect(mocks.download.mock.calls[0][1]).toBe('Suburb,State,Category,Complaints\r\nGlebe,NSW,Maintenance,7\r\nRyde,NSW,Safety,suppressed\r\n');
  });

  it('says when no complaint is linked to a home, and when it cannot load', async () => {
    mocks.aggregates.mockResolvedValueOnce({ threshold: 5, areas: 0, suppressed_cells: 0, cells: [] });
    expect(textOf(await render(<HousingAggregates />))).toContain('No complaint is linked to a home yet.');
    await cleanup();

    mocks.aggregates.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const failed = await render(<HousingAggregates />);
    expect(textOf(failed)).toContain("Couldn't load the aggregates");
    expect(lowContrastText(failed)).toEqual([]);
  });
});
