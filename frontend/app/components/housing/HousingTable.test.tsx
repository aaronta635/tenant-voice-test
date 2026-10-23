import { cleanup, descendants, render } from '@/app/components/ui/test-dom';
import { afterEach, describe, expect, it } from 'vitest';
import HousingTable, { type HousingColumn } from './HousingTable';

type Row = { id: string; area: string; count: number };
const COLUMNS: HousingColumn<Row>[] = [
  { header: 'Area', value: (row) => row.area, cell: (row) => <>{row.area}<span className="sr-only"> (NSW)</span></> },
  { header: 'Complaints', value: (row) => row.count, numeric: true },
];
const ROWS: Row[] = [{ id: 'r-1', area: 'Glebe', count: 3 }];

afterEach(cleanup);

const table = () => render(
  <HousingTable title="Complaints by suburb" name="complaints" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} empty="None." />,
);

describe('a Housing Portal table', () => {
  it('scrolls inside a positioned region, so hidden text in a cell is clipped with it and never widens the page', async () => {
    const view = await table();
    const region = descendants(view).find((element) => element.getAttribute('role') === 'region')!;

    expect(region.className.split(' ')).toEqual(expect.arrayContaining(['relative', 'overflow-x-auto', 'max-w-full']));
    // The screen-reader-only text sits inside it.
    expect(descendants(region).some((element) => element.className === 'sr-only')).toBe(true);
  });

  it('names its landmarks apart: the section by its heading, the scroller as its table', async () => {
    const view = await table();
    const section = descendants(view).find((element) => element.tagName === 'SECTION')!;
    const heading = descendants(view).find((element) => element.tagName === 'H2')!;
    const region = descendants(view).find((element) => element.getAttribute('role') === 'region')!;

    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(region.getAttribute('aria-labelledby')).toBeNull();
    expect(region.getAttribute('aria-label')).toBe('Complaints by suburb table');
  });
});
