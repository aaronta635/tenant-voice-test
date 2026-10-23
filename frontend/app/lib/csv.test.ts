import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvDateTime, csvFilename, downloadCsv, toCsv, type CsvColumn } from './csv';

type Row = { name: string; count: number | null; note?: string };
const COLUMNS: CsvColumn<Row>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Count', value: (row) => row.count },
  { header: 'Note', value: (row) => row.note },
];

afterEach(() => vi.restoreAllMocks());

describe('the CSV of a table', () => {
  it('has the header, then a row per item, CRLF-separated', () => {
    expect(toCsv(COLUMNS, [{ name: 'Glebe', count: 7 }, { name: 'Ryde', count: null, note: 'hidden' }]))
      .toBe('Name,Count,Note\r\nGlebe,7,\r\nRyde,,hidden\r\n');
  });

  it('quotes commas, quotes, line breaks and edge spaces', () => {
    expect(toCsv(COLUMNS, [{ name: 'Smith, "Jo"', count: 1, note: 'two\nlines' }, { name: ' padded ', count: 2 }]))
      .toBe('Name,Count,Note\r\n"Smith, ""Jo""",1,"two\nlines"\r\n" padded ",2,\r\n');
  });

  it('keeps text a spreadsheet would run as a formula from running', () => {
    const rows = ['=HYPERLINK("http://x")', '+61 2', '-1', '@SUM(A1)', '\tTab'].map((name) => ({ name, count: -3 }));

    const lines = toCsv(COLUMNS, rows).split('\r\n').slice(1, -1);

    expect(lines).toEqual([`"'=HYPERLINK(""http://x"")",-3,`, "'+61 2,-3,", "'-1,-3,", "'@SUM(A1),-3,", "'\tTab,-3,"]);
  });

  it('dates a moment in Sydney with its year, sortably', () => {
    expect(csvDateTime('2026-10-20T01:00:00Z')).toBe('2026-10-20 12:00');
    expect(csvDateTime('2026-06-30T14:30:00Z')).toBe('2026-07-01 00:30');
    expect([csvDateTime(null), csvDateTime('not a date')]).toEqual([null, null]);
  });

  it('is named after the table and the date in Sydney', () => {
    // 23 October 2026, 11 pm in UTC, is already the 24th in Sydney.
    expect(csvFilename('referrals', new Date('2026-10-23T23:00:00Z'))).toBe('housing-referrals-2026-10-24.csv');
  });

  it('downloads through a temporary link, as UTF-8 with a byte-order mark', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicks: { href: string; download: string }[] = [];
    const link = { href: '', download: '', click() { clicks.push({ href: this.href, download: this.download }); }, remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });

    downloadCsv('housing-referrals-2026-10-23.csv', 'Name\r\n');

    expect(clicks).toEqual([{ href: 'blob:csv', download: 'housing-referrals-2026-10-23.csv' }]);
    const blob = created.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(link.remove).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
