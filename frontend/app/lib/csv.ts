// CSV files of the tables the Housing Portal shows (tracker R41): each download
// holds exactly the rows and columns of the table beside it, made in the
// browser from what the server sent, so it can never hold more.

export type CsvValue = string | number | boolean | null | undefined;
export type CsvColumn<Row> = { header: string; value: (row: Row) => CsvValue };

/**
 * One field. A spreadsheet runs text that starts with =, +, -, @, a tab or a
 * carriage return as a formula (CSV injection), so such text gets a leading
 * apostrophe; numbers stay numbers. Quotes, commas, line breaks and edge
 * spaces are quoted.
 */
function field(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The header row, then a row per item, CRLF-separated as RFC 4180 has it. */
export function toCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const lines = [columns.map((column) => field(column.header)), ...rows.map((row) => columns.map((column) => field(column.value(row))))];
  return `${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
}

/**
 * A moment as a CSV holds it: "2026-10-20 12:00" in Sydney, with its year
 * and sortable, where the page shows "Tue, 20 Oct, 12:00 pm".
 */
export function csvDateTime(value: string | null | undefined): string | null {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** A file name for one table, dated in Sydney: housing-referrals-2026-10-23.csv. */
export function csvFilename(name: string, now = new Date()): string {
  return `housing-${name}-${now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}.csv`;
}

/** Saves the text as a file through a temporary link: the browser's own download, no server round trip. */
export function downloadCsv(filename: string, csv: string) {
  // The byte-order mark makes Excel read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
